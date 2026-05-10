// ===========================================================================
// MODUL HR — Personal · Autorizații · Documente · Alerte expirări
// ===========================================================================
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from './lib/supabase.js'

// Theme
const G = {
  bg:'#0D1117', surface:'#161B22', card:'#161B22', text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  border:'#30363D', border2:'#21262D',
  blue:'#1F6FEB', green:'#2EA043', yellow:'#D29922', orange:'#F0883E', red:'#F85149', purple:'#A371F7',
  hr:'#EC6CB9',  // Roz HR (același cu logo modul)
  greenDim:'#0F2A1E', redDim:'#3F1A1F', yellowDim:'#332100', orangeDim:'#3F2618', blueDim:'#0F1F3F',
}

const S = {
  page: { padding:'24px 28px', minHeight:'calc(100vh - 60px)', background:G.bg, color:G.text, fontFamily:'-apple-system,BlinkMacSystemFont,Inter,sans-serif' },
  card: { background:G.card, borderRadius:12, border:`1px solid ${G.border}` },
  input: { width:'100%', background:G.bg, border:`1px solid ${G.border}`, borderRadius:8, padding:'9px 12px', color:G.text, fontSize:13, outline:'none' },
  btnP: { padding:'9px 16px', background:G.hr, color:'#fff', border:'none', borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:600 },
  btnS: { padding:'8px 14px', background:G.surface, color:G.text, border:`1px solid ${G.border}`, borderRadius:8, cursor:'pointer', fontSize:13 },
}

const thStyle = { padding:'10px 12px', textAlign:'left', fontSize:11, fontWeight:700, color:G.muted, textTransform:'uppercase', letterSpacing:.5 }
const tdStyle = { padding:'10px 12px', verticalAlign:'top' }

// Toast helper
function Toast({ toast }) {
  if (!toast) return null
  const colors = {
    success: G.green, error: G.red, warn: G.orange, info: G.blue,
  }
  return (
    <div style={{position:'fixed', bottom:20, right:20, zIndex:1000, background:colors[toast.type] || G.green, color:'#fff', padding:'12px 18px', borderRadius:8, fontSize:13, fontWeight:600, boxShadow:'0 4px 12px rgba(0,0,0,0.5)'}}>
      {toast.msg}
    </div>
  )
}

