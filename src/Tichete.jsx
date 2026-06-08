/* Tichete.jsx - Modul Tichete Central Gazpet ERP (Etapa 11)
   Dashboard cu departamente + listă tichete + flow deschidere + detalii + comentarii */

import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react'
import { supabase } from './lib/supabase.js'

const G = { bg:'#0D1117',surface:'#161B22',border:'#21262D',border2:'#30363D',text:'#E6EDF3',muted:'#8B949E',dim:'#6E7681',blue:'#58A6FF',green:'#3FB950',red:'#F85149',yellow:'#D29922',purple:'#BC8CFF',orange:'#F0883E',pink:'#F778BA',greenDim:'#1A3A1A',redDim:'#3A1A1A',yellowDim:'#3A2A0A',purpleDim:'#2A1F3A',blueDim:'#1A2A3A' }

const DEPARTAMENTE = [
  { cod:'logistica',     nume:'Logistica',     emoji:'🚜', color:G.orange, descriere:'Utilaje, auto, scule, alimentari' },
  { cod:'hr',            nume:'HR',            emoji:'👥', color:G.pink,   descriere:'Contracte, salarii, documente personale, concedii' },
  { cod:'administrativ', nume:'Administrativ', emoji:'🏢', color:G.blue,   descriere:'Cladire, mobilier, curatenie, acces' },
  { cod:'it',            nume:'IT',            emoji:'💻', color:G.purple, descriere:'Cont, ERP, telefon, imprimanta, echipament' },
  { cod:'comercial',     nume:'Comercial',     emoji:'🛒', color:G.green,  descriere:'Lipsa material, comenzi, livrari' },
  { cod:'financiar',     nume:'Financiar',     emoji:'💰', color:G.yellow, descriere:'Plati, facturi, deconturi' }
]

const URGENTE = [
  { cod:'urgent',  emoji:'🚨', label:'Urgent',  color:G.red,    sla:'< 4 ore'  },
  { cod:'normal',  emoji:'📝', label:'Normal',  color:G.yellow, sla:'< 24 ore' },
  { cod:'scazut',  emoji:'📌', label:'Scazut',  color:G.blue,   sla:'< 7 zile' }
]

const STATUS_INFO = {
  deschis:           { label:'Deschis',              emoji:'🆕', color:G.red    },
  in_analiza:        { label:'In analiză',           emoji:'🔍', color:G.blue   },
  programat_service: { label:'Programat la service', emoji:'📅', color:G.purple },
  in_service:        { label:'In service',           emoji:'🔧', color:G.yellow },
  reparat:           { label:'Reparat - confirmă',   emoji:'✅', color:G.green  },
  atribuit:          { label:'Atribuit',             emoji:'➡️', color:G.orange },
  in_lucru:          { label:'In lucru',             emoji:'🔧', color:G.yellow },
  rezolvat:          { label:'Rezolvat',             emoji:'✅', color:G.green  },
  confirmat:         { label:'Confirmat',            emoji:'🎉', color:G.purple },
  inchis:            { label:'Inchis',               emoji:'🔒', color:G.muted  },
  respins:           { label:'Respins',              emoji:'❌', color:G.red    }
}

// ─────────────────────── Helpers ────────────────────────────
const fmtDate = (d)=>{ if(!d) return '-'; const dt=new Date(d); return dt.toLocaleDateString('ro-RO',{day:'2-digit',month:'2-digit',year:'numeric'}) }
const fmtDateTime = (d)=>{ if(!d) return '-'; const dt=new Date(d); return dt.toLocaleString('ro-RO',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}) }
const fmtRelative = (d)=>{
  if(!d) return ''
  const diff = (Date.now() - new Date(d).getTime()) / 1000
  if(diff < 60) return 'acum'
  if(diff < 3600) return `acum ${Math.floor(diff/60)}m`
  if(diff < 86400) return `acum ${Math.floor(diff/3600)}h`
  if(diff < 604800) return `acum ${Math.floor(diff/86400)}z`
  return fmtDate(d)
}
const getDep = (cod) => DEPARTAMENTE.find(d=>d.cod===cod) || DEPARTAMENTE[0]
const getUrg = (cod) => URGENTE.find(u=>u.cod===cod) || URGENTE[1]
const getSt = (cod) => STATUS_INFO[cod] || STATUS_INFO.deschis

// ─────────────────────── Toast ────────────────────────────
function useToast(){
  const [toasts,setToasts]=useState([])
  const show=useCallback((msg,type='info')=>{
    const id=Math.random().toString(36).slice(2)
    setToasts(t=>[...t,{id,msg,type}])
    setTimeout(()=>setToasts(t=>t.filter(x=>x.id!==id)),4000)
  },[])
  const ToastContainer=()=>(
    <div style={{position:'fixed',top:20,right:20,zIndex:9999,display:'flex',flexDirection:'column',gap:8}}>
      {toasts.map(t=>(
        <div key={t.id} style={{padding:'12px 18px',borderRadius:8,background:t.type==='error'?G.redDim:t.type==='success'?G.greenDim:G.surface,border:`1px solid ${t.type==='error'?G.red:t.type==='success'?G.green:G.border2}`,color:G.text,fontSize:14,maxWidth:380,boxShadow:'0 4px 20px rgba(0,0,0,0.5)'}}>
          {t.msg}
        </div>
      ))}
    </div>
  )
  return {show,ToastContainer}
}

