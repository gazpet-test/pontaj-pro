// ════════════════════════════════════════════════════════════════════════════
// MODULUL LOGISTICĂ — v2.0 (Pasul B: Edit + Create)
// ════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from './lib/supabase.js'
import * as XLSX from 'xlsx-js-style'
import LOGO_B64 from './logo.js'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'
import JSZip from 'jszip'
import ServiceTab from './ServiceTab.jsx'
import DocumenteFlotaPage, { DocumenteUtilajList } from './DocumenteFlotaPage.jsx'
import ImportEvoGPSModal from './ImportEvoGPSModal.jsx'
import ImportRompetrolModal from './ImportRompetrolModal.jsx'
import Tichete from './Tichete.jsx'
import TicheteWidget from './TicheteWidget.jsx'
import SugestiiScorilosTab from './SugestiiScorilosTab.jsx'

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
const TIPURI_CARBURANT = [
  { value: '', label: '— niciunul —' },
  { value: 'motorina', label: '⛽ Motorină' },
  { value: 'benzina', label: '⛽ Benzină' },
  { value: 'electric', label: '⚡ Electric' },
  { value: 'gpl', label: '🔥 GPL' },
  { value: 'mixt', label: '🔋 Mixt (hibrid)' },
]
const FIRME = ['Gazpet Instal', 'Gazpet Invest', 'Alt proprietar']
const UNITATI_NORMA = ['l/h', 'l/100km', 'kWh/h', 'kWh/100km']

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
function StareBadge({ stare, deepSleep }) {
  // ETAPA 8.7: Deep Sleep override - când e activ, afișez badge dedicat indiferent de stare
  if (deepSleep) {
    return <span style={{display:'inline-block',padding:'3px 10px',borderRadius:12,fontSize:11,fontWeight:700,letterSpacing:'.3px',background:'#8B5CF622',color:'#A78BFA'}}>💤 Deep Sleep</span>
  }
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

// ─── Card statistici per perioadă (azi/săptămână/lună alimentări) ────────────
function PerioadaCard({ label, data, suffix, color }) {
  const litri = Number(data[`litri_${suffix}`] || 0)
  const utilaje = Number(data[`utilaje_${suffix}`] || 0)
  const alim = Number(data[`alim_${suffix}`] || 0)
  const cost = Number(data[`cost_${suffix}`] || 0)
  return (
    <div style={{...S.card, padding: '12px 16px', flex: 1, minWidth: 220, borderTop: `3px solid ${color}`}}>
      <div style={{fontSize: 11, color: G.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8}}>
        {label}
      </div>
      <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10}}>
        <div>
          <div style={{fontSize: 10, color: G.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.3px'}}>Motorină</div>
          <div style={{fontSize: 19, fontWeight: 800, color, fontVariantNumeric: 'tabular-nums'}}>
            {litri.toLocaleString('ro-RO', {minimumFractionDigits: 0, maximumFractionDigits: 1})} <span style={{fontSize: 11, color: G.muted, fontWeight: 600}}>L</span>
          </div>
        </div>
        <div>
          <div style={{fontSize: 10, color: G.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.3px'}}>Utilaje / Alim.</div>
          <div style={{fontSize: 19, fontWeight: 800, color: G.text, fontVariantNumeric: 'tabular-nums'}}>
            {utilaje} <span style={{fontSize: 11, color: G.muted, fontWeight: 600}}>/ {alim}</span>
          </div>
        </div>
      </div>
      {cost > 0 && (
        <div style={{marginTop: 6, paddingTop: 6, borderTop: `1px solid ${G.border}`, display: 'flex', justifyContent: 'space-between', fontSize: 11}}>
          <span style={{color: G.muted}}>💰 Cost</span>
          <strong style={{color: G.green, fontVariantNumeric: 'tabular-nums'}}>{cost.toLocaleString('ro-RO', {minimumFractionDigits: 2, maximumFractionDigits: 2})} RON</strong>
        </div>
      )}
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
const STATIE_GAZPET_OSCAR_1 = 'Gazpet - Oscar 1 (vrac propriu)'
const STATIE_GAZPET_OSCAR_2 = 'Gazpet - Oscar 2 (vrac propriu)'
const STATII = ['', STATIE_GAZPET_OSCAR_1, STATIE_GAZPET_OSCAR_2, 'Petrom', 'OMV', 'MOL', 'Rompetrol', 'Lukoil', 'Gazprom', 'Socar', 'Tinmar', 'Altele']
// Detectează dacă o stație e rezervor Gazpet (Oscar 1, Oscar 2 sau legacy fără număr)
const isStatieGazpet = (statie) => /^Gazpet\s*-\s*Oscar/i.test(statie || '')
// Match: 'Gazpet - Oscar 1 (vrac propriu)' → rezervor 'Gazpet - Oscar 1'
//        'Gazpet - Oscar 2 (vrac propriu)' → rezervor 'Gazpet - Oscar 2'
//        legacy fără număr → fallback la Oscar 1 (primul găsit)
const getRezervorPentruStatie = (statie, rezervoare) => {
  if (!isStatieGazpet(statie) || !Array.isArray(rezervoare) || !rezervoare.length) return null
  const m = String(statie).match(/Oscar\s*(\d+)/i)
  if (m) {
    const targetNum = Number(m[1])
    const found = rezervoare.find(r => {
      const rm = String(r.nume || '').match(/Oscar\s*(\d+)/i)
      return rm && Number(rm[1]) === targetNum
    })
    if (found) return found
  }
  // Fallback: Oscar 1 sau primul
  return rezervoare.find(r => /Oscar\s*1\b/i.test(r.nume || '')) || rezervoare[0] || null
}

function AlimentareModal({ activ, onClose, onSaved, showToast, rezervoare, sites, pretMotorina }) {
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
  const [lastEdited, setLastEdited] = useState(null)  // 'total' | 'pret' | null
  const [pretMediuGazpet, setPretMediuGazpet] = useState(null)
  // Anomalie ore/km la alimentare (Razvan 22.05.2026)
  const [anomalieConfirmata, setAnomalieConfirmata] = useState(false)
  const [anomalieMotiv, setAnomalieMotiv] = useState('')
  const setField = (k, v) => setForm(p => ({ ...p, [k]: v }))

  // Detectez anomalie: ore/km la alimentare < valoarea actuală din activ
  const oreNoi = Number(form.ore_la_alimentare) || 0
  const kmNoi = Number(form.km_la_alimentare) || 0
  const oreActuale = activ?.ore_functionare_actuale || 0
  const kmActuale = activ?.km_actuali || 0
  const anomalieOre = oreNoi > 0 && oreActuale > 0 && oreNoi < oreActuale
  const anomalieKm = kmNoi > 0 && kmActuale > 0 && kmNoi < kmActuale
  const hasAnomalie = anomalieOre || anomalieKm
  
  const isGazpet = isStatieGazpet(form.statie_combustibil)
  const rezervorActiv = useMemo(
    () => getRezervorPentruStatie(form.statie_combustibil, rezervoare),
    [form.statie_combustibil, rezervoare]
  )
  const stocCurent = rezervorActiv?.stoc_curent_litri ? Number(rezervorActiv.stoc_curent_litri) : 0
  const stocAfter = isGazpet && form.cantitate_litri ? stocCurent - Number(form.cantitate_litri) : null
  
  // Fetch preț mediu ponderat Gazpet (din achiziții vrac) — pentru rezervorul activ
  useEffect(() => {
    if (!rezervorActiv?.id) { setPretMediuGazpet(null); return }
    supabase.from('logistica_achizitii_vrac')
      .select('cantitate_litri, pret_per_litru')
      .eq('rezervor_id', rezervorActiv.id)
      .not('pret_per_litru', 'is', null)
      .then(({ data }) => {
        if (!data?.length) { setPretMediuGazpet(null); return }
        const totalLitri = data.reduce((s, a) => s + Number(a.cantitate_litri || 0), 0)
        const totalCost = data.reduce((s, a) => s + Number(a.cantitate_litri || 0) * Number(a.pret_per_litru || 0), 0)
        if (totalLitri > 0) setPretMediuGazpet((totalCost / totalLitri).toFixed(4))
      })
  }, [rezervorActiv?.id])
  
  // Pretul de bază folosit la auto-fill (Gazpet → mediu ponderat, altă stație → preț pompă)
  const pretBaza = isGazpet ? (pretMediuGazpet || pretMotorina) : pretMotorina
  
  // Sincronizare bidirecțională cost ↔ preț/litru când se schimbă cantitatea
  useEffect(() => {
    if (!form.cantitate_litri || Number(form.cantitate_litri) <= 0) return
    
    if (lastEdited === 'total' && form.pret_total) {
      // User a editat costul total → recalculez preț/litru
      const ppl = (Number(form.pret_total) / Number(form.cantitate_litri)).toFixed(4)
      setField('pret_per_litru', ppl)
    } else if (lastEdited === 'pret' && form.pret_per_litru) {
      // User a editat preț/litru → recalculez cost total
      const total = (Number(form.pret_per_litru) * Number(form.cantitate_litri)).toFixed(2)
      setField('pret_total', total)
    } else if (!lastEdited && pretBaza) {
      // Prima dată, prefill din preț de bază
      setField('pret_per_litru', Number(pretBaza).toFixed(2))
      setField('pret_total', (Number(form.cantitate_litri) * Number(pretBaza)).toFixed(2))
    }
  }, [form.cantitate_litri])
  
  // Handler pentru cost total (user editează)
  const handleTotalChange = (v) => {
    setField('pret_total', v)
    setLastEdited('total')
    if (v && form.cantitate_litri && Number(form.cantitate_litri) > 0) {
      const ppl = (Number(v) / Number(form.cantitate_litri)).toFixed(4)
      setField('pret_per_litru', ppl)
    } else if (!v) {
      setField('pret_per_litru', '')
    }
  }
  
  // Handler pentru preț/litru (user editează)
  const handlePretLChange = (v) => {
    setField('pret_per_litru', v)
    setLastEdited('pret')
    if (v && form.cantitate_litri && Number(form.cantitate_litri) > 0) {
      const total = (Number(v) * Number(form.cantitate_litri)).toFixed(2)
      setField('pret_total', total)
    } else if (!v) {
      setField('pret_total', '')
    }
  }
  
  // Validare preț/litru — warning pentru valori absurde
  const pretLNum = Number(form.pret_per_litru) || 0
  const isPretSuspect = form.pret_per_litru && (pretLNum < 1 || pretLNum > 20)
  
  const handleSave = async () => {
    if (!form.data_alimentare) { showToast('Selectează data', 'error'); return }
    if (!form.cantitate_litri || Number(form.cantitate_litri) <= 0) { showToast('Cantitatea trebuie > 0', 'error'); return }
    if (isGazpet && stocAfter !== null && stocAfter < 0) {
      const ok = window.confirm(`⚠️ ATENȚIE: Stocul rezervorului Gazpet va deveni NEGATIV (${stocAfter.toFixed(1)} L).\n\nVerifică dacă ai înregistrat toate achizițiile vrac.\n\nContinui oricum?`)
      if (!ok) return
    }
    if (isPretSuspect) {
      const ok = window.confirm(`⚠️ Preț/litru atipic: ${form.pret_per_litru} RON/L\n\nPentru motorină, prețul ar trebui între 6-9 RON/L.\nVerifică valorile introduse!\n\nContinui oricum?`)
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
      rezervor_id: isGazpet && rezervorActiv ? rezervorActiv.id : null,
      site_id: form.site_id ? Number(form.site_id) : null,
      created_by: user?.id,
      anomalie_confirmata: hasAnomalie ? anomalieConfirmata : false,
      anomalie_motiv: hasAnomalie && anomalieMotiv.trim() ? anomalieMotiv.trim() : null,
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
        
        {isGazpet && rezervorActiv && (
          <div style={{padding: 10, marginBottom: 12, background: G.purple + '15', border: `1px solid ${G.purple}55`, borderRadius: 8, fontSize: 12, color: G.text}}>
            <strong style={{color: G.purple}}>📦 {rezervorActiv.nume}</strong>
            <div style={{marginTop: 4, color: G.muted, fontSize: 11, lineHeight: 1.6}}>
              Stoc curent: <strong style={{color: G.text}}>{stocCurent.toFixed(1)} L</strong> din {Number(rezervorActiv.capacitate_litri).toFixed(0)} L total
              {form.cantitate_litri && stocAfter !== null && (
                <> · <strong style={{color: stocAfter < 0 ? G.red : stocAfter < (Number(rezervorActiv.capacitate_litri) * Number(rezervorActiv.prag_alerta_procent) / 100) ? G.orange : G.green}}>
                  După alimentare: {stocAfter.toFixed(1)} L
                </strong></>
              )}
              {pretMediuGazpet && <><br/>Preț mediu ponderat din achiziții vrac: <strong style={{color: G.text}}>{pretMediuGazpet} RON/L</strong></>}
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
        
        {/* Warning anomalie ore/km mai mici decât cele actuale (Razvan 22.05.2026) */}
        {hasAnomalie && (
          <div style={{padding: 12, background: G.redDim, border: `2px solid ${G.red}`, borderRadius: 8, marginBottom: 14}}>
            <div style={{fontSize: 13, fontWeight: 700, color: G.red, marginBottom: 6}}>
              ⚠️ Anomalie detectată — valoare mai mică decât cea actuală în sistem
            </div>
            <div style={{fontSize: 11, color: G.text, marginBottom: 10, lineHeight: 1.6}}>
              {anomalieOre && (
                <div>🕒 <strong>Ore introduse:</strong> {oreNoi.toLocaleString('ro-RO')} h &nbsp;·&nbsp; <strong>Ore actuale în sistem:</strong> {oreActuale.toLocaleString('ro-RO')} h &nbsp;·&nbsp; <strong style={{color: G.red}}>Diferență: -{(oreActuale - oreNoi).toLocaleString('ro-RO')} h</strong></div>
              )}
              {anomalieKm && (
                <div>🛣️ <strong>Km introduși:</strong> {kmNoi.toLocaleString('ro-RO')} km &nbsp;·&nbsp; <strong>Km actuali în sistem:</strong> {kmActuale.toLocaleString('ro-RO')} km &nbsp;·&nbsp; <strong style={{color: G.red}}>Diferență: -{(kmActuale - kmNoi).toLocaleString('ro-RO')} km</strong></div>
              )}
            </div>
            <FieldTextarea 
              label="Motiv (obligatoriu)" 
              value={anomalieMotiv} 
              onChange={setAnomalieMotiv} 
              rows={2} 
              placeholder="ex: defect contor, schimbat ceasul, etc." 
            />
            <label style={{display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 10, cursor: 'pointer', padding: 8, background: '#1a1a1a', borderRadius: 6, border: `1px solid ${anomalieConfirmata ? G.green : G.red}55`}}>
              <input 
                type="checkbox" 
                checked={anomalieConfirmata} 
                onChange={e => setAnomalieConfirmata(e.target.checked)}
                style={{marginTop: 2, cursor: 'pointer'}}
              />
              <span style={{fontSize: 12, fontWeight: 600, color: anomalieConfirmata ? G.green : G.text}}>
                Am luat la cunoștință — verific situația. Razvan/Marilena/admin_logistica vor primi notificare.
              </span>
            </label>
          </div>
        )}
        
        <div style={{marginBottom: 4}}>
          <div style={{fontSize: 11, color: G.orange, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 6}}>
            💳 Cost <span style={{fontSize: 10, color: G.muted, fontWeight: 500, textTransform: 'none', letterSpacing: 0}}>
              (auto-fill din {isGazpet && pretMediuGazpet ? `preț mediu Gazpet ${pretMediuGazpet} RON/L` : pretMotorina ? `preț pompă setat ${pretMotorina} RON/L` : 'cantitate × preț'} — editează oricare câmp pentru a recalcula celălalt)
            </span>
          </div>
        </div>
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap: 12, marginBottom: 8}}>
          <FieldText label="Preț per litru (RON/L)" value={form.pret_per_litru} onChange={handlePretLChange} type="number" placeholder="ex: 7.50" />
          <FieldText label="Cost total alimentare (RON)" value={form.pret_total} onChange={handleTotalChange} type="number" placeholder="ex: 380.50" />
        </div>
        
        {/* Warning preț atipic */}
        {isPretSuspect && (
          <div style={{padding: 10, background: G.redDim + '88', border: `1px solid ${G.red}55`, borderRadius: 8, marginBottom: 14, fontSize: 12, color: G.text}}>
            <strong style={{color: G.red}}>⚠️ Preț/litru atipic: {form.pret_per_litru} RON/L</strong>
            <div style={{marginTop: 4, color: G.muted, fontSize: 11, lineHeight: 1.5}}>
              Pentru motorină normală, prețul ar trebui între <strong>6-9 RON/L</strong>. Verifică:
              <br/>· Cantitatea introdusă e corectă? ({form.cantitate_litri} L)
              <br/>· Costul TOTAL e cel din factură, nu prețul per litru?
              <br/>· Calcul corect: <strong>cantitate × preț/L = cost total</strong>
            </div>
          </div>
        )}
        
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap: 12, marginBottom: 14}}>
          <FieldText label="Card combustibil" value={form.card_combustibil} onChange={v => setField('card_combustibil', v)} placeholder="ex: 7059-XXXX-1234" />
          <FieldText label="Număr factură" value={form.numar_factura} onChange={v => setField('numar_factura', v)} placeholder="ex: F-2026-1234" />
        </div>
        
        <div style={{marginBottom: 14}}>
          <FieldTextarea label="Observații" value={form.observatii} onChange={v => setField('observatii', v)} rows={2} />
        </div>
        
        <div style={{display:'flex', justifyContent:'flex-end', gap: 8, paddingTop: 14, borderTop: `1px solid ${G.border}`}}>
          <button onClick={onClose} style={{...S.btnS, fontSize: 13, color: G.muted}} disabled={saving}>Anulează</button>
          <button onClick={handleSave} 
            disabled={saving || (hasAnomalie && (!anomalieConfirmata || !anomalieMotiv.trim()))} 
            title={hasAnomalie && !anomalieConfirmata ? 'Bifează „Am luat la cunoștință” și completează motivul' : hasAnomalie && !anomalieMotiv.trim() ? 'Completează motivul anomaliei' : ''}
            style={{...S.btnP, background: G.orange, opacity: (saving || (hasAnomalie && (!anomalieConfirmata || !anomalieMotiv.trim()))) ? .5 : 1, cursor: (saving || (hasAnomalie && (!anomalieConfirmata || !anomalieMotiv.trim()))) ? 'not-allowed' : 'pointer'}}>
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
function ActivFormModal({ activ, initialMode, categorii, onClose, onSaved, accessLevel, showToast, rezervoare, sites, pretMotorina }) {
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
    // Dimensiuni transport
    lungime_m: a?.lungime_m || '',
    latime_m: a?.latime_m || '',
    inaltime_m: a?.inaltime_m || '',
    greutate_kg: a?.greutate_kg || '',
    regim_transport_special: a?.regim_transport_special || false,
    nr_autorizatie_arr: a?.nr_autorizatie_arr || '',
    valabilitate_autorizatie: a?.valabilitate_autorizatie || '',
    necesita_pilot: a?.necesita_pilot || false,
    restrictii_ore: a?.restrictii_ore || '',
    note_transport_special: a?.note_transport_special || '',
    // ETAPA 8.7: Deep Sleep — utilaj stricat lung, exclus din alerte
    deep_sleep: a?.deep_sleep || false,
    deep_sleep_motiv: a?.deep_sleep_motiv || '',
    deep_sleep_data: a?.deep_sleep_data || '',
  })
  
  const [form, setForm] = useState(fromActiv(activ))
  const setField = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const [showMent, setShowMent] = useState(false)
  const [showAlim, setShowAlim] = useState(false)
  const [istoric, setIstoric] = useState([])
  const [alimentari, setAlimentari] = useState([])
  // ETAPA 12.5: Ajustare km/ore cu audit
  const [kmNou, setKmNou] = useState('')
  const [oreNou, setOreNou] = useState('')
  const [motivAjust, setMotivAjust] = useState('')
  const [savingAjust, setSavingAjust] = useState(false)
  const [istoricAjustari, setIstoricAjustari] = useState([])
  const [showIstoricAjust, setShowIstoricAjust] = useState(false)
  
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
  
  // ETAPA 12.5: Fetch istoric ajustări km/ore + reset input-uri când se schimbă activ-ul
  useEffect(() => {
    if (activ?.id && (mode === 'view' || mode === 'edit')) {
      supabase.from('logistica_active_km_ore_ajustari')
        .select('*, autor:profiles!created_by(name)')
        .eq('activ_id', activ.id)
        .order('created_at', { ascending: false })
        .limit(20)
        .then(({ data }) => setIstoricAjustari(data || []))
    }
    setKmNou('')
    setOreNou('')
    setMotivAjust('')
  }, [activ?.id, mode])
  
  // ETAPA 12.5: Handler ajustare km/ore cu audit
  const handleAjustareKmOre = async () => {
    const kmCurent = activ?.km_actuali != null ? Number(activ.km_actuali) : null
    const oreCurent = activ?.ore_functionare_actuale != null ? Number(activ.ore_functionare_actuale) : null
    const kmNouNum = kmNou !== '' ? Number(kmNou) : null
    const oreNouNum = oreNou !== '' ? Number(oreNou) : null
    
    // Validare: cel puțin una din valori e modificată
    const kmModificat = kmNouNum !== null && kmNouNum !== kmCurent
    const oreModificat = oreNouNum !== null && oreNouNum !== oreCurent
    if (!kmModificat && !oreModificat) {
      showToast('Introdu cel puțin o valoare nouă diferită de cea curentă', 'warn')
      return
    }
    
    // Validare numerică
    if (kmNouNum !== null && (isNaN(kmNouNum) || kmNouNum < 0)) {
      showToast('Km nou trebuie să fie ≥ 0', 'warn'); return
    }
    if (oreNouNum !== null && (isNaN(oreNouNum) || oreNouNum < 0)) {
      showToast('Ore nou trebuie să fie ≥ 0', 'warn'); return
    }
    
    // Avertizare dacă reducere mare (peste 50%)
    if (kmModificat && kmCurent && kmNouNum < kmCurent * 0.5) {
      if (!confirm(`⚠️ Reduci km de la ${kmCurent.toLocaleString('ro-RO')} la ${kmNouNum.toLocaleString('ro-RO')} (peste 50% reducere). Sigur?`)) return
    }
    if (oreModificat && oreCurent && oreNouNum < oreCurent * 0.5) {
      if (!confirm(`⚠️ Reduci ore de la ${oreCurent.toLocaleString('ro-RO')} la ${oreNouNum.toLocaleString('ro-RO')} (peste 50% reducere). Sigur?`)) return
    }
    
    setSavingAjust(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      
      // 1. INSERT audit
      const auditPayload = {
        activ_id: activ.id,
        km_vechi: kmModificat ? kmCurent : null,
        km_nou: kmModificat ? kmNouNum : null,
        ore_vechi: oreModificat ? oreCurent : null,
        ore_nou: oreModificat ? oreNouNum : null,
        motiv: motivAjust.trim() || null,
        created_by: user?.id || null,
      }
      const { error: auditErr } = await supabase.from('logistica_active_km_ore_ajustari').insert(auditPayload)
      if (auditErr) throw auditErr
      
      // 2. UPDATE active
      const updatePayload = {}
      if (kmModificat) updatePayload.km_actuali = kmNouNum
      if (oreModificat) updatePayload.ore_functionare_actuale = oreNouNum
      const { error: updErr } = await supabase.from('logistica_active').update(updatePayload).eq('id', activ.id)
      if (updErr) throw updErr
      
      showToast('✓ Km/ore ajustate (audit salvat)', 'success')
      setKmNou(''); setOreNou(''); setMotivAjust('')
      // Re-fetch istoric ajustări
      const { data: newIst } = await supabase.from('logistica_active_km_ore_ajustari')
        .select('*, autor:profiles!created_by(name)')
        .eq('activ_id', activ.id)
        .order('created_at', { ascending: false })
        .limit(20)
      setIstoricAjustari(newIst || [])
      // Refresh parent list (km_actuali update vizibil în tabel)
      onSaved?.()
    } catch (e) {
      console.error('Eroare ajustare km/ore:', e)
      showToast(`Eroare: ${e.message || 'unknown'}`, 'error')
    }
    setSavingAjust(false)
  }
  
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
      // Dimensiuni & transport
      lungime_m: form.lungime_m ? Number(form.lungime_m) : null,
      latime_m: form.latime_m ? Number(form.latime_m) : null,
      inaltime_m: form.inaltime_m ? Number(form.inaltime_m) : null,
      greutate_kg: form.greutate_kg ? Number(form.greutate_kg) : null,
      regim_transport_special: !!form.regim_transport_special,
      nr_autorizatie_arr: form.nr_autorizatie_arr.trim() || null,
      valabilitate_autorizatie: form.valabilitate_autorizatie || null,
      necesita_pilot: !!form.necesita_pilot,
      restrictii_ore: form.restrictii_ore.trim() || null,
      note_transport_special: form.note_transport_special.trim() || null,
      // ETAPA 8.7: Deep Sleep
      deep_sleep: !!form.deep_sleep,
      deep_sleep_motiv: form.deep_sleep ? (form.deep_sleep_motiv?.trim() || null) : null,
      deep_sleep_data: form.deep_sleep ? (form.deep_sleep_data || new Date().toISOString().split('T')[0]) : null,
    }
    
    let result
    if (mode === 'create') {
      const { data: { user } } = await supabase.auth.getUser()
      // ETAPA 8.7: setez deep_sleep_by când user-ul bifează la creare
      if (form.deep_sleep) payload.deep_sleep_by = user?.id
      result = await supabase.from('logistica_active')
        .insert({ ...payload, created_by: user?.id })
        .select('*, logistica_categorii(tip, subcategorie), logistica_mentenanta_plan(urmatoarea_data, urmatoarea_ore)')
        .single()
    } else {
      // ETAPA 8.7: deep_sleep_by setat doar când utilajul TOCMAI a fost bifat (înainte nu era)
      if (form.deep_sleep && !activ?.deep_sleep) {
        const { data: { user } } = await supabase.auth.getUser()
        payload.deep_sleep_by = user?.id
      } else if (!form.deep_sleep) {
        // Dacă a fost debifat → reset by/data
        payload.deep_sleep_by = null
      }
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
                <StareBadge stare={activ?.stare} deepSleep={activ?.deep_sleep} />
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
        
        {/* ETAPA 8.7: Deep Sleep — utilaj stricat lung, exclus din alerte */}
        <div style={{marginBottom: 14, background: form.deep_sleep ? '#8B5CF622' : 'transparent', border: form.deep_sleep ? '1px solid #8B5CF655' : `1px dashed ${G.border}`, borderRadius: 10, padding: 14}}>
          <div style={{display:'flex', alignItems:'center', gap:10, marginBottom: form.deep_sleep ? 12 : 0}}>
            <input 
              type="checkbox" 
              id="deep_sleep_checkbox"
              checked={!!form.deep_sleep} 
              disabled={isReadOnly}
              onChange={e => setField('deep_sleep', e.target.checked)}
              style={{width:18, height:18, cursor: isReadOnly ? 'default' : 'pointer', accentColor: '#8B5CF6'}}
            />
            <label htmlFor="deep_sleep_checkbox" style={{flex:1, cursor: isReadOnly ? 'default' : 'pointer', userSelect:'none'}}>
              <div style={{fontSize: 13, color: form.deep_sleep ? '#A78BFA' : G.text, fontWeight: 700}}>
                💤 Deep Sleep {form.deep_sleep && <span style={{fontSize: 10, padding:'2px 8px', background:'#8B5CF633', color:'#A78BFA', borderRadius:10, marginLeft:8}}>ACTIV</span>}
              </div>
              <div style={{fontSize: 11, color: G.muted, marginTop: 2}}>
                Utilaj/vehicul stricat pe perioadă lungă. <strong>Exclus complet din alerte</strong> (revizii, scadențe, telemetrie). De expertizat dacă mai folosim sau casăm.
              </div>
            </label>
            {form.deep_sleep && activ?.deep_sleep_data && (
              <div style={{fontSize: 11, color: G.muted, textAlign:'right'}}>
                <div>din <strong style={{color:G.text}}>{new Date(activ.deep_sleep_data).toLocaleDateString('ro-RO')}</strong></div>
                <div style={{fontSize:10, color:G.dim, marginTop:2}}>acum {Math.floor((Date.now() - new Date(activ.deep_sleep_data).getTime()) / 86400000)} zile</div>
              </div>
            )}
          </div>
          {form.deep_sleep && (
            <div style={{display:'grid', gridTemplateColumns:'2fr 1fr', gap: 12}}>
              <FieldTextarea 
                label="Motiv deep sleep (opțional)" 
                value={form.deep_sleep_motiv} 
                onChange={v => setField('deep_sleep_motiv', v)} 
                rows={2}
                placeholder="ex: Așteptare expertiză - cutie viteze defectă. Decizie casare/reparare în curs."
                readonly={isReadOnly}
              />
              <FieldText 
                label="Data setării (default: azi)" 
                value={form.deep_sleep_data} 
                onChange={v => setField('deep_sleep_data', v)} 
                type="date"
                readonly={isReadOnly}
              />
            </div>
          )}
        </div>
        
        {/* ETAPA 12.5: Ajustare manuală km/ore cu audit - vizibil doar la edit/view pe utilaj existent */}
        {activ?.id && (mode === 'edit' || mode === 'view') && canEdit && (
          <div style={{marginBottom: 14, background: G.surface, border: `1px solid ${G.border}`, borderRadius: 10, padding: 14}}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: 12}}>
              <div>
                <div style={{fontSize: 13, color: G.text, fontWeight: 700}}>📏 Ajustare manuală km/ore</div>
                <div style={{fontSize: 11, color: G.muted, marginTop: 2}}>
                  Corectare valori curente (km_actuali / ore_functionare_actuale) cu audit istoric. Util când import EvoGPS sau parsing XLSX a polluat datele.
                </div>
              </div>
              {istoricAjustari.length > 0 && (
                <button onClick={() => setShowIstoricAjust(s => !s)} style={{
                  padding: '6px 12px', fontSize: 11, fontWeight: 600,
                  background: 'transparent', color: G.muted, border: `1px solid ${G.border}`,
                  borderRadius: 8, cursor: 'pointer',
                }}>
                  📜 Istoric ({istoricAjustari.length}) {showIstoricAjust ? '▼' : '▶'}
                </button>
              )}
            </div>
            
            {/* Valori curente afișate prominent */}
            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap: 12, marginBottom: 12}}>
              <div style={{background: G.bg, border: `1px solid ${G.border}`, borderRadius: 8, padding: '10px 12px'}}>
                <div style={{fontSize: 10, color: G.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 4}}>
                  🛣️ KM Actuali
                </div>
                <div style={{fontSize: 20, fontWeight: 800, color: G.blue, fontVariantNumeric: 'tabular-nums'}}>
                  {activ.km_actuali != null ? Number(activ.km_actuali).toLocaleString('ro-RO') : '—'}
                  <span style={{fontSize: 11, color: G.muted, fontWeight: 400, marginLeft: 6}}>km</span>
                </div>
              </div>
              <div style={{background: G.bg, border: `1px solid ${G.border}`, borderRadius: 8, padding: '10px 12px'}}>
                <div style={{fontSize: 10, color: G.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 4}}>
                  🕒 Ore Funcționare
                </div>
                <div style={{fontSize: 20, fontWeight: 800, color: G.orange, fontVariantNumeric: 'tabular-nums'}}>
                  {activ.ore_functionare_actuale != null ? Number(activ.ore_functionare_actuale).toLocaleString('ro-RO') : '—'}
                  <span style={{fontSize: 11, color: G.muted, fontWeight: 400, marginLeft: 6}}>h</span>
                </div>
              </div>
            </div>
            
            {!isReadOnly && (
              <>
                <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap: 12, marginBottom: 10}}>
                  <FieldText 
                    label="Km nou (las gol = nemodificat)" 
                    value={kmNou} 
                    onChange={v => setKmNou(v)} 
                    type="number" 
                    placeholder={activ.km_actuali != null ? `ex: ${Number(activ.km_actuali).toLocaleString('ro-RO')}` : 'ex: 12500'} 
                  />
                  <FieldText 
                    label="Ore nou (las gol = nemodificat)" 
                    value={oreNou} 
                    onChange={v => setOreNou(v)} 
                    type="number" 
                    placeholder={activ.ore_functionare_actuale != null ? `ex: ${Number(activ.ore_functionare_actuale).toLocaleString('ro-RO')}` : 'ex: 2122'} 
                  />
                </div>
                <FieldTextarea 
                  label="Motiv ajustare (opțional dar recomandat)" 
                  value={motivAjust} 
                  onChange={v => setMotivAjust(v)} 
                  rows={2}
                  placeholder="ex: Citire greșită din EvoGPS - era km al altei mașini / Corectare după inspecție fizică / Reset bord după reparație contor"
                />
                <div style={{marginTop: 10, display:'flex', gap:10, alignItems:'center', justifyContent:'flex-end'}}>
                  {(kmNou !== '' || oreNou !== '') && (
                    <div style={{fontSize: 11, color: G.muted}}>
                      {kmNou !== '' && <span>🛣️ <strong style={{color: G.blue}}>{Number(kmNou).toLocaleString('ro-RO')}</strong> km </span>}
                      {oreNou !== '' && <span>🕒 <strong style={{color: G.orange}}>{Number(oreNou).toLocaleString('ro-RO')}</strong> h</span>}
                    </div>
                  )}
                  <button 
                    onClick={handleAjustareKmOre} 
                    disabled={savingAjust || (kmNou === '' && oreNou === '')}
                    style={{
                      padding: '8px 16px', fontSize: 12, fontWeight: 700,
                      background: (kmNou === '' && oreNou === '') ? G.surface : G.blue,
                      color: (kmNou === '' && oreNou === '') ? G.muted : '#fff',
                      border: 'none', borderRadius: 8, 
                      cursor: (savingAjust || (kmNou === '' && oreNou === '')) ? 'not-allowed' : 'pointer',
                      opacity: savingAjust ? 0.6 : 1,
                    }}
                  >
                    {savingAjust ? '⏳ Se salvează...' : '💾 Salvează ajustarea'}
                  </button>
                </div>
              </>
            )}
            
            {/* Istoric ajustări - expandable */}
            {showIstoricAjust && istoricAjustari.length > 0 && (
              <div style={{marginTop: 14, paddingTop: 12, borderTop: `1px solid ${G.border}`}}>
                <div style={{fontSize: 11, color: G.muted, fontWeight: 700, textTransform: 'uppercase', marginBottom: 8}}>📜 Istoric ajustări</div>
                <div style={{maxHeight: 240, overflowY: 'auto'}}>
                  {istoricAjustari.map(aj => (
                    <div key={aj.id} style={{padding: 8, marginBottom: 6, background: G.bg, border: `1px solid ${G.border}`, borderRadius: 6, fontSize: 11}}>
                      <div style={{display:'flex', justifyContent:'space-between', marginBottom: 4}}>
                        <div style={{color: G.muted}}>
                          <strong style={{color: G.text}}>{aj.autor?.name || 'Necunoscut'}</strong> · {new Date(aj.created_at).toLocaleString('ro-RO')}
                        </div>
                      </div>
                      <div style={{display:'flex', gap: 14, flexWrap:'wrap'}}>
                        {aj.km_nou != null && (
                          <div>🛣️ <span style={{color: G.muted}}>{aj.km_vechi != null ? Number(aj.km_vechi).toLocaleString('ro-RO') : '—'}</span> → <strong style={{color: G.blue}}>{Number(aj.km_nou).toLocaleString('ro-RO')}</strong> km</div>
                        )}
                        {aj.ore_nou != null && (
                          <div>🕒 <span style={{color: G.muted}}>{aj.ore_vechi != null ? Number(aj.ore_vechi).toLocaleString('ro-RO') : '—'}</span> → <strong style={{color: G.orange}}>{Number(aj.ore_nou).toLocaleString('ro-RO')}</strong> h</div>
                        )}
                      </div>
                      {aj.motiv && <div style={{marginTop: 4, color: G.text, fontStyle: 'italic'}}>„{aj.motiv}"</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        
        <div style={{marginBottom: 14}}>
          <div style={{fontSize: 11, color: G.logistica, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.6px', marginBottom: 8}}>⚙️ Tehnice</div>
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap: 12}}>
            <FieldSelect label="Tip carburant" value={form.tip_carburant} onChange={v => {
              // Auto-suggest unitate_norma în funcție de tip carburant
              // Doar dacă unitatea curentă e default ('l/h' sau 'kWh/h' sau goală), n-o suprascriu pe custom
              const currentU = form.unitate_norma
              const isDefaultU = !currentU || currentU === 'l/h' || currentU === 'kWh/h'
              if (v === 'electric' && isDefaultU) {
                setForm(p => ({ ...p, tip_carburant: v, unitate_norma: 'kWh/h' }))
              } else if (v && v !== 'electric' && currentU === 'kWh/h') {
                // Trecere de la electric → carburant lichid: sugerez înapoi l/h
                setForm(p => ({ ...p, tip_carburant: v, unitate_norma: 'l/h' }))
              } else {
                setField('tip_carburant', v)
              }
            }} options={TIPURI_CARBURANT} placeholder="— niciunul —" readonly={isReadOnly} />
            <FieldText label="Normă consum" value={form.norma_consum} onChange={v => setField('norma_consum', v)} type="number" placeholder="ex: 12.5" readonly={isReadOnly} />
            <FieldSelect label="Unitate" value={form.unitate_norma} onChange={v => setField('unitate_norma', v)} options={UNITATI_NORMA} readonly={isReadOnly} />
            <FieldText label="Prag alertă consum (%)" value={form.prag_alerta_consum} onChange={v => setField('prag_alerta_consum', v)} type="number" placeholder="10" readonly={isReadOnly} />
            <FieldText label="Serie șasiu (VIN)" value={form.serie_sasiu} onChange={v => setField('serie_sasiu', v)} placeholder="ex: WDB9061..." readonly={isReadOnly} />
            <FieldSelect label="Firmă proprietară" value={form.firma_proprietara} onChange={v => setField('firma_proprietara', v)} options={FIRME} readonly={isReadOnly} />
          </div>
        </div>
        
        {/* DIMENSIUNI & TRANSPORT */}
        <div style={{marginBottom: 14}}>
          <div style={{fontSize: 11, color: G.logistica, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.6px', marginBottom: 8}}>🚚 Dimensiuni & Transport</div>
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap: 12, marginBottom: 12}}>
            <FieldText label="Lungime (m)" value={form.lungime_m} onChange={v => setField('lungime_m', v)} type="number" placeholder="ex: 12.50" readonly={isReadOnly} />
            <FieldText label="Lățime (m)" value={form.latime_m} onChange={v => setField('latime_m', v)} type="number" placeholder="ex: 2.40" readonly={isReadOnly} />
            <FieldText label="Înălțime (m)" value={form.inaltime_m} onChange={v => setField('inaltime_m', v)} type="number" placeholder="ex: 3.20" readonly={isReadOnly} />
            <FieldText label="Greutate (kg)" value={form.greutate_kg} onChange={v => setField('greutate_kg', v)} type="number" placeholder="ex: 24000" readonly={isReadOnly} />
          </div>
          
          {/* Auto-detect dimensiuni mari */}
          {(() => {
            const L = Number(form.lungime_m) || 0
            const W = Number(form.latime_m) || 0
            const H = Number(form.inaltime_m) || 0
            const G_ = Number(form.greutate_kg) || 0
            const depasiri = []
            if (L > 18.75) depasiri.push(`Lungime ${L}m > 18.75m`)
            if (W > 2.55) depasiri.push(`Lățime ${W}m > 2.55m`)
            if (H > 4.00) depasiri.push(`Înălțime ${H}m > 4.00m`)
            if (G_ > 40000) depasiri.push(`Greutate ${G_}kg > 40000kg`)
            if (depasiri.length === 0) return null
            return (
              <div style={{padding: 8, background: G.redDim + '88', border: `1px solid ${G.red}55`, borderRadius: 6, marginBottom: 10, fontSize: 11, color: G.text}}>
                <strong style={{color: G.red}}>⚠️ Dimensiunile sugerează regim transport special obligatoriu:</strong>
                <div style={{marginTop: 4, color: G.muted}}>{depasiri.join(' · ')}</div>
              </div>
            )
          })()}
          
          {/* Bifă regim special */}
          <div style={{marginBottom: 10}}>
            <label style={{display: 'flex', alignItems: 'center', gap: 8, cursor: isReadOnly ? 'default' : 'pointer', userSelect: 'none'}}>
              <input type="checkbox" checked={!!form.regim_transport_special} onChange={e => setField('regim_transport_special', e.target.checked)} disabled={isReadOnly} style={{width: 16, height: 16, accentColor: G.red, cursor: isReadOnly ? 'default' : 'pointer'}} />
              <span style={{fontSize: 13, color: G.text, fontWeight: 600}}>Necesită regim transport special (gabarit/tonaj depășit)</span>
            </label>
          </div>
          
          {/* Sub-form pentru regim special */}
          {form.regim_transport_special && (
            <div style={{padding: 12, background: G.surface, border: `1px solid ${G.border}`, borderRadius: 8, borderLeft: `3px solid ${G.red}`}}>
              <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 10}}>
                <FieldText label="Nr autorizație ARR" value={form.nr_autorizatie_arr} onChange={v => setField('nr_autorizatie_arr', v)} placeholder="ex: AUT-2026-1234" readonly={isReadOnly} />
                <FieldText label="Valabil până la" value={form.valabilitate_autorizatie} onChange={v => setField('valabilitate_autorizatie', v)} type="date" readonly={isReadOnly} />
                <FieldText label="Restricții ore" value={form.restrictii_ore} onChange={v => setField('restrictii_ore', v)} placeholder="ex: 22:00 - 06:00" readonly={isReadOnly} />
              </div>
              <div style={{marginBottom: 10}}>
                <label style={{display: 'flex', alignItems: 'center', gap: 8, cursor: isReadOnly ? 'default' : 'pointer', userSelect: 'none'}}>
                  <input type="checkbox" checked={!!form.necesita_pilot} onChange={e => setField('necesita_pilot', e.target.checked)} disabled={isReadOnly} style={{width: 14, height: 14, accentColor: G.orange, cursor: isReadOnly ? 'default' : 'pointer'}} />
                  <span style={{fontSize: 12, color: G.text}}>Necesită însoțitor / pilot</span>
                </label>
              </div>
              <FieldTextarea label="Note transport (traseu, restricții, contact ARR)" value={form.note_transport_special} onChange={v => setField('note_transport_special', v)} rows={2} readonly={isReadOnly} />
            </div>
          )}
        </div>
        
        <div style={{marginBottom: 14}}>
          <div style={{fontSize: 11, color: G.logistica, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.6px', marginBottom: 8}}>📎 Documente</div>
          {activ?.id ? (
            <DocumenteUtilajList
              activId={activ.id}
              canEdit={accessLevel === 'admin' || accessLevel === 'editor'}
              showToast={showToast}
            />
          ) : (
            <div style={{padding: 14, background: G.bg, border: `1px dashed ${G.border2}`, borderRadius: 8, color: G.dim, fontSize: 12, textAlign: 'center'}}>
              Salvează mai întâi utilajul, apoi poți adăuga documente.
            </div>
          )}
        </div>

        <div style={{marginBottom: 14}}>
          <div style={{fontSize: 11, color: G.logistica, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.6px', marginBottom: 8}}>📝 Note interne</div>
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
          rezervoare={rezervoare}
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
// ─── Bara de tab-uri pentru pagina Logistică ─────────────────────────────────
function TabsBar({ tab, setTab, isOwner = false, sugestiiCount = 0 }) {
  const tabs = [
    { key: 'lista',     icon: '📋', label: 'Active' },
    { key: 'alimentari',icon: '⛽', label: 'Alimentări' },
    { key: 'documente', icon: '📎', label: 'Documente' },
    { key: 'service',   icon: '🔧', label: 'Service' },
    { key: 'tichete',   icon: '🎫', label: 'Tichete' },
    { key: 'transporturi', icon: '🚚', label: 'Transporturi' },
    { key: 'arhiva',    icon: '📂', label: 'Arhivă Avize' },
    { key: 'arhiva_alimentari', icon: '📊', label: 'Arhivă Alimentări' },
    ...(isOwner ? [{ key: 'bot-sugestii', icon: '⚔️', label: 'Sugestii Scorilos', badge: sugestiiCount }] : []),
  ]
  return (
    <div style={{display: 'flex', gap: 4, marginBottom: 14, padding: 4, background: G.surface, borderRadius: 10, border: `1px solid ${G.border}`, flexWrap: 'wrap'}}>
      {tabs.map(t => {
        const active = tab === t.key
        return (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            padding: '8px 14px',
            borderRadius: 7,
            border: 'none',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: active ? 700 : 500,
            background: active ? G.logistica + '22' : 'transparent',
            color: active ? G.logistica : G.muted,
            transition: 'all .15s',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}>
            <span style={{fontSize: 14}}>{t.icon}</span>
            {t.label}
            {t.badge != null && t.badge > 0 && (
              <span style={{
                marginLeft: 4,
                padding: '1px 6px',
                background: active ? G.logistica : G.red,
                color: '#fff',
                borderRadius: 10,
                fontSize: 10,
                fontWeight: 700,
                minWidth: 18,
                textAlign: 'center',
              }}>{t.badge}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

// ─── Placeholder pentru tab-uri în curs de dezvoltare ────────────────────────
function PlaceholderTab({ label, desc, emoji }) {
  return (
    <div style={{...S.card, padding: 60, textAlign: 'center'}}>
      <div style={{fontSize: 64, marginBottom: 14, opacity: .4}}>{emoji}</div>
      <div style={{fontSize: 22, fontWeight: 800, color: G.text, marginBottom: 6}}>{label}</div>
      <div style={{fontSize: 13, color: G.muted, marginBottom: 18}}>{desc}</div>
      <div style={{display: 'inline-block', padding: '6px 14px', background: G.yellow + '22', color: G.yellow, fontSize: 11, fontWeight: 700, borderRadius: 14, letterSpacing: '.5px'}}>
        🚧 ÎN DEZVOLTARE
      </div>
    </div>
  )
}

// ─── Pagina Alimentări — input bulk per zi ──────────────────────────────────
// ─── Modal Editare Alimentare existentă ─────────────────────────────────────
function EditAlimentareModal({ alim, sites, rezervoare, pretMotorina, onClose, onSaved, showToast }) {
  const [form, setForm] = useState({
    data_alimentare: alim.data_alimentare,
    cantitate_litri: alim.cantitate_litri || '',
    ore_la_alimentare: alim.ore_la_alimentare || '',
    km_la_alimentare: alim.km_la_alimentare || '',
    ore_lucrate_efectiv: alim.ore_lucrate_efectiv || '',
    statie_combustibil: alim.statie_combustibil || '',
    site_id: alim.site_id ? String(alim.site_id) : '',
    pret_total: alim.pret_total || '',
    pret_per_litru: alim.pret_per_litru || '',
    card_combustibil: alim.card_combustibil || '',
    numar_factura: alim.numar_factura || '',
    observatii: alim.observatii || '',
  })
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const setField = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const isGazpet = isStatieGazpet(form.statie_combustibil)
  const rezervorActiv = useMemo(
    () => getRezervorPentruStatie(form.statie_combustibil, rezervoare),
    [form.statie_combustibil, rezervoare]
  )
  
  const handleTotalChange = (v) => {
    setField('pret_total', v)
    if (v && form.cantitate_litri && Number(form.cantitate_litri) > 0) {
      setField('pret_per_litru', (Number(v) / Number(form.cantitate_litri)).toFixed(4))
    }
  }
  const handlePretLChange = (v) => {
    setField('pret_per_litru', v)
    if (v && form.cantitate_litri && Number(form.cantitate_litri) > 0) {
      setField('pret_total', (Number(v) * Number(form.cantitate_litri)).toFixed(2))
    }
  }
  
  const pretLNum = Number(form.pret_per_litru) || 0
  const isPretSuspect = form.pret_per_litru && (pretLNum < 1 || pretLNum > 20)
  
  const activMeta = alim.logistica_active || {}
  
  const handleSave = async () => {
    if (!form.cantitate_litri || Number(form.cantitate_litri) <= 0) { showToast('Cantitatea trebuie > 0', 'error'); return }
    if (isPretSuspect) {
      const ok = window.confirm(`⚠️ Preț/L atipic: ${form.pret_per_litru} RON/L\nContinui oricum?`)
      if (!ok) return
    }
    
    setSaving(true)
    const payload = {
      data_alimentare: form.data_alimentare,
      cantitate_litri: Number(form.cantitate_litri),
      ore_la_alimentare: form.ore_la_alimentare ? Number(form.ore_la_alimentare) : null,
      km_la_alimentare: form.km_la_alimentare ? Number(form.km_la_alimentare) : null,
      ore_lucrate_efectiv: form.ore_lucrate_efectiv ? Number(form.ore_lucrate_efectiv) : null,
      statie_combustibil: form.statie_combustibil || null,
      site_id: form.site_id ? Number(form.site_id) : null,
      pret_total: form.pret_total ? Number(form.pret_total) : null,
      pret_per_litru: form.pret_per_litru ? Number(form.pret_per_litru) : null,
      card_combustibil: form.card_combustibil.trim() || null,
      numar_factura: form.numar_factura.trim() || null,
      observatii: form.observatii.trim() || null,
      rezervor_id: isGazpet && rezervorActiv ? rezervorActiv.id : null,
    }
    
    const { error } = await supabase.from('logistica_alimentari').update(payload).eq('id', alim.id)
    setSaving(false)
    if (error) { showToast(`Eroare: ${error.message}`, 'error'); return }
    showToast(`✓ Alimentare modificată`, 'success')
    onSaved()
  }
  
  const handleDelete = async () => {
    if (!window.confirm(`Ștergi alimentarea de ${alim.cantitate_litri} L de pe ${fmtDate(alim.data_alimentare)}?\n\nStocul rezervorului va fi ajustat automat.`)) return
    setDeleting(true)
    const { error } = await supabase.from('logistica_alimentari').delete().eq('id', alim.id)
    setDeleting(false)
    if (error) { showToast(`Eroare: ${error.message}`, 'error'); return }
    showToast(`✓ Alimentare ștearsă`, 'success')
    onSaved()
  }
  
  return (
    <div onClick={onClose} style={{position:'fixed', inset:0, background:'#000000cc', zIndex:300, display:'flex', alignItems:'flex-start', justifyContent:'center', padding:'40px 16px', overflowY:'auto'}}>
      <div onClick={e => e.stopPropagation()} style={{...S.card, padding: 22, width: '100%', maxWidth: 620, boxShadow: '0 20px 80px rgba(0,0,0,.6)', borderTop: `3px solid ${G.logistica}`}} className="fi">
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom: 16, paddingBottom: 14, borderBottom: `1px solid ${G.border}`}}>
          <div>
            <div style={{fontSize: 18, fontWeight: 800, color: G.text, marginBottom: 4}}>
              ✏️ Editare alimentare #{alim.id}
            </div>
            <div style={{fontSize: 12, color: G.muted}}>
              {activMeta.marca} {activMeta.model} · {activMeta.cod_intern || activMeta.nr_inmatriculare}
            </div>
          </div>
          <button onClick={onClose} style={{background:'transparent', border:'none', color:G.muted, fontSize: 22, cursor:'pointer', padding: 4}}>×</button>
        </div>
        
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap: 12, marginBottom: 12}}>
          <FieldText label="Data" value={form.data_alimentare} onChange={v => setField('data_alimentare', v)} type="date" />
          <FieldText label="Cantitate (litri)" value={form.cantitate_litri} onChange={v => setField('cantitate_litri', v)} type="number" />
        </div>
        
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap: 12, marginBottom: 12}}>
          <FieldSelect label="Stație" value={form.statie_combustibil} onChange={v => setField('statie_combustibil', v)} options={STATII} placeholder="—" />
          <FieldSelect label="Șantier" value={form.site_id} onChange={v => setField('site_id', v)} options={[{label:'— niciun șantier —', value:''}, ...(sites||[]).map(s => ({label: s.name, value: String(s.id)}))]} placeholder="—" />
        </div>
        
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap: 12, marginBottom: 12}}>
          <FieldText label="Ore bord" value={form.ore_la_alimentare} onChange={v => setField('ore_la_alimentare', v)} type="number" />
          <FieldText label="Km" value={form.km_la_alimentare} onChange={v => setField('km_la_alimentare', v)} type="number" />
          <FieldText label="Ore lucrate" value={form.ore_lucrate_efectiv} onChange={v => setField('ore_lucrate_efectiv', v)} type="number" />
        </div>
        
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap: 12, marginBottom: 8}}>
          <FieldText label="Preț/litru (RON/L)" value={form.pret_per_litru} onChange={handlePretLChange} type="number" placeholder="ex: 7.50" />
          <FieldText label="Cost total (RON)" value={form.pret_total} onChange={handleTotalChange} type="number" placeholder="ex: 380.50" />
        </div>
        
        {isPretSuspect && (
          <div style={{padding: 8, background: G.redDim + '88', border: `1px solid ${G.red}55`, borderRadius: 6, marginBottom: 12, fontSize: 11, color: G.red}}>
            ⚠️ Preț/litru atipic: {form.pret_per_litru} RON/L. Pentru motorină: 6-9 RON/L.
          </div>
        )}
        
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap: 12, marginBottom: 12}}>
          <FieldText label="Card combustibil" value={form.card_combustibil} onChange={v => setField('card_combustibil', v)} placeholder="ex: 7059-XXXX" />
          <FieldText label="Număr factură" value={form.numar_factura} onChange={v => setField('numar_factura', v)} placeholder="F-2026-..." />
        </div>
        
        <div style={{marginBottom: 14}}>
          <FieldTextarea label="Observații" value={form.observatii} onChange={v => setField('observatii', v)} rows={2} />
        </div>
        
        <div style={{display:'flex', justifyContent:'space-between', gap: 8, paddingTop: 14, borderTop: `1px solid ${G.border}`}}>
          <button onClick={handleDelete} disabled={deleting || saving} style={{...S.btnS, fontSize: 12, color: G.red, borderColor: G.red + '55', opacity: (deleting || saving) ? .5 : 1}}>
            {deleting ? '⏳' : '🗑️ Șterge'}
          </button>
          <div style={{display:'flex', gap: 8}}>
            <button onClick={onClose} style={{...S.btnS, fontSize: 13, color: G.muted}} disabled={saving || deleting}>Anulează</button>
            <button onClick={handleSave} disabled={saving || deleting} style={{...S.btnP, background: G.logistica, color: '#000', opacity: (saving || deleting) ? .6 : 1}}>
              {saving ? '⏳' : '✓ Salvează modificările'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ETAPA 8.6: Componentă expand „Vezi perioade importate" sub banner EvoGPS
function IstoricImporturiEvoExpand({ istoricImporturi }) {
  const [expanded, setExpanded] = useState(false)
  if (!istoricImporturi || istoricImporturi.length === 0) return null
  
  const totalImporturi = istoricImporturi.length
  const totalInregistrari = istoricImporturi.reduce((s, i) => s + (i.inregistrari || 0), 0)
  
  return (
    <div style={{
      background: G.surface,
      border: `1px solid ${G.border}`,
      borderRadius: 10,
      marginBottom: 16,
      overflow: 'hidden',
    }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          width: '100%',
          background: 'transparent',
          border: 'none',
          padding: '10px 16px',
          color: G.muted,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: 12,
          fontWeight: 600,
        }}
      >
        <span>
          📅 <strong style={{color: G.text}}>{totalImporturi}</strong> {totalImporturi === 1 ? 'import EvoGPS' : 'importuri EvoGPS'} înregistrate · 
          <strong style={{color: G.text, marginLeft: 4}}>{totalInregistrari.toLocaleString('ro-RO')}</strong> înregistrări totale
        </span>
        <span style={{fontSize: 11, color: G.muted}}>
          {expanded ? '▲ Ascunde' : '▼ Vezi istoricul'}
        </span>
      </button>
      
      {expanded && (
        <div style={{borderTop: `1px solid ${G.border}`, padding: '10px 16px'}}>
          <div style={{overflowX: 'auto'}}>
            <table style={{width: '100%', borderCollapse: 'collapse', fontSize: 12}}>
              <thead>
                <tr style={{borderBottom: `1px solid ${G.border}`}}>
                  <th style={{padding: '6px 8px', textAlign: 'left', color: G.muted, fontSize: 10, textTransform: 'uppercase', fontWeight: 700}}>Importat la</th>
                  <th style={{padding: '6px 8px', textAlign: 'left', color: G.muted, fontSize: 10, textTransform: 'uppercase', fontWeight: 700}}>Fișier</th>
                  <th style={{padding: '6px 8px', textAlign: 'left', color: G.muted, fontSize: 10, textTransform: 'uppercase', fontWeight: 700}}>Perioadă acoperită</th>
                  <th style={{padding: '6px 8px', textAlign: 'center', color: G.muted, fontSize: 10, textTransform: 'uppercase', fontWeight: 700}}>Vehicule</th>
                  <th style={{padding: '6px 8px', textAlign: 'center', color: G.muted, fontSize: 10, textTransform: 'uppercase', fontWeight: 700}}>Înregistrări</th>
                </tr>
              </thead>
              <tbody>
                {istoricImporturi.map((imp, i) => {
                  const impDate = imp.imported_at ? new Date(imp.imported_at).toLocaleString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
                  const prima = imp.prima_zi ? new Date(imp.prima_zi).toLocaleDateString('ro-RO') : '—'
                  const ultima = imp.ultima_zi ? new Date(imp.ultima_zi).toLocaleDateString('ro-RO') : '—'
                  const nrZile = (imp.prima_zi && imp.ultima_zi) ? Math.floor((new Date(imp.ultima_zi) - new Date(imp.prima_zi)) / 86400000) + 1 : null
                  return (
                    <tr key={i} style={{borderBottom: `1px solid ${G.border}33`}}>
                      <td style={{padding: '6px 8px', color: G.text, fontSize: 11, fontVariantNumeric: 'tabular-nums'}}>{impDate}</td>
                      <td style={{padding: '6px 8px', color: G.muted, fontSize: 11, fontFamily: 'monospace', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}} title={imp.file_name}>{imp.file_name || '—'}</td>
                      <td style={{padding: '6px 8px', color: G.text, fontSize: 11}}>
                        <span style={{color: G.green, fontWeight: 600}}>{prima}</span>
                        <span style={{color: G.muted, margin: '0 4px'}}>→</span>
                        <span style={{color: G.green, fontWeight: 600}}>{ultima}</span>
                        {nrZile && <span style={{color: G.muted, marginLeft: 6, fontSize: 10}}>({nrZile} {nrZile === 1 ? 'zi' : 'zile'})</span>}
                      </td>
                      <td style={{padding: '6px 8px', textAlign: 'center', color: G.blue, fontWeight: 700}}>{imp.vehicule || 0}</td>
                      <td style={{padding: '6px 8px', textAlign: 'center', color: G.purple, fontWeight: 700, fontVariantNumeric: 'tabular-nums'}}>{(imp.inregistrari || 0).toLocaleString('ro-RO')}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div style={{marginTop: 8, fontSize: 10, color: G.dim, fontStyle: 'italic'}}>
            💡 Importurile mai vechi sunt arhivate când datele cele mai vechi sunt suprascrise de noi importuri pe aceleași perioade.
          </div>
        </div>
      )}
    </div>
  )
}

function AlimentariBulkPage({ active, ultimeAlim, sites, rezervoare, pretMotorina, dataAlim, setDataAlim, canEdit, showToast, onSaved, onImportEvoGPS, onImportRompetrol, ultimaTelemetrieData, istoricImporturi, profile, accessLevel }) {
  const [filterText, setFilterText] = useState('')
  const [filterTip, setFilterTip] = useState('Toate')
  const [filterSub, setFilterSub] = useState('Toate')
  const [forms, setForms] = useState({})
  const [savingId, setSavingId] = useState(null)
  const [saved, setSaved] = useState({})
  // Map rezervor_id → preț mediu ponderat (pentru auto-fill rapid pe Gazpet)
  const [pretMediuPerRezervor, setPretMediuPerRezervor] = useState({})
  
  // State pentru listă alimentări înregistrate (cu filtru perioadă + edit)
  const [perioadaF, setPerioadaF] = useState('azi')  // 'azi' | 'ieri' | 'saptamana' | 'luna' | 'custom'
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [alimList, setAlimList] = useState([])
  const [loadingAlim, setLoadingAlim] = useState(false)
  const [editAlim, setEditAlim] = useState(null)
  
  // Calculez preț mediu Gazpet per fiecare rezervor activ
  useEffect(() => {
    const ids = (rezervoare || []).map(r => r.id).filter(Boolean)
    if (!ids.length) { setPretMediuPerRezervor({}); return }
    supabase.from('logistica_achizitii_vrac')
      .select('rezervor_id, cantitate_litri, pret_per_litru')
      .in('rezervor_id', ids)
      .not('pret_per_litru', 'is', null)
      .then(({ data }) => {
        const map = {}
        if (data?.length) {
          ids.forEach(rid => {
            const rows = data.filter(d => d.rezervor_id === rid)
            const tot = rows.reduce((s, a) => s + Number(a.cantitate_litri || 0), 0)
            const cost = rows.reduce((s, a) => s + Number(a.cantitate_litri || 0) * Number(a.pret_per_litru || 0), 0)
            if (tot > 0) map[rid] = (cost / tot).toFixed(4)
          })
        }
        setPretMediuPerRezervor(map)
      })
  }, [rezervoare])
  
  // Filtru: doar active cu combustibil + tip + subcategorie + text
  const activeFiltrate = useMemo(() => {
    let res = active.filter(a => a.tip_carburant && a.tip_carburant.trim() !== '')
    if (filterTip !== 'Toate') res = res.filter(a => a.logistica_categorii?.tip === filterTip)
    if (filterSub !== 'Toate') res = res.filter(a => a.logistica_categorii?.subcategorie === filterSub)
    if (filterText.trim()) {
      const q = filterText.toLowerCase()
      res = res.filter(a => 
        (a.cod_intern || '').toLowerCase().includes(q) ||
        (a.nr_inmatriculare || '').toLowerCase().includes(q) ||
        (a.marca || '').toLowerCase().includes(q) ||
        (a.model || '').toLowerCase().includes(q)
      )
    }
    return res
  }, [active, filterText, filterTip, filterSub])
  
  // Tipuri și subcategorii unice (din active filtrate cu combustibil)
  const tipuri = useMemo(() => {
    const set = new Set()
    active.filter(a => a.tip_carburant).forEach(a => { if (a.logistica_categorii?.tip) set.add(a.logistica_categorii.tip) })
    return Array.from(set).sort()
  }, [active])
  
  const subcategorii = useMemo(() => {
    const set = new Set()
    active.filter(a => a.tip_carburant && (filterTip === 'Toate' || a.logistica_categorii?.tip === filterTip))
      .forEach(a => { if (a.logistica_categorii?.subcategorie) set.add(a.logistica_categorii.subcategorie) })
    return Array.from(set).sort()
  }, [active, filterTip])
  
  // Calc dată pentru filtru perioadă
  const calcPerioada = () => {
    const today = new Date().toISOString().split('T')[0]
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]
    const week = new Date(Date.now() - 7*86400000).toISOString().split('T')[0]
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]
    
    if (perioadaF === 'azi') return { start: today, end: today, label: 'Azi' }
    if (perioadaF === 'ieri') return { start: yesterday, end: yesterday, label: 'Ieri' }
    if (perioadaF === 'saptamana') return { start: week, end: today, label: 'Ultimele 7 zile' }
    if (perioadaF === 'luna') return { start: monthStart, end: today, label: 'Luna curentă' }
    if (perioadaF === 'custom' && customStart && customEnd) return { start: customStart, end: customEnd, label: `${fmtDate(customStart)} → ${fmtDate(customEnd)}` }
    return null
  }
  
  // Fetch alimentări pentru perioada selectată
  const fetchAlimentari = async () => {
    const p = calcPerioada()
    if (!p) { setAlimList([]); return }
    setLoadingAlim(true)
    const { data } = await supabase.from('logistica_alimentari')
      .select(`*, logistica_active(cod_intern, nr_inmatriculare, marca, model, tip_carburant), sites(name), profiles!created_by(name)`)
      .gte('data_alimentare', p.start)
      .lte('data_alimentare', p.end)
      .order('data_alimentare', { ascending: false })
      .order('id', { ascending: false })
    setAlimList(data || [])
    setLoadingAlim(false)
  }
  
  useEffect(() => { fetchAlimentari() }, [perioadaF, customStart, customEnd])
  
  const setFormField = (activId, field, value) => {
    setForms(prev => ({ ...prev, [activId]: { ...prev[activId], [field]: value } }))
  }
  
  const getForm = (activId) => forms[activId] || {}
  
  const navigateDate = (delta) => {
    const d = new Date(dataAlim)
    d.setDate(d.getDate() + delta)
    setDataAlim(d.toISOString().split('T')[0])
  }
  
  const handleSave = async (activ) => {
    const f = getForm(activ.id)
    if (!f.cantitate_litri || Number(f.cantitate_litri) <= 0) { showToast(`Cantitatea trebuie > 0 pentru ${activ.cod_intern || activ.nr_inmatriculare}`, 'error'); return }
    
    // Warning soft: utilajul are normă consum dar userul n-a completat orele
    if (activ.norma_consum && Number(activ.norma_consum) > 0 && !f.ore_la_alimentare) {
      const ok = window.confirm(`⚠️ ${activ.cod_intern || activ.nr_inmatriculare} are normă de consum setată (${activ.norma_consum} ${activ.unitate_norma || 'l/h'}), dar n-ai completat câmpul "Ore bord".\n\nFără ore, NU se poate calcula consumul real și NU se poate detecta dacă utilajul consumă peste normă.\n\nSalvezi oricum?`)
      if (!ok) return
    }
    
    const isGazpet = isStatieGazpet(f.statie_combustibil)
    const rezervorActiv = getRezervorPentruStatie(f.statie_combustibil, rezervoare)
    const pretMediuRez = rezervorActiv ? pretMediuPerRezervor[rezervorActiv.id] : null
    const pretBaza = isGazpet ? (pretMediuRez || pretMotorina) : pretMotorina
    const pretL = f.pret_per_litru ? Number(f.pret_per_litru) : (pretBaza ? Number(pretBaza) : null)
    const pretTotal = pretL ? Number((Number(f.cantitate_litri) * pretL).toFixed(2)) : null
    
    // Warning preț atipic
    if (pretL && (pretL < 1 || pretL > 20)) {
      const ok = window.confirm(`⚠️ Preț/litru atipic: ${pretL} RON/L pentru ${activ.cod_intern || activ.nr_inmatriculare}\n\nContinui oricum?`)
      if (!ok) return
    }
    
    setSavingId(activ.id)
    const { data: { user } } = await supabase.auth.getUser()
    
    // Calc ore lucrate efectiv = ore_la_alimentare - ore_precedente (dacă e disponibil)
    const orePrec = ultimeAlim[activ.id]?.ultime_ore
    const oreLaAlim = f.ore_la_alimentare ? Number(f.ore_la_alimentare) : null
    const oreLucrate = (orePrec && oreLaAlim && oreLaAlim > Number(orePrec)) ? oreLaAlim - Number(orePrec) : null
    
    const payload = {
      active_id: activ.id,
      data_alimentare: dataAlim,
      cantitate_litri: Number(f.cantitate_litri),
      ore_la_alimentare: oreLaAlim,
      km_la_alimentare: f.km_la_alimentare ? Number(f.km_la_alimentare) : null,
      ore_lucrate_efectiv: oreLucrate,
      statie_combustibil: f.statie_combustibil || null,
      pret_total: pretTotal,
      pret_per_litru: pretL,
      rezervor_id: isGazpet && rezervorActiv ? rezervorActiv.id : null,
      site_id: f.site_id ? Number(f.site_id) : null,
      created_by: user?.id,
    }
    
    const { error } = await supabase.from('logistica_alimentari').insert(payload)
    setSavingId(null)
    
    if (error) { showToast(`Eroare: ${error.message}`, 'error'); return }
    
    showToast(`✓ ${activ.cod_intern || activ.nr_inmatriculare}: ${f.cantitate_litri} L`, 'success')
    setSaved(prev => ({ ...prev, [activ.id]: true }))
    setForms(prev => ({ ...prev, [activ.id]: {} }))  // resetez form
    fetchAlimentari()  // refresh listă alimentări
    onSaved()
  }
  
  return (
    <div>
      {/* ETAPA 8.5 + 24.05.2026: Banner Import Telemetrie (EvoGPS + Rompetrol)  */}
      {/* ──────────────────────────────────────────────────────────────────── */}
      {(profile?.is_owner || ['superadmin','admin_logistica'].includes(profile?.role) || accessLevel === 'admin') && (() => {
        const zileDe = ultimaTelemetrieData
          ? Math.floor((Date.now() - new Date(ultimaTelemetrieData).getTime()) / 86400000)
          : null
        const niciOdata = ultimaTelemetrieData === null || ultimaTelemetrieData === undefined
        // Severitate banner
        let bannerBg = G.purple + '15'
        let bannerBorder = G.purple + '55'
        let icon = '🛰️'
        let titlu = 'Telemetrie'
        let mesaj = niciOdata 
          ? 'Niciun import telemetrie încă. Exportă rapoartele din EvoGPS sau Rompetrol și importă-le aici.'
          : `Ultimul import: ${fmtDate(ultimaTelemetrieData)} (acum ${zileDe} ${zileDe === 1 ? 'zi' : 'zile'})`
        if (niciOdata) {
          bannerBg = G.blue + '15'
          bannerBorder = G.blue + '55'
          icon = '📡'
        } else if (zileDe > 14) {
          bannerBg = G.red + '22'
          bannerBorder = G.red + '88'
          icon = '🚨'
          titlu = 'ATENȚIE — Telemetrie veche'
          mesaj = `Ultimul import telemetrie: ${fmtDate(ultimaTelemetrieData)} (acum ${zileDe} zile). Te rugăm să exporți rapoartele săptămânal!`
        } else if (zileDe > 7) {
          bannerBg = G.yellow + '22'
          bannerBorder = G.yellow + '88'
          icon = '⚠️'
          titlu = 'Telemetrie veche — necesită import'
          mesaj = `Ultimul import telemetrie: ${fmtDate(ultimaTelemetrieData)} (acum ${zileDe} zile). Recomandare: săptămânal sau bisăptămânal.`
        }
        return (
          <div style={{
            background: bannerBg,
            border: `1px solid ${bannerBorder}`,
            borderRadius: 12,
            padding: '14px 18px',
            marginBottom: 16,
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            flexWrap: 'wrap',
          }}>
            <div style={{fontSize: 28}}>{icon}</div>
            <div style={{flex: 1, minWidth: 240}}>
              <div style={{fontSize: 13, fontWeight: 800, color: G.text, marginBottom: 2}}>{titlu}</div>
              <div style={{fontSize: 12, color: G.muted}}>{mesaj}</div>
              {niciOdata && (
                <div style={{fontSize: 11, color: G.muted, marginTop: 4, fontStyle: 'italic'}}>
                  💡 Tip: din portalul EvoGPS → Rapoarte (km/ore) · din contul Rompetrol → raport „Refilling" (alimentări).
                </div>
              )}
            </div>
            <div style={{display: 'flex', flexDirection: 'column', gap: 6}}>
              <button 
                onClick={() => onImportEvoGPS('masini')}
                title="EvoGPS: autoturisme, autoutilitare, camioane (raport „Foaie de activitate zilnică”)"
                style={{
                  background: G.blue,
                  color: '#0D1117',
                  border: 'none',
                  borderRadius: 8,
                  padding: '9px 16px',
                  fontSize: 12,
                  fontWeight: 800,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  whiteSpace: 'nowrap',
                  justifyContent: 'flex-start',
                }}>
                🚗 Import KM mașini (EvoGPS)
              </button>
              <button 
                onClick={() => onImportEvoGPS('utilaje')}
                title="EvoGPS: excavatoare, buldozere, generatoare (raport „DAILYACTIVITY”)"
                style={{
                  background: G.orange,
                  color: '#0D1117',
                  border: 'none',
                  borderRadius: 8,
                  padding: '9px 16px',
                  fontSize: 12,
                  fontWeight: 800,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  whiteSpace: 'nowrap',
                  justifyContent: 'flex-start',
                }}>
                🏗️ Import ore utilaje (EvoGPS)
              </button>
              <button 
                onClick={() => onImportRompetrol && onImportRompetrol()}
                title='Rompetrol: import alimentări din raport „Refilling" (Excel .xls/.xlsx). Match pe nr înmatriculare. Cardurile GAZPET1-21 vor fi atribuite ulterior prin QR.'
                style={{
                  background: G.green,
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  padding: '9px 16px',
                  fontSize: 12,
                  fontWeight: 800,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  whiteSpace: 'nowrap',
                  justifyContent: 'flex-start',
                }}>
                🟢 Import Rompetrol (.xls)
              </button>
            </div>
          </div>
        )
      })()}
      
      {/* ETAPA 8.6: Expand „Vezi perioade importate" SUB banner EvoGPS */}
      {(profile?.is_owner || ['superadmin','admin_logistica'].includes(profile?.role) || accessLevel === 'admin') && istoricImporturi && istoricImporturi.length > 0 && (
        <IstoricImporturiEvoExpand istoricImporturi={istoricImporturi} />
      )}
            {/* ──────────────────────────────────────────────────────────────────── */}
      {/* SECȚIUNEA 2: Alimentări înregistrate (vizualizare + edit + ștergere) */}
      {/* ──────────────────────────────────────────────────────────────────── */}
      <div style={{marginBottom: 24}}>
        <div style={{...S.card, padding: '14px 18px', marginBottom: 12}}>
          <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8}}>
            <div style={{fontSize: 11, color: G.purple, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.6px'}}>
              📋 Alimentări înregistrate {alimList.length > 0 && <span style={{color: G.muted, fontWeight: 500}}>({alimList.length})</span>}
            </div>
            {alimList.length > 0 && (
              <div style={{fontSize: 12, color: G.muted}}>
                Total: <strong style={{color: G.text}}>{alimList.reduce((s,a) => s + Number(a.cantitate_litri || 0), 0).toFixed(1)} L</strong>
                {alimList.some(a => a.pret_total) && <> · <strong style={{color: G.green}}>{alimList.reduce((s,a) => s + Number(a.pret_total || 0), 0).toLocaleString('ro-RO', {minimumFractionDigits: 2, maximumFractionDigits: 2})} RON</strong></>}
              </div>
            )}
          </div>
          
          {/* Filtru perioadă */}
          <div style={{display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap'}}>
            <span style={{fontSize: 11, color: G.muted, fontWeight: 600, marginRight: 4}}>PERIOADĂ:</span>
            {[
              {key: 'azi', label: 'Azi'},
              {key: 'ieri', label: 'Ieri'},
              {key: 'saptamana', label: '7 zile'},
              {key: 'luna', label: 'Luna'},
              {key: 'custom', label: 'Custom'},
            ].map(p => (
              <button key={p.key} onClick={() => setPerioadaF(p.key)} style={{
                ...S.btnS, padding: '6px 12px', fontSize: 12, fontWeight: 600,
                background: perioadaF === p.key ? G.purple + '22' : 'transparent',
                color: perioadaF === p.key ? G.purple : G.muted,
                borderColor: perioadaF === p.key ? G.purple + '55' : G.border,
              }}>{p.label}</button>
            ))}
            {perioadaF === 'custom' && (
              <>
                <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} style={{...S.input, padding: '6px 10px', fontSize: 12, minWidth: 140}} />
                <span style={{color: G.muted, fontSize: 12}}>→</span>
                <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} style={{...S.input, padding: '6px 10px', fontSize: 12, minWidth: 140}} />
              </>
            )}
          </div>
        </div>
        
        {/* Tabel alimentări */}
        {loadingAlim ? (
          <div style={{...S.card, padding: 30, textAlign: 'center', color: G.muted, fontSize: 13}}>⏳ Se încarcă...</div>
        ) : alimList.length === 0 ? (
          <div style={{...S.card, padding: 30, textAlign: 'center', color: G.muted, fontSize: 13}}>
            Nicio alimentare înregistrată în această perioadă.
          </div>
        ) : (
          <div style={{...S.card, padding: 0, overflow: 'hidden'}}>
            <div style={{overflowX: 'auto'}}>
              <table style={{width: '100%', borderCollapse: 'collapse', fontSize: 12}}>
                <thead>
                  <tr style={{background: G.surface, borderBottom: `2px solid ${G.border}`}}>
                    <th style={{padding: '10px 12px', textAlign: 'left', color: G.muted, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.4px'}}>Data</th>
                    <th style={{padding: '10px 12px', textAlign: 'left', color: G.muted, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.4px'}}>Utilaj</th>
                    <th style={{padding: '10px 12px', textAlign: 'right', color: G.muted, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.4px'}}>Cantitate</th>
                    <th style={{padding: '10px 12px', textAlign: 'left', color: G.muted, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.4px'}}>Sursa</th>
                    <th style={{padding: '10px 12px', textAlign: 'left', color: G.muted, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.4px'}}>Șantier</th>
                    <th style={{padding: '10px 12px', textAlign: 'right', color: G.muted, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.4px'}}>Ore bord</th>
                    <th style={{padding: '10px 12px', textAlign: 'right', color: G.muted, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.4px'}}>Cost</th>
                    <th style={{padding: '10px 12px', textAlign: 'left', color: G.muted, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.4px'}}>Cine</th>
                    <th style={{padding: '10px 12px', textAlign: 'center', color: G.muted, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.4px', width: 80}}></th>
                  </tr>
                </thead>
                <tbody>
                  {alimList.map(a => {
                    const av = a.logistica_active || {}
                    const pretL = Number(a.pret_per_litru || 0)
                    const isPretSusp = a.pret_per_litru && (pretL < 1 || pretL > 20)
                    return (
                      <tr key={a.id} style={{borderBottom: `1px solid ${G.border}`}}>
                        <td style={{padding: '8px 12px', fontFamily: 'monospace', color: G.text, fontWeight: 600}}>{fmtDate(a.data_alimentare)}</td>
                        <td style={{padding: '8px 12px'}}>
                          <div style={{fontWeight: 600, color: G.text}}>{av.marca} {av.model?.substring(0, 30)}{av.model?.length > 30 ? '...' : ''}</div>
                          <div style={{fontSize: 10, color: G.muted, marginTop: 2}}>
                            {av.cod_intern && <span style={{color: G.logistica, fontFamily: 'monospace'}}>{av.cod_intern}</span>}
                            {av.nr_inmatriculare && <span style={{color: G.blue, fontFamily: 'monospace', marginLeft: 6}}>{av.nr_inmatriculare}</span>}
                          </div>
                        </td>
                        <td style={{padding: '8px 12px', textAlign: 'right', color: G.orange, fontWeight: 700, fontVariantNumeric: 'tabular-nums'}}>
                          {Number(a.cantitate_litri).toFixed(1)} L
                        </td>
                        <td style={{padding: '8px 12px', fontSize: 11, color: isStatieGazpet(a.statie_combustibil) ? G.purple : G.text}}>
                          {a.statie_combustibil || '—'}
                        </td>
                        <td style={{padding: '8px 12px', fontSize: 11, color: G.text}}>
                          {a.sites?.name || <span style={{color: G.muted}}>—</span>}
                        </td>
                        <td style={{padding: '8px 12px', textAlign: 'right', fontFamily: 'monospace', color: G.muted}}>
                          {a.ore_la_alimentare || '—'}
                        </td>
                        <td style={{padding: '8px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums'}}>
                          {a.pret_total ? (
                            <div>
                              <div style={{color: isPretSusp ? G.red : G.green, fontWeight: 700}}>
                                {Number(a.pret_total).toFixed(2)} RON
                              </div>
                              {isPretSusp && <div style={{fontSize: 9, color: G.red, fontWeight: 600}}>⚠️ {pretL} /L</div>}
                            </div>
                          ) : <span style={{color: G.muted}}>—</span>}
                        </td>
                        <td style={{padding: '8px 12px', fontSize: 10, color: G.muted}}>
                          {a.profiles?.name?.split(' ')[0] || '—'}
                        </td>
                        <td style={{padding: '8px 12px', textAlign: 'center'}}>
                          {canEdit && (
                            <button onClick={() => setEditAlim(a)} style={{...S.btnS, padding: '4px 8px', fontSize: 11, color: G.logistica, borderColor: G.logistica + '55'}} title="Editează / Șterge">
                              ✏️
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
      
      {/* Header navigare dată + filtre */}
      <div style={{...S.card, padding: '14px 18px', marginBottom: 14}}>
        <div style={{fontSize: 11, color: G.orange, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.6px', marginBottom: 10}}>
          📥 Înregistrare alimentări
        </div>
        <div style={{display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10}}>
          <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
            <button onClick={() => navigateDate(-1)} style={{...S.btnS, padding: '6px 10px', fontSize: 16}} title="Ziua precedentă">◀</button>
            <input type="date" value={dataAlim} onChange={e => setDataAlim(e.target.value)} style={{...S.input, padding: '6px 10px', fontSize: 14, fontWeight: 700, color: G.text, minWidth: 150}} />
            <button onClick={() => navigateDate(1)} style={{...S.btnS, padding: '6px 10px', fontSize: 16}} title="Ziua următoare">▶</button>
            <button onClick={() => setDataAlim(new Date().toISOString().split('T')[0])} style={{...S.btnS, padding: '6px 12px', fontSize: 12, color: G.logistica, borderColor: G.logistica + '55'}}>Azi</button>
            <button onClick={() => { const d = new Date(); d.setDate(d.getDate() - 1); setDataAlim(d.toISOString().split('T')[0]) }} style={{...S.btnS, padding: '6px 12px', fontSize: 12, color: G.muted}}>Ieri</button>
          </div>
        </div>
        
        {/* Filtre Tip + Subcategorie + Text */}
        <div style={{display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center'}}>
          <div style={{fontSize: 11, color: G.muted, fontWeight: 600}}>FILTRU:</div>
          <select value={filterTip} onChange={e => { setFilterTip(e.target.value); setFilterSub('Toate') }} style={{...S.input, padding: '6px 10px', fontSize: 12, minWidth: 140}}>
            <option value="Toate">Toate tipurile</option>
            {tipuri.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={filterSub} onChange={e => setFilterSub(e.target.value)} disabled={filterTip === 'Toate'} style={{...S.input, padding: '6px 10px', fontSize: 12, minWidth: 160, opacity: filterTip === 'Toate' ? .5 : 1}}>
            <option value="Toate">Toate subcategoriile</option>
            {subcategorii.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <input type="text" placeholder="🔍 marcă, cod, plăcuță..." value={filterText} onChange={e => setFilterText(e.target.value)} style={{...S.input, padding: '6px 12px', fontSize: 12, minWidth: 200, flex: 1}} />
          {(filterTip !== 'Toate' || filterSub !== 'Toate' || filterText) && (
            <button onClick={() => { setFilterTip('Toate'); setFilterSub('Toate'); setFilterText('') }} style={{...S.btnS, padding: '6px 10px', fontSize: 11, color: G.muted}}>×  Resetează</button>
          )}
        </div>
      </div>
      
      {/* Info banner */}
      <div style={{padding: 10, marginBottom: 14, background: G.bg, border: `1px solid ${G.border}`, borderRadius: 8, fontSize: 12, color: G.muted}}>
        💡 <strong style={{color: G.text}}>{activeFiltrate.length}</strong> utilaje afișate. Completezi doar rândurile relevante și apasă <strong style={{color: G.green}}>✓ Save</strong> pe fiecare. Datele se salvează cu data <strong style={{color: G.text}}>{fmtDate(dataAlim)}</strong>.
      </div>
      
      {/* Listă active cu form inline */}
      <div style={{display: 'flex', flexDirection: 'column', gap: 8}}>
        {activeFiltrate.length === 0 ? (
          <div style={{...S.card, padding: 30, textAlign: 'center', color: G.muted}}>
            Niciun activ corespunzător filtrelor.
          </div>
        ) : activeFiltrate.map(activ => {
          const f = getForm(activ.id)
          const ultima = ultimeAlim[activ.id]
          const isGazpet = isStatieGazpet(f.statie_combustibil)
          const rezervorActiv = getRezervorPentruStatie(f.statie_combustibil, rezervoare)
          const pretMediuRez = rezervorActiv ? pretMediuPerRezervor[rezervorActiv.id] : null
          const isSaved = saved[activ.id]
          
          return (
            <div key={activ.id} style={{
              ...S.card,
              padding: '10px 14px',
              borderLeft: `3px solid ${isSaved ? G.green : (f.cantitate_litri ? G.orange : G.border)}`,
              opacity: isSaved ? .7 : 1,
            }}>
              {/* Rând 1: Identificare + status */}
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8}}>
                <div style={{flex: 1, minWidth: 200}}>
                  <div style={{fontSize: 13, fontWeight: 700, color: G.text}}>
                    {activ.marca} {activ.model}
                  </div>
                  <div style={{fontSize: 11, color: G.muted, marginTop: 2}}>
                    {activ.cod_intern && <span style={{color: G.logistica, fontFamily: 'monospace'}}>{activ.cod_intern}</span>}
                    {activ.nr_inmatriculare && <span style={{color: G.blue, fontFamily: 'monospace', marginLeft: activ.cod_intern ? 8 : 0}}>{activ.nr_inmatriculare}</span>}
                    {activ.tip_carburant && <span style={{marginLeft: 8}}>· {activ.tip_carburant}</span>}
                    {activ.norma_consum && <span style={{marginLeft: 4}}>· {activ.norma_consum} {activ.unitate_norma || 'l/h'}</span>}
                  </div>
                  {ultima && (
                    <div style={{fontSize: 10, color: G.muted, marginTop: 2}}>
                      Ultima alim: {fmtDate(ultima.ultima_data)}
                      {ultima.ultime_litri && ` · ${Number(ultima.ultime_litri).toFixed(1)}L`}
                      {ultima.ultime_ore && ` · ${ultima.ultime_ore} ore bord`}
                      {ultima.ultimi_km && ` · ${Number(ultima.ultimi_km).toLocaleString('ro-RO')} km`}
                    </div>
                  )}
                </div>
                {isSaved && (
                  <span style={{fontSize: 11, padding: '3px 8px', background: G.green + '22', color: G.green, borderRadius: 4, fontWeight: 700}}>
                    ✓ SALVAT
                  </span>
                )}
              </div>
              
              {/* Rând 2: Form inline */}
              {!isSaved && (
                <div style={{display: 'grid', gridTemplateColumns: '90px 130px 130px 80px 80px 80px', gap: 6, alignItems: 'end'}}>
                  <FieldText label="Cant. (L)" value={f.cantitate_litri || ''} onChange={v => setFormField(activ.id, 'cantitate_litri', v)} type="number" placeholder="50" />
                  <FieldSelect label="Sursa" value={f.statie_combustibil || ''} onChange={v => setFormField(activ.id, 'statie_combustibil', v)} options={STATII} placeholder="—" />
                  <FieldSelect label="Șantier" value={f.site_id || ''} onChange={v => setFormField(activ.id, 'site_id', v)} options={[{label:'—', value:''}, ...(sites||[]).map(s => ({label: s.name, value: String(s.id)}))]} placeholder="—" />
                  <FieldText label={ultima?.ultime_ore ? `Ore (de la ${ultima.ultime_ore})` : "Ore bord"} value={f.ore_la_alimentare || ''} onChange={v => setFormField(activ.id, 'ore_la_alimentare', v)} type="number" placeholder={ultima?.ultime_ore ? String(Number(ultima.ultime_ore) + 8) : "ex: 1248"} />
                  <FieldText label="Km" value={f.km_la_alimentare || ''} onChange={v => setFormField(activ.id, 'km_la_alimentare', v)} type="number" placeholder={ultima?.ultimi_km ? String(ultima.ultimi_km) : ""} />
                  <button 
                    onClick={() => handleSave(activ)} 
                    disabled={savingId === activ.id || !canEdit || !f.cantitate_litri}
                    style={{...S.btnP, background: G.green, padding: '7px 12px', fontSize: 12, opacity: (savingId === activ.id || !canEdit || !f.cantitate_litri) ? .4 : 1, cursor: (savingId === activ.id || !canEdit || !f.cantitate_litri) ? 'not-allowed' : 'pointer'}}>
                    {savingId === activ.id ? '⏳' : '✓ Save'}
                  </button>
                </div>
              )}
              
              {/* Banner Gazpet în mini-form */}
              {!isSaved && isGazpet && rezervorActiv && f.cantitate_litri && (
                <div style={{marginTop: 6, padding: '5px 10px', background: G.purple + '15', border: `1px solid ${G.purple}33`, borderRadius: 6, fontSize: 10, color: G.muted}}>
                  📦 Stoc {rezervorActiv.nume}: {Number(rezervorActiv.stoc_curent_litri).toFixed(0)}L → {(Number(rezervorActiv.stoc_curent_litri) - Number(f.cantitate_litri)).toFixed(0)}L
                  {pretMediuRez && <> · preț mediu vrac: <strong style={{color: G.text}}>{pretMediuRez} RON/L</strong></>}
                </div>
              )}
              
              {/* Banner FEEDBACK CONSUM REAL — calculat instant când userul tastează ore */}
              {!isSaved && f.cantitate_litri && f.ore_la_alimentare && ultima?.ultime_ore && Number(f.ore_la_alimentare) > Number(ultima.ultime_ore) && (() => {
                const oreLucrate = Number(f.ore_la_alimentare) - Number(ultima.ultime_ore)
                const consumReal = Number(f.cantitate_litri) / oreLucrate
                const norma = activ.norma_consum ? Number(activ.norma_consum) : null
                const prag = activ.prag_alerta_consum ? Number(activ.prag_alerta_consum) : 10
                const unitate = activ.unitate_norma || 'l/h'
                
                let abateMsg = null, color = G.muted, bgColor = G.bg, icon = '📊'
                if (norma) {
                  const abaterePct = ((consumReal - norma) / norma) * 100
                  if (abaterePct > prag * 2) { color = G.red; bgColor = G.redDim + '88'; icon = '🚨'; abateMsg = `CRITIC: ${abaterePct > 0 ? '+' : ''}${abaterePct.toFixed(1)}% peste normă` }
                  else if (abaterePct > prag) { color = G.orange; bgColor = G.yellowDim + '88'; icon = '⚠️'; abateMsg = `WARNING: ${abaterePct > 0 ? '+' : ''}${abaterePct.toFixed(1)}% peste normă` }
                  else { color = G.green; bgColor = G.greenDim + '88'; icon = '✓'; abateMsg = `OK: ${abaterePct > 0 ? '+' : ''}${abaterePct.toFixed(1)}% față de normă` }
                }
                
                return (
                  <div style={{marginTop: 6, padding: '6px 10px', background: bgColor, border: `1px solid ${color}55`, borderRadius: 6, fontSize: 11, color: G.text, display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center'}}>
                    <span>{icon} <strong>{oreLucrate.toFixed(1)} ore lucrate</strong> · consum: <strong style={{color}}>{consumReal.toFixed(2)} {unitate}</strong></span>
                    {norma && <span style={{color: G.muted}}>· normă: {norma} {unitate}</span>}
                    {abateMsg && <span style={{color, fontWeight: 700, marginLeft: 'auto'}}>{abateMsg}</span>}
                  </div>
                )
              })()}
            </div>
          )
        })}
      </div>
      
      {Object.keys(saved).length > 0 && (
        <div style={{marginTop: 14, padding: 10, background: G.greenDim + '88', border: `1px solid ${G.green}55`, borderRadius: 8, fontSize: 12, color: G.text, textAlign: 'center'}}>
          ✓ <strong style={{color: G.green}}>{Object.keys(saved).length} alimentări înregistrate</strong> pentru {fmtDate(dataAlim)}
        </div>
      )}
      
      
      {/* Modal edit alimentare */}
      {editAlim && (
        <EditAlimentareModal 
          alim={editAlim}
          sites={sites}
          rezervoare={rezervoare}
          pretMotorina={pretMotorina}
          onClose={() => setEditAlim(null)}
          onSaved={() => { setEditAlim(null); fetchAlimentari(); onSaved() }}
          showToast={showToast}
        />
      )}
    </div>
  )
}



// ============================================================
// SECȚIUNE TRANSPORT — restaurată din legacy (commit 74e7c22, 10 mai 2026)
// Adaptată pentru rolurile noi: superadmin, admin_logistica,
// manager_santier, sef_echipa, contabilitate, hr
// ============================================================

// ============================================================

const STATUS_TRANSPORT = {
  cerut:      { label: 'Cerut',       color: G.orange, icon: '⏳' },
  aprobat:    { label: 'Aprobat',     color: G.green,  icon: '✓' },
  respins:    { label: 'Respins',     color: G.red,    icon: '✗' },
  programat:  { label: 'Programat',   color: G.blue,   icon: '📅' },
  in_tranzit: { label: 'În tranzit',  color: G.yellow, icon: '🚛' },
  livrat:     { label: 'Livrat',      color: G.green,  icon: '✅' },
  anulat:     { label: 'Anulat',      color: G.muted,  icon: '❌' },
}

const formatLocatie = (tip, site, text) => {
  if (tip === 'sediu') return '🏢 Sediu Gazpet (Ploiești)'
  if (tip === 'site' && site) return `📍 ${site.name || site}`
  if (tip === 'alta' && text) return `📍 ${text}`
  return '—'
}

const StatusBadge = ({ status }) => {
  const s = STATUS_TRANSPORT[status] || STATUS_TRANSPORT.cerut
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '3px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700,
      background: s.color + '22', color: s.color, border: `1px solid ${s.color}55`
    }}>
      <span>{s.icon}</span>
      <span>{s.label}</span>
    </span>
  )
}

// ----- Modal Comandă Transport -----
// Helper: formatare activ pentru afișaj (priorizează cod_intern, fallback la nr_inmatriculare/marca)
const formatActiv = (a) => {
  if (!a) return null
  const id = a.cod_intern || a.nr_inmatriculare || [a.marca, a.model].filter(Boolean).join(' ') || '?'
  // Prefix cu nr_inventar dacă există (format: [MF-123] TST085)
  return a.nr_inventar ? `[${a.nr_inventar}] ${id}` : id
}

// Liste funcții pentru filtrare
const FUNCTII_TRANSPORT = [
  { key: 'toate',     label: '👥 Toți angajații',    keywords: null },
  { key: 'atestati',  label: '⭐ Toți atestații',     keywords: ['SOFER', 'MASINIST', 'MACARAGIU', 'MECANIC AUTO', 'MECANIC UTILAJE', 'TEHNICIAN MASINI'] },
  { key: 'soferi',    label: '🚗 Doar Șoferi',        keywords: ['SOFER'] },
  { key: 'masinisti', label: '🏗️ Doar Masiniști',    keywords: ['MASINIST'] },
  { key: 'macaragii', label: '🏗️ Doar Macaragii',    keywords: ['MACARAGIU'] },
  { key: 'mecanici',  label: '🔧 Doar Mecanici',      keywords: ['MECANIC AUTO', 'MECANIC UTILAJE'] },
]

// Helper: verifică dacă un employee are funcția dorită (din position SAU functii_extra)
const matchesFunctie = (emp, functieKey) => {
  const f = FUNCTII_TRANSPORT.find(x => x.key === functieKey)
  if (!f || !f.keywords) return true
  const pos = (emp.position || '').toUpperCase()
  const extra = (emp.functii_extra || []).map(x => (x || '').toUpperCase())
  return f.keywords.some(kw => pos.includes(kw) || extra.some(ex => ex.includes(kw) || kw.includes(ex)))
}

// Liste atestate pentru editare per angajat
const ATESTATE_DISPONIBILE = ['SOFER', 'MASINIST', 'MACARAGIU', 'MECANIC AUTO', 'MECANIC UTILAJE', 'TEHNICIAN MASINI', 'OPERATOR PEHD']

function ComandaTransportModal({ active, sites, profile, initialTransport, onClose, onSaved, showToast }) {
  const isEdit = !!initialTransport
  const T = initialTransport  // shortcut
  
  const [tip, setTip] = useState(T?.tip || 'utilaj')
  const [activTransportatId, setActivTransportatId] = useState(T?.activ_transportat_id ? String(T.activ_transportat_id) : '')
  const [continutDescriere, setContinutDescriere] = useState(T?.continut_descriere || '')
  const [plecareTip, setPlecareTip] = useState(T?.plecare_tip || 'sediu')
  const [plecareSiteId, setPlecareSiteId] = useState(T?.plecare_site_id ? String(T.plecare_site_id) : '')
  const [plecareLocText, setPlecareLocText] = useState(T?.plecare_locatie_text || '')
  const [destinatieTip, setDestinatieTip] = useState(T?.destinatie_tip || 'site')
  const [destinatieSiteId, setDestinatieSiteId] = useState(T?.destinatie_site_id ? String(T.destinatie_site_id) : '')
  const [destinatieLocText, setDestinatieLocText] = useState(T?.destinatie_locatie_text || '')
  const [dataTransport, setDataTransport] = useState(T?.data_transport || new Date().toISOString().split('T')[0])
  const [oraPlecare, setOraPlecare] = useState(T?.ora_plecare ? T.ora_plecare.substring(0,5) : '08:00')
  const [masinaId, setMasinaId] = useState(T?.masina_id ? String(T.masina_id) : '')
  const [remorcaId, setRemorcaId] = useState(T?.remorca_id ? String(T.remorca_id) : '')
  const [filterFunctie, setFilterFunctie] = useState(T ? (T.necesita_sofer_atestat ? 'atestati' : 'toate') : (T?.tip === 'utilaj' || (!T && 'utilaj' === 'utilaj') ? 'atestati' : 'toate'))
  const [soferMode, setSoferMode] = useState(
    T ? (T.sofer_aloca_logistica ? 'logistica' : (T.sofer_gazpet ? 'manual' : 'extern')) 
      : 'logistica'  // default pentru cereri noi: Logistică alege
  )
  const [soferEmployeeId, setSoferEmployeeId] = useState(T?.sofer_employee_id ? String(T.sofer_employee_id) : '')
  const [soferSearch, setSoferSearch] = useState('')
  const [soferExternNume, setSoferExternNume] = useState(T?.sofer_extern_nume || '')
  const [soferExternTel, setSoferExternTel] = useState(T?.sofer_extern_telefon || '')
  const [costEstimat, setCostEstimat] = useState(T?.cost_estimat || '')
  const [observatii, setObservatii] = useState(T?.observatii || '')
  const [managerPlecareId, setManagerPlecareId] = useState(T?.manager_plecare_id || '')
  const [managerDestinatieId, setManagerDestinatieId] = useState(T?.manager_destinatie_id || '')
  const [profilesList, setProfilesList] = useState([])
  const [siteManagers, setSiteManagers] = useState({})  // map site_id → profile_id
  const [employees, setEmployees] = useState([])
  const [saving, setSaving] = useState(false)
  
  // Load profiles (pentru dropdown manageri — doar useri sistem)
  useEffect(() => {
    supabase.from('profiles').select('id, name, role, email').order('name').then(({ data }) => setProfilesList(data || []))
  }, [])
  
  // Load alocări site → manager (din profile_sites)
  useEffect(() => {
    supabase.from('profile_sites').select('site_id, profile_id').then(({ data }) => {
      const map = {}
      ;(data || []).forEach(({ site_id, profile_id }) => {
        if (!map[site_id]) map[site_id] = profile_id  // primul găsit (dacă mai mulți, prioritate primul)
      })
      setSiteManagers(map)
    })
  }, [])
  
  // Identifică Mitrache din profilesList (default pentru sediu) — acceptă ambele forme
  const mitrachId = useMemo(() => {
    const m = profilesList.find(p => p.email === 'alexandru.mitrache@gazpet.ro' || p.email === 'm.alexandru@gazpet.ro')
    return m?.id || ''
  }, [profilesList])
  
  // Identifică toți userii din departamentul Logistică (admin_logistica + superadmin pentru backup)
  // Filtrul e dinamic pe rol — auto-update când se schimbă echipa în BD
  const profilesLogistica = useMemo(() => {
    return profilesList.filter(p => ['admin_logistica', 'superadmin'].includes(p.role))
  }, [profilesList])
  
  // Auto-fill manager plecare la schimbarea sursei
  useEffect(() => {
    // Doar la creare nouă (nu la edit cu manager deja salvat)
    if (isEdit) return
    if (plecareTip === 'site' && plecareSiteId) {
      const mgr = siteManagers[plecareSiteId]
      if (mgr) setManagerPlecareId(mgr)
    } else if (plecareTip === 'sediu') {
      // Pentru sediu, default = Mitrache (Logistică)
      if (mitrachId) setManagerPlecareId(mitrachId)
    } else if (plecareTip === 'alta') {
      setManagerPlecareId('')
    }
  }, [plecareTip, plecareSiteId, siteManagers, mitrachId, isEdit])
  
  // Auto-fill manager destinație la schimbarea destinației
  useEffect(() => {
    if (isEdit) return
    if (destinatieTip === 'site' && destinatieSiteId) {
      const mgr = siteManagers[destinatieSiteId]
      if (mgr) setManagerDestinatieId(mgr)
    } else if (destinatieTip === 'sediu') {
      if (mitrachId) setManagerDestinatieId(mitrachId)
    } else if (destinatieTip === 'alta') {
      setManagerDestinatieId('')
    }
  }, [destinatieTip, destinatieSiteId, siteManagers, mitrachId, isEdit])
  
  // Load employees
  const loadEmployees = async () => {
    const { data } = await supabase.from('employees').select('id, name, position, department, functii_extra')
      .eq('active', true).order('name')
    setEmployees(data || [])
  }
  useEffect(() => { loadEmployees() }, [])
  
  // Auto-set filter când se schimbă tipul (doar la creare nouă, nu la edit)
  useEffect(() => {
    if (!isEdit) {
      setFilterFunctie(tip === 'utilaj' ? 'atestati' : 'toate')
      setSoferEmployeeId('')
      setSoferSearch('')
    }
  }, [tip, isEdit])
  
  // Active transportabile
  const activeTransportabile = useMemo(() => {
    return active.filter(a => {
      const t = a.logistica_categorii?.tip
      return ['Utilaj', 'Camion', 'Autoutilitară', 'Cap tractor', 'Container'].includes(t)
    })
  }, [active])
  
  // Mijloc principal
  const masiniPrincipale = useMemo(() => {
    return active.filter(a => {
      const t = a.logistica_categorii?.tip
      if (tip === 'utilaj') return ['Camion', 'Cap tractor', 'Autoutilitară'].includes(t)
      return ['Autoturism', 'Autoutilitară'].includes(t)
    })
  }, [active, tip])
  
  // Remorci/Trailere/Semiremorci
  const remorciDisponibile = useMemo(() => {
    if (tip !== 'utilaj') return []
    return active.filter(a => {
      const t = a.logistica_categorii?.tip
      return ['Remorcă', 'Trailer', 'Semiremorcă'].includes(t)
    })
  }, [active, tip])
  
  // Lista șoferi filtrată
  const soferiDisponibili = useMemo(() => {
    let list = employees.filter(e => matchesFunctie(e, filterFunctie))
    if (soferSearch.trim()) {
      const q = soferSearch.toLowerCase()
      list = list.filter(e => 
        (e.name || '').toLowerCase().includes(q) ||
        (e.position || '').toLowerCase().includes(q)
      )
    }
    return list.slice(0, 50)
  }, [employees, filterFunctie, soferSearch])
  
  // Activul transportat
  const activSelectat = useMemo(() => 
    active.find(a => String(a.id) === String(activTransportatId)), 
    [active, activTransportatId]
  )
  const masinaAleasa = useMemo(() => active.find(a => String(a.id) === String(masinaId)), [active, masinaId])
  const remorcaAleasa = useMemo(() => active.find(a => String(a.id) === String(remorcaId)), [active, remorcaId])
  const soferAles = useMemo(() => employees.find(e => String(e.id) === String(soferEmployeeId)), [employees, soferEmployeeId])
  
  // Verificare ARR
  const arrExpirat = useMemo(() => {
    if (!activSelectat?.regim_transport_special) return false
    if (!activSelectat.valabilitate_autorizatie) return false
    return new Date(activSelectat.valabilitate_autorizatie) < new Date(dataTransport)
  }, [activSelectat, dataTransport])
  
  // Toggle funcție extra pentru șoferul ales (instant save în DB)
  const toggleFunctieExtra = async (atestat) => {
    if (!soferAles) return
    const curent = soferAles.functii_extra || []
    const nou = curent.includes(atestat) ? curent.filter(x => x !== atestat) : [...curent, atestat]
    
    const { error } = await supabase.from('employees').update({ functii_extra: nou }).eq('id', soferAles.id)
    if (error) { showToast('Eroare update: ' + error.message, 'error'); return }
    showToast(`✓ Funcții extra actualizate pentru ${soferAles.name}`)
    
    // Reload employees ca să reflecte schimbarea
    await loadEmployees()
  }
  
  const handleSave = async () => {
    // Validări
    if (tip === 'utilaj' && !activTransportatId) {
      showToast('Selectează utilajul de transportat', 'warn')
      return
    }
    if (tip === 'mic_tesa' && !continutDescriere.trim()) {
      showToast('Descrie ce se transportă', 'warn')
      return
    }
    if (plecareTip === 'site' && !plecareSiteId) {
      showToast('Selectează șantierul de plecare', 'warn')
      return
    }
    if (plecareTip === 'alta' && !plecareLocText.trim()) {
      showToast('Completează locația de plecare', 'warn')
      return
    }
    if (destinatieTip === 'site' && !destinatieSiteId) {
      showToast('Selectează șantierul destinație', 'warn')
      return
    }
    if (destinatieTip === 'alta' && !destinatieLocText.trim()) {
      showToast('Completează destinația', 'warn')
      return
    }
    if (!dataTransport) {
      showToast('Selectează data transportului', 'warn')
      return
    }
    if (soferMode === 'manual' && !soferEmployeeId) {
      showToast('Selectează șoferul din lista de angajați', 'warn')
      return
    }
    if (soferMode === 'extern' && !soferExternNume.trim()) {
      showToast('Completează numele șoferului extern', 'warn')
      return
    }
    if (arrExpirat) {
      if (!confirm(`⚠️ ATENȚIE: Autorizația ARR a expirat pe ${activSelectat.valabilitate_autorizatie}!\n\nContinui totuși cu cererea?`)) return
    }
    
    setSaving(true)
    const payload = {
      tip,
      activ_transportat_id: tip === 'utilaj' ? Number(activTransportatId) : null,
      continut_descriere: tip === 'mic_tesa' ? continutDescriere.trim() : null,
      plecare_tip: plecareTip,
      plecare_site_id: plecareTip === 'site' ? Number(plecareSiteId) : null,
      plecare_locatie_text: plecareTip === 'alta' ? plecareLocText.trim() : null,
      destinatie_tip: destinatieTip,
      destinatie_site_id: destinatieTip === 'site' ? Number(destinatieSiteId) : null,
      destinatie_locatie_text: destinatieTip === 'alta' ? destinatieLocText.trim() : null,
      data_transport: dataTransport,
      ora_plecare: oraPlecare || null,
      masina_id: masinaId ? Number(masinaId) : null,
      remorca_id: remorcaId ? Number(remorcaId) : null,
      necesita_sofer_atestat: filterFunctie !== 'toate',  // bazat pe filtrul ales
      sofer_aloca_logistica: soferMode === 'logistica',
      sofer_gazpet: soferMode !== 'extern',  // logistica + manual = gazpet, doar extern = false
      sofer_employee_id: soferMode === 'manual' && soferEmployeeId ? Number(soferEmployeeId) : null,
      sofer_id: null,  // legacy
      sofer_extern_nume: soferMode === 'extern' ? soferExternNume.trim() : null,
      sofer_extern_telefon: soferMode === 'extern' ? (soferExternTel.trim() || null) : null,
      necesita_regim_special: !!(activSelectat?.regim_transport_special),
      cost_estimat: costEstimat ? Number(costEstimat) : null,
      observatii: observatii.trim() || null,
      manager_plecare_id: managerPlecareId || null,
      manager_destinatie_id: managerDestinatieId || null,
    }
    
    let error
    if (isEdit) {
      // Update — păstrăm status și solicitant_id originale
      const result = await supabase.from('logistica_transporturi').update(payload).eq('id', T.id)
      error = result.error
    } else {
      // Insert nou — adăugăm status='cerut' și solicitant_id
      payload.status = 'cerut'
      payload.solicitant_id = profile?.id
      payload.data_solicitarii = new Date().toISOString()
      const result = await supabase.from('logistica_transporturi').insert(payload)
      error = result.error
    }
    
    setSaving(false)
    
    if (error) {
      showToast('Eroare la salvare: ' + error.message, 'error')
      return
    }
    showToast(isEdit ? '✓ Cererea a fost actualizată!' : '✓ Cererea de transport a fost trimisă!')
    onSaved?.()
    onClose()
  }
  
  return (
    <div style={{position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:20}}>
      <div style={{...S.card, width:'100%', maxWidth:780, maxHeight:'92vh', overflow:'auto', padding:24}}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:18}}>
          <div>
            <div style={{fontSize:18, fontWeight:700, color:G.text, marginBottom:4}}>{isEdit ? `✏️ Editează transport ${T.numar_transport || ''}` : '🚚 Comandă transport nou'}</div>
            <div style={{fontSize:12, color:G.muted}}>{isEdit ? 'Modifici cererea — datele vor fi actualizate' : 'Cererea va fi trimisă spre aprobare către Mitrache + Cristiana'}</div>
          </div>
          <button onClick={onClose} style={{...S.btnS, padding:'4px 10px'}}>✕</button>
        </div>
        
        {/* Toggle TIP */}
        <div style={{display:'flex', gap:6, marginBottom:16, padding:4, background:G.bg, borderRadius:10, border:`1px solid ${G.border}`}}>
          {[
            { v: 'utilaj', label: '🚛 Utilaj', desc: 'Excavatoare, generatoare, basculante' },
            { v: 'materiale', label: '📦 Materiale', desc: 'Din stoc magazie / șantier' },
            { v: 'mic_tesa', label: '📄 Mic (TESA)', desc: 'Documente, dosare' },
          ].map(opt => (
            <button key={opt.v} onClick={() => setTip(opt.v)} style={{
              flex:1, padding:'10px 12px', borderRadius:8, border:'none', cursor:'pointer',
              background: tip === opt.v ? G.logistica + '33' : 'transparent',
              color: tip === opt.v ? G.logistica : G.muted,
              fontWeight:700, fontSize:13, textAlign:'left'
            }}>
              <div>{opt.label}</div>
              <div style={{fontSize:10, fontWeight:400, marginTop:2, color:G.muted}}>{opt.desc}</div>
            </button>
          ))}
        </div>
        
        {/* TIP MATERIALE - Placeholder pentru viitor modul Magazie */}
        {tip === 'materiale' && (
          <div style={{marginBottom:14}}>
            <div style={{padding:18, background:G.purple+'11', border:`2px dashed ${G.purple}77`, borderRadius:12, textAlign:'center'}}>
              <div style={{fontSize:32, marginBottom:8}}>📦</div>
              <div style={{fontSize:15, fontWeight:700, color:G.purple, marginBottom:6}}>Transport Materiale — În curs de dezvoltare</div>
              <div style={{fontSize:12, color:G.muted, lineHeight:1.6, maxWidth:480, margin:'0 auto'}}>
                Această funcționalitate va fi disponibilă odată cu <strong>Modulul Magazie</strong>. 
                Vei putea selecta materiale din stoc (magazie centrală sau alt șantier) și genera transfer cu aviz automat.
                <br/><br/>
                <strong>Pentru moment</strong>, descrie materialele transportate în câmpul "Conținut transport" de mai jos.
              </div>
              <div style={{marginTop:12, padding:'8px 14px', background:G.purple+'22', color:G.purple, borderRadius:6, display:'inline-block', fontSize:11, fontWeight:700, letterSpacing:.5}}>
                🚧 ÎN CURÂND
              </div>
            </div>
          </div>
        )}
        
        {/* TIP UTILAJ */}
        {tip === 'utilaj' && (
          <div style={{marginBottom:14}}>
            <div style={{fontSize:11, color:G.logistica, fontWeight:700, textTransform:'uppercase', letterSpacing:.6, marginBottom:8}}>🚛 Activ de transportat</div>
            <FieldSelect 
              label="Selectează activul" 
              value={activTransportatId} 
              onChange={setActivTransportatId}
              options={[{label:'— alege —', value:''}, ...activeTransportabile.map(a => ({
                label: `${a.cod_intern || ''} · ${a.marca || ''} ${a.model || ''} ${a.nr_inmatriculare ? '(' + a.nr_inmatriculare + ')' : ''}`,
                value: String(a.id)
              }))]}
            />
            
            {activSelectat && (
              <div style={{marginTop:10, padding:10, background:G.bg, border:`1px solid ${G.border}`, borderRadius:8, fontSize:12}}>
                <div style={{display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:8, color:G.muted}}>
                  <div>📏 L: <strong style={{color:G.text}}>{activSelectat.lungime_m || '—'} m</strong></div>
                  <div>↔️ W: <strong style={{color:G.text}}>{activSelectat.latime_m || '—'} m</strong></div>
                  <div>↕️ H: <strong style={{color:G.text}}>{activSelectat.inaltime_m || '—'} m</strong></div>
                  <div>⚖️ G: <strong style={{color:G.text}}>{activSelectat.greutate_kg || '—'} kg</strong></div>
                </div>
                {activSelectat.regim_transport_special && (
                  <div style={{marginTop:8, padding:8, background:G.redDim + '88', border:`1px solid ${G.red}55`, borderRadius:6, color:G.red, fontWeight:700, fontSize:12}}>
                    ⚠️ REGIM TRANSPORT SPECIAL
                    {activSelectat.nr_autorizatie_arr && <span style={{fontWeight:400, color:G.text}}> · ARR: {activSelectat.nr_autorizatie_arr}</span>}
                    {activSelectat.valabilitate_autorizatie && <span style={{fontWeight:400, color:arrExpirat ? G.red : G.text}}> · Valabilă: {activSelectat.valabilitate_autorizatie}{arrExpirat ? ' (EXPIRATĂ!)' : ''}</span>}
                    {activSelectat.necesita_pilot && <span style={{fontWeight:400, color:G.text}}> · 🚓 Pilot necesar</span>}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        
        {/* TIP MIC TESA */}
        {tip === 'mic_tesa' && (
          <div style={{marginBottom:14}}>
            <div style={{fontSize:11, color:G.logistica, fontWeight:700, textTransform:'uppercase', letterSpacing:.6, marginBottom:8}}>📄 Conținut transport</div>
            <FieldTextarea 
              label="Ce se transportă (descriere detaliată)"
              value={continutDescriere}
              onChange={setContinutDescriere}
              rows={3}
              placeholder="ex: 3 dosare licitație ANRE + manometru calibrat + 2 cărți tehnice instalație gaz"
            />
          </div>
        )}
        
        {/* TRASEU */}
        <div style={{marginBottom:14}}>
          <div style={{fontSize:11, color:G.logistica, fontWeight:700, textTransform:'uppercase', letterSpacing:.6, marginBottom:8}}>🛣️ Traseu</div>
          
          {/* Plecare */}
          <div style={{marginBottom:12}}>
            <div style={{fontSize:11, color:G.muted, marginBottom:4, fontWeight:600}}>DE LA (plecare)</div>
            <div style={{display:'flex', gap:8, marginBottom:6}}>
              <select value={plecareTip} onChange={e => setPlecareTip(e.target.value)} style={{...S.input, width:200}}>
                <option value="sediu">🏢 Sediu Gazpet</option>
                <option value="site">📍 Șantier</option>
                <option value="alta">✏️ Altă locație</option>
              </select>
              {plecareTip === 'site' && (
                <select value={plecareSiteId} onChange={e => setPlecareSiteId(e.target.value)} style={{...S.input, flex:1}}>
                  <option value="">— alege șantier —</option>
                  {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              )}
              {plecareTip === 'alta' && (
                <input type="text" value={plecareLocText} onChange={e => setPlecareLocText(e.target.value)} placeholder="ex: Depozit furnizor SC X SRL, București" style={{...S.input, flex:1}} />
              )}
            </div>
            {/* Manager plecare — smart: pentru sediu doar Logistică, pentru site auto-completat */}
            <select 
              value={managerPlecareId} 
              onChange={e => setManagerPlecareId(e.target.value)} 
              style={{...S.input, fontSize:12, borderColor: managerPlecareId ? G.green + '88' : G.border2}}
            >
              <option value="">👤 Manager plecare {plecareTip === 'sediu' ? '(filtrat: Logistică)' : '(opțional)'}</option>
              {(plecareTip === 'sediu' ? profilesLogistica : profilesList).map(p => 
                <option key={p.id} value={p.id}>{p.name} {p.role ? `(${p.role})` : ''}</option>
              )}
            </select>
            {managerPlecareId && plecareTip === 'site' && siteManagers[plecareSiteId] === managerPlecareId && (
              <div style={{fontSize:10, color:G.green, marginTop:2}}>✓ Auto-completat din alocările șantierului</div>
            )}
          </div>
          
          {/* Destinație */}
          <div>
            <div style={{fontSize:11, color:G.muted, marginBottom:4, fontWeight:600}}>LA (destinație)</div>
            <div style={{display:'flex', gap:8, marginBottom:6}}>
              <select value={destinatieTip} onChange={e => setDestinatieTip(e.target.value)} style={{...S.input, width:200}}>
                <option value="sediu">🏢 Sediu Gazpet</option>
                <option value="site">📍 Șantier</option>
                <option value="alta">✏️ Altă locație</option>
              </select>
              {destinatieTip === 'site' && (
                <select value={destinatieSiteId} onChange={e => setDestinatieSiteId(e.target.value)} style={{...S.input, flex:1}}>
                  <option value="">— alege șantier —</option>
                  {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              )}
              {destinatieTip === 'alta' && (
                <input type="text" value={destinatieLocText} onChange={e => setDestinatieLocText(e.target.value)} placeholder="ex: ANRE Sediu central, Str. Constantin Nacu 3, București" style={{...S.input, flex:1}} />
              )}
            </div>
            {/* Manager destinație — IMPORTANT pentru confirmare primire */}
            <select value={managerDestinatieId} onChange={e => setManagerDestinatieId(e.target.value)} style={{...S.input, fontSize:12, borderColor: managerDestinatieId ? G.green + '88' : G.border2}}>
              <option value="">⚠️ Manager destinație (cel care va confirma primirea)</option>
              {(destinatieTip === 'sediu' ? profilesLogistica : profilesList).map(p => 
                <option key={p.id} value={p.id}>{p.name} {p.role ? `(${p.role})` : ''}</option>
              )}
            </select>
            {managerDestinatieId && destinatieTip === 'site' && siteManagers[destinatieSiteId] === managerDestinatieId && (
              <div style={{fontSize:10, color:G.green, marginTop:2}}>✓ Auto-completat din alocările șantierului</div>
            )}
            {managerDestinatieId && (
              <div style={{fontSize:10, color:G.green, marginTop:4}}>
                ✓ La livrare, această persoană va confirma primirea utilajului
              </div>
            )}
          </div>
        </div>
        
        {/* DATA + ORA */}
        <div style={{marginBottom:14}}>
          <div style={{fontSize:11, color:G.logistica, fontWeight:700, textTransform:'uppercase', letterSpacing:.6, marginBottom:8}}>📅 Programare</div>
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, maxWidth:400}}>
            <FieldText label="Data transport" type="date" value={dataTransport} onChange={setDataTransport} />
            <FieldText label="Ora plecare" type="time" value={oraPlecare} onChange={setOraPlecare} />
          </div>
        </div>
        
        {/* MIJLOC TRANSPORT (combo cap tractor + remorcă pentru utilaje) */}
        <div style={{marginBottom:14}}>
          <div style={{fontSize:11, color:G.logistica, fontWeight:700, textTransform:'uppercase', letterSpacing:.6, marginBottom:8}}>🚛 Mijloc transport</div>
          <div style={{display:'grid', gridTemplateColumns: tip === 'utilaj' ? '1fr 1fr' : '1fr', gap:10}}>
            <FieldSelect 
              label={tip === 'utilaj' ? 'Mijloc principal (camion / cap tractor)' : 'Mașina (autoturism, opțional)'}
              value={masinaId} 
              onChange={setMasinaId}
              options={[{label:'— niciunul —', value:''}, ...masiniPrincipale.map(a => ({
                label: `${formatActiv(a)} · ${a.marca || ''} ${a.model || ''}${a.nr_inmatriculare && a.cod_intern ? ' (' + a.nr_inmatriculare + ')' : ''}`,
                value: String(a.id)
              }))]}
            />
            {tip === 'utilaj' && (
              <FieldSelect 
                label="Remorcă / Trailer / Semiremorcă (opțional)"
                value={remorcaId} 
                onChange={setRemorcaId}
                options={[{label:'— fără remorcă —', value:''}, ...remorciDisponibile.map(a => ({
                  label: `${formatActiv(a)} · ${a.logistica_categorii?.tip || ''} ${a.marca || ''} ${a.model || ''}${a.nr_inmatriculare && a.cod_intern ? ' (' + a.nr_inmatriculare + ')' : ''}`,
                  value: String(a.id)
                }))]}
              />
            )}
          </div>
          {/* Preview combo */}
          {(masinaAleasa || remorcaAleasa) && (
            <div style={{marginTop:8, padding:8, background:G.bg, border:`1px solid ${G.border}`, borderRadius:6, fontSize:12, color:G.muted}}>
              <strong style={{color:G.text}}>🔗 Combo: </strong>
              {masinaAleasa && <span style={{color:G.text}}>{formatActiv(masinaAleasa)} {masinaAleasa.marca}</span>}
              {masinaAleasa && remorcaAleasa && <span style={{margin:'0 6px'}}>+</span>}
              {remorcaAleasa && <span style={{color:G.logistica}}>{formatActiv(remorcaAleasa)} ({remorcaAleasa.logistica_categorii?.tip})</span>}
            </div>
          )}
        </div>
        
        {/* ȘOFER — 3 moduri: Logistică alege / Aleg eu / Extern */}
        <div style={{marginBottom:14}}>
          <div style={{fontSize:11, color:G.logistica, fontWeight:700, textTransform:'uppercase', letterSpacing:.6, marginBottom:8}}>👤 Șofer</div>
          
          {/* Selector mod alegere șofer — radio buttons mari */}
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8, marginBottom:12}}>
            {[
              { v: 'logistica', icon: '🏢', label: 'Logistică alege', desc: 'Dept Logistică alocă șoferul la aprobare' },
              { v: 'manual',    icon: '👤', label: 'Aleg eu acum',    desc: 'Selectez din angajații Gazpet' },
              { v: 'extern',    icon: '🚚', label: 'Șofer extern',    desc: 'Curier / transportator extern' },
            ].map(opt => (
              <button key={opt.v} onClick={() => setSoferMode(opt.v)} style={{
                padding:'10px 12px', borderRadius:8, cursor:'pointer', textAlign:'left',
                background: soferMode === opt.v ? G.logistica + '22' : G.bg,
                border: `1px solid ${soferMode === opt.v ? G.logistica : G.border}`,
                color: soferMode === opt.v ? G.logistica : G.text
              }}>
                <div style={{fontSize:13, fontWeight:700, marginBottom:2}}>{opt.icon} {opt.label}</div>
                <div style={{fontSize:10, color: soferMode === opt.v ? G.logistica : G.muted, fontWeight:400}}>{opt.desc}</div>
              </button>
            ))}
          </div>
          
          {/* MODE: LOGISTICA ALEGE — info doar */}
          {soferMode === 'logistica' && (
            <div style={{padding:12, background:G.greenDim, border:`1px solid ${G.green}55`, borderRadius:8, fontSize:12, color:G.text}}>
              ✓ <strong>Departamentul Logistică va aloca șoferul potrivit la aprobare.</strong>
              <div style={{fontSize:11, color:G.muted, marginTop:4}}>
                Cererea ta apare în tabel cu badge "🏢 Logistică alocă". Mitrache sau Cristiana vor selecta șoferul disponibil cu atestatul potrivit înainte să aprobe.
              </div>
            </div>
          )}
          
          {/* MODE: MANUAL — listă șoferi cu filtru funcție */}
          {soferMode === 'manual' && (
            <div>
              {/* Filtru funcție + Search */}
              <div style={{display:'grid', gridTemplateColumns:'1fr 2fr', gap:8, marginBottom:8}}>
                <select value={filterFunctie} onChange={e => { setFilterFunctie(e.target.value); setSoferEmployeeId(''); }} style={{...S.input, fontSize:13}}>
                  {FUNCTII_TRANSPORT.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                </select>
                <input 
                  type="text" 
                  value={soferSearch} 
                  onChange={e => setSoferSearch(e.target.value)} 
                  placeholder={`🔍 Caută după nume sau funcție... (${soferiDisponibili.length} găsiți)`}
                  style={S.input}
                />
              </div>
              
              {/* Lista cu radio buttons */}
              <div style={{maxHeight: 200, overflowY:'auto', border:`1px solid ${G.border}`, borderRadius:8, background:G.bg}}>
                {soferiDisponibili.length === 0 ? (
                  <div style={{padding:14, textAlign:'center', color:G.muted, fontSize:12}}>
                    {soferSearch ? `Niciun rezultat pentru "${soferSearch}"` : 'Niciun angajat în această categorie'}
                  </div>
                ) : (
                  soferiDisponibili.map(emp => (
                    <label key={emp.id} style={{
                      display:'flex', alignItems:'center', gap:10, padding:'8px 12px', cursor:'pointer',
                      borderBottom:`1px solid ${G.border}`,
                      background: String(soferEmployeeId) === String(emp.id) ? G.logistica + '22' : 'transparent'
                    }}>
                      <input type="radio" name="sofer" checked={String(soferEmployeeId) === String(emp.id)} onChange={() => setSoferEmployeeId(emp.id)} style={{accentColor:G.logistica}} />
                      <div style={{flex:1}}>
                        <div style={{fontSize:13, color:G.text, fontWeight:600}}>{emp.name}</div>
                        <div style={{fontSize:10, color:G.muted}}>
                          {emp.position || '—'}{emp.department ? ` · ${emp.department}` : ''}
                          {emp.functii_extra && emp.functii_extra.length > 0 && (
                            <span style={{color:G.logistica, marginLeft:6}}>· extra: {emp.functii_extra.join(', ')}</span>
                          )}
                        </div>
                      </div>
                    </label>
                  ))
                )}
              </div>
              
              {/* Confirmare șofer ales + widget funcții extra */}
              {soferAles && (
                <div style={{marginTop:8, padding:10, background:G.greenDim, border:`1px solid ${G.green}55`, borderRadius:6}}>
                  <div style={{fontSize:12, color:G.text, marginBottom:6}}>
                    ✓ Șofer ales: <strong>{soferAles.name}</strong> · <span style={{color:G.muted}}>{soferAles.position}</span>
                  </div>
                  
                  {/* Mini-widget editare funcții extra */}
                  <div style={{paddingTop:8, borderTop:`1px solid ${G.green}33`, marginTop:6}}>
                    <div style={{fontSize:10, color:G.muted, marginBottom:6, fontWeight:600}}>
                      ✨ FUNCȚII EXTRA ALE ACESTUI ANGAJAT (atestate / categorii suplimentare):
                    </div>
                    <div style={{display:'flex', flexWrap:'wrap', gap:6}}>
                      {ATESTATE_DISPONIBILE.map(at => {
                        const active = (soferAles.functii_extra || []).includes(at)
                        const inPos = (soferAles.position || '').toUpperCase().includes(at)
                        return (
                          <label key={at} style={{
                            display:'flex', alignItems:'center', gap:4, padding:'4px 8px', borderRadius:6,
                            cursor: inPos ? 'default' : 'pointer',
                            background: active ? G.logistica + '33' : (inPos ? G.surface : G.bg),
                            border:`1px solid ${active ? G.logistica : G.border}`,
                            opacity: inPos ? 0.6 : 1
                          }} title={inPos ? 'Deja inclus în poziția principală' : 'Click pentru a comuta'}>
                            <input 
                              type="checkbox" 
                              checked={active || inPos} 
                              disabled={inPos}
                              onChange={() => !inPos && toggleFunctieExtra(at)} 
                              style={{width:12, height:12, accentColor:G.logistica}} 
                            />
                            <span style={{fontSize:10, color:G.text, fontWeight:600}}>{at}</span>
                            {inPos && <span style={{fontSize:9, color:G.muted}}>(principal)</span>}
                          </label>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
          
          {/* MODE: EXTERN */}
          {soferMode === 'extern' && (
            <div style={{display:'grid', gridTemplateColumns:'2fr 1fr', gap:10}}>
              <FieldText label="Nume șofer extern" value={soferExternNume} onChange={setSoferExternNume} placeholder="ex: Ion Popescu (Transport SRL)" />
              <FieldText label="Telefon" value={soferExternTel} onChange={setSoferExternTel} placeholder="ex: 0722 123 456" />
            </div>
          )}
        </div>
        
        {/* COST + OBSERVAȚII */}
        <div style={{marginBottom:14, display:'grid', gridTemplateColumns:'1fr 2fr', gap:10}}>
          <FieldText label="Cost estimat (RON)" type="number" value={costEstimat} onChange={setCostEstimat} placeholder="opțional" />
          <FieldTextarea label="Observații" value={observatii} onChange={setObservatii} rows={2} placeholder="orice altceva relevant..." />
        </div>
        
        {/* INFO solicitant */}
        <div style={{padding:10, background:G.bg, border:`1px solid ${G.border}`, borderRadius:8, marginBottom:14, fontSize:12, color:G.muted}}>
          📝 Solicitant: <strong style={{color:G.text}}>{profile?.name || 'tu'}</strong>
          <span style={{marginLeft:8}}>· Status {isEdit ? 'actual' : 'inițial'}: <StatusBadge status={isEdit ? T.status : 'cerut'} /></span>
          {isEdit && T.numar_transport && <span style={{marginLeft:8, fontFamily:'monospace', color:G.logistica, fontWeight:700}}>· {T.numar_transport}</span>}
        </div>
        
        {/* BUTOANE */}
        <div style={{display:'flex', gap:10, justifyContent:'flex-end'}}>
          <button onClick={onClose} style={S.btnS} disabled={saving}>Anulează</button>
          <button onClick={handleSave} disabled={saving} style={{...S.btnP, background:G.green}}>
            {saving ? 'Salvez...' : (isEdit ? '💾 Salvează modificările' : '✓ Trimite cererea')}
          </button>
        </div>
      </div>
    </div>
  )
}


// ----- Identificare aprobatori (pentru workflow) -----
// Aprobatori: superadmin + admin_logistica (rolurile noi)
const isAprobatorTransport = (profile) => {
  return ['superadmin', 'admin_logistica'].includes(profile?.role)
}

function DetaliiTransportModal({ transport: T, profile, onClose, onChanged, onEdit, showToast, sites }) {
  const [showRespingere, setShowRespingere] = useState(false)
  const [motivRespingere, setMotivRespingere] = useState('')
  const [showAlegeSofer, setShowAlegeSofer] = useState(false)
  const [showConfirmPrimire, setShowConfirmPrimire] = useState(false)
  const [confirmareObs, setConfirmareObs] = useState('')
  const [employees, setEmployees] = useState([])
  const [soferEmployeeId, setSoferEmployeeId] = useState('')
  const [soferSearch, setSoferSearch] = useState('')
  const [filterFunctie, setFilterFunctie] = useState('soferi')  // default doar șoferi atestați
  const [actionLoading, setActionLoading] = useState(false)
  const [dataTransportEdit, setDataTransportEdit] = useState(T?.data_transport || '')  // editabilă la aprobare
  const [showAviz, setShowAviz] = useState(false)  // PAS 5F: deschide modal aviz
  
  const isAprobator = isAprobatorTransport(profile)
  const isSolicitant = profile?.id === T.solicitant_id
  const isManagerDestinatie = profile?.id === T.manager_destinatie_id
  const isManagerPlecare = profile?.id === T.manager_plecare_id
  const status = T.status
  
  // Load employees (pentru când Logistică alege șofer la aprobare)
  useEffect(() => {
    if (showAlegeSofer) {
      supabase.from('employees').select('id, name, position, department, functii_extra')
        .eq('active', true).order('name').then(({ data }) => setEmployees(data || []))
    }
  }, [showAlegeSofer])
  
  const soferiDisponibili = useMemo(() => {
    let list = employees.filter(e => matchesFunctie(e, filterFunctie))
    if (soferSearch.trim()) {
      const q = soferSearch.toLowerCase()
      list = list.filter(e => 
        (e.name || '').toLowerCase().includes(q) ||
        (e.position || '').toLowerCase().includes(q)
      )
    }
    return list.slice(0, 30)
  }, [employees, filterFunctie, soferSearch])
  
  // Format locație
  const formatLoc = (tip, site, text) => formatLocatie(tip, site, text)
  
  // ---- Acțiuni ----
  const handleAproba = async () => {
    // Dacă sofer_aloca_logistica și fără șofer → cere alegerea ÎNTÂI
    if (T.sofer_aloca_logistica && !T.sofer_employee_id && !showAlegeSofer) {
      setShowAlegeSofer(true)
      return
    }
    if (showAlegeSofer && !soferEmployeeId) {
      showToast('Selectează șoferul înainte de aprobare', 'warn')
      return
    }
    
    setActionLoading(true)
    const updateData = {
      status: 'aprobat',
      aprobator_id: profile.id,
      data_aprobare: new Date().toISOString(),
    }
    // Dacă data a fost modificată față de original, actualizează și data_transport
    if (dataTransportEdit && dataTransportEdit !== T.data_transport) {
      updateData.data_transport = dataTransportEdit
    }
    if (showAlegeSofer && soferEmployeeId) {
      updateData.sofer_employee_id = Number(soferEmployeeId)
      updateData.sofer_gazpet = true
      updateData.sofer_aloca_logistica = false  // s-a alocat
    }
    
    const { error } = await supabase.from('logistica_transporturi').update(updateData).eq('id', T.id)
    setActionLoading(false)
    if (error) { showToast('Eroare aprobare: ' + error.message, 'error'); return }
    showToast('✓ Transport aprobat! Următorul pas: programare.')
    onChanged?.()
    onClose()
  }
  
  const handleRespinge = async () => {
    if (!motivRespingere.trim()) {
      showToast('Motivul respingerii e obligatoriu', 'warn')
      return
    }
    setActionLoading(true)
    const { error } = await supabase.from('logistica_transporturi').update({
      status: 'respins',
      aprobator_id: profile.id,
      data_aprobare: new Date().toISOString(),
      motiv_respingere: motivRespingere.trim()
    }).eq('id', T.id)
    setActionLoading(false)
    if (error) { showToast('Eroare: ' + error.message, 'error'); return }
    showToast('✓ Transport respins')
    onChanged?.()
    onClose()
  }
  
  const handleAnuleaza = async () => {
    if (!confirm('Sigur vrei să anulezi această cerere de transport? Acțiunea nu poate fi reversată.')) return
    setActionLoading(true)
    const { error } = await supabase.from('logistica_transporturi').update({ status: 'anulat' }).eq('id', T.id)
    setActionLoading(false)
    if (error) { showToast('Eroare: ' + error.message, 'error'); return }
    showToast('Cererea a fost anulată')
    onChanged?.()
    onClose()
  }
  
  const handleSchimbaStatus = async (nou) => {
    const labels = { programat: 'Programat', in_tranzit: 'În tranzit', livrat: 'Livrat' }
    if (!confirm(`Schimbi status la "${labels[nou]}"?`)) return
    setActionLoading(true)
    const { error } = await supabase.from('logistica_transporturi').update({ status: nou }).eq('id', T.id)
    setActionLoading(false)
    if (error) { showToast('Eroare: ' + error.message, 'error'); return }
    showToast(`✓ Status schimbat: ${labels[nou]}`)
    onChanged?.()
    onClose()
  }
  
  // Confirmare primire — acțiune specială când transportul ajunge la destinație
  const handleConfirmPrimire = async () => {
    setActionLoading(true)
    const { error } = await supabase.from('logistica_transporturi').update({
      status: 'livrat',
      confirmat_primire_la: new Date().toISOString(),
      confirmat_primire_de: profile.id,
      confirmare_observatii: confirmareObs.trim() || null
    }).eq('id', T.id)
    setActionLoading(false)
    if (error) { showToast('Eroare: ' + error.message, 'error'); return }
    showToast('✅ Primire confirmată — transport finalizat!')
    onChanged?.()
    onClose()
  }
  
  return (
    <div style={{position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:20}}>
      <div style={{...S.card, width:'100%', maxWidth:780, maxHeight:'92vh', overflow:'auto', padding:24}}>
        {/* Header */}
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:14, paddingBottom:12, borderBottom:`1px solid ${G.border}`}}>
          <div>
            <div style={{display:'flex', alignItems:'center', gap:10, marginBottom:4}}>
              <span style={{fontSize:24}}>{T.tip === 'utilaj' ? '🚛' : '📄'}</span>
              <span style={{fontSize:18, fontWeight:700, color:G.text, fontFamily:'monospace'}}>{T.numar_transport}</span>
              <StatusBadge status={status} />
            </div>
            <div style={{fontSize:11, color:G.muted}}>
              Solicitat: {new Date(T.data_solicitarii).toLocaleString('ro-RO')} de <strong style={{color:G.text}}>{T.solicitant?.name || '—'}</strong>
              {T.aprobator && <span> · Aprobat de <strong style={{color:G.text}}>{T.aprobator.name}</strong></span>}
            </div>
          </div>
          <button onClick={onClose} style={{...S.btnS, padding:'4px 10px'}}>✕</button>
        </div>
        
        {/* Detalii activ/conținut */}
        <div style={{marginBottom:12}}>
          <div style={{fontSize:11, color:G.logistica, fontWeight:700, textTransform:'uppercase', letterSpacing:.6, marginBottom:6}}>
            {T.tip === 'utilaj' ? '🚛 Activ transportat' : '📄 Conținut'}
          </div>
          {T.tip === 'utilaj' && T.activ_transportat ? (
            <div style={{padding:10, background:G.bg, border:`1px solid ${G.border}`, borderRadius:8, fontSize:13}}>
              <div style={{color:G.text, fontWeight:600}}>{T.activ_transportat.cod_intern || formatActiv(T.activ_transportat)} · {T.activ_transportat.marca} {T.activ_transportat.model}</div>
              {T.activ_transportat.regim_transport_special && <div style={{fontSize:11, color:G.red, fontWeight:600, marginTop:4}}>⚠️ REGIM TRANSPORT SPECIAL</div>}
            </div>
          ) : (
            <div style={{padding:10, background:G.bg, border:`1px solid ${G.border}`, borderRadius:8, fontSize:13, color:G.text}}>
              {T.continut_descriere || '—'}
            </div>
          )}
          {(T.masina || T.remorca) && (
            <div style={{marginTop:6, fontSize:12, color:G.logistica}}>
              🚛 Mijloc: {T.masina ? formatActiv(T.masina) : 'fără mijloc'}
              {T.remorca && <span> + {formatActiv(T.remorca)} ({T.remorca.logistica_categorii?.tip})</span>}
            </div>
          )}
        </div>
        
        {/* Traseu */}
        <div style={{marginBottom:12, display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10}}>
          <div style={{padding:10, background:G.bg, border:`1px solid ${G.border}`, borderRadius:8}}>
            <div style={{fontSize:10, color:G.muted, fontWeight:700, textTransform:'uppercase', marginBottom:4}}>De la</div>
            <div style={{fontSize:13, color:G.text}}>{formatLoc(T.plecare_tip, T.plecare_site, T.plecare_locatie_text)}</div>
            {T.manager_plecare && (
              <div style={{fontSize:10, color:G.muted, marginTop:6, paddingTop:6, borderTop:`1px solid ${G.border}`}}>
                👤 Manager plecare: <strong style={{color:G.text}}>{T.manager_plecare.name}</strong>
              </div>
            )}
          </div>
          <div style={{padding:10, background:G.bg, border:`1px solid ${G.border}`, borderRadius:8}}>
            <div style={{fontSize:10, color:G.muted, fontWeight:700, textTransform:'uppercase', marginBottom:4}}>La</div>
            <div style={{fontSize:13, color:G.text}}>{formatLoc(T.destinatie_tip, T.destinatie_site, T.destinatie_locatie_text)}</div>
            {T.manager_destinatie ? (
              <div style={{fontSize:10, color:isManagerDestinatie ? G.green : G.muted, marginTop:6, paddingTop:6, borderTop:`1px solid ${G.border}`}}>
                👤 Manager destinație: <strong style={{color:isManagerDestinatie ? G.green : G.text}}>{T.manager_destinatie.name}</strong>
                {isManagerDestinatie && <span style={{marginLeft:4, fontWeight:700}}>(TU!)</span>}
              </div>
            ) : (
              <div style={{fontSize:10, color:G.orange, marginTop:6, paddingTop:6, borderTop:`1px solid ${G.border}`}}>
                ⚠️ Fără manager destinație
              </div>
            )}
          </div>
          <div style={{padding:10, background:G.bg, border:`1px solid ${G.border}`, borderRadius:8}}>
            <div style={{fontSize:10, color:G.muted, fontWeight:700, textTransform:'uppercase', marginBottom:4}}>📅 Data · Ora</div>
            <div style={{fontSize:13, color:G.text}}>{T.data_transport}{T.ora_plecare ? ` · ${T.ora_plecare.substring(0,5)}` : ''}</div>
          </div>
        </div>
        
        {/* Șofer */}
        <div style={{marginBottom:12}}>
          <div style={{fontSize:11, color:G.logistica, fontWeight:700, textTransform:'uppercase', letterSpacing:.6, marginBottom:6}}>👤 Șofer</div>
          {T.sofer_aloca_logistica && !T.sofer_employee_id ? (
            <div style={{padding:10, background:G.purple+'22', border:`1px solid ${G.purple}55`, borderRadius:8, fontSize:13, color:G.text}}>
              🏢 <strong>Logistică alocă șoferul</strong> — va fi selectat la aprobare
            </div>
          ) : T.sofer_gazpet ? (
            T.sofer_employee ? (
              <div style={{padding:10, background:G.bg, border:`1px solid ${G.border}`, borderRadius:8, fontSize:13}}>
                <div style={{color:G.text, fontWeight:600}}>{T.sofer_employee.name}</div>
                <div style={{fontSize:11, color:G.muted}}>{T.sofer_employee.position}</div>
              </div>
            ) : T.sofer ? (
              <div style={{padding:10, background:G.bg, border:`1px solid ${G.border}`, borderRadius:8, fontSize:13, color:G.text}}>{T.sofer.name} <span style={{fontSize:10, color:G.muted}}>(user sistem)</span></div>
            ) : (
              <div style={{padding:10, background:G.bg, border:`1px solid ${G.border}`, borderRadius:8, fontSize:13, color:G.muted}}>—</div>
            )
          ) : (
            <div style={{padding:10, background:G.bg, border:`1px solid ${G.border}`, borderRadius:8, fontSize:13}}>
              <div style={{color:G.text}}>{T.sofer_extern_nume}</div>
              {T.sofer_extern_telefon && <div style={{fontSize:11, color:G.muted}}>📞 {T.sofer_extern_telefon}</div>}
              <div style={{fontSize:10, color:G.orange, marginTop:2}}>Șofer extern</div>
            </div>
          )}
        </div>
        
        {/* Cost + Observații */}
        {(T.cost_estimat || T.observatii) && (
          <div style={{marginBottom:12, display:'grid', gridTemplateColumns: T.cost_estimat && T.observatii ? '1fr 2fr' : '1fr', gap:10}}>
            {T.cost_estimat && (
              <div style={{padding:10, background:G.bg, border:`1px solid ${G.border}`, borderRadius:8}}>
                <div style={{fontSize:10, color:G.muted, fontWeight:700, textTransform:'uppercase', marginBottom:4}}>💰 Cost estimat</div>
                <div style={{fontSize:14, color:G.text, fontWeight:700}}>{T.cost_estimat} RON</div>
              </div>
            )}
            {T.observatii && (
              <div style={{padding:10, background:G.bg, border:`1px solid ${G.border}`, borderRadius:8}}>
                <div style={{fontSize:10, color:G.muted, fontWeight:700, textTransform:'uppercase', marginBottom:4}}>📝 Observații</div>
                <div style={{fontSize:12, color:G.text}}>{T.observatii}</div>
              </div>
            )}
          </div>
        )}
        
        {/* Motiv respingere (dacă e cazul) */}
        {status === 'respins' && T.motiv_respingere && (
          <div style={{marginBottom:12, padding:10, background:G.redDim, border:`1px solid ${G.red}55`, borderRadius:8}}>
            <div style={{fontSize:11, color:G.red, fontWeight:700, marginBottom:4}}>✗ MOTIV RESPINGERE:</div>
            <div style={{fontSize:13, color:G.text}}>{T.motiv_respingere}</div>
          </div>
        )}
        
        {/* Confirmare primire (când e livrat) */}
        {status === 'livrat' && T.confirmat_primire_la && (
          <div style={{marginBottom:12, padding:10, background:G.greenDim, border:`1px solid ${G.green}55`, borderRadius:8}}>
            <div style={{fontSize:11, color:G.green, fontWeight:700, marginBottom:4}}>✅ PRIMIRE CONFIRMATĂ:</div>
            <div style={{fontSize:13, color:G.text}}>
              de <strong>{T.confirmat_de?.name || '—'}</strong> la {new Date(T.confirmat_primire_la).toLocaleString('ro-RO')}
            </div>
            {T.confirmare_observatii && (
              <div style={{marginTop:6, fontSize:12, color:G.muted, paddingTop:6, borderTop:`1px solid ${G.green}33`}}>
                📝 {T.confirmare_observatii}
              </div>
            )}
          </div>
        )}
        
        {/* Indicator aviz generat/trimis */}
        {T.aviz_generat && T.aviz_data && (
          <div style={{marginBottom:12, padding:10, background:G.purple+'11', border:`1px solid ${G.purple}55`, borderRadius:8}}>
            <div style={{fontSize:11, color:G.purple, fontWeight:700, marginBottom:4}}>📄 AVIZ GENERAT:</div>
            <div style={{fontSize:12, color:G.text}}>
              la {new Date(T.aviz_data).toLocaleString('ro-RO')}
              {T.aviz_emails_trimis && T.aviz_emails_trimis.length > 0 && (
                <span style={{marginLeft:8, color:G.muted}}>· trimis la: {T.aviz_emails_trimis.join(', ')}</span>
              )}
            </div>
          </div>
        )}
        
        {/* Form confirmare primire (pentru status='in_tranzit') */}
        {showConfirmPrimire && (
          <div style={{marginBottom:12, padding:12, background:G.green+'11', border:`2px solid ${G.green}`, borderRadius:8}}>
            <div style={{fontSize:13, fontWeight:700, color:G.green, marginBottom:8}}>✅ Confirmă primirea utilajului</div>
            <div style={{fontSize:11, color:G.muted, marginBottom:8}}>
              Confirmi că ai primit utilajul în stare bună la destinație. Această acțiune nu poate fi reversată.
            </div>
            <textarea 
              value={confirmareObs} 
              onChange={e => setConfirmareObs(e.target.value)} 
              rows={3} 
              placeholder="Observații (opțional): ex: 'Primit OK', sau 'Primit cu o zgârietură pe șasiu', sau 'Lipsește furtunul X'..." 
              style={{...S.input, resize:'vertical'}} 
            />
          </div>
        )}
        
        {/* === DATĂ TRANSPORT EDITABILĂ la aprobare (doar aprobatori la status='cerut') === */}
        {status === 'cerut' && isAprobator && (
          <div style={{marginBottom:12, padding:10, background:G.blue+'11', border:`1px dashed ${G.blue}`, borderRadius:8}}>
            <div style={{display:'flex', alignItems:'center', gap:10, flexWrap:'wrap'}}>
              <div style={{fontSize:11, color:G.blue, fontWeight:700, textTransform:'uppercase', letterSpacing:.5}}>
                📅 Data transportului (editabilă la aprobare)
              </div>
              <input 
                type="date" 
                value={dataTransportEdit} 
                onChange={e => setDataTransportEdit(e.target.value)} 
                style={{...S.input, width:'auto', fontSize:13, fontWeight:700}}
              />
              {dataTransportEdit && dataTransportEdit !== T.data_transport && (
                <span style={{fontSize:10, color:G.orange, fontWeight:700}}>
                  ⚠️ Schimbat (originală: {T.data_transport})
                </span>
              )}
            </div>
            <div style={{fontSize:10, color:G.muted, marginTop:4}}>
              Dacă data inițială nu e bună, schimb-o aici. Va fi salvată cu aprobarea.
            </div>
          </div>
        )}
        
        {/* === ALEGE ȘOFER înainte de aprobare (când Logistică alocă) === */}
        {showAlegeSofer && (
          <div style={{marginBottom:12, padding:12, background:G.purple+'11', border:`2px solid ${G.purple}`, borderRadius:8}}>
            <div style={{fontSize:13, fontWeight:700, color:G.purple, marginBottom:10}}>🏢 Alege șoferul pentru a aproba</div>
            <div style={{display:'grid', gridTemplateColumns:'1fr 2fr', gap:8, marginBottom:8}}>
              <select value={filterFunctie} onChange={e => { setFilterFunctie(e.target.value); setSoferEmployeeId(''); }} style={{...S.input, fontSize:12}}>
                {FUNCTII_TRANSPORT.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
              <input type="text" value={soferSearch} onChange={e => setSoferSearch(e.target.value)} placeholder={`🔍 Caută... (${soferiDisponibili.length})`} style={S.input} />
            </div>
            <div style={{maxHeight:160, overflowY:'auto', border:`1px solid ${G.border}`, borderRadius:6, background:G.bg}}>
              {soferiDisponibili.map(emp => (
                <label key={emp.id} style={{display:'flex', alignItems:'center', gap:8, padding:'6px 10px', cursor:'pointer', borderBottom:`1px solid ${G.border}`, background: String(soferEmployeeId) === String(emp.id) ? G.purple+'22' : 'transparent'}}>
                  <input type="radio" checked={String(soferEmployeeId) === String(emp.id)} onChange={() => setSoferEmployeeId(emp.id)} style={{accentColor:G.purple}} />
                  <div style={{flex:1}}>
                    <div style={{fontSize:12, color:G.text, fontWeight:600}}>{emp.name}</div>
                    <div style={{fontSize:10, color:G.muted}}>{emp.position}{emp.functii_extra?.length > 0 && <span style={{color:G.logistica}}> · extra: {emp.functii_extra.join(', ')}</span>}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}
        
        {/* === MODAL RESPINGERE === */}
        {showRespingere && (
          <div style={{marginBottom:12, padding:12, background:G.redDim, border:`2px solid ${G.red}`, borderRadius:8}}>
            <div style={{fontSize:13, fontWeight:700, color:G.red, marginBottom:8}}>✗ Motiv respingere (obligatoriu)</div>
            <textarea value={motivRespingere} onChange={e => setMotivRespingere(e.target.value)} rows={3} placeholder="Ex: Utilajul e defect, traseu nepotrivit, ARR expirat..." style={{...S.input, resize:'vertical'}} />
          </div>
        )}
        
        {/* === ACȚIUNI === */}
        <div style={{display:'flex', gap:8, justifyContent:'flex-end', flexWrap:'wrap', paddingTop:12, borderTop:`1px solid ${G.border}`}}>
          {/* Buton Edit (pentru cereri 'cerut') */}
          {status === 'cerut' && (isSolicitant || isAprobator) && !showRespingere && !showAlegeSofer && (
            <button onClick={() => { onClose(); onEdit?.(T) }} style={{...S.btnS, color:G.logistica, borderColor:G.logistica+'88'}}>✏️ Editează</button>
          )}
          
          {/* Anulează cerere (solicitant cu cerere 'cerut') */}
          {status === 'cerut' && isSolicitant && !showRespingere && !showAlegeSofer && (
            <button onClick={handleAnuleaza} disabled={actionLoading} style={{...S.btnS, color:G.muted}}>🗑️ Anulează cererea</button>
          )}
          
          {/* === STATUS = CERUT — APROBĂ / RESPINGE (doar aprobatori) === */}
          {status === 'cerut' && isAprobator && !showRespingere && (
            <>
              <button onClick={() => setShowRespingere(true)} disabled={actionLoading} style={{...S.btnS, color:G.red, borderColor:G.red+'88'}}>✗ Respinge</button>
              <button onClick={handleAproba} disabled={actionLoading} style={{...S.btnP, background:G.green}}>
                {showAlegeSofer ? '✓ Aprobă cu acest șofer' : (T.sofer_aloca_logistica && !T.sofer_employee_id ? '✓ Aprobă (alege șofer)' : '✓ Aprobă')}
              </button>
            </>
          )}
          
          {/* Confirm respingere */}
          {status === 'cerut' && isAprobator && showRespingere && (
            <>
              <button onClick={() => { setShowRespingere(false); setMotivRespingere('') }} style={S.btnS}>← Înapoi</button>
              <button onClick={handleRespinge} disabled={actionLoading} style={{...S.btnP, background:G.red}}>✗ Confirm respingere</button>
            </>
          )}
          
          {/* === STATUS = APROBAT — Începe transport / Anulat === */}
          {status === 'aprobat' && (
            <>
              {/* Început transport: aprobator SAU manager plecare */}
              {(isAprobator || isManagerPlecare) && (
                <button onClick={() => handleSchimbaStatus('in_tranzit')} disabled={actionLoading} style={{...S.btnP, background:G.yellow, color:'#000'}}>
                  🚚 Începe transport (în tranzit)
                </button>
              )}
              {!isAprobator && !isManagerPlecare && (
                <div style={{fontSize:12, color:G.orange, alignSelf:'center'}}>
                  Așteaptă confirmarea de la {T.manager_plecare?.name || 'manager plecare'} sau Logistică
                </div>
              )}
              {(isAprobator || isSolicitant) && <button onClick={handleAnuleaza} disabled={actionLoading} style={{...S.btnS, color:G.muted}}>⏸ Anulează</button>}
            </>
          )}
          
          {/* === STATUS = PROGRAMAT (backward compat — nu mai apare la cereri noi) === */}
          {status === 'programat' && (
            <>
              {(isAprobator || isManagerPlecare) && (
                <button onClick={() => handleSchimbaStatus('in_tranzit')} disabled={actionLoading} style={{...S.btnP, background:G.yellow, color:'#000'}}>🚚 Începe transport (în tranzit)</button>
              )}
              {(isAprobator || isSolicitant) && <button onClick={handleAnuleaza} disabled={actionLoading} style={{...S.btnS, color:G.muted}}>⏸ Anulează</button>}
            </>
          )}
          
          {/* === STATUS = IN TRANZIT — Confirmare primire / Marchează livrat === */}
          {status === 'in_tranzit' && !showConfirmPrimire && (
            <>
              {/* Manager destinație → confirmare oficială cu observații */}
              {(isManagerDestinatie || isAprobator) && (
                <button onClick={() => setShowConfirmPrimire(true)} disabled={actionLoading} style={{...S.btnP, background:G.green}}>
                  {isManagerDestinatie ? '✅ Confirm primirea (livrat)' : '✅ Confirmă primire (override)'}
                </button>
              )}
              {/* Marchează livrat fără confirmare oficială (fallback) */}
              {!isManagerDestinatie && !isAprobator && (
                <div style={{fontSize:12, color:G.orange, alignSelf:'center'}}>
                  Așteaptă confirmarea de la {T.manager_destinatie?.name || 'managerul destinație'}
                </div>
              )}
            </>
          )}
          
          {/* Confirmare primire în curs */}
          {status === 'in_tranzit' && showConfirmPrimire && (
            <>
              <button onClick={() => { setShowConfirmPrimire(false); setConfirmareObs('') }} style={S.btnS}>← Înapoi</button>
              <button onClick={handleConfirmPrimire} disabled={actionLoading} style={{...S.btnP, background:G.green}}>
                ✅ Confirm primire
              </button>
            </>
          )}
          
          {/* === BUTON AVIZ ÎNSOȚIRE MARFĂ === */}
          {/* Vizibil pentru status: aprobat, in_tranzit, livrat (nu pentru cerut/respins/anulat) */}
          {['aprobat', 'programat', 'in_tranzit', 'livrat'].includes(status) && !showRespingere && !showAlegeSofer && !showConfirmPrimire && (
            <button onClick={() => setShowAviz(true)} style={{...S.btnS, color:G.purple, borderColor:G.purple+'88', fontWeight:700}} title="Generează aviz însoțire marfă (printabil + email)">
              📄 Aviz {T.aviz_generat && <span style={{marginLeft:4, color:G.green}}>✓</span>}
            </button>
          )}
          
          {/* Fără acțiuni dacă livrat / anulat / respins */}
          {['livrat', 'anulat', 'respins'].includes(status) && !showConfirmPrimire && (
            <div style={{fontSize:12, color:G.muted, fontStyle:'italic', alignSelf:'center'}}>
              {status === 'livrat' ? 'Transport livrat' : status === 'respins' ? 'Cerere respinsă' : 'Cerere anulată'}
            </div>
          )}
        </div>
      </div>
      
      {/* Modal Aviz Însoțire Marfă (PAS 5F) */}
      {showAviz && (
        <AvizInsotireMarfaModal 
          transport={T} 
          profile={profile} 
          onClose={() => setShowAviz(false)} 
          showToast={showToast}
          onTrimisEmail={() => { onChanged?.() }}
        />
      )}
    </div>
  )
}

// ===========================================================================
// PAS 5F — AVIZ ÎNSOȚIRE MARFĂ (HTML printabil A4) + EMAIL MAILTO + SETĂRI
// ===========================================================================

// --- Modal Setări Destinatari Email (admin) ---
function SetariEmailDestinatariModal({ valoare, onClose, onSaved, showToast }) {
  const initial = (valoare || '').split(',').map(s => s.trim()).filter(Boolean)
  const [emails, setEmails] = useState(initial)
  const [newEmail, setNewEmail] = useState('')
  const [saving, setSaving] = useState(false)
  
  const isValidEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)
  
  const handleAdd = () => {
    const trimmed = newEmail.trim().toLowerCase()
    if (!trimmed) return
    if (!isValidEmail(trimmed)) { showToast('Email invalid', 'warn'); return }
    if (emails.includes(trimmed)) { showToast('Email deja în listă', 'warn'); return }
    setEmails([...emails, trimmed])
    setNewEmail('')
  }
  
  const handleRemove = (e) => setEmails(emails.filter(x => x !== e))
  
  const handleSave = async () => {
    if (emails.length === 0) { showToast('Adaugă cel puțin un destinatar', 'warn'); return }
    setSaving(true)
    const { error } = await supabase.from('logistica_setari').upsert({
      key: 'aviz_email_destinatari',
      value: emails.join(','),
      updated_at: new Date().toISOString()
    }, { onConflict: 'key' })
    setSaving(false)
    if (error) { showToast('Eroare salvare: ' + error.message, 'error'); return }
    showToast('✓ Destinatari email salvați')
    onSaved?.(emails.join(','))
    onClose()
  }
  
  return (
    <div style={{position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', zIndex:1100, display:'flex', alignItems:'center', justifyContent:'center', padding:20}}>
      <div style={{...S.card, width:'100%', maxWidth:540, padding:24}}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14, paddingBottom:12, borderBottom:`1px solid ${G.border}`}}>
          <div>
            <div style={{fontSize:17, fontWeight:700, color:G.text}}>⚙️ Destinatari email aviz</div>
            <div style={{fontSize:11, color:G.muted, marginTop:2}}>Vor primi în CC mailul când se trimite aviz</div>
          </div>
          <button onClick={onClose} style={{...S.btnS, padding:'4px 10px'}}>✕</button>
        </div>
        
        {/* Lista chips */}
        <div style={{marginBottom:14}}>
          <div style={{fontSize:11, color:G.muted, fontWeight:700, textTransform:'uppercase', marginBottom:6}}>Destinatari curenți ({emails.length})</div>
          <div style={{display:'flex', flexWrap:'wrap', gap:6, padding:10, background:G.bg, border:`1px solid ${G.border}`, borderRadius:8, minHeight:50}}>
            {emails.length === 0 && <div style={{fontSize:12, color:G.muted, fontStyle:'italic'}}>Niciun destinatar adăugat</div>}
            {emails.map(e => (
              <span key={e} style={{display:'inline-flex', alignItems:'center', gap:6, padding:'4px 6px 4px 10px', background:G.logistica + '22', border:`1px solid ${G.logistica}55`, borderRadius:16, fontSize:12, color:G.text}}>
                <span style={{maxWidth:200, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>📧 {e}</span>
                <button onClick={() => handleRemove(e)} style={{background:'none', border:'none', color:G.red, cursor:'pointer', fontSize:14, padding:0, lineHeight:1, display:'flex', alignItems:'center', justifyContent:'center', width:18, height:18, borderRadius:'50%'}} title="Șterge">×</button>
              </span>
            ))}
          </div>
        </div>
        
        {/* Add new */}
        <div style={{marginBottom:14}}>
          <div style={{fontSize:11, color:G.muted, fontWeight:700, textTransform:'uppercase', marginBottom:6}}>Adaugă email nou</div>
          <div style={{display:'flex', gap:8}}>
            <input 
              type="email" 
              value={newEmail} 
              onChange={e => setNewEmail(e.target.value)} 
              onKeyDown={e => { if (e.key === 'Enter') handleAdd() }}
              placeholder="ex: nume.prenume@gazpet.ro" 
              style={{...S.input, flex:1}} 
            />
            <button onClick={handleAdd} style={{...S.btnP, background:G.green, padding:'8px 14px'}}>+ Adaugă</button>
          </div>
        </div>
        
        {/* Actions */}
        <div style={{display:'flex', gap:8, justifyContent:'flex-end', paddingTop:12, borderTop:`1px solid ${G.border}`}}>
          <button onClick={onClose} style={S.btnS}>Anulează</button>
          <button onClick={handleSave} disabled={saving} style={{...S.btnP, background:G.green}}>
            {saving ? 'Se salvează...' : '💾 Salvează'}
          </button>
        </div>
      </div>
    </div>
  )
}

// --- Modal Canvas pentru Semnătură Electronică ---
function SemnaturaCanvasModal({ rol, numeImplicit, onClose, onSave, showToast }) {
  const [drawing, setDrawing] = useState(false)
  const [hasDrawn, setHasDrawn] = useState(false)
  const [nume, setNume] = useState(numeImplicit || '')
  const canvasRef = useRef(null)
  const lastPoint = useRef({ x: 0, y: 0 })
  
  // Setup canvas la mount
  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(0, 0, c.width, c.height)
    ctx.strokeStyle = '#0F172A'
    ctx.lineWidth = 2.2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
  }, [])
  
  // Coords helper (mouse + touch)
  const getCoords = (e) => {
    const c = canvasRef.current
    const rect = c.getBoundingClientRect()
    const scaleX = c.width / rect.width
    const scaleY = c.height / rect.height
    if (e.touches?.[0]) {
      return { x: (e.touches[0].clientX - rect.left) * scaleX, y: (e.touches[0].clientY - rect.top) * scaleY }
    }
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY }
  }
  
  const startDraw = (e) => {
    e.preventDefault()
    setDrawing(true)
    const p = getCoords(e)
    lastPoint.current = p
  }
  
  const draw = (e) => {
    if (!drawing) return
    e.preventDefault()
    const ctx = canvasRef.current.getContext('2d')
    const p = getCoords(e)
    ctx.beginPath()
    ctx.moveTo(lastPoint.current.x, lastPoint.current.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    lastPoint.current = p
    setHasDrawn(true)
  }
  
  const endDraw = (e) => {
    e?.preventDefault()
    setDrawing(false)
  }
  
  const clearCanvas = () => {
    const c = canvasRef.current
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(0, 0, c.width, c.height)
    setHasDrawn(false)
  }
  
  const handleSave = () => {
    if (!hasDrawn) { showToast('Desenează semnătura înainte de salvare', 'warn'); return }
    if (!nume.trim()) { showToast('Completează numele celui care semnează', 'warn'); return }
    const dataUrl = canvasRef.current.toDataURL('image/png')
    onSave({ data: dataUrl, nume: nume.trim() })
  }
  
  const rolLabel = { expeditor: '📤 EXPEDITOR / Manager plecare', sofer: '🚚 ȘOFER', destinatar: '📥 DESTINATAR / Manager destinație' }[rol] || rol
  
  return (
    <div style={{position:'fixed', inset:0, background:'rgba(0,0,0,0.85)', zIndex:1200, display:'flex', alignItems:'center', justifyContent:'center', padding:20}}>
      <div style={{...S.card, width:'100%', maxWidth:620, padding:22}}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16, paddingBottom:12, borderBottom:`1px solid ${G.border}`}}>
          <div>
            <div style={{fontSize:16, fontWeight:700, color:G.text}}>🖋️ Semnătură electronică</div>
            <div style={{fontSize:12, color:G.muted, marginTop:3}}>{rolLabel}</div>
          </div>
          <button onClick={onClose} style={{...S.btnS, padding:'4px 10px'}}>✕</button>
        </div>
        
        {/* Nume semnatar */}
        <div style={{marginBottom:14}}>
          <div style={{fontSize:11, color:G.muted, fontWeight:700, textTransform:'uppercase', marginBottom:6, letterSpacing:.5}}>Nume celui care semnează</div>
          <input 
            type="text" 
            value={nume} 
            onChange={e => setNume(e.target.value)} 
            placeholder="Nume Prenume"
            style={S.input}
          />
        </div>
        
        {/* Canvas */}
        <div style={{marginBottom:14}}>
          <div style={{fontSize:11, color:G.muted, fontWeight:700, textTransform:'uppercase', marginBottom:6, letterSpacing:.5}}>Desenează semnătura mai jos (mouse pe desktop / deget pe mobil)</div>
          <div style={{position:'relative', border:`2px solid ${G.border}`, borderRadius:8, background:'#fff', overflow:'hidden'}}>
            <canvas 
              ref={canvasRef}
              width={560}
              height={200}
              style={{display:'block', width:'100%', height:200, touchAction:'none', cursor:'crosshair'}}
              onMouseDown={startDraw}
              onMouseMove={draw}
              onMouseUp={endDraw}
              onMouseLeave={endDraw}
              onTouchStart={startDraw}
              onTouchMove={draw}
              onTouchEnd={endDraw}
            />
            {!hasDrawn && (
              <div style={{position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', pointerEvents:'none', color:'#9CA3AF', fontSize:14, fontStyle:'italic'}}>
                ✍️ Semnează aici...
              </div>
            )}
          </div>
        </div>
        
        {/* Actions */}
        <div style={{display:'flex', justifyContent:'space-between', gap:8, paddingTop:12, borderTop:`1px solid ${G.border}`}}>
          <button onClick={clearCanvas} style={{...S.btnS, color:G.orange, borderColor:G.orange+'88'}}>
            🗑️ Șterge
          </button>
          <div style={{display:'flex', gap:8}}>
            <button onClick={onClose} style={S.btnS}>Anulează</button>
            <button onClick={handleSave} disabled={!hasDrawn} style={{...S.btnP, background:G.green}}>
              ✓ Salvează semnătura
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// --- Modal AVIZ ÎNSOȚIRE MARFĂ (HTML printabil A4) ---
function AvizInsotireMarfaModal({ transport: T, profile, onClose, showToast, onTrimisEmail }) {
  const [setariFirma, setSetariFirma] = useState({})
  const [destinatari, setDestinatari] = useState([])
  const [showSetariEmail, setShowSetariEmail] = useState(false)
  const [trimisLoading, setTrimisLoading] = useState(false)
  
  // Pas 4: Semnături electronice
  const [showSemnatura, setShowSemnatura] = useState(null)  // 'expeditor' | 'sofer' | 'destinatar' | null
  const [semnExpData, setSemnExpData] = useState(T.semnatura_expeditor_data || null)
  const [semnExpNume, setSemnExpNume] = useState(T.semnatura_expeditor_nume || '')
  const [semnExpLa, setSemnExpLa] = useState(T.semnatura_expeditor_la || null)
  const [semnSofData, setSemnSofData] = useState(T.semnatura_sofer_data || null)
  const [semnSofNume, setSemnSofNume] = useState(T.semnatura_sofer_nume || '')
  const [semnSofLa, setSemnSofLa] = useState(T.semnatura_sofer_la || null)
  const [semnDestData, setSemnDestData] = useState(T.semnatura_destinatar_data || null)
  const [semnDestNume, setSemnDestNume] = useState(T.semnatura_destinatar_nume || '')
  const [semnDestLa, setSemnDestLa] = useState(T.semnatura_destinatar_la || null)
  
  const isAdmin = ['superadmin', 'admin_logistica'].includes(profile?.role)
  
  // Save semnătură în DB
  const saveSemnatura = async (rol, { data, nume }) => {
    const updates = {}
    const now = new Date().toISOString()
    if (rol === 'expeditor') {
      updates.semnatura_expeditor_data = data
      updates.semnatura_expeditor_nume = nume
      updates.semnatura_expeditor_la = now
      updates.semnatura_expeditor_de = profile?.id
    } else if (rol === 'sofer') {
      updates.semnatura_sofer_data = data
      updates.semnatura_sofer_nume = nume
      updates.semnatura_sofer_la = now
    } else if (rol === 'destinatar') {
      updates.semnatura_destinatar_data = data
      updates.semnatura_destinatar_nume = nume
      updates.semnatura_destinatar_la = now
      updates.semnatura_destinatar_de = profile?.id
    }
    const { error } = await supabase.from('logistica_transporturi').update(updates).eq('id', T.id)
    if (error) { showToast('Eroare salvare semnătură: ' + error.message, 'error'); return }
    showToast(`✓ Semnătură ${rol} salvată`)
    
    // Update state local
    if (rol === 'expeditor') { setSemnExpData(data); setSemnExpNume(nume); setSemnExpLa(now) }
    else if (rol === 'sofer') { setSemnSofData(data); setSemnSofNume(nume); setSemnSofLa(now) }
    else if (rol === 'destinatar') { setSemnDestData(data); setSemnDestNume(nume); setSemnDestLa(now) }
    setShowSemnatura(null)
    
    // Propagă refresh la parent (DetaliiTransportModal → reîncarcă transport cu semnături noi)
    onTrimisEmail?.()
    
    // === AUTO-ARHIVARE când avem toate 3 semnături ===
    // Verificăm noile valori după update (rol-ul curent + cele 2 anterioare)
    const nowExp = rol === 'expeditor' ? true : !!semnExpData
    const nowSof = rol === 'sofer' ? true : !!semnSofData
    const nowDest = rol === 'destinatar' ? true : !!semnDestData
    
    if (nowExp && nowSof && nowDest) {
      // Verifică direct în arhivă (NU pe aviz_generat care e stricat de mailto)
      const { count } = await supabase
        .from('logistica_avize_arhiva')
        .select('id', { count: 'exact', head: true })
        .eq('transport_id', T.id)
      
      if ((count || 0) === 0) {
        // Toate 3 semnături prezente + NU e arhivat → trigger automat
        showToast('🎉 Toate 3 semnături complete! Se arhivează automat...', 'info')
        // Delay scurt ca canvas să se actualizeze cu semnătura nouă înainte de captură
        setTimeout(() => {
          handleArhivare(true)  // true = auto (skip download local pentru a nu deranja destinatar)
        }, 800)
      } else {
        showToast('✓ Aviz deja arhivat — nu re-arhivează', 'info')
      }
    }
  }
  
  // Load setări firmă + destinatari
  useEffect(() => {
    supabase.from('logistica_setari').select('key, value').or(
      `key.eq.firma_nume,key.eq.firma_cui,key.eq.firma_reg_com,key.eq.firma_adresa,key.eq.firma_telefon,key.eq.firma_email,key.eq.aviz_email_destinatari`
    ).then(({ data }) => {
      const map = Object.fromEntries((data || []).map(s => [s.key, s.value]))
      setSetariFirma(map)
      setDestinatari((map.aviz_email_destinatari || '').split(',').map(s => s.trim()).filter(Boolean))
    })
    
    // FRESH fetch semnături din DB (în caz că modalul a fost redeschis după modificări)
    supabase.from('logistica_transporturi')
      .select('semnatura_expeditor_data, semnatura_expeditor_nume, semnatura_expeditor_la, semnatura_sofer_data, semnatura_sofer_nume, semnatura_sofer_la, semnatura_destinatar_data, semnatura_destinatar_nume, semnatura_destinatar_la, aviz_generat, aviz_data')
      .eq('id', T.id)
      .single()
      .then(async ({ data }) => {
        if (!data) return
        setSemnExpData(data.semnatura_expeditor_data || null)
        setSemnExpNume(data.semnatura_expeditor_nume || '')
        setSemnExpLa(data.semnatura_expeditor_la || null)
        setSemnSofData(data.semnatura_sofer_data || null)
        setSemnSofNume(data.semnatura_sofer_nume || '')
        setSemnSofLa(data.semnatura_sofer_la || null)
        setSemnDestData(data.semnatura_destinatar_data || null)
        setSemnDestNume(data.semnatura_destinatar_nume || '')
        setSemnDestLa(data.semnatura_destinatar_la || null)
        
        // RECOVERY: dacă avem 3/3 semnături dar NU există în arhivă → trigger arhivare
        if (data.semnatura_expeditor_data && data.semnatura_sofer_data && data.semnatura_destinatar_data) {
          const { count } = await supabase
            .from('logistica_avize_arhiva')
            .select('id', { count: 'exact', head: true })
            .eq('transport_id', T.id)
          if ((count || 0) === 0) {
            showToast('🔄 Aviz cu 3/3 semnături găsit fără arhivă — se arhivează acum...', 'info')
            setTimeout(() => handleArhivare(true), 1200)  // delay mai mare pt randare canvas
          }
        }
      })
  }, [T.id])
  
  // Print A4
  const handlePrint = () => {
    window.print()
  }
  
  // Arhivare PDF (PAS 5)
  const [arhivareLoading, setArhivareLoading] = useState(false)
  const [avizContentRef] = useState({ current: null })
  
  const handleArhivare = async (auto = false) => {
    setArhivareLoading(true)
    try {
      // 0. FRESH FETCH din DB pentru a fi sigur că avem cele mai recente semnături
      // (state-urile pot fi stale din cauza React batch-ing dacă vine din auto-recovery)
      const { data: fresh } = await supabase
        .from('logistica_transporturi')
        .select('semnatura_expeditor_data, semnatura_sofer_data, semnatura_destinatar_data, aviz_generat')
        .eq('id', T.id)
        .single()
      const finalSemnExp = !!fresh?.semnatura_expeditor_data
      const finalSemnSof = !!fresh?.semnatura_sofer_data
      const finalSemnDest = !!fresh?.semnatura_destinatar_data
      
      // 1. Selectează zona aviz
      const aviz = document.querySelector('.aviz-content')
      if (!aviz) { showToast('Nu pot localiza conținutul avizului', 'error'); setArhivareLoading(false); return }
      
      // 2. Render to canvas — scale 1.5 e suficient pentru claritate la print A4
      const canvas = await html2canvas(aviz, { 
        scale: 1.5, 
        backgroundColor: '#FFFFFF', 
        useCORS: true, 
        logging: false,
        imageTimeout: 5000
      })
      
      // 3. Convert to PDF (A4) — JPEG quality 0.85 + FAST compression (10x mai mic decât PNG)
      const pdf = new jsPDF({ 
        orientation: 'portrait', 
        unit: 'mm', 
        format: 'a4',
        compress: true
      })
      const pageW = 210, pageH = 297
      const imgW = pageW
      const imgH = (canvas.height * imgW) / canvas.width
      const imgData = canvas.toDataURL('image/jpeg', 0.85)  // JPEG 85% quality
      
      if (imgH <= pageH) {
        pdf.addImage(imgData, 'JPEG', 0, 0, imgW, imgH, undefined, 'FAST')
      } else {
        // Multi-page (rare pentru aviz)
        let position = 0
        let heightLeft = imgH
        pdf.addImage(imgData, 'JPEG', 0, position, imgW, imgH, undefined, 'FAST')
        heightLeft -= pageH
        while (heightLeft > 0) {
          position = -(imgH - heightLeft)
          pdf.addPage()
          pdf.addImage(imgData, 'JPEG', 0, position, imgW, imgH, undefined, 'FAST')
          heightLeft -= pageH
        }
      }
      
      // 4. Convert PDF to Blob
      const pdfBlob = pdf.output('blob')
      const pdfSize = pdfBlob.size
      
      // 5. Upload în Supabase Storage
      const numarAviz = `AVZ-${T.numar_transport.replace('TRP-', '')}`
      const fileName = `${T.data_transport?.substring(0,7) || '2026-01'}/${numarAviz}_${Date.now()}.pdf`
      const { error: upErr } = await supabase.storage.from('avize').upload(fileName, pdfBlob, { contentType: 'application/pdf', upsert: false })
      if (upErr) throw upErr
      
      // 6. Insert în arhivă
      const { error: insErr } = await supabase.from('logistica_avize_arhiva').insert({
        transport_id: T.id,
        numar_aviz: numarAviz,
        numar_transport: T.numar_transport,
        pdf_path: fileName,
        pdf_size_bytes: pdfSize,
        generat_de: profile?.id,
        generat_de_nume: profile?.name,
        data_transport: T.data_transport,
        tip: T.tip,
        plecare_text: formatLocatie(T.plecare_tip, T.plecare_site, T.plecare_locatie_text),
        destinatie_text: formatLocatie(T.destinatie_tip, T.destinatie_site, T.destinatie_locatie_text),
        manager_plecare_nume: T.manager_plecare?.name,
        manager_destinatie_nume: T.manager_destinatie?.name,
        sofer_nume: T.sofer_employee?.name || T.sofer_extern_nume,
        semnat_expeditor: finalSemnExp,
        semnat_sofer: finalSemnSof,
        semnat_destinatar: finalSemnDest
      })
      if (insErr) throw insErr
      
      // 7. Update aviz_generat în transport (locked după arhivare)
      await supabase.from('logistica_transporturi').update({ aviz_generat: true, aviz_data: new Date().toISOString() }).eq('id', T.id)
      
      // 8. Download local DOAR dacă NU e auto (pentru flow manual la sediu)
      if (!auto) {
        const blobUrl = URL.createObjectURL(pdfBlob)
        const a = document.createElement('a')
        a.href = blobUrl
        a.download = `${numarAviz}.pdf`
        a.click()
        URL.revokeObjectURL(blobUrl)
        showToast(`📂 Aviz arhivat (${(pdfSize/1024).toFixed(0)} KB) + descărcat`)
      } else {
        showToast(`✅ Aviz arhivat AUTOMAT după 3 semnături (${(pdfSize/1024).toFixed(0)} KB)`)
      }
      
      onTrimisEmail?.()
    } catch (e) {
      showToast('Eroare arhivare: ' + (e.message || e), 'error')
      console.error(e)
    } finally {
      setArhivareLoading(false)
    }
  }
  
  // Trimite email cu mailto (deschide client email cu destinatarii pre-completați)
  const handleSendEmail = async () => {
    if (destinatari.length === 0) {
      showToast('Niciun destinatar configurat. Apasă ⚙️ Setări destinatari.', 'warn')
      return
    }
    setTrimisLoading(true)
    
    // Subject + body SCURT (mailto are limită ~2000 caractere)
    const subject = `Aviz însoțire marfă - ${T.numar_transport}`
    const body = [
      `Bună ziua,`,
      ``,
      `Vă transmitem avizul de însoțire marfă ${T.numar_transport}:`,
      `• Activ: ${T.tip === 'utilaj' && T.activ_transportat ? `${T.activ_transportat.cod_intern || ''} ${T.activ_transportat.marca || ''} ${T.activ_transportat.model || ''}`.trim() : (T.continut_descriere || '—')}`,
      `• Plecare → Destinație: ${formatLocatie(T.plecare_tip, T.plecare_site, T.plecare_locatie_text)} → ${formatLocatie(T.destinatie_tip, T.destinatie_site, T.destinatie_locatie_text)}`,
      `• Data: ${T.data_transport}${T.ora_plecare ? ' · ' + T.ora_plecare.substring(0,5) : ''}`,
      `• Șofer: ${T.sofer_employee?.name || T.sofer_extern_nume || '—'}`,
      ``,
      `Cu stimă,`,
      profile?.name || 'Echipa Gazpet'
    ].join('\n')
    
    const mailtoUrl = `mailto:${destinatari.join(',')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    
    // Verificare lungime URL — limită ~2000 caractere pe Chrome/Edge
    if (mailtoUrl.length > 1900) {
      showToast('⚠️ Conținut prea lung pentru mailto. Copiază manual datele.', 'warn')
    }
    
    // Update DB: marchează aviz email trimis (NU aviz_generat — acela e doar pentru arhivă)
    const { error } = await supabase.from('logistica_transporturi').update({
      aviz_emails_trimis: destinatari
    }).eq('id', T.id)
    
    setTrimisLoading(false)
    if (error) { showToast('Eroare actualizare DB: ' + error.message, 'error'); return }
    
    // Deschidem mailto cu mai multe metode (window.open are mai multe șanse decât location.href)
    let opened = false
    try {
      const newWindow = window.open(mailtoUrl, '_self')
      if (newWindow) opened = true
    } catch (e) { /* ignored */ }
    
    if (!opened) {
      // Fallback: location.href
      try { window.location.href = mailtoUrl; opened = true } catch (e) { /* ignored */ }
    }
    
    // Copiez în clipboard subject + body + emails ca fallback
    try {
      const fullText = `Către: ${destinatari.join(', ')}\nSubject: ${subject}\n\n${body}`
      await navigator.clipboard.writeText(fullText)
      showToast(`📧 Mail deschis + ${fullText.length} caractere copiate în clipboard (paste în orice client mail)`, 'info')
    } catch (e) {
      showToast(`📧 Mail deschis în client (${destinatari.length} destinatari)`, 'info')
    }
    
    onTrimisEmail?.()
  }
  
  // Date afișate
  const dataTransport = T.data_transport ? new Date(T.data_transport).toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'
  const oraPlecare = T.ora_plecare ? T.ora_plecare.substring(0,5) : '—'
  const numarAviz = `AVZ-${T.numar_transport.replace('TRP-', '')}`
  
  return (
    <>
      <div className="aviz-modal-overlay" style={{position:'fixed', inset:0, background:'rgba(0,0,0,0.85)', zIndex:1050, display:'flex', alignItems:'center', justifyContent:'center', padding:20, overflowY:'auto'}}>
        <div style={{width:'100%', maxWidth:850, background:'#fff', borderRadius:8, position:'relative'}}>
          
          {/* Toolbar (HIDE pe print) */}
          <div className="aviz-toolbar no-print" style={{position:'sticky', top:0, padding:'12px 20px', background:'#1F2937', color:'#fff', borderRadius:'8px 8px 0 0', display:'flex', justifyContent:'space-between', alignItems:'center', gap:10, zIndex:10, flexWrap:'wrap'}}>
            <div style={{fontSize:14, fontWeight:700}}>
              📄 Aviz Însoțire Marfă · {numarAviz}
            </div>
            <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
              {isAdmin && (
                <button onClick={() => setShowSetariEmail(true)} style={{padding:'7px 12px', background:'#374151', color:'#fff', border:'1px solid #4B5563', borderRadius:6, fontSize:12, cursor:'pointer', fontWeight:600}}>
                  ⚙️ Setări destinatari
                </button>
              )}
              <button onClick={handleSendEmail} disabled={trimisLoading} style={{padding:'7px 14px', background:'#2563EB', color:'#fff', border:'none', borderRadius:6, fontSize:13, cursor:'pointer', fontWeight:700}}>
                {trimisLoading ? '...' : `📧 Trimite (${destinatari.length})`}
              </button>
              <button onClick={handlePrint} style={{padding:'7px 14px', background:'#16A34A', color:'#fff', border:'none', borderRadius:6, fontSize:13, cursor:'pointer', fontWeight:700}}>
                🖨️ Print
              </button>
              {/* Progress semnături — arhivarea se face AUTOMAT la a 3-a semnătură */}
              {(() => {
                const nrSemn = (semnExpData ? 1 : 0) + (semnSofData ? 1 : 0) + (semnDestData ? 1 : 0)
                const colorBg = nrSemn === 3 ? '#16A34A' : nrSemn === 2 ? '#F59E0B' : nrSemn === 1 ? '#EAB308' : '#6B7280'
                const isArhivat = T.aviz_generat && nrSemn === 3
                return (
                  <div style={{
                    padding:'7px 12px', 
                    background: isArhivat ? '#16A34A' : colorBg+'33',
                    color: isArhivat ? '#fff' : colorBg,
                    border: isArhivat ? `1px solid #16A34A` : `1px solid ${colorBg}88`,
                    borderRadius:6, fontSize:12, fontWeight:700,
                    display:'flex', alignItems:'center', gap:6
                  }}>
                    {arhivareLoading ? (
                      <>⏳ Se arhivează...</>
                    ) : isArhivat ? (
                      <>📂 Arhivat</>
                    ) : (
                      <>✍️ Semnături: <strong>{nrSemn}/3</strong></>
                    )}
                  </div>
                )
              })()}
              <button onClick={onClose} style={{padding:'7px 12px', background:'#DC2626', color:'#fff', border:'none', borderRadius:6, fontSize:13, cursor:'pointer', fontWeight:700}}>
                ✕ Închide
              </button>
            </div>
          </div>
          
          {/* === CONȚINUT AVIZ A4 === */}
          <div className="aviz-content" style={{padding:'30px 40px', color:'#111', fontFamily:'"Times New Roman", serif', fontSize:12, lineHeight:1.4}}>
            
            {/* Antet cu logo */}
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', borderBottom:'3px solid #1E40AF', paddingBottom:15, marginBottom:20}}>
              <div style={{display:'flex', alignItems:'center', gap:14}}>
                <img src={LOGO_B64} alt="Gazpet Instal" style={{height:65, width:'auto', objectFit:'contain'}} />
                <div>
                  <div style={{fontSize:18, fontWeight:'bold', color:'#1E40AF', letterSpacing:.5}}>{setariFirma.firma_nume || 'GAZPET INSTAL SRL'}</div>
                  <div style={{fontSize:10, color:'#374151', marginTop:3}}>CUI: {setariFirma.firma_cui || '—'} · {setariFirma.firma_reg_com || '—'}</div>
                  <div style={{fontSize:10, color:'#374151'}}>{setariFirma.firma_adresa || '—'}</div>
                  <div style={{fontSize:10, color:'#374151'}}>Tel: {setariFirma.firma_telefon || '—'} · Email: {setariFirma.firma_email || '—'}</div>
                </div>
              </div>
              <div style={{textAlign:'right'}}>
                <div style={{fontSize:22, fontWeight:'bold', color:'#1E40AF', letterSpacing:1}}>AVIZ</div>
                <div style={{fontSize:14, fontWeight:'bold', color:'#374151'}}>ÎNSOȚIRE MARFĂ</div>
                <div style={{fontSize:11, color:'#6B7280', marginTop:6, fontWeight:'bold'}}>Nr. {numarAviz}</div>
                <div style={{fontSize:10, color:'#6B7280'}}>din {new Date().toLocaleDateString('ro-RO')}</div>
              </div>
            </div>
            
            {/* Banner status semnături — vizibil pe ecran, ascuns la print */}
            {(() => {
              const nrSemn = (semnExpData ? 1 : 0) + (semnSofData ? 1 : 0) + (semnDestData ? 1 : 0)
              if (nrSemn === 3) return null  // toate complete, nu mai e nevoie de banner
              const lipsaList = []
              if (!semnExpData) lipsaList.push('Expeditor')
              if (!semnSofData) lipsaList.push('Șofer')
              if (!semnDestData) lipsaList.push('Destinatar')
              const colorBg = nrSemn === 2 ? '#FEF3C7' : nrSemn === 1 ? '#FEF9C3' : '#FEE2E2'
              const colorText = nrSemn === 2 ? '#D97706' : nrSemn === 1 ? '#CA8A04' : '#DC2626'
              return (
                <div className="no-print" style={{
                  marginBottom: 18, 
                  padding: '10px 14px', 
                  background: colorBg, 
                  border: `1px dashed ${colorText}88`,
                  borderRadius: 8,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10
                }}>
                  <span style={{fontSize: 20}}>{nrSemn === 2 ? '⏳' : '✍️'}</span>
                  <div style={{flex: 1}}>
                    <div style={{fontSize: 12, fontWeight: 700, color: colorText}}>
                      Aviz în așteptare — <strong>{nrSemn}/3 semnături</strong>
                      {nrSemn === 2 && ' · gata pentru print + traseu'}
                    </div>
                    <div style={{fontSize: 11, color: colorText+'CC', marginTop: 2}}>
                      Lipsește: <strong>{lipsaList.join(', ')}</strong>
                      {nrSemn === 2 && ` · arhivare automată după a 3-a semnătură`}
                    </div>
                  </div>
                </div>
              )
            })()}
            
            {/* Date transport */}
            <div style={{marginBottom:18}}>
              <div style={{fontSize:11, fontWeight:'bold', color:'#1E40AF', textTransform:'uppercase', borderBottom:'1px solid #93C5FD', paddingBottom:3, marginBottom:8, letterSpacing:.5}}>📋 Date transport</div>
              <table style={{width:'100%', borderCollapse:'collapse', fontSize:11}}>
                <tbody>
                  <tr>
                    <td style={{padding:'4px 8px', fontWeight:'bold', width:'25%', color:'#374151', verticalAlign:'top'}}>Nr. Transport:</td>
                    <td style={{padding:'4px 8px', fontFamily:'monospace', fontSize:13, fontWeight:'bold', color:'#1E40AF'}}>{T.numar_transport}</td>
                    <td style={{padding:'4px 8px', fontWeight:'bold', width:'20%', color:'#374151', verticalAlign:'top'}}>Data:</td>
                    <td style={{padding:'4px 8px', fontWeight:'bold'}}>{dataTransport} {oraPlecare !== '—' && `· ${oraPlecare}`}</td>
                  </tr>
                  <tr>
                    <td style={{padding:'4px 8px', fontWeight:'bold', color:'#374151', verticalAlign:'top'}}>Tip transport:</td>
                    <td style={{padding:'4px 8px'}}>{T.tip === 'utilaj' ? '🚛 Transport utilaj' : T.tip === 'materiale' ? '📦 Transport materiale' : '📄 Transport mic / TESA'}</td>
                    <td style={{padding:'4px 8px', fontWeight:'bold', color:'#374151', verticalAlign:'top'}}>Status:</td>
                    <td style={{padding:'4px 8px'}}>
                      {(() => {
                        const statusInfo = {
                          aprobat: { text: '✓ Aprobat - În pregătire', color: '#16A34A', bg: '#DCFCE7' },
                          programat: { text: '📅 Programat - În pregătire', color: '#2563EB', bg: '#DBEAFE' },
                          in_tranzit: { text: '🚚 În curs de livrare', color: '#D97706', bg: '#FEF3C7' },
                          livrat: { text: '✅ Livrat', color: '#16A34A', bg: '#DCFCE7' },
                          cerut: { text: '⏳ Cerut', color: '#D97706', bg: '#FEF3C7' },
                          respins: { text: '✗ Respins', color: '#DC2626', bg: '#FEE2E2' },
                          anulat: { text: '⊘ Anulat', color: '#6B7280', bg: '#F3F4F6' },
                        }[T.status] || { text: T.status, color: '#6B7280', bg: '#F3F4F6' }
                        return (
                          <span style={{display:'inline-block', padding:'3px 10px', background:statusInfo.bg, color:statusInfo.color, borderRadius:4, fontWeight:'bold', fontSize:11, border:`1px solid ${statusInfo.color}33`}}>
                            {statusInfo.text}
                          </span>
                        )
                      })()}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            
            {/* Date emitent / destinatar */}
            <div style={{display:'flex', gap:14, marginBottom:18}}>
              <div style={{flex:1, padding:10, border:'2px solid #93C5FD', borderRadius:6, background:'#EFF6FF'}}>
                <div style={{fontSize:10, fontWeight:'bold', color:'#1E40AF', textTransform:'uppercase', marginBottom:6, letterSpacing:.5}}>📤 EXPEDITOR</div>
                <div style={{fontSize:12, fontWeight:'bold', color:'#111'}}>{setariFirma.firma_nume || 'GAZPET INSTAL SRL'}</div>
                <div style={{fontSize:10, color:'#374151', marginTop:3}}>CUI: {setariFirma.firma_cui || '—'}</div>
                <div style={{fontSize:10, color:'#374151'}}>De la: {formatLocatie(T.plecare_tip, T.plecare_site, T.plecare_locatie_text)}</div>
                {T.manager_plecare && <div style={{fontSize:10, color:'#374151', marginTop:3}}>Manager plecare: <strong>{T.manager_plecare.name}</strong></div>}
              </div>
              <div style={{flex:1, padding:10, border:'2px solid #FCA5A5', borderRadius:6, background:'#FEF2F2'}}>
                <div style={{fontSize:10, fontWeight:'bold', color:'#DC2626', textTransform:'uppercase', marginBottom:6, letterSpacing:.5}}>📥 DESTINATAR</div>
                <div style={{fontSize:12, fontWeight:'bold', color:'#111'}}>{T.destinatie_tip === 'site' && T.destinatie_site ? T.destinatie_site.name : (T.destinatie_tip === 'sediu' ? (setariFirma.firma_nume || 'GAZPET INSTAL SRL') : 'Destinație externă')}</div>
                <div style={{fontSize:10, color:'#374151', marginTop:3}}>La: {formatLocatie(T.destinatie_tip, T.destinatie_site, T.destinatie_locatie_text)}</div>
                {T.manager_destinatie && <div style={{fontSize:10, color:'#374151', marginTop:3}}>Manager destinație: <strong>{T.manager_destinatie.name}</strong></div>}
              </div>
            </div>
            
            {/* Detalii activ transportat */}
            <div style={{marginBottom:18}}>
              <div style={{fontSize:11, fontWeight:'bold', color:'#1E40AF', textTransform:'uppercase', borderBottom:'1px solid #93C5FD', paddingBottom:3, marginBottom:8, letterSpacing:.5}}>📦 Conținut transport</div>
              <table style={{width:'100%', borderCollapse:'collapse', fontSize:11, border:'1px solid #D1D5DB'}}>
                <thead>
                  <tr style={{background:'#F3F4F6'}}>
                    <th style={{padding:'6px 8px', textAlign:'left', fontWeight:'bold', borderBottom:'2px solid #6B7280', width:30}}>Nr.</th>
                    <th style={{padding:'6px 8px', textAlign:'left', fontWeight:'bold', borderBottom:'2px solid #6B7280'}}>Denumire</th>
                    <th style={{padding:'6px 8px', textAlign:'left', fontWeight:'bold', borderBottom:'2px solid #6B7280'}}>Cod / Serii</th>
                    <th style={{padding:'6px 8px', textAlign:'center', fontWeight:'bold', borderBottom:'2px solid #6B7280', width:60}}>UM</th>
                    <th style={{padding:'6px 8px', textAlign:'center', fontWeight:'bold', borderBottom:'2px solid #6B7280', width:60}}>Cant.</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{padding:'8px 8px', verticalAlign:'top', borderBottom:'1px solid #D1D5DB'}}>1</td>
                    <td style={{padding:'8px 8px', verticalAlign:'top', borderBottom:'1px solid #D1D5DB'}}>
                      {T.tip === 'utilaj' && T.activ_transportat ? (
                        <>
                          <div style={{fontWeight:'bold'}}>{T.activ_transportat.marca} {T.activ_transportat.model}</div>
                          {T.activ_transportat.regim_transport_special && <div style={{fontSize:9, color:'#DC2626', fontWeight:'bold', marginTop:2}}>⚠️ REGIM TRANSPORT SPECIAL</div>}
                        </>
                      ) : (
                        <div style={{whiteSpace:'pre-wrap'}}>{T.continut_descriere || '—'}</div>
                      )}
                    </td>
                    <td style={{padding:'8px 8px', verticalAlign:'top', borderBottom:'1px solid #D1D5DB', fontFamily:'monospace', fontSize:10}}>
                      {T.tip === 'utilaj' && T.activ_transportat ? (
                        <>
                          {T.activ_transportat.nr_inventar && <div style={{fontWeight:'bold', color:'#1E40AF'}}>Nr. inventar: <strong>{T.activ_transportat.nr_inventar}</strong></div>}
                          {T.activ_transportat.cod_intern && <div>Cod intern: <strong>{T.activ_transportat.cod_intern}</strong></div>}
                          {T.activ_transportat.nr_inmatriculare && <div>Nr. înmatriculare: {T.activ_transportat.nr_inmatriculare}</div>}
                          {T.activ_transportat.serie_sasiu && <div style={{color:'#6B7280'}}>Serie șasiu: {T.activ_transportat.serie_sasiu}</div>}
                        </>
                      ) : '—'}
                    </td>
                    <td style={{padding:'8px 8px', textAlign:'center', verticalAlign:'top', borderBottom:'1px solid #D1D5DB'}}>{T.tip === 'utilaj' ? 'buc' : '—'}</td>
                    <td style={{padding:'8px 8px', textAlign:'center', verticalAlign:'top', borderBottom:'1px solid #D1D5DB', fontWeight:'bold'}}>{T.tip === 'utilaj' ? '1' : '—'}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            
            {/* Mijloc transport + șofer */}
            <div style={{marginBottom:18}}>
              <div style={{fontSize:11, fontWeight:'bold', color:'#1E40AF', textTransform:'uppercase', borderBottom:'1px solid #93C5FD', paddingBottom:3, marginBottom:8, letterSpacing:.5}}>🚚 Mijloc transport & Șofer</div>
              <table style={{width:'100%', borderCollapse:'collapse', fontSize:11}}>
                <tbody>
                  <tr>
                    <td style={{padding:'4px 8px', fontWeight:'bold', width:'25%', color:'#374151', verticalAlign:'top'}}>Mijloc principal:</td>
                    <td style={{padding:'4px 8px'}}>{T.masina ? formatActiv(T.masina) : '—'}</td>
                  </tr>
                  {T.remorca && (
                    <tr>
                      <td style={{padding:'4px 8px', fontWeight:'bold', color:'#374151', verticalAlign:'top'}}>Remorcă/Trailer:</td>
                      <td style={{padding:'4px 8px'}}>{formatActiv(T.remorca)} {T.remorca.logistica_categorii?.tip && `(${T.remorca.logistica_categorii.tip})`}</td>
                    </tr>
                  )}
                  <tr>
                    <td style={{padding:'4px 8px', fontWeight:'bold', color:'#374151', verticalAlign:'top'}}>Șofer:</td>
                    <td style={{padding:'4px 8px', fontWeight:'bold'}}>
                      {T.sofer_employee?.name || T.sofer_extern_nume || '—'}
                      {T.sofer_employee?.position && <span style={{fontWeight:'normal', color:'#6B7280', marginLeft:6}}>({T.sofer_employee.position})</span>}
                      {T.sofer_extern_telefon && <span style={{fontWeight:'normal', color:'#6B7280', marginLeft:6}}>· Tel: {T.sofer_extern_telefon}</span>}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            
            {/* Observații */}
            {T.observatii && (
              <div style={{marginBottom:18}}>
                <div style={{fontSize:11, fontWeight:'bold', color:'#1E40AF', textTransform:'uppercase', borderBottom:'1px solid #93C5FD', paddingBottom:3, marginBottom:6, letterSpacing:.5}}>📝 Observații</div>
                <div style={{padding:8, background:'#F9FAFB', border:'1px solid #E5E7EB', borderRadius:4, fontSize:11, whiteSpace:'pre-wrap'}}>{T.observatii}</div>
              </div>
            )}
            
            {/* Spații semnătură (PAS 4 - cu canvas drawing) */}
            <div style={{marginTop:30, display:'flex', gap:14, justifyContent:'space-between'}}>
              {/* Semnătură EXPEDITOR */}
              <div style={{flex:1, textAlign:'center', borderTop:'1px solid #6B7280', paddingTop:6, position:'relative'}}>
                <div style={{fontSize:10, fontWeight:'bold', color:'#374151', marginBottom:6}}>EXPEDITOR / Manager plecare</div>
                <div style={{minHeight:60, display:'flex', alignItems:'center', justifyContent:'center'}}>
                  {semnExpData ? (
                    <img src={semnExpData} alt="semnătură expeditor" style={{maxHeight:60, maxWidth:'95%'}} />
                  ) : (
                    <button 
                      className="no-print"
                      onClick={() => setShowSemnatura('expeditor')}
                      style={{padding:'8px 14px', background:'#EFF6FF', color:'#2563EB', border:'1px dashed #2563EB', borderRadius:6, fontSize:11, cursor:'pointer', fontWeight:600}}
                    >
                      ✍️ Semnează aici
                    </button>
                  )}
                </div>
                <div style={{fontSize:10, color:'#374151', fontWeight:600, marginTop:3}}>{semnExpNume || T.manager_plecare?.name || '—'}</div>
                {semnExpLa && <div style={{fontSize:8, color:'#16A34A', marginTop:2}}>✓ {new Date(semnExpLa).toLocaleString('ro-RO', {day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit'})}</div>}
                {semnExpData && (
                  <button 
                    className="no-print"
                    onClick={() => setShowSemnatura('expeditor')}
                    style={{position:'absolute', top:0, right:0, padding:'2px 6px', background:'transparent', color:'#9CA3AF', border:'none', fontSize:10, cursor:'pointer'}}
                    title="Re-semnează"
                  >🔄</button>
                )}
              </div>
              
              {/* Semnătură ȘOFER */}
              <div style={{flex:1, textAlign:'center', borderTop:'1px solid #6B7280', paddingTop:6, position:'relative'}}>
                <div style={{fontSize:10, fontWeight:'bold', color:'#374151', marginBottom:6}}>ȘOFER</div>
                <div style={{minHeight:60, display:'flex', alignItems:'center', justifyContent:'center'}}>
                  {semnSofData ? (
                    <img src={semnSofData} alt="semnătură șofer" style={{maxHeight:60, maxWidth:'95%'}} />
                  ) : (
                    <button 
                      className="no-print"
                      onClick={() => setShowSemnatura('sofer')}
                      style={{padding:'8px 14px', background:'#EFF6FF', color:'#2563EB', border:'1px dashed #2563EB', borderRadius:6, fontSize:11, cursor:'pointer', fontWeight:600}}
                    >
                      ✍️ Semnează aici
                    </button>
                  )}
                </div>
                <div style={{fontSize:10, color:'#374151', fontWeight:600, marginTop:3}}>{semnSofNume || T.sofer_employee?.name || T.sofer_extern_nume || '—'}</div>
                {semnSofLa && <div style={{fontSize:8, color:'#16A34A', marginTop:2}}>✓ {new Date(semnSofLa).toLocaleString('ro-RO', {day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit'})}</div>}
                {semnSofData && (
                  <button 
                    className="no-print"
                    onClick={() => setShowSemnatura('sofer')}
                    style={{position:'absolute', top:0, right:0, padding:'2px 6px', background:'transparent', color:'#9CA3AF', border:'none', fontSize:10, cursor:'pointer'}}
                    title="Re-semnează"
                  >🔄</button>
                )}
              </div>
              
              {/* Semnătură DESTINATAR */}
              <div style={{flex:1, textAlign:'center', borderTop:'1px solid #6B7280', paddingTop:6, position:'relative'}}>
                <div style={{fontSize:10, fontWeight:'bold', color:'#374151', marginBottom:6}}>DESTINATAR / Manager destinație</div>
                <div style={{minHeight:60, display:'flex', alignItems:'center', justifyContent:'center'}}>
                  {semnDestData ? (
                    <img src={semnDestData} alt="semnătură destinatar" style={{maxHeight:60, maxWidth:'95%'}} />
                  ) : (
                    <button 
                      className="no-print"
                      onClick={() => setShowSemnatura('destinatar')}
                      style={{padding:'8px 14px', background:'#EFF6FF', color:'#2563EB', border:'1px dashed #2563EB', borderRadius:6, fontSize:11, cursor:'pointer', fontWeight:600}}
                    >
                      ✍️ Semnează aici
                    </button>
                  )}
                </div>
                <div style={{fontSize:10, color:'#374151', fontWeight:600, marginTop:3}}>{semnDestNume || T.manager_destinatie?.name || '—'}</div>
                {semnDestLa && <div style={{fontSize:8, color:'#16A34A', marginTop:2}}>✓ {new Date(semnDestLa).toLocaleString('ro-RO', {day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit'})}</div>}
                {semnDestData && (
                  <button 
                    className="no-print"
                    onClick={() => setShowSemnatura('destinatar')}
                    style={{position:'absolute', top:0, right:0, padding:'2px 6px', background:'transparent', color:'#9CA3AF', border:'none', fontSize:10, cursor:'pointer'}}
                    title="Re-semnează"
                  >🔄</button>
                )}
              </div>
            </div>
            
            {/* Footer */}
            <div style={{marginTop:30, paddingTop:8, borderTop:'1px dashed #D1D5DB', textAlign:'center', fontSize:9, color:'#9CA3AF'}}>
              Document generat automat din ERP Gazpet Instal · {new Date().toLocaleString('ro-RO')} · Operator: {profile?.name || '—'}
            </div>
          </div>
        </div>
      </div>
      
      {/* CSS print */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .aviz-modal-overlay, .aviz-modal-overlay * { visibility: visible; }
          .aviz-modal-overlay { 
            position: absolute !important; 
            inset: 0 !important; 
            background: white !important;
            padding: 0 !important;
            display: block !important;
          }
          .aviz-modal-overlay > div { 
            max-width: none !important; 
            width: 100% !important; 
            border-radius: 0 !important;
            box-shadow: none !important;
          }
          .no-print, .aviz-toolbar { display: none !important; }
          .aviz-content { 
            padding: 15mm !important; 
            font-size: 11pt !important;
          }
          @page { size: A4; margin: 10mm; }
        }
      `}</style>
      
      {/* Modal Setări destinatari email */}
      {showSetariEmail && (
        <SetariEmailDestinatariModal 
          valoare={destinatari.join(',')}
          onClose={() => setShowSetariEmail(false)}
          onSaved={(newVal) => setDestinatari(newVal.split(',').map(s => s.trim()).filter(Boolean))}
          showToast={showToast}
        />
      )}
      
      {/* Modal Canvas Semnătură (PAS 4) */}
      {showSemnatura && (
        <SemnaturaCanvasModal 
          rol={showSemnatura}
          numeImplicit={
            showSemnatura === 'expeditor' ? (T.manager_plecare?.name || profile?.name || '') :
            showSemnatura === 'sofer' ? (T.sofer_employee?.name || T.sofer_extern_nume || '') :
            showSemnatura === 'destinatar' ? (T.manager_destinatie?.name || profile?.name || '') : ''
          }
          onClose={() => setShowSemnatura(null)}
          onSave={(data) => saveSemnatura(showSemnatura, data)}
          showToast={showToast}
        />
      )}
    </>
  )
}

// ----- Pagina Transporturi -----
function TransporturiPage({ active, sites, profile, accessLevel, showToast }) {
  const loc = useLocation()
  const nav = useNavigate()
  const [allInPeriod, setAllInPeriod] = useState([])  // TOATE din perioadă (pentru KPI corect)
  const [loading, setLoading] = useState(false)
  const [statusFilter, setStatusFilter] = useState('Toate')
  const [perioadaFilter, setPerioadaFilter] = useState('luna')
  const [meleFilter, setMeleFilter] = useState(false)
  const [exportingExcel, setExportingExcel] = useState(false)
  const [showComanda, setShowComanda] = useState(false)
  const [editTransport, setEditTransport] = useState(null)
  const [detaliiTransport, setDetaliiTransport] = useState(null)
  
  // Auto-deschide modal dacă vine din butonul global "Cere transport" (?action=new)
  useEffect(() => {
    const params = new URLSearchParams(loc.search)
    if (params.get('action') === 'new') {
      setShowComanda(true)
      params.delete('action')
      const newSearch = params.toString()
      nav(loc.pathname + (newSearch ? '?' + newSearch : ''), { replace: true })
    }
  }, [loc.search])
  
  const fetchAll = async () => {
    setLoading(true)
    let q = supabase.from('logistica_transporturi')
      .select(`*,
        activ_transportat:logistica_active!activ_transportat_id(id, cod_intern, nr_inventar, marca, model, nr_inmatriculare, serie_sasiu, regim_transport_special),
        masina:logistica_active!masina_id(id, cod_intern, marca, model, nr_inmatriculare),
        remorca:logistica_active!remorca_id(id, cod_intern, marca, model, nr_inmatriculare, logistica_categorii(tip)),
        plecare_site:sites!plecare_site_id(name),
        destinatie_site:sites!destinatie_site_id(name),
        solicitant:profiles!solicitant_id(name),
        aprobator:profiles!aprobator_id(name),
        sofer:profiles!sofer_id(name),
        sofer_employee:employees!sofer_employee_id(id, name, position),
        manager_plecare:profiles!manager_plecare_id(id, name, role),
        manager_destinatie:profiles!manager_destinatie_id(id, name, role),
        confirmat_de:profiles!confirmat_primire_de(name)
      `)
    
    // Filtru perioadă (aplicat la nivel DB)
    const today = new Date().toISOString().split('T')[0]
    if (perioadaFilter === 'luna') {
      const y = new Date().getFullYear()
      const m = String(new Date().getMonth() + 1).padStart(2, '0')
      q = q.gte('data_transport', `${y}-${m}-01`)
    } else if (perioadaFilter === 'sapt') {
      const d = new Date(); d.setDate(d.getDate() - 7)
      q = q.gte('data_transport', d.toISOString().split('T')[0])
    } else if (perioadaFilter === 'azi') {
      q = q.eq('data_transport', today)
    }
    
    // Filtru "Doar ale mele" se aplică tot la DB
    if (meleFilter && profile?.id) {
      q = q.or(`solicitant_id.eq.${profile.id},manager_destinatie_id.eq.${profile.id},manager_plecare_id.eq.${profile.id}`)
    }
    
    const { data, error } = await q
    if (error) console.error('Eroare fetch transporturi:', error)
    setAllInPeriod(data || [])
    setLoading(false)
  }
  
  useEffect(() => { fetchAll() }, [perioadaFilter, meleFilter])
  
  // Lista filtrată după status (în memorie)
  const list = useMemo(() => {
    let result = [...allInPeriod]
    if (statusFilter !== 'Toate') result = result.filter(t => t.status === statusFilter)
    
    // Sortare specială pentru aprobate (după data_transport ASC — cele mai apropiate sus)
    if (statusFilter === 'aprobat' || statusFilter === 'programat') {
      result.sort((a, b) => (a.data_transport || '').localeCompare(b.data_transport || ''))
    } else {
      // Default: descrescător pe data_transport (cele recente sus)
      result.sort((a, b) => (b.data_transport || '').localeCompare(a.data_transport || '') || (b.id - a.id))
    }
    return result
  }, [allInPeriod, statusFilter])
  
  // KPI calculate din TOATE transporturile din perioadă (NU se schimbă cu filtrul status)
  const kpi = useMemo(() => {
    const cerute = allInPeriod.filter(t => t.status === 'cerut').length
    const aprobate = allInPeriod.filter(t => t.status === 'aprobat' || t.status === 'programat').length
    const inTranzit = allInPeriod.filter(t => t.status === 'in_tranzit').length
    const livrate = allInPeriod.filter(t => t.status === 'livrat').length
    return { cerute, aprobate, inTranzit, livrate }
  }, [allInPeriod])
  
  // Helper: zile de la solicitare (pentru highlight urgent)
  const zileLaSolicitare = (t) => {
    if (!t.data_solicitarii) return 0
    const ms = Date.now() - new Date(t.data_solicitarii).getTime()
    return Math.floor(ms / (1000 * 60 * 60 * 24))
  }
  
  // Export Excel
  const handleExportExcel = async () => {
    setExportingExcel(true)
    try {
      const XLSX = await import('xlsx-js-style')
      const rows = list.map((t, idx) => ({
        '#': idx + 1,
        'Nr Transport': t.numar_transport || '',
        'Data': t.data_transport || '',
        'Ora': t.ora_plecare ? t.ora_plecare.substring(0, 5) : '',
        'Tip': t.tip === 'utilaj' ? 'Utilaj' : 'Mic TESA',
        'Activ / Conținut': t.tip === 'utilaj' && t.activ_transportat
          ? `${t.activ_transportat.cod_intern || ''} ${t.activ_transportat.marca || ''} ${t.activ_transportat.model || ''}`.trim()
          : (t.continut_descriere || ''),
        'Mijloc principal': t.masina ? formatActiv(t.masina) : '',
        'Remorcă': t.remorca ? formatActiv(t.remorca) : '',
        'Plecare': t.plecare_tip === 'sediu' ? 'Sediu Gazpet' : (t.plecare_site?.name || t.plecare_locatie_text || ''),
        'Manager plecare': t.manager_plecare?.name || '',
        'Destinație': t.destinatie_tip === 'sediu' ? 'Sediu Gazpet' : (t.destinatie_site?.name || t.destinatie_locatie_text || ''),
        'Manager destinație': t.manager_destinatie?.name || '',
        'Șofer': t.sofer_employee?.name || t.sofer?.name || t.sofer_extern_nume || (t.sofer_aloca_logistica ? 'Logistică alocă' : ''),
        'Funcție': t.sofer_employee?.position || '',
        'Solicitant': t.solicitant?.name || '',
        'Aprobator': t.aprobator?.name || '',
        'Status': STATUS_TRANSPORT[t.status]?.label || t.status,
        'Cost estimat (RON)': t.cost_estimat || '',
        'Confirmat primire la': t.confirmat_primire_la ? new Date(t.confirmat_primire_la).toLocaleString('ro-RO') : '',
        'Confirmat de': t.confirmat_de?.name || '',
        'Observații confirmare': t.confirmare_observatii || '',
        'Observații': t.observatii || '',
      }))
      const ws = XLSX.utils.json_to_sheet(rows)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Transporturi')
      // Auto-width
      const colWidths = Object.keys(rows[0] || {}).map(k => ({ wch: Math.max(k.length, 12) }))
      ws['!cols'] = colWidths
      const today = new Date().toISOString().split('T')[0]
      XLSX.writeFile(wb, `Transporturi_${today}.xlsx`)
      showToast(`✓ Export ${rows.length} transporturi → Excel`)
    } catch (e) {
      showToast('Eroare export: ' + e.message, 'error')
    } finally {
      setExportingExcel(false)
    }
  }
  
  return (
    <div>
      {/* ──────────────────────────────────────────────────────────────────── */}
      {/* KPI — Cerute (de aprobat) e ROȘU PULSING dacă > 0 */}
      <div style={{display:'flex', gap:12, marginBottom:14, flexWrap:'wrap'}}>
        <div style={{
          ...S.card, padding:'14px 18px', flex:1, minWidth:200,
          borderLeft: `5px solid ${kpi.cerute > 0 ? G.red : G.border}`,
          background: kpi.cerute > 0 ? G.redDim + '88' : G.surface,
          animation: kpi.cerute > 0 ? 'pulse-red 2s infinite' : 'none',
          boxShadow: kpi.cerute > 0 ? `0 0 16px ${G.red}33` : 'none',
          transition: 'all .3s'
        }}>
          <div style={{fontSize:11, color: kpi.cerute > 0 ? G.red : G.muted, fontWeight:700, textTransform:'uppercase', letterSpacing:.6, marginBottom:4}}>
            ⏳ Cerute (de aprobat) {kpi.cerute > 0 && <span style={{marginLeft:6, padding:'2px 6px', background:G.red, color:'#fff', borderRadius:4, fontSize:9}}>URGENT</span>}
          </div>
          <div style={{fontSize:32, fontWeight:800, color: kpi.cerute > 0 ? G.red : G.text, fontVariantNumeric:'tabular-nums'}}>
            {kpi.cerute}
          </div>
        </div>
        <KPICard icon="✓" label="Aprobate" value={kpi.aprobate} color={G.green} />
        <KPICard icon="🚛" label="În tranzit" value={kpi.inTranzit} color={G.yellow} />
        <KPICard icon="✅" label="Livrate" value={kpi.livrate} color={G.green} />
      </div>
      
      {/* CSS animation pulse-red — inline */}
      <style>{`
        @keyframes pulse-red {
          0%, 100% { box-shadow: 0 0 16px ${G.red}33; }
          50% { box-shadow: 0 0 24px ${G.red}88; }
        }
        @keyframes pulse-row {
          0%, 100% { background: ${G.redDim}33; }
          50% { background: ${G.redDim}66; }
        }
      `}</style>
      
      {/* Toolbar filtre + buton */}
      <div style={{...S.card, padding:12, marginBottom:14, display:'flex', gap:10, alignItems:'center', flexWrap:'wrap'}}>
        <div style={{fontSize:11, color:G.muted, fontWeight:700, textTransform:'uppercase', letterSpacing:.6}}>Filtre:</div>
        
        {/* Status — fără 'programat' (eliminat din flow nou; rămâne accesibil dacă există date vechi cu acel status) */}
        <div style={{display:'flex', gap:4, flexWrap:'wrap'}}>
          {['Toate', 'cerut', 'aprobat', 'in_tranzit', 'livrat', 'respins', 'anulat'].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)} style={{
              padding:'5px 11px', fontSize:11, borderRadius:8, fontWeight:700,
              border:`1px solid ${statusFilter === s ? G.logistica : G.border}`,
              background: statusFilter === s ? G.logistica + '22' : 'transparent',
              color: statusFilter === s ? G.logistica : G.muted,
              cursor:'pointer'
            }}>
              {s === 'Toate' ? 'Toate' : (STATUS_TRANSPORT[s]?.label || s)}
            </button>
          ))}
        </div>
        
        <div style={{width:1, height:20, background:G.border}} />
        
        {/* Perioadă */}
        <div style={{display:'flex', gap:4}}>
          {[{k:'azi', l:'Azi'}, {k:'sapt', l:'7 zile'}, {k:'luna', l:'Luna'}, {k:'tot', l:'Toate'}].map(p => (
            <button key={p.k} onClick={() => setPerioadaFilter(p.k)} style={{
              padding:'5px 11px', fontSize:11, borderRadius:8, fontWeight:700,
              border:`1px solid ${perioadaFilter === p.k ? G.logistica : G.border}`,
              background: perioadaFilter === p.k ? G.logistica + '22' : 'transparent',
              color: perioadaFilter === p.k ? G.logistica : G.muted,
              cursor:'pointer'
            }}>{p.l}</button>
          ))}
        </div>
        
        <div style={{flex:1}} />
        
        {/* Toggle "Doar ale mele" — MAI MARE și mai vizibil */}
        <button 
          onClick={() => setMeleFilter(!meleFilter)} 
          style={{
            padding:'8px 16px', fontSize:13, borderRadius:8, fontWeight:700,
            border:`2px solid ${meleFilter ? G.purple : G.border2}`,
            background: meleFilter ? G.purple + '33' : G.surface,
            color: meleFilter ? G.purple : G.text,
            cursor:'pointer',
            display:'flex', alignItems:'center', gap:6,
            boxShadow: meleFilter ? `0 0 12px ${G.purple}44` : 'none',
            transition:'all .2s'
          }}
          title="Vezi doar transporturile unde ești solicitant SAU manager (plecare/destinație)"
        >
          <span style={{fontSize:16}}>{meleFilter ? '👤' : '👥'}</span>
          <span>{meleFilter ? 'Doar ale mele' : 'Toate'}</span>
        </button>
        
        {/* Buton Export Excel */}
        <button onClick={handleExportExcel} disabled={exportingExcel || list.length === 0} style={{
          ...S.btnS, padding:'8px 14px', fontSize:13, fontWeight:700,
          color: G.green, borderColor: G.green + '88',
          opacity: list.length === 0 ? 0.4 : 1,
          display:'flex', alignItems:'center', gap:6
        }} title="Export listă curentă în Excel">
          <span style={{fontSize:14}}>📥</span>
          <span>{exportingExcel ? 'Export...' : 'Excel'}</span>
        </button>
        
        <button onClick={() => setShowComanda(true)} style={{...S.btnP, background:G.green, fontSize:13, display:'flex', alignItems:'center', gap:6, padding:'10px 16px'}}>
          <span>+</span><span>Comandă transport</span>
        </button>
      </div>
      
      {/* Lista transporturi */}
      <div style={{...S.card, padding:0, overflow:'hidden'}}>
        {loading ? (
          <div style={{padding:40, textAlign:'center', color:G.muted}}>Se încarcă...</div>
        ) : list.length === 0 ? (
          <div style={{padding:40, textAlign:'center', color:G.muted}}>
            <div style={{fontSize:32, marginBottom:8}}>🚚</div>
            <div style={{fontSize:14, fontWeight:700, color:G.text, marginBottom:4}}>Nicio cerere de transport în această perioadă</div>
            <div style={{fontSize:12}}>Apasă <strong style={{color:G.green}}>+ Comandă transport</strong> pentru a crea prima cerere</div>
          </div>
        ) : (
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%', borderCollapse:'collapse', fontSize:13}}>
              <thead>
                <tr style={{background:G.bg, borderBottom:`1px solid ${G.border}`}}>
                  <th style={thStyle}>#</th>
                  <th style={thStyle}>Nr</th>
                  <th style={thStyle}>Data · Ora</th>
                  <th style={thStyle}>Tip</th>
                  <th style={thStyle}>Activ / Conținut</th>
                  <th style={thStyle}>Plecare → Destinație</th>
                  <th style={thStyle}>Șofer</th>
                  <th style={thStyle}>Solicitant</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Acțiuni</th>
                </tr>
              </thead>
              <tbody>
                {list.map((t, idx) => {
                  const zile = zileLaSolicitare(t)
                  const urgent = t.status === 'cerut' && zile > 7
                  const isApr = t.status === 'aprobat' || t.status === 'programat'
                  return (
                  <tr key={t.id} 
                      onClick={() => setDetaliiTransport(t)}
                      style={{
                        borderBottom: urgent ? `2px solid ${G.red}` : `1px solid ${G.border}`, 
                        transition:'background .15s', 
                        cursor:'pointer',
                        background: urgent ? `${G.redDim}33` : undefined,
                        animation: urgent ? 'pulse-row 2s infinite' : 'none'
                      }} 
                      onMouseEnter={e => { if (!urgent) e.currentTarget.style.background = G.bg }} 
                      onMouseLeave={e => { if (!urgent) e.currentTarget.style.background = '' }}>
                    <td style={tdStyle}>
                      <span style={{display:'inline-block', minWidth:24, padding:'2px 6px', background:urgent ? G.red : G.surface, border:`1px solid ${urgent ? G.red : G.border}`, borderRadius:6, fontSize:11, color:urgent ? '#fff' : G.muted, textAlign:'center', fontWeight: urgent ? 700 : 400}}>
                        {urgent ? '🔥' : idx+1}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <span style={{fontFamily:'monospace', fontSize:11, color:G.logistica, fontWeight:700}}>{t.numar_transport}</span>
                      {urgent && <div style={{fontSize:9, color:G.red, fontWeight:700, marginTop:2}}>⚠️ {zile} zile fără răspuns</div>}
                    </td>
                    <td style={tdStyle}>
                      <div style={{fontSize: isApr ? 14 : 12, color:G.text, fontWeight: isApr ? 700 : 400}}>{t.data_transport}</div>
                      {t.ora_plecare && <div style={{fontSize:10, color:G.muted}}>{t.ora_plecare.substring(0,5)}</div>}
                    </td>
                    <td style={tdStyle}>
                      <span style={{fontSize:18}}>{t.tip === 'utilaj' ? '🚛' : '📄'}</span>
                    </td>
                    <td style={tdStyle}>
                      {t.tip === 'utilaj' && t.activ_transportat ? (
                        <div>
                          <div style={{fontSize:12, color:G.text, fontWeight:600}}>{t.activ_transportat.cod_intern} · {t.activ_transportat.marca}</div>
                          <div style={{fontSize:10, color:G.muted}}>{t.activ_transportat.model}{t.activ_transportat.regim_transport_special && <span style={{color:G.red, marginLeft:4}}>⚠️ Regim special</span>}</div>
                          {/* Mijloc transport (combo cap tractor + remorca) */}
                          {(t.masina || t.remorca) && (
                            <div style={{marginTop:4, fontSize:10, color:G.logistica}}>
                              🚛 {t.masina ? formatActiv(t.masina) : <span style={{color:G.muted}}>fără mijloc</span>}
                              {t.remorca && <span> + {formatActiv(t.remorca)} <span style={{color:G.muted}}>({t.remorca.logistica_categorii?.tip})</span></span>}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div>
                          <div style={{fontSize:12, color:G.text, maxWidth:200, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}} title={t.continut_descriere}>{t.continut_descriere}</div>
                          {t.masina && <div style={{marginTop:4, fontSize:10, color:G.logistica}}>🚗 {formatActiv(t.masina)}</div>}
                        </div>
                      )}
                    </td>
                    <td style={tdStyle}>
                      <div style={{fontSize:11, color:G.text}}>{formatLocatie(t.plecare_tip, t.plecare_site, t.plecare_locatie_text)}</div>
                      <div style={{fontSize:10, color:G.muted, marginTop:2}}>↓</div>
                      <div style={{fontSize:11, color:G.text}}>{formatLocatie(t.destinatie_tip, t.destinatie_site, t.destinatie_locatie_text)}</div>
                    </td>
                    <td style={tdStyle}>
                      {/* Prioritate: logistica alocă → employee → profile → extern */}
                      {t.sofer_aloca_logistica && !t.sofer_employee_id ? (
                        <div style={{display:'inline-flex', alignItems:'center', gap:4, padding:'3px 8px', borderRadius:999, fontSize:10, fontWeight:700, background:G.purple + '22', color:G.purple, border:`1px solid ${G.purple}55`}}>
                          🏢 Logistică alocă
                        </div>
                      ) : t.sofer_gazpet ? (
                        t.sofer_employee ? (
                          <>
                            <div style={{fontSize:12, color:G.text, fontWeight:600}}>{t.sofer_employee.name}</div>
                            <div style={{fontSize:10, color:G.muted}}>{t.sofer_employee.position}</div>
                          </>
                        ) : t.sofer ? (
                          <div style={{fontSize:12, color:G.text}}>{t.sofer.name} <span style={{fontSize:9, color:G.muted}}>(user)</span></div>
                        ) : (
                          <div style={{fontSize:12, color:G.muted}}>—</div>
                        )
                      ) : (
                        <>
                          <div style={{fontSize:12, color:G.text}}>{t.sofer_extern_nume || '—'}</div>
                          {t.sofer_extern_telefon && <div style={{fontSize:10, color:G.muted}}>{t.sofer_extern_telefon}</div>}
                          <div style={{fontSize:9, color:G.orange}}>(extern)</div>
                        </>
                      )}
                    </td>
                    <td style={tdStyle}>
                      <div style={{fontSize:11, color:G.muted}}>{t.solicitant?.name || '—'}</div>
                    </td>
                    <td style={tdStyle}>
                      <StatusBadge status={t.status} />
                    </td>
                    <td style={tdStyle}>
                      {/* Buton Edit doar pentru status='cerut' (înainte de aprobare) */}
                      {t.status === 'cerut' ? (
                        <button 
                          onClick={(e) => { e.stopPropagation(); setEditTransport(t) }}
                          style={{...S.btnS, padding:'5px 10px', fontSize:11, color:G.logistica, borderColor:G.logistica + '88'}}
                          title="Editează cererea (doar înainte de aprobare)"
                        >
                          ✏️ Edit
                        </button>
                      ) : (
                        <span style={{fontSize:10, color:G.muted}}>—</span>
                      )}
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      
      {/* Modal Comandă (creare nouă) */}
      {showComanda && (
        <ComandaTransportModal
          active={active}
          sites={sites}
          profile={profile}
          onClose={() => setShowComanda(false)}
          onSaved={fetchAll}
          showToast={showToast}
        />
      )}
      
      {/* Modal Edit transport */}
      {editTransport && (
        <ComandaTransportModal
          active={active}
          sites={sites}
          profile={profile}
          initialTransport={editTransport}
          onClose={() => setEditTransport(null)}
          onSaved={fetchAll}
          showToast={showToast}
        />
      )}
      
      {/* Modal Detalii Transport (workflow aprobare) */}
      {detaliiTransport && (
        <DetaliiTransportModal
          transport={detaliiTransport}
          profile={profile}
          sites={sites}
          onClose={() => setDetaliiTransport(null)}
          onChanged={async () => {
            await fetchAll()
            // Refresh și transportul deschis în detalii (pentru că state-ul lui pierdea schimbările)
            const { data: fresh } = await supabase
              .from('logistica_transporturi')
              .select(`*,
                activ_transportat:logistica_active!activ_transportat_id(id, cod_intern, nr_inventar, marca, model, nr_inmatriculare, serie_sasiu, regim_transport_special),
                masina:logistica_active!masina_id(id, cod_intern, marca, model, nr_inmatriculare),
                remorca:logistica_active!remorca_id(id, cod_intern, marca, model, nr_inmatriculare, logistica_categorii(tip)),
                plecare_site:sites!plecare_site_id(name),
                destinatie_site:sites!destinatie_site_id(name),
                solicitant:profiles!solicitant_id(name),
                aprobator:profiles!aprobator_id(name),
                sofer:profiles!sofer_id(name),
                sofer_employee:employees!sofer_employee_id(id, name, position),
                manager_plecare:profiles!manager_plecare_id(id, name, role),
                manager_destinatie:profiles!manager_destinatie_id(id, name, role),
                confirmat_de:profiles!confirmat_primire_de(name)
              `)
              .eq('id', detaliiTransport.id)
              .single()
            if (fresh) setDetaliiTransport(fresh)
          }}
          onEdit={(t) => setEditTransport(t)}
          showToast={showToast}
        />
      )}
    </div>
  )
}

const thStyle = { padding:'10px 12px', textAlign:'left', fontSize:11, fontWeight:700, color:G.muted, textTransform:'uppercase', letterSpacing:.5 }
const tdStyle = { padding:'10px 12px', verticalAlign:'top' }

// ===========================================================================
// GESTIUNE UTILAJE PE ȘANTIER — locația curentă fiecare activ
// ===========================================================================
function ArhivaAvizePage({ profile, showToast }) {
  const [arhiva, setArhiva] = useState([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [perioadaFilter, setPerioadaFilter] = useState('toate')  // toate | luna | sapt | azi
  const [downloadingId, setDownloadingId] = useState(null)
  const [showDeleteLuna, setShowDeleteLuna] = useState(false)  // modal bulk delete pe lună
  
  const isAdmin = ['superadmin', 'admin_logistica'].includes(profile?.role)
  
  // Delete individual aviz (admin only)
  const handleDelete = async (arhAviz) => {
    if (!isAdmin) { showToast('Doar admin poate șterge', 'error'); return }
    if (!confirm(`Sigur vrei să ștergi ${arhAviz.numar_aviz}?\n\n• PDF din Storage\n• Înregistrarea din arhivă\n\nAceastă acțiune e ireversibilă!`)) return
    
    setDownloadingId(arhAviz.id)
    try {
      // 1. Delete PDF din Storage
      const { error: stErr } = await supabase.storage.from('avize').remove([arhAviz.pdf_path])
      if (stErr) console.warn('Storage delete warning:', stErr.message)
      
      // 2. Delete row din DB
      const { error: dbErr } = await supabase.from('logistica_avize_arhiva').delete().eq('id', arhAviz.id)
      if (dbErr) throw dbErr
      
      showToast(`✓ ${arhAviz.numar_aviz} șters`)
      loadArhiva()
    } catch (e) {
      showToast('Eroare ștergere: ' + (e.message || e), 'error')
    } finally {
      setDownloadingId(null)
    }
  }
  
  // Delete bulk pe lună (admin only — pentru curățenie după 12 luni)
  const handleDeleteLuna = async (yearMonth) => {
    if (!isAdmin) { showToast('Doar admin poate șterge', 'error'); return }
    
    // Verifică câte avize sunt în luna respectivă
    const startDate = `${yearMonth}-01`
    const endDate = (() => {
      const [y, m] = yearMonth.split('-').map(Number)
      const next = new Date(y, m, 1)  // luna următoare
      return next.toISOString().split('T')[0]
    })()
    
    const { data: avizeLuna, error: qErr } = await supabase
      .from('logistica_avize_arhiva')
      .select('id, numar_aviz, pdf_path')
      .gte('data_transport', startDate)
      .lt('data_transport', endDate)
    
    if (qErr) { showToast('Eroare query: ' + qErr.message, 'error'); return }
    if (!avizeLuna || avizeLuna.length === 0) { showToast('Nicio aviz în această lună', 'warn'); return }
    
    if (!confirm(`Vei șterge ${avizeLuna.length} avize din luna ${yearMonth}!\n\n• Toate PDF-urile din Storage\n• Toate înregistrările din arhivă\n\nAceastă acțiune e IREVERSIBILĂ. Continui?`)) return
    
    try {
      // Delete PDF-uri din Storage (batch)
      const paths = avizeLuna.map(a => a.pdf_path).filter(Boolean)
      if (paths.length > 0) {
        const { error: stErr } = await supabase.storage.from('avize').remove(paths)
        if (stErr) console.warn('Storage delete warning:', stErr.message)
      }
      
      // Delete rows din DB
      const ids = avizeLuna.map(a => a.id)
      const { error: dbErr } = await supabase.from('logistica_avize_arhiva').delete().in('id', ids)
      if (dbErr) throw dbErr
      
      showToast(`✓ ${avizeLuna.length} avize șterse pentru ${yearMonth}`)
      setShowDeleteLuna(false)
      loadArhiva()
    } catch (e) {
      showToast('Eroare ștergere: ' + (e.message || e), 'error')
    }
  }
  
  // Calculează lunile cu avize pentru bulk delete
  const luniCuAvize = useMemo(() => {
    const map = new Map()
    arhiva.forEach(a => {
      if (!a.data_transport) return
      const ym = a.data_transport.substring(0, 7)
      const cur = map.get(ym) || { count: 0, size: 0 }
      cur.count += 1
      cur.size += (a.pdf_size_bytes || 0)
      map.set(ym, cur)
    })
    return Array.from(map.entries()).map(([ym, data]) => ({ ym, ...data })).sort((a, b) => a.ym.localeCompare(b.ym))
  }, [arhiva])
  
  useEffect(() => { loadArhiva() }, [perioadaFilter])
  
  const loadArhiva = async () => {
    setLoading(true)
    let q = supabase.from('logistica_avize_arhiva').select('*').order('generat_la', { ascending: false }).limit(500)
    
    const today = new Date().toISOString().split('T')[0]
    if (perioadaFilter === 'azi') q = q.eq('data_transport', today)
    else if (perioadaFilter === 'sapt') {
      const d = new Date(); d.setDate(d.getDate() - 7)
      q = q.gte('data_transport', d.toISOString().split('T')[0])
    } else if (perioadaFilter === 'luna') {
      const y = new Date().getFullYear(), m = String(new Date().getMonth() + 1).padStart(2, '0')
      q = q.gte('data_transport', `${y}-${m}-01`)
    }
    
    const { data, error } = await q
    if (error) { showToast('Eroare încărcare arhivă: ' + error.message, 'error'); setLoading(false); return }
    setArhiva(data || [])
    setLoading(false)
  }
  
  const filtered = useMemo(() => {
    if (!search.trim()) return arhiva
    const s = search.toLowerCase()
    return arhiva.filter(a => 
      a.numar_aviz?.toLowerCase().includes(s) ||
      a.numar_transport?.toLowerCase().includes(s) ||
      a.plecare_text?.toLowerCase().includes(s) ||
      a.destinatie_text?.toLowerCase().includes(s) ||
      a.sofer_nume?.toLowerCase().includes(s) ||
      a.manager_destinatie_nume?.toLowerCase().includes(s)
    )
  }, [arhiva, search])
  
  const handleDownload = async (arhAviz) => {
    setDownloadingId(arhAviz.id)
    try {
      const { data, error } = await supabase.storage.from('avize').download(arhAviz.pdf_path)
      if (error) throw error
      const url = URL.createObjectURL(data)
      const a = document.createElement('a')
      a.href = url
      a.download = `${arhAviz.numar_aviz}.pdf`
      a.click()
      URL.revokeObjectURL(url)
      showToast('✓ PDF descărcat')
    } catch (e) {
      showToast('Eroare descărcare: ' + (e.message || e), 'error')
    } finally {
      setDownloadingId(null)
    }
  }
  
  const handlePreview = async (arhAviz) => {
    setDownloadingId(arhAviz.id)
    try {
      const { data, error } = await supabase.storage.from('avize').createSignedUrl(arhAviz.pdf_path, 60)  // 60 sec
      if (error) throw error
      window.open(data.signedUrl, '_blank')
    } catch (e) {
      showToast('Eroare preview: ' + (e.message || e), 'error')
    } finally {
      setDownloadingId(null)
    }
  }
  
  const totalSize = useMemo(() => {
    const s = arhiva.reduce((acc, a) => acc + (a.pdf_size_bytes || 0), 0)
    return s > 1024*1024 ? `${(s / 1024 / 1024).toFixed(1)} MB` : `${(s / 1024).toFixed(0)} KB`
  }, [arhiva])
  
  return (
    <div>
      {/* Header + KPI */}
      <div style={{display:'flex', gap:12, marginBottom:14, flexWrap:'wrap'}}>
        <KPICard icon="📂" label="Total avize arhivate" value={arhiva.length} color={G.purple} />
        <KPICard icon="✍️" label="Cu toate semnăturile" value={arhiva.filter(a => a.semnat_expeditor && a.semnat_sofer && a.semnat_destinatar).length} color={G.green} />
        <KPICard icon="💾" label="Spațiu ocupat" value={totalSize} color={G.blue} />
      </div>
      
      {/* Filtre */}
      <div style={{display:'flex', gap:10, marginBottom:14, flexWrap:'wrap', alignItems:'center'}}>
        <input 
          type="text" 
          value={search} 
          onChange={e => setSearch(e.target.value)} 
          placeholder="🔍 Caută după nr aviz, transport, locație, șofer..."
          style={{...S.input, flex:1, minWidth:280}}
        />
        <div style={{display:'flex', gap:4, padding:4, background:G.surface, borderRadius:8, border:`1px solid ${G.border}`}}>
          {[['azi','Azi'],['sapt','7 zile'],['luna','Luna'],['toate','Toate']].map(([k, label]) => (
            <button key={k} onClick={() => setPerioadaFilter(k)} style={{
              padding:'6px 12px', borderRadius:6, border:'none', cursor:'pointer', fontSize:12,
              background: perioadaFilter === k ? G.purple+'33' : 'transparent',
              color: perioadaFilter === k ? G.purple : G.muted,
              fontWeight: perioadaFilter === k ? 700 : 500
            }}>{label}</button>
          ))}
        </div>
        <button onClick={loadArhiva} style={S.btnS}>🔄 Reîncarcă</button>
        {isAdmin && luniCuAvize.length > 0 && (
          <button onClick={() => setShowDeleteLuna(true)} style={{...S.btnS, color: G.red, borderColor: G.red+'88'}}>
            🗑️ Șterge lună
          </button>
        )}
      </div>
      
      {/* Tabel arhivă */}
      <div style={{...S.card, padding:0, overflow:'hidden'}}>
        {loading ? (
          <div style={{padding:40, textAlign:'center', color:G.muted}}>Se încarcă arhiva...</div>
        ) : filtered.length === 0 ? (
          <div style={{padding:40, textAlign:'center', color:G.muted}}>
            {arhiva.length === 0 ? '📭 Nicio arhivă încă — generează un aviz și apasă "💾 Arhivează PDF"' : 'Nimic găsit pentru căutare'}
          </div>
        ) : (
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%', borderCollapse:'collapse', fontSize:13}}>
              <thead style={{background:G.bg}}>
                <tr>
                  <th style={thStyle}>Nr. Aviz</th>
                  <th style={thStyle}>Transport</th>
                  <th style={thStyle}>Data</th>
                  <th style={thStyle}>Plecare → Destinație</th>
                  <th style={thStyle}>Șofer</th>
                  <th style={thStyle}>Semnături</th>
                  <th style={thStyle}>Generat</th>
                  <th style={thStyle}>Mărime</th>
                  <th style={{...thStyle, textAlign:'right'}}>Acțiuni</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(a => (
                  <tr key={a.id} style={{borderTop:`1px solid ${G.border}`}}>
                    <td style={{...tdStyle, fontFamily:'monospace', fontWeight:700, color:G.purple}}>{a.numar_aviz}</td>
                    <td style={{...tdStyle, fontFamily:'monospace', fontSize:11}}>{a.numar_transport}</td>
                    <td style={tdStyle}>{a.data_transport ? new Date(a.data_transport).toLocaleDateString('ro-RO') : '—'}</td>
                    <td style={{...tdStyle, fontSize:11, color:G.muted}}>
                      <div>{a.plecare_text || '—'}</div>
                      <div style={{color:G.dim, fontSize:10}}>↓</div>
                      <div>{a.destinatie_text || '—'}</div>
                    </td>
                    <td style={{...tdStyle, fontSize:12}}>{a.sofer_nume || '—'}</td>
                    <td style={tdStyle}>
                      <div style={{display:'flex', gap:3}}>
                        <span title="Expeditor" style={{fontSize:11, padding:'2px 6px', borderRadius:4, background: a.semnat_expeditor ? G.green+'33' : G.border, color: a.semnat_expeditor ? G.green : G.dim}}>
                          {a.semnat_expeditor ? '✓' : '—'} E
                        </span>
                        <span title="Șofer" style={{fontSize:11, padding:'2px 6px', borderRadius:4, background: a.semnat_sofer ? G.green+'33' : G.border, color: a.semnat_sofer ? G.green : G.dim}}>
                          {a.semnat_sofer ? '✓' : '—'} Ș
                        </span>
                        <span title="Destinatar" style={{fontSize:11, padding:'2px 6px', borderRadius:4, background: a.semnat_destinatar ? G.green+'33' : G.border, color: a.semnat_destinatar ? G.green : G.dim}}>
                          {a.semnat_destinatar ? '✓' : '—'} D
                        </span>
                      </div>
                    </td>
                    <td style={{...tdStyle, fontSize:11, color:G.muted}}>
                      <div>{a.generat_de_nume || '—'}</div>
                      <div style={{fontSize:10, color:G.dim}}>{new Date(a.generat_la).toLocaleString('ro-RO', {day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit'})}</div>
                    </td>
                    <td style={{...tdStyle, fontSize:11, color:G.muted}}>
                      {a.pdf_size_bytes ? `${(a.pdf_size_bytes / 1024).toFixed(0)} KB` : '—'}
                    </td>
                    <td style={{...tdStyle, textAlign:'right'}}>
                      <div style={{display:'flex', gap:6, justifyContent:'flex-end'}}>
                        <button 
                          onClick={() => handlePreview(a)} 
                          disabled={downloadingId === a.id}
                          style={{padding:'5px 10px', background:G.blue+'22', color:G.blue, border:`1px solid ${G.blue}55`, borderRadius:5, fontSize:11, cursor:'pointer', fontWeight:600}}
                          title="Deschide într-un tab nou"
                        >
                          👁 Preview
                        </button>
                        <button 
                          onClick={() => handleDownload(a)} 
                          disabled={downloadingId === a.id}
                          style={{padding:'5px 10px', background:G.green+'22', color:G.green, border:`1px solid ${G.green}55`, borderRadius:5, fontSize:11, cursor:'pointer', fontWeight:600}}
                          title="Descarcă PDF"
                        >
                          {downloadingId === a.id ? '...' : '⬇️ Descarcă'}
                        </button>
                        {isAdmin && (
                          <button 
                            onClick={() => handleDelete(a)} 
                            disabled={downloadingId === a.id}
                            style={{padding:'5px 10px', background:G.red+'22', color:G.red, border:`1px solid ${G.red}55`, borderRadius:5, fontSize:11, cursor:'pointer', fontWeight:600}}
                            title="Șterge aviz (PDF + arhivă)"
                          >
                            🗑️
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      
      <div style={{marginTop:12, fontSize:11, color:G.muted, textAlign:'center'}}>
        💡 Avizele generate cu butonul "💾 Arhivează PDF" din modalul aviz apar aici · Stocate în Supabase Storage (bucket "avize")
      </div>
      
      {/* Modal Bulk Delete pe Lună */}
      {showDeleteLuna && (
        <div style={{position:'fixed', inset:0, background:'rgba(0,0,0,0.85)', zIndex:1100, display:'flex', alignItems:'center', justifyContent:'center', padding:20}}>
          <div style={{...S.card, width:'100%', maxWidth:560, padding:24, maxHeight:'85vh', overflowY:'auto'}}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14, paddingBottom:12, borderBottom:`1px solid ${G.border}`}}>
              <div>
                <div style={{fontSize:17, fontWeight:700, color:G.text}}>🗑️ Șterge avize pe lună</div>
                <div style={{fontSize:11, color:G.muted, marginTop:3}}>Pentru retenție de date — șterge toate avizele dintr-o lună întreagă</div>
              </div>
              <button onClick={() => setShowDeleteLuna(false)} style={{...S.btnS, padding:'4px 10px'}}>✕</button>
            </div>
            
            <div style={{marginBottom:14, padding:10, background:G.red+'11', border:`1px solid ${G.red}44`, borderRadius:8}}>
              <div style={{fontSize:11, color:G.red, fontWeight:700, marginBottom:4}}>⚠️ ATENȚIE</div>
              <div style={{fontSize:11, color:G.muted, lineHeight:1.5}}>
                Recomandare: păstrează avizele cel puțin <strong>12 luni</strong> pentru audit fiscal. 
                Ștergerea e <strong>ireversibilă</strong> (PDF + Storage).
              </div>
            </div>
            
            <div style={{fontSize:11, color:G.muted, fontWeight:700, textTransform:'uppercase', marginBottom:8}}>Luni cu avize în arhivă</div>
            <div style={{display:'flex', flexDirection:'column', gap:6}}>
              {luniCuAvize.length === 0 && <div style={{fontSize:12, color:G.muted, fontStyle:'italic', padding:12, textAlign:'center'}}>Nicio lună cu avize</div>}
              {luniCuAvize.map(luna => {
                const monthsAgo = (() => {
                  const [y, m] = luna.ym.split('-').map(Number)
                  const target = new Date(y, m-1, 1)
                  const now = new Date()
                  return (now.getFullYear() - target.getFullYear()) * 12 + (now.getMonth() - target.getMonth())
                })()
                const sizeKB = (luna.size / 1024).toFixed(0)
                const sizeMB = (luna.size / 1024 / 1024).toFixed(1)
                const sizeStr = luna.size > 1024*1024 ? `${sizeMB} MB` : `${sizeKB} KB`
                const isOldEnough = monthsAgo >= 12
                
                return (
                  <div key={luna.ym} style={{display:'flex', alignItems:'center', gap:10, padding:10, background:G.bg, border:`1px solid ${G.border}`, borderRadius:8}}>
                    <div style={{flex:1}}>
                      <div style={{fontSize:13, fontWeight:600, color:G.text}}>
                        {luna.ym} 
                        {isOldEnough && <span style={{marginLeft:8, fontSize:10, padding:'2px 6px', background:G.green+'33', color:G.green, borderRadius:4}}>OK pentru ștergere</span>}
                        {!isOldEnough && <span style={{marginLeft:8, fontSize:10, padding:'2px 6px', background:G.orange+'33', color:G.orange, borderRadius:4}}>{monthsAgo}/12 luni</span>}
                      </div>
                      <div style={{fontSize:10, color:G.muted, marginTop:2}}>
                        {luna.count} {luna.count === 1 ? 'aviz' : 'avize'} · {sizeStr}
                      </div>
                    </div>
                    <button
                      onClick={() => handleDeleteLuna(luna.ym)}
                      style={{
                        padding:'6px 12px',
                        background: isOldEnough ? G.red+'22' : G.surface,
                        color: isOldEnough ? G.red : G.muted,
                        border: `1px solid ${isOldEnough ? G.red+'88' : G.border}`,
                        borderRadius: 6,
                        fontSize: 11,
                        cursor: 'pointer',
                        fontWeight: 700
                      }}
                    >🗑️ Șterge</button>
                  </div>
                )
              })}
            </div>
            
            <div style={{display:'flex', justifyContent:'flex-end', marginTop:14, paddingTop:12, borderTop:`1px solid ${G.border}`}}>
              <button onClick={() => setShowDeleteLuna(false)} style={S.btnS}>Închide</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


// ============================================================
// SFÂRȘIT SECȚIUNE TRANSPORT
// ============================================================

// ============================================================
// ARHIVĂ ALIMENTĂRI — consultare istoric extins
// ============================================================
function ArhivaAlimentariPage({ profile, sites, rezervoare, pretMotorina, showToast }) {
  const [arhiva, setArhiva] = useState([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [perioadaFilter, setPerioadaFilter] = useState('luna')  // azi|ieri|sapt|luna|3luni|an|toate|custom
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [tipFilter, setTipFilter] = useState('Toate')
  const [sursaFilter, setSursaFilter] = useState('Toate')
  const [siteFilter, setSiteFilter] = useState('Toate')
  const [editAlim, setEditAlim] = useState(null)
  const [exportingExcel, setExportingExcel] = useState(false)
  const [viewMode, setViewMode] = useState('toate')  // 'toate' | 'santier' | 'utilaj'
  
  const isAdmin = ['superadmin', 'admin_logistica'].includes(profile?.role)
  
  // Load alimentări din DB conform filtru perioadă
  const loadArhiva = async () => {
    setLoading(true)
    const today = new Date()
    let startDate = null, endDate = null
    
    if (perioadaFilter === 'azi') {
      startDate = today.toISOString().split('T')[0]
      endDate = today.toISOString().split('T')[0]
    } else if (perioadaFilter === 'ieri') {
      const ieri = new Date(today); ieri.setDate(ieri.getDate() - 1)
      startDate = ieri.toISOString().split('T')[0]
      endDate = ieri.toISOString().split('T')[0]
    } else if (perioadaFilter === 'sapt') {
      const start = new Date(today); start.setDate(start.getDate() - 7)
      startDate = start.toISOString().split('T')[0]
      endDate = today.toISOString().split('T')[0]
    } else if (perioadaFilter === 'luna') {
      const start = new Date(today.getFullYear(), today.getMonth(), 1)
      startDate = start.toISOString().split('T')[0]
      endDate = today.toISOString().split('T')[0]
    } else if (perioadaFilter === '3luni') {
      const start = new Date(today); start.setMonth(start.getMonth() - 3)
      startDate = start.toISOString().split('T')[0]
      endDate = today.toISOString().split('T')[0]
    } else if (perioadaFilter === 'an') {
      const start = new Date(today.getFullYear(), 0, 1)
      startDate = start.toISOString().split('T')[0]
      endDate = today.toISOString().split('T')[0]
    } else if (perioadaFilter === 'custom' && customStart && customEnd) {
      startDate = customStart
      endDate = customEnd
    }
    
    let q = supabase.from('logistica_alimentari')
      .select(`*, 
        logistica_active(id, cod_intern, nr_inmatriculare, marca, model, norma_consum, unitate_norma, prag_alerta_consum, logistica_categorii(tip, subcategorie)),
        sites:site_id(id, name),
        profile_creator:created_by(id, name)
      `)
      .order('data_alimentare', { ascending: false })
      .order('id', { ascending: false })
      .limit(2000)
    
    if (startDate) q = q.gte('data_alimentare', startDate)
    if (endDate) q = q.lte('data_alimentare', endDate)
    
    const { data, error } = await q
    setLoading(false)
    if (error) { showToast('Eroare încărcare arhivă: ' + error.message, 'error'); return }
    setArhiva(data || [])
  }
  
  useEffect(() => {
    if (perioadaFilter !== 'custom' || (customStart && customEnd)) loadArhiva()
  }, [perioadaFilter, customStart, customEnd])
  
  // Liste pentru filtre (calculate din date)
  const tipuriDisponibile = useMemo(() => {
    const s = new Set()
    arhiva.forEach(a => { if (a.logistica_active?.logistica_categorii?.tip) s.add(a.logistica_active.logistica_categorii.tip) })
    return Array.from(s).sort()
  }, [arhiva])
  
  const surseDisponibile = useMemo(() => {
    const s = new Set()
    arhiva.forEach(a => { if (a.statie_combustibil) s.add(a.statie_combustibil) })
    return Array.from(s).sort()
  }, [arhiva])
  
  const siteuriDisponibile = useMemo(() => {
    const s = new Set()
    arhiva.forEach(a => { if (a.sites?.name) s.add(a.sites.name) })
    return Array.from(s).sort()
  }, [arhiva])
  
  // Filtrare finală (search + 3 filtre)
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return arhiva.filter(a => {
      const av = a.logistica_active
      if (tipFilter !== 'Toate' && av?.logistica_categorii?.tip !== tipFilter) return false
      if (sursaFilter !== 'Toate' && a.statie_combustibil !== sursaFilter) return false
      if (siteFilter !== 'Toate' && a.sites?.name !== siteFilter) return false
      if (q) {
        const hay = `${av?.marca || ''} ${av?.model || ''} ${av?.cod_intern || ''} ${av?.nr_inmatriculare || ''} ${a.sites?.name || ''} ${a.statie_combustibil || ''} ${a.profile_creator?.name || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [arhiva, search, tipFilter, sursaFilter, siteFilter])
  
  // KPI
  const kpi = useMemo(() => ({
    total: filtered.length,
    totalLitri: filtered.reduce((s, a) => s + Number(a.cantitate_litri || 0), 0),
    totalCost: filtered.reduce((s, a) => s + Number(a.pret_total || 0), 0),
    medieLitri: filtered.length > 0 ? filtered.reduce((s, a) => s + Number(a.cantitate_litri || 0), 0) / filtered.length : 0,
    nrSantiere: new Set(filtered.filter(a => a.sites?.name).map(a => a.sites.name)).size,
    nrUtilaje: new Set(filtered.filter(a => a.logistica_active?.id).map(a => a.logistica_active.id)).size,
  }), [filtered])
  
  // Agregare pe ȘANTIER
  const aggSantier = useMemo(() => {
    const map = new Map()
    filtered.forEach(a => {
      const siteName = a.sites?.name || '(Fără șantier)'
      if (!map.has(siteName)) {
        map.set(siteName, { 
          siteName, 
          siteId: a.sites?.id || null,
          nrAlim: 0, totalLitri: 0, totalCost: 0,
          utilajeSet: new Set(),
          rows: []
        })
      }
      const x = map.get(siteName)
      x.nrAlim += 1
      x.totalLitri += Number(a.cantitate_litri || 0)
      x.totalCost += Number(a.pret_total || 0)
      if (a.logistica_active?.id) x.utilajeSet.add(a.logistica_active.id)
      x.rows.push(a)
    })
    const total = filtered.reduce((s,a) => s + Number(a.cantitate_litri || 0), 0)
    return Array.from(map.values()).map(x => ({
      ...x,
      nrUtilaje: x.utilajeSet.size,
      procent: total > 0 ? (x.totalLitri / total * 100) : 0
    })).sort((a, b) => b.totalLitri - a.totalLitri)
  }, [filtered])
  
  // Agregare pe UTILAJ + Consum real pe ultimele 7 zile
  // FIX 22.05.2026: calculez ore_lucrate din diff ore_la_alimentare (citirea bordului) între alimentari succesive,
  // în loc să mă bazez pe ore_lucrate_efectiv (introdus manual, lipsă la majoritate)
  const aggUtilaj = useMemo(() => {
    const map = new Map()
    // Pentru consumul real, filtrez DIN NOU pe ultimele 7 zile (independent de perioadaFilter)
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    const sevenDaysStr = sevenDaysAgo.toISOString().split('T')[0]
    
    // PAS 1: Sortez alimentari per utilaj cronologic pentru a putea calcula diff ore corect
    const perUtilajSorted = new Map() // activId -> [alim ordonate cronologic]
    filtered.forEach(a => {
      const av = a.logistica_active
      if (!av?.id) return
      if (!perUtilajSorted.has(av.id)) perUtilajSorted.set(av.id, [])
      perUtilajSorted.get(av.id).push(a)
    })
    perUtilajSorted.forEach(arr => {
      arr.sort((x, y) => {
        const da = (x.data_alimentare || '') + '_' + String(x.id).padStart(10, '0')
        const db = (y.data_alimentare || '') + '_' + String(y.id).padStart(10, '0')
        return da.localeCompare(db)
      })
    })
    
    filtered.forEach(a => {
      const av = a.logistica_active
      if (!av?.id) return
      const key = av.id
      if (!map.has(key)) {
        map.set(key, {
          activId: av.id,
          cod: av.cod_intern || '',
          inmatriculare: av.nr_inmatriculare || '',
          marca: av.marca || '',
          model: av.model || '',
          tip: av.logistica_categorii?.tip || '',
          norma: av.norma_consum ? Number(av.norma_consum) : null,
          unitateNorma: av.unitate_norma || 'l/h',
          pragAlerta: av.prag_alerta_consum ? Number(av.prag_alerta_consum) : 10,
          nrAlim: 0, totalLitri: 0, totalCost: 0,
          // Pe ultimele 7 zile pentru consum real
          litri7z: 0, oreLucrate7z: 0, kmParcursi7z: 0, nrAlim7z: 0,
          rows: []
        })
      }
      const x = map.get(key)
      x.nrAlim += 1
      x.totalLitri += Number(a.cantitate_litri || 0)
      x.totalCost += Number(a.pret_total || 0)
      x.rows.push(a)
      
      // Pentru ultimele 7 zile - calculez ore din diff bord cu alimentarea PRECEDENTĂ
      if (a.data_alimentare >= sevenDaysStr) {
        x.nrAlim7z += 1
        x.litri7z += Number(a.cantitate_litri || 0)
        
        // Găsesc alimentarea PRECEDENTĂ pentru același utilaj
        const sortedList = perUtilajSorted.get(av.id) || []
        const idx = sortedList.findIndex(s => s.id === a.id)
        const prev = idx > 0 ? sortedList[idx - 1] : null
        
        if (prev) {
          // Calc diff ore bord (pentru utilaje cu ore_la_alimentare populat)
          if (a.ore_la_alimentare != null && prev.ore_la_alimentare != null) {
            const diffOre = Number(a.ore_la_alimentare) - Number(prev.ore_la_alimentare)
            // Diff valid: >0.5h și <500h (evită ore_regress și diff absurd între alim foarte rare)
            if (diffOre > 0.5 && diffOre < 500) {
              x.oreLucrate7z += diffOre
            }
          }
          // Calc diff km bord (pentru utilaje cu km_la_alimentare populat)
          if (a.km_la_alimentare != null && prev.km_la_alimentare != null) {
            const diffKm = Number(a.km_la_alimentare) - Number(prev.km_la_alimentare)
            if (diffKm > 5 && diffKm < 5000) {
              x.kmParcursi7z += diffKm
            }
          }
        }
        
        // Fallback: dacă există ore_lucrate_efectiv (introdus manual), îl iau ca backup
        // DOAR dacă nu am calculat încă din diff (utilaj cu 1 alim în 7z + ore_lucrate_efectiv vechi style)
        if (!prev && a.ore_lucrate_efectiv && Number(a.ore_lucrate_efectiv) > 0) {
          x.oreLucrate7z += Number(a.ore_lucrate_efectiv)
        }
      }
    })
    
    return Array.from(map.values()).map(x => {
      // Consum real - aleg unitatea care se potrivește cu norma
      let consumReal = null
      if (x.unitateNorma === 'l/100km' && x.kmParcursi7z > 0) {
        consumReal = x.litri7z * 100 / x.kmParcursi7z
      } else if (x.oreLucrate7z > 0) {
        // Default: l/h sau kWh/h
        consumReal = x.litri7z / x.oreLucrate7z
      }
      let stareConsum = null  // null | 'ok' | 'warning' | 'critic'
      let abaterePct = null
      if (consumReal !== null && x.norma) {
        abaterePct = ((consumReal - x.norma) / x.norma) * 100
        if (abaterePct > x.pragAlerta * 2) stareConsum = 'critic'
        else if (abaterePct > x.pragAlerta) stareConsum = 'warning'
        else stareConsum = 'ok'
      }
      return { ...x, consumReal, abaterePct, stareConsum }
    }).sort((a, b) => {
      // Sortare: critic > warning > ok > fără date, apoi descrescător după consum
      const order = { critic: 0, warning: 1, ok: 2, null: 3 }
      const oa = order[a.stareConsum] ?? 3
      const ob = order[b.stareConsum] ?? 3
      if (oa !== ob) return oa - ob
      return b.totalLitri - a.totalLitri
    })
  }, [filtered])
  
  // Delete individual (admin only)
  const handleDelete = async (alim) => {
    if (!isAdmin) { showToast('Doar admin poate șterge', 'error'); return }
    const av = alim.logistica_active
    const desc = `${av?.marca || ''} ${av?.model || ''} · ${alim.cantitate_litri}L · ${fmtDate(alim.data_alimentare)}`
    if (!confirm(`Sigur vrei să ștergi alimentarea:\n${desc}?\n\nAceastă acțiune e ireversibilă!`)) return
    
    const { error } = await supabase.from('logistica_alimentari').delete().eq('id', alim.id)
    if (error) { showToast('Eroare: ' + error.message, 'error'); return }
    showToast(`✓ Alimentare ștearsă`)
    loadArhiva()
  }
  
  // Helper: construiește row Excel din alimentare
  const _alimToRow = (a) => {
    const av = a.logistica_active || {}
    return {
      'Data': a.data_alimentare,
      'Cod intern': av.cod_intern || '',
      'Plăcuță': av.nr_inmatriculare || '',
      'Marcă': av.marca || '',
      'Model': av.model || '',
      'Tip': av.logistica_categorii?.tip || '',
      'Cantitate (L)': Number(a.cantitate_litri || 0),
      'Sursă': a.statie_combustibil || '',
      'Șantier': a.sites?.name || '',
      'Ore bord': a.ore_la_alimentare || '',
      'Ore lucrate efectiv': a.ore_lucrate_efectiv || '',
      'Km bord': a.km_la_alimentare || '',
      'Preț/L (RON)': Number(a.pret_per_litru || 0),
      'Total (RON)': Number(a.pret_total || 0),
      'Înregistrat de': a.profile_creator?.name || '',
    }
  }
  
  // Sanitize sheet name pentru Excel (max 31 chars, fără [ ] : * ? / \)
  const _sanitizeSheetName = (s) => (s || 'Sheet').replace(/[\[\]:*?\/\\]/g, '_').substring(0, 31)
  
  // Export pe toate șantierele (1 fișier cu sheet per șantier)
  const handleExportPerSantier = () => {
    setExportingExcel(true)
    try {
      const wb = XLSX.utils.book_new()
      aggSantier.forEach(s => {
        if (s.rows.length === 0) return
        const rows = s.rows.map(_alimToRow)
        const ws = XLSX.utils.json_to_sheet(rows)
        const colWidths = Object.keys(rows[0] || {}).map(k => ({ wch: Math.max(k.length, 12) }))
        ws['!cols'] = colWidths
        XLSX.utils.book_append_sheet(wb, ws, _sanitizeSheetName(s.siteName))
      })
      const filename = `Aliment_Per_Santier_${new Date().toISOString().split('T')[0]}.xlsx`
      XLSX.writeFile(wb, filename)
      showToast(`✓ Export pe ${aggSantier.length} șantiere`)
    } catch (e) {
      showToast('Eroare export: ' + (e.message || e), 'error')
    } finally {
      setExportingExcel(false)
    }
  }
  
  // Export pentru un singur șantier
  const handleExportSantier = (siteName) => {
    const s = aggSantier.find(x => x.siteName === siteName)
    if (!s || s.rows.length === 0) { showToast('Nimic de exportat', 'warn'); return }
    try {
      const rows = s.rows.map(_alimToRow)
      const ws = XLSX.utils.json_to_sheet(rows)
      const wb = XLSX.utils.book_new()
      const colWidths = Object.keys(rows[0] || {}).map(k => ({ wch: Math.max(k.length, 12) }))
      ws['!cols'] = colWidths
      XLSX.utils.book_append_sheet(wb, ws, _sanitizeSheetName(siteName))
      const filename = `Aliment_${_sanitizeSheetName(siteName)}_${new Date().toISOString().split('T')[0]}.xlsx`
      XLSX.writeFile(wb, filename)
      showToast(`✓ Export: ${s.rows.length} alimentări`)
    } catch (e) {
      showToast('Eroare export: ' + (e.message || e), 'error')
    }
  }
  
  // Export pe utilaje (sumar + alertă consum)
  const handleExportUtilaje = () => {
    setExportingExcel(true)
    try {
      const rows = aggUtilaj.map(u => ({
        'Cod intern': u.cod,
        'Plăcuță': u.inmatriculare,
        'Marcă': u.marca,
        'Model': u.model,
        'Tip': u.tip,
        'Nr alimentări (perioadă)': u.nrAlim,
        'Total litri (perioadă)': u.totalLitri.toFixed(2),
        'Total cost RON (perioadă)': u.totalCost.toFixed(2),
        'Litri ult. 7 zile': u.litri7z.toFixed(2),
        'Ore lucrate ult. 7 zile': u.oreLucrate7z.toFixed(2),
        'Consum real (l/h)': u.consumReal !== null ? u.consumReal.toFixed(2) : '—',
        'Normă (l/h)': u.norma !== null ? u.norma : '—',
        'Abatere %': u.abaterePct !== null ? u.abaterePct.toFixed(1) + '%' : '—',
        'Stare': u.stareConsum === 'critic' ? '🚨 CRITIC' : u.stareConsum === 'warning' ? '⚠️ WARNING' : u.stareConsum === 'ok' ? '✓ OK' : '— (date insuficiente)',
      }))
      const ws = XLSX.utils.json_to_sheet(rows)
      const wb = XLSX.utils.book_new()
      const colWidths = Object.keys(rows[0] || {}).map(k => ({ wch: Math.max(k.length, 14) }))
      ws['!cols'] = colWidths
      XLSX.utils.book_append_sheet(wb, ws, 'Utilaje')
      const filename = `Aliment_Per_Utilaj_${new Date().toISOString().split('T')[0]}.xlsx`
      XLSX.writeFile(wb, filename)
      showToast(`✓ Export: ${aggUtilaj.length} utilaje`)
    } catch (e) {
      showToast('Eroare export: ' + (e.message || e), 'error')
    } finally {
      setExportingExcel(false)
    }
  }
  
  // Export Excel
  const handleExportExcel = () => {
    setExportingExcel(true)
    try {
      const rows = filtered.map(a => {
        const av = a.logistica_active || {}
        return {
          'Data': a.data_alimentare,
          'Cod intern': av.cod_intern || '',
          'Plăcuță': av.nr_inmatriculare || '',
          'Marcă': av.marca || '',
          'Model': av.model || '',
          'Tip': av.logistica_categorii?.tip || '',
          'Cantitate (L)': Number(a.cantitate_litri || 0),
          'Sursă': a.statie_combustibil || '',
          'Șantier': a.sites?.name || '',
          'Ore bord': a.ore_la_alimentare || '',
          'Ore lucrate efectiv': a.ore_lucrate_efectiv || '',
          'Km bord': a.km_la_alimentare || '',
          'Preț/L (RON)': Number(a.pret_per_litru || 0),
          'Total (RON)': Number(a.pret_total || 0),
          'Înregistrat de': a.profile_creator?.name || '',
        }
      })
      
      const ws = XLSX.utils.json_to_sheet(rows)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Alimentări')
      
      // Auto-width coloane
      const colWidths = Object.keys(rows[0] || {}).map(k => ({ wch: Math.max(k.length, 12) }))
      ws['!cols'] = colWidths
      
      const filename = `Arhiva_Alimentari_${new Date().toISOString().split('T')[0]}.xlsx`
      XLSX.writeFile(wb, filename)
      showToast(`✓ Export reușit: ${filtered.length} rânduri`)
    } catch (e) {
      showToast('Eroare export: ' + (e.message || e), 'error')
    } finally {
      setExportingExcel(false)
    }
  }
  
  return (
    <div>
      {/* KPI sus */}
      <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 14}}>
        <div style={{...S.card, padding: '14px 16px', borderLeft: `3px solid ${G.purple}`}}>
          <div style={{fontSize: 11, color: G.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 4}}>📊 Alimentări</div>
          <div style={{fontSize: 24, fontWeight: 800, color: G.text, fontVariantNumeric: 'tabular-nums'}}>{kpi.total}</div>
        </div>
        <div style={{...S.card, padding: '14px 16px', borderLeft: `3px solid ${G.orange}`}}>
          <div style={{fontSize: 11, color: G.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 4}}>⛽ Total litri</div>
          <div style={{fontSize: 24, fontWeight: 800, color: G.orange, fontVariantNumeric: 'tabular-nums'}}>{kpi.totalLitri.toFixed(1)} <span style={{fontSize: 14, color: G.muted}}>L</span></div>
        </div>
        <div style={{...S.card, padding: '14px 16px', borderLeft: `3px solid ${G.green}`}}>
          <div style={{fontSize: 11, color: G.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 4}}>💰 Total cost</div>
          <div style={{fontSize: 24, fontWeight: 800, color: G.green, fontVariantNumeric: 'tabular-nums'}}>{kpi.totalCost.toLocaleString('ro-RO', {minimumFractionDigits: 2, maximumFractionDigits: 2})} <span style={{fontSize: 14, color: G.muted}}>RON</span></div>
        </div>
        <div style={{...S.card, padding: '14px 16px', borderLeft: `3px solid ${G.blue}`}}>
          <div style={{fontSize: 11, color: G.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 4}}>📈 Medie / alimentare</div>
          <div style={{fontSize: 24, fontWeight: 800, color: G.blue, fontVariantNumeric: 'tabular-nums'}}>{kpi.medieLitri.toFixed(1)} <span style={{fontSize: 14, color: G.muted}}>L</span></div>
        </div>
      </div>
      
      {/* View mode pills */}
      <div style={{display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center'}}>
        <span style={{fontSize: 11, color: G.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', marginRight: 4}}>VEDERE:</span>
        {[
          {key: 'toate', icon: '📋', label: 'Toate alimentările'},
          {key: 'santier', icon: '🏗️', label: 'Pe șantier'},
          {key: 'utilaj', icon: '🚜', label: 'Pe utilaj (consum real)'},
        ].map(v => (
          <button key={v.key} onClick={() => setViewMode(v.key)} style={{
            ...S.btnS, padding: '8px 14px', fontSize: 12, fontWeight: 700,
            background: viewMode === v.key ? G.purple + '22' : 'transparent',
            color: viewMode === v.key ? G.purple : G.text,
            borderColor: viewMode === v.key ? G.purple + '88' : G.border,
          }}>{v.icon} {v.label}</button>
        ))}
      </div>
      
      {/* Filtre + Search + Export */}
      <div style={{...S.card, padding: '14px 18px', marginBottom: 14}}>
        {/* Perioadă */}
        <div style={{display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12}}>
          <span style={{fontSize: 11, color: G.muted, fontWeight: 600, marginRight: 4}}>PERIOADĂ:</span>
          {[
            {key: 'azi', label: 'Azi'},
            {key: 'ieri', label: 'Ieri'},
            {key: 'sapt', label: '7 zile'},
            {key: 'luna', label: 'Luna curentă'},
            {key: '3luni', label: '3 luni'},
            {key: 'an', label: 'An'},
            {key: 'toate', label: 'Toate'},
            {key: 'custom', label: 'Custom'},
          ].map(p => (
            <button key={p.key} onClick={() => setPerioadaFilter(p.key)} style={{
              ...S.btnS, padding: '6px 12px', fontSize: 12, fontWeight: 600,
              background: perioadaFilter === p.key ? G.purple + '22' : 'transparent',
              color: perioadaFilter === p.key ? G.purple : G.muted,
              borderColor: perioadaFilter === p.key ? G.purple + '55' : G.border,
            }}>{p.label}</button>
          ))}
          {perioadaFilter === 'custom' && (
            <>
              <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} style={{...S.input, padding: '6px 10px', fontSize: 12, minWidth: 140}} />
              <span style={{color: G.muted, fontSize: 12}}>→</span>
              <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} style={{...S.input, padding: '6px 10px', fontSize: 12, minWidth: 140}} />
            </>
          )}
        </div>
        
        {/* Filtre tip + sursă + șantier + search */}
        <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr)) auto', gap: 8, alignItems: 'center'}}>
          <select value={tipFilter} onChange={e => setTipFilter(e.target.value)} style={{...S.input, padding: '7px 10px', fontSize: 12}}>
            <option value="Toate">Toate tipurile</option>
            {tipuriDisponibile.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={sursaFilter} onChange={e => setSursaFilter(e.target.value)} style={{...S.input, padding: '7px 10px', fontSize: 12}}>
            <option value="Toate">Toate sursele</option>
            {surseDisponibile.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={siteFilter} onChange={e => setSiteFilter(e.target.value)} style={{...S.input, padding: '7px 10px', fontSize: 12}}>
            <option value="Toate">Toate șantierele</option>
            {siteuriDisponibile.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <input type="text" placeholder="🔍 marcă, cod, plăcuță, șantier..." value={search} onChange={e => setSearch(e.target.value)} style={{...S.input, padding: '7px 12px', fontSize: 12, gridColumn: 'span 1'}} />
          <button 
            onClick={handleExportExcel} 
            disabled={exportingExcel || filtered.length === 0} 
            style={{...S.btnP, padding: '7px 16px', fontSize: 12, background: G.green, opacity: (exportingExcel || filtered.length === 0) ? .5 : 1, cursor: (exportingExcel || filtered.length === 0) ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap'}}
          >
            {exportingExcel ? '⏳ Export...' : `📊 Excel (${filtered.length})`}
          </button>
        </div>
      </div>
      
      {/* Tabel — render condițional bazat pe viewMode */}
      {loading ? (
        <div style={{...S.card, padding: 30, textAlign: 'center', color: G.muted, fontSize: 13}}>⏳ Se încarcă...</div>
      ) : filtered.length === 0 ? (
        <div style={{...S.card, padding: 30, textAlign: 'center', color: G.muted, fontSize: 13}}>
          Nicio alimentare găsită cu filtrele curente.
        </div>
      ) : viewMode === 'santier' ? (
        <div>
          {/* Buton export global per șantier */}
          <div style={{marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
            <div style={{fontSize: 13, color: G.muted}}>
              <strong style={{color: G.text}}>{aggSantier.length}</strong> șantiere · sortate descrescător după consum total
            </div>
            <button onClick={handleExportPerSantier} disabled={exportingExcel || aggSantier.length === 0} style={{...S.btnP, background: G.green, padding: '7px 16px', fontSize: 12, opacity: (exportingExcel || aggSantier.length === 0) ? .5 : 1}}>
              {exportingExcel ? '⏳ Export...' : `📊 Export Excel (sheet/șantier)`}
            </button>
          </div>
          <div style={{...S.card, padding: 0, overflow: 'hidden'}}>
            <div style={{overflowX: 'auto'}}>
              <table style={{width: '100%', borderCollapse: 'collapse', fontSize: 13}}>
                <thead>
                  <tr style={{background: G.surface, borderBottom: `2px solid ${G.border}`}}>
                    <th style={thStyleAlim}>Șantier</th>
                    <th style={{...thStyleAlim, textAlign: 'right'}}>Nr alim.</th>
                    <th style={{...thStyleAlim, textAlign: 'right'}}>Utilaje</th>
                    <th style={{...thStyleAlim, textAlign: 'right'}}>Total litri</th>
                    <th style={{...thStyleAlim, textAlign: 'right'}}>Total cost</th>
                    <th style={{...thStyleAlim, textAlign: 'right'}}>% din total</th>
                    <th style={{...thStyleAlim, textAlign: 'center', width: 100}}>Export</th>
                  </tr>
                </thead>
                <tbody>
                  {aggSantier.map(s => (
                    <tr key={s.siteName} style={{borderBottom: `1px solid ${G.border}`}}>
                      <td style={{padding: '10px 12px', fontWeight: 700, color: G.text}}>{s.siteName}</td>
                      <td style={{padding: '10px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: G.text}}>{s.nrAlim}</td>
                      <td style={{padding: '10px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: G.muted}}>{s.nrUtilaje}</td>
                      <td style={{padding: '10px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: G.orange, fontWeight: 700}}>{s.totalLitri.toFixed(1)} L</td>
                      <td style={{padding: '10px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: G.green, fontWeight: 600}}>{s.totalCost.toLocaleString('ro-RO', {minimumFractionDigits: 2, maximumFractionDigits: 2})} RON</td>
                      <td style={{padding: '10px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: G.purple, fontWeight: 600}}>{s.procent.toFixed(1)}%</td>
                      <td style={{padding: '10px 12px', textAlign: 'center'}}>
                        <button onClick={() => handleExportSantier(s.siteName)} style={{...S.btnS, padding: '4px 10px', fontSize: 11, color: G.green, borderColor: G.green + '55'}} title={`Export Excel pentru ${s.siteName}`}>
                          📊
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : viewMode === 'utilaj' ? (
        <div>
          {/* Buton export utilaje + notă consum */}
          <div style={{marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8}}>
            <div style={{fontSize: 12, color: G.muted}}>
              <strong style={{color: G.text}}>{aggUtilaj.length}</strong> utilaje · consumul real e calculat pe <strong style={{color: G.text}}>ultimele 7 zile</strong> din perioada selectată. Sortat: critic → warning → ok → date insuficiente.
            </div>
            <button onClick={handleExportUtilaje} disabled={exportingExcel || aggUtilaj.length === 0} style={{...S.btnP, background: G.green, padding: '7px 16px', fontSize: 12, opacity: (exportingExcel || aggUtilaj.length === 0) ? .5 : 1}}>
              {exportingExcel ? '⏳ Export...' : `📊 Export Excel`}
            </button>
          </div>
          <div style={{...S.card, padding: 0, overflow: 'hidden'}}>
            <div style={{overflowX: 'auto'}}>
              <table style={{width: '100%', borderCollapse: 'collapse', fontSize: 12}}>
                <thead>
                  <tr style={{background: G.surface, borderBottom: `2px solid ${G.border}`}}>
                    <th style={thStyleAlim}>Utilaj</th>
                    <th style={{...thStyleAlim, textAlign: 'right'}}>Nr alim.</th>
                    <th style={{...thStyleAlim, textAlign: 'right'}}>Total litri</th>
                    <th style={{...thStyleAlim, textAlign: 'right'}}>Total cost</th>
                    <th style={{...thStyleAlim, textAlign: 'right'}}>Litri 7z</th>
                    <th style={{...thStyleAlim, textAlign: 'right'}}>Ore lucrate 7z</th>
                    <th style={{...thStyleAlim, textAlign: 'right'}}>Consum real</th>
                    <th style={{...thStyleAlim, textAlign: 'right'}}>Normă</th>
                    <th style={{...thStyleAlim, textAlign: 'center'}}>Stare</th>
                  </tr>
                </thead>
                <tbody>
                  {aggUtilaj.map(u => {
                    const stareColor = u.stareConsum === 'critic' ? G.red : u.stareConsum === 'warning' ? G.orange : u.stareConsum === 'ok' ? G.green : G.muted
                    const stareLabel = u.stareConsum === 'critic' ? '🚨 Critic' : u.stareConsum === 'warning' ? '⚠️ Warning' : u.stareConsum === 'ok' ? '✓ OK' : '— Date insuf.'
                    return (
                      <tr key={u.activId} style={{borderBottom: `1px solid ${G.border}`, background: u.stareConsum === 'critic' ? G.red + '0D' : u.stareConsum === 'warning' ? G.orange + '0D' : 'transparent'}}>
                        <td style={{padding: '8px 12px'}}>
                          <div style={{fontWeight: 600, color: G.text}}>{u.marca} {u.model?.substring(0, 25)}{u.model?.length > 25 ? '...' : ''}</div>
                          <div style={{fontSize: 10, color: G.muted, marginTop: 2}}>
                            {u.cod && <span style={{color: G.logistica, fontFamily: 'monospace'}}>{u.cod}</span>}
                            {u.inmatriculare && <span style={{color: G.blue, fontFamily: 'monospace', marginLeft: 6}}>{u.inmatriculare}</span>}
                          </div>
                        </td>
                        <td style={{padding: '8px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: G.text}}>{u.nrAlim}</td>
                        <td style={{padding: '8px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: G.orange, fontWeight: 700}}>{u.totalLitri.toFixed(1)} L</td>
                        <td style={{padding: '8px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: G.green}}>{u.totalCost.toFixed(0)} RON</td>
                        <td style={{padding: '8px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: G.muted}}>{u.litri7z.toFixed(1)}</td>
                        <td style={{padding: '8px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: G.muted}}>{u.oreLucrate7z > 0 ? u.oreLucrate7z.toFixed(1) : '—'}</td>
                        <td style={{padding: '8px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: stareColor, fontWeight: 700}}>
                          {u.consumReal !== null ? `${u.consumReal.toFixed(2)} ${u.unitateNorma}` : '—'}
                        </td>
                        <td style={{padding: '8px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: G.muted}}>{u.norma !== null ? `${u.norma} ${u.unitateNorma}` : '—'}</td>
                        <td style={{padding: '8px 12px', textAlign: 'center'}}>
                          <span style={{display: 'inline-block', padding: '3px 8px', borderRadius: 12, fontSize: 10, fontWeight: 700, background: stareColor + '22', color: stareColor, border: `1px solid ${stareColor}55`, whiteSpace: 'nowrap'}}>
                            {stareLabel}
                          </span>
                          {u.abaterePct !== null && u.stareConsum !== 'ok' && (
                            <div style={{fontSize: 10, color: stareColor, marginTop: 3, fontWeight: 700, fontVariantNumeric: 'tabular-nums'}}>
                              {u.abaterePct > 0 ? '+' : ''}{u.abaterePct.toFixed(1)}%
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div style={{...S.card, padding: 0, overflow: 'hidden'}}>
          <div style={{overflowX: 'auto'}}>
            <table style={{width: '100%', borderCollapse: 'collapse', fontSize: 12}}>
              <thead>
                <tr style={{background: G.surface, borderBottom: `2px solid ${G.border}`}}>
                  <th style={thStyleAlim}>Data</th>
                  <th style={thStyleAlim}>Utilaj</th>
                  <th style={{...thStyleAlim, textAlign: 'right'}}>Cantitate</th>
                  <th style={thStyleAlim}>Sursa</th>
                  <th style={thStyleAlim}>Șantier</th>
                  <th style={{...thStyleAlim, textAlign: 'right'}}>Ore bord</th>
                  <th style={{...thStyleAlim, textAlign: 'right'}}>Cost</th>
                  <th style={thStyleAlim}>Cine</th>
                  <th style={{...thStyleAlim, textAlign: 'center', width: 100}}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(a => {
                  const av = a.logistica_active || {}
                  return (
                    <tr key={a.id} style={{borderBottom: `1px solid ${G.border}`}}>
                      <td style={{padding: '8px 12px', fontFamily: 'monospace', color: G.text, fontWeight: 600}}>{fmtDate(a.data_alimentare)}</td>
                      <td style={{padding: '8px 12px'}}>
                        <div style={{fontWeight: 600, color: G.text}}>{av.marca} {av.model?.substring(0, 30)}{av.model?.length > 30 ? '...' : ''}</div>
                        <div style={{fontSize: 10, color: G.muted, marginTop: 2}}>
                          {av.cod_intern && <span style={{color: G.logistica, fontFamily: 'monospace'}}>{av.cod_intern}</span>}
                          {av.nr_inmatriculare && <span style={{color: G.blue, fontFamily: 'monospace', marginLeft: 6}}>{av.nr_inmatriculare}</span>}
                        </div>
                      </td>
                      <td style={{padding: '8px 12px', textAlign: 'right', color: G.orange, fontWeight: 700, fontVariantNumeric: 'tabular-nums'}}>
                        {Number(a.cantitate_litri).toFixed(1)} L
                      </td>
                      <td style={{padding: '8px 12px', color: isStatieGazpet(a.statie_combustibil) ? G.logistica : G.text, fontWeight: isStatieGazpet(a.statie_combustibil) ? 600 : 400}}>
                        {a.statie_combustibil || '—'}
                      </td>
                      <td style={{padding: '8px 12px', color: G.text}}>{a.sites?.name || '—'}</td>
                      <td style={{padding: '8px 12px', textAlign: 'right', fontFamily: 'monospace', color: G.muted, fontVariantNumeric: 'tabular-nums'}}>
                        {a.ore_la_alimentare ?? '—'}
                      </td>
                      <td style={{padding: '8px 12px', textAlign: 'right', color: a.pret_total ? G.green : G.muted, fontWeight: 600, fontVariantNumeric: 'tabular-nums'}}>
                        {a.pret_total ? `${Number(a.pret_total).toFixed(2)} RON` : '—'}
                      </td>
                      <td style={{padding: '8px 12px', color: G.muted, fontSize: 11}}>{a.profile_creator?.name?.split(' ')[0] || '—'}</td>
                      <td style={{padding: '8px 12px', textAlign: 'center', display: 'flex', gap: 4, justifyContent: 'center'}}>
                        {isAdmin && (
                          <>
                            <button onClick={() => setEditAlim(a)} style={{...S.btnS, padding: '4px 8px', fontSize: 11, color: G.logistica, borderColor: G.logistica + '55'}} title="Editează">
                              ✏️
                            </button>
                            <button onClick={() => handleDelete(a)} style={{...S.btnS, padding: '4px 8px', fontSize: 11, color: G.red, borderColor: G.red + '55'}} title="Șterge">
                              🗑️
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      
      {/* Modal edit (reutilizat din AlimentariBulkPage) */}
      {editAlim && (
        <EditAlimentareModal 
          alim={editAlim}
          sites={sites}
          rezervoare={rezervoare}
          pretMotorina={pretMotorina}
          onClose={() => setEditAlim(null)}
          onSaved={() => { setEditAlim(null); loadArhiva() }}
          showToast={showToast}
        />
      )}
    </div>
  )
}

const thStyleAlim = { padding: '10px 12px', textAlign: 'left', color: '#8B949E', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.4px' }



// ─── Etapa 8.5: Buton Alerte Globale + Sidebar lateral ──────────────────────
function AlerteGlobalButton({ alerte, onClick }) {
  const critice = alerte.filter(a => a.nivel === 'critic').length
  const urgente = alerte.filter(a => a.nivel === 'urgent').length
  const aproape = alerte.filter(a => a.nivel === 'aproape').length
  const total = alerte.length
  
  if (total === 0) {
    return (
      <button onClick={onClick} style={{
        background: G.green + '15',
        border: `1px solid ${G.green}55`,
        borderRadius: 8,
        padding: '7px 14px',
        fontSize: 12,
        color: G.green,
        fontWeight: 700,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}>
        ✓ Fără alerte
      </button>
    )
  }
  
  const color = critice > 0 ? G.red : urgente > 0 ? G.orange : G.yellow
  const icon = critice > 0 ? '🚨' : urgente > 0 ? '⚠️' : '🔔'
  
  return (
    <button onClick={onClick} style={{
      background: color + '22',
      border: `1px solid ${color}`,
      borderRadius: 8,
      padding: '7px 14px',
      fontSize: 12,
      color: G.text,
      fontWeight: 800,
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      animation: critice > 0 ? 'pulseAlerta 2s infinite' : 'none',
    }}>
      <span style={{fontSize: 14}}>{icon}</span>
      <span>Alerte</span>
      <span style={{
        background: color,
        color: '#0D1117',
        padding: '1px 7px',
        borderRadius: 10,
        fontSize: 11,
        fontWeight: 900,
        minWidth: 20,
        textAlign: 'center',
      }}>{total}</span>
      <style>{`@keyframes pulseAlerta { 0%, 100% { opacity: 1 } 50% { opacity: 0.7 } }`}</style>
    </button>
  )
}

function AlerteGlobaleSidebar({ open, onClose, alerte, onNavigate }) {
  if (!open) return null
  
  // Grupare pe nivel
  const grupate = {
    critic: alerte.filter(a => a.nivel === 'critic'),
    urgent: alerte.filter(a => a.nivel === 'urgent'),
    aproape: alerte.filter(a => a.nivel === 'aproape'),
  }
  
  const colorByNivel = { critic: G.red, urgent: G.orange, aproape: G.yellow }
  const iconByNivel = { critic: '🚨', urgent: '⚠️', aproape: '🔔' }
  const labelByNivel = { critic: 'CRITIC — Acțiune imediată', urgent: 'URGENT — Săptămâna asta', aproape: 'APROAPE — Săptămâna viitoare' }
  
  return (
    <>
      <div 
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.5)',
          zIndex: 200,
        }}
      />
      <div style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width: 'min(480px, 100vw)',
        background: G.bg,
        borderLeft: `1px solid ${G.border}`,
        zIndex: 201,
        overflowY: 'auto',
        padding: '20px 22px',
        boxShadow: '-8px 0 32px rgba(0,0,0,0.5)',
      }}>
        {/* Header */}
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, paddingBottom: 12, borderBottom: `1px solid ${G.border}`}}>
          <div>
            <div style={{fontSize: 18, fontWeight: 800, color: G.text}}>🔔 Alerte Logistică</div>
            <div style={{fontSize: 12, color: G.muted, marginTop: 2}}>
              {alerte.length} total · {grupate.critic.length} critice · {grupate.urgent.length} urgente · {grupate.aproape.length} aproape
            </div>
          </div>
          <button onClick={onClose} style={{background: 'transparent', border: 'none', color: G.muted, fontSize: 24, cursor: 'pointer'}}>×</button>
        </div>
        
        {alerte.length === 0 ? (
          <div style={{textAlign: 'center', padding: 40, color: G.muted}}>
            <div style={{fontSize: 48, marginBottom: 12}}>✓</div>
            <div style={{fontSize: 14, fontWeight: 700, color: G.green, marginBottom: 4}}>Toate la zi!</div>
            <div style={{fontSize: 12}}>Nicio alertă activă în Logistică</div>
          </div>
        ) : (
          ['critic', 'urgent', 'aproape'].map(nivel => grupate[nivel].length > 0 && (
            <div key={nivel} style={{marginBottom: 18}}>
              <div style={{
                fontSize: 11,
                fontWeight: 800,
                color: colorByNivel[nivel],
                textTransform: 'uppercase',
                letterSpacing: '.6px',
                marginBottom: 8,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}>
                <span style={{fontSize: 14}}>{iconByNivel[nivel]}</span>
                {labelByNivel[nivel]} ({grupate[nivel].length})
              </div>
              {grupate[nivel].map((a, idx) => (
                <div 
                  key={`${a.tip}-${a.asset_id}-${idx}`}
                  onClick={() => {
                    if ((a.tip === 'revizie_km' || a.tip === 'revizie_data') && a.asset_id) onNavigate('service', a.asset_id)
                    else if (a.tip === 'telemetrie_veche') onNavigate('alimentari', null)
                  }}
                  style={{
                    padding: '10px 12px',
                    background: G.surface,
                    border: `1px solid ${colorByNivel[nivel]}55`,
                    borderLeft: `3px solid ${colorByNivel[nivel]}`,
                    borderRadius: 8,
                    marginBottom: 6,
                    cursor: 'pointer',
                    transition: 'background .15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = G.border}
                  onMouseLeave={e => e.currentTarget.style.background = G.surface}
                >
                  <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8}}>
                    <div style={{flex: 1, minWidth: 0}}>
                      {a.tip === 'revizie_km' && (
                        <>
                          <div style={{fontSize: 13, fontWeight: 700, color: G.text, marginBottom: 2}}>
                            🔧 {a.marca} {a.model}
                          </div>
                          <div style={{fontSize: 11, color: G.muted, fontFamily: 'monospace'}}>
                            {a.nr_inmatriculare}
                          </div>
                        </>
                      )}
                      {a.tip === 'revizie_data' && (
                        <>
                          <div style={{fontSize: 13, fontWeight: 700, color: G.text, marginBottom: 2}}>
                            📅 {a.marca} {a.model || ''}
                          </div>
                          <div style={{fontSize: 11, color: G.muted, fontFamily: a.nr_inmatriculare ? 'monospace' : 'inherit'}}>
                            {a.nr_inmatriculare || 'Utilaj (fără număr înmatriculare)'}
                          </div>
                        </>
                      )}
                      {a.tip === 'telemetrie_veche' && (
                        <>
                          <div style={{fontSize: 13, fontWeight: 700, color: G.text, marginBottom: 2}}>
                            📡 Telemetrie EvoGPS veche
                          </div>
                          <div style={{fontSize: 11, color: G.muted}}>
                            {a.mesaj}
                          </div>
                        </>
                      )}
                    </div>
                    <div style={{textAlign: 'right', whiteSpace: 'nowrap'}}>
                      {a.tip === 'revizie_km' && (
                        <>
                          <div style={{fontSize: 14, fontWeight: 800, color: colorByNivel[nivel]}}>
                            {Number(a.km_ramase).toLocaleString('ro-RO')} km
                          </div>
                          <div style={{fontSize: 10, color: G.muted}}>până la revizie</div>
                        </>
                      )}
                      {a.tip === 'revizie_data' && (
                        <>
                          <div style={{fontSize: 14, fontWeight: 800, color: colorByNivel[nivel]}}>
                            {a.km_ramase} {a.km_ramase === 1 ? 'zi' : 'zile'}
                          </div>
                          <div style={{fontSize: 10, color: G.muted}}>până la revizie</div>
                        </>
                      )}
                      {a.tip === 'telemetrie_veche' && (
                        <div style={{fontSize: 14, fontWeight: 800, color: colorByNivel[nivel]}}>
                          {a.km_ramase} zile
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ))
        )}
        
        <div style={{marginTop: 24, padding: 12, background: G.surface, border: `1px solid ${G.border}`, borderRadius: 8, fontSize: 11, color: G.muted}}>
          💡 <strong style={{color: G.text}}>Cum funcționează:</strong> alertele se actualizează automat după fiecare import EvoGPS sau service finalizat. Click pe alertă pentru a deschide modulul respectiv.
        </div>
      </div>
    </>
  )
}


export default function LogisticaPage() {
  const nav = useNavigate()
  const loc = useLocation()
  const [profile, setProfile] = useState(null)
  const [accessLevel, setAccessLevel] = useState(undefined)
  const [active, setActive] = useState([])
  const [categorii, setCategorii] = useState([])
  const [kpi, setKpi] = useState(null)
  const [kpiAlim, setKpiAlim] = useState(null)
  const [load, setLoad] = useState(true)
  const [search, setSearch] = useState('')
  const [tipF, setTipF] = useState('Toate')
  const [subF, setSubF] = useState('Toate')
  const [stareF, setStareF] = useState('Toate')
  const [sortBy, setSortBy] = useState({ col: 'marca', dir: 'asc' })  // sortare tabel
  const [modal, setModal] = useState(null)
  const [rezervoare, setRezervoare] = useState([])         // [Gazpet - Oscar 1, Gazpet - Oscar 2]
  const [sites, setSites] = useState([])                  // pentru alocare alimentare pe șantier
  const [pretMotorina, setPretMotorina] = useState(null) // preț curent
  const [pretMotorinaActualizat, setPretMotorinaActualizat] = useState(null)
  const [showAchizitie, setShowAchizitie] = useState(null) // null | obiect rezervor (Oscar 1/2)
  const [showEditStoc, setShowEditStoc] = useState(null)   // null | obiect rezervor
  const [showSetariPret, setShowSetariPret] = useState(false)
  const [alerteTransp, setAlerteTransp] = useState([])     // transporturi cu status='cerut'
  const [transpBlocate, setTranspBlocate] = useState([])   // aprobate sau in_tranzit cu data depășită
  const [kpiTransp, setKpiTransp] = useState({ cerute: 0, aprobate: 0, inTranzit: 0, livrate: 0 })  // KPI transporturi luna curentă
  const [sugestiiPendente, setSugestiiPendente] = useState(0)  // ETAPA 12.8: count sugestii Scorilos pentru badge tab
  const [tab, setTab] = useState(() => {
    const params = new URLSearchParams(loc.search)
    const t = params.get('tab')
    const valid = ['lista','alimentari','documente','service','tichete','transporturi','arhiva','arhiva_alimentari','bot-sugestii']
    return valid.includes(t) ? t : 'lista'
  })  // 'lista' | 'alimentari' | 'documente' | 'service' | 'tichete' | 'transporturi' | 'arhiva'
  const [dataAlim, setDataAlim] = useState(new Date().toISOString().split('T')[0]) // pt tab Alimentări
  const [ultimeAlim, setUltimeAlim] = useState({})           // map active_id → ultima alimentare
  const [toast, showToast] = useToast()
  const [showImportEvo, setShowImportEvo] = useState(null) // null | 'masini' | 'utilaje'
  const [showImportRompetrol, setShowImportRompetrol] = useState(false) // 24.05.2026: modal import Rompetrol
  // Etapa 8.5: Alerte globale + ultima telemetrie (pentru banner Alimentări)
  const [ultimaTelemetrieData, setUltimaTelemetrieData] = useState(null)
  const [istoricImporturi, setIstoricImporturi] = useState([])  // ETAPA 8.6: history importuri EvoGPS
  
  const loadIstoricImporturi = useCallback(async () => {
    // Grupez perioadele importate: pentru fiecare „sesiune" (raw_data.file + imported_at trunchiat la oră),
    // afișez min-max data, vehicule unice, total înregistrări
    // Fix 22.05.2026: scos .catch() (TypeError - PostgrestBuilder nu are .catch). RPC există acum în BD.
    const { data, error } = await supabase.rpc('get_istoric_importuri_evogps')
    if (error) {
      // Fallback: query direct (mai lent dar nu necesită funcție SQL)
      const { data: rows } = await supabase
        .from('logistica_telemetrie_zilnica')
        .select('asset_id, data, raw_data, created_at')
        .eq('sursa', 'evogps')
        .order('created_at', { ascending: false })
        .limit(5000)
      if (!rows) return setIstoricImporturi([])
      // Grupez în JS pe (file, imported_at trunchiat la minut)
      const groups = new Map()
      for (const r of rows) {
        const file = r.raw_data?.file || '?'
        const importedAt = r.raw_data?.imported_at?.slice(0, 16) || r.created_at?.slice(0, 16) || '?'
        const key = `${file}|${importedAt}`
        if (!groups.has(key)) groups.set(key, { file, importedAt, dates: new Set(), assets: new Set(), count: 0 })
        const g = groups.get(key)
        g.dates.add(r.data)
        g.assets.add(r.asset_id)
        g.count++
      }
      const list = Array.from(groups.values()).map(g => {
        const datesArr = Array.from(g.dates).sort()
        return {
          file_name: g.file,
          imported_at: g.importedAt,
          prima_zi: datesArr[0],
          ultima_zi: datesArr[datesArr.length - 1],
          vehicule: g.assets.size,
          inregistrari: g.count,
        }
      }).sort((a, b) => b.imported_at.localeCompare(a.imported_at)).slice(0, 10)
      setIstoricImporturi(list)
    } else {
      setIstoricImporturi(data || [])
    }
  }, [])
  const [alerteGlobale, setAlerteGlobale] = useState([])
  const [showAlerte, setShowAlerte] = useState(false)
  
  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setAccessLevel(null); return }
      const [{ data: prof }, { data: access }] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user.id).single(),
        supabase.from('user_module_access').select('access_level').eq('profile_id', user.id).eq('module', 'logistica').maybeSingle()
      ])
      setProfile(prof)
      if (prof?.role === 'superadmin') setAccessLevel('admin')
      else setAccessLevel(access?.access_level || null)
    }
    init()
  }, [])
  
  useEffect(() => { if (accessLevel) loadAll() }, [accessLevel])
  
  // Etapa 8.5: Auto-load ultima telemetrie + alerte globale
  useEffect(() => {
    if (!accessLevel) return
    // Ultima dată telemetrie
    supabase.from('logistica_telemetrie_zilnica')
      .select('data')
      .order('data', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => { setUltimaTelemetrieData(data?.data || null) })
    // ETAPA 8.6: istoric importuri EvoGPS (per file + imported_at)
    loadIstoricImporturi()
    // Alerte globale (revizii < 1500km + telemetrie veche)
    supabase.from('v_logistica_alerte_globale')
      .select('*')
      .order('nivel')
      .order('km_ramase')
      .then(({ data }) => { setAlerteGlobale(data || []) })
  }, [accessLevel])
  
  // Sincronizez tab cu URL când se schimbă search-ul (ex: navigare din butonul global)
  useEffect(() => {
    const params = new URLSearchParams(loc.search)
    const t = params.get('tab')
    const valid = ['lista','alimentari','documente','service','tichete','transporturi','arhiva','arhiva_alimentari','bot-sugestii']
    if (t && valid.includes(t) && t !== tab) setTab(t)
  }, [loc.search])
  
  // ETAPA 12.8: încarc numărul de sugestii Scorilos pendente pentru badge tab (doar owner)
  // FIX 24.05.2026: filtru tinta_tip='logistica_active' ca să NU mai apară HR Chuck
  const loadSugestiiPendenteCount = useCallback(async () => {
    if (!profile?.is_owner) { setSugestiiPendente(0); return }
    const { count } = await supabase
      .from('claude_bot_sugestii')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'propus')
      .eq('tinta_tip', 'logistica_active')
    setSugestiiPendente(count || 0)
  }, [profile?.is_owner])
  
  useEffect(() => { loadSugestiiPendenteCount() }, [loadSugestiiPendenteCount])
  
  
  
  const loadAll = async () => {
    setLoad(true)
    // Calcul start luna curentă pentru KPI transporturi
    const ymStart = new Date()
    ymStart.setDate(1); ymStart.setHours(0, 0, 0, 0)
    const ymStartISO = ymStart.toISOString().split('T')[0]
    // Calcul azi + ieri pentru detectare transporturi blocate
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayISO = today.toISOString().split('T')[0]
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayISO = yesterday.toISOString().split('T')[0]
    
    const [activeRes, catRes, kpiRes, rezRes, sitesRes, setariRes, kpiAlimRes, ultimeRes, transpRes, transpKpiRes, transpBlocRes] = await Promise.all([
      supabase.from('logistica_active')
        .select('*, logistica_categorii(tip, subcategorie), logistica_mentenanta_plan(urmatoarea_data, urmatoarea_ore)')
        .order('marca', { ascending: true }).order('model', { ascending: true }),
      supabase.from('logistica_categorii').select('*').order('tip').order('subcategorie'),
      supabase.from('v_kpi_logistica').select('*').single(),
      supabase.from('logistica_rezervoare').select('*').like('nume', 'Gazpet - Oscar%').order('nume'),
      supabase.from('sites').select('id, name').order('name'),
      supabase.from('logistica_setari').select('key, value').in('key', ['pret_motorina_ron', 'pret_motorina_actualizat']),
      supabase.from('v_alimentari_kpi').select('*').single(),
      supabase.from('v_alimentari_ultima').select('*'),
      supabase.from('logistica_transporturi')
        .select(`id, tip, data_transport, continut_descriere, status, created_at,
          activ_transportat:logistica_active!activ_transportat_id(cod_intern, marca, model),
          plecare_site:sites!plecare_site_id(name),
          destinatie_site:sites!destinatie_site_id(name),
          solicitant:profiles!solicitant_id(name)`)
        .eq('status', 'cerut')
        .order('created_at', { ascending: false })
        .limit(10),
      supabase.from('logistica_transporturi')
        .select('status')
        .gte('data_transport', ymStartISO),
      // Transporturi blocate: aprobate/programate cu data <= azi-1 SAU in_tranzit cu data <= azi-2
      // (în fetch luăm mai larg, filtrăm exact pe client)
      supabase.from('logistica_transporturi')
        .select(`id, tip, data_transport, continut_descriere, status,
          activ_transportat:logistica_active!activ_transportat_id(cod_intern, marca, model),
          plecare_site:sites!plecare_site_id(name),
          destinatie_site:sites!destinatie_site_id(name),
          solicitant:profiles!solicitant_id(name),
          sofer:profiles!sofer_id(name)`)
        .in('status', ['aprobat', 'programat', 'in_tranzit'])
        .lt('data_transport', todayISO)
        .order('data_transport', { ascending: true })
        .limit(30),
    ])
    setActive(activeRes.data || [])
    setCategorii(catRes.data || [])
    setKpi(kpiRes.data || null)
    setRezervoare(rezRes.data || [])
    setSites(sitesRes.data || [])
    const setariMap = Object.fromEntries((setariRes.data || []).map(s => [s.key, s.value]))
    setPretMotorina(setariMap.pret_motorina_ron || null)
    setPretMotorinaActualizat(setariMap.pret_motorina_actualizat || null)
    setKpiAlim(kpiAlimRes.data || null)
    setAlerteTransp(transpRes.data || [])
    // Calculez KPI transporturi luna curentă pe client
    const transpArr = transpKpiRes.data || []
    setKpiTransp({
      cerute: transpArr.filter(t => t.status === 'cerut').length,
      aprobate: transpArr.filter(t => t.status === 'aprobat' || t.status === 'programat').length,
      inTranzit: transpArr.filter(t => t.status === 'in_tranzit').length,
      livrate: transpArr.filter(t => t.status === 'livrat').length,
    })
    // Filtrez blocate strict pe client:
    // - aprobat/programat blocat: data_transport < azi (data plănuită a trecut, nu a plecat)
    // - in_tranzit blocat: data_transport < ieri (depășit cu 1+ zi termenul fără confirmare)
    const allBloc = transpBlocRes.data || []
    const blocate = allBloc.filter(t => {
      if (t.status === 'aprobat' || t.status === 'programat') return t.data_transport < todayISO
      if (t.status === 'in_tranzit') return t.data_transport < yesterdayISO
      return false
    })
    setTranspBlocate(blocate)
    // Map ultima alimentare per activ
    const map = {}
    ;(ultimeRes.data || []).forEach(u => { map[u.active_id] = u })
    setUltimeAlim(map)
    setLoad(false)
  }
  
  const handleSaved = () => { loadAll(); setModal(null) }
  
  // ─── Export Excel ──────────────────────────────────────────────────────────
  const exportExcel = () => {
    const header = ['Nr crt', 'Cod intern', 'Nr inventar', 'Plăcuță', 'Marcă', 'Model', 'Tip', 'Subcategorie', 'An', 'Stare', 'Carburant', 'Normă consum', 'Unitate', 'Firmă', 'Mentenanță următoare', 'Zile până la scadență', 'Observații']
    const rows = filtered.map((a, idx) => {
      const cat = a.logistica_categorii
      const ment = a.logistica_mentenanta_plan?.[0]
      const days = ment?.urmatoarea_data ? daysUntil(ment.urmatoarea_data) : null
      return [
        idx + 1,
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
      { wch: 6 }, { wch: 10 }, { wch: 12 }, { wch: 13 }, { wch: 16 }, { wch: 22 }, { wch: 15 }, { wch: 18 },
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
  const downloadTemplateAlimentari = async () => {
    // Load șantiere ACTIVE LIVE din BD (lista dinamică)
    const { data: sitesActive } = await supabase
      .from('sites')
      .select('id, name, beneficiar_principal')
      .eq('active', true)
      .order('name')
    
    const santierNames = (sitesActive || []).map(s => s.name)
    const statiiCombustibil = ['Petrom', 'OMV', 'Rompetrol', 'MOL', 'Lukoil', 'Socar', 'Gazpet - Oscar 1', 'Gazpet - Oscar 2']
    
    const dataAzi = new Date().toLocaleDateString('ro-RO')
    
    // ═══════════ SHEET 1: Alimentări (principal) ═══════════
    const aoa = [
      ['📋 Template Alimentări Combustibil — Gazpet Logistică'],
      ['Completați coloanele de mai jos. Coloana A trebuie să fie codul intern (TST...) sau plăcuța din ERP.'],
      [`Datele se importă apoi prin butonul "📤 Import Excel" din modul Logistică. ${santierNames.length} șantiere active actualizate ${dataAzi}.`],
      [],
      ['Cod intern SAU Plăcuță', 'Data alimentării (DD-MM-YYYY)', 'Cantitate (litri)', 'Ore bord la alim.', 'Km la alim.', 'Ore lucrate efectiv', 'Stație', 'Card combustibil', 'Cost total (RON)', 'Număr factură', 'Șantier'],
      ['TST094', '01-05-2026', 50.5, 1250, '', 8, 'Petrom', '7059-XXXX-1234', 380.50, 'F-2026-0123', santierNames[0] || 'Sediu - Gazpet Instal'],
      ['PH 99 GAZ', '03-05-2026', 40, '', 145000, 6, 'OMV', '7059-XXXX-5678', 305.00, '', santierNames[1] || ''],
    ]
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    
    // ─── Stiluri îmbunătățite (mai profi) ───
    const titleStyle = { 
      font: { bold: true, sz: 16, color: { rgb: 'E3B341' } },
      alignment: { horizontal: 'left', vertical: 'center' },
      fill: { fgColor: { rgb: '0D1117' } }
    }
    const noteStyle = { 
      font: { italic: true, sz: 10, color: { rgb: '8B949E' } },
      alignment: { horizontal: 'left', vertical: 'center' },
      fill: { fgColor: { rgb: '0D1117' } }
    }
    // Header: portocaliu Gazpet, text negru bold, border medium
    const headerStyle = {
      fill: { fgColor: { rgb: 'F0883E' } },
      font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 11, name: 'Calibri' },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
      border: { 
        top:    { style: 'medium', color: { rgb: '0D1117' } }, 
        bottom: { style: 'medium', color: { rgb: '0D1117' } }, 
        left:   { style: 'thin',   color: { rgb: '0D1117' } }, 
        right:  { style: 'thin',   color: { rgb: '0D1117' } } 
      }
    }
    // Header pentru coloana Șantier — culoare distinctă (verde) ca să iasă în evidență
    const headerSantierStyle = {
      ...headerStyle,
      fill: { fgColor: { rgb: '3FB950' } },
    }
    // Header pentru Stație — culoare distinctă (albastru) ca să iasă în evidență
    const headerStatieStyle = {
      ...headerStyle,
      fill: { fgColor: { rgb: '58A6FF' } },
    }
    const exampleStyle = { 
      fill: { fgColor: { rgb: 'FFFCE0' } }, 
      font: { italic: true, sz: 10, color: { rgb: '6E7681' } },
      alignment: { vertical: 'center', wrapText: true },
      border: {
        top:    { style: 'thin', color: { rgb: 'D0D7DE' } },
        bottom: { style: 'thin', color: { rgb: 'D0D7DE' } },
        left:   { style: 'thin', color: { rgb: 'D0D7DE' } },
        right:  { style: 'thin', color: { rgb: 'D0D7DE' } }
      }
    }
    
    if (ws['A1']) ws['A1'].s = titleStyle
    if (ws['A2']) ws['A2'].s = noteStyle
    if (ws['A3']) ws['A3'].s = noteStyle
    
    // Header row 5 (index 4): coloane A-K
    const headerCells = ['A5','B5','C5','D5','E5','F5','H5','I5','J5']  // toate cu portocaliu
    headerCells.forEach(a => { if (ws[a]) ws[a].s = headerStyle })
    if (ws['G5']) ws['G5'].s = headerStatieStyle   // Stație = albastru
    if (ws['K5']) ws['K5'].s = headerSantierStyle  // Șantier = verde
    
    // Style exemple (rândurile 6-7, indecșii 5-6)
    for (let r = 5; r <= 6; r++) {
      for (let c = 0; c < 11; c++) {
        const a = XLSX.utils.encode_cell({ r, c })
        if (ws[a]) ws[a].s = exampleStyle
      }
    }
    
    // Row heights (pentru cap de tabel mai aerisit)
    ws['!rows'] = [
      { hpt: 26 },  // titlu mai înalt
      { hpt: 16 },  // notă 1
      { hpt: 16 },  // notă 2
      { hpt: 8 },   // gol
      { hpt: 38 },  // header (înălțime pentru wrap text)
      { hpt: 22 },  // exemplu 1
      { hpt: 22 },  // exemplu 2
    ]
    
    // Column widths
    ws['!cols'] = [
      { wch: 22 }, { wch: 20 }, { wch: 14 }, { wch: 16 }, { wch: 14 },
      { wch: 16 }, { wch: 18 }, { wch: 20 }, { wch: 15 }, { wch: 16 }, { wch: 42 }
    ]
    
    ws['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 10 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 10 } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: 10 } },
    ]
    
    // Freeze top (header + titluri rămân vizibile la scroll)
    ws['!freeze'] = { xSplit: 0, ySplit: 5 }
    
    // ═══════════ SHEET 2: Șantiere Active (lookup vizibil) ═══════════
    const lookupsAoa = [
      ['📍 ȘANTIERE ACTIVE', '⛽ STAȚII COMBUSTIBIL'],
      [`(${santierNames.length} șantiere · actualizat ${dataAzi})`, `(${statiiCombustibil.length} stații + rezervoare Gazpet)`],
      [],
      ...Array.from({length: Math.max(santierNames.length, statiiCombustibil.length)}, (_, i) => [
        santierNames[i] || '',
        statiiCombustibil[i] || ''
      ])
    ]
    const wsLookups = XLSX.utils.aoa_to_sheet(lookupsAoa)
    
    const lookupHeaderStyle = {
      fill: { fgColor: { rgb: '161B22' } },
      font: { bold: true, sz: 12, color: { rgb: 'E3B341' } },
      alignment: { horizontal: 'left', vertical: 'center' },
    }
    const lookupNoteStyle = {
      font: { italic: true, sz: 9, color: { rgb: '8B949E' } },
    }
    const lookupSantierStyle = {
      fill: { fgColor: { rgb: 'EDFBEE' } },
      font: { sz: 10, color: { rgb: '0D1117' } },
      border: { top: { style: 'thin', color: { rgb: 'D0D7DE' } }, bottom: { style: 'thin', color: { rgb: 'D0D7DE' } } }
    }
    const lookupStatieStyle = {
      fill: { fgColor: { rgb: 'DDF4FF' } },
      font: { sz: 10, color: { rgb: '0D1117' } },
      border: { top: { style: 'thin', color: { rgb: 'D0D7DE' } }, bottom: { style: 'thin', color: { rgb: 'D0D7DE' } } }
    }
    
    if (wsLookups['A1']) wsLookups['A1'].s = lookupHeaderStyle
    if (wsLookups['B1']) wsLookups['B1'].s = lookupHeaderStyle
    if (wsLookups['A2']) wsLookups['A2'].s = lookupNoteStyle
    if (wsLookups['B2']) wsLookups['B2'].s = lookupNoteStyle
    
    // Style pentru rândurile cu date
    for (let i = 3; i < lookupsAoa.length; i++) {
      const aS = XLSX.utils.encode_cell({ r: i, c: 0 })
      const aSt = XLSX.utils.encode_cell({ r: i, c: 1 })
      if (wsLookups[aS] && wsLookups[aS].v) wsLookups[aS].s = lookupSantierStyle
      if (wsLookups[aSt] && wsLookups[aSt].v) wsLookups[aSt].s = lookupStatieStyle
    }
    
    wsLookups['!cols'] = [{ wch: 50 }, { wch: 32 }]
    wsLookups['!rows'] = [{ hpt: 22 }, { hpt: 16 }]
    
    // ═══════════ Data Validation: injectată via JSZip mai jos (xlsx-js-style nu suportă la write) ═══════════
    
    // Sheet 2 redenumit fără diacritice/spațiu pentru a evita probleme cu referința XML
    // ═══════════ Asamblare Workbook ═══════════
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Alimentari')
    XLSX.utils.book_append_sheet(wb, wsLookups, 'Santiere')
    
    // ═══════════ Generare buffer + injectare dataValidations via JSZip ═══════════
    // xlsx-js-style NU suportă !dataValidation la write — trebuie injectat manual în XML.
    // Asta funcționează 100% deoarece standardul ECMA-376 acceptă <dataValidations> în sheet XML.
    const xlsxBuffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
    
    const zip = await JSZip.loadAsync(xlsxBuffer)
    
    const sheet1File = zip.file('xl/worksheets/sheet1.xml')
    if (sheet1File) {
      let sheetXml = await sheet1File.async('string')
      console.log('[Template] sheet1.xml length:', sheetXml.length)
      
      // Range-uri reale în sheet Santiere (rândurile cu date încep de la 4: header + nota + gol + start)
      const santierEnd = santierNames.length + 3
      const statiiEnd = statiiCombustibil.length + 3
      
      const dvXml = `<dataValidations count="2">` +
        `<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="0" promptTitle="Sant" prompt="Alege santier" sqref="K6:K1000">` +
          `<formula1>Santiere!$A$4:$A$${santierEnd}</formula1>` +
        `</dataValidation>` +
        `<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="0" promptTitle="Statie" prompt="Alege statia" sqref="G6:G1000">` +
          `<formula1>Santiere!$B$4:$B$${statiiEnd}</formula1>` +
        `</dataValidation>` +
        `</dataValidations>`
      
      // ECMA-376: <dataValidations> trebuie ÎNAINTE de <pageMargins>, <ignoredErrors>, etc.
      // Strategie cu fallback-uri în ordinea corectă a elementelor XML din sheet:
      let injected = false
      const tryInsertBefore = (tag) => {
        if (sheetXml.includes(tag)) {
          sheetXml = sheetXml.replace(tag, dvXml + tag)
          injected = tag
          return true
        }
        return false
      }
      // Strategy: încearcă elementele care vin DUPĂ dataValidations (în ordinea ECMA-376)
      tryInsertBefore('<ignoredErrors')
        || tryInsertBefore('<pageMargins')
        || tryInsertBefore('<pageSetup')
        || tryInsertBefore('<headerFooter')
        || tryInsertBefore('<drawing')
        || tryInsertBefore('<legacyDrawing')
        || tryInsertBefore('</worksheet>')
      
      console.log('[Template] dataValidations injectat înainte de:', injected || 'EȘEC!')
      
      if (!injected) {
        console.error('[Template] NU am putut insera dataValidations! XML:', sheetXml.substring(sheetXml.length - 500))
      }
      
      zip.file('xl/worksheets/sheet1.xml', sheetXml)
    } else {
      console.error('[Template] sheet1.xml nu există în ZIP!')
    }
    
    // Trigger download cu blob
    const finalBuffer = await zip.generateAsync({ 
      type: 'blob', 
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      compression: 'DEFLATE',
    })
    console.log('[Template] Final buffer size:', finalBuffer.size, 'bytes')
    
    const url = URL.createObjectURL(finalBuffer)
    const link = document.createElement('a')
    link.href = url
    link.download = `Template_Alimentari_Gazpet_${dataAzi.replace(/\./g, '-')}.xlsx`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    setTimeout(() => URL.revokeObjectURL(url), 2000)
    
    showToast(`✓ Template descărcat cu ${santierNames.length} șantiere active (dropdown funcțional)`, 'success')
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
      
      // Load sites pentru match șantier
      const { data: allSites } = await supabase.from('sites').select('id, name, active')
      const sitesMap = allSites || []
      
      // Helper match șantier prin nume (case-insensitive + fuzzy fallback)
      const normalizeStr = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
      const findSiteByName = (input) => {
        if (!input) return null
        const target = normalizeStr(input)
        if (!target) return null
        // Exact match
        let m = sitesMap.find(s => normalizeStr(s.name) === target)
        if (m) return m
        // Contains match (input în nume site)
        m = sitesMap.find(s => normalizeStr(s.name).includes(target))
        if (m) return m
        // Nume site în input
        m = sitesMap.find(s => target.includes(normalizeStr(s.name)))
        if (m) return m
        return null
      }
      
      // Caut rândul cu header (cel cu "Cod intern" sau "Cantitate")
      let headerRow = -1
      for (let i = 0; i < Math.min(aoa.length, 10); i++) {
        const row = (aoa[i] || []).map(x => String(x || '').toLowerCase())
        if (row.some(c => c.includes('cantitate')) && row.some(c => c.includes('cod') || c.includes('plăcuță') || c.includes('placuta'))) {
          headerRow = i; break
        }
      }
      if (headerRow === -1) { showToast('Nu am găsit antetul în fișier. Folosește template-ul oficial!', 'error'); e.target.value = ''; return }
      
      // Detectez ce coloană este Șantier vs Observații (compatibilitate template nou + vechi)
      const headerCells = (aoa[headerRow] || []).map(x => String(x || '').toLowerCase())
      const santierColIdx = headerCells.findIndex(c => c.includes('șantier') || c.includes('santier'))
      const observatiiColIdx = headerCells.findIndex(c => c.includes('observa'))
      
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
        
        // Citește șantier (template nou) sau observații (template vechi)
        const santierRaw = santierColIdx >= 0 ? (r[santierColIdx] ? String(r[santierColIdx]).trim() : '') : ''
        const observatiiRaw = observatiiColIdx >= 0 ? (r[observatiiColIdx] ? String(r[observatiiColIdx]).trim() : '') : ''
        // Fallback compatibilitate: dacă template vechi cu „Observații" pe col K (idx 10), încearcă match șantier
        const fallbackColK = (!santierColIdx || santierColIdx < 0) && !observatiiRaw ? (r[10] ? String(r[10]).trim() : '') : ''
        
        let siteId = null
        let observatiiFinal = observatiiRaw || null
        
        if (santierRaw) {
          const matchedSite = findSiteByName(santierRaw)
          if (matchedSite) {
            siteId = matchedSite.id
          } else {
            // Șantier necunoscut: pune ca observație ca să nu se piardă info
            observatiiFinal = `[Șantier necunoscut: ${santierRaw}]` + (observatiiFinal ? ` · ${observatiiFinal}` : '')
            errors.push(`Rând ${idx + headerRow + 2}: Șantier necunoscut „${santierRaw}" (alimentare importată fără șantier asociat)`)
          }
        } else if (fallbackColK) {
          // Template vechi: încearcă match șantier pe coloana K, dacă nu match → tratează ca observație
          const matchedSite = findSiteByName(fallbackColK)
          if (matchedSite) {
            siteId = matchedSite.id
          } else {
            observatiiFinal = fallbackColK
          }
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
          observatii: observatiiFinal,
          site_id: siteId,
          site_label: siteId ? (sitesMap.find(s => s.id === siteId)?.name || '—') : null,
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
      const { activ_label, site_label, ...rest } = r  // strip label-uri UI-only
      return { ...rest, pret_per_litru: r.pret_total && r.cantitate_litri ? Number((r.pret_total / r.cantitate_litri).toFixed(4)) : null, created_by: user?.id }
    })
    
    const { error } = await supabase.from('logistica_alimentari').insert(payload)
    if (error) { showToast(`Eroare import: ${error.message}`, 'error'); return }
    
    const cuSantier = payload.filter(p => p.site_id).length
    const faraSantier = payload.length - cuSantier
    const msg = faraSantier > 0 
      ? `✓ Import reușit: ${payload.length} alimentări (${cuSantier} cu șantier, ${faraSantier} fără)`
      : `✓ Import reușit: ${payload.length} alimentări cu șantier asociat`
    showToast(msg, 'success')
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
      
      {/* Bara de tab-uri */}
      {/* Etapa 8.5: Header buton Alerte Globale */}
      <div style={{display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginBottom: 12, gap: 8}}>
        <AlerteGlobalButton alerte={alerteGlobale} onClick={() => setShowAlerte(true)} />
      </div>
      {/* Etapa 14: Widget Tichete Logistica */}
      {profile && <TicheteWidget departament="logistica" profile={profile} accent={G.orange} />}
      <TabsBar tab={tab} setTab={setTab} isOwner={!!profile?.is_owner} sugestiiCount={sugestiiPendente} />
      
      {/* TAB: Alimentări (input bulk per zi) */}
      {tab === 'alimentari' && (
        <AlimentariBulkPage 
          active={active}
          ultimeAlim={ultimeAlim}
          sites={sites}
          rezervoare={rezervoare}
          pretMotorina={pretMotorina}
          dataAlim={dataAlim}
          setDataAlim={setDataAlim}
          canEdit={canEdit}
          showToast={showToast}
          onImportEvoGPS={(mode) => setShowImportEvo(mode)}
          onImportRompetrol={() => setShowImportRompetrol(true)}
          ultimaTelemetrieData={ultimaTelemetrieData}
          istoricImporturi={istoricImporturi}
          profile={profile}
          accessLevel={accessLevel}
          onSaved={loadAll}
        />
      )}
      
      {/* TAB: Documente — Etapa 1 read-only (KPI + filtre + listă + view PDF) */}
      {tab === 'documente' && (
        <DocumenteFlotaPage
          active={active}
          accessLevel={accessLevel}
          profile={profile}
          showToast={showToast}
        />
      )}
      
      {/* TAB: Service (placeholder) */}
      {tab === 'service' && <ServiceTab active={active} canEdit={accessLevel === 'admin' || accessLevel === 'editor'} showToast={showToast} />}
      
      {/* TAB: Sugestii Scorilos — Etapa 12.8 (doar owner) */}
      {tab === 'bot-sugestii' && profile?.is_owner && (
        <SugestiiScorilosTab 
          profile={profile} 
          showToast={showToast} 
          setTab={setTab}
          openActiv={async (activId) => {
            // Caut activul în lista încărcată
            let a = active.find(x => x.id === activId)
            // Dacă nu-l găsesc (filtrat sau lista nu-l conține), îl încarc direct din BD
            if (!a) {
              const { data, error } = await supabase
                .from('logistica_active').select('*').eq('id', activId).maybeSingle()
              if (error || !data) {
                showToast(`Nu pot deschide activul #${activId}: ${error?.message || 'inexistent'}`, 'error')
                return
              }
              a = data
            }
            setTab('lista')
            setModal({ mode: 'view', activ: a })
          }}
          onApplied={() => { loadAll(); loadSugestiiPendenteCount() }}
        />
      )}
      
      {/* TAB: Tichete - foloseste modulul global Tichete filtrat pe logistica */}
      {tab === 'tichete' && <Tichete filterDepartament="logistica" noLayout={true} />}
      
      {/* TAB: Transporturi */}
      {tab === 'transporturi' && (
        <TransporturiPage
          active={active}
          sites={sites}
          profile={profile}
          accessLevel={accessLevel}
          showToast={showToast}
        />
      )}
      
      
      {/* TAB: Arhivă Avize */}
      {tab === 'arhiva' && (
        <ArhivaAvizePage profile={profile} showToast={showToast} />
      )}
      
      {/* TAB: Arhivă Alimentări */}
      {tab === 'arhiva_alimentari' && (
        <ArhivaAlimentariPage 
          profile={profile} 
          sites={sites} 
          rezervoare={rezervoare}
          pretMotorina={pretMotorina}
          showToast={showToast} 
        />
      )}
      
      {/* TAB: Active (default — conținutul existent) */}
      {tab === 'lista' && (<>
      
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
      
      {/* Widget Rezervoare Gazpet (Oscar 1 + Oscar 2) + Preț motorină (compact) */}
      <div style={{display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap'}}>
        {(rezervoare || []).map((rez) => {
          const stoc = Number(rez.stoc_curent_litri || 0)
          const cap = Number(rez.capacitate_litri || 0)
          const pragProc = Number(rez.prag_alerta_procent || 10)
          const pragLitri = cap * pragProc / 100
          const procentUmplere = cap > 0 ? (stoc / cap) * 100 : 0
          const isLow = stoc <= pragLitri
          const isCritic = stoc <= pragLitri / 2
          const isEmpty = stoc < 1
          
          let barColor, statusText, statusColor
          if (isEmpty) { barColor = G.dim; statusText = '○ Gol'; statusColor = G.muted }
          else if (isCritic) { barColor = G.red; statusText = '🚨 CRITIC'; statusColor = G.red }
          else if (isLow) { barColor = G.orange; statusText = '⚠️ Sub prag'; statusColor = G.orange }
          else if (procentUmplere > 90) { barColor = G.green; statusText = '✓ Plin'; statusColor = G.green }
          else { barColor = G.blue; statusText = '✓ Normal'; statusColor = G.blue }
          
          // Scurt nume: 'Gazpet - Oscar 1' → '📦 Oscar 1'
          const shortName = (rez.nume || '').replace(/^Gazpet\s*-\s*/i, '')
          
          return (
            <div key={rez.id} style={{...S.card, padding: '10px 14px', flex: 1, minWidth: 240, borderLeft: `3px solid ${barColor}`}}>
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6}}>
                <div style={{flex: 1, minWidth: 0}}>
                  <div style={{fontSize: 10, color: G.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px'}}>
                    📦 {shortName}
                  </div>
                  <div style={{fontSize: 18, fontWeight: 800, color: G.text, fontVariantNumeric: 'tabular-nums', marginTop: 1, lineHeight: 1.2}}>
                    {stoc.toLocaleString('ro-RO', {minimumFractionDigits: 0, maximumFractionDigits: 0})}<span style={{fontSize: 11, color: G.muted, fontWeight: 600}}> L</span>
                    <span style={{fontSize: 10, color: G.muted, fontWeight: 600, marginLeft: 5}}>/ {cap.toFixed(0)}</span>
                  </div>
                </div>
                {canEdit && (
                  <div style={{display: 'flex', gap: 4}}>
                    <button onClick={() => setShowEditStoc(rez)} style={{background:'transparent', border:'none', color:G.yellow, fontSize: 11, cursor:'pointer', padding: '2px 4px', lineHeight: 1}} title="Ajustare manuală stoc">✏️</button>
                    <button onClick={() => setShowAchizitie(rez)} style={{background:'transparent', border:`1px solid ${G.purple}55`, color:G.purple, fontSize: 10, cursor:'pointer', padding: '3px 6px', borderRadius: 4, fontWeight: 600}} title="Achiziție vrac">+ Vrac</button>
                  </div>
                )}
              </div>
              <div style={{height: 6, background: G.bg, borderRadius: 3, overflow: 'hidden', marginBottom: 4}}>
                <div style={{
                  width: `${Math.min(procentUmplere, 100)}%`,
                  height: '100%',
                  background: barColor,
                  transition: 'width .3s'
                }}/>
              </div>
              <div style={{display: 'flex', justifyContent: 'space-between', fontSize: 10}}>
                <span style={{color: statusColor, fontWeight: 600}}>{statusText}</span>
                <span style={{color: G.muted}}>{procentUmplere.toFixed(0)}% · prag {pragProc}%</span>
              </div>
            </div>
          )
        })}
        
        {/* Card preț motorină — compact */}
        <div style={{...S.card, padding: '10px 14px', minWidth: 140, borderLeft: `3px solid ${G.green}`}}>
          <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 2}}>
            <div style={{fontSize: 10, color: G.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px'}}>
              💰 Motorină
            </div>
            {canEdit && (
              <button onClick={() => setShowSetariPret(true)} style={{background:'transparent', border:'none', color:G.muted, fontSize: 12, cursor:'pointer', padding: 0, lineHeight: 1}} title="Editează preț">⚙️</button>
            )}
          </div>
          <div style={{fontSize: 18, fontWeight: 800, color: G.green, fontVariantNumeric: 'tabular-nums', lineHeight: 1.2}}>
            {pretMotorina ? Number(pretMotorina).toFixed(2) : '—'}<span style={{fontSize: 10, color: G.muted, fontWeight: 600, marginLeft: 3}}>RON/L</span>
          </div>
          <div style={{fontSize: 9, color: G.muted, marginTop: 2}}>
            {pretMotorinaActualizat || '—'}
          </div>
        </div>
      </div>
      
      {/* Widget Alerte Transporturi cerute — pending aprobare */}
      {alerteTransp && alerteTransp.length > 0 && (
        <div style={{
          ...S.card,
          padding: '10px 14px',
          marginBottom: 12,
          borderLeft: `4px solid ${G.orange}`,
          background: G.yellowDim + '66',
        }}>
          <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 8, flexWrap: 'wrap'}}>
            <div style={{display: 'flex', alignItems: 'center', gap: 10}}>
              <span style={{fontSize: 20}}>🚛</span>
              <div>
                <div style={{fontSize: 13, fontWeight: 700, color: G.text}}>
                  Transporturi cerute — așteaptă aprobare
                </div>
                <div style={{fontSize: 11, color: G.muted, marginTop: 1}}>
                  <span style={{color: G.orange, fontWeight: 700}}>⏳ {alerteTransp.length}</span> {alerteTransp.length === 1 ? 'cerere pending' : 'cereri pending'} · click pentru detalii
                </div>
              </div>
            </div>
            <button 
              onClick={() => setTab('transporturi')}
              style={{...S.btnS, fontSize: 12, color: G.orange, borderColor: G.orange + '88', fontWeight: 700}}>
              → Vezi în Transporturi
            </button>
          </div>
          <div style={{display: 'flex', flexDirection: 'column', gap: 4}}>
            {alerteTransp.slice(0, 5).map(t => {
              const continut = t.tip === 'utilaj' && t.activ_transportat
                ? `🚛 ${t.activ_transportat.cod_intern || ''} ${t.activ_transportat.marca || ''} ${t.activ_transportat.model || ''}`.trim()
                : `📄 ${t.continut_descriere || '—'}`
              const traseu = `${t.plecare_site?.name || '?'} → ${t.destinatie_site?.name || '?'}`
              return (
                <div 
                  key={t.id}
                  onClick={() => setTab('transporturi')}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '5px 10px', background: G.bg, borderRadius: 4, cursor: 'pointer',
                    fontSize: 11, gap: 10
                  }}
                  title="Click pentru a deschide tabul Transporturi"
                >
                  <div style={{display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0, overflow: 'hidden'}}>
                    <span style={{color: G.text, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 280}}>
                      {continut}
                    </span>
                    <span style={{color: G.muted, fontSize: 10}}>·</span>
                    <span style={{color: G.muted, fontSize: 10, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
                      {traseu}
                    </span>
                  </div>
                  <div style={{display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0}}>
                    <span style={{color: G.blue, fontSize: 10, fontFamily: 'monospace'}}>
                      📅 {t.data_transport}
                    </span>
                    {t.solicitant?.name && (
                      <span style={{color: G.muted, fontSize: 10}}>
                        {t.solicitant.name.split(' ')[0]}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
            {alerteTransp.length > 5 && (
              <div style={{fontSize: 10, color: G.muted, textAlign: 'center', paddingTop: 4, fontStyle: 'italic'}}>
                ... și încă {alerteTransp.length - 5} cereri
              </div>
            )}
          </div>
        </div>
      )}
      
      {/* Widget Transporturi BLOCATE — aprobate care nu au plecat SAU în tranzit care nu au confirmat livrare */}
      {transpBlocate && transpBlocate.length > 0 && (() => {
        const hasTranzit = transpBlocate.some(t => t.status === 'in_tranzit')
        const borderColor = hasTranzit ? G.red : G.orange
        const bgColor = hasTranzit ? G.redDim + '66' : G.yellowDim + '66'
        // Helper zile întârziere
        const daysOverdue = (dataTransport) => {
          if (!dataTransport) return 0
          const d = new Date(dataTransport); d.setHours(0,0,0,0)
          const t = new Date(); t.setHours(0,0,0,0)
          return Math.floor((t.getTime() - d.getTime()) / (1000 * 60 * 60 * 24))
        }
        return (
          <div style={{
            ...S.card,
            padding: '10px 14px',
            marginBottom: 12,
            borderLeft: `4px solid ${borderColor}`,
            background: bgColor,
          }}>
            <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 8, flexWrap: 'wrap'}}>
              <div style={{display: 'flex', alignItems: 'center', gap: 10}}>
                <span style={{fontSize: 20}}>{hasTranzit ? '🚨' : '⚠️'}</span>
                <div>
                  <div style={{fontSize: 13, fontWeight: 700, color: G.text}}>
                    Transporturi blocate — acțiune necesară
                  </div>
                  <div style={{fontSize: 11, color: G.muted, marginTop: 1, display: 'flex', gap: 12, flexWrap: 'wrap'}}>
                    {transpBlocate.filter(t => t.status === 'aprobat' || t.status === 'programat').length > 0 && (
                      <span style={{color: G.orange, fontWeight: 700}}>
                        ⚠️ {transpBlocate.filter(t => t.status === 'aprobat' || t.status === 'programat').length} aprobate, n-au plecat
                      </span>
                    )}
                    {transpBlocate.filter(t => t.status === 'in_tranzit').length > 0 && (
                      <span style={{color: G.red, fontWeight: 700}}>
                        🚨 {transpBlocate.filter(t => t.status === 'in_tranzit').length} în tranzit, livrare neconfirmată
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <button 
                onClick={() => setTab('transporturi')}
                style={{...S.btnS, fontSize: 12, color: borderColor, borderColor: borderColor + '88', fontWeight: 700}}>
                → Vezi în Transporturi
              </button>
            </div>
            <div style={{display: 'flex', flexDirection: 'column', gap: 4}}>
              {transpBlocate.slice(0, 5).map(t => {
                const isTranzit = t.status === 'in_tranzit'
                const continut = t.tip === 'utilaj' && t.activ_transportat
                  ? `🚛 ${t.activ_transportat.cod_intern || ''} ${t.activ_transportat.marca || ''} ${t.activ_transportat.model || ''}`.trim()
                  : `📄 ${t.continut_descriere || '—'}`
                const traseu = `${t.plecare_site?.name || '?'} → ${t.destinatie_site?.name || '?'}`
                const zileInt = daysOverdue(t.data_transport)
                const persoana = isTranzit ? (t.sofer?.name || t.solicitant?.name) : t.solicitant?.name
                return (
                  <div 
                    key={t.id}
                    onClick={() => setTab('transporturi')}
                    style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '5px 10px', background: G.bg, borderRadius: 4, cursor: 'pointer',
                      fontSize: 11, gap: 10,
                      borderLeft: `2px solid ${isTranzit ? G.red : G.orange}`,
                    }}
                    title={isTranzit ? `În tranzit — livrare neconfirmată de ${zileInt} ${zileInt === 1 ? 'zi' : 'zile'}` : `Aprobat — trebuia să plece acum ${zileInt} ${zileInt === 1 ? 'zi' : 'zile'}`}
                  >
                    <div style={{display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0, overflow: 'hidden'}}>
                      <span style={{
                        padding: '1px 6px', borderRadius: 3, fontSize: 9, fontWeight: 700,
                        background: isTranzit ? G.red + '33' : G.orange + '33',
                        color: isTranzit ? G.red : G.orange,
                        whiteSpace: 'nowrap',
                      }}>
                        {isTranzit ? '🚨 TRANZIT' : '⚠️ APROBAT'}
                      </span>
                      <span style={{color: G.text, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 240}}>
                        {continut}
                      </span>
                      <span style={{color: G.muted, fontSize: 10}}>·</span>
                      <span style={{color: G.muted, fontSize: 10, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
                        {traseu}
                      </span>
                    </div>
                    <div style={{display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0}}>
                      <span style={{color: isTranzit ? G.red : G.orange, fontSize: 10, fontWeight: 700}}>
                        ⏱ {zileInt} {zileInt === 1 ? 'zi' : 'zile'}
                      </span>
                      <span style={{color: G.blue, fontSize: 10, fontFamily: 'monospace'}}>
                        📅 {t.data_transport}
                      </span>
                      {persoana && (
                        <span style={{color: G.muted, fontSize: 10}}>
                          {persoana.split(' ')[0]}
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
              {transpBlocate.length > 5 && (
                <div style={{fontSize: 10, color: G.muted, textAlign: 'center', paddingTop: 4, fontStyle: 'italic'}}>
                  ... și încă {transpBlocate.length - 5} blocate
                </div>
              )}
            </div>
          </div>
        )
      })()}
      
      {/* Widget statistici alimentări — IERI / ULTIMELE 7 ZILE / LUNA */}
      {kpiAlim && (
        <div style={{display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap'}}>
          <PerioadaCard label="📅 Ieri" data={kpiAlim} suffix="ieri" color={G.blue} />
          <PerioadaCard label="📊 Ultimele 7 zile" data={kpiAlim} suffix="saptamana" color={G.purple} />
          <PerioadaCard label="📆 Luna curentă" data={kpiAlim} suffix="luna" color={G.orange} />
        </div>
      )}
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
      
      {/* Widget KPI Transporturi — Luna curentă (Cerute / Aprobate / În tranzit / Livrate) */}
      <div style={{display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap'}}>
        <div 
          onClick={() => setTab('transporturi')}
          style={{
            ...S.card, padding: '10px 14px', flex: 1, minWidth: 160, cursor: 'pointer',
            borderLeft: `4px solid ${kpiTransp.cerute > 0 ? G.red : G.border}`,
            background: kpiTransp.cerute > 0 ? G.redDim + '66' : G.surface,
            animation: kpiTransp.cerute > 0 ? 'pulse-red 2s infinite' : 'none',
            boxShadow: kpiTransp.cerute > 0 ? `0 0 12px ${G.red}33` : 'none',
            transition: 'all .3s'
          }}
          title="Click pentru a deschide tabul Transporturi"
        >
          <div style={{fontSize: 10, color: kpiTransp.cerute > 0 ? G.red : G.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 2}}>
            ⏳ Cerute (de aprobat) {kpiTransp.cerute > 0 && <span style={{marginLeft: 4, padding: '1px 5px', background: G.red, color: '#fff', borderRadius: 3, fontSize: 9, fontWeight: 700}}>URGENT</span>}
          </div>
          <div style={{fontSize: 22, fontWeight: 800, color: kpiTransp.cerute > 0 ? G.red : G.text, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1}}>
            {kpiTransp.cerute}
          </div>
        </div>
        <div onClick={() => setTab('transporturi')} style={{
          ...S.card, padding: '10px 14px', flex: 1, minWidth: 130, cursor: 'pointer',
          borderLeft: `4px solid ${G.green}`,
        }} title="Click pentru a deschide tabul Transporturi">
          <div style={{fontSize: 10, color: G.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 2}}>
            ✓ Aprobate
          </div>
          <div style={{fontSize: 22, fontWeight: 800, color: G.green, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1}}>
            {kpiTransp.aprobate}
          </div>
        </div>
        <div onClick={() => setTab('transporturi')} style={{
          ...S.card, padding: '10px 14px', flex: 1, minWidth: 130, cursor: 'pointer',
          borderLeft: `4px solid ${G.yellow}`,
        }} title="Click pentru a deschide tabul Transporturi">
          <div style={{fontSize: 10, color: G.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 2}}>
            🚛 În tranzit
          </div>
          <div style={{fontSize: 22, fontWeight: 800, color: G.yellow, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1}}>
            {kpiTransp.inTranzit}
          </div>
        </div>
        <div onClick={() => setTab('transporturi')} style={{
          ...S.card, padding: '10px 14px', flex: 1, minWidth: 130, cursor: 'pointer',
          borderLeft: `4px solid ${G.green}`,
        }} title="Click pentru a deschide tabul Transporturi">
          <div style={{fontSize: 10, color: G.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 2}}>
            ✅ Livrate
          </div>
          <div style={{fontSize: 22, fontWeight: 800, color: G.green, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1}}>
            {kpiTransp.livrate}
          </div>
        </div>
      </div>
      
      {/* CSS animation pulse-red pentru KPI Cerute */}
      <style>{`
        @keyframes pulse-red {
          0%, 100% { box-shadow: 0 0 12px ${G.red}33; }
          50% { box-shadow: 0 0 18px ${G.red}66; }
        }
      `}</style>
      
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
                  <th style={{width: 45, padding: '10px 8px', textAlign: 'center', color: G.muted, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.4px'}}>#</th>
                  <SortableTh col="cod_intern" sortBy={sortBy} setSortBy={setSortBy} width={75}>Cod intern</SortableTh>
                  <SortableTh col="nr_inventar" sortBy={sortBy} setSortBy={setSortBy} width={90}>Nr inventar</SortableTh>
                  <SortableTh col="nr_inmatriculare" sortBy={sortBy} setSortBy={setSortBy} width={95}>Plăcuță</SortableTh>
                  <SortableTh col="marca" sortBy={sortBy} setSortBy={setSortBy}>Marcă · Model</SortableTh>
                  <SortableTh col="tip" sortBy={sortBy} setSortBy={setSortBy} width={170}>Categorie</SortableTh>
                  <SortableTh col="an" sortBy={sortBy} setSortBy={setSortBy} width={60}>An</SortableTh>
                  <SortableTh col="stare" sortBy={sortBy} setSortBy={setSortBy} width={120}>Stare</SortableTh>
                  <th style={{padding: '10px 8px', textAlign: 'right', color: G.muted, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.4px', width: 110}}>KM / Ore</th>
                  <SortableTh col="mentenanta" sortBy={sortBy} setSortBy={setSortBy} width={150}>Mentenanță</SortableTh>
                  <th style={{width: 50}}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((a, idx) => {
                  const cat = a.logistica_categorii
                  const ment = a.logistica_mentenanta_plan?.[0]
                  return (
                    <tr key={a.id} onClick={() => setModal({ mode: 'view', activ: a })} style={{cursor: 'pointer'}}>
                      <td style={{textAlign: 'center', fontFamily: 'monospace', fontSize: 11, color: G.muted, fontWeight: 600}}>
                        {idx + 1}
                      </td>
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
                      <td><StareBadge stare={a.stare} deepSleep={a.deep_sleep} /></td>
                      <td style={{textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontFamily: 'monospace', fontSize: 12, paddingRight: 12}}>
                        {(() => {
                          const tipCat = cat?.tip
                          const esteUtilaj = tipCat === 'Utilaj'
                          const esteVehicul = ['Autoturism', 'Autoutilitară', 'Camion', 'Cap tractor'].includes(tipCat)
                          if (esteUtilaj && a.ore_functionare_actuale != null) {
                            return <span style={{color: G.orange, fontWeight: 700}}>🕒 {Number(a.ore_functionare_actuale).toLocaleString('ro-RO')} <span style={{color: G.muted, fontWeight: 400}}>h</span></span>
                          }
                          if (esteVehicul && a.km_actuali != null) {
                            return <span style={{color: G.blue, fontWeight: 700}}>🛣️ {Number(a.km_actuali).toLocaleString('ro-RO')} <span style={{color: G.muted, fontWeight: 400}}>km</span></span>
                          }
                          return <span style={{color: G.dim}}>—</span>
                        })()}
                      </td>
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
      
      </>)}
      
      {modal && (
        <ActivFormModal 
          activ={modal.activ}
          initialMode={modal.mode}
          categorii={categorii}
          accessLevel={accessLevel}
          rezervoare={rezervoare}
          sites={sites}
          pretMotorina={pretMotorina}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
          showToast={showToast}
        />
      )}
      
      {/* Modal achiziție vrac — pe rezervorul selectat (Oscar 1 sau Oscar 2) */}
      {showAchizitie && (
        <AchizitieVracModal 
          rezervor={showAchizitie}
          onClose={() => setShowAchizitie(null)}
          onSaved={() => { setShowAchizitie(null); loadAll() }}
          showToast={showToast}
        />
      )}
      
      {/* Modal edit stoc rezervor — pe rezervorul selectat (corecții manuale) */}
      {showEditStoc && (
        <EditStocModal 
          rezervor={showEditStoc}
          onClose={() => setShowEditStoc(null)}
          onSaved={() => { setShowEditStoc(null); loadAll() }}
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
                      <th style={{width: 180}}>Șantier</th>
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
                        <td style={{fontSize: 11}}>
                          {r.site_label 
                            ? <span style={{color: G.green, fontWeight: 600}}>📍 {r.site_label}</span> 
                            : <span style={{color: G.dim, fontStyle: 'italic'}}>— fără șantier —</span>
                          }
                        </td>
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
      
      {/* Modal Import EvoGPS (Etapa 8.5) */}
      {/* Etapa 8.5: Sidebar Alerte Globale */}
      <AlerteGlobaleSidebar 
        open={showAlerte}
        onClose={() => setShowAlerte(false)}
        alerte={alerteGlobale}
        onNavigate={(targetTab, assetId) => {
          setShowAlerte(false)
          setTab(targetTab)
          nav(`/logistica?tab=${targetTab}${assetId ? `&activ_id=${assetId}` : ''}`)
        }}
      />

      <ImportEvoGPSModal 
        open={!!showImportEvo} 
        expectedType={showImportEvo}
        onClose={() => setShowImportEvo(null)} 
        supabase={supabase}
        profile={profile}
        G={G}
        S={S}
        onSuccess={(n) => {
          showToast(`✓ ${n} înregistrări telemetrie importate. km_actuali actualizat automat.`)
          loadAll()       // refresh listă active (km_actuali update via trigger)
          // ETAPA 8.5 FIX: refresh banner ultima telemetrie + alerte globale (km_live nou poate trigger alerte revizie)
          supabase.from('logistica_telemetrie_zilnica')
            .select('data')
            .order('data', { ascending: false })
            .limit(1)
            .maybeSingle()
            .then(({ data }) => { setUltimaTelemetrieData(data?.data || null) })
          supabase.from('v_logistica_alerte_globale')
            .select('*')
            .order('nivel')
            .order('km_ramase')
            .then(({ data }) => { setAlerteGlobale(data || []) })
          // ETAPA 8.6: refresh istoric importuri
          loadIstoricImporturi()
        }}
      />
      
      {/* 24.05.2026: Modal Import Rompetrol */}
      {showImportRompetrol && (
        <ImportRompetrolModal
          active={active}
          profile={profile}
          showToast={showToast}
          onClose={() => setShowImportRompetrol(false)}
          onSaved={() => {
            loadAll()
            setShowImportRompetrol(false)
          }}
        />
      )}
    </>
  )
}