// Map status -> color & label
function statusBadge(status, zile) {
  const config = {
    valid:      { bg: G.greenDim,  fg: G.green,  label: '✓ Valid' },
    expira_60z: { bg: G.greenDim,  fg: G.green,  label: `Expiră în ${zile}z` },
    expira_30z: { bg: G.yellowDim, fg: G.yellow, label: `⚠ Expiră în ${zile}z` },
    expira_7z:  { bg: G.orangeDim, fg: G.orange, label: `⚠⚠ Expiră în ${zile}z` },
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

export default function HRPage() {
  const nav = useNavigate()
  const [profile, setProfile] = useState(null)
  const [tab, setTab] = useState('personal')  // personal | autorizatii | alerte | documente | salarii
  const [employees, setEmployees] = useState([])
  const [autorizatii, setAutorizatii] = useState([])
  const [tipuri, setTipuri] = useState([])
  const [load, setLoad] = useState(false)
  const [toast, setToast] = useState(null)
  const [editEmp, setEditEmp] = useState(null)
  const [showAddAut, setShowAddAut] = useState(null)  // employee_id
  
  const showToast = (msg, type = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }
  
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: p } = await supabase.from('profiles').select('*').eq('id', user.id).single()
        setProfile(p)
        if (!['admin', 'superadmin'].includes(p?.role) && p?.department !== 'HR') {
          // Verifică access HR
          const { data: ma } = await supabase.from('user_module_access')
            .select('module').eq('profile_id', user.id).eq('module', 'HR').maybeSingle()
          if (!ma) { showToast('Acces refuzat la modul HR', 'error'); setTimeout(() => nav('/'), 2000); return }
        }
      }
      loadAll()
    })()
  }, [])
  
  const isAdmin = ['admin', 'superadmin'].includes(profile?.role) || profile?.department === 'HR'
  const isSuperAdmin = profile?.role === 'superadmin'
  
  const loadAll = async () => {
    setLoad(true)
    const [empRes, autRes, tipRes] = await Promise.all([
      supabase.from('employees').select('*, sites(name)').eq('active', true)
        .or('termination_date.is.null,termination_date.gte.' + new Date().toISOString().split('T')[0])
        .order('name'),
      supabase.from('v_hr_autorizatii_status').select('*').order('data_expirare', { ascending: true, nullsFirst: false }),
      supabase.from('hr_autorizatii_tipuri').select('*').eq('activ', true).order('ordine'),
    ])
    setEmployees(empRes.data || [])
    setAutorizatii(autRes.data || [])
    setTipuri(tipRes.data || [])
    setLoad(false)
  }
  
  // Stats per status
  const stats = useMemo(() => {
    const s = { total: autorizatii.length, valid: 0, expira_30z: 0, expira_7z: 0, expirat: 0, fara_exp: 0 }
    autorizatii.forEach(a => {
      if (a.status === 'valid' || a.status === 'expira_60z') s.valid += 1
      if (a.status === 'expira_30z') s.expira_30z += 1
      if (a.status === 'expira_7z') s.expira_7z += 1
      if (a.status === 'expirat') s.expirat += 1
      if (a.status === 'fara_exp') s.fara_exp += 1
    })
    return s
  }, [autorizatii])
  
  const tabs = [
    { key: 'personal',    icon: '👥', label: 'Angajați' },
    { key: 'autorizatii', icon: '📋', label: 'Autorizații' },
    { key: 'alerte',      icon: '🔔', label: 'Alerte', badge: stats.expirat + stats.expira_7z },
    { key: 'documente',   icon: '📁', label: 'Documente personale' },
    { key: 'salarii',     icon: '💰', label: 'Salarii', superOnly: true },
  ].filter(t => !t.superOnly || isSuperAdmin)
  
  return (
    <div style={S.page}>
      <Toast toast={toast} />
      
      {/* Header */}
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:18}}>
        <div>
          <div style={{fontSize:22, fontWeight:800, color:G.text, display:'flex', alignItems:'center', gap:10}}>
            <span style={{fontSize:28}}>👥</span> 
            <span style={{background: `linear-gradient(135deg, ${G.hr} 0%, ${G.purple} 100%)`, WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent'}}>HR — Resurse Umane</span>
          </div>
          <div style={{fontSize:12, color:G.muted, marginTop:4}}>
            {employees.length} angajați activi · {autorizatii.length} autorizații în evidență · {stats.expirat} expirate
          </div>
        </div>
      </div>
      
      {/* Tab navigation */}
      <div style={{display:'flex', gap:6, marginBottom:18, padding:6, background:G.surface, borderRadius:12, border:`1px solid ${G.border}`, flexWrap:'wrap'}}>
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            padding:'10px 16px', borderRadius:8, border:'none', cursor:'pointer',
            background: tab === t.key ? G.hr + '33' : 'transparent',
            color: tab === t.key ? G.hr : G.muted,
            fontWeight:700, fontSize:13, display:'flex', alignItems:'center', gap:8,
            transition:'all 0.15s'
          }}>
            <span>{t.icon}</span> {t.label}
            {t.badge > 0 && <span style={{padding:'2px 7px', background:G.red, color:'#fff', borderRadius:10, fontSize:10, fontWeight:800}}>{t.badge}</span>}
          </button>
        ))}
      </div>
      
      {load && <div style={{padding:60, textAlign:'center', color:G.muted}}><div className="sp" style={{margin:'0 auto'}}/></div>}
      
      {!load && tab === 'personal' && <TabPersonal employees={employees} autorizatii={autorizatii} onClickEmp={setEditEmp} showToast={showToast} />}
      {!load && tab === 'autorizatii' && <TabAutorizatii autorizatii={autorizatii} tipuri={tipuri} onAddAut={setShowAddAut} isAdmin={isAdmin} onReload={loadAll} showToast={showToast} />}
      {!load && tab === 'alerte' && <TabAlerte autorizatii={autorizatii} stats={stats} onClickAut={(a) => setEditEmp(employees.find(e => e.id === a.employee_id))} />}
      {!load && tab === 'documente' && <TabDocumente employees={employees} showToast={showToast} />}
      {!load && tab === 'salarii' && isSuperAdmin && <TabSalarii showToast={showToast} />}
      
      {editEmp && (
        <ModalProfilAngajat 
          employee={editEmp} 
          autorizatii={autorizatii.filter(a => a.employee_id === editEmp.id)}
          tipuri={tipuri}
          isAdmin={isAdmin}
          onClose={() => setEditEmp(null)}
          onReload={loadAll}
          showToast={showToast}
        />
      )}
      
      {showAddAut && (
        <ModalAddAutorizatie 
          employeeId={showAddAut}
          tipuri={tipuri}
          onClose={() => setShowAddAut(null)}
          onSaved={() => { loadAll(); setShowAddAut(null) }}
          showToast={showToast}
        />
      )}
    </div>
  )
}

