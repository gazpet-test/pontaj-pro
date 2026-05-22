// ════════════════════════════════════════════════════════════════════════════
// MODULUL LOGISTICĂ — Tab Service v2 (refactor major)
// ════════════════════════════════════════════════════════════════════════════
// Schema: fișe-părinte (logistica_service_fise) + intrări copil (logistica_service_intrari).
// Bifabile preset (logistica_service_itemi_preset) cu smart-fill cod piesă din istoric.
// Status flow: programat → in_lucru → finalizat (finalizat doar prin buton confirm).
// Filtru categorie (10 categorii), căutare după cod TST, plăcuță, marcă, model.
// Buton "Acoperire flotă" cu lista activelor fără fișă.
// Coloană "Următor service" cu badge colorat + KPI scadențe.
//
// Pachet C (10.05.2026): KM/Ore live din view v_active_km_ore (km_actuali și
// ore_functionare_actuale sunt 100% goale pe toate activele momentan).
// Helper-ele calcUrmService / urmServiceLevel / urmServiceColor au fost mutate
// în src/lib/service.js pentru reutilizare (Acasă, etc.).
// ════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { supabase } from './lib/supabase.js'
import * as XLSX from 'xlsx-js-style'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'
import { calcUrmService, urmServiceLevel, urmServiceColor, PRAG_ZILE, PRAG_KM, PRAG_ORE } from './lib/service.js'
import PieseCatalogSection from './PieseCatalogSection.jsx'
import ImportFiseServiceModal from './ImportFiseServiceModal.jsx'

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

const TIPURI = [
  { value:'mentenanta', label:'🔧 Mentenanță' },
  { value:'reparatie',  label:'⚙️ Reparație' },
]
const STATUSURI = [
  { value:'programat', label:'📅 Programat',  color:G.blue   },
  { value:'in_lucru',  label:'🔧 În lucru',   color:G.yellow },
  { value:'finalizat', label:'✓ Finalizat',   color:G.green  },
]
const CATEGORII = ['Autoturism','Autoutilitară','Camion','Cap tractor','Container','Remorcă','Rulotă','Semiremorcă','Trailer','Utilaj']

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('ro-RO', { day:'2-digit', month:'2-digit', year:'numeric' }) : '—'
const fmtRON = (n) => n != null && n !== '' ? Number(n).toLocaleString('ro-RO', { minimumFractionDigits:2, maximumFractionDigits:2 }) + ' RON' : '—'
const todayISO = () => new Date().toISOString().split('T')[0]
const norm = (s) => (s || '').toString().toLowerCase().replace(/[ăâ]/g,'a').replace(/[î]/g,'i').replace(/[șş]/g,'s').replace(/[țţ]/g,'t').trim()

function isApplicable(aplicabilPt, categorie, subcategorie) {
  if (!aplicabilPt || aplicabilPt === 'Toate') return true
  const cat = categorie || ''
  const sub = (subcategorie || '').toLowerCase()
  const ap = aplicabilPt
  if (ap === 'Vehicule')                  return ['Autoturism','Autoutilitară','Camion','Cap tractor'].includes(cat)
  if (ap === 'Utilaj')                    return cat === 'Utilaj'
  if (ap === 'Autoturism+Autoutilitară')  return ['Autoturism','Autoutilitară'].includes(cat)
  if (ap === 'Camion+Cap tractor')        return ['Camion','Cap tractor'].includes(cat)
  if (ap === 'Compresor')                 return cat === 'Utilaj' && (sub.includes('compresor') || sub.includes('booster'))
  if (ap === 'Excavator')                 return cat === 'Utilaj' && sub.includes('excavator')
  if (ap === 'Buldozer')                  return cat === 'Utilaj' && sub.includes('buldozer')
  if (ap.startsWith('Specific:'))         return cat === ap.replace('Specific:', '').trim()
  return true
}

// ════════════════════════════════════════════════════════════════════════════
// COMPONENTE REUTILIZABILE
// ════════════════════════════════════════════════════════════════════════════

const FieldLabel = ({ label, required }) => (
  <div style={{fontSize:11, color:G.muted, fontWeight:700, textTransform:'uppercase', letterSpacing:'.5px', marginBottom:5}}>
    {label} {required && <span style={{color:G.red}}>*</span>}
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
        style={{...S.input, padding:'7px 11px', fontSize:13, background: readonly ? G.surface : G.bg, color: readonly ? G.muted : G.text, cursor: readonly ? 'default' : 'pointer'}}>
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
        style={{...S.input, fontSize:14, background: readonly ? G.surface : G.bg, color: readonly ? G.muted : G.text, resize:'vertical', fontFamily:'inherit'}} />
    </div>
  )
}

function StatusBadge({ status }) {
  const cfg = STATUSURI.find(s => s.value === status)
  const c = cfg || { label: status || '—', color: G.dim }
  return <span style={{display:'inline-block', padding:'3px 10px', borderRadius:12, fontSize:11, fontWeight:700, letterSpacing:'.3px', background: c.color + '22', color: c.color, whiteSpace:'nowrap'}}>{c.label}</span>
}

function TipBadge({ tip }) {
  const cfg = { 'mentenanta': { color:G.green, label:'🔧 Mentenanță' }, 'reparatie': { color:G.orange, label:'⚙️ Reparație' } }
  const c = cfg[tip] || { color:G.dim, label: tip || '—' }
  return <span style={{display:'inline-block', padding:'3px 10px', borderRadius:12, fontSize:11, fontWeight:700, letterSpacing:'.3px', background: c.color + '22', color: c.color, whiteSpace:'nowrap'}}>{c.label}</span>
}

function UrmServiceBadge({ u }) {
  if (!u) return <span style={{color:G.dim, fontSize:11}}>—</span>
  const c = urmServiceColor(u)
  const icon = u.tip === 'data' ? '📅' : u.tip === 'km' ? '🛣️' : '⏱️'
  return (
    <span style={{
      display:'inline-block', padding:'3px 9px', borderRadius:8,
      background: c + '22', color: c, fontWeight:700, fontSize:11,
      whiteSpace:'nowrap', fontVariantNumeric:'tabular-nums'
    }}>
      {icon} {u.label}
    </span>
  )
}

function KPICard({ icon, label, value, color = G.blue, sub, onClick }) {
  const clickable = typeof onClick === 'function'
  return (
    <div 
      onClick={onClick}
      style={{
        ...S.card, padding:'14px 18px', flex:1, minWidth:160, 
        borderLeft:`3px solid ${color}`,
        cursor: clickable ? 'pointer' : 'default',
        transition: 'all .15s',
        position: 'relative',
      }}
      onMouseEnter={e => { if (clickable) { e.currentTarget.style.background = G.bg; e.currentTarget.style.transform = 'translateY(-1px)' } }}
      onMouseLeave={e => { if (clickable) { e.currentTarget.style.background = G.surface; e.currentTarget.style.transform = 'none' } }}
    >
      <div style={{fontSize:11, color:G.muted, fontWeight:600, textTransform:'uppercase', letterSpacing:'.5px', marginBottom:4}}>
        {icon} {label}
        {clickable && <span style={{float:'right', fontSize:10, opacity:.5}}>↗ click filtru</span>}
      </div>
      <div style={{fontSize:24, fontWeight:800, color:G.text, fontVariantNumeric:'tabular-nums'}}>{value}</div>
      {sub && <div style={{fontSize:11, color:G.muted, marginTop:2}}>{sub}</div>}
    </div>
  )
}

function SortableTh({ col, sortBy, setSortBy, width, children, align='left' }) {
  const isActive = sortBy.col === col
  const handleClick = () => {
    if (isActive) setSortBy({ col, dir: sortBy.dir === 'asc' ? 'desc' : 'asc' })
    else setSortBy({ col, dir: 'asc' })
  }
  return (
    <th onClick={handleClick} style={{
      width, cursor:'pointer', userSelect:'none', textAlign:align,
      padding:'10px 8px', color: isActive ? G.logistica : G.muted,
      fontWeight:700, fontSize:11, textTransform:'uppercase', letterSpacing:'.4px',
      borderBottom:`1px solid ${G.border}`, background:G.surface,
    }}>
      <span style={{display:'inline-flex', alignItems:'center', gap:4}}>
        {children}
        <span style={{fontSize:9, opacity: isActive ? 1 : .35}}>{isActive ? (sortBy.dir === 'asc' ? '▲' : '▼') : '▲▼'}</span>
      </span>
    </th>
  )
}

