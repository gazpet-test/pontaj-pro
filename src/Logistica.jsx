// ════════════════════════════════════════════════════════════════════════════
// MODULUL LOGISTICĂ — v1.0 MVP
// Listă active · Filtre · KPI · Detaliu activ
// ════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from './lib/supabase.js'

// ─── Theme (sincronizat cu App.jsx) ──────────────────────────────────────────
const G = {
  bg:'#0D1117', surface:'#161B22', border:'#21262D', border2:'#30363D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  blue:'#58A6FF', green:'#3FB950', red:'#F85149', yellow:'#D29922',
  purple:'#BC8CFF', orange:'#F0883E',
  greenDim:'#1A3A1A', redDim:'#3A1A1A', yellowDim:'#3A2A0A',
  logistica:'#E3B341', // culoarea modulului Logistică
}
const S = {
  page: { fontFamily:"'Syne','Barlow',sans-serif", background:G.bg, minHeight:'100vh', color:G.text },
  card: { background:G.surface, border:`1px solid ${G.border}`, borderRadius:12 },
  input: { background:G.bg, border:`1px solid ${G.border2}`, color:G.text, borderRadius:8, padding:'8px 12px', fontFamily:'inherit', fontSize:14, outline:'none', width:'100%' },
  btnP: { background:'#1F6FEB', color:'white', border:'none', borderRadius:8, padding:'9px 18px', fontFamily:'inherit', fontSize:14, fontWeight:700, cursor:'pointer' },
  btnS: { background:G.surface, color:G.text, border:`1px solid ${G.border}`, borderRadius:8, padding:'7px 14px', fontFamily:'inherit', fontSize:13, fontWeight:600, cursor:'pointer' },
}