// ─────────────────────── Avatar ────────────────────────────
const colorFromId=(id)=>{
  if(!id) return G.muted
  let h=0; for(let i=0;i<id.length;i++) h=((h<<5)-h)+id.charCodeAt(i)
  const c=['#58A6FF','#3FB950','#D29922','#BC8CFF','#F0883E','#F778BA','#79C0FF','#56D364']
  return c[Math.abs(h)%c.length]
}
function Avatar({name,userId,size=32}){
  const init=name?name.split(' ').map(s=>s[0]||'').slice(0,2).join('').toUpperCase():'?'
  return (
    <div style={{width:size,height:size,borderRadius:'50%',background:colorFromId(userId),display:'inline-flex',alignItems:'center',justifyContent:'center',color:'#fff',fontWeight:700,fontSize:size*0.42,flexShrink:0}}>
      {init}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ════════════════════════════════════════════════════════════════
export default function Tichete({ profile: propProfile, filterDepartament = null, noLayout = false }){
  const {show,ToastContainer}=useToast()
  const [profile, setProfile] = useState(propProfile || null)
  
  // Fetch profile daca nu vine ca prop
  useEffect(()=>{
    if(propProfile) { setProfile(propProfile); return }
    (async()=>{
      const { data:{ user } } = await supabase.auth.getUser()
      if(user) {
        const { data } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()
        if(data) setProfile(data)
      }
    })()
  }, [propProfile])
  const [loading,setLoading]=useState(true)
  const [view,setView]=useState(filterDepartament ? 'list' : 'dashboard')  // 'dashboard' | 'list'
  const [activeDep,setActiveDep]=useState(filterDepartament)
  const [tichete,setTichete]=useState([])
  const [summary,setSummary]=useState({})
  const [subcategorii,setSubcategorii]=useState([])
  const [profiles,setProfiles]=useState([])
  const [filtruStatus,setFiltruStatus]=useState('active')   // 'active' | 'toate' | status specific
  const [filtruUrgenta,setFiltruUrgenta]=useState(null)
  const [searchText,setSearchText]=useState('')
  const [openNew,setOpenNew]=useState(false)
  const [openDetail,setOpenDetail]=useState(null)
  const [activeLogistica,setActiveLogistica]=useState([])  // pentru autocomplete entitate dep=logistica
  const [employeesList,setEmployeesList]=useState([])      // pentru autocomplete entitate dep=hr
  const [serviceParteneri,setServiceParteneri]=useState([]) // pentru workflow logistica → service

  const loadAll = useCallback(async()=>{
    setLoading(true)
    try {
      const [tk, sm, sc, pf, ac, em, sp] = await Promise.all([
        supabase.from('tichete').select('*').order('created_at',{ascending:false}).limit(500),
        supabase.from('v_tichete_summary').select('*'),
        supabase.from('tichete_subcategorii').select('*').eq('active',true).order('ordine'),
        supabase.from('profiles').select('id, name, role'),
        supabase.from('logistica_active').select('id, cod_intern, nr_inmatriculare, marca, model, serie_sasiu').eq('vandut',false).eq('deep_sleep',false).order('marca'),
        supabase.from('employees').select('id, name, functie').eq('active',true).order('name'),
        supabase.from('logistica_service_parteneri').select('id, nume, telefon, email, adresa, specializare').eq('activ',true).order('nume')
      ])
      setTichete(tk.data || [])
      const sMap = {}; (sm.data || []).forEach(s=>{ sMap[s.departament] = s })
      setSummary(sMap)
      setSubcategorii(sc.data || [])
      setProfiles(pf.data || [])
      setActiveLogistica(ac.data || [])
      setEmployeesList(em.data || [])
      setServiceParteneri(sp.data || [])
    } catch(e){
      show('Eroare incarcare tichete: ' + e.message, 'error')
    } finally {
      setLoading(false)
    }
  }, [show])

  useEffect(()=>{ loadAll() },[loadAll])

  // Auto-open modal creare când URL conține ?action=new
  useEffect(()=>{
    const params = new URLSearchParams(window.location.search)
    if(params.get('action') === 'new') {
      setOpenNew(true)
      // curăț URL ca să nu redeschidă la refresh
      params.delete('action')
      const newUrl = window.location.pathname + (params.toString() ? '?' + params.toString() : '')
      window.history.replaceState({}, '', newUrl)
    }
  }, [])

  // Ștergere tichet — DOAR pentru is_owner. Cleanup: comentarii/istoric prin CASCADE,
  // notificări prin trigger BEFORE DELETE, poze/documente storage manual aici.
  const handleDelete = async (t) => {
    if(!profile?.is_owner) {
      show('Doar owner-ul poate șterge tichete', 'error')
      return
    }
    const confirmText = `Sigur ștergi tichetul ${t.numar_tichet}?\n\n"${t.titlu}"\n\nAceastă acțiune este IREVERSIBILĂ:\n• Comentariile și istoricul se șterg\n• Notificările asociate se șterg\n• Pozele/documentele din storage se șterg`
    if(!window.confirm(confirmText)) return
    
    try {
      // 1. Șterg pozele din storage (dacă există)
      // FIX 27.05.2026: bucket tichete -> tichete-atasamente
      const allPaths = [...(t.poze_paths || []), ...(t.documente_paths || [])]
      if(allPaths.length > 0) {
        const { error: storageErr } = await supabase.storage.from('tichete-atasamente').remove(allPaths)
        if(storageErr) console.warn('Storage cleanup partial:', storageErr.message)
      }
      
      // 2. DELETE row (CASCADE: comentarii + istoric, trigger: notificări)
      const { error } = await supabase.from('tichete').delete().eq('id', t.id)
      if(error) throw error
      
      show(`Tichet ${t.numar_tichet} șters`, 'success')
      // Închid detail dacă e deschis exact acest tichet
      if(openDetail?.id === t.id) setOpenDetail(null)
      await loadAll()
    } catch(e) {
      show('Eroare ștergere: ' + e.message, 'error')
    }
  }

  // Tichete filtrate
  const tichetFilt = useMemo(()=>{
    let t = tichete
    if(activeDep) t = t.filter(x=>x.departament===activeDep)
    if(filtruStatus === 'active') t = t.filter(x=>!['inchis','confirmat','respins'].includes(x.status))
    else if(filtruStatus !== 'toate') t = t.filter(x=>x.status===filtruStatus)
    if(filtruUrgenta) t = t.filter(x=>x.urgenta===filtruUrgenta)
    if(searchText){
      const s = searchText.toLowerCase()
      t = t.filter(x =>
        (x.numar_tichet||'').toLowerCase().includes(s) ||
        (x.titlu||'').toLowerCase().includes(s) ||
        (x.descriere||'').toLowerCase().includes(s) ||
        (x.entitate_descriere||'').toLowerCase().includes(s)
      )
    }
    return t
  },[tichete, activeDep, filtruStatus, filtruUrgenta, searchText])

  const totalUrgenteActive = useMemo(()=>tichete.filter(t=>t.urgenta==='urgent' && !['inchis','confirmat','respins'].includes(t.status)).length,[tichete])

  // ───────────── DASHBOARD VIEW ─────────────
  const Dashboard = ()=>(
    <div>
      {/* Header */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:24,flexWrap:'wrap',gap:12}}>
        <div>
          <h1 style={{margin:0,fontSize:28,color:G.text,fontWeight:800,display:'flex',alignItems:'center',gap:12}}>
            🎫 Tichete
          </h1>
          <div style={{fontSize:14,color:G.muted,marginTop:6}}>Avarii · Defectiuni · Reclamatii · Rezolvari</div>
        </div>
        <button onClick={()=>setOpenNew(true)} style={{padding:'14px 24px',background:G.blue,color:'#fff',border:0,borderRadius:10,fontWeight:800,fontSize:15,cursor:'pointer',display:'flex',alignItems:'center',gap:8,boxShadow:'0 2px 12px rgba(88,166,255,0.3)'}}>
          ➕ Tichet nou
        </button>
      </div>

      {/* Alert urgente active */}
      {totalUrgenteActive > 0 && (
        <div style={{padding:'14px 18px',background:G.redDim,border:`1px solid ${G.red}66`,borderRadius:10,marginBottom:20,display:'flex',alignItems:'center',gap:12}}>
          <span style={{fontSize:24}}>🚨</span>
          <div style={{flex:1}}>
            <div style={{fontSize:15,fontWeight:700,color:G.red}}>{totalUrgenteActive} {totalUrgenteActive===1?'tichet urgent activ':'tichete urgente active'}</div>
            <div style={{fontSize:12,color:G.muted,marginTop:2}}>Necesita atentie imediata - SLA &lt; 4 ore</div>
          </div>
          <button onClick={()=>{ setFiltruUrgenta('urgent'); setFiltruStatus('active'); setActiveDep(null); setView('list') }} style={{padding:'8px 16px',background:G.red,color:'#fff',border:0,borderRadius:6,fontWeight:700,fontSize:13,cursor:'pointer'}}>
            Vezi urgente →
          </button>
        </div>
      )}

      {/* Carduri departamente */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:16}}>
        {DEPARTAMENTE.map(d=>{
          const s = summary[d.cod] || { active:0, urgente_active:0, total:0 }
          const active = Number(s.active||0)
          const urgente = Number(s.urgente_active||0)
          return (
            <div key={d.cod} onClick={()=>{ setActiveDep(d.cod); setView('list'); setFiltruStatus('active') }}
                 style={{padding:20,background:G.surface,border:`1px solid ${active>0 ? d.color+'66' : G.border}`,borderRadius:12,cursor:'pointer',transition:'all 0.2s',position:'relative'}}
                 onMouseEnter={e=>{ e.currentTarget.style.transform='translateY(-2px)'; e.currentTarget.style.borderColor=d.color }}
                 onMouseLeave={e=>{ e.currentTarget.style.transform='translateY(0)'; e.currentTarget.style.borderColor= active>0 ? d.color+'66' : G.border }}>
              <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:10}}>
                <div style={{width:48,height:48,borderRadius:10,background:d.color+'22',display:'flex',alignItems:'center',justifyContent:'center',fontSize:28}}>
                  {d.emoji}
                </div>
                <div style={{flex:1}}>
                  <div style={{fontSize:17,fontWeight:800,color:G.text}}>{d.nume}</div>
                  <div style={{fontSize:11,color:G.muted,marginTop:2}}>{d.descriere}</div>
                </div>
              </div>
              <div style={{display:'flex',gap:14,marginTop:14,paddingTop:14,borderTop:`1px solid ${G.border}`}}>
                <div style={{flex:1}}>
                  <div style={{fontSize:24,fontWeight:800,color: active>0 ? d.color : G.dim}}>{active}</div>
                  <div style={{fontSize:11,color:G.muted}}>active</div>
                </div>
                {urgente > 0 && (
                  <div style={{flex:1}}>
                    <div style={{fontSize:24,fontWeight:800,color:G.red,display:'flex',alignItems:'center',gap:6}}>
                      🚨 {urgente}
                    </div>
                    <div style={{fontSize:11,color:G.muted}}>urgente</div>
                  </div>
                )}
                <div style={{flex:1,textAlign:'right'}}>
                  <div style={{fontSize:16,color:G.dim}}>{Number(s.total||0)}</div>
                  <div style={{fontSize:11,color:G.muted}}>total</div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Ultimele tichete (10) */}
      {tichete.length > 0 && (
        <div style={{marginTop:32}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14}}>
            <h3 style={{margin:0,fontSize:16,color:G.text,fontWeight:700}}>📋 Ultimele tichete deschise</h3>
            <button onClick={()=>{ setActiveDep(null); setView('list'); setFiltruStatus('toate') }} style={{padding:'6px 12px',background:'transparent',color:G.blue,border:`1px solid ${G.blue}66`,borderRadius:6,fontSize:12,cursor:'pointer'}}>
              Vezi toate →
            </button>
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            {tichete.slice(0,10).map(t=>(
              <TichetRow key={t.id} t={t} profiles={profiles} onClick={()=>setOpenDetail(t)}
                         canDelete={profile?.is_owner} onDelete={handleDelete} />
            ))}
          </div>
        </div>
      )}
    </div>
  )

  // ───────────── LIST VIEW ─────────────
  const ListView = ()=>{
    const dep = activeDep ? getDep(activeDep) : null
    return (
      <div>
        {/* Header cu back */}
        <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:18,flexWrap:'wrap'}}>
          {!filterDepartament && (
            <button onClick={()=>{ setView('dashboard'); setActiveDep(null) }} style={{padding:'8px 14px',background:'transparent',color:G.muted,border:`1px solid ${G.border2}`,borderRadius:8,fontSize:13,cursor:'pointer'}}>
              ← Dashboard
            </button>
          )}
          <h2 style={{margin:0,fontSize:22,color:G.text,fontWeight:700,display:'flex',alignItems:'center',gap:10}}>
            {dep ? <><span>{dep.emoji}</span> {dep.nume}</> : <><span>🎫</span> Toate tichetele</>}
            <span style={{fontSize:13,color:G.muted,fontWeight:400}}>({tichetFilt.length})</span>
          </h2>
          <div style={{flex:1}} />
          <button onClick={()=>setOpenNew(true)} style={{padding:'10px 18px',background:G.blue,color:'#fff',border:0,borderRadius:8,fontWeight:700,fontSize:14,cursor:'pointer',display:'flex',alignItems:'center',gap:6}}>
            ➕ Nou
          </button>
        </div>

        {/* Filtre */}
        <div style={{display:'flex',gap:8,marginBottom:14,flexWrap:'wrap',alignItems:'center'}}>
          <input type="text" placeholder="🔍 Cauta (numar, titlu, descriere)..." value={searchText} onChange={e=>setSearchText(e.target.value)}
                 style={{flex:'1 1 240px',padding:'10px 14px',background:G.surface,border:`1px solid ${G.border2}`,borderRadius:8,color:G.text,fontSize:13,outline:'none'}} />
          <select value={filtruStatus} onChange={e=>setFiltruStatus(e.target.value)} style={{padding:'10px 12px',background:G.surface,border:`1px solid ${G.border2}`,borderRadius:8,color:G.text,fontSize:13}}>
            <option value="active">⚡ Active (deschise, în lucru)</option>
            <option value="toate">📋 Toate</option>
            <option value="deschis">🆕 Deschis</option>
            <optgroup label="Workflow Logistica">
              <option value="in_analiza">🔍 În analiză</option>
              <option value="programat_service">📅 Programat service</option>
              <option value="in_service">🔧 În service</option>
              <option value="reparat">✅ Reparat (așteaptă confirmare)</option>
            </optgroup>
            <optgroup label="Workflow generic">
              <option value="atribuit">➡️ Atribuit</option>
              <option value="in_lucru">🔧 În lucru</option>
              <option value="rezolvat">✅ Rezolvat</option>
              <option value="confirmat">🎉 Confirmat</option>
            </optgroup>
            <option value="inchis">🔒 Închis</option>
            <option value="respins">❌ Respins</option>
          </select>
          {URGENTE.map(u=>(
            <button key={u.cod} onClick={()=>setFiltruUrgenta(filtruUrgenta===u.cod?null:u.cod)}
                    style={{padding:'8px 14px',background:filtruUrgenta===u.cod ? u.color+'33' : 'transparent',color:filtruUrgenta===u.cod ? u.color : G.muted,border:`1px solid ${filtruUrgenta===u.cod ? u.color : G.border2}`,borderRadius:8,fontSize:13,cursor:'pointer',fontWeight:filtruUrgenta===u.cod?700:400}}>
              {u.emoji} {u.label}
            </button>
          ))}
        </div>

        {/* Lista */}
        {tichetFilt.length === 0 ? (
          <div style={{padding:60,textAlign:'center',color:G.muted,background:G.surface,borderRadius:12,border:`1px dashed ${G.border2}`}}>
            <div style={{fontSize:48,marginBottom:14}}>🎫</div>
            <div style={{fontSize:16,fontWeight:600}}>Nu exista tichete</div>
            <div style={{fontSize:13,marginTop:6}}>Deschide primul tichet cu butonul ➕ Nou</div>
          </div>
        ) : (
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            {tichetFilt.map(t=>(
              <TichetRow key={t.id} t={t} profiles={profiles} onClick={()=>setOpenDetail(t)}
                         showDep={!filterDepartament && !activeDep}
                         canDelete={profile?.is_owner} onDelete={handleDelete} />
            ))}
          </div>
        )}
      </div>
    )
  }

  // ───────────── RENDER ─────────────
  const content = (
    <div style={{padding: noLayout ? 0 : 20, color:G.text, fontFamily:'system-ui, -apple-system, sans-serif'}}>
      {loading ? (
        <div style={{padding:60,textAlign:'center',color:G.muted}}>⏳ Se incarca...</div>
      ) : view === 'dashboard' ? <Dashboard /> : <ListView />}

      {openNew && (
        <TichetFormModal
          subcategorii={subcategorii}
          profile={profile}
          forcedDep={filterDepartament}
          activeLogistica={activeLogistica}
          employeesList={employeesList}
          onClose={()=>setOpenNew(false)}
          onSaved={()=>{ setOpenNew(false); loadAll(); show('Tichet creat!', 'success') }}
          show={show}
        />
      )}
      {openDetail && (
        <TichetDetailModal
          tichet={openDetail}
          profiles={profiles}
          subcategorii={subcategorii}
          profile={profile}
          serviceParteneri={serviceParteneri}
          onClose={()=>setOpenDetail(null)}
          onChanged={()=>{ loadAll(); }}
          onDelete={handleDelete}
          show={show}
        />
      )}

      <ToastContainer />
    </div>
  )

  return content
}

