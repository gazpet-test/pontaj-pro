// ════════════════════════════════════════════════════════════════════════════
// MODULUL LOGISTICĂ — v2.0 (Pasul B: Edit + Create)
// ════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from './lib/supabase.js'
import * as XLSX from 'xlsx-js-style'

// ─── Theme ───────────────────────────────────────────────────────────────────
const G = {
  bg:'#0D1117', surface:'#161B22', border:'#21262D', border2:'#30363D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  blue:'#58A6FF', green:'#3FB950', red:'#F85149', yellow:'#D29922',
  purple:'#BC8CFF', orange:'#F0883E',
  greenDim:'#1A3A1A', redDim:'#3A1A1A', yellowDim:'#3A2A0A',
  logistica:'#E3B341',
}
const S = {
  page: { fontFamily:"'Syne','Barlow',sans-serif", background:G.bg, minHeight:'100vh', color:G.text },
  card: { background:G.surface, border:`1px solid ${G.border}`, borderRadius:12 },
  input: { background:G.bg, border:`1px solid ${G.border2}`, color:G.text, borderRadius:8, padding:'8px 12px', fontFamily:'inherit', fontSize:14, outline:'none', width:'100%' },
  btnP: { background:'#1F6FEB', color:'white', border:'none', borderRadius:8, padding:'9px 18px', fontFamily:'inherit', fontSize:14, fontWeight:700, cursor:'pointer' },
  btnS: { background:G.surface, color:G.text, border:`1px solid ${G.border}`, borderRadius:8, padding:'7px 14px', fontFamily:'inherit', fontSize:13, fontWeight:600, cursor:'pointer' },
}

const STARI = ['Functional', 'Nefunctional', 'In_service']
const TIPURI_CARBURANT = ['', 'motorina', 'benzina', 'electric', 'gpl', 'mixt']
const FIRME = ['Gazpet Instal', 'Gazpet Invest', 'Alt proprietar']
const UNITATI_NORMA = ['l/h', 'l/100km']

const daysUntil = (d) => d ? Math.ceil((new Date(d) - new Date()) / 86400000) : null
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'

