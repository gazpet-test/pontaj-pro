// ════════════════════════════════════════════════════════════════════════════
// MODULUL LOGISTICĂ — Tab Service (Fișe Service detaliate)
// ════════════════════════════════════════════════════════════════════════════
// Folosește schema extinsă a tabelei `logistica_service_intrari` cu coloanele:
//   suma_factura, manopera, numar_factura, data_factura, diagnostic_lucrari,
//   status, km_intrare, km_iesire, ore_intrare, ore_iesire, sofer_id
// Coloana `sofer_id` rămâne în DB pentru viitor; UI-ul nu o expune.
// ════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo } from 'react'
import { supabase } from './lib/supabase.js'
import * as XLSX from 'xlsx-js-style'

// ─── Theme (sincron cu Logistica.jsx) ───────────────────────────────────────
const G = {
  bg:'#0D1117', surface:'#161B22', border:'#21262D', border2:'#30363D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  blue:'#58A6FF', green:'#3FB950', red:'#F85149', yellow:'#D29922',
  purple:'#BC8CFF', orange:'#F0883E',
  greenDim:'#1A3A1A', redDim:'#3A1A1A', yellowDim:'#3A2A0A',
  logistica:'#E3B341',
}
const S = {
  card: { background:G.surface, border:`1px solid ${G.border}`, borderRadius:12 },
  input: { background:G.bg, border:`1px solid ${G.border2}`, color:G.text, borderRadius:8, padding:'8px 12px', fontFamily:'inherit', fontSize:14, outline:'none', width:'100%' },
  btnP: { background:'#1F6FEB', color:'white', border:'none', borderRadius:8, padding:'9px 18px', fontFamily:'inherit', fontSize:14, fontWeight:700, cursor:'pointer' },
  btnS: { background:G.surface, color:G.text, border:`1px solid ${G.border}`, borderRadius:8, padding:'7px 14px', fontFamily:'inherit', fontSize:13, fontWeight:600, cursor:'pointer' },
}

const STATUSURI = ['programat', 'in_lucru', 'finalizat', 'livrat']
const TIPURI = ['mentenanta', 'reparatie']

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'
const fmtRON = (n) => n != null ? Number(n).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' RON' : '—'
const todayISO = () => new Date().toISOString().split('T')[0]

// ─── Form fields (subset din Logistica.jsx) ─────────────────────────────────
const FieldLabel = ({ label, required }) => (
  <div style={{fontSize: 11, color: G.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 5}}>
    {label} {required && <span style={{color: G.red}}>*</span>}
  </div>
)

function FieldText({ label, value, onChange, required, placeholder, type='text', readonly, step }) {
  return (
    <div>
      <FieldLabel label={label} required={required} />
      <input type={type} step={step} value={value ?? ''} onChange={e => onChange(e.target.value)} placeholder={placeholder} readOnly={readonly}
        style={{...S.input, background: readonly ? G.surface : G.bg, color: readonly ? G.muted : G.text}} />
    </div>
  )
}

function FieldSelect({ label, value, onChange, options, required, readonly, placeholder }) {
  return (
    <div>
      <FieldLabel label={label} required={required} />
      <select value={value ?? ''} onChange={e => onChange(e.target.value)} disabled={readonly}
        style={{...S.input, padding: '7px 11px', fontSize: 13, background: readonly ? G.surface : G.bg, color: readonly ? G.muted : G.text, cursor: readonly ? 'default' : 'pointer'}}>
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((o, i) => (
          typeof o === 'object' && o !== null
            ? <option key={`${o.value}-${i}`} value={o.value}>{o.label}</option>
            : <option key={`${o}-${i}`} value={o}>{o || '— niciuna —'}</option>
        ))}
      </select>
    </div>
  )
}

function FieldTextarea({ label, value, onChange, rows=3, readonly, placeholder }) {
  return (
    <div>
      <FieldLabel label={label} />
      <textarea value={value ?? ''} onChange={e => onChange(e.target.value)} rows={rows} readOnly={readonly} placeholder={placeholder}
        style={{...S.input, fontSize: 14, background: readonly ? G.surface : G.bg, color: readonly ? G.muted : G.text, resize: 'vertical', fontFamily: 'inherit'}} />
    </div>
  )
}

// ─── Badges ─────────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const cfg = {
    'programat':  { bg: G.blue + '22',   color: G.blue,   label: '📅 Programat' },
    'in_lucru':   { bg: G.yellow + '22', color: G.yellow, label: '🔧 În lucru' },
    'finalizat':  { bg: G.green + '22',  color: G.green,  label: '✓ Finalizat' },
    'livrat':     { bg: G.purple + '22', color: G.purple, label: '🚚 Livrat' },
  }
  const c = cfg[status] || { bg: G.dim+'22', color: G.dim, label: status || '—' }
  return <span style={{display:'inline-block', padding:'3px 10px', borderRadius:12, fontSize:11, fontWeight:700, letterSpacing:'.3px', background:c.bg, color:c.color, whiteSpace:'nowrap'}}>{c.label}</span>
}