// ─── Utility ─────────────────────────────────────────────────────────────────
const todayStr = () => new Date().toISOString().split('T')[0]
const daysUntil = (dateStr) => {
  if (!dateStr) return null
  const d = new Date(dateStr)
  const now = new Date()
  return Math.ceil((d - now) / (1000 * 60 * 60 * 24))
}
const fmtDate = (dateStr) => {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

// ─── Toast ───────────────────────────────────────────────────────────────────
function useToast() {
  const [toast, setToast] = useState(null)
  const show = (msg, type='success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }
  return [toast, show]
}
function Toast({ toast }) {
  if (!toast) return null
  const colors = { success:G.green, error:G.red, warn:G.orange }
  return (
    <div className="toast" style={{
      background: colors[toast.type] + '22',
      border: `1px solid ${colors[toast.type]}55`,
      color: colors[toast.type]
    }}>{toast.msg}</div>
  )
}

// ─── Stare badge ─────────────────────────────────────────────────────────────
function StareBadge({ stare }) {
  const config = {
    'Functional': { bg: G.green+'22', color: G.green, label: '✓ Funcțional' },
    'Nefunctional': { bg: G.red+'22', color: G.red, label: '✗ Nefuncțional' },
    'In_service': { bg: G.yellow+'22', color: G.yellow, label: '🔧 În service' },
    'Service': { bg: G.yellow+'22', color: G.yellow, label: '🔧 În service' },
  }
  const c = config[stare] || { bg: G.dim+'22', color: G.dim, label: stare || '—' }
  return (
    <span style={{
      display: 'inline-block', padding: '3px 10px', borderRadius: 12,
      fontSize: 11, fontWeight: 700, letterSpacing: '.3px',
      background: c.bg, color: c.color
    }}>{c.label}</span>
  )
}

// ─── Mentenanță scadență badge ───────────────────────────────────────────────
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

// ─── KPI Card ────────────────────────────────────────────────────────────────
function KPICard({ icon, label, value, color = G.blue, sub }) {
  return (
    <div style={{
      ...S.card,
      padding: '14px 18px',
      flex: 1,
      minWidth: 160,
      borderLeft: `3px solid ${color}`
    }}>
      <div style={{fontSize: 11, color: G.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 4}}>
        {icon} {label}
      </div>
      <div style={{fontSize: 24, fontWeight: 800, color: G.text, fontVariantNumeric: 'tabular-nums'}}>
        {value}
      </div>
      {sub && <div style={{fontSize: 11, color: G.muted, marginTop: 2}}>{sub}</div>}
    </div>
  )
}

// ─── Detaliu activ (modal) ───────────────────────────────────────────────────
function ActivDetailModal({ activ, onClose }) {
  if (!activ) return null
  const mentenanta = activ.logistica_mentenanta_plan?.[0]
  const days = mentenanta?.urmatoarea_data ? daysUntil(mentenanta.urmatoarea_data) : null
  
  const Field = ({ label, value }) => (
    <div style={{marginBottom: 10}}>
      <div style={{fontSize: 11, color: G.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 3}}>{label}</div>
      <div style={{fontSize: 14, color: G.text, fontWeight: 500}}>{value || <span style={{color: G.dim}}>—</span>}</div>
    </div>
  )
  
  return (
    <div onClick={onClose} style={{
      position:'fixed', inset:0, background:'#000000aa', zIndex:200,
      display:'flex', alignItems:'flex-start', justifyContent:'center',
      padding:'40px 20px', overflowY:'auto'
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        ...S.card, padding: 24, width: '100%', maxWidth: 720,
        boxShadow: '0 20px 80px rgba(0,0,0,.6)'
      }} className="fi">
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom: 16, gap: 12}}>
          <div>
            <div style={{fontSize: 20, fontWeight: 800, color: G.text, marginBottom: 4}}>
              {activ.marca || '—'} {activ.model || ''}
            </div>
            <div style={{display:'flex', gap: 8, alignItems:'center', flexWrap:'wrap'}}>
              {activ.cod_intern && <span style={{
                background: G.blue+'22', color: G.blue, fontSize: 11, fontWeight: 700,
                padding: '3px 10px', borderRadius: 12
              }}>{activ.cod_intern}</span>}
              {activ.nr_inmatriculare && <span style={{
                background: G.purple+'22', color: G.purple, fontSize: 11, fontWeight: 700,
                padding: '3px 10px', borderRadius: 12
              }}>🚗 {activ.nr_inmatriculare}</span>}
              <StareBadge stare={activ.stare} />
            </div>
          </div>
          <button onClick={onClose} style={{
            background:'transparent', border:'none', color:G.muted, fontSize: 22,
            cursor:'pointer', padding: 4, lineHeight: 1
          }}>×</button>
        </div>
        
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap: 16, marginTop: 8}}>
          <Field label="Categorie" value={
            activ.logistica_categorii ? 
              `${activ.logistica_categorii.tip}${activ.logistica_categorii.subcategorie ? ' · ' + activ.logistica_categorii.subcategorie : ''}` 
              : '—'
          } />
          <Field label="An fabricație" value={activ.an_fabricatie} />
          <Field label="Firmă proprietară" value={activ.firma_proprietara} />
          <Field label="Tip carburant" value={activ.tip_carburant ? activ.tip_carburant.charAt(0).toUpperCase() + activ.tip_carburant.slice(1) : '—'} />
          <Field label="Normă consum" value={activ.norma_consum ? `${activ.norma_consum} L/h sau /100km` : '—'} />
          <Field label="Stare" value={<StareBadge stare={activ.stare} />} />
        </div>
        
        {(mentenanta?.urmatoarea_data || mentenanta?.urmatoarea_ore) && (
          <div style={{
            marginTop: 16, padding: 14,
            background: days !== null && days < 0 ? G.redDim : days !== null && days <= 30 ? G.yellowDim : G.greenDim,
            border: `1px solid ${days !== null && days < 0 ? G.red : days !== null && days <= 30 ? G.yellow : G.green}33`,
            borderRadius: 10
          }}>
            <div style={{fontSize: 11, color: G.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 6}}>
              🔧 Plan Mentenanță
            </div>
            <div style={{fontSize: 14, color: G.text, fontWeight: 600}}>
              {mentenanta.urmatoarea_data && <>Următoarea revizie: <strong>{fmtDate(mentenanta.urmatoarea_data)}</strong>
                {days !== null && <span style={{
                  marginLeft: 8, fontSize: 12,
                  color: days < 0 ? G.red : days <= 30 ? G.orange : G.green
                }}>
                  ({days < 0 ? `întârziere ${Math.abs(days)} zile` : days === 0 ? 'astăzi' : `în ${days} zile`})
                </span>}
              </>}
              {mentenanta.urmatoarea_ore && <div style={{marginTop: 4, fontSize: 13}}>
                Ore funcționare prag: <strong>{mentenanta.urmatoarea_ore.toLocaleString('ro-RO')}</strong>
              </div>}
            </div>
          </div>
        )}
        
        {activ.link_fisa_nas && (
          <div style={{marginTop: 14}}>
            <div style={{fontSize: 11, color: G.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 4}}>
              📎 Fișă service NAS
            </div>
            <div style={{fontSize: 12, color: G.muted, fontFamily: 'monospace', wordBreak: 'break-all', background: G.bg, padding: 8, borderRadius: 6, border: `1px solid ${G.border}`}}>
              {activ.link_fisa_nas}
            </div>
          </div>
        )}
        
        {activ.observatii && (
          <div style={{marginTop: 14}}>
            <Field label="Observații" value={activ.observatii} />
          </div>
        )}
        
        <div style={{marginTop: 20, padding: '12px 14px', background: G.bg, borderRadius: 8, fontSize: 12, color: G.muted, lineHeight: 1.6}}>
          💡 <strong style={{color: G.text}}>Versiune MVP:</strong> În curând vei putea edita activul, vedea istoricul de costuri și deschide tichete de avarie direct de aici.
        </div>
      </div>
    </div>
  )
}