// ===========================================================================
// TAB ANGAJAȚI — listă cards cu filtre
// ===========================================================================
function TabPersonal({ employees, autorizatii, onClickEmp, showToast }) {
  const [search, setSearch] = useState('')
  const [deptFilter, setDeptFilter] = useState('Toate')
  const [autFilter, setAutFilter] = useState('toti')  // toti | cu_aut | fara_aut | expirate
  
  const filtered = useMemo(() => {
    return employees.filter(e => {
      if (deptFilter !== 'Toate' && (e.departament_hr || '') !== deptFilter) return false
      
      const empAut = autorizatii.filter(a => a.employee_id === e.id)
      const hasExpirate = empAut.some(a => a.status === 'expirat' || a.status === 'expira_7z')
      
      if (autFilter === 'cu_aut' && empAut.length === 0) return false
      if (autFilter === 'fara_aut' && empAut.length > 0) return false
      if (autFilter === 'expirate' && !hasExpirate) return false
      
      if (search.trim()) {
        const s = search.toLowerCase()
        if (!e.name?.toLowerCase().includes(s) && 
            !e.functie?.toLowerCase().includes(s) && 
            !e.telefon?.toLowerCase().includes(s)) return false
      }
      return true
    })
  }, [employees, autorizatii, deptFilter, autFilter, search])
  
  const departments = useMemo(() => {
    const set = new Set(employees.map(e => e.departament_hr).filter(Boolean))
    return ['Toate', ...Array.from(set).sort()]
  }, [employees])
  
  return (
    <div>
      {/* Filters */}
      <div style={{display:'flex', gap:10, marginBottom:14, flexWrap:'wrap', alignItems:'center'}}>
        <input 
          type="text" value={search} onChange={e => setSearch(e.target.value)} 
          placeholder="🔍 Caută după nume, funcție, telefon..."
          style={{...S.input, flex:1, minWidth:280}}
        />
        <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)} style={{...S.input, width:'auto', minWidth:160}}>
          {departments.map(d => <option key={d} value={d}>🏢 {d}</option>)}
        </select>
        <select value={autFilter} onChange={e => setAutFilter(e.target.value)} style={{...S.input, width:'auto', minWidth:180}}>
          <option value="toti">Toți angajații</option>
          <option value="cu_aut">Doar cu autorizații</option>
          <option value="fara_aut">Fără autorizații</option>
          <option value="expirate">⚠ Cu autorizații expirate</option>
        </select>
      </div>
      
      <div style={{fontSize:12, color:G.muted, marginBottom:12}}>{filtered.length} angajați găsiți</div>
      
      {/* Cards grid */}
      <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(280px, 1fr))', gap:12}}>
        {filtered.map(e => {
          const empAut = autorizatii.filter(a => a.employee_id === e.id)
          const expirate = empAut.filter(a => a.status === 'expirat').length
          const expira7 = empAut.filter(a => a.status === 'expira_7z').length
          const expira30 = empAut.filter(a => a.status === 'expira_30z').length
          
          return (
            <div key={e.id} onClick={() => onClickEmp(e)} style={{
              ...S.card, padding:14, cursor:'pointer', transition:'all 0.15s',
              borderLeft: expirate > 0 ? `3px solid ${G.red}` : expira7 > 0 ? `3px solid ${G.orange}` : expira30 > 0 ? `3px solid ${G.yellow}` : `3px solid ${G.green}`
            }}
              onMouseEnter={ev => ev.currentTarget.style.transform='translateY(-2px)'}
              onMouseLeave={ev => ev.currentTarget.style.transform='translateY(0)'}
            >
              <div style={{fontSize:14, fontWeight:700, color:G.text, marginBottom:4}}>{e.name}</div>
              <div style={{fontSize:11, color:G.muted, marginBottom:10}}>{e.functie || 'Fără funcție'}</div>
              <div style={{display:'flex', gap:6, flexWrap:'wrap', marginBottom:10}}>
                {e.departament_hr && <span style={{padding:'2px 7px', background: G.blue+'22', color:G.blue, borderRadius:4, fontSize:10, fontWeight:600}}>🏢 {e.departament_hr}</span>}
                {e.sites?.name && <span style={{padding:'2px 7px', background: G.purple+'22', color:G.purple, borderRadius:4, fontSize:10, fontWeight:600}}>📍 {e.sites.name}</span>}
              </div>
              {e.telefon && <div style={{fontSize:11, color:G.muted, marginBottom:8}}>📞 {e.telefon}</div>}
              <div style={{display:'flex', gap:6, marginTop:10, paddingTop:10, borderTop:`1px solid ${G.border}`}}>
                {empAut.length > 0 ? (
                  <>
                    <span style={{flex:1, fontSize:11, color:G.muted}}>📋 {empAut.length} autorizație{empAut.length !== 1 ? '/i' : ''}</span>
                    {expirate > 0 && <span style={{padding:'2px 6px', background:G.red+'33', color:G.red, borderRadius:4, fontSize:10, fontWeight:700}}>{expirate} EXP</span>}
                    {expira7 > 0 && <span style={{padding:'2px 6px', background:G.orange+'33', color:G.orange, borderRadius:4, fontSize:10, fontWeight:700}}>{expira7} 7z</span>}
                    {expira30 > 0 && <span style={{padding:'2px 6px', background:G.yellow+'33', color:G.yellow, borderRadius:4, fontSize:10, fontWeight:700}}>{expira30} 30z</span>}
                  </>
                ) : (
                  <span style={{fontSize:11, color:G.dim, fontStyle:'italic'}}>Fără autorizații înregistrate</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ===========================================================================
// TAB AUTORIZAȚII — tabel cu toate
// ===========================================================================
function TabAutorizatii({ autorizatii, tipuri, onAddAut, isAdmin, onReload, showToast }) {
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('Toate')
  const [statusFilter, setStatusFilter] = useState('toate')
  
  const categorii = useMemo(() => ['Toate', ...new Set(tipuri.map(t => t.categorie).filter(Boolean))], [tipuri])
  
  const filtered = useMemo(() => {
    return autorizatii.filter(a => {
      if (catFilter !== 'Toate' && a.tip_categorie !== catFilter) return false
      if (statusFilter !== 'toate' && a.status !== statusFilter) return false
      if (search.trim()) {
        const s = search.toLowerCase()
        return a.employee_name?.toLowerCase().includes(s) ||
               a.tip_denumire?.toLowerCase().includes(s) ||
               a.numar_autorizatie?.toLowerCase().includes(s) ||
               a.procedeu_sudura?.toLowerCase().includes(s) ||
               (a.domenii || []).some(d => d.toLowerCase().includes(s))
      }
      return true
    })
  }, [autorizatii, catFilter, statusFilter, search])
  
  const handleDelete = async (a) => {
    if (!confirm(`Ștergi autorizația ${a.tip_denumire} pentru ${a.employee_name}?`)) return
    const { error } = await supabase.from('hr_autorizatii').delete().eq('id', a.id)
    if (error) showToast('Eroare: ' + error.message, 'error')
    else { showToast('✓ Șters'); onReload() }
  }
  
  return (
    <div>
      <div style={{display:'flex', gap:10, marginBottom:14, flexWrap:'wrap', alignItems:'center'}}>
        <input type="text" value={search} onChange={e => setSearch(e.target.value)} 
          placeholder="🔍 Caută după nume angajat, tip, număr, procedeu..." style={{...S.input, flex:1, minWidth:280}}/>
        <select value={catFilter} onChange={e => setCatFilter(e.target.value)} style={{...S.input, width:'auto', minWidth:140}}>
          {categorii.map(c => <option key={c} value={c}>{c === 'Toate' ? '📋 Toate categoriile' : c}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{...S.input, width:'auto', minWidth:140}}>
          <option value="toate">Toate statusurile</option>
          <option value="valid">✓ Valide</option>
          <option value="expira_30z">⚠ Expiră 30z</option>
          <option value="expira_7z">⚠⚠ Expiră 7z</option>
          <option value="expirat">🚨 EXPIRATE</option>
          <option value="fara_exp">∞ Fără expirare</option>
        </select>
      </div>
      
      <div style={{...S.card, overflow:'hidden'}}>
        <div style={{overflowX:'auto'}}>
          <table style={{width:'100%', borderCollapse:'collapse', fontSize:13}}>
            <thead style={{background:G.bg}}>
              <tr>
                <th style={thStyle}>Angajat</th>
                <th style={thStyle}>Tip Autorizație</th>
                <th style={thStyle}>Detalii</th>
                <th style={thStyle}>Nr.</th>
                <th style={thStyle}>Emitent</th>
                <th style={thStyle}>Expirare</th>
                <th style={thStyle}>Status</th>
                {isAdmin && <th style={{...thStyle, textAlign:'right'}}>Acțiuni</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map(a => (
                <tr key={a.id} style={{borderTop:`1px solid ${G.border}`}}>
                  <td style={{...tdStyle, fontWeight:600}}>{a.employee_name}</td>
                  <td style={tdStyle}>
                    <div style={{fontWeight:600}}>{a.tip_denumire}</div>
                    <div style={{fontSize:10, color:G.muted}}>{a.tip_categorie}</div>
                  </td>
                  <td style={{...tdStyle, fontSize:11}}>
                    {a.procedeu_sudura && <div>🔥 Procedeu: <strong>{a.procedeu_sudura}</strong>{a.diametru_teava_mm && ` · Ø${a.diametru_teava_mm}mm`}{a.calitate_material && ` · ${a.calitate_material}`}</div>}
                    {a.domenii?.length > 0 && <div>🏷 Domenii: <strong>{a.domenii.join(', ')}</strong></div>}
                    {a.subcategorie && !a.domenii?.length && <div style={{color:G.muted}}>{a.subcategorie}</div>}
                  </td>
                  <td style={{...tdStyle, fontFamily:'monospace', fontSize:11}}>{a.numar_autorizatie || <span style={{color:G.dim}}>—</span>}</td>
                  <td style={tdStyle}>{a.emitent || <span style={{color:G.dim}}>—</span>}</td>
                  <td style={tdStyle}>{a.fara_expirare ? '∞' : a.data_expirare ? new Date(a.data_expirare).toLocaleDateString('ro-RO') : '—'}</td>
                  <td style={tdStyle}>{statusBadge(a.status, a.zile_pana_expirare)}</td>
                  {isAdmin && (
                    <td style={{...tdStyle, textAlign:'right'}}>
                      <button onClick={() => handleDelete(a)} style={{padding:'4px 8px', background:G.red+'22', color:G.red, border:`1px solid ${G.red}55`, borderRadius:4, fontSize:11, cursor:'pointer'}}>🗑️</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && <div style={{padding:40, textAlign:'center', color:G.muted}}>Nicio autorizație găsită</div>}
      </div>
      
      <div style={{marginTop:12, fontSize:11, color:G.muted, textAlign:'center'}}>
        💡 {filtered.length} / {autorizatii.length} autorizații afișate · Click pe angajat în tab "Angajați" pentru detalii și editare
      </div>
    </div>
  )
}

// ===========================================================================
// TAB ALERTE — Doar autorizațiile cu probleme (expirate + curand)
// ===========================================================================
function TabAlerte({ autorizatii, stats, onClickAut }) {
  const expirate = autorizatii.filter(a => a.status === 'expirat')
  const expira7 = autorizatii.filter(a => a.status === 'expira_7z')
  const expira30 = autorizatii.filter(a => a.status === 'expira_30z')
  
  return (
    <div>
      {/* Stats cards */}
      <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))', gap:12, marginBottom:18}}>
        <div style={{...S.card, padding:14, borderLeft:`3px solid ${G.green}`}}>
          <div style={{fontSize:11, color:G.muted, fontWeight:600}}>✓ Valide</div>
          <div style={{fontSize:24, fontWeight:800, color:G.green, marginTop:4}}>{stats.valid}</div>
        </div>
        <div style={{...S.card, padding:14, borderLeft:`3px solid ${G.green}`}}>
          <div style={{fontSize:11, color:G.muted, fontWeight:600}}>∞ Fără expirare</div>
          <div style={{fontSize:24, fontWeight:800, color:G.green, marginTop:4}}>{stats.fara_exp}</div>
        </div>
        <div style={{...S.card, padding:14, borderLeft:`3px solid ${G.yellow}`}}>
          <div style={{fontSize:11, color:G.muted, fontWeight:600}}>⚠ Expiră 30z</div>
          <div style={{fontSize:24, fontWeight:800, color:G.yellow, marginTop:4}}>{stats.expira_30z}</div>
        </div>
        <div style={{...S.card, padding:14, borderLeft:`3px solid ${G.orange}`}}>
          <div style={{fontSize:11, color:G.muted, fontWeight:600}}>⚠⚠ Expiră 7z</div>
          <div style={{fontSize:24, fontWeight:800, color:G.orange, marginTop:4}}>{stats.expira_7z}</div>
        </div>
        <div style={{...S.card, padding:14, borderLeft:`3px solid ${G.red}`}}>
          <div style={{fontSize:11, color:G.muted, fontWeight:600}}>🚨 EXPIRATE</div>
          <div style={{fontSize:24, fontWeight:800, color:G.red, marginTop:4}}>{stats.expirat}</div>
        </div>
      </div>
      
      <SectiuneAlerte titlu="🚨 EXPIRATE — necesită reînnoire URGENT" lista={expirate} color={G.red} onClick={onClickAut} />
      <SectiuneAlerte titlu="⚠⚠ Expiră în mai puțin de 7 zile" lista={expira7} color={G.orange} onClick={onClickAut} />
      <SectiuneAlerte titlu="⚠ Expiră în mai puțin de 30 zile" lista={expira30} color={G.yellow} onClick={onClickAut} />
      
      {expirate.length === 0 && expira7.length === 0 && expira30.length === 0 && (
        <div style={{...S.card, padding:60, textAlign:'center'}}>
          <div style={{fontSize:48, marginBottom:12}}>✅</div>
          <div style={{fontSize:18, fontWeight:700, color:G.green, marginBottom:8}}>Totul e în regulă!</div>
          <div style={{fontSize:13, color:G.muted}}>Nicio autorizație nu necesită atenție în următoarele 30 zile.</div>
        </div>
      )}
    </div>
  )
}

function SectiuneAlerte({ titlu, lista, color, onClick }) {
  if (lista.length === 0) return null
  return (
    <div style={{marginBottom:18}}>
      <div style={{fontSize:13, fontWeight:700, color, marginBottom:10}}>{titlu} ({lista.length})</div>
      <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(320px, 1fr))', gap:10}}>
        {lista.map(a => (
          <div key={a.id} onClick={() => onClick(a)} style={{
            ...S.card, padding:12, cursor:'pointer', borderLeft:`3px solid ${color}`,
            transition:'transform 0.15s'
          }}
            onMouseEnter={e => e.currentTarget.style.transform='translateX(4px)'}
            onMouseLeave={e => e.currentTarget.style.transform='translateX(0)'}
          >
            <div style={{fontSize:14, fontWeight:700, color:G.text}}>{a.employee_name}</div>
            <div style={{fontSize:12, color:G.muted, marginTop:2}}>{a.tip_denumire}</div>
            {a.procedeu_sudura && <div style={{fontSize:11, color:G.dim, marginTop:2}}>🔥 {a.procedeu_sudura}{a.diametru_teava_mm && ` · Ø${a.diametru_teava_mm}mm`}</div>}
            {a.domenii?.length > 0 && <div style={{fontSize:11, color:G.dim, marginTop:2}}>🏷 {a.domenii.join(', ')}</div>}
            <div style={{fontSize:11, color, marginTop:6, fontWeight:700}}>
              {a.fara_expirare ? '∞ Fără expirare' : a.data_expirare ? `📅 ${new Date(a.data_expirare).toLocaleDateString('ro-RO')}` : '—'}
              {a.zile_pana_expirare !== null && a.zile_pana_expirare !== undefined && (
                <span style={{marginLeft:8}}>{a.zile_pana_expirare > 0 ? `(${a.zile_pana_expirare}z rămase)` : `(EXPIRAT cu ${Math.abs(a.zile_pana_expirare)}z)`}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ===========================================================================
// TAB DOCUMENTE PERSONALE — placeholder (buletin, permis ședere, etc.)
// ===========================================================================
function TabDocumente({ employees, showToast }) {
  return (
    <div style={{...S.card, padding:50, textAlign:'center'}}>
      <div style={{fontSize:48, marginBottom:14}}>📁</div>
      <div style={{fontSize:18, fontWeight:700, color:G.text, marginBottom:8}}>Documente Personale</div>
      <div style={{fontSize:13, color:G.muted, maxWidth:500, margin:'0 auto 16px', lineHeight:1.6}}>
        Aici vor putea fi încărcate documentele personale ale angajaților:<br/>
        <strong>Buletin · Permis de ședere străini · Permis de muncă · Diplome studii · Cazier · Contract muncă</strong>
      </div>
      <div style={{padding:'8px 16px', background:G.purple+'22', color:G.purple, borderRadius:6, display:'inline-block', fontSize:11, fontWeight:700, letterSpacing:.5}}>
        🚧 ÎN CURÂND — Faza 2
      </div>
    </div>
  )
}

// ===========================================================================
// TAB SALARII — copiat din Pontaj fără Export Banca (super admin only)
// ===========================================================================
function TabSalarii({ showToast }) {
  return (
    <div style={{...S.card, padding:50, textAlign:'center'}}>
      <div style={{fontSize:48, marginBottom:14}}>💰</div>
      <div style={{fontSize:18, fontWeight:700, color:G.text, marginBottom:8}}>Salarii — Vezi în Modulul Pontaj</div>
      <div style={{fontSize:13, color:G.muted, maxWidth:500, margin:'0 auto 16px', lineHeight:1.6}}>
        Pentru moment, foloseşte modulul Pontaj → Salarii (acces direct).<br/>
        În <strong>Faza 2</strong> vom integra aici versiunea fără Export Banca (doar super admin).
      </div>
      <a href="/salarii" style={{...S.btnP, textDecoration:'none', display:'inline-block'}}>💰 Deschide Salarii (Pontaj)</a>
    </div>
  )
}

// ===========================================================================
// MODAL PROFIL ANGAJAT — Date + Tab Autorizații
// ===========================================================================
function ModalProfilAngajat({ employee, autorizatii, tipuri, isAdmin, onClose, onReload, showToast }) {
  const [tabM, setTabM] = useState('date')  // date | autorizatii
  const [showAddAut, setShowAddAut] = useState(false)
  const [editAut, setEditAut] = useState(null)
  
  const handleDelete = async (a) => {
    if (!confirm(`Ștergi autorizația ${a.tip_denumire}?`)) return
    const { error } = await supabase.from('hr_autorizatii').delete().eq('id', a.id)
    if (error) showToast('Eroare: ' + error.message, 'error')
    else { showToast('✓ Șters'); onReload() }
  }
  
  return (
    <div style={{position:'fixed', inset:0, background:'rgba(0,0,0,0.85)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:20}}>
      <div style={{...S.card, width:'100%', maxWidth:880, maxHeight:'92vh', overflow:'auto', padding:0}}>
        {/* Header */}
        <div style={{padding:'18px 24px', background:G.surface, borderBottom:`1px solid ${G.border}`, display:'flex', justifyContent:'space-between', alignItems:'flex-start'}}>
          <div>
            <div style={{fontSize:20, fontWeight:800, color:G.text}}>{employee.name}</div>
            <div style={{fontSize:12, color:G.muted, marginTop:4}}>
              {employee.functie} · {employee.departament_hr || '—'} {employee.telefon && `· 📞 ${employee.telefon}`}
            </div>
          </div>
          <button onClick={onClose} style={{...S.btnS, padding:'4px 10px'}}>✕</button>
        </div>
        
        {/* Tabs */}
        <div style={{display:'flex', gap:6, padding:'10px 24px', borderBottom:`1px solid ${G.border}`}}>
          {[
            { key: 'date', icon:'📋', label: 'Date personale' },
            { key: 'autorizatii', icon: '📑', label: `Autorizații (${autorizatii.length})` },
          ].map(t => (
            <button key={t.key} onClick={() => setTabM(t.key)} style={{
              padding:'8px 14px', borderRadius:8, border:'none', cursor:'pointer',
              background: tabM === t.key ? G.hr + '33' : 'transparent',
              color: tabM === t.key ? G.hr : G.muted, fontWeight:600, fontSize:13
            }}>{t.icon} {t.label}</button>
          ))}
        </div>
        
        <div style={{padding:'18px 24px'}}>
          {tabM === 'date' && (
            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, fontSize:13}}>
              <Field label="Nume" value={employee.name} />
              <Field label="Funcție" value={employee.functie} />
              <Field label="Departament HR" value={employee.departament_hr} />
              <Field label="Rol în firmă" value={employee.rol_in_firma} />
              <Field label="Telefon" value={employee.telefon} />
              <Field label="Activ" value={employee.active ? 'Da' : 'Nu'} />
              <Field label="Data angajare" value={employee.hire_date} />
              <Field label="Are autorizații" value={employee.are_autorizatii ? 'Da' : 'Nu'} />
              <Field label="Șantier alocat" value={employee.sites?.name} />
              {employee.observatii_hr && (
                <div style={{gridColumn:'1/-1'}}>
                  <Field label="Observații HR" value={employee.observatii_hr} />
                </div>
              )}
            </div>
          )}
          
          {tabM === 'autorizatii' && (
            <div>
              {isAdmin && (
                <div style={{marginBottom:14, display:'flex', justifyContent:'flex-end'}}>
                  <button onClick={() => setShowAddAut(true)} style={S.btnP}>+ Adaugă autorizație</button>
                </div>
              )}
              {autorizatii.length === 0 ? (
                <div style={{padding:30, textAlign:'center', color:G.muted}}>Nicio autorizație înregistrată</div>
              ) : (
                <div style={{display:'flex', flexDirection:'column', gap:8}}>
                  {autorizatii.map(a => (
                    <div key={a.id} style={{...S.card, padding:12, borderLeft:`3px solid ${a.status === 'expirat' ? G.red : a.status === 'expira_7z' ? G.orange : a.status === 'expira_30z' ? G.yellow : G.green}`}}>
                      <div style={{display:'flex', justifyContent:'space-between', gap:12}}>
                        <div style={{flex:1}}>
                          <div style={{fontSize:14, fontWeight:700, color:G.text}}>{a.tip_denumire}</div>
                          <div style={{fontSize:11, color:G.muted, marginTop:2}}>{a.tip_categorie}</div>
                          {a.procedeu_sudura && <div style={{fontSize:12, marginTop:6, color:G.text}}>🔥 Procedeu: <strong>{a.procedeu_sudura}</strong>{a.diametru_teava_mm && ` · Ø${a.diametru_teava_mm}mm`}{a.calitate_material && ` · ${a.calitate_material}`}</div>}
                          {a.domenii?.length > 0 && <div style={{fontSize:12, marginTop:6, color:G.text}}>🏷 Domenii: <strong>{a.domenii.join(', ')}</strong></div>}
                          {a.subcategorie && !a.domenii?.length && <div style={{fontSize:11, marginTop:4, color:G.muted}}>{a.subcategorie}</div>}
                          <div style={{fontSize:11, color:G.muted, marginTop:6}}>
                            {a.numar_autorizatie && <>📜 {a.numar_autorizatie} · </>}
                            {a.emitent && <>🏛 {a.emitent} · </>}
                            📅 {a.fara_expirare ? '∞ Fără expirare' : a.data_expirare ? new Date(a.data_expirare).toLocaleDateString('ro-RO') : '—'}
                          </div>
                          {a.observatii && <div style={{fontSize:11, color:G.dim, marginTop:4, fontStyle:'italic'}}>💬 {a.observatii}</div>}
                        </div>
                        <div style={{display:'flex', flexDirection:'column', gap:6, alignItems:'flex-end'}}>
                          {statusBadge(a.status, a.zile_pana_expirare)}
                          {isAdmin && (
                            <button onClick={() => handleDelete(a)} style={{padding:'3px 8px', background:G.red+'22', color:G.red, border:`1px solid ${G.red}55`, borderRadius:4, fontSize:11, cursor:'pointer'}}>🗑️</button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      
      {showAddAut && (
        <ModalAddAutorizatie 
          employeeId={employee.id} 
          tipuri={tipuri}
          onClose={() => setShowAddAut(false)} 
          onSaved={() => { onReload(); setShowAddAut(false) }} 
          showToast={showToast} 
        />
      )}
    </div>
  )
}

function Field({ label, value }) {
  return (
    <div>
      <div style={{fontSize:10, color:G.muted, fontWeight:700, textTransform:'uppercase', letterSpacing:.6, marginBottom:4}}>{label}</div>
      <div style={{fontSize:13, color:G.text, padding:'8px 10px', background:G.bg, border:`1px solid ${G.border}`, borderRadius:6, minHeight:32}}>
        {value || <span style={{color:G.dim}}>—</span>}
      </div>
    </div>
  )
}

// ===========================================================================
// MODAL ADAUGĂ AUTORIZAȚIE
// ===========================================================================
const DOMENII_RTE = ['Gaze', 'Apă', 'Țiței', 'Electrice', 'Construcții civile', 'Construcții edilitare']
const PROCEDEE_SUDURA = ['111', '111MMA', '135', '136', '135-136', '141', '141-111', '111+141']
const CALITATI_MATERIAL = ['Oțel', 'Oțel inox', 'Oțel carbon', 'PEHD', 'Aluminiu', 'Cupru', 'Aliaj']

function ModalAddAutorizatie({ employeeId, tipuri, onClose, onSaved, showToast }) {
  const [tipId, setTipId] = useState('')
  const [numar, setNumar] = useState('')
  const [emitent, setEmitent] = useState('')
  const [dataEmitere, setDataEmitere] = useState('')
  const [dataExpirare, setDataExpirare] = useState('')
  const [faraExpirare, setFaraExpirare] = useState(false)
  const [procedeu, setProcedeu] = useState('')
  const [diametru, setDiametru] = useState('')
  const [calitateMat, setCalitateMat] = useState('')
  const [domenii, setDomenii] = useState([])
  const [observatii, setObservatii] = useState('')
  const [saving, setSaving] = useState(false)
  
  const tipSelectat = tipuri.find(t => t.id === Number(tipId))
  
  useEffect(() => {
    if (tipSelectat?.emitent_default && !emitent) setEmitent(tipSelectat.emitent_default)
  }, [tipSelectat])
  
  const save = async () => {
    if (!tipId) { showToast('Alege tipul autorizației', 'warn'); return }
    setSaving(true)
    
    const payload = {
      employee_id: employeeId,
      tip_id: Number(tipId),
      numar_autorizatie: numar.trim() || null,
      emitent: emitent.trim() || null,
      data_emitere: dataEmitere || null,
      data_expirare: faraExpirare ? null : (dataExpirare || null),
      fara_expirare: faraExpirare,
      procedeu_sudura: procedeu.trim() || null,
      diametru_teava_mm: diametru ? Number(diametru) : null,
      calitate_material: calitateMat.trim() || null,
      domenii: domenii.length > 0 ? domenii : null,
      observatii: observatii.trim() || null,
    }
    
    const { error } = await supabase.from('hr_autorizatii').insert(payload)
    setSaving(false)
    if (error) { showToast('Eroare: ' + error.message, 'error'); return }
    showToast('✓ Autorizație adăugată')
    onSaved()
  }
  
  return (
    <div style={{position:'fixed', inset:0, background:'rgba(0,0,0,0.92)', zIndex:1100, display:'flex', alignItems:'center', justifyContent:'center', padding:20}}>
      <div style={{...S.card, width:'100%', maxWidth:560, maxHeight:'92vh', overflow:'auto', padding:24}}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:18, paddingBottom:12, borderBottom:`1px solid ${G.border}`}}>
          <div style={{fontSize:17, fontWeight:700, color:G.text}}>+ Adaugă Autorizație</div>
          <button onClick={onClose} style={{...S.btnS, padding:'4px 10px'}}>✕</button>
        </div>
        
        <Lbl>Tip Autorizație *</Lbl>
        <select value={tipId} onChange={e => setTipId(e.target.value)} style={{...S.input, marginBottom:12}}>
          <option value="">— alege —</option>
          {Object.entries(tipuri.reduce((acc, t) => { (acc[t.categorie] = acc[t.categorie] || []).push(t); return acc }, {})).map(([cat, lista]) => (
            <optgroup key={cat} label={cat.toUpperCase()}>
              {lista.map(t => <option key={t.id} value={t.id}>{t.denumire}</option>)}
            </optgroup>
          ))}
        </select>
        
        {tipSelectat?.necesita_procedura && (
          <div style={{marginBottom:12, padding:12, background:G.orange+'11', border:`1px solid ${G.orange}33`, borderRadius:8}}>
            <div style={{fontSize:11, color:G.orange, fontWeight:700, marginBottom:8}}>🔥 SUDOR — date specifice</div>
            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8}}>
              <div>
                <Lbl>Procedeu</Lbl>
                <select value={procedeu} onChange={e => setProcedeu(e.target.value)} style={S.input}>
                  <option value="">— alege —</option>
                  {PROCEDEE_SUDURA.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <Lbl>Diametru (mm)</Lbl>
                <input type="number" step="0.1" value={diametru} onChange={e => setDiametru(e.target.value)} placeholder="48.3" style={S.input}/>
              </div>
              <div>
                <Lbl>Calitate material</Lbl>
                <select value={calitateMat} onChange={e => setCalitateMat(e.target.value)} style={S.input}>
                  <option value="">— alege —</option>
                  {CALITATI_MATERIAL.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
          </div>
        )}
        
        {tipSelectat?.necesita_domenii && (
          <div style={{marginBottom:12, padding:12, background:G.blue+'11', border:`1px solid ${G.blue}33`, borderRadius:8}}>
            <div style={{fontSize:11, color:G.blue, fontWeight:700, marginBottom:8}}>🏷 RTE / RTS — Domenii (selectează multiple)</div>
            <div style={{display:'flex', gap:6, flexWrap:'wrap'}}>
              {DOMENII_RTE.map(d => (
                <label key={d} style={{display:'flex', alignItems:'center', gap:6, padding:'6px 10px', background: domenii.includes(d) ? G.blue+'33' : G.bg, border:`1px solid ${domenii.includes(d) ? G.blue : G.border}`, borderRadius:6, cursor:'pointer', fontSize:12}}>
                  <input type="checkbox" checked={domenii.includes(d)} onChange={e => {
                    setDomenii(e.target.checked ? [...domenii, d] : domenii.filter(x => x !== d))
                  }} style={{accentColor:G.blue}}/>
                  {d}
                </label>
              ))}
            </div>
          </div>
        )}
        
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:10}}>
          <div>
            <Lbl>Număr autorizație</Lbl>
            <input value={numar} onChange={e => setNumar(e.target.value)} placeholder="NR. 123456" style={S.input}/>
          </div>
          <div>
            <Lbl>Emitent</Lbl>
            <input value={emitent} onChange={e => setEmitent(e.target.value)} placeholder="ISCIR / RINA / TUV / ANRE..." style={S.input}/>
          </div>
        </div>
        
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:10}}>
          <div>
            <Lbl>Data emitere</Lbl>
            <input type="date" value={dataEmitere} onChange={e => setDataEmitere(e.target.value)} style={S.input}/>
          </div>
          <div>
            <Lbl>Data expirare</Lbl>
            <input type="date" value={dataExpirare} onChange={e => setDataExpirare(e.target.value)} disabled={faraExpirare} style={{...S.input, opacity: faraExpirare ? 0.5 : 1}}/>
          </div>
        </div>
        
        <label style={{display:'flex', alignItems:'center', gap:8, marginBottom:14, cursor:'pointer', fontSize:13, color:G.text}}>
          <input type="checkbox" checked={faraExpirare} onChange={e => setFaraExpirare(e.target.checked)} style={{accentColor:G.green}}/>
          ∞ Fără expirare (curs permanent — "NU E CAZUL")
        </label>
        
        <Lbl>Observații</Lbl>
        <textarea value={observatii} onChange={e => setObservatii(e.target.value)} placeholder="Note suplimentare..." style={{...S.input, minHeight:60, resize:'vertical', marginBottom:14, fontFamily:'inherit'}}/>
        
        <div style={{display:'flex', gap:10, justifyContent:'flex-end', paddingTop:12, borderTop:`1px solid ${G.border}`}}>
          <button onClick={onClose} style={S.btnS}>Anulează</button>
          <button onClick={save} disabled={saving || !tipId} style={{...S.btnP, opacity: (saving || !tipId) ? 0.5 : 1}}>{saving ? '...' : '✓ Salvează'}</button>
        </div>
      </div>
    </div>
  )
}

function Lbl({ children }) {
  return <div style={{fontSize:10, color:G.muted, fontWeight:700, textTransform:'uppercase', letterSpacing:.6, marginBottom:4}}>{children}</div>
}