function TipBadge({ tip }) {
  const cfg = {
    'mentenanta': { bg: G.green + '22',  color: G.green,  label: '🔧 Mentenanță' },
    'reparatie':  { bg: G.orange + '22', color: G.orange, label: '⚙️ Reparație' },
  }
  const c = cfg[tip] || { bg: G.dim+'22', color: G.dim, label: tip || '—' }
  return <span style={{display:'inline-block', padding:'3px 10px', borderRadius:12, fontSize:11, fontWeight:700, letterSpacing:'.3px', background:c.bg, color:c.color, whiteSpace:'nowrap'}}>{c.label}</span>
}

// ─── KPI Card ───────────────────────────────────────────────────────────────
function KPICard({ icon, label, value, color = G.blue, sub }) {
  return (
    <div style={{...S.card, padding: '14px 18px', flex: 1, minWidth: 160, borderLeft: `3px solid ${color}`}}>
      <div style={{fontSize: 11, color: G.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 4}}>{icon} {label}</div>
      <div style={{fontSize: 24, fontWeight: 800, color: G.text, fontVariantNumeric: 'tabular-nums'}}>{value}</div>
      {sub && <div style={{fontSize: 11, color: G.muted, marginTop: 2}}>{sub}</div>}
    </div>
  )
}

// ─── SortableTh ─────────────────────────────────────────────────────────────
function SortableTh({ col, sortBy, setSortBy, width, children, align='left' }) {
  const isActive = sortBy.col === col
  const handleClick = () => {
    if (isActive) setSortBy({ col, dir: sortBy.dir === 'asc' ? 'desc' : 'asc' })
    else setSortBy({ col, dir: 'asc' })
  }
  return (
    <th onClick={handleClick} style={{
      width, cursor: 'pointer', userSelect: 'none', textAlign: align,
      padding: '10px 8px', color: isActive ? G.logistica : G.muted,
      fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.4px',
      borderBottom: `1px solid ${G.border}`, background: G.surface,
    }}>
      <span style={{display:'inline-flex', alignItems:'center', gap:4}}>
        {children}
        <span style={{fontSize: 9, opacity: isActive ? 1 : .35}}>
          {isActive ? (sortBy.dir === 'asc' ? '▲' : '▼') : '▲▼'}
        </span>
      </span>
    </th>
  )
}

