// ===========================================================================
// MODUL HR — Personal · Autorizații · Documente · Alerte expirări · Semnături · Coș
// ===========================================================================
import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from './lib/supabase.js'
import { SalariiPage as SalariiOriginal } from './App.jsx'
import TabDocumentePersonale from './TabDocumentePersonale.jsx'
import TabSemnaturi from './TabSemnaturi.jsx'
import TabScannerDocumenteHR from './TabScannerDocumenteHR.jsx'
import TabCos from './TabCos.jsx'
import TicheteWidget from './TicheteWidget.jsx'
import SugestiiChuckTab from './SugestiiChuckTab.jsx'
import { compressFileBeforeUpload } from './utils/compressFile'

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

// Meta pe categorie (emoji + label friendly) — folosit în TabAlerte + TabAutorizatii
const CAT_META = {
  medical:     { emoji: '⚕',  label: 'Medical' },
  iscir:       { emoji: '🏗',  label: 'ISCIR' },
  transport:   { emoji: '🚗',  label: 'Transport' },
  profesional: { emoji: '👷', label: 'Profesional' },
  sudura:      { emoji: '🔥',  label: 'Sudură' },
  anre:        { emoji: '⚡',  label: 'ANRE' },
  mediu:       { emoji: '🌿',  label: 'Mediu/SSM' },
  cursuri:     { emoji: '📚',  label: 'Cursuri' },
  isu:         { emoji: '🚨',  label: 'ISU' },
}

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
  const [tab, setTab] = useState('personal')  // personal | autorizatii | alerte | documente | semnaturi | cos | scanner | salarii
  const [employees, setEmployees] = useState([])
  const [autorizatii, setAutorizatii] = useState([])
  const [tipuri, setTipuri] = useState([])
  const [cosCount, setCosCount] = useState(0)  // Etapa 13: badge dinamic Coș
  const [chuckCount, setChuckCount] = useState(0)  // 24.05.2026: badge sugestii Chuck Norris
  const [arhiva, setArhiva] = useState([])  // 25.05.2026: autorizații angajați cu contract încheiat
  const [load, setLoad] = useState(false)
  const [toast, setToast] = useState(null)
  const [editEmp, setEditEmp] = useState(null)
  const [showAddAut, setShowAddAut] = useState(null)  // employee_id
  const [editAut, setEditAut] = useState(null)  // autorizatie object
  
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
  const canAccessPersonal = profile?.is_owner === true || profile?.can_access_personal_data === true
  const canUseScanner = profile?.is_owner === true || profile?.can_use_document_scanner === true
  
  const loadAll = async () => {
    setLoad(true)
    const [empRes, autRes, tipRes, cosRes, chuckRes, arhRes] = await Promise.all([
      supabase.from('employees').select('*, sites(name)').eq('active', true)
        .or('termination_date.is.null,termination_date.gte.' + new Date().toISOString().split('T')[0])
        .order('name'),
      supabase.from('v_hr_autorizatii_status').select('*').order('data_expirare', { ascending: true, nullsFirst: false }),
      supabase.from('hr_autorizatii_tipuri').select('*').eq('activ', true).order('ordine'),
      // Etapa 13: count itemi în Coș pentru badge tab
      supabase.from('v_recycle_bin_hr').select('row_id', { count: 'exact', head: true }),
      // 24.05.2026: count sugestii Chuck Norris (status propus, doar high+critic în badge)
      supabase.from('claude_bot_sugestii').select('id', { count: 'exact', head: true })
        .in('tinta_tip', ['hr_autorizatii', 'employee']).eq('status', 'propus').in('severity', ['critic', 'high']),
      // 25.05.2026: Arhivă autorizații pentru angajații cu contract încheiat
      supabase.from('v_hr_autorizatii_arhiva').select('*'),
    ])
    setEmployees(empRes.data || [])
    setAutorizatii(autRes.data || [])
    setTipuri(tipRes.data || [])
    setCosCount(cosRes.count || 0)
    setChuckCount(chuckRes.count || 0)
    setArhiva(arhRes.data || [])
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
    { key: 'chuck',       icon: '🥋', label: 'Chuck Norris', badge: chuckCount, chuckColor: true },
    { key: 'documente',   icon: '📁', label: 'Documente personale' },
    { key: 'semnaturi',   icon: '🖋️', label: 'Semnături' },
    { key: 'arhiva',      icon: '📦', label: 'Arhivă', badge: arhiva.length, personalOnly: true },
    { key: 'cos',         icon: '🗑', label: 'Coș', badge: cosCount, personalOnly: true },
    { key: 'scanner',     icon: '📷', label: 'Scanner AI', scannerOnly: true },

  ].filter(t => {
    if (t.superOnly && !isSuperAdmin) return false
    if (t.scannerOnly && !canUseScanner) return false
    if (t.personalOnly && !canAccessPersonal) return false
    return true
  })
  
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
      
      {/* Etapa 14: Widget Tichete HR */}
      {profile && <TicheteWidget departament="hr" profile={profile} accent={G.pink} />}
      
      {/* Tab navigation */}
      <div style={{display:'flex', gap:8, marginBottom:18, padding:8, background:G.surface, borderRadius:14, border:`1px solid ${G.border}`, flexWrap:'wrap'}}>
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            padding:'12px 20px', borderRadius:10, border:'none', cursor:'pointer',
            background: tab === t.key ? G.hr + '33' : 'transparent',
            color: tab === t.key ? G.hr : G.muted,
            fontWeight:700, fontSize:15, display:'flex', alignItems:'center', gap:10,
            transition:'all 0.15s', letterSpacing:0.3
          }}>
            <span style={{fontSize:18}}>{t.icon}</span> {t.label}
            {t.badge > 0 && <span style={{padding:'3px 9px', background: t.key === 'cos' ? G.muted : (t.chuckColor ? G.red : G.red), color:'#fff', borderRadius:12, fontSize:13, fontWeight:800}}>{t.badge}</span>}
          </button>
        ))}
      </div>
      
      {load && <div style={{padding:60, textAlign:'center', color:G.muted}}><div className="sp" style={{margin:'0 auto'}}/></div>}
      
      {!load && tab === 'personal' && <TabPersonal employees={employees} autorizatii={autorizatii} onClickEmp={setEditEmp} showToast={showToast} />}
      {!load && tab === 'autorizatii' && <TabAutorizatii autorizatii={autorizatii} tipuri={tipuri} onAddAut={setShowAddAut} isAdmin={isAdmin} onReload={loadAll} showToast={showToast} onEditAut={setEditAut} />}
      {!load && tab === 'alerte' && <TabAlerte autorizatii={autorizatii} stats={stats} onClickAut={(a) => setEditEmp(employees.find(e => e.id === a.employee_id))} />}
      {!load && tab === 'chuck' && <SugestiiChuckTab profile={profile} employees={employees} autorizatii={autorizatii} showToast={showToast} onReload={loadAll} openEmployee={(empId) => { const e = employees.find(x => x.id === empId); if (e) setEditEmp(e); else showToast('Angajatul nu se găsește (poate inactiv)', 'warning') }} />}
      {!load && tab === 'documente' && <TabDocumentePersonale employees={employees} canAccessPersonal={canAccessPersonal} showToast={showToast} />}
      {!load && tab === 'semnaturi' && <TabSemnaturi profile={profile} showToast={showToast} />}
      {!load && tab === 'arhiva' && canAccessPersonal && <TabArhivaAutorizatii arhiva={arhiva} showToast={showToast} />}
      {!load && tab === 'cos' && canAccessPersonal && <TabCos profile={profile} showToast={showToast} />}
      {!load && tab === 'scanner' && canUseScanner && <TabScannerDocumenteHR profile={profile} employees={employees} showToast={showToast} />}
      {!load && tab === 'salarii' && isSuperAdmin && <TabSalarii showToast={showToast} />}
      
      {editEmp && (
        <ModalProfilAngajat 
          employee={editEmp} 
          autorizatii={autorizatii.filter(a => a.employee_id === editEmp.id)}
          tipuri={tipuri}
          isAdmin={isAdmin}
          onClose={() => setEditEmp(null)}
          onReload={loadAll}
          onEditAut={setEditAut}
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
      
      {editAut && (
        <ModalEditAutorizatie 
          autorizatie={editAut}
          tipuri={tipuri}
          onClose={() => setEditAut(null)}
          onSaved={() => { loadAll(); setEditAut(null) }}
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
function TabAutorizatii({ autorizatii, tipuri, onAddAut, isAdmin, onReload, showToast, onEditAut }) {
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('Toate')
  const [statusFilter, setStatusFilter] = useState('toate')
  const [sortBy, setSortBy] = useState('nume')  // nume | tip | expirare | status
  const [uploadingId, setUploadingId] = useState(null)
  const uploadRefGlobal = useRef(null)
  const uploadTargetRef = useRef(null) // { id, employee_id }

  const handleViewPdf = useCallback(async (path) => {
    if (!path) { showToast('Nicio dovadă atașată', 'warning'); return }
    const { data, error } = await supabase.storage.from('autorizatii').createSignedUrl(path, 120)
    if (error) { showToast('Eroare deschidere: ' + error.message, 'error'); return }
    window.open(data.signedUrl, '_blank')
  }, [showToast])

  const handleUploadPdf = useCallback(async (autId, employeeId, file) => {
    if (!file) return
    const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
    if (!allowed.includes(file.type)) { showToast('Acceptat: PDF, JPG, PNG, WEBP', 'error'); return }
    if (file.size > 10 * 1024 * 1024) { showToast('Fișier prea mare (max 10MB)', 'error'); return }
    setUploadingId(autId)
    try {
      const compressed = await compressFileBeforeUpload(file)
      const ext = compressed.name.split('.').pop()
      const path = `${employeeId}/${Date.now()}_${Math.random().toString(36).slice(2,8)}.${ext}`
      const { error: upErr } = await supabase.storage.from('autorizatii').upload(path, compressed, { upsert: false })
      if (upErr) throw upErr
      const { error: dbErr } = await supabase.from('hr_autorizatii').update({
        fisier_path: path, fisier_nume: file.name,
        fisier_size_bytes: file.size, fisier_mime: file.type
      }).eq('id', autId)
      if (dbErr) throw dbErr
      showToast('✅ Fișier încărcat', 'success')
      onReload()
    } catch (e) {
      showToast('Eroare upload: ' + e.message, 'error')
    } finally {
      setUploadingId(null)
    }
  }, [showToast, onReload])
  
  const filtered = useMemo(() => {
    let result = autorizatii.filter(a => {
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
    // Sortare
    if (sortBy === 'nume') result.sort((a,b) => (a.employee_name || '').localeCompare(b.employee_name || ''))
    else if (sortBy === 'tip') result.sort((a,b) => (a.tip_denumire || '').localeCompare(b.tip_denumire || ''))
    else if (sortBy === 'expirare') result.sort((a,b) => (a.data_expirare || '9999').localeCompare(b.data_expirare || '9999'))
    else if (sortBy === 'status') {
      const order = { expirat: 0, expira_7z: 1, expira_30z: 2, expira_60z: 3, valid: 4, fara_exp: 5, fara_data: 6 }
      result.sort((a,b) => (order[a.status] ?? 99) - (order[b.status] ?? 99))
    }
    return result
  }, [autorizatii, catFilter, statusFilter, search, sortBy])
  
  // Etapa 13: soft delete → mutare în Coș (păstrat 30 zile, apoi cleanup automat prin pg_cron)
  const handleDelete = async (a) => {
    if (!confirm(`Mută autorizația „${a.tip_denumire}" pentru ${a.employee_name} în Coș?\n\nVa rămâne în coș 30 zile, poate fi restaurată oricând până atunci din tab-ul 🗑 Coș.`)) return
    const { data: u } = await supabase.auth.getUser()
    const { error } = await supabase.from('hr_autorizatii')
      .update({ deleted_at: new Date().toISOString(), deleted_by: u?.user?.id })
      .eq('id', a.id)
    if (error) showToast('Eroare: ' + error.message, 'error')
    else { showToast(`🗑 Mutată în Coș: ${a.tip_denumire}`); onReload() }
  }
  
  return (
    <div>
      {/* === CHIP-URI FILTRU pe TIP DOCUMENT === */}
      {(() => {
        const tipCountsAll = autorizatii.reduce((acc, a) => {
          const cat = a.tip_categorie || 'altele'
          acc[cat] = (acc[cat] || 0) + 1
          return acc
        }, {})
        const tipuriArrAll = Object.entries(tipCountsAll).sort((a,b) => b[1] - a[1])
        if (tipuriArrAll.length === 0) return null
        return (
          <div style={{marginBottom:14, padding:14, background:G.bg, borderRadius:10, border:`1px solid ${G.border}`}}>
            <div style={{fontSize:11, color:G.muted, fontWeight:700, marginBottom:12, letterSpacing:.5}}>🏷 FILTREAZĂ PE TIP DOCUMENT</div>
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
                }}>{autorizatii.length}</span>
              </button>
              {tipuriArrAll.map(([cat, count]) => {
                const meta = CAT_META[cat] || { emoji:'📄', label:cat }
                const active = catFilter === cat
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

      <div style={{display:'flex', gap:10, marginBottom:14, flexWrap:'wrap', alignItems:'center'}}>
        <input type="text" value={search} onChange={e => setSearch(e.target.value)} 
          placeholder="🔍 Caută după nume angajat, tip, număr, procedeu..." style={{...S.input, flex:1, minWidth:280}}/>
        <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={{...S.input, width:'auto', minWidth:160}}>
          <option value="nume">🔤 Sortare: Nume A-Z</option>
          <option value="tip">📋 Sortare: Tip A-Z</option>
          <option value="expirare">📅 Sortare: Data expirare</option>
          <option value="status">🚦 Sortare: Status (expirate sus)</option>
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
      
      {/* Input file global pentru upload autorizatii — o singura instanta, nu in bucla map */}
      {isAdmin && (
        <input ref={uploadRefGlobal} type="file" accept=".pdf,image/*" style={{display:'none'}}
          onChange={e => { const f=e.target.files?.[0]; if(f&&uploadTargetRef.current) handleUploadPdf(uploadTargetRef.current.id, uploadTargetRef.current.employee_id, f); e.target.value='' }} />
      )}

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
                      <div style={{display:'flex', gap:4, justifyContent:'flex-end'}}>
                        <button onClick={() => handleViewPdf(a.fisier_path)}
                          style={{padding:'4px 8px', background: a.fisier_path ? G.green+'22' : G.muted+'22', color: a.fisier_path ? G.green : G.muted, border:`1px solid ${a.fisier_path ? G.green+'55' : G.muted+'44'}`, borderRadius:4, fontSize:11, cursor:'pointer'}}
                          title={a.fisier_path ? 'Vizualizează fișier' : 'Nicio dovadă atașată'}>📄</button>
                        <button onClick={() => { uploadTargetRef.current={id:a.id,employee_id:a.employee_id}; uploadRefGlobal.current?.click() }}
                          disabled={uploadingId===a.id}
                          style={{padding:'4px 8px', background:G.orange+'22', color:G.orange, border:`1px solid ${G.orange}55`, borderRadius:4, fontSize:11, cursor:'pointer'}}
                          title={a.fisier_path ? 'Înlocuiește fișier' : 'Adaugă PDF/poză'}>
                          {uploadingId===a.id ? '⏳' : '📎'}</button>
                        <button onClick={() => onEditAut?.(a)} style={{padding:'4px 8px', background:G.blue+'22', color:G.blue, border:`1px solid ${G.blue}55`, borderRadius:4, fontSize:11, cursor:'pointer'}} title="Editează">✏️</button>
                        <button onClick={() => handleDelete(a)} style={{padding:'4px 8px', background:G.red+'22', color:G.red, border:`1px solid ${G.red}55`, borderRadius:4, fontSize:11, cursor:'pointer'}} title="Mută în Coș">🗑️</button>
                      </div>
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
        💡 {filtered.length} / {autorizatii.length} autorizații afișate
      </div>
    </div>
  )
}

// ===========================================================================
// TAB ALERTE — Doar autorizațiile cu probleme (expirate + curand)
// ===========================================================================
function TabAlerte({ autorizatii, stats, onClickAut }) {
  const [tipFilter, setTipFilter] = useState(null)  // null = toate, string = nume categorie

  const expirateAll = autorizatii.filter(a => a.status === 'expirat')
  const expira7All = autorizatii.filter(a => a.status === 'expira_7z')
  const expira30All = autorizatii.filter(a => a.status === 'expira_30z')
  const toateAlerteAll = [...expirateAll, ...expira7All, ...expira30All]

  // Count per categorie (doar din alertele active)
  const tipCounts = toateAlerteAll.reduce((acc, a) => {
    const cat = a.tip_categorie || 'altele'
    acc[cat] = (acc[cat] || 0) + 1
    return acc
  }, {})
  const tipuriArr = Object.entries(tipCounts).sort((a,b) => b[1] - a[1])

  // Aplic filtru pe cele 3 secțiuni
  const expirate = tipFilter ? expirateAll.filter(a => (a.tip_categorie || 'altele') === tipFilter) : expirateAll
  const expira7  = tipFilter ? expira7All.filter(a => (a.tip_categorie || 'altele') === tipFilter)  : expira7All
  const expira30 = tipFilter ? expira30All.filter(a => (a.tip_categorie || 'altele') === tipFilter) : expira30All
  
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

      {/* === FILTRE pe TIP DOCUMENT (chip-uri clickabile) === */}
      {tipuriArr.length > 0 && (
        <div style={{marginBottom:18, padding:14, background:G.bg, borderRadius:10, border:`1px solid ${G.border}`}}>
          <div style={{fontSize:11, color:G.muted, fontWeight:700, marginBottom:12, letterSpacing:.5}}>🏷 FILTREAZĂ PE TIP DOCUMENT</div>
          <div style={{display:'flex', flexWrap:'wrap', gap:10}}>
            <button onClick={() => setTipFilter(null)} style={{
              padding:'10px 20px', fontSize:14, fontWeight:800, borderRadius:24, cursor:'pointer',
              border:`2px solid ${tipFilter === null ? G.purple : G.border2}`,
              background:tipFilter === null ? G.purple + '22' : G.surface,
              color:tipFilter === null ? G.purple : G.text,
              transition:'all 0.15s', display:'inline-flex', alignItems:'center', gap:8
            }}>
              <span>Toate</span>
              <span style={{
                padding:'2px 9px', borderRadius:14, fontSize:13, fontWeight:800,
                background:tipFilter === null ? G.purple : G.bg,
                color:tipFilter === null ? '#fff' : G.muted,
                minWidth:24, textAlign:'center'
              }}>{toateAlerteAll.length}</span>
            </button>
            {tipuriArr.map(([cat, count]) => {
              const meta = CAT_META[cat] || { emoji:'📄', label:cat }
              const active = tipFilter === cat
              return (
                <button key={cat} onClick={() => setTipFilter(active ? null : cat)} style={{
                  padding:'10px 20px', fontSize:14, fontWeight:800, borderRadius:24, cursor:'pointer',
                  border:`2px solid ${active ? G.purple : G.border2}`,
                  background:active ? G.purple + '22' : G.surface,
                  color:active ? G.purple : G.text,
                  transition:'all 0.15s', display:'inline-flex', alignItems:'center', gap:8
                }}>
                  <span style={{fontSize:18}}>{meta.emoji}</span>
                  <span>{meta.label}</span>
                  <span style={{
                    padding:'2px 9px', borderRadius:14, fontSize:13, fontWeight:800,
                    background:active ? G.purple : G.bg,
                    color:active ? '#fff' : G.muted,
                    minWidth:24, textAlign:'center'
                  }}>{count}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
      
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
// TAB DOCUMENTE PERSONALE — mutat în TabDocumentePersonale.jsx (Etapa 6.A)
// ===========================================================================

// ===========================================================================
// TAB SALARII — Oglindire SalariiPage din Pontaj fără Export Banca (super admin only)
// ===========================================================================
function TabSalarii({ showToast }) {
  return (
    <div style={{...S.card, padding:0, overflow:'hidden'}}>
      <SalariiOriginal noExport={true} />
    </div>
  )
}

// ===========================================================================
// MODAL PROFIL ANGAJAT — Date + Tab Autorizații
// ===========================================================================
function ModalProfilAngajat({ employee, autorizatii, tipuri, isAdmin, onClose, onReload, onEditAut, showToast }) {
  const [tabM, setTabM] = useState('date')  // date | autorizatii
  const [showAddAut, setShowAddAut] = useState(false)
  const [editingAreAut, setEditingAreAut] = useState(false)
  const [areAut, setAreAut] = useState(employee.are_autorizatii || false)
  const [uploadingId, setUploadingId] = useState(null)
  const uploadRef = useRef(null)
  const uploadTarget = useRef(null)

  const handleViewPdf = useCallback(async (path) => {
    if (!path) { showToast('Nicio dovadă atașată', 'warning'); return }
    const { data, error } = await supabase.storage.from('autorizatii').createSignedUrl(path, 120)
    if (error) { showToast('Eroare deschidere: ' + error.message, 'error'); return }
    window.open(data.signedUrl, '_blank')
  }, [showToast])

  const handleUploadPdf = useCallback(async (autId, employeeId, file) => {
    if (!file) return
    const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
    if (!allowed.includes(file.type)) { showToast('Acceptat: PDF, JPG, PNG, WEBP', 'error'); return }
    if (file.size > 10 * 1024 * 1024) { showToast('Fișier prea mare (max 10MB)', 'error'); return }
    setUploadingId(autId)
    try {
      const compressed = await compressFileBeforeUpload(file)
      const ext = compressed.name.split('.').pop()
      const path = `${employeeId}/${Date.now()}_${Math.random().toString(36).slice(2,8)}.${ext}`
      const { error: upErr } = await supabase.storage.from('autorizatii').upload(path, compressed, { upsert: false })
      if (upErr) throw upErr
      const { error: dbErr } = await supabase.from('hr_autorizatii').update({
        fisier_path: path, fisier_nume: file.name,
        fisier_size_bytes: file.size, fisier_mime: file.type
      }).eq('id', autId)
      if (dbErr) throw dbErr
      showToast('✅ Fișier încărcat', 'success')
      onReload()
    } catch (e) {
      showToast('Eroare upload: ' + e.message, 'error')
    } finally {
      setUploadingId(null)
    }
  }, [showToast, onReload])

  // Auto-calculate (real count) for display
  const realAutCount = autorizatii.length
  
  // Etapa 13: soft delete (mutare în Coș)
  const handleDelete = async (a) => {
    if (!confirm(`Mută autorizația „${a.tip_denumire}" în Coș?\n\nVa rămâne în coș 30 zile, poate fi restaurată oricând din tab-ul 🗑 Coș.`)) return
    const { data: u } = await supabase.auth.getUser()
    const { error } = await supabase.from('hr_autorizatii')
      .update({ deleted_at: new Date().toISOString(), deleted_by: u?.user?.id })
      .eq('id', a.id)
    if (error) showToast('Eroare: ' + error.message, 'error')
    else { showToast(`🗑 Mutată în Coș: ${a.tip_denumire}`); onReload() }
  }
  
  const saveAreAut = async (val) => {
    const { error } = await supabase.from('employees').update({ are_autorizatii: val }).eq('id', employee.id)
    if (error) { showToast('Eroare: ' + error.message, 'error'); return }
    setAreAut(val)
    setEditingAreAut(false)
    showToast('✓ Actualizat')
    onReload()
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
            { key: 'autorizatii', icon: '📑', label: `Autorizații (${realAutCount})` },
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
              {/* Are autorizatii editabil */}
              <div>
                <div style={{fontSize:10, color:G.muted, fontWeight:700, textTransform:'uppercase', letterSpacing:.6, marginBottom:4}}>
                  Are autorizații {realAutCount > 0 && <span style={{color:G.green, fontWeight:600, textTransform:'none', letterSpacing:0}}>· auto: {realAutCount} înregistrate</span>}
                </div>
                {editingAreAut && isAdmin ? (
                  <div style={{display:'flex', gap:6}}>
                    <button onClick={() => saveAreAut(true)} style={{flex:1, padding:'8px', background:G.green, color:'#fff', border:'none', borderRadius:6, cursor:'pointer', fontSize:13, fontWeight:600}}>✓ DA</button>
                    <button onClick={() => saveAreAut(false)} style={{flex:1, padding:'8px', background:G.red, color:'#fff', border:'none', borderRadius:6, cursor:'pointer', fontSize:13, fontWeight:600}}>✗ NU</button>
                    <button onClick={() => setEditingAreAut(false)} style={{...S.btnS, padding:'8px 10px'}}>×</button>
                  </div>
                ) : (
                  <div onClick={() => isAdmin && setEditingAreAut(true)} style={{
                    fontSize:13, color: areAut ? G.green : G.muted, padding:'8px 10px', background:G.bg, 
                    border:`1px solid ${areAut ? G.green+'55' : G.border}`, borderRadius:6, minHeight:32,
                    cursor: isAdmin ? 'pointer' : 'default', fontWeight:600,
                    display:'flex', justifyContent:'space-between', alignItems:'center'
                  }}>
                    <span>{areAut ? '✓ Da' : '✗ Nu'}</span>
                    {isAdmin && <span style={{fontSize:10, color:G.muted, fontWeight:400}}>✏️ click pentru editare</span>}
                  </div>
                )}
              </div>
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
                            <div style={{display:'flex', gap:4}}>
                              <input ref={uploadRef} type="file" accept=".pdf,image/*" style={{display:'none'}}
                                onChange={e => { const f=e.target.files?.[0]; if(f&&uploadTarget.current) handleUploadPdf(uploadTarget.current.id, uploadTarget.current.employee_id, f); e.target.value='' }} />
                              <button onClick={() => handleViewPdf(a.fisier_path)}
                                style={{padding:'4px 8px', background: a.fisier_path ? G.green+'22' : G.muted+'22', color: a.fisier_path ? G.green : G.muted, border:`1px solid ${a.fisier_path ? G.green+'55' : G.muted+'44'}`, borderRadius:4, fontSize:11, cursor:'pointer'}}
                                title={a.fisier_path ? 'Vizualizează fișier' : 'Nicio dovadă atașată'}>📄</button>
                              <button onClick={() => { uploadTarget.current={id:a.id,employee_id:a.employee_id}; uploadRef.current?.click() }}
                                disabled={uploadingId===a.id}
                                style={{padding:'4px 8px', background:G.orange+'22', color:G.orange, border:`1px solid ${G.orange}55`, borderRadius:4, fontSize:11, cursor:'pointer'}}
                                title={a.fisier_path ? 'Înlocuiește fișier' : 'Adaugă PDF/poză'}>
                                {uploadingId===a.id ? '⏳' : '📎'}</button>
                              <button onClick={() => onEditAut?.(a)} style={{padding:'4px 8px', background:G.blue+'22', color:G.blue, border:`1px solid ${G.blue}55`, borderRadius:4, fontSize:11, cursor:'pointer'}} title="Editează">✏️</button>
                              <button onClick={() => handleDelete(a)} style={{padding:'4px 8px', background:G.red+'22', color:G.red, border:`1px solid ${G.red}55`, borderRadius:4, fontSize:11, cursor:'pointer'}} title="Mută în Coș">🗑️</button>
                            </div>
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

// ===========================================================================
// MODAL EDIT AUTORIZAȚIE — pre-fill cu datele existente
// ===========================================================================
function ModalEditAutorizatie({ autorizatie, tipuri, onClose, onSaved, showToast }) {
  const [tipId, setTipId] = useState(autorizatie.tip_id || '')
  const [numar, setNumar] = useState(autorizatie.numar_autorizatie || '')
  const [emitent, setEmitent] = useState(autorizatie.emitent || '')
  const [dataEmitere, setDataEmitere] = useState(autorizatie.data_emitere || '')
  const [dataExpirare, setDataExpirare] = useState(autorizatie.data_expirare || '')
  const [faraExpirare, setFaraExpirare] = useState(autorizatie.fara_expirare || false)
  const [procedeu, setProcedeu] = useState(autorizatie.procedeu_sudura || '')
  const [diametru, setDiametru] = useState(autorizatie.diametru_teava_mm || '')
  const [calitateMat, setCalitateMat] = useState(autorizatie.calitate_material || '')
  const [domenii, setDomenii] = useState(autorizatie.domenii || [])
  const [observatii, setObservatii] = useState(autorizatie.observatii || '')
  const [saving, setSaving] = useState(false)
  
  const tipSelectat = tipuri.find(t => t.id === Number(tipId))
  
  const save = async () => {
    if (!tipId) { showToast('Alege tipul autorizației', 'warn'); return }
    setSaving(true)
    
    const payload = {
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
      modificat_la: new Date().toISOString(),
    }
    
    const { error } = await supabase.from('hr_autorizatii').update(payload).eq('id', autorizatie.id)
    setSaving(false)
    if (error) { showToast('Eroare: ' + error.message, 'error'); return }
    showToast('✓ Autorizație actualizată')
    onSaved()
  }
  
  return (
    <div style={{position:'fixed', inset:0, background:'rgba(0,0,0,0.92)', zIndex:1100, display:'flex', alignItems:'center', justifyContent:'center', padding:20}}>
      <div style={{...S.card, width:'100%', maxWidth:560, maxHeight:'92vh', overflow:'auto', padding:24}}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:18, paddingBottom:12, borderBottom:`1px solid ${G.border}`}}>
          <div>
            <div style={{fontSize:17, fontWeight:700, color:G.text}}>✏️ Editează Autorizație</div>
            <div style={{fontSize:11, color:G.muted, marginTop:2}}>{autorizatie.employee_name}</div>
          </div>
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
            <div style={{fontSize:11, color:G.blue, fontWeight:700, marginBottom:8}}>🏷 Domenii (selectează multiple)</div>
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
            <input type="date" value={dataEmitere || ''} onChange={e => setDataEmitere(e.target.value)} style={S.input}/>
          </div>
          <div>
            <Lbl>Data expirare</Lbl>
            <input type="date" value={dataExpirare || ''} onChange={e => setDataExpirare(e.target.value)} disabled={faraExpirare} style={{...S.input, opacity: faraExpirare ? 0.5 : 1}}/>
          </div>
        </div>
        
        <label style={{display:'flex', alignItems:'center', gap:8, marginBottom:14, cursor:'pointer', fontSize:13, color:G.text}}>
          <input type="checkbox" checked={faraExpirare} onChange={e => setFaraExpirare(e.target.checked)} style={{accentColor:G.green}}/>
          ∞ Fără expirare (curs permanent — "NU E CAZUL")
        </label>
        
        <Lbl>Observații</Lbl>
        <textarea value={observatii} onChange={e => setObservatii(e.target.value)} style={{...S.input, minHeight:60, resize:'vertical', marginBottom:14, fontFamily:'inherit'}}/>
        
        <div style={{display:'flex', gap:10, justifyContent:'flex-end', paddingTop:12, borderTop:`1px solid ${G.border}`}}>
          <button onClick={onClose} style={S.btnS}>Anulează</button>
          <button onClick={save} disabled={saving || !tipId} style={{...S.btnP, opacity: (saving || !tipId) ? 0.5 : 1}}>{saving ? '...' : '✓ Salvează modificările'}</button>
        </div>
      </div>
    </div>
  )
}

// ===========================================================================
// 25.05.2026: TAB ARHIVĂ AUTORIZAȚII — pentru angajații cu contract încheiat
// Read-only. Folosit pentru istoric ANAF / control ITM.
// ===========================================================================
function TabArhivaAutorizatii({ arhiva, showToast }) {
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('terminare_desc') // terminare_desc | nume_asc | tip
  const [previewPdf, setPreviewPdf] = useState(null)
  
  const handleViewPdf = useCallback(async (path) => {
    if (!path) { showToast('Fără fișier atașat', 'warning'); return }
    const { data, error } = await supabase.storage.from('autorizatii').createSignedUrl(path, 60)
    if (error) { showToast('Eroare deschidere PDF: ' + error.message, 'error'); return }
    setPreviewPdf(data.signedUrl)
  }, [showToast])
  
  // Group by angajat
  const grupate = useMemo(() => {
    let filtered = arhiva
    if (search) {
      const s = search.toLowerCase()
      filtered = arhiva.filter(a => 
        (a.employee_name || '').toLowerCase().includes(s) ||
        (a.tip_denumire || '').toLowerCase().includes(s) ||
        (a.tip_cod || '').toLowerCase().includes(s)
      )
    }
    
    const map = new Map()
    filtered.forEach(a => {
      if (!map.has(a.employee_id)) {
        map.set(a.employee_id, {
          employee_id: a.employee_id,
          employee_name: a.employee_name,
          functie: a.functie,
          departament_hr: a.departament_hr,
          termination_date: a.termination_date,
          zile_de_la_terminare: a.zile_de_la_terminare,
          autorizatii: []
        })
      }
      map.get(a.employee_id).autorizatii.push(a)
    })
    
    let arr = Array.from(map.values())
    
    if (sortBy === 'terminare_desc') {
      arr.sort((a, b) => new Date(b.termination_date) - new Date(a.termination_date))
    } else if (sortBy === 'nume_asc') {
      arr.sort((a, b) => (a.employee_name || '').localeCompare(b.employee_name || ''))
    } else if (sortBy === 'tip') {
      arr.sort((a, b) => b.autorizatii.length - a.autorizatii.length)
    }
    
    return arr
  }, [arhiva, search, sortBy])
  
  const totalAngajati = grupate.length
  const totalAutorizatii = grupate.reduce((s, g) => s + g.autorizatii.length, 0)
  
  return (
    <div>
      {/* Header info */}
      <div style={{
        background: G.surface, border:`1px solid ${G.border}`, borderRadius:12,
        padding:'14px 18px', marginBottom:16,
        display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:12
      }}>
        <div style={{display:'flex', alignItems:'center', gap:14}}>
          <div style={{fontSize:28}}>📦</div>
          <div>
            <div style={{fontSize:15, fontWeight:800, color:G.text}}>
              Arhivă Autorizații
            </div>
            <div style={{fontSize:11, color:G.muted, marginTop:2, lineHeight:1.5}}>
              Autorizațiile angajaților cu contract încheiat — păstrate pentru istoric ANAF / control ITM. 
              <strong style={{color:G.text}}> {totalAutorizatii} autorizații</strong> pentru 
              <strong style={{color:G.text}}> {totalAngajati} foști angajați</strong>.
            </div>
          </div>
        </div>
      </div>
      
      {/* Toolbar filtre */}
      <div style={{display:'flex', gap:10, marginBottom:14, flexWrap:'wrap', alignItems:'center'}}>
        <input
          type="text"
          placeholder="🔍 Caută după nume, tip autorizație, cod..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{...S.input, flex:1, minWidth:260, padding:'10px 14px'}}
        />
        <select value={sortBy} onChange={e => setSortBy(e.target.value)}
          style={{...S.input, padding:'10px 14px', minWidth:200}}>
          <option value="terminare_desc">📅 Sort: Terminare recent</option>
          <option value="nume_asc">🔤 Sort: Nume A-Z</option>
          <option value="tip">📋 Sort: Câte autorizații</option>
        </select>
      </div>
      
      {grupate.length === 0 ? (
        <div style={{
          padding:50, textAlign:'center', background:G.surface,
          border:`1px solid ${G.border}`, borderRadius:12
        }}>
          <div style={{fontSize:50, marginBottom:14, opacity:0.5}}>📦</div>
          <div style={{fontSize:14, color:G.muted}}>
            {search ? 'Nimic găsit pentru "' + search + '"' : 'Nu există autorizații în arhivă'}
          </div>
        </div>
      ) : (
        <div style={{display:'flex', flexDirection:'column', gap:14}}>
          {grupate.map(g => (
            <div key={g.employee_id} style={{
              background:G.surface, border:`1px solid ${G.border}`,
              borderRadius:12, overflow:'hidden', opacity:0.92
            }}>
              {/* Header angajat */}
              <div style={{
                background:G.bg, padding:'12px 18px',
                borderBottom:`1px solid ${G.border}`,
                display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:8
              }}>
                <div>
                  <div style={{fontSize:14, fontWeight:700, color:G.text, marginBottom:2}}>
                    👤 {g.employee_name}
                  </div>
                  <div style={{fontSize:11, color:G.muted}}>
                    {g.functie || '—'}{g.departament_hr ? ' · ' + g.departament_hr : ''}
                  </div>
                </div>
                <div style={{
                  background: G.red+'22', border:`1px solid ${G.red}55`,
                  padding:'5px 11px', borderRadius:8,
                  fontSize:11, color:G.red, fontWeight:700
                }}>
                  🔒 Contract încheiat {new Date(g.termination_date).toLocaleDateString('ro-RO')}
                  <span style={{color:G.muted, marginLeft:6, fontWeight:400}}>
                    (acum {g.zile_de_la_terminare} {g.zile_de_la_terminare === 1 ? 'zi' : 'zile'})
                  </span>
                </div>
              </div>
              
              {/* Lista autorizații */}
              <div style={{padding:'4px 8px'}}>
                <table style={{width:'100%', borderCollapse:'collapse', fontSize:12}}>
                  <tbody>
                    {g.autorizatii.map(a => {
                      const statusColor = a.status_la_terminare === 'expirat_la_terminare' ? G.red 
                        : a.status_la_terminare === 'fara_exp' ? G.muted 
                        : G.green
                      const statusLabel = a.status_la_terminare === 'expirat_la_terminare' ? 'Expirat la terminare'
                        : a.status_la_terminare === 'fara_exp' ? 'Fără expirare'
                        : a.status_la_terminare === 'fara_data' ? 'Fără dată'
                        : 'Valid la terminare'
                      return (
                        <tr key={a.id} style={{borderTop:`1px solid ${G.border}33`}}>
                          <td style={{padding:'10px 12px', width:'30%'}}>
                            <div style={{fontWeight:600, color:G.text, marginBottom:2}}>
                              {a.tip_denumire}
                            </div>
                            <div style={{fontSize:10, color:G.muted, textTransform:'uppercase'}}>
                              {a.tip_categorie} · {a.tip_cod}
                            </div>
                          </td>
                          <td style={{padding:'10px 12px', width:'18%', color:G.muted, fontSize:11}}>
                            {a.numar_autorizatie && <div>Nr: <strong style={{color:G.text}}>{a.numar_autorizatie}</strong></div>}
                            {a.emitent && <div style={{fontSize:10}}>{a.emitent}</div>}
                          </td>
                          <td style={{padding:'10px 12px', width:'18%', fontSize:11}}>
                            {a.data_emitere && <div>Emis: {new Date(a.data_emitere).toLocaleDateString('ro-RO')}</div>}
                            {a.data_expirare && <div style={{color:G.muted}}>Exp: {new Date(a.data_expirare).toLocaleDateString('ro-RO')}</div>}
                          </td>
                          <td style={{padding:'10px 12px', width:'18%'}}>
                            <span style={{
                              padding:'3px 9px', background:statusColor+'22', color:statusColor,
                              borderRadius:6, fontSize:10, fontWeight:700, textTransform:'uppercase'
                            }}>{statusLabel}</span>
                          </td>
                          <td style={{padding:'10px 12px', textAlign:'right', width:'16%'}}>
                            {a.fisier_path && (
                              <button
                                onClick={() => handleViewPdf(a.fisier_path)}
                                style={{
                                  background:G.blue+'22', color:G.blue, border:`1px solid ${G.blue}55`,
                                  borderRadius:6, padding:'5px 12px', fontSize:11, fontWeight:600, cursor:'pointer'
                                }}>
                                📄 Vezi PDF
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
          ))}
        </div>
      )}
      
      {/* Modal preview PDF */}
      {previewPdf && (
        <div style={{
          position:'fixed', inset:0, background:'rgba(0,0,0,0.85)', zIndex:1000,
          display:'flex', alignItems:'center', justifyContent:'center', padding:20
        }} onClick={() => setPreviewPdf(null)}>
          <div style={{
            background:G.surface, borderRadius:12, padding:14, width:'95vw', height:'90vh',
            display:'flex', flexDirection:'column'
          }} onClick={e => e.stopPropagation()}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10}}>
              <div style={{fontSize:14, fontWeight:700, color:G.text}}>📄 Vizualizare autorizație</div>
              <button onClick={() => setPreviewPdf(null)} style={{background:'transparent', border:'none', color:G.muted, fontSize:22, cursor:'pointer'}}>×</button>
            </div>
            <iframe src={previewPdf} style={{flex:1, border:`1px solid ${G.border}`, borderRadius:8}} title="Autorizație"/>
          </div>
        </div>
      )}
    </div>
  )
}