// ─── Pagina principală Logistică ─────────────────────────────────────────────
export default function LogisticaPage() {
  const nav = useNavigate()
  const [profile, setProfile] = useState(null)
  const [accessLevel, setAccessLevel] = useState(undefined) // undefined=loading, null=no access, 'viewer'/'editor'/'admin'
  const [active, setActive] = useState([])
  const [categorii, setCategorii] = useState([])
  const [kpi, setKpi] = useState(null)
  const [load, setLoad] = useState(true)
  const [search, setSearch] = useState('')
  const [tipF, setTipF] = useState('Toate')
  const [subF, setSubF] = useState('Toate')
  const [stareF, setStareF] = useState('Toate')
  const [selected, setSelected] = useState(null)
  const [toast, showToast] = useToast()
  
  // ─── Inițializare: profile + acces ─────────────────────────────────────────
  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setAccessLevel(null); return }
      
      const [{ data: prof }, { data: access }] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user.id).single(),
        supabase.from('user_module_access').select('access_level').eq('profile_id', user.id).eq('module', 'Logistică').maybeSingle()
      ])
      setProfile(prof)
      
      // superadmin are acces oricum
      if (prof?.role === 'superadmin') setAccessLevel('admin')
      else setAccessLevel(access?.access_level || null)
    }
    init()
  }, [])
  
  // ─── Încarcă date după autorizare ──────────────────────────────────────────
  useEffect(() => {
    if (!accessLevel) return
    loadAll()
  }, [accessLevel])
  
  const loadAll = async () => {
    setLoad(true)
    const [activeRes, catRes, kpiRes] = await Promise.all([
      supabase.from('logistica_active')
        .select('*, logistica_categorii(tip, subcategorie), logistica_mentenanta_plan(urmatoarea_data, urmatoarea_ore)')
        .order('marca', { ascending: true })
        .order('model', { ascending: true }),
      supabase.from('logistica_categorii').select('*').order('tip').order('subcategorie'),
      supabase.from('v_kpi_logistica').select('*').single()
    ])
    setActive(activeRes.data || [])
    setCategorii(catRes.data || [])
    setKpi(kpiRes.data || null)
    setLoad(false)
  }
  
  // ─── Filtre ────────────────────────────────────────────────────────────────
  const tipuri = useMemo(() => {
    const set = new Set(categorii.map(c => c.tip))
    return ['Toate', ...Array.from(set).sort()]
  }, [categorii])
  
  const subcategoriiPentruTip = useMemo(() => {
    if (tipF === 'Toate') return []
    const subs = categorii.filter(c => c.tip === tipF && c.subcategorie).map(c => c.subcategorie)
    return ['Toate', ...subs.sort()]
  }, [tipF, categorii])
  
  const filtered = useMemo(() => {
    return active.filter(a => {
      const cat = a.logistica_categorii
      // search
      if (search) {
        const s = search.toLowerCase()
        const haystack = [
          a.cod_intern, a.nr_inmatriculare, a.marca, a.model, a.observatii,
          cat?.tip, cat?.subcategorie
        ].filter(Boolean).join(' ').toLowerCase()
        if (!haystack.includes(s)) return false
      }
      if (tipF !== 'Toate' && cat?.tip !== tipF) return false
      if (subF !== 'Toate' && cat?.subcategorie !== subF) return false
      if (stareF !== 'Toate' && a.stare !== stareF) return false
      return true
    })
  }, [active, search, tipF, subF, stareF])
  
  // ─── Renderizare ───────────────────────────────────────────────────────────
  
  // Loading inițial
  if (accessLevel === undefined) {
    return (
      <div style={{...S.page, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
        <div className="sp" style={{width: 28, height: 28}}/>
      </div>
    )
  }
  
  // Acces refuzat
  if (accessLevel === null) {
    return (
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
  }
  
  // Pagina principală
  return (
    <>
      <Toast toast={toast}/>
      
      {/* Header pagină */}
      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 12}}>
        <div>
          <div style={{display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4}}>
            <span style={{fontSize: 24}}>🚛</span>
            <div style={{fontSize: 22, fontWeight: 800, color: G.text}}>Logistică</div>
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 4,
              background: G.logistica + '22', color: G.logistica, letterSpacing: '.4px'
            }}>
              {accessLevel === 'admin' ? '⚙ ADMIN' : accessLevel === 'editor' ? '✎ EDITOR' : '👁 VIEWER'}
            </span>
          </div>
          <div style={{fontSize: 12, color: G.muted}}>
            {filtered.length}{filtered.length !== active.length ? ` din ${active.length}` : ''} active · {profile?.name}
          </div>
        </div>
      </div>
      
      {/* KPI */}
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
      
      {/* Filtre */}
      <div style={{...S.card, padding: 14, marginBottom: 14}}>
        <div style={{display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center'}}>
          <input 
            placeholder="🔍 Caută marcă, model, plăcuță, cod..." 
            value={search} 
            onChange={e => setSearch(e.target.value)}
            style={{...S.input, width: 280}}
          />
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
            <button onClick={() => { setSearch(''); setTipF('Toate'); setSubF('Toate'); setStareF('Toate') }} 
              style={{...S.btnS, fontSize: 12, color: G.muted}}>
              ✕ Șterge filtre
            </button>
          )}
          <div style={{flex: 1}}/>
          {accessLevel === 'admin' && (
            <button 
              onClick={() => showToast('Adăugare activ — în curând (Pasul B)', 'warn')} 
              style={{...S.btnP, background: G.logistica, color: '#000'}}>
              + Activ nou
            </button>
          )}
        </div>
      </div>
      
      {/* Tabel active */}
      {load ? (
        <div style={{display: 'flex', justifyContent: 'center', padding: 80}}>
          <div className="sp" style={{width: 32, height: 32}}/>
        </div>
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
                  <th style={{width: 80}}>Cod</th>
                  <th style={{width: 100}}>Plăcuță</th>
                  <th>Marcă · Model</th>
                  <th style={{width: 180}}>Categorie</th>
                  <th style={{width: 70}}>An</th>
                  <th style={{width: 130}}>Stare</th>
                  <th style={{width: 160}}>Mentenanță</th>
                  <th style={{width: 60}}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(a => {
                  const cat = a.logistica_categorii
                  const ment = a.logistica_mentenanta_plan?.[0]
                  return (
                    <tr key={a.id} 
                      onClick={() => setSelected(a)} 
                      style={{cursor: 'pointer'}}>
                      <td style={{fontFamily: 'monospace', fontSize: 12, color: G.blue, fontWeight: 600}}>
                        {a.cod_intern || <span style={{color: G.dim}}>—</span>}
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
            {filtered.length} active afișate · click pe rând pentru detalii
          </div>
        </div>
      )}
      
      {/* Modal detaliu */}
      {selected && <ActivDetailModal activ={selected} onClose={() => setSelected(null)} />}
    </>
  )
}