// ─── Modal: Create / Edit Fișă Service ──────────────────────────────────────
function FisaServiceModal({ fisa, mode, active, onClose, onSaved, showToast }) {
  const isEdit = mode === 'edit'
  const isCreate = mode === 'create'
  const isView = mode === 'view'
  
  const fromFisa = (f) => ({
    activ_id: f?.activ_id || '',
    tip: f?.tip || 'reparatie',
    status: f?.status || 'finalizat',
    data: f?.data || todayISO(),
    data_factura: f?.data_factura || '',
    numar_factura: f?.numar_factura || '',
    suma_factura: f?.suma_factura ?? '',
    manopera: f?.manopera ?? '',
    locatie_service: f?.locatie_service || '',
    km_intrare: f?.km_intrare ?? '',
    km_iesire: f?.km_iesire ?? '',
    ore_intrare: f?.ore_intrare ?? '',
    ore_iesire: f?.ore_iesire ?? '',
    denumire: f?.denumire || '',
    diagnostic_lucrari: f?.diagnostic_lucrari || '',
    observatii: f?.observatii || '',
  })
  
  const [form, setForm] = useState(fromFisa(fisa))
  const setField = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const [saving, setSaving] = useState(false)
  
  const activOptions = useMemo(() => [
    { value: '', label: '— Selectează activ —' },
    ...active.map(a => ({
      value: String(a.id),
      label: `${a.cod_intern || a.nr_inmatriculare || `#${a.id}`} · ${a.marca || ''} ${a.model || ''}`.trim()
    }))
  ], [active])
  
  const activSelected = active.find(a => String(a.id) === String(form.activ_id))
  
  // Calcul automat: piese = suma_factura - manopera (informativ, nu se salvează)
  const piesePret = useMemo(() => {
    const sf = Number(form.suma_factura)
    const m = Number(form.manopera)
    if (sf > 0 && m > 0 && m <= sf) return (sf - m).toFixed(2)
    return null
  }, [form.suma_factura, form.manopera])
  
  const handleSave = async () => {
    if (!form.activ_id) { showToast('Selectează activul (vehicul/utilaj)', 'error'); return }
    if (!form.tip) { showToast('Selectează tipul (mentenanță/reparație)', 'error'); return }
    if (!form.denumire.trim()) { showToast('Completează denumirea/titlul fișei', 'error'); return }
    if (!form.data) { showToast('Selectează data fișei', 'error'); return }
    
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    
    const payload = {
      activ_id: Number(form.activ_id),
      tip: form.tip,
      status: form.status,
      data: form.data,
      data_factura: form.data_factura || null,
      numar_factura: form.numar_factura.trim() || null,
      suma_factura: form.suma_factura !== '' ? Number(form.suma_factura) : null,
      manopera: form.manopera !== '' ? Number(form.manopera) : null,
      locatie_service: form.locatie_service.trim() || null,
      km_intrare: form.km_intrare !== '' ? Number(form.km_intrare) : null,
      km_iesire: form.km_iesire !== '' ? Number(form.km_iesire) : null,
      ore_intrare: form.ore_intrare !== '' ? Number(form.ore_intrare) : null,
      ore_iesire: form.ore_iesire !== '' ? Number(form.ore_iesire) : null,
      denumire: form.denumire.trim(),
      diagnostic_lucrari: form.diagnostic_lucrari.trim() || null,
      observatii: form.observatii.trim() || null,
    }
    
    let result
    if (isCreate) {
      result = await supabase.from('logistica_service_intrari')
        .insert({ ...payload, created_by: user?.id })
        .select('*, logistica_active(id, cod_intern, nr_inmatriculare, marca, model)')
        .single()
    } else {
      result = await supabase.from('logistica_service_intrari')
        .update(payload).eq('id', fisa.id)
        .select('*, logistica_active(id, cod_intern, nr_inmatriculare, marca, model)')
        .single()
    }
    
    setSaving(false)
    if (result.error) {
      showToast(`Eroare: ${result.error.message}`, 'error')
      return
    }
    
    showToast(isCreate ? '✓ Fișă creată cu succes!' : '✓ Modificări salvate', 'success')
    onSaved()
  }
  
  const handleDelete = async () => {
    if (!fisa?.id) return
    if (!confirm(`Ești sigur că vrei să ștergi fișa #${fisa.id}?\n\n${fisa.denumire}\n\nAcțiunea NU poate fi anulată.`)) return
    
    setSaving(true)
    const { error } = await supabase.from('logistica_service_intrari').delete().eq('id', fisa.id)
    setSaving(false)
    if (error) { showToast(`Eroare: ${error.message}`, 'error'); return }
    showToast('✓ Fișă ștearsă', 'success')
    onSaved()
  }
  
  const titlu = isCreate ? '➕ Fișă Service nouă' : isEdit ? '✎ Editare fișă' : '👁 Vizualizare fișă'
  const tipColor = form.tip === 'reparatie' ? G.orange : G.green
  
  return (
    <div onClick={onClose} style={{position:'fixed', inset:0, background:'#000000cc', zIndex:300, display:'flex', alignItems:'flex-start', justifyContent:'center', padding:'40px 16px', overflowY:'auto'}}>
      <div onClick={e => e.stopPropagation()} style={{...S.card, padding: 22, width: '100%', maxWidth: 760, boxShadow: '0 20px 80px rgba(0,0,0,.6)', borderTop: `3px solid ${tipColor}`}}>
        
        {/* Header */}
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom: 16, paddingBottom: 14, borderBottom: `1px solid ${G.border}`}}>
          <div>
            <div style={{fontSize: 18, fontWeight: 800, color: G.text, marginBottom: 4}}>{titlu}</div>
            {activSelected && (
              <div style={{fontSize: 12, color: G.muted}}>
                {activSelected.marca} {activSelected.model}
                {activSelected.cod_intern && <span style={{color: G.logistica, fontFamily: 'monospace', marginLeft: 6}}>· {activSelected.cod_intern}</span>}
                {activSelected.nr_inmatriculare && <span style={{color: G.blue, fontFamily: 'monospace', marginLeft: 6}}>· {activSelected.nr_inmatriculare}</span>}
              </div>
            )}
            {fisa?.id && <div style={{fontSize: 11, color: G.dim, marginTop: 2}}>ID #{fisa.id}</div>}
          </div>
          <button onClick={onClose} style={{background:'transparent', border:'none', color:G.muted, fontSize: 22, cursor:'pointer', padding: 4}}>×</button>
        </div>
        
        {/* IDENTIFICARE */}
        <div style={{marginBottom: 14}}>
          <div style={{fontSize: 11, color: G.logistica, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.6px', marginBottom: 8}}>
            Identificare
          </div>
          <div style={{display:'grid', gridTemplateColumns:'2fr 1fr 1fr', gap: 12, marginBottom: 10}}>
            <FieldSelect label="Activ" value={String(form.activ_id)} onChange={v => setField('activ_id', v)} options={activOptions} required readonly={isView || isEdit} />
            <FieldSelect label="Tip" value={form.tip} onChange={v => setField('tip', v)} options={TIPURI} required readonly={isView} />
            <FieldSelect label="Status" value={form.status} onChange={v => setField('status', v)} options={STATUSURI} required readonly={isView} />
          </div>
          <div style={{display:'grid', gridTemplateColumns:'1fr 2fr', gap: 12}}>
            <FieldText label="Data fișei" type="date" value={form.data} onChange={v => setField('data', v)} required readonly={isView} />
            <FieldText label="Denumire / Titlu fișă" value={form.denumire} onChange={v => setField('denumire', v)} placeholder="ex: Schimb ulei + filtre · Reparație alternator" required readonly={isView} />
          </div>
        </div>
        
        {/* FACTURĂ */}
        <div style={{marginBottom: 14}}>
          <div style={{fontSize: 11, color: G.logistica, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.6px', marginBottom: 8}}>
            Factură
          </div>
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap: 12, marginBottom: 10}}>
            <FieldText label="Număr factură" value={form.numar_factura} onChange={v => setField('numar_factura', v)} placeholder="ex: F-2026-0123" readonly={isView} />
            <FieldText label="Data factură" type="date" value={form.data_factura} onChange={v => setField('data_factura', v)} readonly={isView} />
            <FieldText label="Locație service" value={form.locatie_service} onChange={v => setField('locatie_service', v)} placeholder="ex: Service Auto Ploiești" readonly={isView} />
          </div>
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap: 12}}>
            <FieldText label="💰 Sumă totală factură (RON)" type="number" step="0.01" value={form.suma_factura} onChange={v => setField('suma_factura', v)} placeholder="ex: 1250.50" readonly={isView} />
            <FieldText label="Manoperă (RON)" type="number" step="0.01" value={form.manopera} onChange={v => setField('manopera', v)} placeholder="opțional" readonly={isView} />
            <div>
              <FieldLabel label="Piese (calculat)" />
              <div style={{...S.input, background: G.surface, color: piesePret ? G.green : G.dim, fontWeight: 700}}>
                {piesePret ? `${piesePret} RON` : '—'}
              </div>
            </div>
          </div>
        </div>
        
        {/* KILOMETRAJ / ORE */}
        <div style={{marginBottom: 14}}>
          <div style={{fontSize: 11, color: G.logistica, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.6px', marginBottom: 8}}>
            Kilometraj / Ore funcționare
          </div>
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap: 12}}>
            <FieldText label="KM intrare" type="number" value={form.km_intrare} onChange={v => setField('km_intrare', v)} placeholder="opțional" readonly={isView} />
            <FieldText label="KM ieșire" type="number" value={form.km_iesire} onChange={v => setField('km_iesire', v)} placeholder="opțional" readonly={isView} />
            <FieldText label="Ore intrare" type="number" step="0.1" value={form.ore_intrare} onChange={v => setField('ore_intrare', v)} placeholder="utilaje" readonly={isView} />
            <FieldText label="Ore ieșire" type="number" step="0.1" value={form.ore_iesire} onChange={v => setField('ore_iesire', v)} placeholder="utilaje" readonly={isView} />
          </div>
        </div>
        
        {/* DIAGNOSTIC + OBSERVAȚII */}
        <div style={{marginBottom: 18}}>
          <div style={{fontSize: 11, color: G.logistica, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.6px', marginBottom: 8}}>
            Diagnostic & lucrări
          </div>
          <div style={{marginBottom: 10}}>
            <FieldTextarea label="Diagnostic + lucrări efectuate + piese folosite" value={form.diagnostic_lucrari} onChange={v => setField('diagnostic_lucrari', v)} rows={4} placeholder="ex: Diagnostic — pierdere putere la accelerare. Lucrări: schimb pompă combustibil + filtru motorină + curățare injectoare. Piese: pompă Bosch 0445010159, filtru Mann WK842/2." readonly={isView} />
          </div>
          <FieldTextarea label="Observații" value={form.observatii} onChange={v => setField('observatii', v)} rows={2} readonly={isView} />
        </div>
        
        {/* Footer */}
        <div style={{display:'flex', justifyContent:'space-between', gap: 8, paddingTop: 14, borderTop: `1px solid ${G.border}`}}>
          <div>
            {isEdit && (
              <button onClick={handleDelete} disabled={saving} style={{...S.btnS, fontSize: 12, color: G.red, borderColor: G.red + '55'}}>
                🗑 Șterge fișă
              </button>
            )}
          </div>
          <div style={{display: 'flex', gap: 8}}>
            <button onClick={onClose} style={{...S.btnS, fontSize: 13, color: G.muted}} disabled={saving}>
              {isView ? 'Închide' : 'Anulează'}
            </button>
            {!isView && (
              <button onClick={handleSave} disabled={saving} style={{...S.btnP, background: tipColor, opacity: saving ? .6 : 1, cursor: saving ? 'wait' : 'pointer'}}>
                {saving ? '⏳ Se salvează...' : (isCreate ? '✓ Creează fișă' : '✓ Salvează modificări')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Pagina principală: Tab Service ─────────────────────────────────────────
export default function ServiceTab({ active, canEdit, showToast }) {
  const [intrari, setIntrari] = useState([])
  const [load, setLoad] = useState(true)
  
  // Filtre
  const [search, setSearch] = useState('')
  const [tipF, setTipF] = useState('Toate')
  const [statusF, setStatusF] = useState('Toate')
  const [activF, setActivF] = useState('')
  const [perioadaF, setPerioadaF] = useState('toate')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  
  // Sortare
  const [sortBy, setSortBy] = useState({ col: 'data', dir: 'desc' })
  
  // Modal
  const [modal, setModal] = useState(null) // { mode: 'create'|'edit'|'view', fisa: {} | null }
  
  const loadAll = async () => {
    setLoad(true)
    const { data, error } = await supabase
      .from('logistica_service_intrari')
      .select('*, logistica_active(id, cod_intern, nr_inmatriculare, marca, model)')
      .order('data', { ascending: false, nullsFirst: false })
      .order('id', { ascending: false })
    if (error) {
      showToast(`Eroare la încărcare: ${error.message}`, 'error')
      setIntrari([])
    } else {
      setIntrari(data || [])
    }
    setLoad(false)
  }
  
  useEffect(() => { loadAll() }, [])
  
  // ─── KPI ──────────────────────────────────────────────────────────────────
  const kpi = useMemo(() => {
    const total = intrari.length
    const sumaTotala = intrari.reduce((s, i) => s + Number(i.suma_factura || 0), 0)
    const cuFactura = intrari.filter(i => i.suma_factura).length
    const inLucru = intrari.filter(i => i.status === 'in_lucru').length
    const programat = intrari.filter(i => i.status === 'programat').length
    const reparatii = intrari.filter(i => i.tip === 'reparatie').length
    const mentenanta = intrari.filter(i => i.tip === 'mentenanta').length
    const anCurent = new Date().getFullYear()
    const inAnCurent = intrari.filter(i => i.data && new Date(i.data).getFullYear() === anCurent)
    const sumaAnCurent = inAnCurent.reduce((s, i) => s + Number(i.suma_factura || 0), 0)
    return { total, sumaTotala, cuFactura, inLucru, programat, reparatii, mentenanta, sumaAnCurent, anCurent }
  }, [intrari])
  
  // ─── Filtre + sortare ─────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    // Calcul interval pentru filtrul perioadă
    let dStart = null, dEnd = null
    const now = new Date()
    const nowISO = now.toISOString().split('T')[0]
    if (perioadaF === 'azi') {
      dStart = nowISO; dEnd = nowISO
    } else if (perioadaF === 'saptamana') {
      const d = new Date(); d.setDate(d.getDate() - 7)
      dStart = d.toISOString().split('T')[0]; dEnd = nowISO
    } else if (perioadaF === 'luna') {
      const d = new Date(); d.setMonth(d.getMonth() - 1)
      dStart = d.toISOString().split('T')[0]; dEnd = nowISO
    } else if (perioadaF === 'an') {
      const d = new Date(now.getFullYear(), 0, 1)
      dStart = d.toISOString().split('T')[0]; dEnd = nowISO
    } else if (perioadaF === 'custom') {
      dStart = customStart || null; dEnd = customEnd || null
    }
    
    let result = intrari.filter(i => {
      if (search) {
        const s = search.toLowerCase()
        const haystack = [
          i.denumire, i.diagnostic_lucrari, i.observatii, i.numar_factura, i.locatie_service, i.cod_piesa,
          i.logistica_active?.cod_intern, i.logistica_active?.nr_inmatriculare, i.logistica_active?.marca, i.logistica_active?.model
        ].filter(Boolean).join(' ').toLowerCase()
        if (!haystack.includes(s)) return false
      }
      if (tipF !== 'Toate' && i.tip !== tipF) return false
      if (statusF !== 'Toate' && i.status !== statusF) return false
      if (activF && String(i.activ_id) !== String(activF)) return false
      if (dStart && (!i.data || i.data < dStart)) return false
      if (dEnd && (!i.data || i.data > dEnd)) return false
      return true
    })
    
    // Sortare
    const dir = sortBy.dir === 'asc' ? 1 : -1
    const getValue = (i) => {
      switch (sortBy.col) {
        case 'data':           return i.data || ''
        case 'activ':          return (i.logistica_active?.cod_intern || i.logistica_active?.nr_inmatriculare || '').toLowerCase()
        case 'denumire':       return (i.denumire || '').toLowerCase()
        case 'tip':            return i.tip || ''
        case 'status':         return i.status || ''
        case 'suma_factura':   return Number(i.suma_factura || 0)
        case 'numar_factura':  return (i.numar_factura || '').toLowerCase()
        default:               return i.id
      }
    }
    result.sort((a, b) => {
      const va = getValue(a), vb = getValue(b)
      if (va < vb) return -1 * dir
      if (va > vb) return 1 * dir
      return 0
    })
    return result
  }, [intrari, search, tipF, statusF, activF, perioadaF, customStart, customEnd, sortBy])
  
  // ─── Sumă totală pentru filtrul curent (live) ────────────────────────────
  const sumaFiltrata = useMemo(() => filtered.reduce((s, i) => s + Number(i.suma_factura || 0), 0), [filtered])
  
  // ─── Activ options pentru filtrul + dropdown ─────────────────────────────
  const activOptions = useMemo(() => [
    { value: '', label: 'Toate activele' },
    ...active.map(a => ({
      value: String(a.id),
      label: `${a.cod_intern || a.nr_inmatriculare || `#${a.id}`} · ${a.marca || ''} ${a.model || ''}`.trim()
    }))
  ], [active])
  
  // ─── Export Excel ─────────────────────────────────────────────────────────
  const exportExcel = () => {
    const header = ['Nr', 'Data', 'Activ', 'Plăcuță', 'Marcă', 'Model', 'Tip', 'Status', 'Denumire', 'Nr factură', 'Data factură', 'Sumă factură (RON)', 'Manoperă (RON)', 'KM intrare', 'KM ieșire', 'Locație service', 'Diagnostic + lucrări', 'Observații']
    const rows = filtered.map((i, idx) => {
      const a = i.logistica_active || {}
      return [
        idx + 1,
        i.data ? new Date(i.data).toLocaleDateString('ro-RO') : '',
        a.cod_intern || '',
        a.nr_inmatriculare || '',
        a.marca || '',
        a.model || '',
        i.tip || '',
        i.status || '',
        i.denumire || '',
        i.numar_factura || '',
        i.data_factura ? new Date(i.data_factura).toLocaleDateString('ro-RO') : '',
        i.suma_factura ?? '',
        i.manopera ?? '',
        i.km_intrare ?? '',
        i.km_iesire ?? '',
        i.locatie_service || '',
        i.diagnostic_lucrari || '',
        i.observatii || '',
      ]
    })
    
    const aoa = [
      [`Fișe Service Logistică — ${new Date().toLocaleDateString('ro-RO')}`],
      [`${filtered.length} fișe${filtered.length !== intrari.length ? ` (filtrat din ${intrari.length})` : ''} · Sumă totală: ${sumaFiltrata.toLocaleString('ro-RO', {minimumFractionDigits: 2, maximumFractionDigits: 2})} RON`],
      [],
      header,
      ...rows
    ]
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    
    const titleStyle = { font: { bold: true, sz: 14, color: { rgb: 'E3B341' } } }
    const subtitleStyle = { font: { italic: true, sz: 10, color: { rgb: '8B949E' } } }
    const headerStyle = {
      fill: { fgColor: { rgb: '1F2937' } },
      font: { bold: true, color: { rgb: 'E3B341' }, sz: 10 },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
      border: { top: { style: 'thin', color: { rgb: '30363D' } }, bottom: { style: 'thin', color: { rgb: '30363D' } }, left: { style: 'thin', color: { rgb: '30363D' } }, right: { style: 'thin', color: { rgb: '30363D' } } }
    }
    
    if (ws['A1']) ws['A1'].s = titleStyle
    if (ws['A2']) ws['A2'].s = subtitleStyle
    header.forEach((_, c) => {
      const a = XLSX.utils.encode_cell({ r: 3, c })
      if (ws[a]) ws[a].s = headerStyle
    })
    
    ws['!cols'] = [
      { wch: 5 }, { wch: 11 }, { wch: 10 }, { wch: 12 }, { wch: 14 }, { wch: 18 }, { wch: 11 }, { wch: 11 },
      { wch: 30 }, { wch: 14 }, { wch: 11 }, { wch: 14 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 22 }, { wch: 50 }, { wch: 30 }
    ]
    ws['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 17 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 17 } },
    ]
    
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Fișe Service')
    XLSX.writeFile(wb, `Logistica_Service_${todayISO()}.xlsx`)
    showToast(`✓ Exportat ${filtered.length} fișe`, 'success')
  }
  
  // ─── Reset filtre ─────────────────────────────────────────────────────────
  const resetFiltre = () => {
    setSearch(''); setTipF('Toate'); setStatusF('Toate'); setActivF('')
    setPerioadaF('toate'); setCustomStart(''); setCustomEnd('')
  }
  const haveFiltre = search || tipF !== 'Toate' || statusF !== 'Toate' || activF || perioadaF !== 'toate'
  
  return (
    <>
      {/* KPI bar */}
      <div style={{display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap'}}>
        <KPICard icon="📋" label="Total fișe" value={kpi.total} color={G.logistica} sub={`${kpi.cuFactura} cu factură · ${kpi.total - kpi.cuFactura} legacy`} />
        <KPICard icon="💰" label="Sumă totală" value={kpi.sumaTotala.toLocaleString('ro-RO', { maximumFractionDigits: 0 }) + ' RON'} color={G.green} sub={`An ${kpi.anCurent}: ${kpi.sumaAnCurent.toLocaleString('ro-RO', { maximumFractionDigits: 0 })} RON`} />
        <KPICard icon="🔧" label="În lucru" value={kpi.inLucru} color={G.yellow} sub={kpi.programat > 0 ? `+${kpi.programat} programate` : null} />
        <KPICard icon="⚙️" label="Reparații" value={kpi.reparatii} color={G.orange} />
        <KPICard icon="🛠️" label="Mentenanțe" value={kpi.mentenanta} color={G.green} />
      </div>
      
      {/* Filtre */}
      <div style={{...S.card, padding: 14, marginBottom: 14}}>
        <div style={{display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10}}>
          <input placeholder="🔍 Caută denumire, diagnostic, factură, activ..." value={search} onChange={e => setSearch(e.target.value)} style={{...S.input, width: 320}}/>
          <select value={tipF} onChange={e => setTipF(e.target.value)} style={{...S.input, width: 'auto', padding: '7px 11px', fontSize: 13, cursor: 'pointer'}}>
            <option value="Toate">Toate tipurile</option>
            {TIPURI.map(t => <option key={t} value={t}>{t === 'mentenanta' ? '🔧 Mentenanță' : '⚙️ Reparație'}</option>)}
          </select>
          <select value={statusF} onChange={e => setStatusF(e.target.value)} style={{...S.input, width: 'auto', padding: '7px 11px', fontSize: 13, cursor: 'pointer'}}>
            <option value="Toate">Toate statusurile</option>
            {STATUSURI.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={activF} onChange={e => setActivF(e.target.value)} style={{...S.input, width: 'auto', padding: '7px 11px', fontSize: 13, cursor: 'pointer', minWidth: 200}}>
            {activOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {haveFiltre && (
            <button onClick={resetFiltre} style={{...S.btnS, padding: '6px 10px', fontSize: 11, color: G.muted}}>×  Resetează filtre</button>
          )}
        </div>
        
        {/* Filtru perioadă */}
        <div style={{display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap'}}>
          <span style={{fontSize: 11, color: G.muted, fontWeight: 600, marginRight: 4}}>PERIOADĂ:</span>
          {[
            {key: 'toate', label: 'Toate'},
            {key: 'azi', label: 'Azi'},
            {key: 'saptamana', label: '7 zile'},
            {key: 'luna', label: 'Luna'},
            {key: 'an', label: 'Anul'},
            {key: 'custom', label: 'Custom'},
          ].map(p => (
            <button key={p.key} onClick={() => setPerioadaF(p.key)} style={{
              ...S.btnS, padding: '6px 12px', fontSize: 12, fontWeight: 600,
              background: perioadaF === p.key ? G.logistica + '22' : 'transparent',
              color: perioadaF === p.key ? G.logistica : G.muted,
              borderColor: perioadaF === p.key ? G.logistica + '55' : G.border,
            }}>{p.label}</button>
          ))}
          {perioadaF === 'custom' && (
            <>
              <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} style={{...S.input, padding: '6px 10px', fontSize: 12, minWidth: 140, width: 'auto'}} />
              <span style={{color: G.muted, fontSize: 12}}>→</span>
              <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} style={{...S.input, padding: '6px 10px', fontSize: 12, minWidth: 140, width: 'auto'}} />
            </>
          )}
        </div>
      </div>
      
      {/* Acțiuni: nr filtrate + sumă + butoane */}
      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10}}>
        <div style={{fontSize: 13, color: G.muted}}>
          <strong style={{color: G.text}}>{filtered.length}</strong>
          {filtered.length !== intrari.length && <span> din {intrari.length}</span>}
          {' '}fișe
          {sumaFiltrata > 0 && <> · sumă filtrată: <strong style={{color: G.green}}>{sumaFiltrata.toLocaleString('ro-RO', {minimumFractionDigits: 2, maximumFractionDigits: 2})} RON</strong></>}
        </div>
        <div style={{display: 'flex', gap: 8}}>
          <button onClick={exportExcel} disabled={filtered.length === 0} style={{...S.btnS, opacity: filtered.length === 0 ? .4 : 1, cursor: filtered.length === 0 ? 'not-allowed' : 'pointer'}}>
            📥 Excel
          </button>
          {canEdit && (
            <button onClick={() => setModal({ mode: 'create', fisa: null })} style={{...S.btnP, background: G.logistica, color: '#000'}}>
              + Fișă nouă
            </button>
          )}
        </div>
      </div>
      
      {/* Tabel fișe */}
      {load ? (
        <div style={{display: 'flex', justifyContent: 'center', padding: 80}}>
          <div style={{
            width: 32, height: 32, border: `3px solid ${G.border}`, borderTopColor: G.logistica,
            borderRadius: '50%', animation: 'sp 0.8s linear infinite'
          }} />
          <style>{`@keyframes sp { to { transform: rotate(360deg) } }`}</style>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{...S.card, padding: 60, textAlign: 'center', color: G.muted}}>
          <div style={{fontSize: 40, marginBottom: 12}}>{intrari.length === 0 ? '📋' : '🔍'}</div>
          <div style={{fontSize: 14, marginBottom: 8}}>
            {intrari.length === 0 ? 'Nicio fișă service înregistrată încă' : 'Nicio fișă găsită cu filtrele aplicate'}
          </div>
          {intrari.length === 0 && canEdit && (
            <button onClick={() => setModal({ mode: 'create', fisa: null })} style={{...S.btnP, background: G.logistica, color: '#000', marginTop: 10}}>
              + Creează prima fișă
            </button>
          )}
        </div>
      ) : (
        <div style={{...S.card, overflow: 'hidden'}}>
          <div style={{overflowX: 'auto'}}>
            <table style={{width: '100%', borderCollapse: 'collapse'}}>
              <thead>
                <tr>
                  <SortableTh col="data"          sortBy={sortBy} setSortBy={setSortBy} width={100}>Data</SortableTh>
                  <SortableTh col="activ"         sortBy={sortBy} setSortBy={setSortBy} width={170}>Activ</SortableTh>
                  <SortableTh col="tip"           sortBy={sortBy} setSortBy={setSortBy} width={120}>Tip</SortableTh>
                  <SortableTh col="denumire"      sortBy={sortBy} setSortBy={setSortBy}>Denumire</SortableTh>
                  <SortableTh col="numar_factura" sortBy={sortBy} setSortBy={setSortBy} width={120}>Nr. factură</SortableTh>
                  <SortableTh col="suma_factura"  sortBy={sortBy} setSortBy={setSortBy} width={130} align="right">Sumă</SortableTh>
                  <SortableTh col="status"        sortBy={sortBy} setSortBy={setSortBy} width={120}>Status</SortableTh>
                  <th style={{width: 85, padding: '10px 8px', borderBottom: `1px solid ${G.border}`, background: G.surface}}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(i => {
                  const a = i.logistica_active || {}
                  const isLegacy = !i.suma_factura && !i.numar_factura  // distincție vizuală pt. importurile vechi
                  return (
                    <tr key={i.id} style={{borderBottom: `1px solid ${G.border}`, opacity: isLegacy ? .85 : 1}}
                        onMouseEnter={e => e.currentTarget.style.background = G.bg}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <td style={{padding: '10px 8px', fontSize: 12, color: i.data ? G.text : G.dim, fontVariantNumeric: 'tabular-nums'}}>
                        {fmtDate(i.data)}
                      </td>
                      <td style={{padding: '10px 8px', fontSize: 12}}>
                        <div style={{fontWeight: 600, color: G.text}}>{a.marca} {a.model}</div>
                        <div style={{fontSize: 11, color: G.muted, marginTop: 2}}>
                          {a.cod_intern && <span style={{color: G.logistica, fontFamily: 'monospace'}}>{a.cod_intern}</span>}
                          {a.cod_intern && a.nr_inmatriculare && <span style={{margin: '0 4px', color: G.dim}}>·</span>}
                          {a.nr_inmatriculare && <span style={{color: G.blue, fontFamily: 'monospace'}}>{a.nr_inmatriculare}</span>}
                        </div>
                      </td>
                      <td style={{padding: '10px 8px'}}><TipBadge tip={i.tip} /></td>
                      <td style={{padding: '10px 8px', fontSize: 13, color: G.text}}>
                        <div style={{fontWeight: 600, marginBottom: 2, maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{i.denumire || '—'}</div>
                        {i.locatie_service && <div style={{fontSize: 11, color: G.muted}}>📍 {i.locatie_service}</div>}
                        {isLegacy && i.cod_piesa && <div style={{fontSize: 10, color: G.dim, fontFamily: 'monospace', marginTop: 2}}>cod: {i.cod_piesa}</div>}
                      </td>
                      <td style={{padding: '10px 8px', fontSize: 12, color: G.text, fontFamily: 'monospace'}}>
                        {i.numar_factura || <span style={{color: G.dim}}>—</span>}
                      </td>
                      <td style={{padding: '10px 8px', fontSize: 13, fontWeight: 700, color: i.suma_factura ? G.green : G.dim, fontVariantNumeric: 'tabular-nums', textAlign: 'right'}}>
                        {i.suma_factura ? fmtRON(i.suma_factura) : (i.cost ? <span style={{color: G.muted, fontSize: 11, fontWeight: 500}}>{fmtRON(i.cost)} <em style={{fontSize: 9}}>(legacy)</em></span> : '—')}
                      </td>
                      <td style={{padding: '10px 8px'}}><StatusBadge status={i.status} /></td>
                      <td style={{padding: '10px 8px', textAlign: 'right'}}>
                        <button onClick={() => setModal({ mode: 'view', fisa: i })} style={{...S.btnS, padding: '4px 8px', fontSize: 11, color: G.muted}}>👁</button>
                        {canEdit && <button onClick={() => setModal({ mode: 'edit', fisa: i })} style={{...S.btnS, padding: '4px 8px', fontSize: 11, color: G.logistica, marginLeft: 4}}>✎</button>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      
      {/* Modal */}
      {modal && (
        <FisaServiceModal 
          fisa={modal.fisa}
          mode={modal.mode}
          active={active}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); loadAll() }}
          showToast={showToast}
        />
      )}
    </>
  )
}