// ════════════════════════════════════════════════════════════════
// TICHET ROW (lista)
// ════════════════════════════════════════════════════════════════
function TichetRow({ t, profiles, onClick, showDep = false, canDelete = false, onDelete }){
  const dep = getDep(t.departament)
  const urg = getUrg(t.urgenta)
  const st = getSt(t.status)
  const deschis = profiles.find(p=>p.id===t.deschis_de)
  return (
    <div onClick={onClick}
         style={{padding:'14px 16px',background:G.surface,border:`1px solid ${urg.cod==='urgent' && !['inchis','confirmat','respins'].includes(t.status) ? G.red+'66' : G.border}`,borderRadius:10,cursor:'pointer',transition:'all 0.15s',display:'flex',alignItems:'center',gap:14}}
         onMouseEnter={e=>{ e.currentTarget.style.borderColor=G.blue; e.currentTarget.style.transform='translateX(2px)' }}
         onMouseLeave={e=>{ e.currentTarget.style.borderColor= urg.cod==='urgent' && !['inchis','confirmat','respins'].includes(t.status) ? G.red+'66' : G.border; e.currentTarget.style.transform='translateX(0)' }}>
      {/* Urgenta indicator */}
      <div style={{fontSize:22,flexShrink:0}}>{urg.emoji}</div>
      {/* Continut */}
      <div style={{flex:1,minWidth:0}}>
        <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',marginBottom:4}}>
          <span style={{fontSize:11,fontFamily:'monospace',color:G.muted}}>#{t.numar_tichet}</span>
          {showDep && <span style={{fontSize:11,padding:'2px 8px',background:dep.color+'22',color:dep.color,borderRadius:4,fontWeight:600}}>{dep.emoji} {dep.nume}</span>}
          <span style={{fontSize:11,padding:'2px 8px',background:st.color+'22',color:st.color,borderRadius:4,fontWeight:600}}>{st.emoji} {st.label}</span>
        </div>
        <div style={{fontSize:14,fontWeight:600,color:G.text,marginBottom:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.titlu}</div>
        {t.entitate_descriere && (
          <div style={{fontSize:11,color:G.muted}}>🎯 {t.entitate_descriere}</div>
        )}
      </div>
      {/* Meta */}
      <div style={{textAlign:'right',flexShrink:0,display:'flex',alignItems:'center',gap:10}}>
        <div>
          <div style={{fontSize:11,color:G.muted}}>{fmtRelative(t.created_at)}</div>
          {deschis && (
            <div style={{display:'flex',alignItems:'center',gap:5,justifyContent:'flex-end',marginTop:4}}>
              <Avatar name={deschis.name} userId={deschis.id} size={22} />
              <span style={{fontSize:11,color:G.dim}}>{deschis.name?.split(' ')[0]}</span>
            </div>
          )}
        </div>
        {canDelete && onDelete && (
          <button 
            onClick={(e)=>{ e.stopPropagation(); onDelete(t) }}
            title="Șterge tichet (doar owner)"
            style={{
              padding:'6px 8px', background:'transparent', color:G.red+'99',
              border:`1px solid ${G.red}33`, borderRadius:6, fontSize:14,
              cursor:'pointer', transition:'all 0.15s',
              display:'flex', alignItems:'center', justifyContent:'center'
            }}
            onMouseEnter={e=>{ e.currentTarget.style.background=G.red+'22'; e.currentTarget.style.color=G.red; e.currentTarget.style.borderColor=G.red }}
            onMouseLeave={e=>{ e.currentTarget.style.background='transparent'; e.currentTarget.style.color=G.red+'99'; e.currentTarget.style.borderColor=G.red+'33' }}>
            🗑
          </button>
        )}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// MODAL: TICHET NOU
// ════════════════════════════════════════════════════════════════
function TichetFormModal({ subcategorii, profile, forcedDep, activeLogistica, employeesList, onClose, onSaved, show }){
  const [step, setStep] = useState(forcedDep ? 2 : 0)  // 0: AI quick, 1: dep manual, 2: detalii
  const [dep, setDep] = useState(forcedDep || null)
  const [form, setForm] = useState({
    subcategorie:'', titlu:'', descriere:'', urgenta:'normal',
    entitate_tip:null, entitate_id:null, entitate_descriere:''
  })
  const [saving, setSaving] = useState(false)
  const [poze, setPoze] = useState([])  // File[] pentru upload
  const fileRef = useRef(null)

  // Etapa 14: atribuire la creare
  const [responsabili, setResponsabili] = useState([])  // [{id, email, fullname}] cu flag receive_tichete_{dep}
  const [defaultsMap, setDefaultsMap] = useState({})    // { departament: profile_id }
  const [selectedResponsabil, setSelectedResponsabil] = useState(null)
  const [respLoaded, setRespLoaded] = useState(false)
  
  // AI state
  const [aiTitlu, setAiTitlu] = useState('')
  const [aiDescriere, setAiDescriere] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiSuggestion, setAiSuggestion] = useState(null)
  const [aiError, setAiError] = useState('')

  const subsForDep = useMemo(()=>subcategorii.filter(s=>s.departament===dep), [subcategorii, dep])

  // Etapa 14: încarc defaults + lista de profiles ce pot fi atribuiți (per departament)
  useEffect(()=>{
    let cancelled = false
    const loadAtribuibili = async () => {
      try {
        // 1) defaults map (1 query pentru toate departamentele)
        const { data: defs } = await supabase
          .from('tichete_default_responsabili')
          .select('departament, profile_id')
        if (cancelled) return
        const dmap = {}
        ;(defs || []).forEach(d => { dmap[d.departament] = d.profile_id })
        setDefaultsMap(dmap)

        // 2) toate profiles cu un flag receive_tichete_* true
        const { data: profs } = await supabase
          .from('profiles')
          .select('id, email, name, is_owner, receive_tichete_logistica, receive_tichete_hr, receive_tichete_administrativ, receive_tichete_it, receive_tichete_comercial, receive_tichete_financiar')
          .order('email')
        if (cancelled) return
        setResponsabili(profs || [])
      } catch (e) {
        console.warn('Atribuibili load error:', e?.message)
      } finally {
        if (!cancelled) setRespLoaded(true)
      }
    }
    loadAtribuibili()
    return () => { cancelled = true }
  }, [])

  // La schimbare departament: presetează responsabil = default din map (dacă există + are flag-ul)
  useEffect(()=>{
    if (!dep || !respLoaded) { setSelectedResponsabil(null); return }
    const defaultId = defaultsMap[dep]
    if (!defaultId) { setSelectedResponsabil(null); return }
    // Verifică să aibă flag-ul corespunzător (sau is_owner)
    const flag = `receive_tichete_${dep}`
    const p = responsabili.find(r => r.id === defaultId)
    if (p && (p.is_owner || p[flag])) setSelectedResponsabil(defaultId)
    else setSelectedResponsabil(null)
  }, [dep, respLoaded, defaultsMap, responsabili])

  // Lista responsabili filtrată pentru departamentul curent
  const responsabiliPentruDep = useMemo(()=>{
    if (!dep) return []
    const flag = `receive_tichete_${dep}`
    return responsabili.filter(p => p.is_owner || p[flag])
  }, [dep, responsabili])

  // Helper: detectează tipul entitate din câmpurile activului
  // Valori valide CHECK constraint: activ | auto | echipament | cladire | persoana | altele
  const getActivTip = (a)=>{
    const hasPlaca = a.nr_inmatriculare && a.nr_inmatriculare.trim() && !a.nr_inmatriculare.toUpperCase().trim().startsWith('NU ')
    const hasSasiu = a.serie_sasiu && a.serie_sasiu.trim()
    if(hasPlaca) return 'auto'
    if(hasSasiu) return 'activ'  // utilaj
    return 'echipament'
  }

  // Label inteligent — skip „NU ARE..." din nr_inmatriculare
  const buildActivLabel = (a)=>{
    const parts = []
    if(a.nr_inmatriculare && !a.nr_inmatriculare.toUpperCase().trim().startsWith('NU ')) parts.push(a.nr_inmatriculare)
    if(a.marca) parts.push(a.marca)
    if(a.model) parts.push(a.model)
    return parts.filter(Boolean).join(' · ') || a.cod_intern || `Activ #${a.id}`
  }

  // Entitate autocomplete: filtrată contextual pe subcategorie + tip BD corect
  const entitateOptions = useMemo(()=>{
    if(dep === 'logistica' && Array.isArray(activeLogistica)) {
      let arr = activeLogistica
      // Filtrare pe subcategorie selectată
      const sub = form.subcategorie
      if(sub === 'defectiune_auto')       arr = arr.filter(a => getActivTip(a) === 'auto')
      else if(sub === 'avarie_utilaj')    arr = arr.filter(a => getActivTip(a) === 'activ')
      else if(sub === 'stricat_echipament') arr = arr.filter(a => getActivTip(a) === 'echipament')
      else if(sub === 'alimentare_anomalie') arr = arr.filter(a => getActivTip(a) !== 'echipament')
      // documente_lipsa + altele + nicio subcategorie → arată tot
      return arr.map(a => ({
        tip: getActivTip(a),
        id: a.id,
        label: buildActivLabel(a)
      })).filter(o => o.label && o.label.trim())
    }
    if(dep === 'hr' && Array.isArray(employeesList)) {
      return employeesList.map(e => ({
        tip: 'persoana',
        id: e.id,
        label: [e.name, e.functie].filter(Boolean).join(' · ')
      })).filter(o => o.label && o.label.trim())
    }
    return []
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dep, form.subcategorie, activeLogistica, employeesList])

  // AI sugestie: apel edge function
  const runAI = async()=>{
    if(aiTitlu.trim().length < 3){ setAiError('Scrie cel putin 3 caractere'); return }
    setAiLoading(true); setAiError(''); setAiSuggestion(null)
    try {
      const { data, error } = await supabase.functions.invoke('suggest-tichet', {
        body: { titlu: aiTitlu.trim(), descriere: aiDescriere.trim() }
      })
      if(error) throw error
      if(data?.error) throw new Error(data.error)
      setAiSuggestion(data)
    } catch(e) {
      setAiError('Eroare AI: ' + (e.message || 'necunoscut'))
    } finally {
      setAiLoading(false)
    }
  }

  // Aplica sugestia AI -> sare la Pas 2 cu totul pre-completat
  const applyAI = ()=>{
    if(!aiSuggestion) return
    setDep(aiSuggestion.departament)
    setForm({
      ...form,
      subcategorie: aiSuggestion.subcategorie,
      urgenta: aiSuggestion.urgenta,
      titlu: aiTitlu.trim(),
      descriere: aiDescriere.trim()
    })
    setStep(2)
  }

  const handleAddPoza = (e)=>{
    const files = Array.from(e.target.files || [])
    setPoze(p=>[...p, ...files].slice(0, 5))  // max 5 poze
  }

  const submit = async()=>{
    if(!dep || !form.subcategorie || !form.titlu.trim() || !form.descriere.trim()){
      show('Completeaza toate campurile obligatorii', 'error')
      return
    }
    setSaving(true)
    try {
      // Etapa 14: dacă responsabil setat → atribuire directă la creare (status='atribuit')
      const payload = {
        departament: dep,
        subcategorie: form.subcategorie,
        titlu: form.titlu.trim(),
        descriere: form.descriere.trim(),
        urgenta: form.urgenta,
        entitate_tip: form.entitate_tip || null,
        entitate_id: form.entitate_id || null,
        entitate_descriere: form.entitate_descriere || null,
        deschis_de: profile?.id,
        status: selectedResponsabil ? 'atribuit' : 'deschis'
      }
      if (selectedResponsabil) {
        payload.persoana_responsabila = selectedResponsabil
        payload.atribuit_de = profile?.id
        payload.data_atribuire = new Date().toISOString()
        payload.asignat_la = 'intern'
      }
      // 1. Insert tichet
      const { data: tk, error } = await supabase.from('tichete').insert(payload).select().single()
      if(error) throw error

      // 2. Upload poze daca exista
      // FIX 27.05.2026: schimbat bucket 'tichete' (no RLS) -> 'tichete-atasamente' + error vizibil
      if(poze.length > 0){
        const paths = []
        const failed = []
        for(const f of poze){
          const ext = f.name.split('.').pop()
          const path = `${tk.id}/${Date.now()}_${Math.random().toString(36).slice(2,8)}.${ext}`
          const { error: upErr } = await supabase.storage.from('tichete-atasamente').upload(path, f, { contentType: f.type })
          if(upErr) {
            console.error('Eroare upload poza:', upErr)
            failed.push(`${f.name}: ${upErr.message}`)
          } else {
            paths.push(path)
          }
        }
        if(paths.length > 0){
          await supabase.from('tichete').update({ poze_paths: paths }).eq('id', tk.id)
        }
        if(failed.length > 0){
          show(`⚠️ ${failed.length} poze nu s-au încărcat: ${failed.join('; ')}`, 'error')
        } else if(paths.length > 0){
          show(`✅ ${paths.length} poze încărcate`, 'success')
        }
      }

      onSaved()
    } catch(e){
      show('Eroare: ' + e.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal onClose={onClose} title={step === 0 ? '🤖 Tichet nou cu AI' : step === 1 ? '🎫 Tichet nou - alege departament' : `🎫 Tichet nou - ${getDep(dep).nume}`} width={620}>
      {step === 0 && (
        <div>
          <div style={{padding:14,background:G.purpleDim,border:`1px solid ${G.purple}66`,borderRadius:10,marginBottom:16}}>
            <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:6}}>
              <span style={{fontSize:24}}>🤖</span>
              <strong style={{color:G.purple,fontSize:16}}>Asistent Claude Haiku</strong>
            </div>
            <div style={{fontSize:13,color:G.muted,lineHeight:1.5}}>
              Scrie problema in propriile cuvinte si AI-ul iti alege automat departamentul + subcategoria + urgenta. 
              Te poti razgandi oricand prin „Alege manual".
            </div>
          </div>

          <div style={{display:'flex',flexDirection:'column',gap:12}}>
            <div>
              <label style={{fontSize:13,color:G.muted,marginBottom:6,display:'block',fontWeight:600}}>Titlu / Problema *</label>
              <input type="text" value={aiTitlu} onChange={e=>{ setAiTitlu(e.target.value); setAiSuggestion(null); setAiError('') }}
                     placeholder="Ex: Excavatorul JCB nu mai porneste la PH22"
                     style={{width:'100%',padding:'12px 14px',background:G.bg,border:`1px solid ${G.border2}`,borderRadius:8,color:G.text,fontSize:15}} />
            </div>
            <div>
              <label style={{fontSize:13,color:G.muted,marginBottom:6,display:'block',fontWeight:600}}>Detalii suplimentare (optional)</label>
              <textarea value={aiDescriere} onChange={e=>{ setAiDescriere(e.target.value); setAiSuggestion(null); setAiError('') }}
                        rows={3} placeholder="Ce s-a intamplat, cand, in ce conditii..."
                        style={{width:'100%',padding:'11px 14px',background:G.bg,border:`1px solid ${G.border2}`,borderRadius:8,color:G.text,fontSize:14,fontFamily:'inherit',resize:'vertical'}} />
            </div>

            {aiError && (
              <div style={{padding:10,background:G.redDim,border:`1px solid ${G.red}66`,borderRadius:6,color:G.red,fontSize:14}}>
                ⚠ {aiError}
              </div>
            )}

            {aiSuggestion && (
              <div style={{padding:14,background:G.greenDim,border:`1px solid ${G.green}66`,borderRadius:10}}>
                <div style={{fontSize:12,color:G.muted,marginBottom:8,fontWeight:600,textTransform:'uppercase',letterSpacing:0.5}}>💡 Sugestie AI</div>
                <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',marginBottom:8}}>
                  <span style={{padding:'7px 14px',background:getDep(aiSuggestion.departament).color+'33',color:getDep(aiSuggestion.departament).color,borderRadius:6,fontSize:14,fontWeight:700}}>
                    {getDep(aiSuggestion.departament).emoji} {getDep(aiSuggestion.departament).nume}
                  </span>
                  <span style={{fontSize:15,color:G.muted}}>→</span>
                  <span style={{padding:'7px 14px',background:G.bg,color:G.text,borderRadius:6,fontSize:14}}>
                    {subcategorii.find(s=>s.departament===aiSuggestion.departament && s.cod===aiSuggestion.subcategorie)?.emoji || '📌'}
                    {' '}
                    {subcategorii.find(s=>s.departament===aiSuggestion.departament && s.cod===aiSuggestion.subcategorie)?.denumire || aiSuggestion.subcategorie}
                  </span>
                  <span style={{padding:'7px 14px',background:getUrg(aiSuggestion.urgenta).color+'33',color:getUrg(aiSuggestion.urgenta).color,borderRadius:6,fontSize:14,fontWeight:700}}>
                    {getUrg(aiSuggestion.urgenta).emoji} {getUrg(aiSuggestion.urgenta).label}
                  </span>
                </div>
                {aiSuggestion.motiv && (
                  <div style={{fontSize:13,color:G.muted,fontStyle:'italic',marginBottom:6}}>
                    „{aiSuggestion.motiv}"
                  </div>
                )}
                <div style={{display:'flex',gap:14,fontSize:11,color:G.dim,marginBottom:10}}>
                  <span>📊 {aiSuggestion.confidence}% confident</span>
                  {aiSuggestion._meta && <span>💰 ${aiSuggestion._meta.cost_usd}</span>}
                </div>
                <div style={{display:'flex',gap:8}}>
                  <button onClick={applyAI} style={{flex:1,padding:'11px',background:G.green,color:'#fff',border:0,borderRadius:8,fontWeight:700,fontSize:15,cursor:'pointer'}}>
                    ✅ Aplica si continua
                  </button>
                  <button onClick={runAI} disabled={aiLoading} style={{padding:'11px 16px',background:'transparent',color:G.muted,border:`1px solid ${G.border2}`,borderRadius:8,fontSize:14,cursor:'pointer'}}>
                    🔄 Reanalizeaza
                  </button>
                </div>
              </div>
            )}

            {/* Butoane principale */}
            {!aiSuggestion && (
              <div style={{display:'flex',gap:8,marginTop:6}}>
                <button onClick={runAI} disabled={aiLoading || aiTitlu.trim().length < 3}
                        style={{flex:2,padding:'13px',background:aiLoading ? G.muted : G.purple,color:'#fff',border:0,borderRadius:8,fontSize:15,fontWeight:700,cursor:aiLoading?'wait':'pointer',opacity:aiTitlu.trim().length<3?0.5:1,display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>
                  {aiLoading ? '⏳ Analizez...' : '🤖 Sugereaza automat cu AI'}
                </button>
                <button onClick={()=>setStep(1)} style={{flex:1,padding:'13px',background:'transparent',color:G.muted,border:`1px solid ${G.border2}`,borderRadius:8,fontSize:14,cursor:'pointer'}}>
                  Alege manual →
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {step === 1 && (
        <div>
          <button onClick={()=>setStep(0)} style={{padding:'7px 14px',background:'transparent',color:G.muted,border:`1px solid ${G.border2}`,borderRadius:6,fontSize:13,cursor:'pointer',marginBottom:12}}>
            ← Foloseste AI
          </button>
          <div style={{fontSize:14,color:G.muted,marginBottom:14}}>Selecteaza departamentul pentru care deschizi tichetul:</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            {DEPARTAMENTE.map(d=>(
              <button key={d.cod} onClick={()=>{ setDep(d.cod); setStep(2) }}
                      style={{padding:'14px 16px',background:G.surface,border:`1px solid ${G.border2}`,borderRadius:10,cursor:'pointer',textAlign:'left',display:'flex',alignItems:'center',gap:12,transition:'all 0.15s'}}
                      onMouseEnter={e=>{ e.currentTarget.style.borderColor=d.color; e.currentTarget.style.background=d.color+'11' }}
                      onMouseLeave={e=>{ e.currentTarget.style.borderColor=G.border2; e.currentTarget.style.background=G.surface }}>
                <span style={{fontSize:28}}>{d.emoji}</span>
                <div>
                  <div style={{fontSize:16,fontWeight:700,color:G.text}}>{d.nume}</div>
                  <div style={{fontSize:12,color:G.muted,marginTop:2}}>{d.descriere}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 2 && (
        <div style={{display:'flex',flexDirection:'column',gap:14}}>
          {!forcedDep && (
            <button onClick={()=>setStep(0)} style={{alignSelf:'flex-start',padding:'7px 14px',background:'transparent',color:G.muted,border:`1px solid ${G.border2}`,borderRadius:6,fontSize:13,cursor:'pointer'}}>
              ← Inapoi (AI sau manual)
            </button>
          )}

          {/* Subcategorie */}
          <div>
            <label style={{fontSize:13,color:G.muted,marginBottom:6,display:'block',fontWeight:600}}>Subcategorie *</label>
            <select value={form.subcategorie} onChange={e=>setForm({...form, subcategorie:e.target.value})}
                    style={{width:'100%',padding:'11px 14px',background:G.bg,border:`1px solid ${G.border2}`,borderRadius:8,color:G.text,fontSize:15}}>
              <option value="">-- Alege --</option>
              {subsForDep.map(s=>(
                <option key={s.cod} value={s.cod}>{s.emoji} {s.denumire}</option>
              ))}
            </select>
            {form.subcategorie && (
              <div style={{fontSize:12,color:G.muted,marginTop:5}}>
                {subsForDep.find(s=>s.cod===form.subcategorie)?.descriere}
              </div>
            )}
          </div>

          {/* Urgenta */}
          <div>
            <label style={{fontSize:13,color:G.muted,marginBottom:6,display:'block',fontWeight:600}}>Urgenta</label>
            <div style={{display:'flex',gap:8}}>
              {URGENTE.map(u=>(
                <button key={u.cod} type="button" onClick={()=>setForm({...form, urgenta:u.cod})}
                        style={{flex:1,padding:'11px 14px',background:form.urgenta===u.cod ? u.color+'22' : G.bg,border:`1px solid ${form.urgenta===u.cod ? u.color : G.border2}`,borderRadius:8,cursor:'pointer',color:form.urgenta===u.cod ? u.color : G.text,fontWeight:form.urgenta===u.cod?700:400,fontSize:14}}>
                  <div>{u.emoji} {u.label}</div>
                  <div style={{fontSize:11,color:G.muted,marginTop:3}}>{u.sla}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Etapa 14: Atribuie la — opțional, presetat la default per departament */}
          <div>
            <label style={{fontSize:13,color:G.muted,marginBottom:6,display:'block',fontWeight:600}}>
              👤 Atribuie la <span style={{color:G.dim,fontWeight:400}}>(opt - poate prelua altcineva din widget)</span>
              {selectedResponsabil && defaultsMap[dep] === selectedResponsabil && (
                <span style={{marginLeft:8, padding:'2px 8px', background:G.green+'22', color:G.green, borderRadius:10, fontSize:10, fontWeight:800, letterSpacing:0.5}}>
                  🎯 DEFAULT
                </span>
              )}
            </label>
            <select value={selectedResponsabil || ''} onChange={e=>setSelectedResponsabil(e.target.value || null)}
                    style={{width:'100%',padding:'11px 14px',background:G.bg,border:`1px solid ${G.border2}`,borderRadius:8,color:G.text,fontSize:14}}>
              <option value="">— Nimeni (rămâne disponibil pentru preluare) —</option>
              {responsabiliPentruDep.length === 0 && (
                <option value="" disabled>Niciun utilizator cu flag receive_tichete_{dep}</option>
              )}
              {responsabiliPentruDep.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name || p.email}{p.is_owner ? ' · owner' : ''}{p.id === defaultsMap[dep] ? ' · default' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Titlu */}
          <div>
            <label style={{fontSize:13,color:G.muted,marginBottom:6,display:'block',fontWeight:600}}>Titlu * <span style={{color:G.dim,fontWeight:400}}>(scurt, esential)</span></label>
            <input type="text" value={form.titlu} onChange={e=>setForm({...form, titlu:e.target.value})} maxLength={100}
                   placeholder="Ex: Alternator stricat PH 22 GZP"
                   style={{width:'100%',padding:'11px 14px',background:G.bg,border:`1px solid ${G.border2}`,borderRadius:8,color:G.text,fontSize:15}} />
          </div>

          {/* Descriere */}
          <div>
            <label style={{fontSize:13,color:G.muted,marginBottom:6,display:'block',fontWeight:600}}>Descriere * <span style={{color:G.dim,fontWeight:400}}>(detalii, simptome, context)</span></label>
            <textarea value={form.descriere} onChange={e=>setForm({...form, descriere:e.target.value})} rows={4}
                      placeholder="Ce s-a intamplat, cand, in ce conditii, ce ai incercat..."
                      style={{width:'100%',padding:'11px 14px',background:G.bg,border:`1px solid ${G.border2}`,borderRadius:8,color:G.text,fontSize:15,fontFamily:'inherit',resize:'vertical'}} />
          </div>

          {/* Entitate cu autocomplete pentru logistica/hr, text liber pentru rest */}
          <div>
            <label style={{fontSize:13,color:G.muted,marginBottom:6,display:'block',fontWeight:600}}>
              Entitate <span style={{color:G.dim,fontWeight:400}}>
                {dep === 'logistica' ? '(opt - alege din lista activelor sau scrie liber)' :
                 dep === 'hr'        ? '(opt - alege din lista angajatilor sau scrie liber)' :
                                       '(opt - text liber)'}
              </span>
            </label>
            <input type="text"
                   list={entitateOptions.length > 0 ? `entitate-options-${dep}` : undefined}
                   value={form.entitate_descriere}
                   onChange={e=>{
                     const val = e.target.value
                     const matched = entitateOptions.find(o=>o.label===val)
                     if(matched){
                       setForm({...form, entitate_descriere:val, entitate_tip:matched.tip, entitate_id:matched.id})
                     } else {
                       setForm({...form, entitate_descriere:val, entitate_tip:null, entitate_id:null})
                     }
                   }}
                   maxLength={200}
                   placeholder={
                     dep === 'logistica' ? 'Tasteaza sau alege: PH 22 GZP / Excavator JCB / etc.' :
                     dep === 'hr'        ? 'Tasteaza sau alege un angajat' :
                                           'Ex: birou contabilitate / imprimanta etaj 2 / etc.'
                   }
                   style={{width:'100%',padding:'11px 14px',background:G.bg,border:`1px solid ${G.border2}`,borderRadius:8,color:G.text,fontSize:15}} />
            {entitateOptions.length > 0 && (
              <datalist id={`entitate-options-${dep}`}>
                {entitateOptions.map((o,i)=>(
                  <option key={i} value={o.label} />
                ))}
              </datalist>
            )}
            {form.entitate_id && (
              <div style={{fontSize:12,color:G.green,marginTop:5}}>
                ✓ Asociat cu {
                  form.entitate_tip === 'auto'       ? 'autovehiculul' :
                  form.entitate_tip === 'activ'      ? 'utilajul' :
                  form.entitate_tip === 'echipament' ? 'echipamentul' :
                  form.entitate_tip === 'persoana'   ? 'persoana' :
                                                       'entitatea'
                } din BD (id: {form.entitate_id})
              </div>
            )}
          </div>

          {/* Poze upload */}
          <div>
            <label style={{fontSize:13,color:G.muted,marginBottom:6,display:'block',fontWeight:600}}>📸 Poze <span style={{color:G.dim,fontWeight:400}}>(opt - max 5)</span></label>
            <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
              {poze.map((f,i)=>(
                <div key={i} style={{position:'relative',width:66,height:66,borderRadius:6,overflow:'hidden',border:`1px solid ${G.border2}`}}>
                  <img src={URL.createObjectURL(f)} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}} />
                  <button type="button" onClick={()=>setPoze(p=>p.filter((_,idx)=>idx!==i))}
                          style={{position:'absolute',top:2,right:2,width:20,height:20,borderRadius:'50%',background:G.red,color:'#fff',border:0,cursor:'pointer',fontSize:11,display:'flex',alignItems:'center',justifyContent:'center'}}>×</button>
                </div>
              ))}
              {poze.length < 5 && (
                <button type="button" onClick={()=>fileRef.current?.click()}
                        style={{width:66,height:66,borderRadius:6,background:G.bg,border:`1px dashed ${G.border2}`,color:G.muted,cursor:'pointer',fontSize:24}}>
                  +
                </button>
              )}
              <input ref={fileRef} type="file" accept="image/*" multiple onChange={handleAddPoza} style={{display:'none'}} />
            </div>
          </div>

          {/* Submit */}
          <div style={{display:'flex',gap:10,marginTop:8,justifyContent:'flex-end'}}>
            <button onClick={onClose} disabled={saving} style={{padding:'11px 20px',background:'transparent',color:G.muted,border:`1px solid ${G.border2}`,borderRadius:8,fontSize:15,cursor:'pointer'}}>
              Anuleaza
            </button>
            <button onClick={submit} disabled={saving} style={{padding:'11px 26px',background:G.blue,color:'#fff',border:0,borderRadius:8,fontSize:15,fontWeight:700,cursor:saving?'wait':'pointer',opacity:saving?0.7:1}}>
              {saving ? '⏳ Trimit...' : '🎫 Deschide tichet'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}

// ════════════════════════════════════════════════════════════════
// MODAL: DETALIU TICHET
// ════════════════════════════════════════════════════════════════
function TichetDetailModal({ tichet: initialT, profiles, subcategorii, profile, serviceParteneri = [], onClose, onChanged, onDelete, show }){
  const [t, setT] = useState(initialT)
  const [comentarii, setComentarii] = useState([])
  const [istoric, setIstoric] = useState([])
  const [pozeUrls, setPozeUrls] = useState([])
  const [brokenPoze, setBrokenPoze] = useState({})  // index -> true cand <img> onError
  const [comText, setComText] = useState('')
  const [tab, setTab] = useState('timeline')  // 'timeline' | 'comentarii' | 'rezolvare'
  const [saving, setSaving] = useState(false)
  const [showAtribuie, setShowAtribuie] = useState(false)
  const [showRezolva, setShowRezolva] = useState(false)
  // Modale workflow logistica
  const [showAnaliza, setShowAnaliza] = useState(false)
  const [showProgramareService, setShowProgramareService] = useState(false)
  const [showIntrareService, setShowIntrareService] = useState(false)
  const [showReparat, setShowReparat] = useState(false)

  const dep = getDep(t.departament)
  const urg = getUrg(t.urgenta)
  const st = getSt(t.status)
  const sub = subcategorii.find(s=>s.departament===t.departament && s.cod===t.subcategorie)
  const isMine = t.deschis_de === profile?.id
  const isOwner = profile?.is_owner
  const isLogistica = t.departament === 'logistica'
  const partener = t.service_partener_id ? serviceParteneri.find(p=>p.id===t.service_partener_id) : null
  const responsabil = profiles.find(p=>p.id===t.persoana_responsabila)
  const deschisDe = profiles.find(p=>p.id===t.deschis_de)
  const rezolvatDe = profiles.find(p=>p.id===t.rezolvat_de)

  const reload = useCallback(async()=>{
    const [tkRes, comRes, istRes] = await Promise.all([
      supabase.from('tichete').select('*').eq('id', t.id).maybeSingle(),
      supabase.from('tichete_comentarii').select('*').eq('tichet_id', t.id).order('created_at'),
      supabase.from('tichete_istoric').select('*').eq('tichet_id', t.id).order('created_at')
    ])
    if(tkRes.data) setT(tkRes.data)
    setComentarii(comRes.data || [])
    setIstoric(istRes.data || [])

    // Signed URLs poze
    // FIX 27.05.2026: bucket 'tichete' -> 'tichete-atasamente' (singurul cu RLS policies)
    // FIX 29.05.2026: surfacing erori — createSignedUrl nu mai eșuează silent.
    //   La fail: păstrăm intrarea cu url:null ca să randăm placeholder „poză indisponibilă" + toast.
    setBrokenPoze({})
    if(tkRes.data?.poze_paths?.length > 0){
      const urls = []
      const failed = []
      for(const p of tkRes.data.poze_paths){
        const { data, error } = await supabase.storage.from('tichete-atasamente').createSignedUrl(p, 600)
        if(error || !data?.signedUrl){
          console.error('Eroare semnare poză:', p, error)
          failed.push(p.split('/').pop() || p)
          urls.push({ path:p, url:null })  // placeholder în UI, nu <img> gol
        } else {
          urls.push({ path:p, url:data.signedUrl })
        }
      }
      setPozeUrls(urls)
      if(failed.length > 0){
        show(`⚠️ ${failed.length} ${failed.length===1?'poză nu a putut fi afișată':'poze nu au putut fi afișate'}: ${failed.join(', ')}`, 'error')
      }
    } else {
      setPozeUrls([])
    }
  }, [t.id, show])

  useEffect(()=>{ reload() }, [reload])

  const addComentariu = async()=>{
    if(!comText.trim()) return
    setSaving(true)
    try {
      await supabase.from('tichete_comentarii').insert({ tichet_id:t.id, autor:profile.id, text:comText.trim() })
      setComText('')
      await reload()
    } catch(e){ show('Eroare: ' + e.message, 'error') } finally { setSaving(false) }
  }

  const changeStatus = async(newStatus, extra = {})=>{
    setSaving(true)
    try {
      const update = { status: newStatus, ...extra }
      if(newStatus === 'inchis') update.data_inchidere = new Date().toISOString()
      const { error } = await supabase.from('tichete').update(update).eq('id', t.id)
      if(error) throw error
      await reload()
      onChanged()
      show(`Status: ${getSt(newStatus).label}`, 'success')
    } catch(e){ show('Eroare: ' + e.message, 'error') } finally { setSaving(false) }
  }

  return (
    <Modal onClose={onClose} title="" width={820} noTitleBar={true}>
      {/* Header custom */}
      <div style={{padding:'16px 20px',borderBottom:`1px solid ${G.border}`,marginBottom:16,marginLeft:-20,marginRight:-20,marginTop:-20}}>
        <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:14}}>
          <div style={{flex:1}}>
            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6,flexWrap:'wrap'}}>
              <span style={{fontSize:11,fontFamily:'monospace',color:G.muted,padding:'2px 6px',background:G.bg,borderRadius:4}}>#{t.numar_tichet}</span>
              <span style={{fontSize:11,padding:'2px 8px',background:dep.color+'22',color:dep.color,borderRadius:4,fontWeight:600}}>{dep.emoji} {dep.nume}</span>
              <span style={{fontSize:11,padding:'2px 8px',background:G.bg,color:G.muted,borderRadius:4}}>{sub?.emoji} {sub?.denumire}</span>
              <span style={{fontSize:11,padding:'2px 8px',background:urg.color+'22',color:urg.color,borderRadius:4,fontWeight:600}}>{urg.emoji} {urg.label}</span>
              <span style={{fontSize:11,padding:'2px 8px',background:st.color+'22',color:st.color,borderRadius:4,fontWeight:700}}>{st.emoji} {st.label}</span>
            </div>
            <h2 style={{margin:0,fontSize:20,color:G.text,fontWeight:700}}>{t.titlu}</h2>
            {t.entitate_descriere && <div style={{fontSize:13,color:G.muted,marginTop:4}}>🎯 {t.entitate_descriere}</div>}
          </div>
          <button onClick={onClose} style={{padding:6,background:'transparent',color:G.muted,border:`1px solid ${G.border2}`,borderRadius:6,cursor:'pointer',fontSize:18,lineHeight:1,width:32,height:32}}>×</button>
        </div>
      </div>

      {/* Descriere */}
      <div style={{padding:14,background:G.bg,border:`1px solid ${G.border}`,borderRadius:8,marginBottom:14}}>
        <div style={{fontSize:11,color:G.muted,marginBottom:4,fontWeight:600,textTransform:'uppercase',letterSpacing:0.5}}>Descriere</div>
        <div style={{fontSize:14,color:G.text,whiteSpace:'pre-wrap',lineHeight:1.5}}>{t.descriere}</div>
      </div>

      {/* Panou Logistica — snapshot km/ore + info service */}
      {isLogistica && (t.km_snapshot != null || t.ore_snapshot != null || t.service_partener_id || t.firma_externa || t.data_intrare_service || t.data_estimata_reparatie || t.data_programare_service) && (
        <div style={{padding:14,background:G.purple+'10',border:`1px solid ${G.purple}44`,borderRadius:8,marginBottom:14}}>
          <div style={{fontSize:11,color:G.purple,marginBottom:8,fontWeight:700,textTransform:'uppercase',letterSpacing:0.5}}>🚛 Info Logistică</div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))',gap:10,fontSize:13}}>
            {t.km_snapshot != null && (
              <div>
                <div style={{color:G.muted,fontSize:11,marginBottom:2}}>Km la creare</div>
                <div style={{color:G.text,fontWeight:700}}>{Number(t.km_snapshot).toLocaleString('ro-RO')} km</div>
              </div>
            )}
            {t.ore_snapshot != null && (
              <div>
                <div style={{color:G.muted,fontSize:11,marginBottom:2}}>Ore la creare</div>
                <div style={{color:G.text,fontWeight:700}}>{Number(t.ore_snapshot).toLocaleString('ro-RO')} h</div>
              </div>
            )}
            {(partener || t.firma_externa) && (
              <div>
                <div style={{color:G.muted,fontSize:11,marginBottom:2}}>🏢 Service</div>
                <div style={{color:G.text,fontWeight:700}}>{partener?.nume || t.firma_externa}</div>
                {partener?.telefon && <div style={{color:G.dim,fontSize:11}}>{partener.telefon}</div>}
              </div>
            )}
            {t.data_programare_service && (
              <div>
                <div style={{color:G.muted,fontSize:11,marginBottom:2}}>📅 Programare</div>
                <div style={{color:G.text,fontWeight:700}}>{fmtDate(t.data_programare_service)}</div>
              </div>
            )}
            {t.data_intrare_service && (
              <div>
                <div style={{color:G.muted,fontSize:11,marginBottom:2}}>🔧 Intrat service</div>
                <div style={{color:G.text,fontWeight:700}}>{fmtDate(t.data_intrare_service)}</div>
              </div>
            )}
            {t.data_estimata_reparatie && (
              <div>
                <div style={{color:G.muted,fontSize:11,marginBottom:2}}>⏳ Estimat reparat</div>
                <div style={{color:G.text,fontWeight:700}}>{fmtDate(t.data_estimata_reparatie)}</div>
                {t.status === 'in_service' && (() => {
                  const diff = Math.floor((new Date() - new Date(t.data_estimata_reparatie))/(86400000))
                  if(diff > 5) return <div style={{color:G.red,fontSize:11,fontWeight:600,marginTop:2}}>⚠️ Depășit cu {diff} zile</div>
                  if(diff > 0) return <div style={{color:G.yellow,fontSize:11,marginTop:2}}>+{diff} zile peste</div>
                  return null
                })()}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Poze */}
      {pozeUrls.length > 0 && (
        <div style={{marginBottom:14}}>
          <div style={{fontSize:11,color:G.muted,marginBottom:8,fontWeight:600,textTransform:'uppercase',letterSpacing:0.5}}>📸 Poze ({pozeUrls.length})</div>
          <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
            {pozeUrls.map((p,i)=>{
              // FIX 29.05.2026: fără url (semnare eșuată) sau <img> care dă onError → placeholder vizibil
              const broken = !p.url || brokenPoze[i]
              if(broken){
                return (
                  <div key={i} title={p.path}
                       style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:4,width:100,height:100,borderRadius:6,border:`1px dashed ${G.red}66`,background:G.redDim,color:G.red,fontSize:10,textAlign:'center',padding:4,boxSizing:'border-box'}}>
                    <span style={{fontSize:22}}>⚠️</span>
                    <span>poză indisponibilă</span>
                  </div>
                )
              }
              return (
                <a key={i} href={p.url} target="_blank" rel="noreferrer" style={{display:'block',width:100,height:100,borderRadius:6,overflow:'hidden',border:`1px solid ${G.border2}`}}>
                  <img src={p.url} alt="" onError={()=>setBrokenPoze(b=>({...b,[i]:true}))} style={{width:'100%',height:'100%',objectFit:'cover'}} />
                </a>
              )
            })}
          </div>
        </div>
      )}

      {/* Info meta */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:14,fontSize:12}}>
        <div style={{padding:10,background:G.bg,border:`1px solid ${G.border}`,borderRadius:6}}>
          <div style={{color:G.muted,marginBottom:4}}>📅 Deschis</div>
          <div style={{color:G.text,fontWeight:600}}>{deschisDe?.name || '?'}</div>
          <div style={{color:G.dim,fontSize:11,marginTop:2}}>{fmtDateTime(t.data_deschidere)}</div>
        </div>
        {(t.status === 'atribuit' || t.status === 'in_lucru' || t.status === 'rezolvat' || t.status === 'confirmat' || t.status === 'inchis') && (
          <div style={{padding:10,background:G.bg,border:`1px solid ${G.border}`,borderRadius:6}}>
            <div style={{color:G.muted,marginBottom:4}}>👤 Asignat</div>
            <div style={{color:G.text,fontWeight:600}}>{t.asignat_la === 'extern' ? `🏢 ${t.firma_externa}` : (responsabil?.name || '?')}</div>
            {t.data_atribuire && <div style={{color:G.dim,fontSize:11,marginTop:2}}>{fmtDateTime(t.data_atribuire)}</div>}
          </div>
        )}
        {t.status === 'rezolvat' || t.status === 'confirmat' || t.status === 'inchis' ? (
          <div style={{padding:10,background:G.bg,border:`1px solid ${G.border}`,borderRadius:6,gridColumn:'span 2'}}>
            <div style={{color:G.muted,marginBottom:4}}>✅ Rezolvat</div>
            <div style={{color:G.text,fontSize:13,whiteSpace:'pre-wrap'}}>{t.descriere_interventie || '-'}</div>
            <div style={{display:'flex',gap:14,marginTop:6,fontSize:11,color:G.dim,flexWrap:'wrap'}}>
              {t.cost > 0 && <span>💰 {Number(t.cost).toFixed(2)} lei</span>}
              {t.durata_ore > 0 && <span>⏱ {t.durata_ore}h</span>}
              {t.piese_schimbate && <span>🔧 {t.piese_schimbate}</span>}
              {rezolvatDe && <span>by {rezolvatDe.name}</span>}
            </div>
          </div>
        ) : null}
      </div>

      {/* Tabs */}
      <div style={{display:'flex',gap:2,borderBottom:`1px solid ${G.border}`,marginBottom:14}}>
        {['timeline','comentarii'].map(tx=>(
          <button key={tx} onClick={()=>setTab(tx)}
                  style={{padding:'10px 16px',background:'transparent',color:tab===tx ? G.blue : G.muted,border:0,borderBottom:`2px solid ${tab===tx ? G.blue : 'transparent'}`,fontSize:13,fontWeight:600,cursor:'pointer'}}>
            {tx === 'timeline' ? '📜 Istoric' : `💬 Comentarii (${comentarii.length})`}
          </button>
        ))}
      </div>

      {/* TAB Timeline */}
      {tab === 'timeline' && (
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          {istoric.length === 0 ? (
            <div style={{padding:30,textAlign:'center',color:G.muted,fontSize:13}}>Nicio actiune inregistrata</div>
          ) : istoric.map(i=>{
            const a = profiles.find(p=>p.id===i.autor)
            return (
              <div key={i.id} style={{display:'flex',gap:10,padding:'8px 0'}}>
                <Avatar name={a?.name} userId={i.autor} size={28} />
                <div style={{flex:1}}>
                  <div style={{fontSize:12,color:G.text}}>
                    <strong>{a?.name || 'Sistem'}</strong>{' '}
                    {i.actiune === 'deschis' ? <span style={{color:G.green}}>a deschis tichetul</span> :
                     i.actiune === 'status_changed' ? <>a schimbat status: <span style={{color:G.muted}}>{getSt(i.detalii?.from)?.label} →</span> <span style={{color:getSt(i.detalii?.to)?.color,fontWeight:600}}>{getSt(i.detalii?.to)?.label}</span></> :
                     i.actiune === 'atribuire' ? <span style={{color:G.orange}}>a atribuit tichetul ({i.detalii?.asignat_la === 'extern' ? 'extern: ' + i.detalii?.firma : 'intern'})</span> :
                     i.actiune}
                  </div>
                  <div style={{fontSize:10,color:G.dim,marginTop:2}}>{fmtDateTime(i.created_at)}</div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* TAB Comentarii */}
      {tab === 'comentarii' && (
        <div>
          <div style={{display:'flex',flexDirection:'column',gap:10,marginBottom:14,maxHeight:300,overflowY:'auto'}}>
            {comentarii.length === 0 ? (
              <div style={{padding:30,textAlign:'center',color:G.muted,fontSize:13}}>Nu sunt comentarii inca</div>
            ) : comentarii.map(c=>{
              const a = profiles.find(p=>p.id===c.autor)
              return (
                <div key={c.id} style={{display:'flex',gap:10}}>
                  <Avatar name={a?.name} userId={c.autor} size={32} />
                  <div style={{flex:1,padding:10,background:G.bg,borderRadius:8,border:`1px solid ${G.border}`}}>
                    <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
                      <strong style={{fontSize:13,color:G.text}}>{a?.name || '?'}</strong>
                      <span style={{fontSize:11,color:G.dim}}>{fmtRelative(c.created_at)}</span>
                    </div>
                    <div style={{fontSize:13,color:G.text,whiteSpace:'pre-wrap'}}>{c.text}</div>
                  </div>
                </div>
              )
            })}
          </div>
          {!['inchis','confirmat'].includes(t.status) && (
            <div style={{display:'flex',gap:8}}>
              <input type="text" value={comText} onChange={e=>setComText(e.target.value)} onKeyDown={e=>{ if(e.key==='Enter') addComentariu() }}
                     placeholder="Scrie comentariu..."
                     style={{flex:1,padding:'10px 14px',background:G.bg,border:`1px solid ${G.border2}`,borderRadius:8,color:G.text,fontSize:13}} />
              <button onClick={addComentariu} disabled={saving || !comText.trim()}
                      style={{padding:'10px 18px',background:G.blue,color:'#fff',border:0,borderRadius:8,fontSize:13,fontWeight:600,cursor:saving?'wait':'pointer',opacity:!comText.trim()?0.5:1}}>
                Trimite
              </button>
            </div>
          )}
        </div>
      )}

      {/* Action buttons în footer */}
      <div style={{display:'flex',gap:8,marginTop:18,paddingTop:14,borderTop:`1px solid ${G.border}`,flexWrap:'wrap'}}>
        {/* ═══════ RAMURA LOGISTICA — workflow specific Analiză/Service/Reparat ═══════ */}
        {isLogistica && t.status === 'deschis' && (
          <>
            <button onClick={()=>setShowAnaliza(true)} style={btnPrimary(G.blue)}>🔍 Trimite în analiză</button>
            <button onClick={()=>setShowProgramareService(true)} style={btnPrimary(G.purple)}>📅 Programare service</button>
            <button onClick={()=>{ const m=prompt('Motiv respingere:'); if(m) changeStatus('respins', { atribuit_de:profile.id, data_atribuire:new Date().toISOString(), motiv_respingere:m }) }} style={btnSecondary(G.red)}>❌ Respinge</button>
          </>
        )}
        {isLogistica && t.status === 'in_analiza' && (
          <>
            <button onClick={()=>setShowIntrareService(true)} style={btnPrimary(G.yellow)}>🔧 Trimite la service</button>
            <button onClick={()=>{ const m=prompt('Motiv respingere (după analiză):'); if(m) changeStatus('respins', { motiv_respingere:m }) }} style={btnSecondary(G.red)}>❌ Respinge după analiză</button>
          </>
        )}
        {isLogistica && t.status === 'programat_service' && (
          <>
            <button onClick={()=>setShowIntrareService(true)} style={btnPrimary(G.yellow)}>✅ Confirmă intrare în service</button>
            <button onClick={()=>{ if(confirm('Anulezi programarea? Tichetul revine la "Deschis".')) changeStatus('deschis', { data_programare_service:null, service_partener_id:null }) }} style={btnSecondary(G.muted)}>↩ Anulează programarea</button>
          </>
        )}
        {isLogistica && t.status === 'in_service' && (
          <button onClick={()=>setShowReparat(true)} style={btnPrimary(G.green)}>✅ Marchează reparat</button>
        )}
        {isLogistica && t.status === 'reparat' && isMine && (
          <>
            <button onClick={()=>changeStatus('inchis', { confirmat_de:profile.id, data_confirmare:new Date().toISOString() })} style={btnPrimary(G.purple)}>🎉 Confirm reparat - închide tichet</button>
            <button onClick={()=>{ const m=prompt('Motiv (de ce nu e reparat?):'); if(m) changeStatus('in_service', { motiv_respingere:m }) }} style={btnSecondary(G.red)}>↩ Retrimite în service</button>
          </>
        )}
        {isLogistica && t.status === 'reparat' && !isMine && (
          <div style={{fontSize:13, color:G.muted, fontStyle:'italic', padding:'8px 0'}}>
            ⏳ Așteaptă confirmarea de la {deschisDe?.name || 'creator'}
          </div>
        )}

        {/* ═══════ RAMURA GENERICĂ — alte departamente ═══════ */}
        {!isLogistica && t.status === 'deschis' && (
          <button onClick={()=>setShowAtribuie(true)} style={btnPrimary(G.orange)}>➡️ Atribuie</button>
        )}
        {!isLogistica && (t.status === 'atribuit' || t.status === 'in_lucru') && (
          <>
            {t.status === 'atribuit' && <button onClick={()=>changeStatus('in_lucru')} style={btnPrimary(G.yellow)}>🔧 Incepe lucrul</button>}
            <button onClick={()=>setShowRezolva(true)} style={btnPrimary(G.green)}>✅ Marcheaza rezolvat</button>
          </>
        )}
        {!isLogistica && t.status === 'rezolvat' && isMine && (
          <>
            <button onClick={()=>changeStatus('confirmat', { confirmat_de:profile.id, data_confirmare:new Date().toISOString() })} style={btnPrimary(G.purple)}>🎉 Confirm rezolvat</button>
            <button onClick={()=>{ const m=prompt('Motiv respingere:'); if(m) changeStatus('respins', { confirmat_de:profile.id, data_confirmare:new Date().toISOString(), motiv_respingere:m }) }} style={btnSecondary(G.red)}>❌ Respinge</button>
          </>
        )}
        {!isLogistica && (t.status === 'confirmat' || t.status === 'respins') && isOwner && (
          <button onClick={()=>changeStatus('inchis')} style={btnPrimary(G.muted)}>🔒 Inchide</button>
        )}
        {/* Tichet Logistica cu status GENERIC (atribuit/in_lucru) — ex: GPS, INEL, alte sarcini non-service */}
        {isLogistica && (t.status === 'atribuit' || t.status === 'in_lucru') && (
          <>
            {t.status === 'atribuit' && <button onClick={()=>changeStatus('in_lucru')} style={btnPrimary(G.yellow)}>🔧 Incepe lucrul</button>}
            <button onClick={()=>setShowRezolva(true)} style={btnPrimary(G.green)}>✅ Marcheaza rezolvat</button>
          </>
        )}
        {isLogistica && t.status === 'rezolvat' && isMine && (
          <>
            <button onClick={()=>changeStatus('confirmat', { confirmat_de:profile.id, data_confirmare:new Date().toISOString() })} style={btnPrimary(G.purple)}>🎉 Confirm rezolvat</button>
            <button onClick={()=>{ const m=prompt('Motiv respingere:'); if(m) changeStatus('respins', { confirmat_de:profile.id, data_confirmare:new Date().toISOString(), motiv_respingere:m }) }} style={btnSecondary(G.red)}>❌ Respinge</button>
          </>
        )}
        {isLogistica && (t.status === 'confirmat' || t.status === 'respins') && isOwner && (
          <button onClick={()=>changeStatus('inchis')} style={btnPrimary(G.muted)}>🔒 Inchide</button>
        )}

        <div style={{flex:1}} />
        {isOwner && onDelete && (
          <button onClick={()=>onDelete(t)} 
                  title="Șterge tichet permanent (doar owner)"
                  style={{padding:'10px 16px',background:'transparent',color:G.red,border:`1px solid ${G.red}66`,borderRadius:8,fontSize:13,fontWeight:600,cursor:'pointer'}}>
            🗑 Șterge tichet
          </button>
        )}
        <button onClick={onClose} style={btnSecondary(G.muted)}>Inchide</button>
      </div>

      {/* Sub-modale */}
      {showAtribuie && (
        <AtribuieModal tichet={t} profile={profile} profiles={profiles} onClose={()=>setShowAtribuie(false)}
                       onSaved={(data)=>{ setShowAtribuie(false); changeStatus('atribuit', { ...data, atribuit_de:profile.id, data_atribuire:new Date().toISOString() }) }} />
      )}
      {showRezolva && (
        <RezolvaModal tichet={t} profile={profile} onClose={()=>setShowRezolva(false)}
                      onSaved={(data)=>{ setShowRezolva(false); changeStatus('rezolvat', { ...data, rezolvat_de:profile.id, data_rezolvare:new Date().toISOString() }) }} />
      )}
      {showAnaliza && (
        <AnalizaModal tichet={t} profile={profile} onClose={()=>setShowAnaliza(false)}
                      onSaved={(nota)=>{
                        setShowAnaliza(false)
                        changeStatus('in_analiza', {
                          atribuit_de: profile.id,
                          data_atribuire: new Date().toISOString(),
                          ...(nota ? { observatii: (t.observatii ? t.observatii + '\n---\n' : '') + 'Analiză inițiată: ' + nota } : {})
                        })
                      }} />
      )}
      {showProgramareService && (
        <ProgramareServiceModal tichet={t} profile={profile} serviceParteneri={serviceParteneri}
          onClose={()=>setShowProgramareService(false)}
          onPartenerNou={async(nume)=>{
            // Insert partener nou + reload
            const { data, error } = await supabase.from('logistica_service_parteneri').insert({ nume, activ:true }).select().single()
            if(error){ show('Eroare adăugare partener: '+error.message,'error'); return null }
            show('Partener adăugat: '+nume,'success')
            return data
          }}
          onSaved={(data)=>{ setShowProgramareService(false); changeStatus('programat_service', { ...data, atribuit_de:profile.id, data_atribuire:new Date().toISOString() }) }} />
      )}
      {showIntrareService && (
        <IntrareServiceModal tichet={t} profile={profile} serviceParteneri={serviceParteneri}
          onClose={()=>setShowIntrareService(false)}
          onPartenerNou={async(nume)=>{
            const { data, error } = await supabase.from('logistica_service_parteneri').insert({ nume, activ:true }).select().single()
            if(error){ show('Eroare adăugare partener: '+error.message,'error'); return null }
            show('Partener adăugat: '+nume,'success')
            return data
          }}
          onSaved={(data)=>{ setShowIntrareService(false); changeStatus('in_service', { ...data, atribuit_de: t.atribuit_de || profile.id, data_atribuire: t.data_atribuire || new Date().toISOString() }) }} />
      )}
      {showReparat && (
        <ReparatModal tichet={t} profile={profile} onClose={()=>setShowReparat(false)}
                      onSaved={(data)=>{ setShowReparat(false); changeStatus('reparat', { ...data, rezolvat_de:profile.id, data_rezolvare:new Date().toISOString() }) }} />
      )}
    </Modal>
  )
}

// ────────── Sub-modal Atribuie ──────────
function AtribuieModal({ tichet, profile, profiles, onClose, onSaved }){
  const [tip, setTip] = useState('intern')
  const [responsabil, setResponsabil] = useState('')
  const [firma, setFirma] = useState('')
  return (
    <Modal onClose={onClose} title="➡️ Atribuie tichet" width={460}>
      <div style={{display:'flex',flexDirection:'column',gap:12}}>
        <div style={{display:'flex',gap:8}}>
          <button onClick={()=>setTip('intern')} style={{flex:1,padding:'12px',background:tip==='intern'?G.blue+'22':G.bg,border:`1px solid ${tip==='intern'?G.blue:G.border2}`,borderRadius:8,color:tip==='intern'?G.blue:G.text,fontWeight:600,cursor:'pointer'}}>👤 Intern (un coleg)</button>
          <button onClick={()=>setTip('extern')} style={{flex:1,padding:'12px',background:tip==='extern'?G.orange+'22':G.bg,border:`1px solid ${tip==='extern'?G.orange:G.border2}`,borderRadius:8,color:tip==='extern'?G.orange:G.text,fontWeight:600,cursor:'pointer'}}>🏢 Extern (firma)</button>
        </div>
        {tip === 'intern' ? (
          <div>
            <label style={{fontSize:12,color:G.muted,marginBottom:6,display:'block'}}>Coleg responsabil</label>
            <select value={responsabil} onChange={e=>setResponsabil(e.target.value)} style={{width:'100%',padding:'10px',background:G.bg,border:`1px solid ${G.border2}`,borderRadius:8,color:G.text}}>
              <option value="">-- Alege --</option>
              {profiles.map(p=>(<option key={p.id} value={p.id}>{p.name}</option>))}
            </select>
          </div>
        ) : (
          <div>
            <label style={{fontSize:12,color:G.muted,marginBottom:6,display:'block'}}>Nume firma externa</label>
            <input type="text" value={firma} onChange={e=>setFirma(e.target.value)} placeholder="Ex: Renomar Construct SRL"
                   style={{width:'100%',padding:'10px',background:G.bg,border:`1px solid ${G.border2}`,borderRadius:8,color:G.text}} />
          </div>
        )}
        <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:10}}>
          <button onClick={onClose} style={btnSecondary(G.muted)}>Anuleaza</button>
          <button onClick={()=>onSaved(tip==='intern' ? { asignat_la:'intern', persoana_responsabila:responsabil, firma_externa:null } : { asignat_la:'extern', firma_externa:firma, persoana_responsabila:null })}
                  disabled={tip==='intern' ? !responsabil : !firma.trim()}
                  style={btnPrimary(G.blue)}>Atribuie</button>
        </div>
      </div>
    </Modal>
  )
}

// ────────── Sub-modal Rezolva ──────────
function RezolvaModal({ tichet, profile, onClose, onSaved }){
  const [form, setForm] = useState({ descriere_interventie:'', piese_schimbate:'', durata_ore:'', cost:'' })
  return (
    <Modal onClose={onClose} title="✅ Marcheaza rezolvat" width={500}>
      <div style={{display:'flex',flexDirection:'column',gap:12}}>
        <div>
          <label style={{fontSize:12,color:G.muted,marginBottom:6,display:'block'}}>Descriere interventie *</label>
          <textarea value={form.descriere_interventie} onChange={e=>setForm({...form,descriere_interventie:e.target.value})} rows={3}
                    placeholder="Ce s-a facut, cum s-a rezolvat..."
                    style={{width:'100%',padding:'10px',background:G.bg,border:`1px solid ${G.border2}`,borderRadius:8,color:G.text,fontFamily:'inherit',resize:'vertical'}} />
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
          <div>
            <label style={{fontSize:12,color:G.muted,marginBottom:6,display:'block'}}>Durata (ore)</label>
            <input type="number" step="0.5" value={form.durata_ore} onChange={e=>setForm({...form,durata_ore:e.target.value})}
                   style={{width:'100%',padding:'10px',background:G.bg,border:`1px solid ${G.border2}`,borderRadius:8,color:G.text}} />
          </div>
          <div>
            <label style={{fontSize:12,color:G.muted,marginBottom:6,display:'block'}}>Cost (lei)</label>
            <input type="number" step="0.01" value={form.cost} onChange={e=>setForm({...form,cost:e.target.value})}
                   style={{width:'100%',padding:'10px',background:G.bg,border:`1px solid ${G.border2}`,borderRadius:8,color:G.text}} />
          </div>
        </div>
        <div>
          <label style={{fontSize:12,color:G.muted,marginBottom:6,display:'block'}}>Piese schimbate (opt)</label>
          <input type="text" value={form.piese_schimbate} onChange={e=>setForm({...form,piese_schimbate:e.target.value})}
                 placeholder="Ex: alternator, baterie, ulei..."
                 style={{width:'100%',padding:'10px',background:G.bg,border:`1px solid ${G.border2}`,borderRadius:8,color:G.text}} />
        </div>
        <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:10}}>
          <button onClick={onClose} style={btnSecondary(G.muted)}>Anuleaza</button>
          <button onClick={()=>onSaved({
            descriere_interventie: form.descriere_interventie.trim(),
            piese_schimbate: form.piese_schimbate.trim() || null,
            durata_ore: form.durata_ore ? Number(form.durata_ore) : null,
            cost: form.cost ? Number(form.cost) : null
          })} disabled={!form.descriere_interventie.trim()} style={btnPrimary(G.green)}>✅ Marcheaza rezolvat</button>
        </div>
      </div>
    </Modal>
  )
}

// ════════════════════════════════════════════════════════════════
// COMPONENTĂ HELPER — combobox service partener cu „+Partener nou"
// ════════════════════════════════════════════════════════════════
function PartenerCombobox({ value, onChange, parteneri, onPartenerNou, label = 'Service partener' }){
  const [adding, setAdding] = useState(false)
  const [numeNou, setNumeNou] = useState('')
  
  return (
    <div>
      <label style={{fontSize:13,color:G.muted,marginBottom:6,display:'block',fontWeight:600}}>{label}</label>
      {!adding ? (
        <div style={{display:'flex',gap:8}}>
          <select value={value || ''} onChange={e=>onChange(e.target.value ? Number(e.target.value) : null)}
                  style={{flex:1,padding:'11px 14px',background:G.bg,border:`1px solid ${G.border2}`,borderRadius:8,color:G.text,fontSize:15}}>
            <option value="">-- Alege --</option>
            {parteneri.map(p=>(
              <option key={p.id} value={p.id}>{p.nume}</option>
            ))}
          </select>
          <button type="button" onClick={()=>setAdding(true)} 
                  style={{padding:'11px 14px',background:'transparent',color:G.blue,border:`1px dashed ${G.blue}66`,borderRadius:8,fontSize:13,cursor:'pointer',fontWeight:600,whiteSpace:'nowrap'}}>
            + Partener nou
          </button>
        </div>
      ) : (
        <div style={{display:'flex',gap:8}}>
          <input type="text" value={numeNou} onChange={e=>setNumeNou(e.target.value)} 
                 placeholder="Nume firmă service (ex: SC AUTO STAR SRL)"
                 autoFocus
                 style={{flex:1,padding:'11px 14px',background:G.bg,border:`1px solid ${G.blue}`,borderRadius:8,color:G.text,fontSize:15}} />
          <button type="button" onClick={async()=>{
            if(!numeNou.trim()) return
            const created = await onPartenerNou(numeNou.trim())
            if(created){
              onChange(created.id)
              setNumeNou('')
              setAdding(false)
            }
          }} disabled={!numeNou.trim()} style={btnPrimary(G.green)}>✓ Salvează</button>
          <button type="button" onClick={()=>{ setAdding(false); setNumeNou('') }} style={btnSecondary(G.muted)}>Anulează</button>
        </div>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// SUB-MODAL Analiza — trecere la in_analiza (notă opțională)
// ════════════════════════════════════════════════════════════════
function AnalizaModal({ tichet, profile, onClose, onSaved }){
  const [nota, setNota] = useState('')
  return (
    <Modal onClose={onClose} title="🔍 Trimite în analiză" width={500}>
      <div style={{display:'flex',flexDirection:'column',gap:14}}>
        <div style={{padding:12,background:G.blue+'15',border:`1px solid ${G.blue}44`,borderRadius:8,fontSize:13,color:G.text}}>
          ℹ️ Ticket-ul intră în analiză. Sistemul te avertizează după 3 zile dacă rămâne în această stare.
          Apoi treci la <strong>Trimite la service</strong> sau respingi.
        </div>
        <div>
          <label style={{fontSize:13,color:G.muted,marginBottom:6,display:'block',fontWeight:600}}>Notă inițială (opțional)</label>
          <textarea value={nota} onChange={e=>setNota(e.target.value)} rows={3}
                    placeholder="Ex: trebuie verificat pe stand, suspectez baterie..."
                    style={{width:'100%',padding:'11px 14px',background:G.bg,border:`1px solid ${G.border2}`,borderRadius:8,color:G.text,fontSize:15,fontFamily:'inherit',resize:'vertical'}} />
        </div>
        <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:8}}>
          <button onClick={onClose} style={btnSecondary(G.muted)}>Anulează</button>
          <button onClick={()=>onSaved(nota.trim())} style={btnPrimary(G.blue)}>🔍 Trimite în analiză</button>
        </div>
      </div>
    </Modal>
  )
}

// ════════════════════════════════════════════════════════════════
// SUB-MODAL Programare Service — data + partener
// ════════════════════════════════════════════════════════════════
function ProgramareServiceModal({ tichet, profile, serviceParteneri, onClose, onPartenerNou, onSaved }){
  const [dataProgramare, setDataProgramare] = useState('')
  const [partenerId, setPartenerId] = useState(null)
  const [firmaTextLiber, setFirmaTextLiber] = useState('')
  const [useTextLiber, setUseTextLiber] = useState(false)
  
  const canSave = dataProgramare && (useTextLiber ? firmaTextLiber.trim() : partenerId)
  
  return (
    <Modal onClose={onClose} title="📅 Programare service" width={540}>
      <div style={{display:'flex',flexDirection:'column',gap:14}}>
        <div style={{padding:12,background:G.purple+'15',border:`1px solid ${G.purple}44`,borderRadius:8,fontSize:13,color:G.text}}>
          ℹ️ Setezi data la care utilajul/auto-ul va intra în service. Când ajunge data, treci la <strong>Confirmă intrare în service</strong>.
        </div>
        
        <div>
          <label style={{fontSize:13,color:G.muted,marginBottom:6,display:'block',fontWeight:600}}>Data programare service *</label>
          <input type="date" value={dataProgramare} onChange={e=>setDataProgramare(e.target.value)}
                 min={new Date().toISOString().slice(0,10)}
                 style={{width:'100%',padding:'11px 14px',background:G.bg,border:`1px solid ${G.border2}`,borderRadius:8,color:G.text,fontSize:15}} />
        </div>
        
        {!useTextLiber ? (
          <>
            <PartenerCombobox value={partenerId} onChange={setPartenerId} parteneri={serviceParteneri} 
                              onPartenerNou={onPartenerNou} label="Service partener *" />
            <button type="button" onClick={()=>setUseTextLiber(true)} 
                    style={{alignSelf:'flex-start',padding:'6px 12px',background:'transparent',color:G.muted,border:0,fontSize:12,cursor:'pointer',textDecoration:'underline'}}>
              sau scrie firmă (text liber)
            </button>
          </>
        ) : (
          <>
            <div>
              <label style={{fontSize:13,color:G.muted,marginBottom:6,display:'block',fontWeight:600}}>Firmă service (text liber) *</label>
              <input type="text" value={firmaTextLiber} onChange={e=>setFirmaTextLiber(e.target.value)}
                     placeholder="Nume firmă service"
                     style={{width:'100%',padding:'11px 14px',background:G.bg,border:`1px solid ${G.border2}`,borderRadius:8,color:G.text,fontSize:15}} />
            </div>
            <button type="button" onClick={()=>{ setUseTextLiber(false); setFirmaTextLiber('') }}
                    style={{alignSelf:'flex-start',padding:'6px 12px',background:'transparent',color:G.muted,border:0,fontSize:12,cursor:'pointer',textDecoration:'underline'}}>
              ← înapoi la listă parteneri
            </button>
          </>
        )}
        
        <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:8}}>
          <button onClick={onClose} style={btnSecondary(G.muted)}>Anulează</button>
          <button onClick={()=>onSaved({
            data_programare_service: dataProgramare,
            service_partener_id: useTextLiber ? null : partenerId,
            firma_externa: useTextLiber ? firmaTextLiber.trim() : null,
            asignat_la: 'extern'
          })} disabled={!canSave} style={btnPrimary(G.purple)}>📅 Programează</button>
        </div>
      </div>
    </Modal>
  )
}

// ════════════════════════════════════════════════════════════════
// SUB-MODAL Intrare Service — data intrare + partener + estimată reparație
// ════════════════════════════════════════════════════════════════
function IntrareServiceModal({ tichet, profile, serviceParteneri, onClose, onPartenerNou, onSaved }){
  const [dataIntrare, setDataIntrare] = useState(new Date().toISOString().slice(0,10))
  const [dataEstimata, setDataEstimata] = useState('')
  const [partenerId, setPartenerId] = useState(tichet.service_partener_id || null)
  const [firmaTextLiber, setFirmaTextLiber] = useState(tichet.firma_externa || '')
  const [useTextLiber, setUseTextLiber] = useState(!tichet.service_partener_id && !!tichet.firma_externa)
  
  const canSave = dataIntrare && dataEstimata && (useTextLiber ? firmaTextLiber.trim() : partenerId)
  
  return (
    <Modal onClose={onClose} title="🔧 Intrare în service" width={560}>
      <div style={{display:'flex',flexDirection:'column',gap:14}}>
        <div style={{padding:12,background:G.yellow+'15',border:`1px solid ${G.yellow}44`,borderRadius:8,fontSize:13,color:G.text}}>
          ℹ️ Confirmi că utilajul/auto-ul a intrat efectiv în service. Sistemul te avertizează când e cu 5+ zile peste data estimată.
        </div>
        
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
          <div>
            <label style={{fontSize:13,color:G.muted,marginBottom:6,display:'block',fontWeight:600}}>Data intrare *</label>
            <input type="date" value={dataIntrare} onChange={e=>setDataIntrare(e.target.value)}
                   style={{width:'100%',padding:'11px 14px',background:G.bg,border:`1px solid ${G.border2}`,borderRadius:8,color:G.text,fontSize:15}} />
          </div>
          <div>
            <label style={{fontSize:13,color:G.muted,marginBottom:6,display:'block',fontWeight:600}}>Data estimată reparație *</label>
            <input type="date" value={dataEstimata} onChange={e=>setDataEstimata(e.target.value)}
                   min={dataIntrare || new Date().toISOString().slice(0,10)}
                   style={{width:'100%',padding:'11px 14px',background:G.bg,border:`1px solid ${G.border2}`,borderRadius:8,color:G.text,fontSize:15}} />
          </div>
        </div>
        
        {!useTextLiber ? (
          <>
            <PartenerCombobox value={partenerId} onChange={setPartenerId} parteneri={serviceParteneri} 
                              onPartenerNou={onPartenerNou} label="Service partener *" />
            <button type="button" onClick={()=>setUseTextLiber(true)} 
                    style={{alignSelf:'flex-start',padding:'6px 12px',background:'transparent',color:G.muted,border:0,fontSize:12,cursor:'pointer',textDecoration:'underline'}}>
              sau scrie firmă (text liber)
            </button>
          </>
        ) : (
          <>
            <div>
              <label style={{fontSize:13,color:G.muted,marginBottom:6,display:'block',fontWeight:600}}>Firmă service (text liber) *</label>
              <input type="text" value={firmaTextLiber} onChange={e=>setFirmaTextLiber(e.target.value)}
                     placeholder="Nume firmă service"
                     style={{width:'100%',padding:'11px 14px',background:G.bg,border:`1px solid ${G.border2}`,borderRadius:8,color:G.text,fontSize:15}} />
            </div>
            <button type="button" onClick={()=>{ setUseTextLiber(false); setFirmaTextLiber('') }}
                    style={{alignSelf:'flex-start',padding:'6px 12px',background:'transparent',color:G.muted,border:0,fontSize:12,cursor:'pointer',textDecoration:'underline'}}>
              ← înapoi la listă parteneri
            </button>
          </>
        )}
        
        <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:8}}>
          <button onClick={onClose} style={btnSecondary(G.muted)}>Anulează</button>
          <button onClick={()=>onSaved({
            data_intrare_service: dataIntrare,
            data_estimata_reparatie: dataEstimata,
            service_partener_id: useTextLiber ? null : partenerId,
            firma_externa: useTextLiber ? firmaTextLiber.trim() : null,
            asignat_la: 'extern'
          })} disabled={!canSave} style={btnPrimary(G.yellow)}>🔧 Confirmă intrare</button>
        </div>
      </div>
    </Modal>
  )
}

// ════════════════════════════════════════════════════════════════
// SUB-MODAL Reparat — descriere intervenție + piese + cost + durată
// ════════════════════════════════════════════════════════════════
function ReparatModal({ tichet, profile, onClose, onSaved }){
  const [form, setForm] = useState({ descriere_interventie:'', piese_schimbate:'', durata_ore:'', cost:'' })
  return (
    <Modal onClose={onClose} title="✅ Marchează reparat" width={540}>
      <div style={{display:'flex',flexDirection:'column',gap:14}}>
        <div style={{padding:12,background:G.green+'15',border:`1px solid ${G.green}44`,borderRadius:8,fontSize:13,color:G.text}}>
          ℹ️ Service-ul confirmă că s-a finalizat reparația. Creator-ul ({tichet.deschis_de ? 'cel care a deschis ticket-ul' : 'creator'}) va fi notificat pentru confirmare.
        </div>
        
        <div>
          <label style={{fontSize:13,color:G.muted,marginBottom:6,display:'block',fontWeight:600}}>Descriere intervenție *</label>
          <textarea value={form.descriere_interventie} onChange={e=>setForm({...form,descriere_interventie:e.target.value})} rows={3}
                    placeholder="Ce s-a făcut, cum s-a rezolvat..."
                    style={{width:'100%',padding:'11px 14px',background:G.bg,border:`1px solid ${G.border2}`,borderRadius:8,color:G.text,fontSize:15,fontFamily:'inherit',resize:'vertical'}} />
        </div>
        <div>
          <label style={{fontSize:13,color:G.muted,marginBottom:6,display:'block',fontWeight:600}}>Piese schimbate (opt)</label>
          <input type="text" value={form.piese_schimbate} onChange={e=>setForm({...form,piese_schimbate:e.target.value})}
                 placeholder="Ex: alternator, baterie, ulei..."
                 style={{width:'100%',padding:'11px 14px',background:G.bg,border:`1px solid ${G.border2}`,borderRadius:8,color:G.text,fontSize:15}} />
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
          <div>
            <label style={{fontSize:13,color:G.muted,marginBottom:6,display:'block',fontWeight:600}}>Durată (ore)</label>
            <input type="number" step="0.5" value={form.durata_ore} onChange={e=>setForm({...form,durata_ore:e.target.value})}
                   style={{width:'100%',padding:'11px 14px',background:G.bg,border:`1px solid ${G.border2}`,borderRadius:8,color:G.text,fontSize:15}} />
          </div>
          <div>
            <label style={{fontSize:13,color:G.muted,marginBottom:6,display:'block',fontWeight:600}}>Cost (lei)</label>
            <input type="number" step="0.01" value={form.cost} onChange={e=>setForm({...form,cost:e.target.value})}
                   style={{width:'100%',padding:'11px 14px',background:G.bg,border:`1px solid ${G.border2}`,borderRadius:8,color:G.text,fontSize:15}} />
          </div>
        </div>
        
        <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:8}}>
          <button onClick={onClose} style={btnSecondary(G.muted)}>Anulează</button>
          <button onClick={()=>onSaved({
            descriere_interventie: form.descriere_interventie.trim(),
            piese_schimbate: form.piese_schimbate.trim() || null,
            durata_ore: form.durata_ore ? Number(form.durata_ore) : null,
            cost: form.cost ? Number(form.cost) : null
          })} disabled={!form.descriere_interventie.trim()} style={btnPrimary(G.green)}>✅ Marchează reparat</button>
        </div>
      </div>
    </Modal>
  )
}

// ════════════════════════════════════════════════════════════════
// MODAL GENERIC
// ════════════════════════════════════════════════════════════════
function Modal({ children, onClose, title, width = 600, noTitleBar = false }){
  return (
    <div onClick={onClose} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.7)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:9000,padding:20}}>
      <div onClick={e=>e.stopPropagation()} style={{background:G.surface,border:`1px solid ${G.border2}`,borderRadius:12,padding:20,width:'100%',maxWidth:width,maxHeight:'90vh',overflowY:'auto',color:G.text,boxShadow:'0 10px 40px rgba(0,0,0,0.5)'}}>
        {!noTitleBar && title && (
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
            <h2 style={{margin:0,fontSize:18,color:G.text,fontWeight:700}}>{title}</h2>
            <button onClick={onClose} style={{padding:6,background:'transparent',color:G.muted,border:`1px solid ${G.border2}`,borderRadius:6,cursor:'pointer',fontSize:18,lineHeight:1,width:32,height:32}}>×</button>
          </div>
        )}
        {children}
      </div>
    </div>
  )
}

// Stiluri butoane
const btnPrimary = (color) => ({padding:'10px 16px',background:color,color:'#fff',border:0,borderRadius:8,fontSize:13,fontWeight:700,cursor:'pointer'})
const btnSecondary = (color) => ({padding:'10px 16px',background:'transparent',color:color,border:`1px solid ${color}66`,borderRadius:8,fontSize:13,fontWeight:600,cursor:'pointer'})