function ComboboxActiv({ value, onChange, active, required, readonly, placeholder='Caută cod TST, plăcuță, marcă, model…' }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const selected = useMemo(() => active.find(a => String(a.id) === String(value)), [active, value])

  useEffect(() => {
    if (!open && selected) {
      const lbl = `${selected.cod_intern || selected.nr_inmatriculare || `#${selected.id}`} · ${selected.marca || ''} ${selected.model || ''}`.trim()
      setQuery(lbl)
    } else if (!selected) {
      setQuery('')
    }
  }, [selected, open])

  const filtered = useMemo(() => {
    if (!query.trim()) return active.slice(0, 50)
    const q = norm(query)
    return active
      .filter(a => {
        const hay = norm([a.cod_intern, a.nr_inventar, a.nr_inmatriculare, a.marca, a.model, a.categorie?.tip, a.categorie?.subcategorie].filter(Boolean).join(' '))
        return hay.includes(q)
      })
      .slice(0, 50)
  }, [active, query])

  return (
    <div style={{position:'relative'}}>
      <FieldLabel label="Activ (vehicul/utilaj)" required={required} />
      <input
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 180)}
        placeholder={placeholder}
        readOnly={readonly}
        style={{...S.input, background: readonly ? G.surface : G.bg, color: readonly ? G.muted : G.text}}
      />
      {open && !readonly && (
        <div style={{
          position:'absolute', top:'100%', left:0, right:0, marginTop:4,
          background:G.bg, border:`1px solid ${G.border2}`, borderRadius:8,
          maxHeight:280, overflowY:'auto', zIndex:50, boxShadow:'0 8px 24px rgba(0,0,0,.4)'
        }}>
          {filtered.length === 0 ? (
            <div style={{padding:'12px 14px', color:G.muted, fontSize:12, textAlign:'center'}}>Niciun rezultat</div>
          ) : filtered.map(a => (
            <div
              key={a.id}
              onMouseDown={() => { onChange(String(a.id)); setOpen(false) }}
              style={{
                padding:'10px 12px', borderBottom:`1px solid ${G.border}`,
                cursor:'pointer', transition:'background .12s',
                background: String(a.id) === String(value) ? G.logistica + '22' : 'transparent',
              }}
              onMouseEnter={e => e.currentTarget.style.background = G.surface}
              onMouseLeave={e => e.currentTarget.style.background = String(a.id) === String(value) ? G.logistica + '22' : 'transparent'}
            >
              <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:2}}>
                {a.cod_intern && <span style={{fontFamily:'monospace', color:G.logistica, fontWeight:700, fontSize:12}}>{a.cod_intern}</span>}
                {a.nr_inmatriculare && <span style={{fontFamily:'monospace', color:G.blue, fontSize:12}}>{a.nr_inmatriculare}</span>}
                {a.categorie?.tip && <span style={{fontSize:10, color:G.muted, marginLeft:'auto'}}>{a.categorie.tip}{a.categorie.subcategorie ? ` · ${a.categorie.subcategorie}` : ''}</span>}
              </div>
              <div style={{fontSize:13, color:G.text}}>{a.marca} {a.model}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function GrupAccordion({ grupa, items, expanded, onToggle, bife, onBifa, onBifaDetail, smartFillMap }) {
  const checkedCount = items.filter(it => bife[it.id]).length
  return (
    <div style={{border:`1px solid ${G.border}`, borderRadius:8, marginBottom:8, overflow:'hidden'}}>
      <div onClick={onToggle} style={{
        padding:'10px 14px', background: expanded ? G.surface : G.bg,
        cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'space-between',
        userSelect:'none', borderBottom: expanded ? `1px solid ${G.border}` : 'none',
      }}>
        <div style={{display:'flex', alignItems:'center', gap:10}}>
          <span style={{fontSize:14, color:G.text, fontWeight:700}}>{grupa}</span>
          {checkedCount > 0 && (
            <span style={{padding:'2px 8px', borderRadius:10, background:G.logistica + '33', color:G.logistica, fontSize:11, fontWeight:700}}>
              {checkedCount} bifate
            </span>
          )}
          <span style={{fontSize:11, color:G.dim}}>({items.length} itemi)</span>
        </div>
        <span style={{fontSize:14, color:G.muted, transform: expanded ? 'rotate(90deg)' : 'rotate(0)', transition:'transform .15s'}}>▶</span>
      </div>
      {expanded && (
        <div style={{padding:'8px 0'}}>
          {items.map(it => {
            const checked = !!bife[it.id]
            const detail = bife[it.id] || {}
            const smart = smartFillMap[norm(it.denumire)]
            return (
              <div key={it.id} style={{padding:'8px 14px', borderBottom:`1px solid ${G.border}`, background: checked ? G.logistica + '08' : 'transparent'}}>
                <div style={{display:'flex', alignItems:'center', gap:10}}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={e => onBifa(it.id, e.target.checked, it, smart)}
                    style={{width:18, height:18, cursor:'pointer', accentColor: G.logistica}}
                  />
                  <div style={{flex:1, minWidth:0}}>
                    <div style={{fontSize:13, color:G.text, fontWeight: checked ? 700 : 500}}>
                      {it.denumire}
                      {it.subgrup && <span style={{fontSize:10, color:G.muted, marginLeft:8, fontWeight:400}}>· {it.subgrup}</span>}
                    </div>
                    {(it.interval_km || it.interval_ore || it.interval_zile) && (
                      <div style={{fontSize:10, color:G.dim, marginTop:2}}>
                        Interval: {[
                          it.interval_km && `${it.interval_km.toLocaleString()} km`,
                          it.interval_ore && `${it.interval_ore} h`,
                          it.interval_zile && `${it.interval_zile} zile`,
                        ].filter(Boolean).join(' · ')}
                      </div>
                    )}
                  </div>
                  {!checked && smart && (
                    <span style={{fontSize:10, color:G.green, fontFamily:'monospace', whiteSpace:'nowrap'}}>↳ {smart}</span>
                  )}
                </div>
                {checked && (
                  <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginTop:8, paddingLeft:28}}>
                    <input
                      placeholder="Cantitate"
                      value={detail.cantitate || ''}
                      onChange={e => onBifaDetail(it.id, 'cantitate', e.target.value)}
                      style={{...S.input, padding:'6px 10px', fontSize:12}}
                    />
                    <input
                      placeholder={smart ? `Cod piesă (sugerat: ${smart})` : 'Cod piesă (opțional)'}
                      value={detail.cod_piesa || ''}
                      onChange={e => onBifaDetail(it.id, 'cod_piesa', e.target.value)}
                      style={{...S.input, padding:'6px 10px', fontSize:12, fontFamily: detail.cod_piesa ? 'monospace' : 'inherit'}}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// MODAL: FIȘĂ NOUĂ
// ════════════════════════════════════════════════════════════════════════════

function NewFisaModal({ activPreset, active, onClose, onSaved, showToast, presetItems }) {
  const [activId, setActivId] = useState(activPreset ? String(activPreset) : '')
  const [tip, setTip] = useState('mentenanta')
  const [status, setStatus] = useState('programat')
  const [dataFisei, setDataFisei] = useState(todayISO())
  const [titlu, setTitlu] = useState('')
  const [locatie, setLocatie] = useState('')
  const [numarFactura, setNumarFactura] = useState('')
  const [dataFactura, setDataFactura] = useState('')
  const [sumaFactura, setSumaFactura] = useState('')
  const [manopera, setManopera] = useState('')
  const [diagnostic, setDiagnostic] = useState('')
  const [observatii, setObservatii] = useState('')
  const [kmIntrare, setKmIntrare] = useState('')
  const [kmIesire, setKmIesire] = useState('')
  const [oreIntrare, setOreIntrare] = useState('')
  const [oreIesire, setOreIesire] = useState('')
  const [urmKm, setUrmKm] = useState('')
  const [urmOre, setUrmOre] = useState('')
  const [urmData, setUrmData] = useState('')
  const [bife, setBife] = useState({})
  const [extra, setExtra] = useState([])
  const [expanded, setExpanded] = useState({})
  const [saving, setSaving] = useState(false)
  const [smartFillMap, setSmartFillMap] = useState({})

  const activSelected = active.find(a => String(a.id) === String(activId))

  useEffect(() => {
    if (!activId) { setSmartFillMap({}); return }
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('logistica_service_intrari')
        .select('denumire, cod_piesa, id')
        .eq('activ_id', Number(activId))
        .not('cod_piesa', 'is', null)
        .order('id', { ascending: false })
        .limit(500)
      if (cancelled || !data) return
      const map = {}
      for (const r of data) {
        const k = norm(r.denumire)
        if (k && r.cod_piesa && !map[k]) map[k] = r.cod_piesa
      }
      setSmartFillMap(map)
    })()
    return () => { cancelled = true }
  }, [activId])

  const itemiAplicabili = useMemo(() => {
    if (!activSelected) return presetItems
    return presetItems.filter(it => isApplicable(it.aplicabil_pt, activSelected.categorie?.tip, activSelected.categorie?.subcategorie))
  }, [presetItems, activSelected])

  const grupuri = useMemo(() => {
    const g = {}
    for (const it of itemiAplicabili) {
      if (!g[it.grupa]) g[it.grupa] = []
      g[it.grupa].push(it)
    }
    return g
  }, [itemiAplicabili])

  const handleBifa = (id, checked, it, smartCod) => {
    setBife(prev => {
      const next = { ...prev }
      if (checked) {
        next[id] = {
          denumire: it.denumire,
          cantitate: it.cantitate_default || '',
          cod_piesa: smartCod || '',
          subgrup: it.subgrup,
        }
      } else {
        delete next[id]
      }
      return next
    })
  }
  const handleBifaDetail = (id, key, val) => {
    setBife(prev => ({ ...prev, [id]: { ...prev[id], [key]: val } }))
  }
  const addExtra = () => setExtra(p => [...p, { denumire:'', cod_piesa:'', cantitate:'' }])
  const updExtra = (idx, key, val) => setExtra(p => p.map((e, i) => i === idx ? { ...e, [key]: val } : e))
  const delExtra = (idx) => setExtra(p => p.filter((_, i) => i !== idx))

  const totalIntrari = Object.keys(bife).length + extra.filter(e => e.denumire.trim()).length

  const handleSave = async () => {
    if (!activId) { showToast('Selectează activul', 'error'); return }
    if (!dataFisei) { showToast('Completează data fișei', 'error'); return }
    if (totalIntrari === 0) { showToast('Bifează cel puțin un item sau adaugă unul custom', 'error'); return }
    if (status === 'finalizat') {
      showToast('Status "finalizat" se setează doar prin butonul de confirmare după creare', 'error'); return
    }

    setSaving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const titluFinal = titlu.trim() || `Service ${tip} · ${new Date(dataFisei).toLocaleDateString('ro-RO')}${numarFactura ? ' · F.' + numarFactura : ''}`

      const payloadFisa = {
        activ_id: Number(activId),
        data_fisei: dataFisei,
        titlu: titluFinal,
        tip,
        status,
        locatie_service: locatie.trim() || null,
        numar_factura: numarFactura.trim() || null,
        data_factura: dataFactura || null,
        suma_factura: sumaFactura !== '' ? Number(sumaFactura) : null,
        manopera: manopera !== '' ? Number(manopera) : null,
        diagnostic_lucrari: diagnostic.trim() || null,
        km_intrare: kmIntrare !== '' ? Number(kmIntrare) : null,
        km_iesire: kmIesire !== '' ? Number(kmIesire) : null,
        ore_intrare: oreIntrare !== '' ? Number(oreIntrare) : null,
        ore_iesire: oreIesire !== '' ? Number(oreIesire) : null,
        urmatoarea_km: urmKm !== '' ? Number(urmKm) : null,
        urmatoarea_ore: urmOre !== '' ? Number(urmOre) : null,
        urmatoarea_data: urmData || null,
        observatii: observatii.trim() || null,
        created_by: user?.id || null,
      }

      const { data: fisa, error: fErr } = await supabase
        .from('logistica_service_fise')
        .insert(payloadFisa)
        .select('*')
        .single()

      if (fErr) throw fErr

      const intrari = []
      for (const id in bife) {
        const b = bife[id]
        intrari.push({
          fisa_id: fisa.id,
          activ_id: Number(activId),
          tip,
          denumire: b.denumire,
          cod_piesa: b.cod_piesa?.trim() || null,
          cantitate: b.cantitate?.trim() || null,
          data: dataFisei,
          status,
        })
      }
      for (const e of extra) {
        if (!e.denumire.trim()) continue
        intrari.push({
          fisa_id: fisa.id,
          activ_id: Number(activId),
          tip,
          denumire: e.denumire.trim(),
          cod_piesa: e.cod_piesa?.trim() || null,
          cantitate: e.cantitate?.trim() || null,
          data: dataFisei,
          status,
        })
      }

      if (intrari.length > 0) {
        const { error: iErr } = await supabase.from('logistica_service_intrari').insert(intrari)
        if (iErr) throw iErr
      }

      await supabase
        .from('notifications')
        .update({ action_taken: true, read_at: new Date().toISOString() })
        .eq('type', 'logistica_lipsa_fisa_service')
        .eq('link_to', `/logistica?tab=service&activ_id=${activId}`)

      showToast(`✓ Fișă creată cu ${intrari.length} intrări`, 'success')
      onSaved()
    } catch (err) {
      showToast(`Eroare: ${err.message}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div onClick={onClose} style={{position:'fixed', inset:0, background:'#000000cc', zIndex:300, display:'flex', alignItems:'flex-start', justifyContent:'center', padding:'30px 16px', overflowY:'auto'}}>
      <div onClick={e => e.stopPropagation()} style={{...S.card, padding:22, width:'100%', maxWidth:920, boxShadow:'0 20px 80px rgba(0,0,0,.6)', borderTop:`3px solid ${G.logistica}`}}>

        <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:16, paddingBottom:14, borderBottom:`1px solid ${G.border}`}}>
          <div>
            <div style={{fontSize:18, fontWeight:800, color:G.text}}>➕ Fișă Service nouă</div>
            <div style={{fontSize:11, color:G.muted, marginTop:3}}>Bifează ce s-a făcut. Fiecare bifă = 1 piesă/intrare în fișă.</div>
          </div>
          <button onClick={onClose} style={{background:'transparent', border:'none', color:G.muted, fontSize:22, cursor:'pointer'}}>×</button>
        </div>

        <div style={{marginBottom:14}}>
          <div style={{fontSize:11, color:G.logistica, fontWeight:700, textTransform:'uppercase', letterSpacing:'.6px', marginBottom:8}}>Identificare</div>
          <div style={{marginBottom:10}}>
            <ComboboxActiv value={activId} onChange={setActivId} active={active} required />
          </div>
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:10}}>
            <FieldSelect label="Tip" value={tip} onChange={setTip} options={TIPURI} required />
            <FieldSelect label="Status la creare" value={status} onChange={setStatus} options={STATUSURI.filter(s => s.value !== 'finalizat')} required />
            <FieldText label="Data fișei" type="date" value={dataFisei} onChange={setDataFisei} required />
            <FieldText label="Titlu (auto dacă e gol)" value={titlu} onChange={setTitlu} placeholder="ex: Revizie 30k km" />
          </div>
        </div>

        <div style={{marginBottom:14}}>
          <div style={{fontSize:11, color:G.logistica, fontWeight:700, textTransform:'uppercase', letterSpacing:'.6px', marginBottom:8}}>Factură & locație</div>
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10, marginBottom:10}}>
            <FieldText label="Locație service" value={locatie} onChange={setLocatie} placeholder="ex: Service Auto Ploiești" />
            <FieldText label="Nr. factură" value={numarFactura} onChange={setNumarFactura} />
            <FieldText label="Data factură" type="date" value={dataFactura} onChange={setDataFactura} />
          </div>
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:10}}>
            <FieldText label="💰 Sumă totală factură (RON)" type="number" step="0.01" value={sumaFactura} onChange={setSumaFactura} />
            <FieldText label="Manoperă (RON)" type="number" step="0.01" value={manopera} onChange={setManopera} />
          </div>
        </div>

        <div style={{marginBottom:14}}>
          <div style={{fontSize:11, color:G.logistica, fontWeight:700, textTransform:'uppercase', letterSpacing:'.6px', marginBottom:8}}>Kilometraj / Ore funcționare</div>
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:10}}>
            <FieldText label="KM intrare" type="number" value={kmIntrare} onChange={setKmIntrare} />
            <FieldText label="KM ieșire" type="number" value={kmIesire} onChange={setKmIesire} />
            <FieldText label="Ore intrare" type="number" step="0.1" value={oreIntrare} onChange={setOreIntrare} />
            <FieldText label="Ore ieșire" type="number" step="0.1" value={oreIesire} onChange={setOreIesire} />
          </div>
        </div>

        <div style={{marginBottom:14}}>
          <FieldTextarea label="Diagnostic & lucrări efectuate" value={diagnostic} onChange={setDiagnostic} rows={3} placeholder="ex: Diagnostic — pierdere putere. Lucrări: schimb pompă combustibil + filtru motorină." />
        </div>

        <div style={{marginBottom:14}}>
          <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8}}>
            <div style={{fontSize:11, color:G.logistica, fontWeight:700, textTransform:'uppercase', letterSpacing:'.6px'}}>
              🔧 Itemi service ({totalIntrari} bifate)
            </div>
            {activSelected && Object.keys(smartFillMap).length > 0 && (
              <span style={{fontSize:10, color:G.green}}>↳ {Object.keys(smartFillMap).length} coduri din istoric (smart-fill)</span>
            )}
          </div>
          {!activId ? (
            <div style={{padding:20, textAlign:'center', color:G.muted, background:G.bg, border:`1px dashed ${G.border2}`, borderRadius:8, fontSize:13}}>
              Selectează un activ pentru a vedea itemii aplicabili
            </div>
          ) : Object.keys(grupuri).length === 0 ? (
            <div style={{padding:20, textAlign:'center', color:G.muted, fontSize:13}}>Niciun item preset aplicabil pentru această categorie</div>
          ) : (
            <div>
              {Object.entries(grupuri).map(([gr, items]) => (
                <GrupAccordion
                  key={gr}
                  grupa={gr}
                  items={items}
                  expanded={!!expanded[gr]}
                  onToggle={() => setExpanded(p => ({ ...p, [gr]: !p[gr] }))}
                  bife={bife}
                  onBifa={handleBifa}
                  onBifaDetail={handleBifaDetail}
                  smartFillMap={smartFillMap}
                />
              ))}
            </div>
          )}
        </div>

        <div style={{marginBottom:14}}>
          <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8}}>
            <div style={{fontSize:11, color:G.logistica, fontWeight:700, textTransform:'uppercase', letterSpacing:'.6px'}}>+ Itemi custom (ne-preset)</div>
            <button onClick={addExtra} style={{...S.btnS, padding:'4px 10px', fontSize:11}}>+ Adaugă</button>
          </div>
          {extra.length === 0 ? (
            <div style={{fontSize:12, color:G.dim, fontStyle:'italic', padding:'4px 0'}}>Nimic custom adăugat — folosește bifabilele de mai sus</div>
          ) : extra.map((e, i) => (
            <div key={i} style={{display:'grid', gridTemplateColumns:'2fr 1fr 1fr 30px', gap:6, marginBottom:6}}>
              <input placeholder="Denumire" value={e.denumire} onChange={ev => updExtra(i, 'denumire', ev.target.value)} style={{...S.input, padding:'6px 10px', fontSize:12}} />
              <input placeholder="Cod piesă" value={e.cod_piesa} onChange={ev => updExtra(i, 'cod_piesa', ev.target.value)} style={{...S.input, padding:'6px 10px', fontSize:12, fontFamily:'monospace'}} />
              <input placeholder="Cantitate" value={e.cantitate} onChange={ev => updExtra(i, 'cantitate', ev.target.value)} style={{...S.input, padding:'6px 10px', fontSize:12}} />
              <button onClick={() => delExtra(i)} style={{...S.btnS, padding:'4px 6px', fontSize:13, color:G.red}}>×</button>
            </div>
          ))}
        </div>

        <div style={{marginBottom:14}}>
          <div style={{fontSize:11, color:G.logistica, fontWeight:700, textTransform:'uppercase', letterSpacing:'.6px', marginBottom:8}}>📅 Următorul service (opțional — oricare)</div>
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10}}>
            <FieldText label="La KM" type="number" value={urmKm} onChange={setUrmKm} placeholder="ex: 60000" />
            <FieldText label="La ORE" type="number" value={urmOre} onChange={setUrmOre} placeholder="ex: 1500" />
            <FieldText label="La data" type="date" value={urmData} onChange={setUrmData} />
          </div>
        </div>

        <div style={{marginBottom:18}}>
          <FieldTextarea label="Observații" value={observatii} onChange={setObservatii} rows={2} />
        </div>

        <div style={{display:'flex', justifyContent:'space-between', gap:8, paddingTop:14, borderTop:`1px solid ${G.border}`}}>
          <div style={{fontSize:12, color:G.muted}}>
            {totalIntrari > 0 && <>📋 <strong style={{color:G.text}}>{totalIntrari}</strong> intrări vor fi create</>}
          </div>
          <div style={{display:'flex', gap:8}}>
            <button onClick={onClose} style={{...S.btnS, fontSize:13}} disabled={saving}>Anulează</button>
            <button onClick={handleSave} disabled={saving || !activId} style={{...S.btnP, background:G.logistica, color:'#000', opacity: (saving || !activId) ? .6 : 1}}>
              {saving ? '⏳ Se salvează...' : '✓ Creează fișă'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// MODAL: DETALIU FIȘĂ
// ════════════════════════════════════════════════════════════════════════════

function DetailFisaModal({ fisaId, canEdit, onClose, onSaved, showToast }) {
  const [fisa, setFisa] = useState(null)
  const [intrari, setIntrari] = useState([])
  const [kmOre, setKmOre] = useState(null) // ← Pachet C: km/ore live din v_active_km_ore
  const [load, setLoad] = useState(true)
  const [editMode, setEditMode] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmFinalize, setConfirmFinalize] = useState(false)
  const [form, setForm] = useState({})
  // ETAPA 12.5: Atașamente Fișa Service (PDF/poză scan-uri originale)
  const [atasamente, setAtasamente] = useState([])
  const [uploadingFile, setUploadingFile] = useState(false)
  const fileInputRef = useRef(null)
  // ETAPA 12.5: Ajustare rapidă km/ore activ DIN fișa service (fără să iesi)
  const [showAjustAct, setShowAjustAct] = useState(false)
  const [kmActivNou, setKmActivNou] = useState('')
  const [oreActivNou, setOreActivNou] = useState('')
  const [motivAjustActiv, setMotivAjustActiv] = useState('')
  const [savingAjustActiv, setSavingAjustActiv] = useState(false)

  const loadAll = useCallback(async () => {
    setLoad(true)
    const { data: f } = await supabase
      .from('logistica_service_fise')
      .select('*, logistica_active(id, cod_intern, nr_inventar, nr_inmatriculare, marca, model, km_actuali, ore_functionare_actuale, categorie_id, logistica_categorii:categorie_id(tip, subcategorie))')
      .eq('id', fisaId).single()
    const { data: ints } = await supabase
      .from('logistica_service_intrari')
      .select('*').eq('fisa_id', fisaId).order('id')

    // Pachet C: km/ore live din view
    let kmOreData = null
    if (f?.activ_id) {
      const { data: ko } = await supabase
        .from('v_active_km_ore')
        .select('km_live, ore_live')
        .eq('activ_id', f.activ_id)
        .maybeSingle()
      kmOreData = ko || null
    }

    // ETAPA 12.5: Fetch atașamente fișă
    const { data: ats } = await supabase
      .from('logistica_service_fise_documente')
      .select('*, autor:profiles!uploadat_de(name)')
      .eq('fisa_id', fisaId)
      .order('uploadat_la', { ascending: false })

    setFisa(f)
    setIntrari(ints || [])
    setKmOre(kmOreData)
    setAtasamente(ats || [])
    setForm({
      tip: f?.tip || 'mentenanta',
      data_fisei: f?.data_fisei || todayISO(),
      titlu: f?.titlu || '',
      locatie_service: f?.locatie_service || '',
      numar_factura: f?.numar_factura || '',
      data_factura: f?.data_factura || '',
      suma_factura: f?.suma_factura ?? '',
      manopera: f?.manopera ?? '',
      diagnostic_lucrari: f?.diagnostic_lucrari || '',
      km_intrare: f?.km_intrare ?? '',
      km_iesire: f?.km_iesire ?? '',
      ore_intrare: f?.ore_intrare ?? '',
      ore_iesire: f?.ore_iesire ?? '',
      urmatoarea_km: f?.urmatoarea_km ?? '',
      urmatoarea_ore: f?.urmatoarea_ore ?? '',
      urmatoarea_data: f?.urmatoarea_data || '',
      observatii: f?.observatii || '',
    })
    setLoad(false)
  }, [fisaId])

  useEffect(() => { loadAll() }, [loadAll])

  const setField = (k, v) => setForm(p => ({ ...p, [k]: v }))

  // ETAPA 12.5: Handler upload atașament
  const handleUploadAtasament = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = '' // reset input
    if (!file) return
    
    // Validări
    const validMime = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
    if (!validMime.includes(file.type)) {
      showToast('Acceptat: PDF, JPG, PNG, WEBP', 'warn'); return
    }
    if (file.size > 10 * 1024 * 1024) {
      showToast('Fișier max 10 MB', 'warn'); return
    }
    
    setUploadingFile(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const ts = Date.now()
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 80)
      const path = `${fisaId}/${ts}_${safeName}`
      
      // 1. Upload Storage
      const { error: upErr } = await supabase.storage
        .from('service-fise-documente')
        .upload(path, file, { contentType: file.type, upsert: false })
      if (upErr) throw upErr
      
      // 2. INSERT BD
      const { error: insErr } = await supabase
        .from('logistica_service_fise_documente')
        .insert({
          fisa_id: fisaId,
          fisier_path: path,
          fisier_nume: file.name,
          fisier_size_bytes: file.size,
          fisier_mime: file.type,
          uploadat_de: user?.id || null,
        })
      if (insErr) {
        // Rollback Storage dacă INSERT BD eșuează
        await supabase.storage.from('service-fise-documente').remove([path])
        throw insErr
      }
      
      showToast(`✓ Atașat: ${file.name}`, 'success')
      // Reload atașamente
      const { data: ats } = await supabase
        .from('logistica_service_fise_documente')
        .select('*, autor:profiles!uploadat_de(name)')
        .eq('fisa_id', fisaId)
        .order('uploadat_la', { ascending: false })
      setAtasamente(ats || [])
    } catch (err) {
      console.error('Upload atașament:', err)
      showToast(`Eroare upload: ${err.message || 'unknown'}`, 'error')
    }
    setUploadingFile(false)
  }
  
  // ETAPA 12.5: Handler vizualizare atașament (signed URL 60s)
  const handleViewAtasament = async (atas) => {
    const { data, error } = await supabase.storage
      .from('service-fise-documente')
      .createSignedUrl(atas.fisier_path, 60)
    if (error || !data?.signedUrl) {
      showToast('Nu pot deschide fișierul', 'error'); return
    }
    window.open(data.signedUrl, '_blank')
  }
  
  // ETAPA 12.5: Handler ștergere atașament
  const handleDeleteAtasament = async (atas) => {
    if (!confirm(`Ștergi atașamentul "${atas.fisier_nume}"?`)) return
    try {
      // 1. Delete BD (cascade-safe)
      const { error: delErr } = await supabase
        .from('logistica_service_fise_documente')
        .delete()
        .eq('id', atas.id)
      if (delErr) throw delErr
      
      // 2. Delete Storage (best-effort; nu eșuăm dacă fails)
      await supabase.storage.from('service-fise-documente').remove([atas.fisier_path])
      
      showToast('✓ Atașament șters', 'success')
      setAtasamente(prev => prev.filter(a => a.id !== atas.id))
    } catch (err) {
      console.error('Delete atașament:', err)
      showToast(`Eroare: ${err.message || 'unknown'}`, 'error')
    }
  }

  // ETAPA 12.5: Handler ajustare rapidă km/ore ACTIV din fișa service (cu audit)
  const handleAjustareKmOreActiv = async () => {
    if (!fisa?.activ_id) return
    const a = fisa.logistica_active || {}
    const kmCurent = a.km_actuali != null ? Number(a.km_actuali) : null
    const oreCurent = a.ore_functionare_actuale != null ? Number(a.ore_functionare_actuale) : null
    const kmNouNum = kmActivNou !== '' ? Number(kmActivNou) : null
    const oreNouNum = oreActivNou !== '' ? Number(oreActivNou) : null
    
    const kmModificat = kmNouNum !== null && kmNouNum !== kmCurent
    const oreModificat = oreNouNum !== null && oreNouNum !== oreCurent
    if (!kmModificat && !oreModificat) {
      showToast('Introdu cel puțin o valoare nouă diferită de cea curentă', 'warn'); return
    }
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
    
    setSavingAjustActiv(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      
      const auditPayload = {
        activ_id: fisa.activ_id,
        km_vechi: kmModificat ? kmCurent : null,
        km_nou: kmModificat ? kmNouNum : null,
        ore_vechi: oreModificat ? oreCurent : null,
        ore_nou: oreModificat ? oreNouNum : null,
        motiv: motivAjustActiv.trim() ? `[Din fișă #${fisa.id}] ${motivAjustActiv.trim()}` : `[Din fișă #${fisa.id}]`,
        created_by: user?.id || null,
      }
      const { error: auditErr } = await supabase.from('logistica_active_km_ore_ajustari').insert(auditPayload)
      if (auditErr) throw auditErr
      
      const updatePayload = {}
      if (kmModificat) updatePayload.km_actuali = kmNouNum
      if (oreModificat) updatePayload.ore_functionare_actuale = oreNouNum
      const { error: updErr } = await supabase.from('logistica_active').update(updatePayload).eq('id', fisa.activ_id)
      if (updErr) throw updErr
      
      showToast('✓ Km/ore activ ajustate (audit salvat)', 'success')
      setKmActivNou(''); setOreActivNou(''); setMotivAjustActiv('')
      setShowAjustAct(false)
      // Reload fișa ca să se actualizeze afișarea
      await loadAll()
      onSaved?.()
    } catch (e) {
      console.error('Eroare ajustare km/ore activ:', e)
      showToast(`Eroare: ${e.message || 'unknown'}`, 'error')
    }
    setSavingAjustActiv(false)
  }

  const saveEdits = async () => {
    setSaving(true)
    const payload = {
      tip: form.tip,
      data_fisei: form.data_fisei,
      titlu: form.titlu.trim() || null,
      locatie_service: form.locatie_service.trim() || null,
      numar_factura: form.numar_factura.trim() || null,
      data_factura: form.data_factura || null,
      suma_factura: form.suma_factura !== '' ? Number(form.suma_factura) : null,
      manopera: form.manopera !== '' ? Number(form.manopera) : null,
      diagnostic_lucrari: form.diagnostic_lucrari.trim() || null,
      km_intrare: form.km_intrare !== '' ? Number(form.km_intrare) : null,
      km_iesire: form.km_iesire !== '' ? Number(form.km_iesire) : null,
      ore_intrare: form.ore_intrare !== '' ? Number(form.ore_intrare) : null,
      ore_iesire: form.ore_iesire !== '' ? Number(form.ore_iesire) : null,
      urmatoarea_km: form.urmatoarea_km !== '' ? Number(form.urmatoarea_km) : null,
      urmatoarea_ore: form.urmatoarea_ore !== '' ? Number(form.urmatoarea_ore) : null,
      urmatoarea_data: form.urmatoarea_data || null,
      observatii: form.observatii.trim() || null,
    }
    const { error } = await supabase.from('logistica_service_fise').update(payload).eq('id', fisaId)
    setSaving(false)
    if (error) { showToast(`Eroare: ${error.message}`, 'error'); return }
    showToast('✓ Modificări salvate', 'success')
    setEditMode(false)
    loadAll()
    onSaved?.()
  }

  const handleFinalize = async () => {
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase
      .from('logistica_service_fise')
      .update({ status:'finalizat', finalizat_by: user?.id || null, finalizat_at: new Date().toISOString() })
      .eq('id', fisaId)
    if (!error) {
      await supabase.from('logistica_service_intrari').update({ status:'finalizat' }).eq('fisa_id', fisaId)
    }
    setSaving(false)
    if (error) { showToast(`Eroare: ${error.message}`, 'error'); return }
    showToast('✓ Fișă finalizată', 'success')
    setConfirmFinalize(false)
    loadAll()
    onSaved?.()
  }

  const handleStartLucru = async () => {
    setSaving(true)
    const { error } = await supabase.from('logistica_service_fise').update({ status:'in_lucru' }).eq('id', fisaId)
    if (!error) {
      await supabase.from('logistica_service_intrari').update({ status:'in_lucru' }).eq('fisa_id', fisaId)
    }
    setSaving(false)
    if (error) { showToast(`Eroare: ${error.message}`, 'error'); return }
    showToast('🔧 Status: în lucru', 'success')
    loadAll()
    onSaved?.()
  }

  const handleDeleteFisa = async () => {
    if (!confirm(`Ștergi fișa "${fisa.titlu || `#${fisa.id}`}" și toate cele ${intrari.length} intrări?\n\nAcțiunea NU poate fi anulată.`)) return
    setSaving(true)
    const { error } = await supabase.from('logistica_service_fise').delete().eq('id', fisaId)
    setSaving(false)
    if (error) { showToast(`Eroare: ${error.message}`, 'error'); return }
    showToast('✓ Fișă ștearsă', 'success')
    onSaved?.()
    onClose()
  }

  const updateIntrare = async (id, key, value) => {
    const { error } = await supabase.from('logistica_service_intrari').update({ [key]: value }).eq('id', id)
    if (error) { showToast(`Eroare: ${error.message}`, 'error'); return }
    setIntrari(p => p.map(i => i.id === id ? { ...i, [key]: value } : i))
  }
  const deleteIntrare = async (id) => {
    if (!confirm('Ștergi această intrare?')) return
    const { error } = await supabase.from('logistica_service_intrari').delete().eq('id', id)
    if (error) { showToast(`Eroare: ${error.message}`, 'error'); return }
    setIntrari(p => p.filter(i => i.id !== id))
    showToast('✓ Intrare ștearsă', 'success')
  }
  const addIntrare = async () => {
    const denumire = prompt('Denumire piesă/operație:')
    if (!denumire?.trim()) return
    const { data, error } = await supabase
      .from('logistica_service_intrari')
      .insert({
        fisa_id: fisaId,
        activ_id: fisa.activ_id,
        tip: fisa.tip,
        status: fisa.status,
        denumire: denumire.trim(),
        data: fisa.data_fisei,
      })
      .select('*').single()
    if (error) { showToast(`Eroare: ${error.message}`, 'error'); return }
    setIntrari(p => [...p, data])
    showToast('✓ Intrare adăugată', 'success')
  }

  if (load || !fisa) return (
    <div onClick={onClose} style={{position:'fixed', inset:0, background:'#000000cc', zIndex:300, display:'flex', alignItems:'center', justifyContent:'center'}}>
      <div style={{color:G.muted, fontSize:14}}>⏳ Se încarcă...</div>
    </div>
  )

  const a = fisa.logistica_active || {}
  const tipColor = fisa.tip === 'reparatie' ? G.orange : G.green
  const isReadonly = !editMode || !canEdit
  // Pachet C: folosim km/ore live din v_active_km_ore (a.km_actuali e 100% null)
  const urmService = calcUrmService(fisa, kmOre?.km_live, kmOre?.ore_live)
  // Valori afișate în header — preferăm live, fallback la coloana din active
  const kmAfisat = kmOre?.km_live ?? a.km_actuali
  const oreAfisat = kmOre?.ore_live ?? a.ore_functionare_actuale

  return (
    <div onClick={onClose} style={{position:'fixed', inset:0, background:'#000000cc', zIndex:300, display:'flex', alignItems:'flex-start', justifyContent:'center', padding:'30px 16px', overflowY:'auto'}}>
      <div onClick={e => e.stopPropagation()} style={{...S.card, padding:22, width:'100%', maxWidth:920, boxShadow:'0 20px 80px rgba(0,0,0,.6)', borderTop:`3px solid ${tipColor}`}}>

        <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:14, paddingBottom:14, borderBottom:`1px solid ${G.border}`}}>
          <div style={{flex:1, minWidth:0}}>
            <div style={{display:'flex', alignItems:'center', gap:10, marginBottom:6, flexWrap:'wrap'}}>
              <div style={{fontSize:18, fontWeight:800, color:G.text}}>{fisa.titlu || `Fișă #${fisa.id}`}</div>
              <TipBadge tip={fisa.tip} />
              <StatusBadge status={fisa.status} />
              {urmService && <UrmServiceBadge u={urmService} />}
            </div>
            <div style={{fontSize:13, color:G.muted}}>
              <strong style={{color:G.text}}>{a.marca} {a.model}</strong>
              {a.cod_intern && <span style={{color:G.logistica, fontFamily:'monospace', marginLeft:8}}>· {a.cod_intern}</span>}
              {a.nr_inmatriculare && <span style={{color:G.blue, fontFamily:'monospace', marginLeft:8}}>· {a.nr_inmatriculare}</span>}
              {a.nr_inventar && <span style={{color:G.muted, fontFamily:'monospace', marginLeft:8}}>· inv: {a.nr_inventar}</span>}
            </div>
            <div style={{fontSize:11, color:G.dim, marginTop:3}}>
              ID #{fisa.id} · {fmtDate(fisa.data_fisei)} · {intrari.length} intrări
              {kmAfisat != null && <span> · KM curent: <strong style={{color:G.muted}}>{Number(kmAfisat).toLocaleString('ro-RO')}</strong></span>}
              {oreAfisat != null && <span> · Ore curente: <strong style={{color:G.muted}}>{Number(oreAfisat).toLocaleString('ro-RO')}</strong></span>}
              {fisa.finalizat_at && ` · finalizat ${fmtDate(fisa.finalizat_at)}`}
            </div>
          </div>
          <div style={{display:'flex', gap:6}}>
            {canEdit && fisa.activ_id && (
              <button 
                onClick={() => setShowAjustAct(s => !s)} 
                style={{...S.btnS, fontSize:12, padding:'5px 10px', color: showAjustAct ? G.blue : G.muted, borderColor: showAjustAct ? G.blue : G.border}}
                title="Ajustare rapidă km/ore activ (cu audit)"
              >
                📏 {showAjustAct ? 'Ascunde' : 'Ajustează km/ore'}
              </button>
            )}
            {canEdit && !editMode && (
              <button onClick={() => setEditMode(true)} style={{...S.btnS, fontSize:12, padding:'5px 10px'}}>✎ Editează</button>
            )}
            <button onClick={onClose} style={{background:'transparent', border:'none', color:G.muted, fontSize:22, cursor:'pointer'}}>×</button>
          </div>
        </div>
        
        {/* ETAPA 12.5: Ajustare rapidă km/ore activ DIN fișa service (fără să iesi) */}
        {showAjustAct && canEdit && fisa.activ_id && (() => {
          const a = fisa.logistica_active || {}
          const kmManual = a.km_actuali != null ? Number(a.km_actuali) : null
          const oreManual = a.ore_functionare_actuale != null ? Number(a.ore_functionare_actuale) : null
          const oreLive = kmOre?.ore_live != null ? Number(kmOre.ore_live) : null
          const kmLive = kmOre?.km_live != null ? Number(kmOre.km_live) : null
          // Detectare polluare: diferență mare între live și manual înseamnă o fișă/alimentare istorică are valori greșite
          const orePollutat = oreLive != null && oreManual != null && (oreLive - oreManual) > 100000
          const kmPollutat = kmLive != null && kmManual != null && (kmLive - kmManual) > 100000
          return (
            <div style={{marginBottom: 14, background: G.bg, border: `2px dashed ${G.blue}55`, borderRadius: 10, padding: 14}}>
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10}}>
                <div>
                  <div style={{fontSize: 13, color: G.text, fontWeight: 700}}>📏 Ajustare km/ore activ (rapid)</div>
                  <div style={{fontSize: 11, color: G.muted, marginTop: 2}}>
                    Corectează valorile `logistica_active.km_actuali` și `ore_functionare_actuale` direct din fișă. Audit cu referință la fișa #{fisa.id}.
                  </div>
                </div>
              </div>
              
              {/* Discrepancy warning */}
              {(orePollutat || kmPollutat) && (
                <div style={{marginBottom: 10, padding: 10, background: G.yellow + '22', border: `1px solid ${G.yellow}55`, borderRadius: 8, fontSize: 11, color: G.text}}>
                  ⚠️ <strong>Valori inconsecvente detectate.</strong> View-ul `v_active_km_ore` calculează GREATEST din mai multe surse (manual, alimentări, fișe service, telemetrie).
                  {orePollutat && <div style={{marginTop: 4}}>🕒 Ore: <strong style={{color: G.muted}}>{oreManual?.toLocaleString('ro-RO')}</strong> (manual) vs <strong style={{color: G.red}}>{oreLive?.toLocaleString('ro-RO')}</strong> (live). Probabil o fișă service istorică are <code>ore_intrare/ore_iesire</code> polluat.</div>}
                  {kmPollutat && <div style={{marginTop: 4}}>🛣️ Km: <strong style={{color: G.muted}}>{kmManual?.toLocaleString('ro-RO')}</strong> (manual) vs <strong style={{color: G.red}}>{kmLive?.toLocaleString('ro-RO')}</strong> (live).</div>}
                  <div style={{marginTop: 6, fontSize: 10, color: G.muted}}>
                    💡 Ajustarea aici corectează doar `logistica_active`. Pentru valoarea „live" trebuie să editezi și fișele cu valori greșite (Edit → modifică Ore Intrare/Ore Ieșire).
                  </div>
                </div>
              )}
              
              {/* Valori curente compacte */}
              <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap: 10, marginBottom: 10}}>
                <div style={{background: G.surface, border: `1px solid ${G.border}`, borderRadius: 6, padding: '8px 10px'}}>
                  <div style={{fontSize: 9, color: G.muted, fontWeight: 700, textTransform: 'uppercase'}}>🛣️ KM Manual</div>
                  <div style={{fontSize: 16, fontWeight: 800, color: G.blue, fontVariantNumeric: 'tabular-nums'}}>
                    {kmManual != null ? kmManual.toLocaleString('ro-RO') : '—'}
                  </div>
                </div>
                <div style={{background: G.surface, border: `1px solid ${G.border}`, borderRadius: 6, padding: '8px 10px'}}>
                  <div style={{fontSize: 9, color: G.muted, fontWeight: 700, textTransform: 'uppercase'}}>🕒 Ore Manual</div>
                  <div style={{fontSize: 16, fontWeight: 800, color: G.orange, fontVariantNumeric: 'tabular-nums'}}>
                    {oreManual != null ? oreManual.toLocaleString('ro-RO') : '—'}
                  </div>
                </div>
              </div>
              
              <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap: 10, marginBottom: 8}}>
                <div>
                  <label style={{fontSize: 10, color: G.muted, fontWeight: 700, textTransform: 'uppercase', display: 'block', marginBottom: 4}}>Km nou (las gol = nemodificat)</label>
                  <input type="number" value={kmActivNou} onChange={e => setKmActivNou(e.target.value)} 
                    placeholder={kmManual != null ? `ex: ${kmManual.toLocaleString('ro-RO')}` : 'ex: 12500'}
                    style={{...S.input, width: '100%'}} />
                </div>
                <div>
                  <label style={{fontSize: 10, color: G.muted, fontWeight: 700, textTransform: 'uppercase', display: 'block', marginBottom: 4}}>Ore nou (las gol = nemodificat)</label>
                  <input type="number" value={oreActivNou} onChange={e => setOreActivNou(e.target.value)} 
                    placeholder={oreManual != null ? `ex: ${oreManual.toLocaleString('ro-RO')}` : 'ex: 2122'}
                    style={{...S.input, width: '100%'}} />
                </div>
              </div>
              <div style={{marginBottom: 8}}>
                <label style={{fontSize: 10, color: G.muted, fontWeight: 700, textTransform: 'uppercase', display: 'block', marginBottom: 4}}>Motiv (opțional dar recomandat)</label>
                <textarea value={motivAjustActiv} onChange={e => setMotivAjustActiv(e.target.value)} rows={2}
                  placeholder="ex: Polluare import XLSX vechi - ore_intrare era data formattată"
                  style={{...S.input, width: '100%', resize: 'vertical', fontFamily: 'inherit'}} />
              </div>
              <div style={{display:'flex', gap:8, justifyContent:'flex-end'}}>
                <button onClick={() => { setShowAjustAct(false); setKmActivNou(''); setOreActivNou(''); setMotivAjustActiv('') }} 
                  style={{...S.btnS, fontSize: 12}}>Anulează</button>
                <button 
                  onClick={handleAjustareKmOreActiv} 
                  disabled={savingAjustActiv || (kmActivNou === '' && oreActivNou === '')}
                  style={{
                    padding: '7px 14px', fontSize: 12, fontWeight: 700,
                    background: (kmActivNou === '' && oreActivNou === '') ? G.surface : G.blue,
                    color: (kmActivNou === '' && oreActivNou === '') ? G.muted : '#fff',
                    border: 'none', borderRadius: 6,
                    cursor: (savingAjustActiv || (kmActivNou === '' && oreActivNou === '')) ? 'not-allowed' : 'pointer',
                    opacity: savingAjustActiv ? 0.6 : 1,
                  }}
                >
                  {savingAjustActiv ? '⏳ Se salvează...' : '💾 Salvează ajustarea'}
                </button>
              </div>
            </div>
          )
        })()}

        {canEdit && fisa.status !== 'finalizat' && !editMode && (
          <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 14px', background:G.bg, border:`1px solid ${G.border}`, borderRadius:8, marginBottom:14}}>
            <div style={{fontSize:12, color:G.muted}}>
              {fisa.status === 'programat' ? '📅 Fișa e programată — apasă „Începe lucru" când startezi' : '🔧 Fișa e în lucru — apasă „Marchează finalizat" când termini'}
            </div>
            <div style={{display:'flex', gap:8}}>
              {fisa.status === 'programat' && (
                <button onClick={handleStartLucru} disabled={saving} style={{...S.btnS, fontSize:12, padding:'5px 12px', color:G.yellow, borderColor:G.yellow + '55'}}>🔧 Începe lucru</button>
              )}
              {!confirmFinalize ? (
                <button onClick={() => setConfirmFinalize(true)} style={{...S.btnP, padding:'6px 14px', fontSize:12, background:G.green}}>✓ Marchează finalizat</button>
              ) : (
                <>
                  <span style={{fontSize:12, color:G.yellow, fontWeight:600}}>Sigur?</span>
                  <button onClick={() => setConfirmFinalize(false)} style={{...S.btnS, padding:'5px 10px', fontSize:12}}>Anulează</button>
                  <button onClick={handleFinalize} disabled={saving} style={{...S.btnP, padding:'5px 12px', fontSize:12, background:G.green}}>{saving ? '⏳' : '✓ Confirm'}</button>
                </>
              )}
            </div>
          </div>
        )}

        <div style={{marginBottom:14}}>
          <div style={{fontSize:11, color:G.logistica, fontWeight:700, textTransform:'uppercase', letterSpacing:'.6px', marginBottom:8}}>Detalii</div>
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10, marginBottom:10}}>
            <FieldSelect label="Tip" value={form.tip} onChange={v => setField('tip', v)} options={TIPURI} readonly={isReadonly} />
            <FieldText label="Data fișei" type="date" value={form.data_fisei} onChange={v => setField('data_fisei', v)} readonly={isReadonly} />
            <FieldText label="Titlu" value={form.titlu} onChange={v => setField('titlu', v)} readonly={isReadonly} />
          </div>
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10, marginBottom:10}}>
            <FieldText label="Locație service" value={form.locatie_service} onChange={v => setField('locatie_service', v)} readonly={isReadonly} />
            <FieldText label="Nr. factură" value={form.numar_factura} onChange={v => setField('numar_factura', v)} readonly={isReadonly} />
            <FieldText label="Data factură" type="date" value={form.data_factura} onChange={v => setField('data_factura', v)} readonly={isReadonly} />
          </div>
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:10}}>
            <FieldText label="💰 Sumă totală factură (RON)" type="number" step="0.01" value={form.suma_factura} onChange={v => setField('suma_factura', v)} readonly={isReadonly} />
            <FieldText label="Manoperă (RON)" type="number" step="0.01" value={form.manopera} onChange={v => setField('manopera', v)} readonly={isReadonly} />
          </div>
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:10, marginBottom:10}}>
            <FieldText label="KM intrare" type="number" value={form.km_intrare} onChange={v => setField('km_intrare', v)} readonly={isReadonly} />
            <FieldText label="KM ieșire" type="number" value={form.km_iesire} onChange={v => setField('km_iesire', v)} readonly={isReadonly} />
            <FieldText label="Ore intrare" type="number" step="0.1" value={form.ore_intrare} onChange={v => setField('ore_intrare', v)} readonly={isReadonly} />
            <FieldText label="Ore ieșire" type="number" step="0.1" value={form.ore_iesire} onChange={v => setField('ore_iesire', v)} readonly={isReadonly} />
          </div>
          <div style={{marginBottom:10}}>
            <FieldTextarea label="Diagnostic & lucrări efectuate" value={form.diagnostic_lucrari} onChange={v => setField('diagnostic_lucrari', v)} rows={3} readonly={isReadonly} />
          </div>
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10, marginBottom:10}}>
            <FieldText label="Următor service la KM" type="number" value={form.urmatoarea_km} onChange={v => setField('urmatoarea_km', v)} readonly={isReadonly} />
            <FieldText label="Următor service la ORE" type="number" value={form.urmatoarea_ore} onChange={v => setField('urmatoarea_ore', v)} readonly={isReadonly} />
            <FieldText label="Următor service la data" type="date" value={form.urmatoarea_data} onChange={v => setField('urmatoarea_data', v)} readonly={isReadonly} />
          </div>
          <div>
            <FieldTextarea label="Observații" value={form.observatii} onChange={v => setField('observatii', v)} rows={2} readonly={isReadonly} />
          </div>
        </div>

        <div style={{marginBottom:14}}>
          <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8}}>
            <div style={{fontSize:11, color:G.logistica, fontWeight:700, textTransform:'uppercase', letterSpacing:'.6px'}}>📋 Piese & operații ({intrari.length})</div>
            {canEdit && (
              <button onClick={addIntrare} style={{...S.btnS, padding:'4px 10px', fontSize:11}}>+ Adaugă piesă</button>
            )}
          </div>
          {intrari.length === 0 ? (
            <div style={{padding:20, textAlign:'center', color:G.dim, fontSize:13, fontStyle:'italic'}}>Nicio piesă/operație în această fișă</div>
          ) : (
            <div style={{...S.card, overflow:'hidden'}}>
              <table style={{width:'100%', borderCollapse:'collapse', fontSize:12}}>
                <thead>
                  <tr style={{background:G.bg}}>
                    <th style={{padding:'6px 8px', textAlign:'left', color:G.muted, fontSize:10, textTransform:'uppercase', borderBottom:`1px solid ${G.border}`}}>Denumire</th>
                    <th style={{padding:'6px 8px', textAlign:'left', color:G.muted, fontSize:10, textTransform:'uppercase', borderBottom:`1px solid ${G.border}`, width:140}}>Cod piesă</th>
                    <th style={{padding:'6px 8px', textAlign:'left', color:G.muted, fontSize:10, textTransform:'uppercase', borderBottom:`1px solid ${G.border}`, width:90}}>Cantitate</th>
                    {canEdit && <th style={{width:30, padding:'6px 8px', borderBottom:`1px solid ${G.border}`}}></th>}
                  </tr>
                </thead>
                <tbody>
                  {intrari.map(it => (
                    <tr key={it.id} style={{borderBottom:`1px solid ${G.border}`}}>
                      <td style={{padding:'6px 8px', color:G.text}}>
                        {canEdit ? (
                          <input value={it.denumire || ''} onChange={e => setIntrari(p => p.map(x => x.id === it.id ? {...x, denumire: e.target.value} : x))}
                            onBlur={e => updateIntrare(it.id, 'denumire', e.target.value)}
                            style={{...S.input, padding:'4px 8px', fontSize:12, background:'transparent', border:'1px solid transparent'}}
                            onFocus={e => e.target.style.border = `1px solid ${G.border2}`}
                            onMouseEnter={e => e.target.style.background = G.bg} onMouseLeave={e => e.target.style.background = 'transparent'}/>
                        ) : (it.denumire || '—')}
                      </td>
                      <td style={{padding:'6px 8px', fontFamily:'monospace', color: it.cod_piesa ? G.text : G.dim}}>
                        {canEdit ? (
                          <input value={it.cod_piesa || ''} onChange={e => setIntrari(p => p.map(x => x.id === it.id ? {...x, cod_piesa: e.target.value} : x))}
                            onBlur={e => updateIntrare(it.id, 'cod_piesa', e.target.value || null)}
                            style={{...S.input, padding:'4px 8px', fontSize:12, fontFamily:'monospace', background:'transparent', border:'1px solid transparent'}}
                            onFocus={e => e.target.style.border = `1px solid ${G.border2}`}
                            onMouseEnter={e => e.target.style.background = G.bg} onMouseLeave={e => e.target.style.background = 'transparent'}
                            placeholder="—" />
                        ) : (it.cod_piesa || '—')}
                      </td>
                      <td style={{padding:'6px 8px', color: it.cantitate ? G.text : G.dim}}>
                        {canEdit ? (
                          <input value={it.cantitate || ''} onChange={e => setIntrari(p => p.map(x => x.id === it.id ? {...x, cantitate: e.target.value} : x))}
                            onBlur={e => updateIntrare(it.id, 'cantitate', e.target.value || null)}
                            style={{...S.input, padding:'4px 8px', fontSize:12, background:'transparent', border:'1px solid transparent'}}
                            onFocus={e => e.target.style.border = `1px solid ${G.border2}`}
                            onMouseEnter={e => e.target.style.background = G.bg} onMouseLeave={e => e.target.style.background = 'transparent'}
                            placeholder="—" />
                        ) : (it.cantitate || '—')}
                      </td>
                      {canEdit && (
                        <td style={{padding:'6px 4px', textAlign:'center'}}>
                          <button onClick={() => deleteIntrare(it.id)} style={{background:'transparent', border:'none', color:G.red, cursor:'pointer', fontSize:14}}>×</button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ETAPA 12.5: Atașamente Fișa Service (PDF/poză scan-uri originale) */}
        <div style={{marginBottom: 14, background: G.surface, border: `1px solid ${G.border}`, borderRadius: 10, padding: 14}}>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: 10}}>
            <div>
              <div style={{fontSize: 13, color: G.text, fontWeight: 700}}>📎 Documente atașate ({atasamente.length})</div>
              <div style={{fontSize: 11, color: G.muted, marginTop: 2}}>
                Scan-uri originale, facturi service, poze utilaj înainte/după. Max 10MB per fișier (PDF/JPG/PNG/WEBP).
              </div>
            </div>
            {canEdit && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,image/jpeg,image/png,image/webp"
                  onChange={handleUploadAtasament}
                  style={{display: 'none'}}
                />
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingFile}
                  style={{
                    padding: '8px 14px', fontSize: 12, fontWeight: 700,
                    background: G.logistica, color: '#000', border: 'none',
                    borderRadius: 8, cursor: uploadingFile ? 'wait' : 'pointer',
                    opacity: uploadingFile ? 0.6 : 1,
                  }}
                >
                  {uploadingFile ? '⏳ Upload...' : '➕ Atașează fișier'}
                </button>
              </>
            )}
          </div>
          
          {atasamente.length === 0 ? (
            <div style={{fontSize: 11, color: G.muted, fontStyle: 'italic', padding: '8px 0'}}>
              Niciun atașament. {canEdit && 'Folosește butonul „➕ Atașează fișier" pentru a urca PDF/poză.'}
            </div>
          ) : (
            <div style={{display: 'flex', flexDirection: 'column', gap: 6}}>
              {atasamente.map(atas => {
                const isImg = atas.fisier_mime?.startsWith('image/')
                const icon = isImg ? '🖼️' : '📄'
                const sizeKB = atas.fisier_size_bytes ? Math.round(atas.fisier_size_bytes / 1024) : 0
                return (
                  <div key={atas.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 12px', background: G.bg, border: `1px solid ${G.border}`, borderRadius: 6,
                  }}>
                    <div style={{fontSize: 18}}>{icon}</div>
                    <div style={{flex: 1, minWidth: 0}}>
                      <div style={{fontSize: 12, color: G.text, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}} title={atas.fisier_nume}>
                        {atas.fisier_nume}
                      </div>
                      <div style={{fontSize: 10, color: G.muted, marginTop: 2}}>
                        {sizeKB ? `${sizeKB.toLocaleString('ro-RO')} KB` : ''} 
                        {atas.autor?.name && ` · uploadat de ${atas.autor.name}`}
                        {atas.uploadat_la && ` · ${new Date(atas.uploadat_la).toLocaleDateString('ro-RO')}`}
                      </div>
                    </div>
                    <button 
                      onClick={() => handleViewAtasament(atas)}
                      style={{...S.btnS, padding: '5px 10px', fontSize: 11, color: G.blue, borderColor: G.blue + '55'}}
                      title="Deschide într-un tab nou"
                    >
                      📥 Vezi
                    </button>
                    {canEdit && (
                      <button 
                        onClick={() => handleDeleteAtasament(atas)}
                        style={{...S.btnS, padding: '5px 8px', fontSize: 12, color: G.red, borderColor: G.red + '44'}}
                        title="Șterge atașament"
                      >
                        🗑
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div style={{display:'flex', justifyContent:'space-between', gap:8, paddingTop:14, borderTop:`1px solid ${G.border}`}}>
          <div style={{display:'flex', gap:8}}>
            {/* ETAPA 8.7: Export PDF fișă */}
            <button 
              onClick={() => generateServicePDF(fisa, intrari, a, showToast)} 
              style={{...S.btnS, fontSize:12, color:G.red, borderColor:G.red + '44'}}
              title="Export PDF cu semnături">
              📄 Export PDF
            </button>
            {canEdit && editMode && (
              <button onClick={handleDeleteFisa} style={{...S.btnS, fontSize:12, color:G.red, borderColor:G.red + '55'}}>🗑 Șterge fișă</button>
            )}
          </div>
          <div style={{display:'flex', gap:8}}>
            {editMode ? (
              <>
                <button onClick={() => { setEditMode(false); loadAll() }} style={{...S.btnS, fontSize:13}} disabled={saving}>Anulează</button>
                <button onClick={saveEdits} disabled={saving} style={{...S.btnP, background:G.logistica, color:'#000'}}>
                  {saving ? '⏳ Se salvează...' : '✓ Salvează'}
                </button>
              </>
            ) : (
              <button onClick={onClose} style={{...S.btnS, fontSize:13}}>Închide</button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// MODAL: ACOPERIRE FLOTĂ
// ════════════════════════════════════════════════════════════════════════════

function AcoperireFlotaModal({ active, fiseCountByActiv, canEdit, onClose, onCreateFor }) {
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('Toate')

  const fara = useMemo(() => {
    return active.filter(a => !fiseCountByActiv[a.id] || fiseCountByActiv[a.id] === 0)
  }, [active, fiseCountByActiv])

  const filtered = useMemo(() => {
    let r = fara
    if (catFilter !== 'Toate') r = r.filter(a => a.categorie?.tip === catFilter)
    if (search) {
      const q = norm(search)
      r = r.filter(a => norm([a.cod_intern, a.nr_inmatriculare, a.marca, a.model].filter(Boolean).join(' ')).includes(q))
    }
    return r
  }, [fara, catFilter, search])

  return (
    <div onClick={onClose} style={{position:'fixed', inset:0, background:'#000000cc', zIndex:300, display:'flex', alignItems:'flex-start', justifyContent:'center', padding:'30px 16px', overflowY:'auto'}}>
      <div onClick={e => e.stopPropagation()} style={{...S.card, padding:22, width:'100%', maxWidth:880, boxShadow:'0 20px 80px rgba(0,0,0,.6)', borderTop:`3px solid ${G.red}`}}>

        <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:14, paddingBottom:14, borderBottom:`1px solid ${G.border}`}}>
          <div>
            <div style={{fontSize:18, fontWeight:800, color:G.text, marginBottom:4}}>📊 Acoperire flotă</div>
            <div style={{fontSize:12, color:G.muted}}>
              <strong style={{color:G.red}}>{fara.length}</strong> active fără fișă din {active.length} totale
              ({Math.round((1 - fara.length / Math.max(active.length, 1)) * 100)}% acoperire)
            </div>
          </div>
          <button onClick={onClose} style={{background:'transparent', border:'none', color:G.muted, fontSize:22, cursor:'pointer'}}>×</button>
        </div>

        <div style={{display:'flex', gap:8, marginBottom:12, flexWrap:'wrap'}}>
          <input placeholder="🔍 Caută cod TST, plăcuță, marcă..." value={search} onChange={e => setSearch(e.target.value)} style={{...S.input, width:280}} />
          <select value={catFilter} onChange={e => setCatFilter(e.target.value)} style={{...S.input, width:'auto', padding:'7px 11px', fontSize:13, cursor:'pointer'}}>
            <option value="Toate">Toate categoriile</option>
            {CATEGORII.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {filtered.length === 0 ? (
          <div style={{padding:40, textAlign:'center', color:G.muted}}>
            <div style={{fontSize:32, marginBottom:8}}>{fara.length === 0 ? '🎉' : '🔍'}</div>
            <div>{fara.length === 0 ? 'Toate activele au fișă service!' : 'Niciun rezultat pentru filtrele aplicate'}</div>
          </div>
        ) : (
          <div style={{...S.card, overflow:'hidden', maxHeight:'55vh', overflowY:'auto'}}>
            <table style={{width:'100%', borderCollapse:'collapse', fontSize:12}}>
              <thead style={{position:'sticky', top:0}}>
                <tr style={{background:G.surface}}>
                  <th style={{padding:'8px', textAlign:'left', color:G.muted, fontSize:10, textTransform:'uppercase', borderBottom:`1px solid ${G.border}`}}>Cod TST</th>
                  <th style={{padding:'8px', textAlign:'left', color:G.muted, fontSize:10, textTransform:'uppercase', borderBottom:`1px solid ${G.border}`}}>Plăcuță</th>
                  <th style={{padding:'8px', textAlign:'left', color:G.muted, fontSize:10, textTransform:'uppercase', borderBottom:`1px solid ${G.border}`}}>Marcă · Model</th>
                  <th style={{padding:'8px', textAlign:'left', color:G.muted, fontSize:10, textTransform:'uppercase', borderBottom:`1px solid ${G.border}`}}>Categorie</th>
                  <th style={{padding:'8px', textAlign:'right', color:G.muted, fontSize:10, textTransform:'uppercase', borderBottom:`1px solid ${G.border}`, width:120}}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(a => (
                  <tr key={a.id} style={{borderBottom:`1px solid ${G.border}`}}
                      onMouseEnter={e => e.currentTarget.style.background = G.bg}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <td style={{padding:'8px', fontFamily:'monospace', color:G.logistica, fontWeight:700}}>{a.cod_intern || '—'}</td>
                    <td style={{padding:'8px', fontFamily:'monospace', color:G.blue}}>{a.nr_inmatriculare || '—'}</td>
                    <td style={{padding:'8px', color:G.text}}>{a.marca} {a.model}</td>
                    <td style={{padding:'8px', color:G.muted, fontSize:11}}>
                      {a.categorie?.tip}
                      {a.categorie?.subcategorie && <span style={{color:G.dim, marginLeft:4}}>· {a.categorie.subcategorie}</span>}
                    </td>
                    <td style={{padding:'8px', textAlign:'right'}}>
                      {canEdit && (
                        <button onClick={() => onCreateFor(a.id)} style={{...S.btnS, padding:'4px 10px', fontSize:11, color:G.green, borderColor:G.green + '55'}}>
                          + Creează fișă
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// COMPONENTUL PRINCIPAL: SERVICE TAB
// ════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════
// ETAPA 8.7: GENERARE PDF FIȘĂ SERVICE
// ════════════════════════════════════════════════════════════════════════════
// Pattern din generateOrdinePDF (App.jsx): HTML offscreen → html2canvas → jsPDF
// Semnatari hardcoded: MITRACHE ALEXANDRU (Director Dep Logistica) + 
// OANCEA IONUT DANIEL (Junior Dep Logistica). Lookup semnături via 
// hr_semnaturi_electronice (employee_id + activ=true). Dacă lipsesc → linie pentru semnătură manuală.

const SEMNATARI_SERVICE_PDF = {
  director: { id: 71, name: 'MITRACHE ALEXANDRU', functie: 'Director Departament Logistică', prefix: 'ing.' },
  junior: { id: 86, name: 'OANCEA IONUȚ DANIEL', functie: 'Junior Departament Logistică', prefix: '' },
}

async function fetchSignatureAsDataURL(fisierPath) {
  if (!fisierPath) return null
  try {
    const { data } = await supabase.storage.from('hr-semnaturi').createSignedUrl(fisierPath, 60)
    if (!data?.signedUrl) return null
    const resp = await fetch(data.signedUrl)
    const blob = await resp.blob()
    return new Promise(res => {
      const reader = new FileReader()
      reader.onloadend = () => res(reader.result)
      reader.onerror = () => res(null)
      reader.readAsDataURL(blob)
    })
  } catch (e) {
    console.warn('fetchSignatureAsDataURL err:', e)
    return null
  }
}

async function generateServicePDF(fisa, intrari, activ, showToast) {
  showToast('⏳ Generare PDF fișă service...', 'info')
  try {
    // Lookup semnături active
    const { data: sem } = await supabase
      .from('hr_semnaturi_electronice')
      .select('employee_id, fisier_path')
      .in('employee_id', [SEMNATARI_SERVICE_PDF.director.id, SEMNATARI_SERVICE_PDF.junior.id])
      .eq('activ', true)
    
    const semDirector = sem?.find(s => s.employee_id === SEMNATARI_SERVICE_PDF.director.id)
    const semJunior = sem?.find(s => s.employee_id === SEMNATARI_SERVICE_PDF.junior.id)
    
    const [semDirectorURL, semJuniorURL] = await Promise.all([
      semDirector ? fetchSignatureAsDataURL(semDirector.fisier_path) : Promise.resolve(null),
      semJunior ? fetchSignatureAsDataURL(semJunior.fisier_path) : Promise.resolve(null),
    ])
    
    // Build HTML offscreen
    const html = document.createElement('div')
    html.style.cssText = 'position:fixed;top:-99999px;left:0;width:794px;background:#fff;color:#000;font-family:Arial,sans-serif;padding:28px;box-sizing:border-box;'
    
    const escapeHtml = (str) => String(str ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]))
    
    html.innerHTML = `
      <div style="border-bottom:2px solid #000;padding-bottom:8px;margin-bottom:14px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-end;">
          <div>
            <div style="font-size:9px;color:#666;">GAZPET INSTAL SRL · DEPARTAMENT LOGISTICĂ</div>
            <div style="font-size:18px;font-weight:bold;margin-top:4px;">FIȘĂ SERVICE</div>
            <div style="font-size:11px;color:#333;">${fisa.tip === 'reparatie' ? '⚙ Reparație' : '🔧 Mentenanță'} · #${fisa.id}</div>
          </div>
          <div style="text-align:right;font-size:10px;color:#666;">
            <div>Data fișei: <strong style="color:#000;">${fisa.data_fisei ? new Date(fisa.data_fisei).toLocaleDateString('ro-RO') : '—'}</strong></div>
            <div>Status: <strong style="color:#000;">${escapeHtml(fisa.status)}</strong></div>
            ${fisa.finalizat_at ? `<div>Finalizat: <strong style="color:#000;">${new Date(fisa.finalizat_at).toLocaleDateString('ro-RO')}</strong></div>` : ''}
          </div>
        </div>
      </div>
      
      <div style="background:#f3f4f6;padding:10px 14px;border-radius:4px;margin-bottom:12px;">
        <div style="font-size:9px;color:#666;text-transform:uppercase;margin-bottom:4px;letter-spacing:.5px;">UTILAJ / VEHICUL</div>
        <div style="font-size:14px;font-weight:bold;">${escapeHtml((activ.marca || '') + ' ' + (activ.model || ''))}</div>
        <div style="font-size:11px;color:#444;margin-top:4px;">
          ${activ.cod_intern ? `Cod intern: <strong>${escapeHtml(activ.cod_intern)}</strong>` : ''}
          ${activ.nr_inmatriculare ? ` · Plăcuță: <strong>${escapeHtml(activ.nr_inmatriculare)}</strong>` : ''}
          ${activ.nr_inventar ? ` · Inv: <strong>${escapeHtml(activ.nr_inventar)}</strong>` : ''}
          ${activ.an_fabricatie ? ` · An: <strong>${activ.an_fabricatie}</strong>` : ''}
        </div>
      </div>
      
      <table style="width:100%;border-collapse:collapse;font-size:10px;margin-bottom:12px;">
        <tr>
          <td style="border:1px solid #999;padding:5px 8px;background:#fafafa;width:28%;"><strong>Titlu lucrări</strong></td>
          <td style="border:1px solid #999;padding:5px 8px;">${escapeHtml(fisa.titlu) || '—'}</td>
        </tr>
        <tr>
          <td style="border:1px solid #999;padding:5px 8px;background:#fafafa;"><strong>Locație service</strong></td>
          <td style="border:1px solid #999;padding:5px 8px;">${escapeHtml(fisa.locatie_service) || '—'}</td>
        </tr>
        <tr>
          <td style="border:1px solid #999;padding:5px 8px;background:#fafafa;"><strong>Factură</strong></td>
          <td style="border:1px solid #999;padding:5px 8px;">${escapeHtml(fisa.numar_factura) || '—'}${fisa.data_factura ? ' · ' + new Date(fisa.data_factura).toLocaleDateString('ro-RO') : ''}</td>
        </tr>
        <tr>
          <td style="border:1px solid #999;padding:5px 8px;background:#fafafa;"><strong>Sumă totală</strong></td>
          <td style="border:1px solid #999;padding:5px 8px;font-weight:bold;color:#16a34a;">
            ${fisa.suma_factura != null ? Number(fisa.suma_factura).toLocaleString('ro-RO', { minimumFractionDigits: 2 }) + ' RON' : '—'}
            ${fisa.manopera != null ? ` <span style="color:#666;font-weight:normal;font-size:9px;">(manoperă: ${Number(fisa.manopera).toLocaleString('ro-RO', { minimumFractionDigits: 2 })} RON)</span>` : ''}
          </td>
        </tr>
        <tr>
          <td style="border:1px solid #999;padding:5px 8px;background:#fafafa;"><strong>KM intrare → ieșire</strong></td>
          <td style="border:1px solid #999;padding:5px 8px;">
            ${fisa.km_intrare != null ? Number(fisa.km_intrare).toLocaleString('ro-RO') + ' km' : '—'} → ${fisa.km_iesire != null ? Number(fisa.km_iesire).toLocaleString('ro-RO') + ' km' : '—'}
          </td>
        </tr>
        ${(fisa.ore_intrare != null || fisa.ore_iesire != null) ? `
        <tr>
          <td style="border:1px solid #999;padding:5px 8px;background:#fafafa;"><strong>Ore intrare → ieșire</strong></td>
          <td style="border:1px solid #999;padding:5px 8px;">${fisa.ore_intrare != null ? Number(fisa.ore_intrare) + ' h' : '—'} → ${fisa.ore_iesire != null ? Number(fisa.ore_iesire) + ' h' : '—'}</td>
        </tr>` : ''}
      </table>
      
      ${fisa.diagnostic_lucrari ? `
        <div style="margin-bottom:12px;">
          <div style="font-size:9px;color:#666;text-transform:uppercase;margin-bottom:4px;letter-spacing:.5px;">DIAGNOSTIC & LUCRĂRI EFECTUATE</div>
          <div style="font-size:11px;padding:8px 12px;border:1px solid #ccc;border-left:3px solid #16a34a;background:#fafafa;white-space:pre-wrap;">${escapeHtml(fisa.diagnostic_lucrari)}</div>
        </div>
      ` : ''}
      
      ${intrari.length > 0 ? `
        <div style="margin-bottom:12px;">
          <div style="font-size:9px;color:#666;text-transform:uppercase;margin-bottom:4px;letter-spacing:.5px;">PIESE & OPERAȚII (${intrari.length})</div>
          <table style="width:100%;border-collapse:collapse;font-size:9px;">
            <thead>
              <tr style="background:#1f2937;color:#fff;">
                <th style="padding:6px 8px;text-align:left;width:40px;">Nr</th>
                <th style="padding:6px 8px;text-align:left;">Denumire</th>
                <th style="padding:6px 8px;text-align:left;width:140px;">Cod piesă</th>
                <th style="padding:6px 8px;text-align:left;width:80px;">Cantitate</th>
              </tr>
            </thead>
            <tbody>
              ${intrari.map((i, idx) => `
                <tr style="${idx % 2 === 0 ? 'background:#fff' : 'background:#f9fafb'}">
                  <td style="padding:5px 8px;border-bottom:1px solid #ddd;">${idx + 1}</td>
                  <td style="padding:5px 8px;border-bottom:1px solid #ddd;">${escapeHtml(i.denumire) || '—'}</td>
                  <td style="padding:5px 8px;border-bottom:1px solid #ddd;font-family:monospace;">${escapeHtml(i.cod_piesa) || '—'}</td>
                  <td style="padding:5px 8px;border-bottom:1px solid #ddd;">${escapeHtml(i.cantitate) || '—'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : ''}
      
      ${(fisa.urmatoarea_km || fisa.urmatoarea_data || fisa.urmatoarea_ore) ? `
        <div style="margin-bottom:12px;padding:8px 12px;background:#fef3c7;border-left:3px solid #f59e0b;font-size:10px;">
          <strong>📅 Următorul service:</strong>
          ${fisa.urmatoarea_km ? ` la <strong>${Number(fisa.urmatoarea_km).toLocaleString('ro-RO')} km</strong>` : ''}
          ${fisa.urmatoarea_ore ? `${fisa.urmatoarea_km ? ' sau' : ''} la <strong>${Number(fisa.urmatoarea_ore)} ore</strong>` : ''}
          ${fisa.urmatoarea_data ? `${(fisa.urmatoarea_km || fisa.urmatoarea_ore) ? ' sau' : ''} pe <strong>${new Date(fisa.urmatoarea_data).toLocaleDateString('ro-RO')}</strong>` : ''}
        </div>
      ` : ''}
      
      ${fisa.observatii ? `
        <div style="margin-bottom:12px;">
          <div style="font-size:9px;color:#666;text-transform:uppercase;margin-bottom:4px;letter-spacing:.5px;">OBSERVAȚII</div>
          <div style="font-size:10px;padding:8px 12px;border:1px solid #ccc;background:#fafafa;white-space:pre-wrap;">${escapeHtml(fisa.observatii)}</div>
        </div>
      ` : ''}
      
      <div style="display:flex;justify-content:space-around;margin-top:42px;padding-top:18px;border-top:2px solid #000;">
        <div style="text-align:center;width:45%;">
          <div style="height:54px;display:flex;align-items:flex-end;justify-content:center;">
            ${semDirectorURL ? `<img src="${semDirectorURL}" style="max-height:54px;max-width:160px;" />` : '<div style="border-bottom:1px solid #999;width:160px;height:1px;margin-bottom:3px;"></div>'}
          </div>
          <div style="font-size:9px;color:#666;margin-top:6px;text-transform:uppercase;letter-spacing:.5px;">${SEMNATARI_SERVICE_PDF.director.functie}</div>
          <div style="font-size:11px;font-weight:bold;margin-top:2px;">${SEMNATARI_SERVICE_PDF.director.prefix} ${SEMNATARI_SERVICE_PDF.director.name}</div>
        </div>
        <div style="text-align:center;width:45%;">
          <div style="height:54px;display:flex;align-items:flex-end;justify-content:center;">
            ${semJuniorURL ? `<img src="${semJuniorURL}" style="max-height:54px;max-width:160px;" />` : '<div style="border-bottom:1px solid #999;width:160px;height:1px;margin-bottom:3px;"></div>'}
          </div>
          <div style="font-size:9px;color:#666;margin-top:6px;text-transform:uppercase;letter-spacing:.5px;">${SEMNATARI_SERVICE_PDF.junior.functie}</div>
          <div style="font-size:11px;font-weight:bold;margin-top:2px;">${SEMNATARI_SERVICE_PDF.junior.name}</div>
        </div>
      </div>
      
      <div style="margin-top:14px;text-align:center;font-size:8px;color:#999;">
        Generat automat din Gazpet ERP · ${new Date().toLocaleString('ro-RO')} · Fișa #${fisa.id}
      </div>
    `
    document.body.appendChild(html)
    
    // Aștept 2x RAF pentru layout
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    
    // Canvas
    const canvas = await html2canvas(html, { scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false })
    document.body.removeChild(html)
    
    // PDF A4 portrait
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const pdfHeight = (canvas.height / canvas.width) * 210
    pdf.addImage(canvas.toDataURL('image/png', 0.95), 'PNG', 0, 0, 210, Math.min(pdfHeight, 297), undefined, 'FAST')
    
    const safeFile = (s) => String(s || '').replace(/[^a-zA-Z0-9._-]/g, '_')
    const fileName = `FisaService_${safeFile(activ.cod_intern || activ.nr_inmatriculare || activ.id)}_${fisa.data_fisei || 'undated'}_${fisa.id}.pdf`
    pdf.save(fileName)
    showToast(`✓ PDF generat: ${fileName}`, 'success')
  } catch (e) {
    console.error('generateServicePDF err:', e)
    showToast('Eroare la generare PDF: ' + (e.message || 'necunoscută'), 'error')
  }
}

// ════════════════════════════════════════════════════════════════════════════
// ETAPA 8.7: MODAL ISTORIC SERVICE PER UTILAJ
// ════════════════════════════════════════════════════════════════════════════
// Listă cronologică toate fișele service pentru un utilaj. Date deja există în BD.
// Util pentru a vedea evoluția mentenanței + tendințe + total cheltuieli per utilaj.

function IstoricServiceModal({ activ, onClose, onOpenFisa, showToast }) {
  const [fise, setFise] = useState([])
  const [loading, setLoading] = useState(true)
  
  useEffect(() => {
    if (!activ?.id) return
    setLoading(true)
    supabase.from('logistica_service_fise')
      .select('*, logistica_service_intrari(id, denumire, cod_piesa, cantitate)')
      .eq('activ_id', activ.id)
      .order('data_fisei', { ascending: false })
      .order('id', { ascending: false })
      .then(({ data, error }) => {
        if (error) showToast(`Eroare istoric: ${error.message}`, 'error')
        setFise(data || [])
        setLoading(false)
      })
  }, [activ?.id, showToast])
  
  const stats = useMemo(() => {
    const total = fise.length
    const totalSum = fise.reduce((s, f) => s + Number(f.suma_factura || 0), 0)
    const totalManopera = fise.reduce((s, f) => s + Number(f.manopera || 0), 0)
    const finalizate = fise.filter(f => f.status === 'finalizat').length
    const mentenante = fise.filter(f => f.tip === 'mentenanta').length
    const reparatii = fise.filter(f => f.tip === 'reparatie').length
    return { total, totalSum, totalManopera, finalizate, mentenante, reparatii }
  }, [fise])
  
  return (
    <div onClick={onClose} style={{position:'fixed', inset:0, background:'#000000cc', zIndex:300, display:'flex', alignItems:'flex-start', justifyContent:'center', padding:'30px 16px', overflowY:'auto'}}>
      <div onClick={e => e.stopPropagation()} style={{...S.card, padding:22, width:'100%', maxWidth:1000, boxShadow:'0 20px 80px rgba(0,0,0,.6)', borderTop:`3px solid ${G.logistica}`}}>
        
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:14, paddingBottom:14, borderBottom:`1px solid ${G.border}`}}>
          <div style={{flex:1, minWidth:0}}>
            <div style={{fontSize:18, fontWeight:800, color:G.text, marginBottom:4}}>📜 Istoric Service</div>
            <div style={{fontSize:13, color:G.muted}}>
              <strong style={{color:G.text}}>{activ?.marca} {activ?.model}</strong>
              {activ?.cod_intern && <span style={{color:G.logistica, fontFamily:'monospace', marginLeft:8}}>· {activ.cod_intern}</span>}
              {activ?.nr_inmatriculare && <span style={{color:G.blue, fontFamily:'monospace', marginLeft:8}}>· {activ.nr_inmatriculare}</span>}
            </div>
          </div>
          <button onClick={onClose} style={{background:'transparent', border:'none', color:G.muted, fontSize:22, cursor:'pointer'}}>×</button>
        </div>
        
        {/* Stats */}
        <div style={{display:'grid', gridTemplateColumns:'repeat(5, 1fr)', gap:10, marginBottom:16}}>
          <div style={{...S.card, padding:'10px 14px', borderLeft:`3px solid ${G.logistica}`}}>
            <div style={{fontSize:10, color:G.muted, textTransform:'uppercase', marginBottom:3}}>📋 Total fișe</div>
            <div style={{fontSize:22, fontWeight:800, color:G.text}}>{stats.total}</div>
          </div>
          <div style={{...S.card, padding:'10px 14px', borderLeft:`3px solid ${G.green}`}}>
            <div style={{fontSize:10, color:G.muted, textTransform:'uppercase', marginBottom:3}}>💰 Sumă totală</div>
            <div style={{fontSize:18, fontWeight:800, color:G.green}}>{stats.totalSum.toLocaleString('ro-RO', {maximumFractionDigits:0})} RON</div>
            {stats.totalManopera > 0 && <div style={{fontSize:10, color:G.muted, marginTop:2}}>din care manoperă: {stats.totalManopera.toLocaleString('ro-RO', {maximumFractionDigits:0})} RON</div>}
          </div>
          <div style={{...S.card, padding:'10px 14px', borderLeft:`3px solid ${G.green}`}}>
            <div style={{fontSize:10, color:G.muted, textTransform:'uppercase', marginBottom:3}}>🔧 Mentenanțe</div>
            <div style={{fontSize:22, fontWeight:800, color:G.text}}>{stats.mentenante}</div>
          </div>
          <div style={{...S.card, padding:'10px 14px', borderLeft:`3px solid ${G.orange}`}}>
            <div style={{fontSize:10, color:G.muted, textTransform:'uppercase', marginBottom:3}}>⚙ Reparații</div>
            <div style={{fontSize:22, fontWeight:800, color:G.text}}>{stats.reparatii}</div>
          </div>
          <div style={{...S.card, padding:'10px 14px', borderLeft:`3px solid ${G.blue}`}}>
            <div style={{fontSize:10, color:G.muted, textTransform:'uppercase', marginBottom:3}}>✓ Finalizate</div>
            <div style={{fontSize:22, fontWeight:800, color:G.text}}>{stats.finalizate}<span style={{fontSize:14, color:G.muted}}>/{stats.total}</span></div>
          </div>
        </div>
        
        {loading ? (
          <div style={{padding:60, textAlign:'center', color:G.muted}}>⏳ Se încarcă istoricul...</div>
        ) : fise.length === 0 ? (
          <div style={{padding:60, textAlign:'center', color:G.muted}}>
            <div style={{fontSize:40, marginBottom:8}}>📋</div>
            <div>Niciun service înregistrat pentru acest utilaj</div>
          </div>
        ) : (
          <div style={{...S.card, overflow:'hidden', maxHeight:'55vh', overflowY:'auto'}}>
            <table style={{width:'100%', borderCollapse:'collapse', fontSize:12}}>
              <thead style={{position:'sticky', top:0, background:G.surface, zIndex:1}}>
                <tr style={{borderBottom:`1px solid ${G.border}`}}>
                  <th style={{padding:'8px', textAlign:'left', color:G.muted, fontSize:10, textTransform:'uppercase', width:95}}>Data</th>
                  <th style={{padding:'8px', textAlign:'left', color:G.muted, fontSize:10, textTransform:'uppercase', width:110}}>Tip</th>
                  <th style={{padding:'8px', textAlign:'left', color:G.muted, fontSize:10, textTransform:'uppercase'}}>Titlu</th>
                  <th style={{padding:'8px', textAlign:'right', color:G.muted, fontSize:10, textTransform:'uppercase', width:120}}>Sumă</th>
                  <th style={{padding:'8px', textAlign:'center', color:G.muted, fontSize:10, textTransform:'uppercase', width:80}}>Intrări</th>
                  <th style={{padding:'8px', textAlign:'left', color:G.muted, fontSize:10, textTransform:'uppercase', width:115}}>Status</th>
                  <th style={{padding:'8px', textAlign:'right', color:G.muted, fontSize:10, textTransform:'uppercase', width:140}}></th>
                </tr>
              </thead>
              <tbody>
                {fise.map(f => {
                  const nrIntrari = (f.logistica_service_intrari || []).length
                  return (
                    <tr key={f.id} style={{borderBottom:`1px solid ${G.border}`}}
                        onMouseEnter={e => e.currentTarget.style.background = G.bg}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <td style={{padding:'8px', fontSize:12, color:G.text, fontVariantNumeric:'tabular-nums'}}>{fmtDate(f.data_fisei)}</td>
                      <td style={{padding:'8px'}}><TipBadge tip={f.tip} /></td>
                      <td style={{padding:'8px', fontSize:12, color:G.text}}>
                        <div style={{fontWeight:600, marginBottom:2, maxWidth:330, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{f.titlu || '—'}</div>
                        {f.locatie_service && <div style={{fontSize:10, color:G.muted}}>📍 {f.locatie_service}</div>}
                      </td>
                      <td style={{padding:'8px', fontSize:13, fontWeight:700, color: f.suma_factura ? G.green : G.dim, fontVariantNumeric:'tabular-nums', textAlign:'right'}}>
                        {f.suma_factura ? fmtRON(f.suma_factura) : '—'}
                      </td>
                      <td style={{padding:'8px', textAlign:'center', color:G.muted}}>{nrIntrari > 0 ? `📋 ${nrIntrari}` : '—'}</td>
                      <td style={{padding:'8px'}}><StatusBadge status={f.status} /></td>
                      <td style={{padding:'8px', textAlign:'right', whiteSpace:'nowrap'}}>
                        <button 
                          onClick={() => onOpenFisa(f.id)} 
                          title="Detaliu fișă"
                          style={{...S.btnS, padding:'6px 10px', fontSize:14, color:G.muted, marginRight:4}}>👁</button>
                        <button 
                          onClick={async () => {
                            const intrari = f.logistica_service_intrari || []
                            await generateServicePDF(f, intrari, activ, showToast)
                          }} 
                          title="Export PDF"
                          style={{...S.btnS, padding:'6px 10px', fontSize:14, color:G.red, borderColor: G.red + '44'}}>📄</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export default function ServiceTab({ active: activeProp, canEdit, showToast }) {
  const [fise, setFise] = useState([])
  const [activeFull, setActiveFull] = useState([])
  const [presetItems, setPresetItems] = useState([])
  const [kmOreMap, setKmOreMap] = useState({}) // ← Pachet C: km/ore live per activ
  const [load, setLoad] = useState(true)

  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('Toate')
  const [tipF, setTipF] = useState('Toate')
  const [statusF, setStatusF] = useState('Toate')
  const [perioadaF, setPerioadaF] = useState('toate')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')

  const [sortBy, setSortBy] = useState({ col:'data_fisei', dir:'desc' })
  const [scadenteOnly, setScadenteOnly] = useState(false)  // ETAPA 8.6: filtru click-pe-KPI

  const [newModal, setNewModal] = useState(null)
  const [detailModal, setDetailModal] = useState(null)
  const [acoperireModal, setAcoperireModal] = useState(false)
  const [importModal, setImportModal] = useState(false)
  const [istoricModal, setIstoricModal] = useState(null)  // ETAPA 8.7: { activ }

  // Etapa 12+ (19.05.2026): toggle între lista fișelor service și catalog piese
  const [view, setView] = useState('fise')  // 'fise' | 'piese'

  // ETAPA 8.6: handler click pe KPI Scadențe Service → setează filtru + sort
  const handleClickScadente = useCallback(() => {
    setScadenteOnly(true)
    setSearch('')
    setCatFilter('Toate')
    setTipF('Toate')
    setStatusF('Toate')
    setPerioadaF('toate')
    setSortBy({ col:'urmator', dir:'asc' })
    // Scroll smooth la tabel după 100ms (după re-render)
    setTimeout(() => {
      const tbl = document.querySelector('[data-service-table]')
      if (tbl) tbl.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 100)
  }, [])

  // ETAPA 8.6: handler quick-delete fișă direct din listă (fără să intri în modal)
  const handleQuickDeleteFisa = useCallback(async (fisa) => {
    const nrIntrari = (fisa.logistica_service_intrari || []).length
    const titlu = fisa.titlu || `Fișă #${fisa.id}`
    if (!confirm(`Ștergi fișa "${titlu}" și toate cele ${nrIntrari} intrări?\n\nAcțiunea NU poate fi anulată.`)) return
    const { error } = await supabase.from('logistica_service_fise').delete().eq('id', fisa.id)
    if (error) { showToast(`Eroare la ștergere: ${error.message}`, 'error'); return }
    showToast(`✓ Fișa "${titlu}" ștearsă`, 'success')
    setFise(p => p.filter(f => f.id !== fisa.id))
  }, [showToast])

  const loadAll = useCallback(async () => {
    setLoad(true)
    const [fisRes, actRes, presetRes, kmOreRes] = await Promise.all([
      supabase
        .from('logistica_service_fise')
        .select('*, logistica_active(id, cod_intern, nr_inventar, nr_inmatriculare, marca, model, km_actuali, ore_functionare_actuale, categorie_id, logistica_categorii:categorie_id(tip, subcategorie)), logistica_service_intrari(id)')
        .order('data_fisei', { ascending:false, nullsFirst:false })
        .order('id', { ascending:false }),
      supabase
        .from('logistica_active')
        .select('id, cod_intern, nr_inventar, nr_inmatriculare, marca, model, stare, km_actuali, ore_functionare_actuale, categorie_id, logistica_categorii:categorie_id(tip, subcategorie)')
        .order('cod_intern', { nullsFirst:false }),
      supabase
        .from('logistica_service_itemi_preset')
        .select('*').eq('activ', true).order('grupa').order('ordine'),
      // Pachet C: km/ore live per activ (din toate sursele agregate)
      supabase
        .from('v_active_km_ore')
        .select('activ_id, km_live, ore_live'),
    ])
    if (fisRes.error) showToast(`Eroare la încărcare fișe: ${fisRes.error.message}`, 'error')
    if (actRes.error) showToast(`Eroare la încărcare active: ${actRes.error.message}`, 'error')
    if (presetRes.error) showToast(`Eroare la preset itemi: ${presetRes.error.message}`, 'error')
    if (kmOreRes.error) showToast(`Eroare la km/ore live: ${kmOreRes.error.message}`, 'error')
    setFise(fisRes.data || [])
    setActiveFull((actRes.data || []).map(a => ({
      ...a,
      categorie: a.logistica_categorii ? { tip: a.logistica_categorii.tip, subcategorie: a.logistica_categorii.subcategorie } : null,
    })))
    setPresetItems(presetRes.data || [])
    // Populez kmOreMap: { [activ_id]: { km_live, ore_live } }
    const map = {}
    for (const r of (kmOreRes.data || [])) map[r.activ_id] = r
    setKmOreMap(map)
    setLoad(false)
  }, [showToast])

  useEffect(() => { loadAll() }, [loadAll])

  const fiseCountByActiv = useMemo(() => {
    const m = {}
    for (const f of fise) m[f.activ_id] = (m[f.activ_id] || 0) + 1
    return m
  }, [fise])

  const ultimaFisaPerActiv = useMemo(() => {
    const m = {}
    for (const f of fise) {
      const cur = m[f.activ_id]
      if (!cur || (f.data_fisei || '') > (cur.data_fisei || '')) m[f.activ_id] = f
    }
    return m
  }, [fise])

  const activMap = useMemo(() => {
    const m = {}
    for (const a of activeFull) m[a.id] = a
    return m
  }, [activeFull])

  const kpi = useMemo(() => {
    const total = fise.length
    const programat = fise.filter(f => f.status === 'programat').length
    const in_lucru = fise.filter(f => f.status === 'in_lucru').length
    const finalizat = fise.filter(f => f.status === 'finalizat').length
    const sumaTotala = fise.reduce((s, f) => s + Number(f.suma_factura || 0), 0)
    const fara = activeFull.filter(a => !fiseCountByActiv[a.id]).length
    const acoperire = activeFull.length > 0 ? Math.round((1 - fara / activeFull.length) * 100) : 0

    let scadDepasite = 0, scadAproape = 0
    for (const f of Object.values(ultimaFisaPerActiv)) {
      // Pachet C: folosim km/ore live din view
      const km = kmOreMap[f.activ_id]
      const u = calcUrmService(f, km?.km_live, km?.ore_live)
      const lvl = urmServiceLevel(u)
      if (lvl === 'depasit') scadDepasite++
      else if (lvl === 'aproape') scadAproape++
    }
    return { total, programat, in_lucru, finalizat, sumaTotala, fara, acoperire, scadDepasite, scadAproape }
  }, [fise, activeFull, fiseCountByActiv, ultimaFisaPerActiv, kmOreMap])

  const filtered = useMemo(() => {
    let dStart = null, dEnd = null
    const now = new Date()
    const nowISO = now.toISOString().split('T')[0]
    if (perioadaF === 'azi') { dStart = nowISO; dEnd = nowISO }
    else if (perioadaF === 'saptamana') { const d = new Date(); d.setDate(d.getDate() - 7); dStart = d.toISOString().split('T')[0]; dEnd = nowISO }
    else if (perioadaF === 'luna') { const d = new Date(); d.setMonth(d.getMonth() - 1); dStart = d.toISOString().split('T')[0]; dEnd = nowISO }
    else if (perioadaF === 'an') { const d = new Date(now.getFullYear(), 0, 1); dStart = d.toISOString().split('T')[0]; dEnd = nowISO }
    else if (perioadaF === 'custom') { dStart = customStart || null; dEnd = customEnd || null }

    let r = fise.filter(f => {
      if (catFilter !== 'Toate' && f.logistica_active?.logistica_categorii?.tip !== catFilter) return false
      if (tipF !== 'Toate' && f.tip !== tipF) return false
      if (statusF !== 'Toate' && f.status !== statusF) return false
      if (dStart && (!f.data_fisei || f.data_fisei < dStart)) return false
      if (dEnd && (!f.data_fisei || f.data_fisei > dEnd)) return false
      if (search) {
        const a = f.logistica_active || {}
        const hay = norm([f.titlu, f.diagnostic_lucrari, f.numar_factura, f.locatie_service, f.observatii,
          a.cod_intern, a.nr_inventar, a.nr_inmatriculare, a.marca, a.model].filter(Boolean).join(' '))
        if (!hay.includes(norm(search))) return false
      }
      // ETAPA 8.6: filtru scadențe (când userul a apăsat KPI Scadențe Service)
      if (scadenteOnly) {
        // Vrem DOAR ultima fișă per activ care are scadență „aproape" sau „depasit"
        if (ultimaFisaPerActiv[f.activ_id]?.id !== f.id) return false
        const km = kmOreMap[f.activ_id]
        const u = calcUrmService(f, km?.km_live, km?.ore_live)
        const lvl = urmServiceLevel(u)
        if (lvl !== 'depasit' && lvl !== 'aproape') return false
      }
      return true
    })

    const dir = sortBy.dir === 'asc' ? 1 : -1
    const get = (f) => {
      const a = f.logistica_active || {}
      switch (sortBy.col) {
        case 'data_fisei':    return f.data_fisei || ''
        case 'activ':         return (a.cod_intern || a.nr_inmatriculare || '').toLowerCase()
        case 'titlu':         return (f.titlu || '').toLowerCase()
        case 'tip':           return f.tip || ''
        case 'status':        return f.status || ''
        case 'suma_factura':  return Number(f.suma_factura || 0)
        case 'numar_factura': return (f.numar_factura || '').toLowerCase()
        case 'urmator': {
          // Pachet C: folosim km/ore live din view
          const km = kmOreMap[f.activ_id]
          const u = calcUrmService(f, km?.km_live, km?.ore_live)
          return u ? u.ramas : Number.MAX_SAFE_INTEGER
        }
        default:              return f.id
      }
    }
    r.sort((x, y) => {
      const va = get(x), vb = get(y)
      if (va < vb) return -1 * dir
      if (va > vb) return 1 * dir
      return 0
    })
    return r
  }, [fise, search, catFilter, tipF, statusF, perioadaF, customStart, customEnd, sortBy, kmOreMap, scadenteOnly, ultimaFisaPerActiv])

  const sumaFiltrata = useMemo(() => filtered.reduce((s, f) => s + Number(f.suma_factura || 0), 0), [filtered])

  const exportExcel = () => {
    const header = ['#', 'Data', 'Cod TST', 'Plăcuță', 'Marcă', 'Model', 'Categorie', 'Tip', 'Status', 'Titlu', 'Locație', 'Nr. factură', 'Sumă (RON)', 'Manoperă (RON)', 'KM in', 'KM out', 'Ore in', 'Ore out', 'Diagnostic', 'Următor KM', 'Următor Ore', 'Următor data', 'Scadență', 'Observații']
    const rows = filtered.map((f, i) => {
      const a = f.logistica_active || {}
      // Pachet C: folosim km/ore live din view
      const km = kmOreMap[f.activ_id]
      const u = calcUrmService(f, km?.km_live, km?.ore_live)
      return [
        i + 1, f.data_fisei ? new Date(f.data_fisei).toLocaleDateString('ro-RO') : '',
        a.cod_intern || '', a.nr_inmatriculare || '', a.marca || '', a.model || '',
        a.logistica_categorii?.tip || '', f.tip || '', f.status || '', f.titlu || '',
        f.locatie_service || '', f.numar_factura || '', f.suma_factura ?? '', f.manopera ?? '',
        f.km_intrare ?? '', f.km_iesire ?? '', f.ore_intrare ?? '', f.ore_iesire ?? '',
        f.diagnostic_lucrari || '', f.urmatoarea_km ?? '', f.urmatoarea_ore ?? '',
        f.urmatoarea_data ? new Date(f.urmatoarea_data).toLocaleDateString('ro-RO') : '',
        u ? u.label : '',
        f.observatii || '',
      ]
    })

    const aoa = [
      [`Fișe Service Logistică — ${new Date().toLocaleDateString('ro-RO')}`],
      [`${filtered.length} fișe${filtered.length !== fise.length ? ` (filtrat din ${fise.length})` : ''} · Sumă totală: ${sumaFiltrata.toLocaleString('ro-RO', {minimumFractionDigits:2, maximumFractionDigits:2})} RON`],
      [], header, ...rows
    ]
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    const titleStyle = { font:{ bold:true, sz:14, color:{ rgb:'E3B341' } } }
    const subtitleStyle = { font:{ italic:true, sz:10, color:{ rgb:'8B949E' } } }
    const headerStyle = {
      fill:{ fgColor:{ rgb:'1F2937' } },
      font:{ bold:true, color:{ rgb:'E3B341' }, sz:10 },
      alignment:{ horizontal:'center', vertical:'center', wrapText:true },
    }
    if (ws['A1']) ws['A1'].s = titleStyle
    if (ws['A2']) ws['A2'].s = subtitleStyle
    header.forEach((_, c) => { const a = XLSX.utils.encode_cell({ r:3, c }); if (ws[a]) ws[a].s = headerStyle })
    ws['!cols'] = header.map(h => ({ wch: Math.max(h.length + 2, 11) }))
    ws['!merges'] = [{ s:{ r:0, c:0 }, e:{ r:0, c:header.length-1 } }, { s:{ r:1, c:0 }, e:{ r:1, c:header.length-1 } }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Fișe Service')
    XLSX.writeFile(wb, `Logistica_Service_${todayISO()}.xlsx`)
    showToast(`✓ Exportat ${filtered.length} fișe`, 'success')
  }

  const resetFiltre = () => {
    setSearch(''); setCatFilter('Toate'); setTipF('Toate'); setStatusF('Toate')
    setPerioadaF('toate'); setCustomStart(''); setCustomEnd('')
    setScadenteOnly(false)  // ETAPA 8.6
  }
  const haveFiltre = search || catFilter !== 'Toate' || tipF !== 'Toate' || statusF !== 'Toate' || perioadaF !== 'toate' || scadenteOnly

  const scadIcon = kpi.scadDepasite > 0 ? '🚨' : kpi.scadAproape > 0 ? '⚠️' : '✅'
  const scadColor = kpi.scadDepasite > 0 ? G.red : kpi.scadAproape > 0 ? G.yellow : G.green
  const scadValue = kpi.scadDepasite + kpi.scadAproape
  const scadSub = kpi.scadDepasite > 0
    ? `${kpi.scadDepasite} depășite${kpi.scadAproape > 0 ? ` · ${kpi.scadAproape} aproape` : ''}`
    : kpi.scadAproape > 0
      ? `${kpi.scadAproape} aproape (≤${PRAG_ZILE}z / ${PRAG_KM}km / ${PRAG_ORE}h)`
      : 'Toate la zi'

  return (
    <>
      {/* Etapa 12+ Toggle view: Fișe Service ↔ Piese Catalog */}
      <div style={{display:'flex', gap:8, marginBottom:14, borderBottom:`1px solid ${G.border}`, paddingBottom:0}}>
        <button onClick={() => setView('fise')} style={{
          background:'transparent', border:'none', color: view === 'fise' ? G.logistica : G.muted,
          padding:'10px 18px', fontSize:14, fontWeight:700, cursor:'pointer',
          borderBottom: view === 'fise' ? `2px solid ${G.logistica}` : '2px solid transparent',
          marginBottom:-1,
        }}>📋 Fișe Service</button>
        <button onClick={() => setView('piese')} style={{
          background:'transparent', border:'none', color: view === 'piese' ? G.logistica : G.muted,
          padding:'10px 18px', fontSize:14, fontWeight:700, cursor:'pointer',
          borderBottom: view === 'piese' ? `2px solid ${G.logistica}` : '2px solid transparent',
          marginBottom:-1,
        }}>🔧 Piese Catalog</button>
      </div>

      {view === 'piese' && <PieseCatalogSection canEdit={canEdit} showToast={showToast} />}

      {view === 'fise' && (
      <>
      <div style={{display:'flex', gap:12, marginBottom:14, flexWrap:'wrap'}}>
        <KPICard icon="📋" label="Total fișe" value={kpi.total} color={G.logistica}
          sub={`${kpi.programat} programate · ${kpi.in_lucru} în lucru · ${kpi.finalizat} finalizate`} />
        <KPICard icon="💰" label="Sumă totală" value={kpi.sumaTotala.toLocaleString('ro-RO', {maximumFractionDigits:0}) + ' RON'} color={G.green} />
        <KPICard icon="📊" label="Acoperire flotă" value={`${kpi.acoperire}%`}
          color={kpi.acoperire >= 80 ? G.green : kpi.acoperire >= 50 ? G.yellow : G.red}
          sub={kpi.fara > 0 ? `${kpi.fara} active fără fișă` : 'Toate active acoperite'}
          onClick={() => setAcoperireModal(true)} />
        <KPICard icon={scadIcon} label="Scadențe service" value={scadValue} color={scadColor} sub={scadSub}
          onClick={scadValue > 0 ? handleClickScadente : undefined} />
      </div>

      {/* ETAPA 8.6: banner activ scadențe */}
      {scadenteOnly && (
        <div style={{
          ...S.card, padding:'10px 14px', marginBottom:14,
          borderLeft:`3px solid ${G.red}`,
          background: G.red + '11',
          display:'flex', alignItems:'center', justifyContent:'space-between',
        }}>
          <div style={{fontSize:13, color:G.text}}>
            🚨 <strong>Mod scadențe</strong> — afișez doar fișele cu următoarea revizie depășită sau aproape, sortate cronologic (cele mai vechi întâi)
          </div>
          <button onClick={() => setScadenteOnly(false)} style={{...S.btnS, padding:'5px 12px', fontSize:11, color:G.red, borderColor:G.red + '55'}}>
            × Ieși din mod scadențe
          </button>
        </div>
      )}

      <div style={{...S.card, padding:'10px 14px', marginBottom:14}}>
        <div style={{display:'flex', gap:6, alignItems:'center', flexWrap:'wrap'}}>
          <span style={{fontSize:11, color:G.muted, fontWeight:600, marginRight:4}}>CATEGORIE:</span>
          {['Toate', ...CATEGORII].map(c => {
            const count = c === 'Toate' ? fise.length : fise.filter(f => f.logistica_active?.logistica_categorii?.tip === c).length
            const active = catFilter === c
            return (
              <button key={c} onClick={() => setCatFilter(c)} style={{
                ...S.btnS, padding:'5px 10px', fontSize:12, fontWeight:600,
                background: active ? G.logistica + '22' : 'transparent',
                color: active ? G.logistica : (count === 0 ? G.dim : G.muted),
                borderColor: active ? G.logistica + '55' : G.border,
              }}>{c} {count > 0 && <span style={{opacity:.7, marginLeft:3}}>({count})</span>}</button>
            )
          })}
        </div>
      </div>

      <div style={{...S.card, padding:14, marginBottom:14}}>
        <div style={{display:'flex', gap:10, flexWrap:'wrap', alignItems:'center', marginBottom:10}}>
          <input placeholder="🔍 Caută cod TST, plăcuță, titlu, diagnostic, factură..." value={search} onChange={e => setSearch(e.target.value)} style={{...S.input, width:340}} />
          <select value={tipF} onChange={e => setTipF(e.target.value)} style={{...S.input, width:'auto', padding:'7px 11px', fontSize:13, cursor:'pointer'}}>
            <option value="Toate">Toate tipurile</option>
            {TIPURI.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <select value={statusF} onChange={e => setStatusF(e.target.value)} style={{...S.input, width:'auto', padding:'7px 11px', fontSize:13, cursor:'pointer'}}>
            <option value="Toate">Toate statusurile</option>
            {STATUSURI.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          {haveFiltre && (
            <button onClick={resetFiltre} style={{...S.btnS, padding:'6px 10px', fontSize:11, color:G.muted}}>× Resetează</button>
          )}
        </div>
        <div style={{display:'flex', gap:6, alignItems:'center', flexWrap:'wrap'}}>
          <span style={{fontSize:11, color:G.muted, fontWeight:600, marginRight:4}}>PERIOADĂ:</span>
          {[
            {key:'toate', label:'Toate'},
            {key:'azi', label:'Azi'},
            {key:'saptamana', label:'7 zile'},
            {key:'luna', label:'Luna'},
            {key:'an', label:'Anul'},
            {key:'custom', label:'Custom'},
          ].map(p => (
            <button key={p.key} onClick={() => setPerioadaF(p.key)} style={{
              ...S.btnS, padding:'6px 12px', fontSize:12, fontWeight:600,
              background: perioadaF === p.key ? G.logistica + '22' : 'transparent',
              color: perioadaF === p.key ? G.logistica : G.muted,
              borderColor: perioadaF === p.key ? G.logistica + '55' : G.border,
            }}>{p.label}</button>
          ))}
          {perioadaF === 'custom' && (
            <>
              <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} style={{...S.input, padding:'6px 10px', fontSize:12, minWidth:140, width:'auto'}} />
              <span style={{color:G.muted, fontSize:12}}>→</span>
              <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} style={{...S.input, padding:'6px 10px', fontSize:12, minWidth:140, width:'auto'}} />
            </>
          )}
        </div>
      </div>

      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14, flexWrap:'wrap', gap:10}}>
        <div style={{fontSize:13, color:G.muted}}>
          <strong style={{color:G.text}}>{filtered.length}</strong>
          {filtered.length !== fise.length && <span> din {fise.length}</span>} fișe
          {sumaFiltrata > 0 && <> · sumă: <strong style={{color:G.green}}>{sumaFiltrata.toLocaleString('ro-RO', {minimumFractionDigits:2, maximumFractionDigits:2})} RON</strong></>}
        </div>
        <div style={{display:'flex', gap:8}}>
          <button onClick={() => setAcoperireModal(true)} style={{...S.btnS, color: kpi.fara > 0 ? G.red : G.green, borderColor: (kpi.fara > 0 ? G.red : G.green) + '55'}}>
            📊 Acoperire flotă {kpi.fara > 0 && `(${kpi.fara})`}
          </button>
          <button onClick={exportExcel} disabled={filtered.length === 0} style={{...S.btnS, opacity: filtered.length === 0 ? .4 : 1}}>📥 Excel</button>
          {canEdit && (
            <button onClick={() => setImportModal(true)} style={{...S.btnS, color: G.purple, borderColor: G.purple + '55'}} title="Import fișe vechi din XLSX (istoric)">
              📤 Import
            </button>
          )}
          {canEdit && (
            <button onClick={() => setNewModal({})} style={{...S.btnP, background:G.logistica, color:'#000'}}>+ Fișă nouă</button>
          )}
        </div>
      </div>

      {load ? (
        <div style={{display:'flex', justifyContent:'center', padding:80}}>
          <div style={{width:32, height:32, border:`3px solid ${G.border}`, borderTopColor:G.logistica, borderRadius:'50%', animation:'sp 0.8s linear infinite'}} />
          <style>{`@keyframes sp { to { transform: rotate(360deg) } }`}</style>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{...S.card, padding:60, textAlign:'center', color:G.muted}}>
          <div style={{fontSize:40, marginBottom:12}}>{fise.length === 0 ? '📋' : '🔍'}</div>
          <div style={{fontSize:14, marginBottom:8}}>{fise.length === 0 ? 'Nicio fișă service încă' : 'Nicio fișă cu filtrele aplicate'}</div>
          {fise.length === 0 && canEdit && (
            <button onClick={() => setNewModal({})} style={{...S.btnP, background:G.logistica, color:'#000', marginTop:10}}>+ Creează prima fișă</button>
          )}
        </div>
      ) : (
        <div style={{...S.card, overflow:'hidden'}} data-service-table>
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%', borderCollapse:'collapse'}}>
              <thead>
                <tr>
                  <SortableTh col="data_fisei"    sortBy={sortBy} setSortBy={setSortBy} width={95}>Data</SortableTh>
                  <SortableTh col="activ"         sortBy={sortBy} setSortBy={setSortBy} width={210}>Activ</SortableTh>
                  <SortableTh col="tip"           sortBy={sortBy} setSortBy={setSortBy} width={110}>Tip</SortableTh>
                  <SortableTh col="titlu"         sortBy={sortBy} setSortBy={setSortBy}>Titlu</SortableTh>
                  <SortableTh col="numar_factura" sortBy={sortBy} setSortBy={setSortBy} width={110}>Factură</SortableTh>
                  <SortableTh col="suma_factura"  sortBy={sortBy} setSortBy={setSortBy} width={120} align="right">Sumă</SortableTh>
                  <SortableTh col="urmator"       sortBy={sortBy} setSortBy={setSortBy} width={150}>Următor</SortableTh>
                  <SortableTh col="status"        sortBy={sortBy} setSortBy={setSortBy} width={120}>Status</SortableTh>
                  <th style={{width:200, padding:'10px 8px', borderBottom:`1px solid ${G.border}`, background:G.surface}}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(f => {
                  const a = f.logistica_active || {}
                  const cat = a.logistica_categorii || {}
                  const nrIntrari = (f.logistica_service_intrari || []).length
                  // Pachet C: folosim km/ore live din view
                  const km = kmOreMap[f.activ_id]
                  const u = calcUrmService(f, km?.km_live, km?.ore_live)
                  return (
                    <tr key={f.id} style={{borderBottom:`1px solid ${G.border}`}}
                        onMouseEnter={e => e.currentTarget.style.background = G.bg}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <td style={{padding:'10px 8px', fontSize:12, color: f.data_fisei ? G.text : G.dim, fontVariantNumeric:'tabular-nums'}}>{fmtDate(f.data_fisei)}</td>
                      <td style={{padding:'10px 8px', fontSize:12}}>
                        <div style={{fontWeight:600, color:G.text, marginBottom:2}}>{a.marca} {a.model}</div>
                        <div style={{display:'flex', alignItems:'center', gap:6, fontSize:11}}>
                          {a.cod_intern && <span style={{color:G.logistica, fontFamily:'monospace', fontWeight:700}}>{a.cod_intern}</span>}
                          {a.nr_inmatriculare && <span style={{color:G.blue, fontFamily:'monospace'}}>{a.nr_inmatriculare}</span>}
                          {a.nr_inventar && <span style={{color:G.muted, fontFamily:'monospace', fontSize:10}}>inv:{a.nr_inventar}</span>}
                        </div>
                        {cat.tip && <div style={{fontSize:10, color:G.dim, marginTop:1}}>{cat.tip}{cat.subcategorie ? ` · ${cat.subcategorie}` : ''}</div>}
                      </td>
                      <td style={{padding:'10px 8px'}}><TipBadge tip={f.tip} /></td>
                      <td style={{padding:'10px 8px', fontSize:13, color:G.text}}>
                        <div style={{fontWeight:600, marginBottom:2, maxWidth:380, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{f.titlu || '—'}</div>
                        <div style={{fontSize:10, color:G.muted}}>
                          {nrIntrari > 0 && <span>📋 {nrIntrari} {nrIntrari === 1 ? 'intrare' : 'intrări'}</span>}
                          {f.locatie_service && <span style={{marginLeft:8}}>📍 {f.locatie_service}</span>}
                        </div>
                      </td>
                      <td style={{padding:'10px 8px', fontSize:12, color:G.text, fontFamily:'monospace'}}>{f.numar_factura || <span style={{color:G.dim}}>—</span>}</td>
                      <td style={{padding:'10px 8px', fontSize:13, fontWeight:700, color: f.suma_factura ? G.green : G.dim, fontVariantNumeric:'tabular-nums', textAlign:'right'}}>
                        {f.suma_factura ? fmtRON(f.suma_factura) : '—'}
                      </td>
                      <td style={{padding:'10px 8px'}}><UrmServiceBadge u={u} /></td>
                      <td style={{padding:'10px 8px'}}><StatusBadge status={f.status} /></td>
                      <td style={{padding:'10px 8px', textAlign:'right', whiteSpace:'nowrap'}}>
                        <button onClick={() => setDetailModal(f.id)} title="Vezi detaliu" style={{...S.btnS, padding:'8px 10px', fontSize:16, color:G.muted, marginRight:3}}>👁</button>
                        {canEdit && <button onClick={() => setDetailModal(f.id)} title="Editează" style={{...S.btnS, padding:'8px 10px', fontSize:16, color:G.logistica, marginRight:3}}>✎</button>}
                        <button 
                          onClick={() => setIstoricModal({ activ: a })} 
                          title="Istoric service utilaj" 
                          style={{...S.btnS, padding:'8px 10px', fontSize:14, color:G.blue, borderColor:G.blue + '44', marginRight:3}}>📜</button>
                        <button 
                          onClick={async () => {
                            const intrari = f.logistica_service_intrari || []
                            await generateServicePDF(f, intrari, a, showToast)
                          }} 
                          title="Export PDF" 
                          style={{...S.btnS, padding:'8px 10px', fontSize:14, color:G.red, borderColor:G.red + '44', marginRight:3}}>📄</button>
                        {canEdit && <button onClick={() => handleQuickDeleteFisa(f)} title="Șterge fișa" style={{...S.btnS, padding:'8px 10px', fontSize:14, color:G.red, borderColor:G.red + '44'}}>🗑</button>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      </>
      )}

      {newModal && (
        <NewFisaModal
          activPreset={newModal.activPreset}
          active={activeFull}
          presetItems={presetItems}
          onClose={() => setNewModal(null)}
          onSaved={() => { setNewModal(null); loadAll() }}
          showToast={showToast}
        />
      )}
      {detailModal && (
        <DetailFisaModal
          fisaId={detailModal}
          canEdit={canEdit}
          onClose={() => setDetailModal(null)}
          onSaved={loadAll}
          showToast={showToast}
        />
      )}
      {acoperireModal && (
        <AcoperireFlotaModal
          active={activeFull}
          fiseCountByActiv={fiseCountByActiv}
          canEdit={canEdit}
          onClose={() => setAcoperireModal(false)}
          onCreateFor={(activId) => { setAcoperireModal(false); setNewModal({ activPreset: activId }) }}
        />
      )}
      
      {/* ETAPA 8.7: Modal istoric service per utilaj */}
      {istoricModal && (
        <IstoricServiceModal
          activ={istoricModal.activ}
          onClose={() => setIstoricModal(null)}
          onOpenFisa={(fisaId) => {
            setIstoricModal(null)
            setDetailModal(fisaId)
          }}
          showToast={showToast}
        />
      )}
      
      {/* Import fișe service istorice din XLSX (22.05.2026) */}
      {importModal && (
        <ImportFiseServiceModal
          open={importModal}
          onClose={() => setImportModal(false)}
          supabase={supabase}
          G={G}
          S={S}
          onSuccess={(n) => {
            showToast(`✓ ${n} fișe service importate`, 'success')
            loadAll()
          }}
        />
      )}
    </>
  )
}