// ─── Toast ───────────────────────────────────────────────────────────────────
function useToast() {
  const [toast, setToast] = useState(null)
  const show = (msg, type='success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3500) }
  return [toast, show]
}
function Toast({ toast }) {
  if (!toast) return null
  const colors = { success:G.green, error:G.red, warn:G.orange }
  return <div className="toast" style={{
    background: colors[toast.type] + '22',
    border: `1px solid ${colors[toast.type]}55`,
    color: colors[toast.type]
  }}>{toast.msg}</div>
}

// ─── Badges ──────────────────────────────────────────────────────────────────
function StareBadge({ stare }) {
  const cfg = {
    'Functional': { bg: G.green+'22', color: G.green, label: '✓ Funcțional' },
    'Nefunctional': { bg: G.red+'22', color: G.red, label: '✗ Nefuncțional' },
    'In_service': { bg: G.yellow+'22', color: G.yellow, label: '🔧 În service' },
    'Service': { bg: G.yellow+'22', color: G.yellow, label: '🔧 În service' },
  }
  const c = cfg[stare] || { bg: G.dim+'22', color: G.dim, label: stare || '—' }
  return <span style={{display:'inline-block',padding:'3px 10px',borderRadius:12,fontSize:11,fontWeight:700,letterSpacing:'.3px',background:c.bg,color:c.color}}>{c.label}</span>
}

function MentenantaScadenta({ data, ore }) {
  if (!data && !ore) return <span style={{color: G.dim, fontSize: 12}}>—</span>
  const days = daysUntil(data)
  let color = G.muted, prefix = ''
  if (days !== null) {
    if (days < 0) { color = G.red; prefix = '⚠️ ' }
    else if (days <= 7) { color = G.red; prefix = '🔴 ' }
    else if (days <= 30) { color = G.orange; prefix = '🟠 ' }
    else if (days <= 60) { color = G.yellow; prefix = '🟡 ' }
    else { color = G.green; prefix = '🟢 ' }
  }
  return (
    <div style={{fontSize: 12, color, lineHeight: 1.4}}>
      {data && <div style={{fontWeight: 600}}>{prefix}{fmtDate(data)}{days !== null && days >= 0 && days <= 90 && ` (${days}z)`}</div>}
      {ore && <div style={{fontSize: 11, color: G.muted}}>{ore.toLocaleString('ro-RO')} ore</div>}
    </div>
  )
}

function KPICard({ icon, label, value, color = G.blue, sub }) {
  return (
    <div style={{...S.card, padding: '14px 18px', flex: 1, minWidth: 160, borderLeft: `3px solid ${color}`}}>
      <div style={{fontSize: 11, color: G.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 4}}>{icon} {label}</div>
      <div style={{fontSize: 24, fontWeight: 800, color: G.text, fontVariantNumeric: 'tabular-nums'}}>{value}</div>
      {sub && <div style={{fontSize: 11, color: G.muted, marginTop: 2}}>{sub}</div>}
    </div>
  )
}

// ─── Sortable header cell ────────────────────────────────────────────────────
function SortableTh({ col, sortBy, setSortBy, width, children }) {
  const isActive = sortBy.col === col
  const handleClick = () => {
    if (isActive) setSortBy({ col, dir: sortBy.dir === 'asc' ? 'desc' : 'asc' })
    else setSortBy({ col, dir: 'asc' })
  }
  return (
    <th onClick={handleClick} style={{
      width, cursor: 'pointer', userSelect: 'none',
      color: isActive ? G.logistica : undefined
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

// ─── Form Field components ───────────────────────────────────────────────────
const FieldLabel = ({ label, required }) => (
  <div style={{fontSize: 11, color: G.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 5}}>
    {label} {required && <span style={{color: G.red}}>*</span>}
  </div>
)

function FieldText({ label, value, onChange, required, placeholder, type='text', readonly }) {
  return (
    <div>
      <FieldLabel label={label} required={required} />
      <input type={type} value={value || ''} onChange={e => onChange(e.target.value)} placeholder={placeholder} readOnly={readonly}
        style={{...S.input, background: readonly ? G.surface : G.bg, color: readonly ? G.muted : G.text}} />
    </div>
  )
}

function FieldSelect({ label, value, onChange, options, required, readonly, placeholder }) {
  return (
    <div>
      <FieldLabel label={label} required={required} />
      <select value={value || ''} onChange={e => onChange(e.target.value)} disabled={readonly}
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

function FieldTextarea({ label, value, onChange, rows=2, readonly, mono }) {
  return (
    <div>
      <FieldLabel label={label} />
      <textarea value={value || ''} onChange={e => onChange(e.target.value)} rows={rows} readOnly={readonly}
        style={{...S.input, fontFamily: mono ? 'monospace' : 'inherit', fontSize: mono ? 12 : 14, background: readonly ? G.surface : G.bg, color: readonly ? G.muted : G.text, resize: 'vertical', wordBreak: mono ? 'break-all' : 'normal'}} />
    </div>
  )
}

// ─── Modal Alimentare Combustibil ────────────────────────────────────────────
const STATII = ['', 'Gazpet - Oscar (vrac propriu)', 'Petrom', 'OMV', 'MOL', 'Rompetrol', 'Lukoil', 'Gazprom', 'Socar', 'Tinmar', 'Altele']
const STATIE_GAZPET = 'Gazpet - Oscar (vrac propriu)'  // identifier pentru detectare

function AlimentareModal({ activ, onClose, onSaved, showToast, rezervorGazpet, sites, pretMotorina }) {
  const [form, setForm] = useState({
    data_alimentare: new Date().toISOString().split('T')[0],
    cantitate_litri: '',
    ore_la_alimentare: '',
    km_la_alimentare: '',
    ore_lucrate_efectiv: '',
    statie_combustibil: '',
    card_combustibil: '',
    pret_total: '',
    pret_per_litru: '',
    numar_factura: '',
    observatii: '',
    site_id: '',
  })
  const [saving, setSaving] = useState(false)
  const setField = (k, v) => setForm(p => ({ ...p, [k]: v }))
  
  const isGazpet = form.statie_combustibil === STATIE_GAZPET
  const stocCurent = rezervorGazpet?.stoc_curent_litri ? Number(rezervorGazpet.stoc_curent_litri) : 0
  const stocAfter = isGazpet && form.cantitate_litri ? stocCurent - Number(form.cantitate_litri) : null
  
  // Auto-calc preț per litru
  useEffect(() => {
    if (form.pret_total && form.cantitate_litri && Number(form.cantitate_litri) > 0) {
      const ppl = (Number(form.pret_total) / Number(form.cantitate_litri)).toFixed(4)
      if (form.pret_per_litru !== ppl) setField('pret_per_litru', ppl)
    }
  }, [form.pret_total, form.cantitate_litri])
  
  // Auto-fill cost când se introduce cantitatea (dacă nu există preț total introdus manual)
  useEffect(() => {
    if (form.cantitate_litri && pretMotorina && !form.pret_total) {
      const costEstimat = (Number(form.cantitate_litri) * Number(pretMotorina)).toFixed(2)
      setField('pret_total', costEstimat)
    }
  }, [form.cantitate_litri])
  
  const handleSave = async () => {
    if (!form.data_alimentare) { showToast('Selectează data', 'error'); return }
    if (!form.cantitate_litri || Number(form.cantitate_litri) <= 0) { showToast('Cantitatea trebuie > 0', 'error'); return }
    if (isGazpet && stocAfter !== null && stocAfter < 0) {
      const ok = window.confirm(`⚠️ ATENȚIE: Stocul rezervorului Gazpet va deveni NEGATIV (${stocAfter.toFixed(1)} L).\n\nVerifică dacă ai înregistrat toate achizițiile vrac.\n\nContinui oricum?`)
      if (!ok) return
    }
    
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    
    const payload = {
      active_id: activ.id,
      data_alimentare: form.data_alimentare,
      cantitate_litri: Number(form.cantitate_litri),
      ore_la_alimentare: form.ore_la_alimentare ? Number(form.ore_la_alimentare) : null,
      km_la_alimentare: form.km_la_alimentare ? Number(form.km_la_alimentare) : null,
      ore_lucrate_efectiv: form.ore_lucrate_efectiv ? Number(form.ore_lucrate_efectiv) : null,
      statie_combustibil: form.statie_combustibil || null,
      card_combustibil: form.card_combustibil.trim() || null,
      pret_total: form.pret_total ? Number(form.pret_total) : null,
      pret_per_litru: form.pret_per_litru ? Number(form.pret_per_litru) : null,
      numar_factura: form.numar_factura.trim() || null,
      observatii: form.observatii.trim() || null,
      rezervor_id: isGazpet && rezervorGazpet ? rezervorGazpet.id : null,
      site_id: form.site_id ? Number(form.site_id) : null,
      created_by: user?.id,
    }
    
    const { error } = await supabase.from('logistica_alimentari').insert(payload)
    setSaving(false)
    
    if (error) { showToast(`Eroare: ${error.message}`, 'error'); return }
    
    showToast(`✓ Alimentare înregistrată: ${form.cantitate_litri} L${isGazpet ? ' (din Gazpet vrac)' : ''}`, 'success')
    onSaved()
  }
  
  return (
    <div onClick={onClose} style={{position:'fixed', inset:0, background:'#000000cc', zIndex:300, display:'flex', alignItems:'flex-start', justifyContent:'center', padding:'40px 16px', overflowY:'auto'}}>
      <div onClick={e => e.stopPropagation()} style={{...S.card, padding: 22, width: '100%', maxWidth: 620, boxShadow: '0 20px 80px rgba(0,0,0,.6)', borderTop: `3px solid ${G.orange}`}} className="fi">
        
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom: 16, paddingBottom: 14, borderBottom: `1px solid ${G.border}`}}>
          <div>
            <div style={{fontSize: 18, fontWeight: 800, color: G.text, marginBottom: 4}}>
              ⛽ Alimentare combustibil
            </div>
            <div style={{fontSize: 12, color: G.muted}}>
              {activ.marca} {activ.model} {activ.cod_intern && `· ${activ.cod_intern}`}
              {activ.tip_carburant && ` · ${activ.tip_carburant}`}
              {activ.norma_consum && ` · normă ${activ.norma_consum} ${activ.unitate_norma || 'l/h'}`}
            </div>
          </div>
          <button onClick={onClose} style={{background:'transparent', border:'none', color:G.muted, fontSize: 22, cursor:'pointer', padding: 4}}>×</button>
        </div>
        
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap: 12, marginBottom: 12}}>
          <FieldText label="Data alimentării" value={form.data_alimentare} onChange={v => setField('data_alimentare', v)} type="date" required />
          <FieldText label="Cantitate (litri)" value={form.cantitate_litri} onChange={v => setField('cantitate_litri', v)} type="number" placeholder="ex: 50.5" required />
        </div>
        
        <div style={{marginBottom: 4}}>
          <div style={{fontSize: 11, color: G.orange, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 6}}>
            🏪 Sursa & alocare
          </div>
        </div>
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap: 12, marginBottom: 12}}>
          <FieldSelect label="Stație combustibil" value={form.statie_combustibil} onChange={v => setField('statie_combustibil', v)} options={STATII} placeholder="— alege stația —" />
          <FieldSelect label={isGazpet ? "Șantier (obligatoriu pt. Gazpet)" : "Șantier (opțional)"} value={form.site_id} onChange={v => setField('site_id', v)} options={[{label:'— niciun șantier —', value:''}, ...(sites||[]).map(s => ({label: s.name, value: String(s.id)}))]} placeholder="— niciun șantier —" />
        </div>
        
        {/* Banner Gazpet */}
        {isGazpet && rezervorGazpet && (
          <div style={{padding: 10, marginBottom: 12, background: G.purple + '15', border: `1px solid ${G.purple}55`, borderRadius: 8, fontSize: 12, color: G.text}}>
            <strong style={{color: G.purple}}>📦 Rezervor Gazpet — Oscar</strong>
            <div style={{marginTop: 4, color: G.muted, fontSize: 11, lineHeight: 1.6}}>
              Stoc curent: <strong style={{color: G.text}}>{stocCurent.toFixed(1)} L</strong> din {Number(rezervorGazpet.capacitate_litri).toFixed(0)} L total
              {form.cantitate_litri && stocAfter !== null && (
                <> · <strong style={{color: stocAfter < 0 ? G.red : stocAfter < (Number(rezervorGazpet.capacitate_litri) * Number(rezervorGazpet.prag_alerta_procent) / 100) ? G.orange : G.green}}>
                  După alimentare: {stocAfter.toFixed(1)} L
                </strong></>
              )}
            </div>
          </div>
        )}
        
        <div style={{marginBottom: 4}}>
          <div style={{fontSize: 11, color: G.orange, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 6}}>
            📊 Citiri pentru analiză consum
          </div>
        </div>
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap: 12, marginBottom: 14}}>
          <FieldText label="Ore bord la alim." value={form.ore_la_alimentare} onChange={v => setField('ore_la_alimentare', v)} type="number" placeholder="ex: 1250" />
          <FieldText label="Km la alimentare" value={form.km_la_alimentare} onChange={v => setField('km_la_alimentare', v)} type="number" placeholder="ex: 145000" />
          <FieldText label="Ore lucrate efectiv" value={form.ore_lucrate_efectiv} onChange={v => setField('ore_lucrate_efectiv', v)} type="number" placeholder="ex: 8" />
        </div>
        
        <div style={{marginBottom: 4}}>
          <div style={{fontSize: 11, color: G.orange, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 6}}>
            💳 Cost {pretMotorina && !isGazpet && <span style={{fontSize: 10, color: G.muted, fontWeight: 500, textTransform: 'none', letterSpacing: 0}}>(auto-fill din preț setat: {pretMotorina} RON/L)</span>}
          </div>
        </div>
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap: 12, marginBottom: 14}}>
          <FieldText label="Card combustibil" value={form.card_combustibil} onChange={v => setField('card_combustibil', v)} placeholder="ex: 7059-XXXX-1234" />
          <FieldText label="Cost total (RON)" value={form.pret_total} onChange={v => setField('pret_total', v)} type="number" placeholder="ex: 380.50" />
          <FieldText label="Preț/litru (auto)" value={form.pret_per_litru} onChange={v => setField('pret_per_litru', v)} type="number" placeholder="auto-calculat" />
          <FieldText label="Număr factură" value={form.numar_factura} onChange={v => setField('numar_factura', v)} placeholder="ex: F-2026-1234" />
        </div>
        
        <div style={{marginBottom: 14}}>
          <FieldTextarea label="Observații" value={form.observatii} onChange={v => setField('observatii', v)} rows={2} />
        </div>
        
        <div style={{display:'flex', justifyContent:'flex-end', gap: 8, paddingTop: 14, borderTop: `1px solid ${G.border}`}}>
          <button onClick={onClose} style={{...S.btnS, fontSize: 13, color: G.muted}} disabled={saving}>Anulează</button>
          <button onClick={handleSave} disabled={saving} style={{...S.btnP, background: G.orange, opacity: saving ? .6 : 1, cursor: saving ? 'wait' : 'pointer'}}>
            {saving ? '⏳ Se salvează...' : '✓ Înregistrează alimentarea'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Modal Achiziție Vrac ────────────────────────────────────────────────────
function AchizitieVracModal({ rezervor, onClose, onSaved, showToast }) {
  const [form, setForm] = useState({
    data_achizitie: new Date().toISOString().split('T')[0],
    cantitate_litri: '',
    furnizor: '',
    numar_factura: '',
    cost_total: '',
    pret_per_litru: '',
    observatii: '',
  })
  const [saving, setSaving] = useState(false)
  const setField = (k, v) => setForm(p => ({ ...p, [k]: v }))
  
  const stocCurent = rezervor?.stoc_curent_litri ? Number(rezervor.stoc_curent_litri) : 0
  const capacitate = rezervor?.capacitate_litri ? Number(rezervor.capacitate_litri) : 0
  const stocAfter = form.cantitate_litri ? stocCurent + Number(form.cantitate_litri) : null
  const overflow = stocAfter !== null && capacitate > 0 && stocAfter > capacitate
  
  useEffect(() => {
    if (form.cost_total && form.cantitate_litri && Number(form.cantitate_litri) > 0) {
      const ppl = (Number(form.cost_total) / Number(form.cantitate_litri)).toFixed(4)
      if (form.pret_per_litru !== ppl) setField('pret_per_litru', ppl)
    }
  }, [form.cost_total, form.cantitate_litri])
  
  const handleSave = async () => {
    if (!form.data_achizitie) { showToast('Selectează data', 'error'); return }
    if (!form.cantitate_litri || Number(form.cantitate_litri) <= 0) { showToast('Cantitatea trebuie > 0', 'error'); return }
    if (overflow) {
      const ok = window.confirm(`⚠️ Cantitatea introdusă va depăși capacitatea rezervorului!\nStoc final: ${stocAfter.toFixed(1)} L · Capacitate: ${capacitate} L\n\nContinui oricum?`)
      if (!ok) return
    }
    
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    
    const { error } = await supabase.from('logistica_achizitii_vrac').insert({
      rezervor_id: rezervor.id,
      data_achizitie: form.data_achizitie,
      cantitate_litri: Number(form.cantitate_litri),
      furnizor: form.furnizor.trim() || null,
      numar_factura: form.numar_factura.trim() || null,
      cost_total: form.cost_total ? Number(form.cost_total) : null,
      pret_per_litru: form.pret_per_litru ? Number(form.pret_per_litru) : null,
      observatii: form.observatii.trim() || null,
      created_by: user?.id,
    })
    
    setSaving(false)
    if (error) { showToast(`Eroare: ${error.message}`, 'error'); return }
    
    showToast(`✓ Achiziție vrac: +${form.cantitate_litri} L în ${rezervor.nume}`, 'success')
    onSaved()
  }
  
  return (
    <div onClick={onClose} style={{position:'fixed', inset:0, background:'#000000cc', zIndex:300, display:'flex', alignItems:'flex-start', justifyContent:'center', padding:'40px 16px', overflowY:'auto'}}>
      <div onClick={e => e.stopPropagation()} style={{...S.card, padding: 22, width: '100%', maxWidth: 600, boxShadow: '0 20px 80px rgba(0,0,0,.6)', borderTop: `3px solid ${G.purple}`}} className="fi">
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom: 16, paddingBottom: 14, borderBottom: `1px solid ${G.border}`}}>
          <div>
            <div style={{fontSize: 18, fontWeight: 800, color: G.text, marginBottom: 4}}>
              📦 Achiziție vrac în rezervor
            </div>
            <div style={{fontSize: 12, color: G.muted}}>
              {rezervor.nume} · stoc curent: <strong style={{color: G.text}}>{stocCurent.toFixed(1)} L</strong> din {capacitate.toFixed(0)} L
            </div>
          </div>
          <button onClick={onClose} style={{background:'transparent', border:'none', color:G.muted, fontSize: 22, cursor:'pointer', padding: 4}}>×</button>
        </div>
        
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap: 12, marginBottom: 12}}>
          <FieldText label="Data achiziției" value={form.data_achizitie} onChange={v => setField('data_achizitie', v)} type="date" required />
          <FieldText label="Cantitate (litri)" value={form.cantitate_litri} onChange={v => setField('cantitate_litri', v)} type="number" placeholder="ex: 8000" required />
          <FieldText label="Furnizor" value={form.furnizor} onChange={v => setField('furnizor', v)} placeholder="ex: Petrom Distribution" />
          <FieldText label="Număr factură" value={form.numar_factura} onChange={v => setField('numar_factura', v)} placeholder="ex: F-2026-0123" />
          <FieldText label="Cost total (RON)" value={form.cost_total} onChange={v => setField('cost_total', v)} type="number" placeholder="ex: 60000" />
          <FieldText label="Preț/litru (auto)" value={form.pret_per_litru} onChange={v => setField('pret_per_litru', v)} type="number" placeholder="auto-calculat" />
        </div>
        
        <div style={{marginBottom: 14}}>
          <FieldTextarea label="Observații" value={form.observatii} onChange={v => setField('observatii', v)} rows={2} />
        </div>
        
        {form.cantitate_litri && stocAfter !== null && (
          <div style={{padding: 10, background: overflow ? G.redDim : G.greenDim, border: `1px solid ${overflow ? G.red : G.green}33`, borderRadius: 8, marginBottom: 14, fontSize: 12, color: G.text}}>
            <strong style={{color: overflow ? G.red : G.green}}>
              {overflow ? '⚠️ DEPĂȘIRE CAPACITATE!' : '✓ Stoc după achiziție:'}
            </strong>
            <div style={{marginTop: 4, color: G.muted, fontSize: 11}}>
              {stocCurent.toFixed(1)} L + {Number(form.cantitate_litri).toFixed(1)} L = <strong style={{color: G.text}}>{stocAfter.toFixed(1)} L</strong>
              {capacitate > 0 && <> ({(stocAfter / capacitate * 100).toFixed(1)}% din capacitate)</>}
            </div>
          </div>
        )}
        
        <div style={{display:'flex', justifyContent:'flex-end', gap: 8, paddingTop: 14, borderTop: `1px solid ${G.border}`}}>
          <button onClick={onClose} style={{...S.btnS, fontSize: 13, color: G.muted}} disabled={saving}>Anulează</button>
          <button onClick={handleSave} disabled={saving} style={{...S.btnP, background: G.purple, opacity: saving ? .6 : 1, cursor: saving ? 'wait' : 'pointer'}}>
            {saving ? '⏳ Se salvează...' : '✓ Înregistrează achiziția'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Modal Editare Stoc Rezervor (corecții manuale) ──────────────────────────
function EditStocModal({ rezervor, onClose, onSaved, showToast }) {
  const stocCurent = rezervor?.stoc_curent_litri ? Number(rezervor.stoc_curent_litri) : 0
  const cap = rezervor?.capacitate_litri ? Number(rezervor.capacitate_litri) : 0
  const [val, setVal] = useState(String(stocCurent))
  const [motiv, setMotiv] = useState('')
  const [saving, setSaving] = useState(false)
  
  const newStoc = Number(val) || 0
  const diferenta = newStoc - stocCurent
  
  const handleSave = async () => {
    if (val === '' || isNaN(Number(val))) { showToast('Valoare invalidă', 'error'); return }
    if (newStoc < 0) {
      const ok = window.confirm(`⚠️ Stoc NEGATIV: ${newStoc} L. Continui oricum?`)
      if (!ok) return
    }
    if (cap > 0 && newStoc > cap) {
      const ok = window.confirm(`⚠️ Stocul (${newStoc} L) depășește capacitatea rezervorului (${cap} L). Continui oricum?`)
      if (!ok) return
    }
    
    setSaving(true)
    const { error } = await supabase.from('logistica_rezervoare')
      .update({ 
        stoc_curent_litri: newStoc,
        observatii: motiv.trim() ? `[${new Date().toISOString().split('T')[0]}] Ajustare manuală: ${stocCurent} → ${newStoc} L. Motiv: ${motiv.trim()}\n${rezervor.observatii || ''}`.trim() : rezervor.observatii
      })
      .eq('id', rezervor.id)
    setSaving(false)
    
    if (error) { showToast(`Eroare: ${error.message}`, 'error'); return }
    
    showToast(`✓ Stoc ajustat: ${stocCurent.toFixed(1)} → ${newStoc.toFixed(1)} L (${diferenta > 0 ? '+' : ''}${diferenta.toFixed(1)})`, 'success')
    onSaved()
  }
  
  return (
    <div onClick={onClose} style={{position:'fixed', inset:0, background:'#000000cc', zIndex:300, display:'flex', alignItems:'center', justifyContent:'center', padding:'40px 16px'}}>
      <div onClick={e => e.stopPropagation()} style={{...S.card, padding: 22, width: '100%', maxWidth: 500, boxShadow: '0 20px 80px rgba(0,0,0,.6)', borderTop: `3px solid ${G.yellow}`}} className="fi">
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom: 16, paddingBottom: 12, borderBottom: `1px solid ${G.border}`}}>
          <div>
            <div style={{fontSize: 18, fontWeight: 800, color: G.text, marginBottom: 4}}>
              ✏️ Ajustare stoc rezervor
            </div>
            <div style={{fontSize: 12, color: G.muted}}>
              {rezervor.nume} · capacitate: {cap.toFixed(0)} L
            </div>
          </div>
          <button onClick={onClose} style={{background:'transparent', border:'none', color:G.muted, fontSize: 22, cursor:'pointer', padding: 4}}>×</button>
        </div>
        
        <div style={{marginBottom: 12, padding: 12, background: G.bg, borderRadius: 8}}>
          <div style={{fontSize: 11, color: G.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 4}}>
            Stoc curent înregistrat
          </div>
          <div style={{fontSize: 22, fontWeight: 800, color: G.text, fontVariantNumeric: 'tabular-nums'}}>
            {stocCurent.toFixed(2)} <span style={{fontSize: 12, color: G.muted}}>L</span>
          </div>
        </div>
        
        <FieldText label="Stoc nou (L)" value={val} onChange={v => setVal(v)} type="number" placeholder="ex: 0 sau 8500.5" />
        
        <div style={{display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap'}}>
          <button onClick={() => setVal('0')} style={{...S.btnS, fontSize: 11, padding: '5px 10px', color: G.red, borderColor: G.red + '55'}}>
            ⟲ Reset la 0
          </button>
          {cap > 0 && (
            <button onClick={() => setVal(String(cap))} style={{...S.btnS, fontSize: 11, padding: '5px 10px', color: G.green, borderColor: G.green + '55'}}>
              ⤴ Plin ({cap} L)
            </button>
          )}
          <button onClick={() => setVal(String(stocCurent))} style={{...S.btnS, fontSize: 11, padding: '5px 10px', color: G.muted}}>
            ↺ Înapoi la curent
          </button>
        </div>
        
        {val !== '' && !isNaN(Number(val)) && diferenta !== 0 && (
          <div style={{marginTop: 12, padding: 10, background: diferenta > 0 ? G.greenDim : G.redDim, border: `1px solid ${diferenta > 0 ? G.green : G.red}33`, borderRadius: 8, fontSize: 12, color: G.text}}>
            <strong style={{color: diferenta > 0 ? G.green : G.red}}>
              Modificare: {diferenta > 0 ? '+' : ''}{diferenta.toFixed(2)} L
            </strong>
            <div style={{marginTop: 4, color: G.muted, fontSize: 11}}>
              {stocCurent.toFixed(1)} L → <strong style={{color: G.text}}>{newStoc.toFixed(1)} L</strong>
            </div>
          </div>
        )}
        
        <div style={{marginTop: 14}}>
          <FieldTextarea label="Motiv ajustare (opțional, pentru audit)" value={motiv} onChange={setMotiv} rows={2} />
        </div>
        
        <div style={{padding: 8, background: G.yellowDim + '88', border: `1px solid ${G.yellow}33`, borderRadius: 8, marginTop: 12, fontSize: 11, color: G.muted, lineHeight: 1.5}}>
          ⚠️ Această ajustare modifică direct stocul, fără să fie înregistrată ca achiziție sau alimentare. Folosește doar pentru corecții (inventar, erori). Motivul se salvează în observații pentru audit.
        </div>
        
        <div style={{display:'flex', justifyContent:'flex-end', gap: 8, marginTop: 18, paddingTop: 12, borderTop: `1px solid ${G.border}`}}>
          <button onClick={onClose} style={{...S.btnS, fontSize: 13, color: G.muted}} disabled={saving}>Anulează</button>
          <button onClick={handleSave} disabled={saving || diferenta === 0} style={{...S.btnP, background: G.yellow, color: '#000', opacity: (saving || diferenta === 0) ? .5 : 1}}>
            {saving ? '⏳' : '✓ Salvează ajustarea'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Modal setări preț motorină ──────────────────────────────────────────────
function SetariMotorinaModal({ pret, dataActualizat, onClose, onSaved, showToast }) {
  const [val, setVal] = useState(pret || '7.50')
  const [saving, setSaving] = useState(false)
  
  const handleSave = async () => {
    if (!val || isNaN(Number(val)) || Number(val) <= 0) { showToast('Preț invalid', 'error'); return }
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    const today = new Date().toISOString().split('T')[0]
    await supabase.from('logistica_setari').upsert([
      { key: 'pret_motorina_ron', value: String(val), updated_at: new Date().toISOString(), updated_by: user?.id },
      { key: 'pret_motorina_actualizat', value: today, updated_at: new Date().toISOString(), updated_by: user?.id },
    ])
    setSaving(false)
    showToast(`✓ Preț actualizat: ${val} RON/L`, 'success')
    onSaved()
  }
  
  return (
    <div onClick={onClose} style={{position:'fixed', inset:0, background:'#000000cc', zIndex:300, display:'flex', alignItems:'center', justifyContent:'center', padding:'40px 16px'}}>
      <div onClick={e => e.stopPropagation()} style={{...S.card, padding: 22, width: '100%', maxWidth: 460, boxShadow: '0 20px 80px rgba(0,0,0,.6)'}} className="fi">
        <div style={{fontSize: 17, fontWeight: 800, color: G.text, marginBottom: 4}}>💰 Preț motorină</div>
        <div style={{fontSize: 11, color: G.muted, marginBottom: 16}}>
          Folosit la auto-fill cost în formularul de alimentare. Ultima actualizare: {dataActualizat || '—'}
        </div>
        <FieldText label="Preț motorină (RON/L)" value={val} onChange={v => setVal(v)} type="number" placeholder="ex: 7.50" />
        <div style={{padding: 10, background: G.bg, borderRadius: 8, marginTop: 14, fontSize: 11, color: G.muted, lineHeight: 1.6}}>
          💡 În viitor: auto-update zilnic de pe sites publice (ANRE, Petrom, OMV). Pentru moment, actualizare manuală.
        </div>
        <div style={{display:'flex', justifyContent:'flex-end', gap: 8, marginTop: 18, paddingTop: 12, borderTop: `1px solid ${G.border}`}}>
          <button onClick={onClose} style={{...S.btnS, fontSize: 13, color: G.muted}}>Anulează</button>
          <button onClick={handleSave} disabled={saving} style={S.btnP}>{saving ? '⏳' : '✓ Salvează'}</button>
        </div>
      </div>
    </div>
  )
}

// ─── Modal Mentenanță Făcută ─────────────────────────────────────────────────

// ─── Modal Mentenanță Făcută ─────────────────────────────────────────────────
function MentenantaFacutaModal({ activ, plan, onClose, onSaved, showToast }) {
  const [form, setForm] = useState({
    data_revizie: new Date().toISOString().split('T')[0],
    data_expirare: '',
    numar_document: '',
    ore_la_revizie: plan?.urmatoarea_ore || '',
    km_la_revizie: plan?.urmatoarea_km || '',
    tip_revizie: 'revizie',
    cost: '',
    service_furnizor: '',
    observatii: '',
  })
  const [saving, setSaving] = useState(false)
  const setField = (k, v) => setForm(p => ({ ...p, [k]: v }))
  
  // Tip e DOCUMENT (ITP/RCA/CASCO) sau MECANIC (revizie/reparatie)
  const isDocument = ['ITP', 'RCA', 'CASCO'].includes(form.tip_revizie)
  const isMecanic = ['revizie', 'reparatie'].includes(form.tip_revizie)
  
  // Calculez auto data expirare default pentru documente
  useEffect(() => {
    if (isDocument && form.data_revizie && !form.data_expirare) {
      // ITP = 1 an pentru auto noi/2 ani vechi, RCA/CASCO = 1 an default
      const luniValabilitate = form.tip_revizie === 'ITP' ? 12 : 12
      const d = new Date(form.data_revizie)
      d.setMonth(d.getMonth() + luniValabilitate)
      setField('data_expirare', d.toISOString().split('T')[0])
    }
  }, [form.tip_revizie, form.data_revizie])
  
  // Reset câmpuri irelevante la schimbarea tipului
  useEffect(() => {
    if (isDocument) {
      setField('ore_la_revizie', '')
      setField('km_la_revizie', '')
    }
    if (isMecanic) {
      setField('data_expirare', '')
      setField('numar_document', '')
    }
  }, [form.tip_revizie])
  
  // Label-uri dinamice
  const labels = {
    revizie:    { titlu: '✅ Revizie efectuată',         data: 'Data efectuării',  service: 'Service / Furnizor',   placeholder: 'ex: Service Auto Ploiești' },
    reparatie:  { titlu: '🔧 Reparație efectuată',       data: 'Data efectuării',  service: 'Service / Furnizor',   placeholder: 'ex: Service Auto Ploiești' },
    ITP:        { titlu: '📋 ITP înregistrat',           data: 'Data emiterii',    service: 'Stație ITP',           placeholder: 'ex: ITP Ploiești - Pop Auto' },
    RCA:        { titlu: '🛡️ Asigurare RCA',             data: 'Data emiterii',    service: 'Asigurător',           placeholder: 'ex: Allianz Țiriac, Groupama, Omniasig' },
    CASCO:      { titlu: '🛡️ Asigurare CASCO',           data: 'Data emiterii',    service: 'Asigurător',           placeholder: 'ex: Allianz Țiriac, Groupama, Omniasig' },
    altele:     { titlu: '📝 Înregistrare',              data: 'Data',             service: 'Furnizor / Prestator', placeholder: '' },
  }
  const L = labels[form.tip_revizie] || labels.altele
  
  const handleSave = async () => {
    if (!form.data_revizie) { showToast('Selectează data', 'error'); return }
    if (isDocument && !form.data_expirare) { showToast('Pentru documente trebuie data expirării', 'error'); return }
    
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    
    // 1. INSERT în istoric
    const istoricPayload = {
      active_id: activ.id,
      data_revizie: form.data_revizie,
      data_expirare: form.data_expirare || null,
      numar_document: form.numar_document.trim() || null,
      ore_la_revizie: form.ore_la_revizie ? Number(form.ore_la_revizie) : null,
      km_la_revizie: form.km_la_revizie ? Number(form.km_la_revizie) : null,
      tip_revizie: form.tip_revizie,
      cost: form.cost ? Number(form.cost) : null,
      service_furnizor: form.service_furnizor.trim() || null,
      observatii: form.observatii.trim() || null,
      created_by: user?.id,
    }
    
    const { error: insErr } = await supabase
      .from('logistica_mentenanta_istoric')
      .insert(istoricPayload)
    
    if (insErr) {
      setSaving(false)
      showToast(`Eroare: ${insErr.message}`, 'error')
      return
    }
    
    // 2. UPDATE plan DOAR pentru revizie/reparație (nu pentru documente)
    if (isMecanic) {
      const updateFields = {
        ultima_revizie_data: form.data_revizie,
        ultima_revizie_ore: form.ore_la_revizie ? Number(form.ore_la_revizie) : null,
        ultima_revizie_km: form.km_la_revizie ? Number(form.km_la_revizie) : null,
        updated_by: user?.id,
      }
      const intervalOre = plan?.interval_ore || null
      const intervalKm = plan?.interval_km || null
      if (intervalOre && form.ore_la_revizie) {
        updateFields.urmatoarea_ore = Number(form.ore_la_revizie) + intervalOre
      }
      if (intervalKm && form.km_la_revizie) {
        updateFields.urmatoarea_km = Number(form.km_la_revizie) + intervalKm
      }
      const newDate = new Date(form.data_revizie)
      if (intervalOre && form.ore_la_revizie) {
        const daysEstimate = Math.round(intervalOre / 8)
        newDate.setDate(newDate.getDate() + Math.min(daysEstimate, 365))
      } else {
        newDate.setDate(newDate.getDate() + 365)
      }
      updateFields.urmatoarea_data = newDate.toISOString().split('T')[0]
      
      let upErr
      if (plan?.id) {
        const r = await supabase.from('logistica_mentenanta_plan').update(updateFields).eq('id', plan.id)
        upErr = r.error
      } else {
        const r = await supabase.from('logistica_mentenanta_plan').insert({ active_id: activ.id, ...updateFields })
        upErr = r.error
      }
      if (upErr) {
        setSaving(false)
        showToast(`Înregistrat, dar eroare la actualizare plan: ${upErr.message}`, 'warn')
        onSaved()
        return
      }
    }
    
    setSaving(false)
    const successMsg = isDocument 
      ? `✓ ${form.tip_revizie} înregistrat (valabil până la ${new Date(form.data_expirare).toLocaleDateString('ro-RO')})`
      : '✓ Mentenanță înregistrată cu succes!'
    showToast(successMsg, 'success')
    onSaved()
  }
  
  return (
    <div onClick={onClose} style={{position:'fixed', inset:0, background:'#000000cc', zIndex:300, display:'flex', alignItems:'flex-start', justifyContent:'center', padding:'40px 16px', overflowY:'auto'}}>
      <div onClick={e => e.stopPropagation()} style={{...S.card, padding: 22, width: '100%', maxWidth: 600, boxShadow: '0 20px 80px rgba(0,0,0,.6)', borderTop: `3px solid ${isDocument ? G.blue : G.green}`}} className="fi">
        
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom: 16, paddingBottom: 14, borderBottom: `1px solid ${G.border}`}}>
          <div>
            <div style={{fontSize: 18, fontWeight: 800, color: G.text, marginBottom: 4}}>
              {L.titlu}
            </div>
            <div style={{fontSize: 12, color: G.muted}}>
              {activ.marca} {activ.model} {activ.cod_intern && `· ${activ.cod_intern}`}
            </div>
          </div>
          <button onClick={onClose} style={{background:'transparent', border:'none', color:G.muted, fontSize: 22, cursor:'pointer', padding: 4}}>×</button>
        </div>
        
        {/* Tip — întotdeauna primul */}
        <div style={{marginBottom: 12}}>
          <FieldSelect label="Tip" value={form.tip_revizie} onChange={v => setField('tip_revizie', v)} options={['revizie', 'reparatie', 'ITP', 'RCA', 'CASCO', 'altele']} required />
        </div>
        
        {/* Câmpuri DINAMICE pe baza tipului */}
        {isMecanic && (
          <>
            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap: 12, marginBottom: 12}}>
              <FieldText label={L.data} value={form.data_revizie} onChange={v => setField('data_revizie', v)} type="date" required />
              <FieldText label={L.service} value={form.service_furnizor} onChange={v => setField('service_furnizor', v)} placeholder={L.placeholder} />
              <FieldText label="Ore funcționare la revizie" value={form.ore_la_revizie} onChange={v => setField('ore_la_revizie', v)} type="number" placeholder="ex: 1250" />
              <FieldText label="Kilometri la revizie" value={form.km_la_revizie} onChange={v => setField('km_la_revizie', v)} type="number" placeholder="ex: 145000" />
              <FieldText label="Cost (RON)" value={form.cost} onChange={v => setField('cost', v)} type="number" placeholder="ex: 1250.50" />
              <div></div>
            </div>
          </>
        )}
        
        {isDocument && (
          <>
            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap: 12, marginBottom: 12}}>
              <FieldText label={L.data} value={form.data_revizie} onChange={v => setField('data_revizie', v)} type="date" required />
              <FieldText label={`📅 Data expirării ${form.tip_revizie}`} value={form.data_expirare} onChange={v => setField('data_expirare', v)} type="date" required />
              <FieldText label={L.service} value={form.service_furnizor} onChange={v => setField('service_furnizor', v)} placeholder={L.placeholder} />
              <FieldText label={`Număr ${form.tip_revizie === 'ITP' ? 'proces verbal' : 'poliță'}`} value={form.numar_document} onChange={v => setField('numar_document', v)} placeholder={form.tip_revizie === 'ITP' ? 'ex: PV-2026-1234' : 'ex: AGG-12345678'} />
              <FieldText label="Cost (RON)" value={form.cost} onChange={v => setField('cost', v)} type="number" placeholder="ex: 850" />
              <div></div>
            </div>
          </>
        )}
        
        {form.tip_revizie === 'altele' && (
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap: 12, marginBottom: 12}}>
            <FieldText label={L.data} value={form.data_revizie} onChange={v => setField('data_revizie', v)} type="date" required />
            <FieldText label="Data expirare (opțional)" value={form.data_expirare} onChange={v => setField('data_expirare', v)} type="date" />
            <FieldText label={L.service} value={form.service_furnizor} onChange={v => setField('service_furnizor', v)} placeholder={L.placeholder} />
            <FieldText label="Cost (RON)" value={form.cost} onChange={v => setField('cost', v)} type="number" placeholder="ex: 250" />
          </div>
        )}
        
        <div style={{marginBottom: 14}}>
          <FieldTextarea label="Observații" value={form.observatii} onChange={v => setField('observatii', v)} rows={2} />
        </div>
        
        {/* Preview pentru REVIZIE: următoarea calculată */}
        {isMecanic && (plan?.interval_ore || plan?.interval_km) && (form.ore_la_revizie || form.km_la_revizie) && (
          <div style={{padding: 10, background: G.greenDim, border: `1px solid ${G.green}33`, borderRadius: 8, marginBottom: 14, fontSize: 12, color: G.text}}>
            <strong style={{color: G.green}}>📅 Următoarea revizie va fi calculată:</strong>
            <div style={{marginTop: 4, color: G.muted}}>
              {plan?.interval_ore && form.ore_la_revizie && <>· la {Number(form.ore_la_revizie) + plan.interval_ore} ore funcționare<br/></>}
              {plan?.interval_km && form.km_la_revizie && <>· la {(Number(form.km_la_revizie) + plan.interval_km).toLocaleString('ro-RO')} km<br/></>}
              · sau aproximativ în 1 an de la data introdusă
            </div>
          </div>
        )}
        
        {/* Preview pentru DOCUMENTE: avertizare scadență */}
        {isDocument && form.data_expirare && (() => {
          const days = daysUntil(form.data_expirare)
          const color = days < 30 ? G.red : days < 90 ? G.orange : G.green
          const bg = days < 30 ? G.redDim : days < 90 ? G.yellowDim : G.greenDim
          return (
            <div style={{padding: 10, background: bg, border: `1px solid ${color}33`, borderRadius: 8, marginBottom: 14, fontSize: 12, color: G.text}}>
              <strong style={{color}}>📅 Documentul va fi valabil până pe {new Date(form.data_expirare).toLocaleDateString('ro-RO')}</strong>
              <div style={{marginTop: 4, color: G.muted}}>
                {days > 0 ? `· ${days} zile de la data introdusă` : `· EXPIRAT! cu ${Math.abs(days)} zile`}
              </div>
            </div>
          )
        })()}
        
        <div style={{display:'flex', justifyContent:'flex-end', gap: 8, paddingTop: 14, borderTop: `1px solid ${G.border}`}}>
          <button onClick={onClose} style={{...S.btnS, fontSize: 13, color: G.muted}} disabled={saving}>Anulează</button>
          <button onClick={handleSave} disabled={saving} style={{...S.btnP, background: isDocument ? G.blue : G.green, opacity: saving ? .6 : 1, cursor: saving ? 'wait' : 'pointer'}}>
            {saving ? '⏳ Se salvează...' : (isDocument ? `✓ Înregistrează ${form.tip_revizie}` : '✓ Înregistrează mentenanța')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Modal Form (View / Edit / Create) ───────────────────────────────────────
function ActivFormModal({ activ, initialMode, categorii, onClose, onSaved, accessLevel, showToast, rezervorGazpet, sites, pretMotorina }) {
  const [mode, setMode] = useState(initialMode)
  const [saving, setSaving] = useState(false)
  
  const fromActiv = (a) => ({
    cod_intern: a?.cod_intern || '',
    nr_inventar: a?.nr_inventar || '',
    nr_inmatriculare: a?.nr_inmatriculare || '',
    tip: a?.logistica_categorii?.tip || '',
    subcategorie: a?.logistica_categorii?.subcategorie || '',
    marca: a?.marca || '',
    model: a?.model || '',
    an_fabricatie: a?.an_fabricatie || '',
    stare: a?.stare || 'Functional',
    firma_proprietara: a?.firma_proprietara || 'Gazpet Instal',
    tip_carburant: a?.tip_carburant || '',
    norma_consum: a?.norma_consum || '',
    unitate_norma: a?.unitate_norma || 'l/h',
    prag_alerta_consum: a?.prag_alerta_consum || '10',
    link_fisa_nas: a?.link_fisa_nas || '',
    observatii: a?.observatii || '',
    serie_sasiu: a?.serie_sasiu || '',
  })
  
  const [form, setForm] = useState(fromActiv(activ))
  const setField = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const [showMent, setShowMent] = useState(false)
  const [showAlim, setShowAlim] = useState(false)
  const [istoric, setIstoric] = useState([])
  const [alimentari, setAlimentari] = useState([])
  
  // Fetch istoric + alimentări când se deschide în view
  useEffect(() => {
    if (mode === 'view' && activ?.id) {
      supabase.from('logistica_mentenanta_istoric')
        .select('*')
        .eq('active_id', activ.id)
        .order('data_revizie', { ascending: false })
        .then(({ data }) => setIstoric(data || []))
      supabase.from('logistica_alimentari')
        .select('*')
        .eq('active_id', activ.id)
        .order('data_alimentare', { ascending: false })
        .then(({ data }) => setAlimentari(data || []))
    }
  }, [mode, activ?.id])
  
  const tipuri = useMemo(() => ['', ...Array.from(new Set(categorii.map(c => c.tip))).sort()], [categorii])
  const subcategoriiDisponibile = useMemo(() => {
    const subs = categorii.filter(c => c.tip === form.tip && c.subcategorie).map(c => c.subcategorie).sort()
    return ['', ...subs]
  }, [form.tip, categorii])
  
  // Reset subcategorie când se schimbă tipul
  useEffect(() => {
    if (form.tip && form.subcategorie && !subcategoriiDisponibile.includes(form.subcategorie)) {
      setField('subcategorie', '')
    }
  }, [form.tip])
  
  const isReadOnly = mode === 'view'
  const canEdit = accessLevel === 'admin' || accessLevel === 'editor'
  const mentenanta = activ?.logistica_mentenanta_plan?.[0]
  const days = mentenanta?.urmatoarea_data ? daysUntil(mentenanta.urmatoarea_data) : null
  
  const handleSave = async () => {
    if (!form.tip) { showToast('Selectează tipul (Camion, Utilaj, Autoturism...)', 'error'); return }
    if (!form.model.trim()) { showToast('Modelul este obligatoriu', 'error'); return }
    if (!form.cod_intern.trim() && !form.nr_inmatriculare.trim()) {
      showToast('Trebuie cod intern SAU plăcuță înmatriculare', 'error'); return
    }
    if (form.an_fabricatie && (Number(form.an_fabricatie) < 1900 || Number(form.an_fabricatie) > 2030)) {
      showToast('An invalid (1900-2030)', 'error'); return
    }
    
    const cat = categorii.find(c => 
      c.tip === form.tip && 
      ((c.subcategorie || null) === (form.subcategorie || null))
    )
    if (!cat) {
      showToast(`Categoria "${form.tip}${form.subcategorie ? ' / '+form.subcategorie : ''}" nu există`, 'error'); return
    }
    
    setSaving(true)
    
    const payload = {
      cod_intern: form.cod_intern.trim() || null,
      nr_inventar: form.nr_inventar.trim() || null,
      nr_inmatriculare: form.nr_inmatriculare.trim() || null,
      categorie_id: cat.id,
      marca: form.marca.trim() || null,
      model: form.model.trim(),
      an_fabricatie: form.an_fabricatie ? Number(form.an_fabricatie) : null,
      stare: form.stare,
      firma_proprietara: form.firma_proprietara || null,
      tip_carburant: form.tip_carburant || null,
      norma_consum: form.norma_consum ? Number(form.norma_consum) : null,
      unitate_norma: form.unitate_norma || null,
      prag_alerta_consum: form.prag_alerta_consum ? Number(form.prag_alerta_consum) : 10,
      link_fisa_nas: form.link_fisa_nas.trim() || null,
      observatii: form.observatii.trim() || null,
      serie_sasiu: form.serie_sasiu.trim() || null,
    }
    
    let result
    if (mode === 'create') {
      const { data: { user } } = await supabase.auth.getUser()
      result = await supabase.from('logistica_active')
        .insert({ ...payload, created_by: user?.id })
        .select('*, logistica_categorii(tip, subcategorie), logistica_mentenanta_plan(urmatoarea_data, urmatoarea_ore)')
        .single()
    } else {
      result = await supabase.from('logistica_active')
        .update(payload).eq('id', activ.id)
        .select('*, logistica_categorii(tip, subcategorie), logistica_mentenanta_plan(urmatoarea_data, urmatoarea_ore)')
        .single()
    }
    
    setSaving(false)
    if (result.error) {
      let msg = result.error.message
      if (msg.includes('duplicate key')) {
        if (msg.includes('cod_intern')) msg = `Codul intern "${form.cod_intern}" există deja!`
        else if (msg.includes('nr_inmatriculare')) msg = `Plăcuța "${form.nr_inmatriculare}" există deja!`
      }
      showToast(`Eroare: ${msg}`, 'error')
      return
    }
    
    showToast(mode === 'create' ? '✓ Activ creat cu succes!' : '✓ Modificările salvate', 'success')
    onSaved(result.data)
  }
  
  const handleDelete = async () => {
    const label = `${activ.marca || ''} ${activ.model || ''}`.trim() || activ.cod_intern || activ.nr_inmatriculare || `ID ${activ.id}`
    const confirmed = window.confirm(
      `⚠️ ATENȚIE — Ștergere ireversibilă\n\n` +
      `Sigur vrei să ștergi:\n"${label}"?\n\n` +
      `Vor fi șterse și:\n` +
      `· planul de mentenanță asociat\n` +
      `· toate alocările istorice\n` +
      `· documentele atașate\n\n` +
      `Această acțiune NU poate fi anulată.`
    )
    if (!confirmed) return
    
    setSaving(true)
    const { error } = await supabase.from('logistica_active').delete().eq('id', activ.id)
    setSaving(false)
    
    if (error) {
      showToast(`Eroare la ștergere: ${error.message}`, 'error')
      return
    }
    
    showToast(`✓ Șters: ${label}`, 'success')
    onSaved()
  }
  
  const titleMain = mode === 'create' 
    ? '+ Activ nou'
    : `${activ?.marca || '—'} ${activ?.model || ''}`.trim()
  const titleSub = mode === 'edit' ? '✏️ Editare' : mode === 'create' ? 'Completează detaliile' : null
  
  return (
    <div onClick={mode === 'view' ? onClose : undefined} style={{
      position:'fixed', inset:0, background:'#000000aa', zIndex:200,
      display:'flex', alignItems:'flex-start', justifyContent:'center',
      padding:'30px 16px', overflowY:'auto'
    }}>
      <div onClick={e => e.stopPropagation()} style={{...S.card, padding: 22, width: '100%', maxWidth: 760, boxShadow: '0 20px 80px rgba(0,0,0,.6)'}} className="fi">
        
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom: 16, gap: 12, paddingBottom: 14, borderBottom: `1px solid ${G.border}`}}>
          <div style={{flex: 1}}>
            <div style={{fontSize: 19, fontWeight: 800, color: G.text, marginBottom: 4}}>{titleMain}</div>
            {titleSub ? (
              <div style={{fontSize: 12, color: G.logistica, fontWeight: 600}}>{titleSub}</div>
            ) : (
              <div style={{display:'flex', gap: 8, alignItems:'center', flexWrap:'wrap', marginTop: 4}}>
                {activ?.cod_intern && <span style={{background: G.blue+'22', color: G.blue, fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 12}}>{activ.cod_intern}</span>}
                {activ?.nr_inmatriculare && <span style={{background: G.purple+'22', color: G.purple, fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 12}}>🚗 {activ.nr_inmatriculare}</span>}
                <StareBadge stare={activ?.stare} />
              </div>
            )}
          </div>
          <div style={{display:'flex', gap: 6, flexWrap: 'wrap'}}>
            {mode === 'view' && canEdit && (
              <>
                <button onClick={() => setShowAlim(true)} style={{...S.btnS, fontSize: 12, color: G.orange, borderColor: G.orange + '55'}}>
                  ⛽ Alimentare
                </button>
                <button onClick={() => setShowMent(true)} style={{...S.btnS, fontSize: 12, color: G.green, borderColor: G.green + '55'}}>
                  ✅ Mentenanță
                </button>
                <button onClick={() => setMode('edit')} style={{...S.btnS, fontSize: 12, color: G.logistica, borderColor: G.logistica + '55'}}>
                  ✏️ Editează
                </button>
                {accessLevel === 'admin' && (
                  <button onClick={handleDelete} disabled={saving} style={{
                    ...S.btnS, fontSize: 12, color: G.red, borderColor: G.red + '55',
                    opacity: saving ? .5 : 1
                  }}>
                    🗑️ Șterge
                  </button>
                )}
              </>
            )}
            <button onClick={onClose} style={{background:'transparent', border:'none', color:G.muted, fontSize: 22, cursor:'pointer', padding: 4, lineHeight: 1}}>×</button>
          </div>
        </div>
        
        {mode === 'view' && (mentenanta?.urmatoarea_data || mentenanta?.urmatoarea_ore) && (
          <div style={{
            marginBottom: 14, padding: 12,
            background: days !== null && days < 0 ? G.redDim : days !== null && days <= 30 ? G.yellowDim : G.greenDim,
            border: `1px solid ${days !== null && days < 0 ? G.red : days !== null && days <= 30 ? G.yellow : G.green}33`,
            borderRadius: 10
          }}>
            <div style={{fontSize: 11, color: G.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 4}}>🔧 Plan Mentenanță</div>
            <div style={{fontSize: 13, color: G.text, fontWeight: 600}}>
              {mentenanta.urmatoarea_data && <>Următoarea revizie: <strong>{fmtDate(mentenanta.urmatoarea_data)}</strong>
                {days !== null && <span style={{marginLeft: 8, fontSize: 12, color: days < 0 ? G.red : days <= 30 ? G.orange : G.green}}>
                  ({days < 0 ? `întârziere ${Math.abs(days)} zile` : days === 0 ? 'astăzi' : `în ${days} zile`})
                </span>}
              </>}
              {mentenanta.urmatoarea_ore && <div style={{marginTop: 4, fontSize: 12}}>Ore funcționare prag: <strong>{mentenanta.urmatoarea_ore.toLocaleString('ro-RO')}</strong></div>}
            </div>
          </div>
        )}
        
        <div style={{marginBottom: 14}}>
          <div style={{fontSize: 11, color: G.logistica, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.6px', marginBottom: 8}}>🆔 Identificare</div>
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap: 12}}>
            <FieldText label="Cod intern (TST...)" value={form.cod_intern} onChange={v => setField('cod_intern', v)} placeholder="ex: TST094" readonly={isReadOnly} />
            <FieldText label="Nr inventar" value={form.nr_inventar} onChange={v => setField('nr_inventar', v)} placeholder="ex: MF-00123" readonly={isReadOnly} />
            <FieldText label="Plăcuță înmatriculare" value={form.nr_inmatriculare} onChange={v => setField('nr_inmatriculare', v)} placeholder="ex: PH 99 GAZ" readonly={isReadOnly} />
            <FieldSelect label="Tip" value={form.tip} onChange={v => setField('tip', v)} options={tipuri} required={!isReadOnly} placeholder="— alege tipul —" readonly={isReadOnly} />
            <FieldSelect label="Subcategorie" value={form.subcategorie} onChange={v => setField('subcategorie', v)} options={subcategoriiDisponibile} placeholder={subcategoriiDisponibile.length > 1 ? '— alege subcategorie —' : '— niciuna —'} readonly={isReadOnly} />
            <FieldText label="Marcă" value={form.marca} onChange={v => setField('marca', v)} placeholder="ex: CATERPILLAR" readonly={isReadOnly} />
            <FieldText label="Model" value={form.model} onChange={v => setField('model', v)} placeholder="ex: D6N XL" required={!isReadOnly} readonly={isReadOnly} />
            <FieldText label="An fabricație" value={form.an_fabricatie} onChange={v => setField('an_fabricatie', v)} type="number" placeholder="ex: 2018" readonly={isReadOnly} />
            <FieldSelect label="Stare" value={form.stare} onChange={v => setField('stare', v)} options={STARI} readonly={isReadOnly} />
          </div>
        </div>
        
        <div style={{marginBottom: 14}}>
          <div style={{fontSize: 11, color: G.logistica, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.6px', marginBottom: 8}}>⚙️ Tehnice</div>
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap: 12}}>
            <FieldSelect label="Tip carburant" value={form.tip_carburant} onChange={v => setField('tip_carburant', v)} options={TIPURI_CARBURANT} placeholder="— niciunul —" readonly={isReadOnly} />
            <FieldText label="Normă consum" value={form.norma_consum} onChange={v => setField('norma_consum', v)} type="number" placeholder="ex: 12.5" readonly={isReadOnly} />
            <FieldSelect label="Unitate" value={form.unitate_norma} onChange={v => setField('unitate_norma', v)} options={UNITATI_NORMA} readonly={isReadOnly} />
            <FieldText label="Prag alertă consum (%)" value={form.prag_alerta_consum} onChange={v => setField('prag_alerta_consum', v)} type="number" placeholder="10" readonly={isReadOnly} />
            <FieldText label="Serie șasiu (VIN)" value={form.serie_sasiu} onChange={v => setField('serie_sasiu', v)} placeholder="ex: WDB9061..." readonly={isReadOnly} />
            <FieldSelect label="Firmă proprietară" value={form.firma_proprietara} onChange={v => setField('firma_proprietara', v)} options={FIRME} readonly={isReadOnly} />
          </div>
        </div>
        
        <div style={{marginBottom: 14}}>
          <div style={{fontSize: 11, color: G.logistica, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.6px', marginBottom: 8}}>📎 Documente</div>
          <div style={{display:'flex', flexDirection: 'column', gap: 12}}>
            <FieldTextarea label="Link fișă service NAS" value={form.link_fisa_nas} onChange={v => setField('link_fisa_nas', v)} rows={2} mono readonly={isReadOnly} />
            <FieldTextarea label="Observații" value={form.observatii} onChange={v => setField('observatii', v)} rows={2} readonly={isReadOnly} />
          </div>
        </div>
        
        {/* Istoric mentenanță (doar în view) */}
        {mode === 'view' && istoric.length > 0 && (
          <div style={{marginBottom: 14}}>
            <div style={{fontSize: 11, color: G.logistica, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.6px', marginBottom: 8}}>
              📜 Istoric mentenanță ({istoric.length})
            </div>
            <div style={{...S.card, padding: 0, overflow: 'hidden'}}>
              {istoric.map((i, idx) => {
                const tipColors = {
                  'revizie': G.green, 'reparatie': G.orange, 'ITP': G.blue,
                  'RCA': G.purple, 'CASCO': G.purple, 'altele': G.muted
                }
                const tipColor = tipColors[i.tip_revizie] || G.muted
                const isDoc = ['ITP', 'RCA', 'CASCO'].includes(i.tip_revizie)
                const expDays = i.data_expirare ? daysUntil(i.data_expirare) : null
                const expColor = expDays !== null ? (expDays < 0 ? G.red : expDays < 30 ? G.orange : expDays < 90 ? G.yellow : G.green) : G.muted
                return (
                  <div key={i.id} style={{
                    padding: '10px 14px',
                    borderBottom: idx < istoric.length - 1 ? `1px solid ${G.border}` : 'none',
                    display: 'grid',
                    gridTemplateColumns: '90px 90px 1fr auto',
                    gap: 12,
                    alignItems: 'center',
                    fontSize: 12
                  }}>
                    <div style={{fontFamily: 'monospace', color: G.text, fontWeight: 600}}>
                      {fmtDate(i.data_revizie)}
                    </div>
                    <span style={{
                      background: tipColor + '22', color: tipColor,
                      padding: '2px 8px', borderRadius: 12, fontSize: 10, fontWeight: 700,
                      letterSpacing: '.3px', textTransform: 'uppercase', textAlign: 'center'
                    }}>{i.tip_revizie}</span>
                    <div style={{color: G.muted, fontSize: 11}}>
                      {i.service_furnizor && <span style={{color: G.text}}>{i.service_furnizor}</span>}
                      {i.numar_document && <span style={{color: G.muted, fontFamily: 'monospace'}}> · {i.numar_document}</span>}
                      {!isDoc && i.ore_la_revizie && <> · {i.ore_la_revizie.toLocaleString('ro-RO')} ore</>}
                      {!isDoc && i.km_la_revizie && <> · {i.km_la_revizie.toLocaleString('ro-RO')} km</>}
                      {isDoc && i.data_expirare && (
                        <span style={{color: expColor, fontWeight: 700, marginLeft: 4}}>
                          {' · '}valabil până {fmtDate(i.data_expirare)}
                          {expDays !== null && expDays >= 0 && expDays <= 90 && ` (${expDays}z)`}
                          {expDays !== null && expDays < 0 && ` ⚠️ EXPIRAT`}
                        </span>
                      )}
                      {i.observatii && <div style={{marginTop: 2, fontStyle: 'italic'}}>{i.observatii}</div>}
                    </div>
                    <div style={{color: G.green, fontWeight: 700, fontVariantNumeric: 'tabular-nums', fontSize: 13}}>
                      {i.cost ? `${Number(i.cost).toLocaleString('ro-RO', {minimumFractionDigits: 2, maximumFractionDigits: 2})} RON` : '—'}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
        
        {/* Widget analiză consum (rolling 5 alimentări) */}
        {mode === 'view' && alimentari.length >= 2 && activ?.norma_consum && (() => {
          const window = alimentari.slice(0, 5)  // ultimele 5 (deja sortate desc)
          const totalLitri = window.reduce((s, a) => s + Number(a.cantitate_litri || 0), 0)
          const oreEfectiveSum = window.reduce((s, a) => s + Number(a.ore_lucrate_efectiv || 0), 0)
          
          // Fallback: ore din bord (oldest - newest)
          const oreBordOldest = window[window.length-1]?.ore_la_alimentare
          const oreBordNewest = window[0]?.ore_la_alimentare
          const oreBordDif = (oreBordOldest && oreBordNewest && oreBordNewest > oreBordOldest) ? oreBordNewest - oreBordOldest : null
          
          const oreReale = oreEfectiveSum > 0 ? oreEfectiveSum : oreBordDif
          const sursaOre = oreEfectiveSum > 0 ? 'raport șantier' : 'citire bord'
          
          if (!oreReale) return (
            <div style={{padding: 12, background: G.surface, border: `1px dashed ${G.border2}`, borderRadius: 10, marginBottom: 14, fontSize: 12, color: G.muted}}>
              📊 <strong>Analiză consum indisponibilă</strong> — completează "Ore lucrate efectiv" sau "Ore bord" la alimentări pentru a putea calcula
            </div>
          )
          
          const norma = Number(activ.norma_consum)
          const consumTeoretic = oreReale * norma  // L
          const diferenta = totalLitri - consumTeoretic
          const procentDif = consumTeoretic > 0 ? (diferenta / consumTeoretic) * 100 : 0
          const prag = Number(activ.prag_alerta_consum) || 10
          const isSuspect = Math.abs(procentDif) > prag
          const isCritic = Math.abs(procentDif) > prag * 2
          
          // Direction: pozitivă = consumat MAI MULT decât teoretic (suspect furt), negativă = mai puțin (eficient)
          const isOverConsum = diferenta > 0
          
          let bg, color, emoji, status
          if (!isSuspect) {
            bg = G.greenDim; color = G.green; emoji = '✅'
            status = 'Consum în limite normale'
          } else if (isCritic) {
            bg = G.redDim; color = G.red; emoji = '🚨'
            status = isOverConsum ? 'CONSUM CRITIC — verifică urgent (posibil furt sau scurgere)' : 'Diferență critică — verifică citirile'
          } else {
            bg = G.yellowDim; color = G.orange; emoji = '⚠️'
            status = isOverConsum ? 'Consum peste prag — atenție' : 'Sub prag — verificare recomandată'
          }
          
          return (
            <div style={{
              ...S.card, padding: 14, marginBottom: 14,
              background: bg + 'aa',
              borderLeft: `4px solid ${color}`,
            }}>
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10}}>
                <div style={{fontSize: 12, color, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px'}}>
                  📊 Analiză consum — ultimele {window.length} alimentări
                </div>
                <div style={{fontSize: 10, color: G.muted}}>
                  prag alertă: {prag}% · sursă ore: {sursaOre}
                </div>
              </div>
              
              <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginBottom: 10}}>
                <div>
                  <div style={{fontSize: 10, color: G.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.4px'}}>Total alimentat</div>
                  <div style={{fontSize: 18, fontWeight: 800, color: G.text, fontVariantNumeric: 'tabular-nums'}}>
                    {totalLitri.toFixed(1)} <span style={{fontSize: 11, color: G.muted, fontWeight: 600}}>L</span>
                  </div>
                </div>
                <div>
                  <div style={{fontSize: 10, color: G.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.4px'}}>Ore reale lucrate</div>
                  <div style={{fontSize: 18, fontWeight: 800, color: G.text, fontVariantNumeric: 'tabular-nums'}}>
                    {oreReale.toFixed(1)} <span style={{fontSize: 11, color: G.muted, fontWeight: 600}}>h</span>
                  </div>
                </div>
                <div>
                  <div style={{fontSize: 10, color: G.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.4px'}}>Consum teoretic ({norma} {activ.unitate_norma || 'l/h'})</div>
                  <div style={{fontSize: 18, fontWeight: 800, color: G.text, fontVariantNumeric: 'tabular-nums'}}>
                    {consumTeoretic.toFixed(1)} <span style={{fontSize: 11, color: G.muted, fontWeight: 600}}>L</span>
                  </div>
                </div>
              </div>
              
              <div style={{padding: '10px 12px', background: G.bg + 'cc', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 12}}>
                <div style={{fontSize: 22}}>{emoji}</div>
                <div style={{flex: 1}}>
                  <div style={{fontSize: 13, color, fontWeight: 700}}>
                    Diferență: {diferenta > 0 ? '+' : ''}{diferenta.toFixed(1)} L ({procentDif > 0 ? '+' : ''}{procentDif.toFixed(1)}%)
                  </div>
                  <div style={{fontSize: 11, color: G.muted, marginTop: 2}}>{status}</div>
                </div>
              </div>
            </div>
          )
        })()}
        
        {/* Istoric alimentări (doar în view) */}
        {mode === 'view' && alimentari.length > 0 && (
          <div style={{marginBottom: 14}}>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8}}>
              <div style={{fontSize: 11, color: G.orange, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.6px'}}>
                ⛽ Alimentări combustibil ({alimentari.length})
              </div>
              <div style={{fontSize: 11, color: G.muted}}>
                Total: <strong style={{color: G.text}}>{alimentari.reduce((s, a) => s + Number(a.cantitate_litri || 0), 0).toFixed(2)} L</strong>
                {alimentari.some(a => a.pret_total) && <> · <strong style={{color: G.green}}>{alimentari.reduce((s, a) => s + Number(a.pret_total || 0), 0).toLocaleString('ro-RO', {minimumFractionDigits: 2, maximumFractionDigits: 2})} RON</strong></>}
              </div>
            </div>
            <div style={{...S.card, padding: 0, overflow: 'hidden'}}>
              {alimentari.slice(0, 10).map((a, idx) => (
                <div key={a.id} style={{
                  padding: '8px 14px',
                  borderBottom: idx < Math.min(alimentari.length, 10) - 1 ? `1px solid ${G.border}` : 'none',
                  display: 'grid',
                  gridTemplateColumns: '90px 70px 1fr auto',
                  gap: 12,
                  alignItems: 'center',
                  fontSize: 12
                }}>
                  <div style={{fontFamily: 'monospace', color: G.text, fontWeight: 600}}>
                    {fmtDate(a.data_alimentare)}
                  </div>
                  <div style={{color: G.orange, fontWeight: 700, fontVariantNumeric: 'tabular-nums'}}>
                    {Number(a.cantitate_litri).toFixed(1)} L
                  </div>
                  <div style={{color: G.muted, fontSize: 11}}>
                    {a.statie_combustibil && <span style={{color: G.text}}>{a.statie_combustibil}</span>}
                    {a.ore_la_alimentare && <> · {a.ore_la_alimentare.toLocaleString('ro-RO')} ore bord</>}
                    {a.km_la_alimentare && <> · {a.km_la_alimentare.toLocaleString('ro-RO')} km</>}
                    {a.ore_lucrate_efectiv && <> · {a.ore_lucrate_efectiv}h lucrate</>}
                    {a.observatii && <div style={{marginTop: 2, fontStyle: 'italic'}}>{a.observatii}</div>}
                  </div>
                  <div style={{color: G.green, fontWeight: 700, fontVariantNumeric: 'tabular-nums', fontSize: 13}}>
                    {a.pret_total ? `${Number(a.pret_total).toLocaleString('ro-RO', {minimumFractionDigits: 2, maximumFractionDigits: 2})} RON` : '—'}
                  </div>
                </div>
              ))}
              {alimentari.length > 10 && (
                <div style={{padding: '8px 14px', textAlign: 'center', fontSize: 11, color: G.muted, background: G.bg, borderTop: `1px solid ${G.border}`}}>
                  ... și încă {alimentari.length - 10} alimentări mai vechi
                </div>
              )}
            </div>
          </div>
        )}
        
        <div style={{display:'flex', justifyContent:'flex-end', gap: 8, paddingTop: 14, borderTop: `1px solid ${G.border}`}}>
          {mode !== 'view' && (
            <>
              <button onClick={onClose} style={{...S.btnS, fontSize: 13, color: G.muted}} disabled={saving}>Anulează</button>
              <button onClick={handleSave} disabled={saving} style={{...S.btnP, background: G.logistica, color: '#000', opacity: saving ? .6 : 1, cursor: saving ? 'wait' : 'pointer'}}>
                {saving ? '⏳ Se salvează...' : (mode === 'create' ? '✓ Creează activul' : '✓ Salvează modificările')}
              </button>
            </>
          )}
          {mode === 'view' && <button onClick={onClose} style={{...S.btnS, fontSize: 13}}>Închide</button>}
        </div>
      </div>
      
      {/* Modal mentenanță făcută (peste view) */}
      {showMent && (
        <MentenantaFacutaModal 
          activ={activ}
          plan={mentenanta}
          onClose={() => setShowMent(false)}
          onSaved={() => {
            setShowMent(false)
            supabase.from('logistica_mentenanta_istoric')
              .select('*').eq('active_id', activ.id)
              .order('data_revizie', { ascending: false })
              .then(({ data }) => setIstoric(data || []))
            onSaved()
          }}
          showToast={showToast}
        />
      )}
      
      {/* Modal alimentare combustibil */}
      {showAlim && (
        <AlimentareModal 
          activ={activ}
          rezervorGazpet={rezervorGazpet}
          sites={sites}
          pretMotorina={pretMotorina}
          onClose={() => setShowAlim(false)}
          onSaved={() => {
            setShowAlim(false)
            supabase.from('logistica_alimentari')
              .select('*').eq('active_id', activ.id)
              .order('data_alimentare', { ascending: false })
              .then(({ data }) => setAlimentari(data || []))
            onSaved()
          }}
          showToast={showToast}
        />
      )}
    </div>
  )
}

// ─── Pagina principală ───────────────────────────────────────────────────────
export default function LogisticaPage() {
  const nav = useNavigate()
  const [profile, setProfile] = useState(null)
  const [accessLevel, setAccessLevel] = useState(undefined)
  const [active, setActive] = useState([])
  const [categorii, setCategorii] = useState([])
  const [kpi, setKpi] = useState(null)
  const [load, setLoad] = useState(true)
  const [search, setSearch] = useState('')
  const [tipF, setTipF] = useState('Toate')
  const [subF, setSubF] = useState('Toate')
  const [stareF, setStareF] = useState('Toate')
  const [sortBy, setSortBy] = useState({ col: 'marca', dir: 'asc' })  // sortare tabel
  const [modal, setModal] = useState(null)
  const [rezervor, setRezervor] = useState(null)         // rezervorul Gazpet Oscar
  const [sites, setSites] = useState([])                  // pentru alocare alimentare pe șantier
  const [pretMotorina, setPretMotorina] = useState(null) // preț curent
  const [pretMotorinaActualizat, setPretMotorinaActualizat] = useState(null)
  const [showAchizitie, setShowAchizitie] = useState(false)
  const [showEditStoc, setShowEditStoc] = useState(false)
  const [showSetariPret, setShowSetariPret] = useState(false)
  const [toast, showToast] = useToast()
  
  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setAccessLevel(null); return }
      const [{ data: prof }, { data: access }] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user.id).single(),
        supabase.from('user_module_access').select('access_level').eq('profile_id', user.id).eq('module', 'Logistică').maybeSingle()
      ])
      setProfile(prof)
      if (prof?.role === 'superadmin') setAccessLevel('admin')
      else setAccessLevel(access?.access_level || null)
    }
    init()
  }, [])
  
  useEffect(() => { if (accessLevel) loadAll() }, [accessLevel])
  
  const loadAll = async () => {
    setLoad(true)
    const [activeRes, catRes, kpiRes, rezRes, sitesRes, setariRes] = await Promise.all([
      supabase.from('logistica_active')
        .select('*, logistica_categorii(tip, subcategorie), logistica_mentenanta_plan(urmatoarea_data, urmatoarea_ore)')
        .order('marca', { ascending: true }).order('model', { ascending: true }),
      supabase.from('logistica_categorii').select('*').order('tip').order('subcategorie'),
      supabase.from('v_kpi_logistica').select('*').single(),
      supabase.from('logistica_rezervoare').select('*').eq('nume', 'Gazpet - Oscar').maybeSingle(),
      supabase.from('sites').select('id, name').order('name'),
      supabase.from('logistica_setari').select('key, value').in('key', ['pret_motorina_ron', 'pret_motorina_actualizat']),
    ])
    setActive(activeRes.data || [])
    setCategorii(catRes.data || [])
    setKpi(kpiRes.data || null)
    setRezervor(rezRes.data || null)
    setSites(sitesRes.data || [])
    const setariMap = Object.fromEntries((setariRes.data || []).map(s => [s.key, s.value]))
    setPretMotorina(setariMap.pret_motorina_ron || null)
    setPretMotorinaActualizat(setariMap.pret_motorina_actualizat || null)
    setLoad(false)
  }
  
  const handleSaved = () => { loadAll(); setModal(null) }
  
  // ─── Export Excel ──────────────────────────────────────────────────────────
  const exportExcel = () => {
    const header = ['Cod intern', 'Nr inventar', 'Plăcuță', 'Marcă', 'Model', 'Tip', 'Subcategorie', 'An', 'Stare', 'Carburant', 'Normă consum', 'Unitate', 'Firmă', 'Mentenanță următoare', 'Zile până la scadență', 'Observații']
    const rows = filtered.map(a => {
      const cat = a.logistica_categorii
      const ment = a.logistica_mentenanta_plan?.[0]
      const days = ment?.urmatoarea_data ? daysUntil(ment.urmatoarea_data) : null
      return [
        a.cod_intern || '',
        a.nr_inventar || '',
        a.nr_inmatriculare || '',
        a.marca || '',
        a.model || '',
        cat?.tip || '',
        cat?.subcategorie || '',
        a.an_fabricatie || '',
        a.stare === 'Functional' ? 'Funcțional' : a.stare === 'Nefunctional' ? 'Nefuncțional' : a.stare === 'In_service' || a.stare === 'Service' ? 'În service' : (a.stare || ''),
        a.tip_carburant || '',
        a.norma_consum || '',
        a.unitate_norma || '',
        a.firma_proprietara || '',
        ment?.urmatoarea_data ? new Date(ment.urmatoarea_data).toLocaleDateString('ro-RO') : '',
        days !== null ? days : '',
        a.observatii || '',
      ]
    })
    
    const aoa = [
      [`Listă Active Logistică — ${new Date().toLocaleDateString('ro-RO')}`],
      [`${filtered.length} active${filtered.length !== active.length ? ` (filtrat din ${active.length})` : ''}`],
      [],
      header,
      ...rows
    ]
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    
    // Stiluri
    const titleStyle = { font: { bold: true, sz: 14, color: { rgb: 'E3B341' } } }
    const subtitleStyle = { font: { italic: true, sz: 10, color: { rgb: '8B949E' } } }
    const headerStyle = {
      fill: { fgColor: { rgb: '1F2937' } },
      font: { bold: true, color: { rgb: 'E3B341' }, sz: 10 },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: { top: { style: 'thin', color: { rgb: '30363D' } }, bottom: { style: 'thin', color: { rgb: '30363D' } }, left: { style: 'thin', color: { rgb: '30363D' } }, right: { style: 'thin', color: { rgb: '30363D' } } }
    }
    
    // Aplic stiluri
    if (ws['A1']) ws['A1'].s = titleStyle
    if (ws['A2']) ws['A2'].s = subtitleStyle
    header.forEach((_, c) => {
      const a = XLSX.utils.encode_cell({ r: 3, c })
      if (ws[a]) ws[a].s = headerStyle
    })
    
    // Lățimi coloane
    ws['!cols'] = [
      { wch: 10 }, { wch: 12 }, { wch: 13 }, { wch: 16 }, { wch: 22 }, { wch: 15 }, { wch: 18 },
      { wch: 6 }, { wch: 14 }, { wch: 11 }, { wch: 9 }, { wch: 8 }, { wch: 16 },
      { wch: 14 }, { wch: 9 }, { wch: 30 }
    ]
    
    // Merge cells pentru titlu
    ws['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 15 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 15 } },
    ]
    
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Active Logistică')
    
    const today = new Date().toISOString().split('T')[0]
    XLSX.writeFile(wb, `Logistica_Active_${today}.xlsx`)
    
    showToast(`✓ Exportat ${filtered.length} active`, 'success')
  }
  
  // ─── Template Excel pentru Alimentări ──────────────────────────────────────
  const downloadTemplateAlimentari = () => {
    const aoa = [
      ['📋 Template Alimentări Combustibil — Gazpet Logistică'],
      ['Completați coloanele de mai jos. Coloana A trebuie să fie codul intern (TST...) sau plăcuța din ERP.'],
      ['Datele se importă apoi prin butonul "📤 Import Excel" din modul Logistică.'],
      [],
      ['Cod intern SAU Plăcuță', 'Data alimentării (DD-MM-YYYY)', 'Cantitate (litri)', 'Ore bord la alim.', 'Km la alim.', 'Ore lucrate efectiv', 'Stație', 'Card combustibil', 'Cost total (RON)', 'Număr factură', 'Observații'],
      ['TST094', '01-05-2026', 50.5, 1250, '', 8, 'Petrom', '7059-XXXX-1234', 380.50, 'F-2026-0123', 'Alim. în drum spre Transgaz Orsova'],
      ['PH 99 GAZ', '03-05-2026', 40, '', 145000, 6, 'OMV', '7059-XXXX-5678', 305.00, '', ''],
    ]
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    
    const titleStyle = { font: { bold: true, sz: 14, color: { rgb: 'E3B341' } } }
    const noteStyle = { font: { italic: true, sz: 10, color: { rgb: '8B949E' } } }
    const headerStyle = {
      fill: { fgColor: { rgb: '2D2A1A' } },
      font: { bold: true, color: { rgb: 'E3B341' }, sz: 10 },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
      border: { top: { style: 'thin', color: { rgb: '30363D' } }, bottom: { style: 'thin', color: { rgb: '30363D' } }, left: { style: 'thin', color: { rgb: '30363D' } }, right: { style: 'thin', color: { rgb: '30363D' } } }
    }
    const exampleStyle = { fill: { fgColor: { rgb: 'FFFCE0' } }, font: { italic: true, sz: 10, color: { rgb: '6E7681' } } }
    
    if (ws['A1']) ws['A1'].s = titleStyle
    if (ws['A2']) ws['A2'].s = noteStyle
    if (ws['A3']) ws['A3'].s = noteStyle
    
    const headerCells = ['A5','B5','C5','D5','E5','F5','G5','H5','I5','J5','K5']
    headerCells.forEach(a => { if (ws[a]) ws[a].s = headerStyle })
    
    // Stiluri exemplu (rândurile 6 și 7)
    for (let r = 5; r <= 6; r++) {
      for (let c = 0; c < 11; c++) {
        const a = XLSX.utils.encode_cell({ r, c })
        if (ws[a]) ws[a].s = exampleStyle
      }
    }
    
    ws['!cols'] = [
      { wch: 22 }, { wch: 18 }, { wch: 12 }, { wch: 14 }, { wch: 14 },
      { wch: 14 }, { wch: 14 }, { wch: 18 }, { wch: 13 }, { wch: 14 }, { wch: 30 }
    ]
    ws['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 10 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 10 } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: 10 } },
    ]
    
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Alimentări')
    XLSX.writeFile(wb, 'Template_Alimentari_Logistica.xlsx')
    showToast('✓ Template descărcat — completați și importați înapoi', 'success')
  }
  
  // ─── Import alimentări din Excel ───────────────────────────────────────────
  const [importPreview, setImportPreview] = useState(null)  // { rows: [...], errors: [...] }
  const fileInputRef = useState({ current: null })
  
  const handleImportFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    
    try {
      const buffer = await file.arrayBuffer()
      const wb = XLSX.read(buffer, { type: 'array', cellDates: true })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, raw: false })
      
      // Caut rândul cu header (cel cu "Cod intern" sau "Cantitate")
      let headerRow = -1
      for (let i = 0; i < Math.min(aoa.length, 10); i++) {
        const row = (aoa[i] || []).map(x => String(x || '').toLowerCase())
        if (row.some(c => c.includes('cantitate')) && row.some(c => c.includes('cod') || c.includes('plăcuță') || c.includes('placuta'))) {
          headerRow = i; break
        }
      }
      if (headerRow === -1) { showToast('Nu am găsit antetul în fișier. Folosește template-ul oficial!', 'error'); e.target.value = ''; return }
      
      const dataRows = aoa.slice(headerRow + 1).filter(r => r && r.length > 0 && (r[0] || r[1] || r[2]))
      
      const rows = []
      const errors = []
      
      dataRows.forEach((r, idx) => {
        const codOrPlate = String(r[0] || '').trim()
        const data = r[1]
        const cantitate = r[2]
        
        if (!codOrPlate) return  // skip exemple goale
        
        // Match activ
        const matched = active.find(a => 
          a.cod_intern?.toLowerCase() === codOrPlate.toLowerCase() ||
          a.nr_inmatriculare?.toLowerCase() === codOrPlate.toLowerCase() ||
          a.nr_inventar?.toLowerCase() === codOrPlate.toLowerCase()
        )
        
        if (!matched) {
          errors.push(`Rând ${idx + headerRow + 2}: Activ negăsit pentru "${codOrPlate}"`)
          return
        }
        if (!cantitate || isNaN(Number(cantitate)) || Number(cantitate) <= 0) {
          errors.push(`Rând ${idx + headerRow + 2}: Cantitate invalidă pentru "${codOrPlate}"`)
          return
        }
        
        // Parsare data
        let dataAlim
        if (data instanceof Date) {
          dataAlim = data.toISOString().split('T')[0]
        } else if (typeof data === 'string') {
          // încercăm DD-MM-YYYY sau DD/MM/YYYY sau YYYY-MM-DD
          const m = data.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/)
          if (m) {
            dataAlim = `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`
          } else if (/^\d{4}-\d{2}-\d{2}/.test(data)) {
            dataAlim = data.substring(0, 10)
          } else {
            errors.push(`Rând ${idx + headerRow + 2}: Data invalidă "${data}"`)
            return
          }
        } else {
          errors.push(`Rând ${idx + headerRow + 2}: Data lipsă`)
          return
        }
        
        rows.push({
          active_id: matched.id,
          activ_label: `${matched.cod_intern || matched.nr_inmatriculare} · ${matched.marca || ''} ${matched.model || ''}`.trim(),
          data_alimentare: dataAlim,
          cantitate_litri: Number(cantitate),
          ore_la_alimentare: r[3] ? Number(r[3]) : null,
          km_la_alimentare: r[4] ? Number(r[4]) : null,
          ore_lucrate_efectiv: r[5] ? Number(r[5]) : null,
          statie_combustibil: r[6] ? String(r[6]).trim() : null,
          card_combustibil: r[7] ? String(r[7]).trim() : null,
          pret_total: r[8] ? Number(r[8]) : null,
          numar_factura: r[9] ? String(r[9]).trim() : null,
          observatii: r[10] ? String(r[10]).trim() : null,
        })
      })
      
      setImportPreview({ rows, errors, fileName: file.name })
      e.target.value = ''
    } catch (err) {
      console.error(err)
      showToast(`Eroare la citire: ${err.message}`, 'error')
      e.target.value = ''
    }
  }
  
  const handleImportConfirm = async () => {
    if (!importPreview?.rows?.length) return
    const { data: { user } } = await supabase.auth.getUser()
    
    const payload = importPreview.rows.map(r => {
      const { activ_label, ...rest } = r
      return { ...rest, pret_per_litru: r.pret_total && r.cantitate_litri ? Number((r.pret_total / r.cantitate_litri).toFixed(4)) : null, created_by: user?.id }
    })
    
    const { error } = await supabase.from('logistica_alimentari').insert(payload)
    if (error) { showToast(`Eroare import: ${error.message}`, 'error'); return }
    
    showToast(`✓ Import reușit: ${payload.length} alimentări`, 'success')
    setImportPreview(null)
    loadAll()
  }
  
  const tipuri = useMemo(() => ['Toate', ...Array.from(new Set(categorii.map(c => c.tip))).sort()], [categorii])
  const subcategoriiPentruTip = useMemo(() => {
    if (tipF === 'Toate') return []
    const subs = categorii.filter(c => c.tip === tipF && c.subcategorie).map(c => c.subcategorie)
    return ['Toate', ...subs.sort()]
  }, [tipF, categorii])
  
  const filtered = useMemo(() => {
    const result = active.filter(a => {
      const cat = a.logistica_categorii
      if (search) {
        const s = search.toLowerCase()
        const haystack = [a.cod_intern, a.nr_inventar, a.nr_inmatriculare, a.marca, a.model, a.observatii, cat?.tip, cat?.subcategorie].filter(Boolean).join(' ').toLowerCase()
        if (!haystack.includes(s)) return false
      }
      if (tipF !== 'Toate' && cat?.tip !== tipF) return false
      if (subF !== 'Toate' && cat?.subcategorie !== subF) return false
      if (stareF !== 'Toate' && a.stare !== stareF) return false
      return true
    })
    
    // Sortare
    const dir = sortBy.dir === 'asc' ? 1 : -1
    const getValue = (a) => {
      const cat = a.logistica_categorii
      const ment = a.logistica_mentenanta_plan?.[0]
      switch(sortBy.col) {
        case 'cod_intern': return a.cod_intern || 'zzz'
        case 'nr_inventar': return a.nr_inventar || 'zzz'
        case 'nr_inmatriculare': return a.nr_inmatriculare || 'zzz'
        case 'marca': return [(a.marca || 'zzz').toLowerCase(), (a.model || '').toLowerCase()].join(' ')
        case 'tip': return [(cat?.tip || 'zzz').toLowerCase(), (cat?.subcategorie || '').toLowerCase()].join(' ')
        case 'an': return a.an_fabricatie || 0
        case 'stare': return a.stare || 'zzz'
        case 'mentenanta': return ment?.urmatoarea_data ? new Date(ment.urmatoarea_data).getTime() : 9999999999999
        default: return ''
      }
    }
    result.sort((a, b) => {
      const va = getValue(a), vb = getValue(b)
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir
      return String(va).localeCompare(String(vb), 'ro') * dir
    })
    return result
  }, [active, search, tipF, subF, stareF, sortBy])
  
  // Calculez alerte mentenanță (pentru widget)
  const alerteMentenanta = useMemo(() => {
    const intarziate = []
    const urgente = []  // <= 7 zile
    const apropiate = []  // 8-30 zile
    active.forEach(a => {
      const ment = a.logistica_mentenanta_plan?.[0]
      if (!ment?.urmatoarea_data) return
      const days = daysUntil(ment.urmatoarea_data)
      if (days === null) return
      if (days < 0) intarziate.push(a)
      else if (days <= 7) urgente.push(a)
      else if (days <= 30) apropiate.push(a)
    })
    return { intarziate, urgente, apropiate }
  }, [active])
  
  if (accessLevel === undefined) return <div style={{...S.page, display: 'flex', alignItems: 'center', justifyContent: 'center'}}><div className="sp" style={{width: 28, height: 28}}/></div>
  
  if (accessLevel === null) return (
    <div style={{...S.page, padding: '60px 32px', textAlign: 'center'}}>
      <div style={{fontSize: 80, marginBottom: 16}}>🔒</div>
      <div style={{fontSize: 20, fontWeight: 800, color: G.text, marginBottom: 8}}>Acces interzis</div>
      <div style={{fontSize: 14, color: G.muted, marginBottom: 24}}>
        Nu ai permisiunea de a accesa modulul Logistică.<br/>
        Contactează administratorul pentru acces.
      </div>
      <button onClick={() => nav('/')} style={S.btnP}>← Înapoi la Acasă</button>
    </div>
  )
  
  const canEdit = accessLevel === 'admin' || accessLevel === 'editor'
  
  return (
    <>
      <Toast toast={toast}/>
      
      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 12}}>
        <div>
          <div style={{display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4}}>
            <span style={{fontSize: 24}}>🚛</span>
            <div style={{fontSize: 22, fontWeight: 800, color: G.text}}>Logistică</div>
            <span style={{fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 4, background: G.logistica + '22', color: G.logistica, letterSpacing: '.4px'}}>
              {accessLevel === 'admin' ? '⚙ ADMIN' : accessLevel === 'editor' ? '✎ EDITOR' : '👁 VIEWER'}
            </span>
          </div>
          <div style={{fontSize: 12, color: G.muted}}>
            {filtered.length}{filtered.length !== active.length ? ` din ${active.length}` : ''} active · {profile?.name}
          </div>
        </div>
      </div>
      
      {kpi && (
        <div style={{display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap'}}>
          <KPICard icon="🚛" label="Total active" value={kpi.nr_total_active} color={G.blue} />
          <KPICard icon="✓" label="Funcționale" value={kpi.nr_functionale} color={G.green} sub={`${kpi.procent_functionale}%`} />
          <KPICard icon="✗" label="Nefuncționale" value={kpi.nr_nefunctionale} color={G.red} />
          <KPICard icon="🔧" label="În service" value={kpi.nr_in_service} color={G.yellow} />
          <KPICard icon="📅" label="Scadențe 30z" value={kpi.nr_scadente_30_zile} color={G.orange} />
          <KPICard icon="📄" label="Doc. expirate" value={kpi.nr_documente_expirate} color={G.red} />
        </div>
      )}
      
      {/* Widget Rezervor Gazpet + Preț motorină */}
      <div style={{display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap'}}>
        {rezervor && (() => {
          const stoc = Number(rezervor.stoc_curent_litri || 0)
          const cap = Number(rezervor.capacitate_litri || 0)
          const pragProc = Number(rezervor.prag_alerta_procent || 10)
          const pragLitri = cap * pragProc / 100
          const procentUmplere = cap > 0 ? (stoc / cap) * 100 : 0
          const isLow = stoc <= pragLitri
          const isCritic = stoc <= pragLitri / 2
          
          let barColor, statusText, statusColor
          if (isCritic) { barColor = G.red; statusText = '🚨 STOC CRITIC — comandă urgent!'; statusColor = G.red }
          else if (isLow) { barColor = G.orange; statusText = '⚠️ Sub pragul de alertă'; statusColor = G.orange }
          else if (procentUmplere > 90) { barColor = G.green; statusText = '✓ Rezervor plin'; statusColor = G.green }
          else { barColor = G.blue; statusText = '✓ Stoc normal'; statusColor = G.blue }
          
          return (
            <div style={{...S.card, padding: '12px 16px', flex: 2, minWidth: 360, borderLeft: `3px solid ${barColor}`}}>
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8}}>
                <div>
                  <div style={{fontSize: 11, color: G.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px'}}>
                    📦 {rezervor.nume}
                  </div>
                  <div style={{fontSize: 22, fontWeight: 800, color: G.text, fontVariantNumeric: 'tabular-nums', marginTop: 2}}>
                    {stoc.toLocaleString('ro-RO', {minimumFractionDigits: 1, maximumFractionDigits: 1})} <span style={{fontSize: 12, color: G.muted, fontWeight: 600}}>L</span>
                    <span style={{fontSize: 12, color: G.muted, fontWeight: 600, marginLeft: 8}}>/ {cap.toFixed(0)} L</span>
                  </div>
                </div>
                {canEdit && (
                  <div style={{display: 'flex', gap: 6}}>
                    <button onClick={() => setShowEditStoc(true)} style={{...S.btnS, fontSize: 11, color: G.yellow, borderColor: G.yellow + '55', padding: '5px 10px'}} title="Ajustare manuală stoc (corecții)">
                      ✏️ Edit
                    </button>
                    <button onClick={() => setShowAchizitie(true)} style={{...S.btnS, fontSize: 11, color: G.purple, borderColor: G.purple + '55', padding: '5px 10px'}}>
                      + Achiziție vrac
                    </button>
                  </div>
                )}
              </div>
              <div style={{height: 8, background: G.bg, borderRadius: 4, overflow: 'hidden', marginBottom: 6}}>
                <div style={{
                  width: `${Math.min(procentUmplere, 100)}%`,
                  height: '100%',
                  background: barColor,
                  transition: 'width .3s'
                }}/>
              </div>
              <div style={{display: 'flex', justifyContent: 'space-between', fontSize: 11}}>
                <span style={{color: statusColor, fontWeight: 600}}>{statusText}</span>
                <span style={{color: G.muted}}>{procentUmplere.toFixed(0)}% · prag alertă: {pragProc}%</span>
              </div>
            </div>
          )
        })()}
        
        {/* Card preț motorină */}
        <div style={{...S.card, padding: '12px 16px', flex: 1, minWidth: 200, borderLeft: `3px solid ${G.green}`}}>
          <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4}}>
            <div style={{fontSize: 11, color: G.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px'}}>
              💰 Preț motorină
            </div>
            {canEdit && (
              <button onClick={() => setShowSetariPret(true)} style={{background:'transparent', border:'none', color:G.muted, fontSize: 14, cursor:'pointer', padding: 0, lineHeight: 1}} title="Editează preț">⚙️</button>
            )}
          </div>
          <div style={{fontSize: 22, fontWeight: 800, color: G.green, fontVariantNumeric: 'tabular-nums'}}>
            {pretMotorina ? Number(pretMotorina).toFixed(2) : '—'} <span style={{fontSize: 12, color: G.muted, fontWeight: 600}}>RON/L</span>
          </div>
          <div style={{fontSize: 10, color: G.muted, marginTop: 2}}>
            actualizat: {pretMotorinaActualizat || '—'}
          </div>
        </div>
      </div>
      {(alerteMentenanta.intarziate.length > 0 || alerteMentenanta.urgente.length > 0) && (
        <div style={{
          ...S.card,
          padding: '12px 16px',
          marginBottom: 14,
          borderLeft: `4px solid ${alerteMentenanta.intarziate.length > 0 ? G.red : G.orange}`,
          background: alerteMentenanta.intarziate.length > 0 ? G.redDim + '88' : G.yellowDim + '88',
        }}>
          <div style={{display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap'}}>
            <div style={{fontSize: 22}}>
              {alerteMentenanta.intarziate.length > 0 ? '⚠️' : '🔔'}
            </div>
            <div style={{flex: 1}}>
              <div style={{fontSize: 13, fontWeight: 700, color: G.text, marginBottom: 2}}>
                Atenție — mentenanță urgentă
              </div>
              <div style={{fontSize: 12, color: G.muted, display: 'flex', gap: 14, flexWrap: 'wrap'}}>
                {alerteMentenanta.intarziate.length > 0 && (
                  <span style={{color: G.red, fontWeight: 600}}>
                    🔴 {alerteMentenanta.intarziate.length} întârziate
                  </span>
                )}
                {alerteMentenanta.urgente.length > 0 && (
                  <span style={{color: G.orange, fontWeight: 600}}>
                    🟠 {alerteMentenanta.urgente.length} în următoarele 7 zile
                  </span>
                )}
                {alerteMentenanta.apropiate.length > 0 && (
                  <span style={{color: G.yellow, fontWeight: 600}}>
                    🟡 {alerteMentenanta.apropiate.length} în 8-30 zile
                  </span>
                )}
              </div>
            </div>
            <button 
              onClick={() => setSortBy({ col: 'mentenanta', dir: 'asc' })}
              style={{...S.btnS, fontSize: 12, color: G.logistica, borderColor: G.logistica + '55'}}>
              📅 Sortează după scadență
            </button>
          </div>
        </div>
      )}
      
      <div style={{...S.card, padding: 14, marginBottom: 14}}>
        <div style={{display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center'}}>
          <input placeholder="🔍 Caută marcă, model, plăcuță, cod..." value={search} onChange={e => setSearch(e.target.value)} style={{...S.input, width: 280}}/>
          <select value={tipF} onChange={e => { setTipF(e.target.value); setSubF('Toate') }}>
            {tipuri.map(t => <option key={t} value={t}>{t === 'Toate' ? 'Toate tipurile' : t}</option>)}
          </select>
          {subcategoriiPentruTip.length > 0 && (
            <select value={subF} onChange={e => setSubF(e.target.value)}>
              {subcategoriiPentruTip.map(s => <option key={s} value={s}>{s === 'Toate' ? 'Toate subcategoriile' : s}</option>)}
            </select>
          )}
          <select value={stareF} onChange={e => setStareF(e.target.value)}>
            <option value="Toate">Toate stările</option>
            <option value="Functional">Funcțional</option>
            <option value="Nefunctional">Nefuncțional</option>
            <option value="In_service">În service</option>
          </select>
          {(search || tipF !== 'Toate' || subF !== 'Toate' || stareF !== 'Toate') && (
            <button onClick={() => { setSearch(''); setTipF('Toate'); setSubF('Toate'); setStareF('Toate') }} style={{...S.btnS, fontSize: 12, color: G.muted}}>
              ✕ Șterge filtre
            </button>
          )}
          <div style={{flex: 1}}/>
          <button onClick={downloadTemplateAlimentari} style={{...S.btnS, fontSize: 12, color: G.muted, borderColor: G.border}} title="Template Excel pentru șefii de echipă">
            📋 Template
          </button>
          {canEdit && (
            <label style={{...S.btnS, fontSize: 12, color: G.orange, borderColor: G.orange + '55', cursor: 'pointer', display: 'inline-flex', alignItems: 'center'}}>
              📤 Import alimentări
              <input type="file" accept=".xlsx,.xls" onChange={handleImportFile} style={{display: 'none'}} />
            </label>
          )}
          <button onClick={exportExcel} disabled={filtered.length === 0} style={{...S.btnS, fontSize: 12, color: G.green, borderColor: G.green + '55', opacity: filtered.length === 0 ? .4 : 1}}>
            📥 Excel
          </button>
          {canEdit && (
            <button onClick={() => setModal({ mode: 'create', activ: null })} style={{...S.btnP, background: G.logistica, color: '#000'}}>
              + Activ nou
            </button>
          )}
        </div>
      </div>
      
      {load ? (
        <div style={{display: 'flex', justifyContent: 'center', padding: 80}}><div className="sp" style={{width: 32, height: 32}}/></div>
      ) : filtered.length === 0 ? (
        <div style={{...S.card, padding: 60, textAlign: 'center', color: G.muted}}>
          <div style={{fontSize: 40, marginBottom: 12}}>🔍</div>
          <div style={{fontSize: 14}}>Niciun activ găsit cu filtrele aplicate</div>
        </div>
      ) : (
        <div style={{...S.card, overflow: 'hidden'}}>
          <div style={{overflowX: 'auto'}}>
            <table>
              <thead>
                <tr>
                  <SortableTh col="cod_intern" sortBy={sortBy} setSortBy={setSortBy} width={75}>Cod intern</SortableTh>
                  <SortableTh col="nr_inventar" sortBy={sortBy} setSortBy={setSortBy} width={90}>Nr inventar</SortableTh>
                  <SortableTh col="nr_inmatriculare" sortBy={sortBy} setSortBy={setSortBy} width={95}>Plăcuță</SortableTh>
                  <SortableTh col="marca" sortBy={sortBy} setSortBy={setSortBy}>Marcă · Model</SortableTh>
                  <SortableTh col="tip" sortBy={sortBy} setSortBy={setSortBy} width={170}>Categorie</SortableTh>
                  <SortableTh col="an" sortBy={sortBy} setSortBy={setSortBy} width={60}>An</SortableTh>
                  <SortableTh col="stare" sortBy={sortBy} setSortBy={setSortBy} width={120}>Stare</SortableTh>
                  <SortableTh col="mentenanta" sortBy={sortBy} setSortBy={setSortBy} width={150}>Mentenanță</SortableTh>
                  <th style={{width: 50}}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(a => {
                  const cat = a.logistica_categorii
                  const ment = a.logistica_mentenanta_plan?.[0]
                  return (
                    <tr key={a.id} onClick={() => setModal({ mode: 'view', activ: a })} style={{cursor: 'pointer'}}>
                      <td style={{fontFamily: 'monospace', fontSize: 12, color: G.blue, fontWeight: 600}}>
                        {a.cod_intern || <span style={{color: G.dim}}>—</span>}
                      </td>
                      <td style={{fontFamily: 'monospace', fontSize: 11, color: G.muted}}>
                        {a.nr_inventar || <span style={{color: G.dim}}>—</span>}
                      </td>
                      <td style={{fontSize: 12, fontWeight: 600, color: G.purple}}>
                        {a.nr_inmatriculare || <span style={{color: G.dim, fontWeight: 400}}>—</span>}
                      </td>
                      <td>
                        <div style={{fontWeight: 600, color: G.text}}>
                          {a.marca || <span style={{color: G.dim, fontWeight: 400}}>—</span>}
                        </div>
                        <div style={{fontSize: 11, color: G.muted, marginTop: 1}}>{a.model}</div>
                      </td>
                      <td>
                        {cat ? (
                          <div>
                            <div style={{fontSize: 12, fontWeight: 600, color: G.text}}>{cat.tip}</div>
                            {cat.subcategorie && <div style={{fontSize: 11, color: G.muted, marginTop: 1}}>{cat.subcategorie}</div>}
                          </div>
                        ) : <span style={{color: G.dim}}>—</span>}
                      </td>
                      <td style={{fontVariantNumeric: 'tabular-nums', color: G.muted, fontSize: 12}}>
                        {a.an_fabricatie || '—'}
                      </td>
                      <td><StareBadge stare={a.stare} /></td>
                      <td><MentenantaScadenta data={ment?.urmatoarea_data} ore={ment?.urmatoarea_ore} /></td>
                      <td style={{textAlign: 'center', color: G.dim}}>›</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div style={{padding: '10px 14px', borderTop: `1px solid ${G.border}`, fontSize: 11, color: G.muted, background: G.bg}}>
            {filtered.length} active afișate · click pe rând pentru detalii{canEdit ? ' / editare' : ''}
          </div>
        </div>
      )}
      
      {modal && (
        <ActivFormModal 
          activ={modal.activ}
          initialMode={modal.mode}
          categorii={categorii}
          accessLevel={accessLevel}
          rezervorGazpet={rezervor}
          sites={sites}
          pretMotorina={pretMotorina}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
          showToast={showToast}
        />
      )}
      
      {/* Modal achiziție vrac */}
      {showAchizitie && rezervor && (
        <AchizitieVracModal 
          rezervor={rezervor}
          onClose={() => setShowAchizitie(false)}
          onSaved={() => { setShowAchizitie(false); loadAll() }}
          showToast={showToast}
        />
      )}
      
      {/* Modal edit stoc rezervor (corecții manuale) */}
      {showEditStoc && rezervor && (
        <EditStocModal 
          rezervor={rezervor}
          onClose={() => setShowEditStoc(false)}
          onSaved={() => { setShowEditStoc(false); loadAll() }}
          showToast={showToast}
        />
      )}
      
      {/* Modal setări preț motorină */}
      {showSetariPret && (
        <SetariMotorinaModal 
          pret={pretMotorina}
          dataActualizat={pretMotorinaActualizat}
          onClose={() => setShowSetariPret(false)}
          onSaved={() => { setShowSetariPret(false); loadAll() }}
          showToast={showToast}
        />
      )}
      
      {/* Modal Import Preview */}
      {importPreview && (
        <div onClick={() => setImportPreview(null)} style={{position:'fixed', inset:0, background:'#000000cc', zIndex:300, display:'flex', alignItems:'flex-start', justifyContent:'center', padding:'30px 16px', overflowY:'auto'}}>
          <div onClick={e => e.stopPropagation()} style={{...S.card, padding: 20, width: '100%', maxWidth: 880, boxShadow: '0 20px 80px rgba(0,0,0,.6)', borderTop: `3px solid ${G.orange}`}} className="fi">
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom: 14, paddingBottom: 12, borderBottom: `1px solid ${G.border}`}}>
              <div>
                <div style={{fontSize: 17, fontWeight: 800, color: G.text, marginBottom: 4}}>
                  📤 Import alimentări — preview
                </div>
                <div style={{fontSize: 12, color: G.muted}}>
                  Fișier: <strong style={{color: G.text}}>{importPreview.fileName}</strong> · 
                  <span style={{color: G.green, marginLeft: 6}}>{importPreview.rows.length} ok</span>
                  {importPreview.errors.length > 0 && <span style={{color: G.red, marginLeft: 6}}>· {importPreview.errors.length} cu probleme</span>}
                </div>
              </div>
              <button onClick={() => setImportPreview(null)} style={{background:'transparent', border:'none', color:G.muted, fontSize: 22, cursor:'pointer', padding: 4}}>×</button>
            </div>
            
            {importPreview.errors.length > 0 && (
              <div style={{...S.card, padding: 10, marginBottom: 12, background: G.redDim + '88', borderColor: G.red + '55'}}>
                <div style={{fontSize: 12, fontWeight: 700, color: G.red, marginBottom: 6}}>⚠️ Probleme detectate (rândurile vor fi sărite):</div>
                <ul style={{margin: 0, paddingLeft: 20, fontSize: 11, color: G.muted}}>
                  {importPreview.errors.slice(0, 10).map((e, i) => <li key={i}>{e}</li>)}
                  {importPreview.errors.length > 10 && <li>... și încă {importPreview.errors.length - 10} probleme</li>}
                </ul>
              </div>
            )}
            
            {importPreview.rows.length > 0 ? (
              <div style={{...S.card, overflow: 'hidden', marginBottom: 14, maxHeight: 400, overflowY: 'auto'}}>
                <table>
                  <thead>
                    <tr>
                      <th style={{width: 90}}>Data</th>
                      <th>Activ</th>
                      <th style={{width: 70}}>Cantit.</th>
                      <th style={{width: 90}}>Stație</th>
                      <th style={{width: 80}}>Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importPreview.rows.slice(0, 50).map((r, i) => (
                      <tr key={i}>
                        <td style={{fontFamily: 'monospace', fontSize: 12}}>{fmtDate(r.data_alimentare)}</td>
                        <td style={{fontSize: 12, color: G.text}}>{r.activ_label}</td>
                        <td style={{fontSize: 12, color: G.orange, fontWeight: 700}}>{r.cantitate_litri} L</td>
                        <td style={{fontSize: 11, color: G.muted}}>{r.statie_combustibil || '—'}</td>
                        <td style={{fontSize: 12, color: G.green, fontWeight: 600}}>{r.pret_total ? `${Number(r.pret_total).toFixed(2)} RON` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {importPreview.rows.length > 50 && (
                  <div style={{padding: 10, textAlign: 'center', fontSize: 11, color: G.muted, background: G.bg, borderTop: `1px solid ${G.border}`}}>
                    ... și încă {importPreview.rows.length - 50} înregistrări (toate vor fi importate)
                  </div>
                )}
              </div>
            ) : (
              <div style={{padding: 30, textAlign: 'center', color: G.muted}}>Nicio înregistrare validă de importat</div>
            )}
            
            <div style={{display:'flex', justifyContent:'flex-end', gap: 8, paddingTop: 12, borderTop: `1px solid ${G.border}`}}>
              <button onClick={() => setImportPreview(null)} style={{...S.btnS, fontSize: 13, color: G.muted}}>Anulează</button>
              <button onClick={handleImportConfirm} disabled={importPreview.rows.length === 0} style={{...S.btnP, background: G.orange, opacity: importPreview.rows.length === 0 ? .4 : 1}}>
                ✓ Importă {importPreview.rows.length} alimentări
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
