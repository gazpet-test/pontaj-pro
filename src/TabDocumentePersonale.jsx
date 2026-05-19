// ===========================================================================
// MODUL HR — TabDocumente Personale (Etapa 6.A)
// Documente identitate, stare civilă, studii, juridic, fiscal, medical,
// contract & formulare interne. Distinct de hr_autorizatii.
// Gating: can_access_personal_data OR is_owner (din profiles, Etapa 5)
// ===========================================================================
import { useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase.js'
import DocumenteBulkImportModal from './DocumenteBulkImportModal.jsx'

// Theme (consistent cu HR.jsx)
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
const tdStyle = { padding:'10px 12px', verticalAlign:'top' }

const BUCKET = 'documente-personal'

// Meta pe categorie — distinct de CAT_META (autorizații)
const CAT_META_DOCUMENTE = {
  identitate:         { emoji: '🪪', label: 'Identitate' },
  stare_civila:       { emoji: '👨‍👩‍👧', label: 'Stare civilă' },
  studii:             { emoji: '🎓', label: 'Studii' },
  juridic:            { emoji: '⚖', label: 'Juridic' },
  angajator_anterior: { emoji: '💼', label: 'Angajator anterior' },
  fiscal:             { emoji: '🏦', label: 'Fiscal' },
  medical:            { emoji: '🩺', label: 'Medical' },
  contract_intern:    { emoji: '📄', label: 'Contract & Formulare' },
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function statusBadge(status, zile) {
  const config = {
    valid:      { bg: G.greenDim,  fg: G.green,  label: '✓ Valid' },
    expira_60z: { bg: G.greenDim,  fg: G.green,  label: `Expiră în ${zile}z` },
    expira_30z: { bg: G.yellowDim, fg: G.yellow, label: `⚠ Expiră în ${zile}z` },
    expirat:    { bg: G.redDim,    fg: G.red,    label: '🚨 EXPIRAT' },
    fara_exp:   { bg: G.greenDim,  fg: G.green,  label: '∞ Fără expirare' },
    fara_data:  { bg: '#2A2A2A',   fg: G.muted,  label: '— Fără dată —' },
  }[status] || { bg: '#2A2A2A', fg: G.muted, label: '—' }
  
  return (
    <span style={{padding:'3px 8px', fontSize:11, borderRadius:4, background: config.bg, color: config.fg, fontWeight:600, whiteSpace:'nowrap'}}>
      {config.label}
    </span>
  )
}

async function openDocPreview(path, showToast) {
  if (!path) { showToast('Acest document nu are fișier uploadat', 'warn'); return }
  try {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60)
    if (error) throw error
    window.open(data.signedUrl, '_blank')
  } catch (e) {
    showToast('Eroare preview document: ' + (e.message || e), 'error')
  }
}

// Generează storage path: {employee_id}/{tip_cod}/{YYYY-MM-DD}_{uuid8}.{ext}
function genStoragePath(employeeId, tipCod, fileName) {
  const ext = fileName.split('.').pop().toLowerCase()
  const today = new Date().toISOString().split('T')[0]
  const uuid = (typeof crypto !== 'undefined' && crypto.randomUUID) 
    ? crypto.randomUUID().slice(0, 8) 
    : Math.random().toString(36).slice(2, 10)
  return `${employeeId}/${tipCod}/${today}_${uuid}.${ext}`
}

// ─── Sub-componente ─────────────────────────────────────────────────────────

function KPICard({ icon, label, value, color, bg }) {
  return (
    <div style={{...S.card, padding:'14px 18px', background: bg || G.surface, borderColor: color ? color+'33' : G.border}}>
      <div style={{display:'flex', alignItems:'center', gap:6, fontSize:11, fontWeight:600, color: color || G.muted, textTransform:'uppercase', letterSpacing:.4, marginBottom:8}}>
        <span>{icon}</span><span>{label}</span>
      </div>
      <div style={{fontSize:28, fontWeight:800, color: color || G.text, lineHeight:1}}>{value}</div>
    </div>
  )
}

function Lbl({ children }) {
  return <div style={{fontSize:10, color:G.muted, fontWeight:700, textTransform:'uppercase', letterSpacing:.6, marginBottom:4}}>{children}</div>
}

// ─── MODAL ADD DOCUMENT ─────────────────────────────────────────────────────

function ModalAddDocument({ employees, tipuri, defaultEmployeeId, onClose, onSaved, showToast }) {
  const [employeeId, setEmployeeId] = useState(defaultEmployeeId || '')
  const [tipId, setTipId] = useState('')
  const [numar, setNumar] = useState('')
  const [emitent, setEmitent] = useState('')
  const [dataEmitere, setDataEmitere] = useState('')
  const [dataExpirare, setDataExpirare] = useState('')
  const [faraExpirare, setFaraExpirare] = useState(false)
  const [observatii, setObservatii] = useState('')
  const [file, setFile] = useState(null)
  const [saving, setSaving] = useState(false)
  
  const tipSelectat = tipuri.find(t => t.id === Number(tipId))
  const empSelectat = employees.find(e => e.id === Number(employeeId))
  
  const save = async () => {
    if (!employeeId) { showToast('Alege angajatul', 'warn'); return }
    if (!tipId) { showToast('Alege tipul documentului', 'warn'); return }
    if (!file) { showToast('Atașează un fișier (PDF/JPG/PNG)', 'warn'); return }
    if (file.size > 10485760) { showToast('Fișierul depășește 10 MB', 'error'); return }
    
    setSaving(true)
    
    // 1. Upload fișier
    const storagePath = genStoragePath(employeeId, tipSelectat.cod, file.name)
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(storagePath, file, {
      contentType: file.type,
      upsert: false,
    })
    if (upErr) {
      setSaving(false)
      showToast('Eroare upload: ' + upErr.message, 'error')
      return
    }
    
    // 2. INSERT BD
    const { data: { user } } = await supabase.auth.getUser()
    const payload = {
      employee_id: Number(employeeId),
      tip_id: Number(tipId),
      numar_document: numar.trim() || null,
      emitent: emitent.trim() || null,
      data_emitere: dataEmitere || null,
      data_expirare: faraExpirare || !tipSelectat.are_expirare ? null : (dataExpirare || null),
      fara_expirare: faraExpirare || !tipSelectat.are_expirare,
      fisier_path: storagePath,
      fisier_nume: file.name,
      fisier_size_bytes: file.size,
      fisier_mime: file.type,
      observatii: observatii.trim() || null,
      uploadat_de: user?.id || null,
      activ: true,
    }
    
    const { error: insErr } = await supabase.from('hr_documente_personale').insert(payload)
    setSaving(false)
    
    if (insErr) {
      // Rollback Storage
      await supabase.storage.from(BUCKET).remove([storagePath])
      showToast('Eroare insert: ' + insErr.message, 'error')
      return
    }
    
    showToast('✓ Document salvat')
    onSaved()
  }
  
  // Grupare tipuri pe categorie pentru optgroup
  const tipuriGrupate = useMemo(() => {
    return tipuri.reduce((acc, t) => {
      (acc[t.categorie] = acc[t.categorie] || []).push(t)
      return acc
    }, {})
  }, [tipuri])
  
  return (
    <div style={{position:'fixed', inset:0, background:'rgba(0,0,0,0.92)', zIndex:1100, display:'flex', alignItems:'center', justifyContent:'center', padding:20}}>
      <div style={{...S.card, width:'100%', maxWidth:560, maxHeight:'92vh', overflow:'auto', padding:24}}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:18, paddingBottom:12, borderBottom:`1px solid ${G.border}`}}>
          <div style={{fontSize:17, fontWeight:700, color:G.text}}>📁 Adaugă Document Personal</div>
          <button onClick={onClose} style={{...S.btnS, padding:'4px 10px'}}>✕</button>
        </div>
        
        <Lbl>Angajat *</Lbl>
        <select value={employeeId} onChange={e => setEmployeeId(e.target.value)} style={{...S.input, marginBottom:12}}>
          <option value="">— alege angajat —</option>
          {employees.map(e => (
            <option key={e.id} value={e.id}>
              {e.name}{e.functie ? ` · ${e.functie}` : ''}{e.cetatenie && e.cetatenie !== 'roman' ? ` [${e.cetatenie}]` : ''}
            </option>
          ))}
        </select>
        
        <Lbl>Tip Document *</Lbl>
        <select value={tipId} onChange={e => setTipId(e.target.value)} style={{...S.input, marginBottom:12}}>
          <option value="">— alege tip —</option>
          {Object.entries(tipuriGrupate).map(([cat, lista]) => {
            const meta = CAT_META_DOCUMENTE[cat] || { emoji:'📄', label:cat }
            return (
              <optgroup key={cat} label={`${meta.emoji} ${meta.label.toUpperCase()}`}>
                {lista.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.denumire}{t.permite_multiple ? ' (multiple permise)' : ''}
                  </option>
                ))}
              </optgroup>
            )
          })}
        </select>
        
        {tipSelectat && (
          <div style={{marginBottom:12, padding:10, background:G.hr+'11', border:`1px solid ${G.hr}33`, borderRadius:8, fontSize:11, color:G.muted}}>
            <strong style={{color:G.hr}}>{tipSelectat.denumire}</strong>
            {' · '}
            {tipSelectat.are_expirare ? '⏱ are expirare' : '∞ fără expirare'}
            {' · '}
            {(tipSelectat.obligatoriu_ro || tipSelectat.obligatoriu_non_ue) ? '✅ obligatoriu' : 'opțional'}
            {empSelectat?.cetatenie && (
              <span style={{marginLeft:6}}>
                {empSelectat.cetatenie === 'non_ue' 
                  ? (tipSelectat.obligatoriu_non_ue ? '(obligatoriu pentru non_UE)' : '(opțional pentru non_UE)')
                  : (tipSelectat.obligatoriu_ro ? '(obligatoriu pentru român)' : '(opțional pentru român)')}
              </span>
            )}
          </div>
        )}
        
        <Lbl>Fișier (PDF / JPG / PNG, max 10 MB) *</Lbl>
        <input 
          type="file" 
          accept="application/pdf,image/jpeg,image/png,image/webp"
          onChange={e => setFile(e.target.files?.[0] || null)}
          style={{...S.input, padding:'7px 10px', cursor:'pointer', marginBottom:12}}
        />
        {file && (
          <div style={{marginBottom:12, fontSize:11, color:G.green}}>
            ✓ {file.name} · {(file.size / 1024).toFixed(0)} KB
          </div>
        )}
        
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:10}}>
          <div>
            <Lbl>Număr document</Lbl>
            <input value={numar} onChange={e => setNumar(e.target.value)} placeholder="ex: AB 123456" style={S.input}/>
          </div>
          <div>
            <Lbl>Emitent</Lbl>
            <input value={emitent} onChange={e => setEmitent(e.target.value)} placeholder="ex: SPCLEP, Tribunal, etc." style={S.input}/>
          </div>
        </div>
        
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:10}}>
          <div>
            <Lbl>Data emitere</Lbl>
            <input type="date" value={dataEmitere} onChange={e => setDataEmitere(e.target.value)} style={S.input}/>
          </div>
          <div>
            <Lbl>Data expirare</Lbl>
            <input 
              type="date" 
              value={dataExpirare} 
              onChange={e => setDataExpirare(e.target.value)} 
              disabled={faraExpirare || !tipSelectat?.are_expirare}
              style={{...S.input, opacity: (faraExpirare || !tipSelectat?.are_expirare) ? 0.4 : 1}}
            />
          </div>
        </div>
        
        {tipSelectat?.are_expirare && (
          <label style={{display:'flex', alignItems:'center', gap:8, marginBottom:14, cursor:'pointer', fontSize:13, color:G.text}}>
            <input type="checkbox" checked={faraExpirare} onChange={e => setFaraExpirare(e.target.checked)} style={{accentColor:G.green}}/>
            ∞ Acest document specific nu expiră
          </label>
        )}
        
        {!tipSelectat?.are_expirare && tipSelectat && (
          <div style={{marginBottom:14, fontSize:11, color:G.muted, padding:'8px 10px', background:G.bg, borderRadius:6}}>
            ℹ Acest tip nu are expirare în mod normal
          </div>
        )}
        
        <Lbl>Observații</Lbl>
        <textarea 
          value={observatii} 
          onChange={e => setObservatii(e.target.value)} 
          placeholder="Note suplimentare..." 
          style={{...S.input, minHeight:60, resize:'vertical', marginBottom:14, fontFamily:'inherit'}}
        />
        
        <div style={{display:'flex', gap:10, justifyContent:'flex-end', paddingTop:12, borderTop:`1px solid ${G.border}`}}>
          <button onClick={onClose} style={S.btnS}>Anulează</button>
          <button onClick={save} disabled={saving || !employeeId || !tipId || !file} 
            style={{...S.btnP, opacity: (saving || !employeeId || !tipId || !file) ? 0.5 : 1}}>
            {saving ? '⏳ Se uploadează...' : '✓ Salvează'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── MODAL EDIT DOCUMENT ────────────────────────────────────────────────────

function ModalEditDocument({ document: doc, tipuri, employees, onClose, onSaved, showToast }) {
  const [numar, setNumar] = useState(doc.numar_document || '')
  const [emitent, setEmitent] = useState(doc.emitent || '')
  const [dataEmitere, setDataEmitere] = useState(doc.data_emitere || '')
  const [dataExpirare, setDataExpirare] = useState(doc.data_expirare || '')
  const [faraExpirare, setFaraExpirare] = useState(doc.fara_expirare || false)
  const [observatii, setObservatii] = useState(doc.observatii || '')
  const [activ, setActiv] = useState(doc.activ !== false)
  const [saving, setSaving] = useState(false)
  
  const tipSelectat = tipuri.find(t => t.id === doc.tip_id)
  
  const save = async () => {
    setSaving(true)
    const payload = {
      numar_document: numar.trim() || null,
      emitent: emitent.trim() || null,
      data_emitere: dataEmitere || null,
      data_expirare: faraExpirare || !tipSelectat?.are_expirare ? null : (dataExpirare || null),
      fara_expirare: faraExpirare || !tipSelectat?.are_expirare,
      observatii: observatii.trim() || null,
      activ: activ,
    }
    const { error } = await supabase.from('hr_documente_personale').update(payload).eq('id', doc.id)
    setSaving(false)
    if (error) { showToast('Eroare: ' + error.message, 'error'); return }
    showToast('✓ Document actualizat')
    onSaved()
  }
  
  return (
    <div style={{position:'fixed', inset:0, background:'rgba(0,0,0,0.92)', zIndex:1100, display:'flex', alignItems:'center', justifyContent:'center', padding:20}}>
      <div style={{...S.card, width:'100%', maxWidth:540, maxHeight:'92vh', overflow:'auto', padding:24}}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:18, paddingBottom:12, borderBottom:`1px solid ${G.border}`}}>
          <div style={{fontSize:17, fontWeight:700, color:G.text}}>✏️ Editează Document</div>
          <button onClick={onClose} style={{...S.btnS, padding:'4px 10px'}}>✕</button>
        </div>
        
        <div style={{padding:10, background:G.bg, borderRadius:8, marginBottom:14, fontSize:12}}>
          <div><strong>{doc.employee_name}</strong> · {doc.functie || '—'}</div>
          <div style={{color:G.muted, marginTop:4}}>{doc.tip_denumire}</div>
          <div style={{color:G.dim, marginTop:6, fontSize:11}}>📎 {doc.fisier_nume}</div>
          <div style={{color:G.dim, fontSize:10, fontFamily:'monospace'}}>{doc.fisier_path}</div>
        </div>
        
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:10}}>
          <div>
            <Lbl>Număr document</Lbl>
            <input value={numar} onChange={e => setNumar(e.target.value)} style={S.input}/>
          </div>
          <div>
            <Lbl>Emitent</Lbl>
            <input value={emitent} onChange={e => setEmitent(e.target.value)} style={S.input}/>
          </div>
        </div>
        
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:10}}>
          <div>
            <Lbl>Data emitere</Lbl>
            <input type="date" value={dataEmitere} onChange={e => setDataEmitere(e.target.value)} style={S.input}/>
          </div>
          <div>
            <Lbl>Data expirare</Lbl>
            <input 
              type="date" 
              value={dataExpirare} 
              onChange={e => setDataExpirare(e.target.value)} 
              disabled={faraExpirare || !tipSelectat?.are_expirare}
              style={{...S.input, opacity: (faraExpirare || !tipSelectat?.are_expirare) ? 0.4 : 1}}
            />
          </div>
        </div>
        
        {tipSelectat?.are_expirare && (
          <label style={{display:'flex', alignItems:'center', gap:8, marginBottom:10, cursor:'pointer', fontSize:13, color:G.text}}>
            <input type="checkbox" checked={faraExpirare} onChange={e => setFaraExpirare(e.target.checked)} style={{accentColor:G.green}}/>
            ∞ Acest document specific nu expiră
          </label>
        )}
        
        <label style={{display:'flex', alignItems:'center', gap:8, marginBottom:14, cursor:'pointer', fontSize:13, color:G.text, padding:'8px 10px', background: activ ? G.greenDim : G.redDim, border:`1px solid ${activ ? G.green : G.red}55`, borderRadius:6}}>
          <input type="checkbox" checked={activ} onChange={e => setActiv(e.target.checked)} style={{accentColor: activ ? G.green : G.red}}/>
          <span style={{color: activ ? G.green : G.red, fontWeight:600}}>
            {activ ? '✓ Document ACTIV (curent)' : '✗ Document INACTIV (istoric / arhivat)'}
          </span>
        </label>
        
        <Lbl>Observații</Lbl>
        <textarea 
          value={observatii} 
          onChange={e => setObservatii(e.target.value)} 
          style={{...S.input, minHeight:60, resize:'vertical', marginBottom:14, fontFamily:'inherit'}}
        />
        
        <div style={{display:'flex', gap:10, justifyContent:'flex-end', paddingTop:12, borderTop:`1px solid ${G.border}`}}>
          <button onClick={onClose} style={S.btnS}>Anulează</button>
          <button onClick={save} disabled={saving} style={{...S.btnP, opacity: saving ? 0.5 : 1}}>
            {saving ? '⏳' : '✓ Salvează'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── MODAL GESTIONARE TIPURI ────────────────────────────────────────────────

function ModalGestionareTipuri({ tipuri, onClose, onReload, showToast }) {
  const [edit, setEdit] = useState(null)  // tip object
  const [showAdd, setShowAdd] = useState(false)
  
  const tipuriGrupate = useMemo(() => {
    return tipuri.reduce((acc, t) => {
      (acc[t.categorie] = acc[t.categorie] || []).push(t)
      return acc
    }, {})
  }, [tipuri])
  
  const handleToggleActiv = async (t) => {
    const { error } = await supabase.from('hr_documente_personale_tipuri').update({ activ: !t.activ }).eq('id', t.id)
    if (error) showToast('Eroare: ' + error.message, 'error')
    else { showToast(t.activ ? '✓ Dezactivat' : '✓ Activat'); onReload() }
  }
  
  return (
    <div style={{position:'fixed', inset:0, background:'rgba(0,0,0,0.92)', zIndex:1100, display:'flex', alignItems:'center', justifyContent:'center', padding:20}}>
      <div style={{...S.card, width:'100%', maxWidth:720, maxHeight:'92vh', overflow:'auto', padding:24}}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:18, paddingBottom:12, borderBottom:`1px solid ${G.border}`}}>
          <div style={{fontSize:17, fontWeight:700, color:G.text}}>⚙️ Gestionare Tipuri Documente ({tipuri.length})</div>
          <button onClick={onClose} style={{...S.btnS, padding:'4px 10px'}}>✕</button>
        </div>
        
        <div style={{marginBottom:14}}>
          <button onClick={() => { setEdit({ cod:'', denumire:'', categorie:'identitate', are_expirare:false, obligatoriu_ro:false, obligatoriu_non_ue:false, permite_multiple:false, ordine: 99 }); setShowAdd(true) }} style={S.btnP}>
            ➕ Adaugă Tip Nou
          </button>
        </div>
        
        {Object.entries(tipuriGrupate).map(([cat, lista]) => {
          const meta = CAT_META_DOCUMENTE[cat] || { emoji:'📄', label:cat }
          return (
            <div key={cat} style={{marginBottom:18}}>
              <div style={{fontSize:13, fontWeight:700, color:G.hr, marginBottom:8, display:'flex', alignItems:'center', gap:6}}>
                <span style={{fontSize:16}}>{meta.emoji}</span> {meta.label} ({lista.length})
              </div>
              <div style={{background:G.bg, borderRadius:8, overflow:'hidden', border:`1px solid ${G.border}`}}>
                {lista.map(t => (
                  <div key={t.id} style={{padding:'10px 14px', borderBottom:`1px solid ${G.border2}`, display:'flex', justifyContent:'space-between', alignItems:'center', opacity: t.activ ? 1 : 0.4}}>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:600, fontSize:13, color:G.text}}>{t.denumire}</div>
                      <div style={{fontSize:10, color:G.muted, fontFamily:'monospace', marginTop:2}}>
                        {t.cod}
                        {t.are_expirare && <span style={{marginLeft:8, color:G.yellow}}>⏱ expiră</span>}
                        {t.obligatoriu_ro && <span style={{marginLeft:8, color:G.green}}>🇷🇴 obligatoriu</span>}
                        {t.obligatoriu_non_ue && <span style={{marginLeft:8, color:G.blue}}>🌍 obligatoriu non_UE</span>}
                        {t.permite_multiple && <span style={{marginLeft:8, color:G.purple}}>≡ multiple</span>}
                      </div>
                    </div>
                    <div style={{display:'flex', gap:6}}>
                      <button onClick={() => setEdit(t)} style={{padding:'4px 10px', background:G.blue+'22', color:G.blue, border:`1px solid ${G.blue}55`, borderRadius:4, fontSize:11, cursor:'pointer'}}>✏️</button>
                      <button onClick={() => handleToggleActiv(t)} style={{padding:'4px 10px', background:t.activ ? G.red+'22' : G.green+'22', color:t.activ ? G.red : G.green, border:`1px solid ${t.activ ? G.red : G.green}55`, borderRadius:4, fontSize:11, cursor:'pointer'}}>
                        {t.activ ? '⏸ Dezactivează' : '▶ Activează'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
        
        <div style={{display:'flex', gap:10, justifyContent:'flex-end', paddingTop:12, borderTop:`1px solid ${G.border}`, marginTop:12}}>
          <button onClick={onClose} style={S.btnS}>Închide</button>
        </div>
      </div>
      
      {edit && (
        <ModalEditTip 
          tip={edit} 
          isNew={showAdd} 
          onClose={() => { setEdit(null); setShowAdd(false) }} 
          onSaved={() => { onReload(); setEdit(null); setShowAdd(false) }} 
          showToast={showToast} 
        />
      )}
    </div>
  )
}

function ModalEditTip({ tip, isNew, onClose, onSaved, showToast }) {
  const [cod, setCod] = useState(tip.cod)
  const [denumire, setDenumire] = useState(tip.denumire)
  const [categorie, setCategorie] = useState(tip.categorie)
  const [areExpirare, setAreExpirare] = useState(tip.are_expirare)
  const [oblRo, setOblRo] = useState(tip.obligatoriu_ro)
  const [oblNonUe, setOblNonUe] = useState(tip.obligatoriu_non_ue)
  const [permiteMultiple, setPermiteMultiple] = useState(tip.permite_multiple)
  const [ordine, setOrdine] = useState(tip.ordine)
  const [saving, setSaving] = useState(false)
  
  const save = async () => {
    if (!cod.trim()) { showToast('Codul e obligatoriu', 'warn'); return }
    if (!denumire.trim()) { showToast('Denumirea e obligatorie', 'warn'); return }
    if (!/^[a-z0-9_]+$/.test(cod)) { showToast('Codul: doar lowercase + underscore (a-z, 0-9, _)', 'warn'); return }
    
    setSaving(true)
    const payload = {
      cod: cod.trim(),
      denumire: denumire.trim(),
      categorie,
      are_expirare: areExpirare,
      obligatoriu_ro: oblRo,
      obligatoriu_non_ue: oblNonUe,
      permite_multiple: permiteMultiple,
      ordine: Number(ordine) || 99,
    }
    
    const op = isNew 
      ? supabase.from('hr_documente_personale_tipuri').insert(payload)
      : supabase.from('hr_documente_personale_tipuri').update(payload).eq('id', tip.id)
    
    const { error } = await op
    setSaving(false)
    if (error) { showToast('Eroare: ' + error.message, 'error'); return }
    showToast(isNew ? '✓ Tip adăugat' : '✓ Tip actualizat')
    onSaved()
  }
  
  return (
    <div style={{position:'fixed', inset:0, background:'rgba(0,0,0,0.94)', zIndex:1200, display:'flex', alignItems:'center', justifyContent:'center', padding:20}}>
      <div style={{...S.card, width:'100%', maxWidth:480, maxHeight:'92vh', overflow:'auto', padding:24}}>
        <div style={{fontSize:16, fontWeight:700, color:G.text, marginBottom:16, paddingBottom:12, borderBottom:`1px solid ${G.border}`}}>
          {isNew ? '➕ Tip Nou' : '✏️ Editează Tip'}
        </div>
        
        <Lbl>Cod (lowercase, snake_case) *</Lbl>
        <input value={cod} onChange={e => setCod(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))} 
          disabled={!isNew} placeholder="ex: cazier_judiciar" style={{...S.input, marginBottom:10, fontFamily:'monospace'}}/>
        
        <Lbl>Denumire *</Lbl>
        <input value={denumire} onChange={e => setDenumire(e.target.value)} 
          placeholder="ex: Cazier judiciar" style={{...S.input, marginBottom:10}}/>
        
        <Lbl>Categorie</Lbl>
        <select value={categorie} onChange={e => setCategorie(e.target.value)} style={{...S.input, marginBottom:10}}>
          {Object.entries(CAT_META_DOCUMENTE).map(([k, m]) => (
            <option key={k} value={k}>{m.emoji} {m.label}</option>
          ))}
        </select>
        
        <Lbl>Ordine afișare</Lbl>
        <input type="number" value={ordine} onChange={e => setOrdine(e.target.value)} style={{...S.input, marginBottom:12}}/>
        
        <div style={{display:'flex', flexDirection:'column', gap:8, padding:10, background:G.bg, borderRadius:8, marginBottom:14}}>
          <label style={{display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:13, color:G.text}}>
            <input type="checkbox" checked={areExpirare} onChange={e => setAreExpirare(e.target.checked)} style={{accentColor:G.yellow}}/>
            ⏱ Are dată de expirare
          </label>
          <label style={{display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:13, color:G.text}}>
            <input type="checkbox" checked={oblRo} onChange={e => setOblRo(e.target.checked)} style={{accentColor:G.green}}/>
            🇷🇴 Obligatoriu pentru cetățeni români
          </label>
          <label style={{display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:13, color:G.text}}>
            <input type="checkbox" checked={oblNonUe} onChange={e => setOblNonUe(e.target.checked)} style={{accentColor:G.blue}}/>
            🌍 Obligatoriu pentru cetățeni non_UE
          </label>
          <label style={{display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:13, color:G.text}}>
            <input type="checkbox" checked={permiteMultiple} onChange={e => setPermiteMultiple(e.target.checked)} style={{accentColor:G.purple}}/>
            ≡ Permite multiple instanțe per angajat (ex: certificat naștere copil)
          </label>
        </div>
        
        <div style={{display:'flex', gap:10, justifyContent:'flex-end', paddingTop:12, borderTop:`1px solid ${G.border}`}}>
          <button onClick={onClose} style={S.btnS}>Anulează</button>
          <button onClick={save} disabled={saving} style={{...S.btnP, opacity: saving ? 0.5 : 1}}>
            {saving ? '⏳' : '✓ Salvează'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── COMPONENT PRINCIPAL ────────────────────────────────────────────────────

export default function TabDocumentePersonale({ employees, canAccessPersonal, showToast }) {
  const [documente, setDocumente] = useState([])
  const [tipuri, setTipuri] = useState([])
  const [loading, setLoading] = useState(false)
  const [showInactive, setShowInactive] = useState(false)
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('Toate')
  const [statusFilter, setStatusFilter] = useState('toate')
  const [sortBy, setSortBy] = useState('nume')
  const [showAdd, setShowAdd] = useState(false)
  const [editDoc, setEditDoc] = useState(null)
  const [showGestTipuri, setShowGestTipuri] = useState(false)
  const [showBulkImport, setShowBulkImport] = useState(false)
  const [viewMode, setViewMode] = useState('flat')  // 'flat' | 'grouped'
  const [expandedEmp, setExpandedEmp] = useState(new Set())
  
  const loadAll = async () => {
    setLoading(true)
    const [docsRes, tipuriRes] = await Promise.all([
      // Listing — folosim tabelul direct pentru a vedea și inactive (view filtrează activ=true)
      supabase.from('hr_documente_personale')
        .select('*, tip:hr_documente_personale_tipuri(cod, denumire, categorie, are_expirare), employee:employees(name, functie, departament_hr, cetatenie, cetatenie_secundara)')
        .is('deleted_at', null)
        .order('uploadat_la', { ascending: false }),
      supabase.from('hr_documente_personale_tipuri').select('*').order('ordine'),
    ])
    
    // Flatten join + calc status pe client (consistent cu view-ul)
    const docs = (docsRes.data || []).map(d => {
      const tip = d.tip || {}
      const emp = d.employee || {}
      const today = new Date()
      const exp = d.data_expirare ? new Date(d.data_expirare) : null
      let status = 'fara_data'
      let zile = null
      
      if (d.fara_expirare || !tip.are_expirare) {
        status = 'fara_exp'
      } else if (!exp) {
        status = 'fara_data'
      } else {
        const diffMs = exp - today
        zile = Math.floor(diffMs / (1000 * 60 * 60 * 24))
        if (zile < 0) status = 'expirat'
        else if (zile < 30) status = 'expira_30z'
        else if (zile < 60) status = 'expira_60z'
        else status = 'valid'
      }
      
      return {
        ...d,
        employee_name: emp.name || '—',
        functie: emp.functie || null,
        departament_hr: emp.departament_hr || null,
        cetatenie: emp.cetatenie || null,
        tip_cod: tip.cod || null,
        tip_denumire: tip.denumire || '—',
        categorie: tip.categorie || 'altele',
        tip_are_expirare: tip.are_expirare || false,
        status,
        zile_pana_expirare: zile,
      }
    })
    
    setDocumente(docs)
    setTipuri(tipuriRes.data || [])
    setLoading(false)
  }
  
  useEffect(() => { if (canAccessPersonal) loadAll() }, [canAccessPersonal])
  
  // Stats KPI (doar pe documentele active)
  const stats = useMemo(() => {
    const docsActive = documente.filter(d => d.activ !== false)
    const s = { total: docsActive.length, valide: 0, expira_60z: 0, expira_30z: 0, expirate: 0, inactive: documente.length - docsActive.length }
    docsActive.forEach(d => {
      if (d.status === 'valid' || d.status === 'fara_exp') s.valide += 1
      if (d.status === 'expira_60z') s.expira_60z += 1
      if (d.status === 'expira_30z') s.expira_30z += 1
      if (d.status === 'expirat') s.expirate += 1
    })
    return s
  }, [documente])
  
  // Counts per categorie (pentru chip-uri filtru)
  const catCounts = useMemo(() => {
    const c = {}
    documente.filter(d => showInactive || d.activ !== false).forEach(d => {
      c[d.categorie] = (c[d.categorie] || 0) + 1
    })
    return c
  }, [documente, showInactive])
  
  // Filtered
  const filtered = useMemo(() => {
    let r = documente.filter(d => {
      if (!showInactive && d.activ === false) return false
      if (catFilter !== 'Toate' && d.categorie !== catFilter) return false
      if (statusFilter !== 'toate' && d.status !== statusFilter) return false
      if (search.trim()) {
        const s = search.toLowerCase()
        return d.employee_name?.toLowerCase().includes(s) ||
               d.tip_denumire?.toLowerCase().includes(s) ||
               (d.numar_document || '').toLowerCase().includes(s) ||
               (d.emitent || '').toLowerCase().includes(s)
      }
      return true
    })
    if (sortBy === 'nume') r.sort((a,b) => (a.employee_name || '').localeCompare(b.employee_name || ''))
    else if (sortBy === 'tip') r.sort((a,b) => (a.tip_denumire || '').localeCompare(b.tip_denumire || ''))
    else if (sortBy === 'expirare') r.sort((a,b) => (a.data_expirare || '9999').localeCompare(b.data_expirare || '9999'))
    else if (sortBy === 'status') {
      const order = { expirat: 0, expira_30z: 1, expira_60z: 2, fara_data: 3, valid: 4, fara_exp: 5 }
      r.sort((a,b) => (order[a.status] ?? 99) - (order[b.status] ?? 99))
    }
    return r
  }, [documente, catFilter, statusFilter, search, sortBy, showInactive])
  
  const handleDelete = async (doc) => {
    if (!confirm(`Ștergi documentul "${doc.tip_denumire}" pentru ${doc.employee_name}?\n\nVa fi mutat în Coșul HR și șters definitiv automat după perioada de retenție (default 30 zile). Poate fi restaurat oricând până atunci.`)) return
    
    const { data: u } = await supabase.auth.getUser()
    const { error } = await supabase.from('hr_documente_personale')
      .update({ deleted_at: new Date().toISOString(), deleted_by: u?.user?.id })
      .eq('id', doc.id)
    if (error) showToast('Eroare: ' + error.message, 'error')
    else { showToast(`🗑 Document mutat în Coș: ${doc.tip_denumire}`); loadAll() }
  }
  
  // ─── Grupare per persoană (pentru viewMode='grouped') ─────
  
  const groupedByEmployee = useMemo(() => {
    if (viewMode !== 'grouped') return []
    
    const map = new Map()
    
    // Init pentru TOȚI angajații activi (chiar fără documente — ca să vedem lipsa)
    for (const emp of (employees || []).filter(e => e.active !== false)) {
      map.set(emp.id, {
        employee_id: emp.id,
        employee_name: emp.name,
        functie: emp.functie || null,
        departament_hr: emp.departament_hr || null,
        cetatenie: emp.cetatenie || 'roman',
        docs: [],
        counts: { total: 0, valide: 0, expira: 0, expirate: 0, fara_data: 0 },
        tipuri_present: new Set(),
      })
    }
    
    // Adaug documentele filtrate
    for (const doc of filtered) {
      const grp = map.get(doc.employee_id)
      if (!grp) continue
      grp.docs.push(doc)
      grp.counts.total += 1
      if (doc.status === 'valid' || doc.status === 'fara_exp') grp.counts.valide += 1
      else if (doc.status === 'expira_30z' || doc.status === 'expira_60z') grp.counts.expira += 1
      else if (doc.status === 'expirat') grp.counts.expirate += 1
      else if (doc.status === 'fara_data') grp.counts.fara_data += 1
      grp.tipuri_present.add(doc.tip_id)
    }
    
    // Calcul missing obligatorii per persoană (depinde de cetățenie)
    const obligTipuri = tipuri.filter(t => t.activ && !t.permite_multiple)
    for (const grp of map.values()) {
      const isNonUe = grp.cetatenie === 'non_ue'
      grp.missing = obligTipuri.filter(t => 
        ((isNonUe && t.obligatoriu_non_ue) || (!isNonUe && t.obligatoriu_ro)) &&
        !grp.tipuri_present.has(t.id)
      )
      grp.missing_count = grp.missing.length
    }
    
    // Filtru: dacă există search/cat/status activ, arătăm DOAR persoanele care au documente în filtru
    const hasActiveFilter = search.trim() !== '' || catFilter !== 'Toate' || statusFilter !== 'toate'
    
    return Array.from(map.values())
      .filter(g => !hasActiveFilter || g.docs.length > 0)
      .sort((a, b) => {
        // Cei cu missing mai multe primii, apoi cei cu expirate, apoi alfabetic
        if (b.missing_count !== a.missing_count) return b.missing_count - a.missing_count
        if (b.counts.expirate !== a.counts.expirate) return b.counts.expirate - a.counts.expirate
        return (a.employee_name || '').localeCompare(b.employee_name || '')
      })
  }, [viewMode, filtered, employees, tipuri, search, catFilter, statusFilter])
  
  const toggleExpanded = (empId) => {
    setExpandedEmp(prev => {
      const next = new Set(prev)
      if (next.has(empId)) next.delete(empId)
      else next.add(empId)
      return next
    })
  }
  
  // ─── Gating ─────
  
  if (!canAccessPersonal) {
    return (
      <div style={{...S.card, padding:50, textAlign:'center'}}>
        <div style={{fontSize:48, marginBottom:14}}>🔒</div>
        <div style={{fontSize:18, fontWeight:700, color:G.text, marginBottom:8}}>Acces restricționat</div>
        <div style={{fontSize:13, color:G.muted, maxWidth:500, margin:'0 auto'}}>
          Modulul Documente Personale conține date confidențiale (CNP, acte de identitate, etc.).
          <br/>Acces permis doar pentru <strong>Razvan Trusu (owner)</strong>, <strong>Marilena</strong> și <strong>Natalia (HR)</strong>.
        </div>
      </div>
    )
  }
  
  if (loading) {
    return <div style={{padding:60, textAlign:'center', color:G.muted}}>⏳ Se încarcă documentele...</div>
  }
  
  // ─── Render ─────
  
  return (
    <div>
      {/* KPI Bar */}
      <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(170px, 1fr))', gap:12, marginBottom:14}}>
        <KPICard icon="📁" label="Documente active" value={stats.total} color={G.text} />
        <KPICard icon="✓" label="Valide" value={stats.valide} color={G.green} bg={G.greenDim} />
        <KPICard icon="⚠" label="Expiră 60z" value={stats.expira_60z + stats.expira_30z} color={G.yellow} bg={G.yellowDim} />
        <KPICard icon="🚨" label="Expirate" value={stats.expirate} color={G.red} bg={G.redDim} />
        {stats.inactive > 0 && (
          <KPICard icon="📦" label="În istoric" value={stats.inactive} color={G.dim} />
        )}
      </div>
      
      {/* Action Bar */}
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14, gap:10, flexWrap:'wrap'}}>
        <div style={{display:'flex', gap:8, alignItems:'center', flexWrap:'wrap'}}>
          <button onClick={() => setShowAdd(true)} style={{...S.btnP, fontSize:14, padding:'10px 18px'}}>
            ➕ Adaugă Document
          </button>
          <button onClick={() => setShowBulkImport(true)} 
            style={{...S.btnS, background:G.purple+'22', color:G.purple, border:`1px solid ${G.purple}55`, fontWeight:600}}>
            📥 Bulk Import
          </button>
          <button onClick={() => setShowGestTipuri(true)} style={S.btnS}>
            ⚙️ Tipuri ({tipuri.filter(t => t.activ).length})
          </button>
        </div>
        <div style={{display:'flex', gap:14, alignItems:'center', flexWrap:'wrap'}}>
          {/* View mode toggle */}
          <div style={{display:'inline-flex', background:G.bg, border:`1px solid ${G.border}`, borderRadius:8, overflow:'hidden'}}>
            <button onClick={() => setViewMode('flat')} 
              style={{padding:'7px 12px', background: viewMode === 'flat' ? G.hr+'22' : 'transparent', color: viewMode === 'flat' ? G.hr : G.muted, border:'none', cursor:'pointer', fontSize:12, fontWeight:600, borderRight:`1px solid ${G.border}`}}>
              📋 Listă
            </button>
            <button onClick={() => setViewMode('grouped')} 
              style={{padding:'7px 12px', background: viewMode === 'grouped' ? G.hr+'22' : 'transparent', color: viewMode === 'grouped' ? G.hr : G.muted, border:'none', cursor:'pointer', fontSize:12, fontWeight:600}}>
              🗂 Pe persoană
            </button>
          </div>
          <label style={{display:'flex', alignItems:'center', gap:6, fontSize:12, color:G.muted, cursor:'pointer'}}>
            <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} style={{accentColor:G.purple}}/>
            Arată și inactive ({stats.inactive})
          </label>
        </div>
      </div>
      
      {/* Chip-uri filtru pe categorie */}
      {(() => {
        const cats = Object.keys(catCounts).sort((a,b) => catCounts[b] - catCounts[a])
        const totalCount = Object.values(catCounts).reduce((s, n) => s + n, 0)
        if (totalCount === 0) return null
        return (
          <div style={{marginBottom:14, padding:14, background:G.bg, borderRadius:10, border:`1px solid ${G.border}`}}>
            <div style={{fontSize:11, color:G.muted, fontWeight:700, marginBottom:12, letterSpacing:.5}}>🏷 FILTREAZĂ PE CATEGORIE</div>
            <div style={{display:'flex', flexWrap:'wrap', gap:10}}>
              <button onClick={() => setCatFilter('Toate')} style={{
                padding:'10px 20px', fontSize:14, fontWeight:800, borderRadius:24, cursor:'pointer',
                border:`2px solid ${catFilter === 'Toate' ? G.hr : G.border2}`,
                background:catFilter === 'Toate' ? G.hr + '22' : G.surface,
                color:catFilter === 'Toate' ? G.hr : G.text,
                transition:'all 0.15s', display:'inline-flex', alignItems:'center', gap:8
              }}>
                <span>Toate</span>
                <span style={{
                  padding:'2px 9px', borderRadius:14, fontSize:13, fontWeight:800,
                  background:catFilter === 'Toate' ? G.hr : G.bg,
                  color:catFilter === 'Toate' ? '#fff' : G.muted,
                  minWidth:24, textAlign:'center'
                }}>{totalCount}</span>
              </button>
              {cats.map(cat => {
                const meta = CAT_META_DOCUMENTE[cat] || { emoji:'📄', label:cat }
                const active = catFilter === cat
                const count = catCounts[cat]
                return (
                  <button key={cat} onClick={() => setCatFilter(active ? 'Toate' : cat)} style={{
                    padding:'10px 20px', fontSize:14, fontWeight:800, borderRadius:24, cursor:'pointer',
                    border:`2px solid ${active ? G.hr : G.border2}`,
                    background:active ? G.hr + '22' : G.surface,
                    color:active ? G.hr : G.text,
                    transition:'all 0.15s', display:'inline-flex', alignItems:'center', gap:8
                  }}>
                    <span style={{fontSize:18}}>{meta.emoji}</span>
                    <span>{meta.label}</span>
                    <span style={{
                      padding:'2px 9px', borderRadius:14, fontSize:13, fontWeight:800,
                      background:active ? G.hr : G.bg,
                      color:active ? '#fff' : G.muted,
                      minWidth:24, textAlign:'center'
                    }}>{count}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )
      })()}
      
      {/* Search + sort + status */}
      <div style={{display:'flex', gap:10, marginBottom:14, flexWrap:'wrap', alignItems:'center'}}>
        <input type="text" value={search} onChange={e => setSearch(e.target.value)} 
          placeholder="🔍 Caută după nume angajat, tip, număr, emitent..." 
          style={{...S.input, flex:1, minWidth:280}}/>
        <select value={sortBy} onChange={e => setSortBy(e.target.value)} 
          style={{...S.input, width:'auto', minWidth:170}}>
          <option value="nume">🔤 Sortare: Nume A-Z</option>
          <option value="tip">📋 Sortare: Tip A-Z</option>
          <option value="expirare">📅 Sortare: Data expirare</option>
          <option value="status">🚦 Sortare: Status (expirate sus)</option>
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} 
          style={{...S.input, width:'auto', minWidth:160}}>
          <option value="toate">Toate statusurile</option>
          <option value="valid">✓ Valide</option>
          <option value="expira_60z">Expiră 60z</option>
          <option value="expira_30z">⚠ Expiră 30z</option>
          <option value="expirat">🚨 EXPIRATE</option>
          <option value="fara_exp">∞ Fără expirare</option>
          <option value="fara_data">— Fără dată —</option>
        </select>
      </div>
      
      {/* ─── GROUPED VIEW (per persoană) ─── */}
      {viewMode === 'grouped' && (
        <div style={{display:'flex', flexDirection:'column', gap:10}}>
          {groupedByEmployee.map(grp => {
            const isExpanded = expandedEmp.has(grp.employee_id)
            const hasIssues = grp.missing_count > 0 || grp.counts.expirate > 0 || grp.counts.expira > 0
            return (
              <div key={grp.employee_id} style={{
                ...S.card,
                borderColor: grp.missing_count > 0 ? G.red+'55' : (grp.counts.expirate > 0 ? G.red+'33' : (grp.counts.expira > 0 ? G.yellow+'33' : G.border)),
                overflow:'hidden'
              }}>
                {/* Header */}
                <div onClick={() => toggleExpanded(grp.employee_id)} style={{
                  padding:'14px 18px', cursor:'pointer', display:'flex', alignItems:'center', gap:14, flexWrap:'wrap',
                  background: isExpanded ? G.bg : 'transparent',
                  borderBottom: isExpanded ? `1px solid ${G.border}` : 'none',
                }}>
                  {/* Expand icon */}
                  <span style={{fontSize:14, color:G.muted, width:14, display:'inline-block'}}>
                    {isExpanded ? '▼' : '▶'}
                  </span>
                  
                  {/* Identitate */}
                  <div style={{flex:'1 1 220px', minWidth:0}}>
                    <div style={{fontSize:14, fontWeight:700, color:G.text}}>
                      {grp.employee_name}
                      {grp.cetatenie && grp.cetatenie !== 'roman' && (
                        <span style={{marginLeft:8, fontSize:10, padding:'2px 7px', background:G.blue+'22', color:G.blue, borderRadius:3, fontWeight:600, textTransform:'uppercase'}}>
                          {grp.cetatenie}
                        </span>
                      )}
                    </div>
                    <div style={{fontSize:11, color:G.muted, marginTop:2}}>
                      {grp.functie || '—'}{grp.departament_hr ? ` · ${grp.departament_hr}` : ''}
                    </div>
                  </div>
                  
                  {/* Stats badges */}
                  <div style={{display:'flex', gap:6, flexWrap:'wrap', alignItems:'center'}}>
                    <span style={{padding:'4px 10px', fontSize:11, fontWeight:700, background:G.surface, border:`1px solid ${G.border}`, borderRadius:4, color:G.text}} title="Total documente">
                      📁 {grp.counts.total}
                    </span>
                    {grp.counts.valide > 0 && (
                      <span style={{padding:'4px 10px', fontSize:11, fontWeight:700, background:G.greenDim, border:`1px solid ${G.green}55`, borderRadius:4, color:G.green}} title="Valide">
                        ✓ {grp.counts.valide}
                      </span>
                    )}
                    {grp.counts.expira > 0 && (
                      <span style={{padding:'4px 10px', fontSize:11, fontWeight:700, background:G.yellowDim, border:`1px solid ${G.yellow}55`, borderRadius:4, color:G.yellow}} title="Expiră în curând">
                        ⚠ {grp.counts.expira}
                      </span>
                    )}
                    {grp.counts.expirate > 0 && (
                      <span style={{padding:'4px 10px', fontSize:11, fontWeight:700, background:G.redDim, border:`1px solid ${G.red}55`, borderRadius:4, color:G.red}} title="Expirate">
                        🚨 {grp.counts.expirate}
                      </span>
                    )}
                    {grp.missing_count > 0 ? (
                      <span style={{padding:'4px 10px', fontSize:11, fontWeight:700, background:G.red, color:'#fff', borderRadius:4}} title={`Documente obligatorii lipsă: ${grp.missing.map(t => t.denumire).join(', ')}`}>
                        ⚠ {grp.missing_count} lipsă obligatorii
                      </span>
                    ) : grp.counts.total > 0 ? (
                      <span style={{padding:'4px 10px', fontSize:11, fontWeight:700, background:G.green+'33', color:G.green, borderRadius:4}}>
                        ✅ Dosar complet
                      </span>
                    ) : (
                      <span style={{padding:'4px 10px', fontSize:11, fontWeight:700, background:G.dim+'33', color:G.dim, borderRadius:4}}>
                        — fără documente —
                      </span>
                    )}
                  </div>
                </div>
                
                {/* Body (când expanded) */}
                {isExpanded && (
                  <div style={{padding:'12px 18px 16px'}}>
                    {/* Documente lipsă obligatorii */}
                    {grp.missing.length > 0 && (
                      <div style={{marginBottom:14, padding:'10px 14px', background:G.redDim+'66', border:`1px solid ${G.red}55`, borderRadius:8}}>
                        <div style={{fontSize:11, fontWeight:700, color:G.red, marginBottom:8, textTransform:'uppercase', letterSpacing:.4}}>
                          ⚠ Documente obligatorii lipsă ({grp.missing.length})
                        </div>
                        <div style={{display:'flex', flexWrap:'wrap', gap:6}}>
                          {grp.missing.map(t => {
                            const meta = CAT_META_DOCUMENTE[t.categorie] || { emoji:'📄' }
                            return (
                              <span key={t.id} style={{padding:'5px 10px', fontSize:11, background:G.surface, border:`1px solid ${G.red}33`, borderRadius:4, color:G.text, display:'inline-flex', alignItems:'center', gap:5}}>
                                <span>{meta.emoji}</span>
                                <span>{t.denumire}</span>
                              </span>
                            )
                          })}
                        </div>
                      </div>
                    )}
                    
                    {/* Mini-tabel documente */}
                    {grp.docs.length > 0 ? (
                      <div style={{overflowX:'auto'}}>
                        <table style={{width:'100%', borderCollapse:'collapse', fontSize:12}}>
                          <thead style={{background:G.bg}}>
                            <tr>
                              <th style={{...thStyle, padding:'6px 10px'}}>Tip</th>
                              <th style={{...thStyle, padding:'6px 10px'}}>Număr</th>
                              <th style={{...thStyle, padding:'6px 10px'}}>Emis</th>
                              <th style={{...thStyle, padding:'6px 10px'}}>Expiră</th>
                              <th style={{...thStyle, padding:'6px 10px'}}>Status</th>
                              <th style={{...thStyle, padding:'6px 10px', textAlign:'right'}}>Acțiuni</th>
                            </tr>
                          </thead>
                          <tbody>
                            {grp.docs.map(d => {
                              const meta = CAT_META_DOCUMENTE[d.categorie] || { emoji:'📄' }
                              return (
                                <tr key={d.id} style={{
                                  borderTop:`1px solid ${G.border2}`,
                                  opacity: d.activ === false ? 0.55 : 1,
                                }}>
                                  <td style={{padding:'7px 10px'}}>
                                    <span style={{marginRight:5}}>{meta.emoji}</span>
                                    <span style={{fontWeight:600}}>{d.tip_denumire}</span>
                                  </td>
                                  <td style={{padding:'7px 10px', fontFamily:'monospace', fontSize:11, color:G.muted}}>
                                    {d.numar_document || '—'}
                                  </td>
                                  <td style={{padding:'7px 10px', fontSize:11}}>
                                    {d.data_emitere ? new Date(d.data_emitere).toLocaleDateString('ro-RO') : '—'}
                                  </td>
                                  <td style={{padding:'7px 10px', fontSize:11}}>
                                    {d.fara_expirare || !d.tip_are_expirare ? '∞' : (d.data_expirare ? new Date(d.data_expirare).toLocaleDateString('ro-RO') : '—')}
                                  </td>
                                  <td style={{padding:'7px 10px'}}>{statusBadge(d.status, d.zile_pana_expirare)}</td>
                                  <td style={{padding:'7px 10px', textAlign:'right'}}>
                                    <div style={{display:'flex', gap:4, justifyContent:'flex-end'}}>
                                      <button onClick={(e) => { e.stopPropagation(); openDocPreview(d.fisier_path, showToast) }} 
                                        style={{padding:'3px 7px', background:G.green+'22', color:G.green, border:`1px solid ${G.green}55`, borderRadius:4, fontSize:11, cursor:'pointer'}} title="Vizualizează">👁</button>
                                      <button onClick={(e) => { e.stopPropagation(); setEditDoc(d) }} 
                                        style={{padding:'3px 7px', background:G.blue+'22', color:G.blue, border:`1px solid ${G.blue}55`, borderRadius:4, fontSize:11, cursor:'pointer'}} title="Editează">✏️</button>
                                      <button onClick={(e) => { e.stopPropagation(); handleDelete(d) }} 
                                        style={{padding:'3px 7px', background:G.red+'22', color:G.red, border:`1px solid ${G.red}55`, borderRadius:4, fontSize:11, cursor:'pointer'}} title="Șterge">🗑️</button>
                                    </div>
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div style={{padding:18, textAlign:'center', color:G.muted, fontSize:12, background:G.bg, borderRadius:6}}>
                        Nu există documente uploadate pentru această persoană.
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
          {groupedByEmployee.length === 0 && (
            <div style={{...S.card, padding:40, textAlign:'center', color:G.muted}}>
              Nicio persoană găsită cu filtrele curente.
            </div>
          )}
        </div>
      )}
      
      {/* ─── FLAT VIEW (tabel listing) ─── */}
      {viewMode === 'flat' && (
      <div style={{...S.card, overflow:'hidden'}}>
        <div style={{overflowX:'auto'}}>
          <table style={{width:'100%', borderCollapse:'collapse', fontSize:13}}>
            <thead style={{background:G.bg}}>
              <tr>
                <th style={thStyle}>Angajat</th>
                <th style={thStyle}>Tip Document</th>
                <th style={thStyle}>Număr</th>
                <th style={thStyle}>Emitent</th>
                <th style={thStyle}>Emis</th>
                <th style={thStyle}>Expiră</th>
                <th style={thStyle}>Status</th>
                <th style={{...thStyle, textAlign:'right'}}>Acțiuni</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(d => {
                const meta = CAT_META_DOCUMENTE[d.categorie] || { emoji:'📄', label:d.categorie }
                return (
                  <tr key={d.id} style={{
                    borderTop:`1px solid ${G.border}`,
                    background: d.activ === false ? G.bg : 'transparent',
                    opacity: d.activ === false ? 0.55 : 1,
                  }}>
                    <td style={{...tdStyle, fontWeight:600}}>
                      {d.employee_name}
                      {d.cetatenie && d.cetatenie !== 'roman' && (
                        <span style={{marginLeft:6, fontSize:10, padding:'2px 6px', background:G.blue+'22', color:G.blue, borderRadius:3, fontWeight:600}}>
                          {d.cetatenie}
                        </span>
                      )}
                      <div style={{fontSize:10, color:G.muted, fontWeight:400, marginTop:2}}>{d.functie || '—'}</div>
                    </td>
                    <td style={tdStyle}>
                      <div style={{fontWeight:600}}>{d.tip_denumire}</div>
                      <div style={{fontSize:10, color:G.muted, marginTop:2}}>{meta.emoji} {meta.label}</div>
                    </td>
                    <td style={{...tdStyle, fontFamily:'monospace', fontSize:11}}>
                      {d.numar_document || <span style={{color:G.dim}}>—</span>}
                    </td>
                    <td style={{...tdStyle, fontSize:12}}>{d.emitent || <span style={{color:G.dim}}>—</span>}</td>
                    <td style={{...tdStyle, fontSize:12}}>
                      {d.data_emitere ? new Date(d.data_emitere).toLocaleDateString('ro-RO') : <span style={{color:G.dim}}>—</span>}
                    </td>
                    <td style={{...tdStyle, fontSize:12}}>
                      {d.fara_expirare || !d.tip_are_expirare ? '∞' : (d.data_expirare ? new Date(d.data_expirare).toLocaleDateString('ro-RO') : '—')}
                    </td>
                    <td style={tdStyle}>{statusBadge(d.status, d.zile_pana_expirare)}</td>
                    <td style={{...tdStyle, textAlign:'right'}}>
                      <div style={{display:'flex', gap:4, justifyContent:'flex-end'}}>
                        <button onClick={() => openDocPreview(d.fisier_path, showToast)} 
                          style={{padding:'4px 8px', background:G.green+'22', color:G.green, border:`1px solid ${G.green}55`, borderRadius:4, fontSize:11, cursor:'pointer'}} 
                          title="Vizualizează fișier">👁</button>
                        <button onClick={() => setEditDoc(d)} 
                          style={{padding:'4px 8px', background:G.blue+'22', color:G.blue, border:`1px solid ${G.blue}55`, borderRadius:4, fontSize:11, cursor:'pointer'}} 
                          title="Editează">✏️</button>
                        <button onClick={() => handleDelete(d)} 
                          style={{padding:'4px 8px', background:G.red+'22', color:G.red, border:`1px solid ${G.red}55`, borderRadius:4, fontSize:11, cursor:'pointer'}} 
                          title="Șterge">🗑️</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <div style={{padding:40, textAlign:'center', color:G.muted}}>
            {documente.length === 0 
              ? '📂 Nu există documente. Apasă „➕ Adaugă Document" sau „📥 Bulk Import" să începi.' 
              : 'Niciun document găsit cu filtrele curente.'}
          </div>
        )}
      </div>
      )}
      
      <div style={{marginTop:12, fontSize:11, color:G.muted, textAlign:'center'}}>
        {viewMode === 'flat' 
          ? `💡 ${filtered.length} / ${documente.length} documente afișate · Click pe 👁 pentru preview PDF`
          : `🗂 ${groupedByEmployee.length} persoane · Click pe rând pentru a vedea documentele · Cele cu „lipsă obligatorii" sunt sus`}
      </div>
      
      {/* Modale */}
      {showAdd && (
        <ModalAddDocument 
          employees={employees} 
          tipuri={tipuri.filter(t => t.activ)} 
          defaultEmployeeId={null}
          onClose={() => setShowAdd(false)} 
          onSaved={() => { loadAll(); setShowAdd(false) }} 
          showToast={showToast}
        />
      )}
      {editDoc && (
        <ModalEditDocument 
          document={editDoc} 
          tipuri={tipuri} 
          employees={employees}
          onClose={() => setEditDoc(null)} 
          onSaved={() => { loadAll(); setEditDoc(null) }} 
          showToast={showToast}
        />
      )}
      {showGestTipuri && (
        <ModalGestionareTipuri 
          tipuri={tipuri} 
          onClose={() => setShowGestTipuri(false)} 
          onReload={loadAll} 
          showToast={showToast}
        />
      )}
      {showBulkImport && (
        <DocumenteBulkImportModal 
          employees={employees}
          tipuri={tipuri}
          onClose={() => setShowBulkImport(false)}
          onImported={() => loadAll()}
          showToast={showToast}
        />
      )}
    </div>
  )
}
