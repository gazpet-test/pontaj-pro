import { useState, useEffect, useCallback, createContext, useContext, useRef } from 'react'
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { supabase } from './lib/supabase.js'
import * as XLSX from 'xlsx-js-style'
import LOGO_B64 from './logo.js'

const AuthContext = createContext(null)
const useAuth = () => useContext(AuthContext)

function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined)
  const [profile, setProfile] = useState(null)
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => { setSession(session); if (session) fetchProfile(session.user.id) })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => { setSession(session); if (session) fetchProfile(session.user.id); else setProfile(null) })
    return () => subscription.unsubscribe()
  }, [])
  const fetchProfile = async (userId) => {
    try {
      const { data } = await supabase.from('profiles').select('*').eq('id', userId).single()
      if (data) {
        // Load all sites for this manager
        const { data: ps } = await supabase.from('profile_sites').select('site_id').eq('profile_id', userId)
        data.site_ids = (ps || []).map(x => x.site_id)
        setProfile(data)
      } else {
        setTimeout(async () => {
          const { data: d2 } = await supabase.from('profiles').select('*').eq('id', userId).single()
          if (d2) {
            const { data: ps } = await supabase.from('profile_sites').select('site_id').eq('profile_id', userId)
            d2.site_ids = (ps || []).map(x => x.site_id)
            setProfile(d2)
          }
        }, 1000)
      }
    } catch (e) { console.error(e) }
  }
  const signIn = (email, password) => supabase.auth.signInWithPassword({ email, password })
  const signOut = () => supabase.auth.signOut()
  return <AuthContext.Provider value={{ session, profile, signIn, signOut, fetchProfile }}>{children}</AuthContext.Provider>
}

function ProtectedRoute({ children, adminOnly = false, salaryAccess = false }) {
  const { session, profile } = useAuth()
  if (session === undefined) return <LoadingScreen />
  if (!session) return <Navigate to="/login" replace />
  if (adminOnly && !['admin','superadmin'].includes(profile?.role)) return <Navigate to="/" replace />
  if (salaryAccess && !['superadmin','contabil'].includes(profile?.role)) return <Navigate to="/" replace />
  return children
}

// ─── Constants ────────────────────────────────────────────────────────────────
const DEPARTMENTS = ['Execuție', 'Logistică', 'TESA']
const NORME = ['BO','BP','AM','CO','CFP','CM','M','O','N','PRM','PRB','LL']
const NORME_LABELS = { BO:'Boală Obișnuită', BP:'Boală Profesională', AM:'Accident de Muncă', CO:'Concediu Odihnă', CFP:'Concediu Fără Plată', CM:'Concediu Medical', M:'Maternitate', O:'Obligații Cetățenești', N:'Absențe Nemotivate', PRM:'Prog.Redus Maternitate', PRB:'Prog.Redus Boală', LL:'Liber Legal' }
const LUNCH_START = 12; const LUNCH_END = 13; const LUNCH_MINS = 60
const todayStr = () => new Date().toISOString().split('T')[0]
const fmt24 = (ts) => ts ? new Date(ts).toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit', hour12: false }) : '—'
const diffMins = (a, b) => a && b ? Math.max(0, Math.floor((new Date(b) - new Date(a)) / 60000)) : 0
const minsToHM = (m) => { const mm = Math.abs(m); return `${Math.floor(mm/60)}h${mm%60>0?' '+mm%60+'m':''}` }
const spansLunch = (ci, co) => { if (!ci||!co) return false; const a=new Date(ci),b=new Date(co),d=a.toDateString(); return a<=new Date(`${d} 12:00:00`)&&b>=new Date(`${d} 13:00:00`) }
const netMins = (ci, co, lb) => { const g=diffMins(ci,co); return g ? Math.max(0,g-(lb&&spansLunch(ci,co)?LUNCH_MINS:0)):0 }
const dateToISO = (date, time) => time ? new Date(`${date}T${time}:00`).toISOString() : null

const G = { bg:'#0D1117',surface:'#161B22',border:'#21262D',border2:'#30363D',text:'#E6EDF3',muted:'#8B949E',dim:'#6E7681',blue:'#58A6FF',green:'#3FB950',red:'#F85149',yellow:'#D29922',purple:'#BC8CFF',orange:'#F0883E',greenDim:'#1A3A1A',redDim:'#3A1A1A',yellowDim:'#3A2A0A' }
const S = {
  page: { fontFamily:"'Syne','Barlow',sans-serif",background:G.bg,minHeight:'100vh',color:G.text },
  card: { background:G.surface,border:`1px solid ${G.border}`,borderRadius:12 },
  input: { background:G.bg,border:`1px solid ${G.border2}`,color:G.text,borderRadius:8,padding:'8px 12px',fontFamily:'inherit',fontSize:15,outline:'none',width:'100%' },
  btnP: { background:'#1F6FEB',color:'white',border:'none',borderRadius:8,padding:'9px 18px',fontFamily:'inherit',fontSize:15,fontWeight:700,cursor:'pointer' },
  btnS: { background:G.surface,color:G.text,border:`1px solid ${G.border}`,borderRadius:8,padding:'7px 14px',fontFamily:'inherit',fontSize:14,fontWeight:600,cursor:'pointer' },
}
const css = `
@import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=Barlow:wght@300;400;500;600&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
::-webkit-scrollbar{width:5px}::-webkit-scrollbar-track{background:#161B22}::-webkit-scrollbar-thumb{background:#30363D;border-radius:3px}
input:focus,select:focus{border-color:#1F6FEB!important;box-shadow:0 0 0 3px #1F6FEB22}
select{background:#0D1117;border:1px solid #30363D;color:#E6EDF3;border-radius:8px;padding:7px 11px;font-family:inherit;font-size:13px;outline:none}
table{width:100%;border-collapse:collapse}
th{text-align:left;padding:8px 12px;font-size:11px;font-weight:700;color:#8B949E;text-transform:uppercase;letter-spacing:.6px;border-bottom:1px solid #21262D}
td{padding:9px 12px;font-size:13px;border-bottom:1px solid #161B22;vertical-align:middle}
tr:last-child td{border-bottom:none}
tr:hover td{background:#1C2128}
.nl{background:none;border:none;cursor:pointer;padding:7px 13px;border-radius:8px;font-family:inherit;font-size:13px;font-weight:600;color:#8B949E;transition:all .2s}
.nl:hover,.nl.active{background:#21262D;color:#E6EDF3}
.nl.active{color:#58A6FF;background:#1F6FEB15}
.badge{display:inline-flex;align-items:center;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700}
.bd{background:#1F3A5A;color:#79C0FF}.bs{background:#2D1F4A;color:#BC8CFF}.ba{background:#2D1F4A;color:#BC8CFF}.bm{background:#1F3A2D;color:#56D364}
@keyframes fi{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
.fi{animation:fi .3s ease}
@keyframes sp{to{transform:rotate(360deg)}}
.sp{width:16px;height:16px;border:2px solid #30363D;border-top-color:#1F6FEB;border-radius:50%;animation:sp .7s linear infinite}
.toast{position:fixed;bottom:18px;right:18px;padding:10px 16px;border-radius:10px;font-size:13px;font-weight:600;z-index:9999;box-shadow:0 8px 32px rgba(0,0,0,.5);animation:fi .3s ease}
`

function Avatar({ name, id=1, size=34 }) {
  const hue = ((name?.charCodeAt(0)||0)*37+id*13)%360
  return <div style={{width:size,height:size,borderRadius:'50%',background:`hsl(${hue},50%,22%)`,color:`hsl(${hue},70%,72%)`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:size*.32,fontWeight:700,flexShrink:0}}>{name?.split(' ').map(n=>n[0]).join('').slice(0,2)||'?'}</div>
}
function Toast({ toast }) {
  if (!toast) return null
  const c={success:[G.greenDim,G.green],error:[G.redDim,G.red],warn:[G.yellowDim,G.yellow]}
  const [bg,col]=c[toast.type]||c.success
  return <div className="toast" style={{background:bg,color:col,border:`1px solid ${col}44`}}>{toast.msg}</div>
}
function useToast() {
  const [t,setT]=useState(null)
  const show=useCallback((msg,type='success')=>{setT({msg,type});setTimeout(()=>setT(null),3500)},[])
  return [t,show]
}
function LoadingScreen() {
  return <div style={{...S.page,display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:16}}><style>{css}</style><div className="sp" style={{width:34,height:34}}/><div style={{color:G.muted,fontSize:13}}>Se încarcă...</div></div>
}
function Lbl({children}) { return <label style={{fontSize:13,color:G.muted,fontWeight:700,textTransform:'uppercase',letterSpacing:'.5px',display:'block',marginBottom:5}}>{children}</label> }

// ─── Layout ───────────────────────────────────────────────────────────────────
function Layout({ children }) {
  const { profile, signOut } = useAuth()
  const nav = useNavigate(); const loc = useLocation()
  const [now, setNow] = useState(new Date())
  useEffect(()=>{ const t=setInterval(()=>setNow(new Date()),1000); return ()=>clearInterval(t) },[])
  const isAdmin = ['admin','superadmin'].includes(profile?.role)
  const isSuperAdmin = profile?.role==='superadmin'
  const isContabil = profile?.role==='contabil'
  const hasSalaryAccess = isSuperAdmin || isContabil
  const navItems = [
    {p:'/',i:'🏠',l:'Acasă'},
    {p:'/panou',i:'📊',l:'Panou'},
    {p:'/pontaj',i:'👥',l:'Pontaj'},
    {p:'/rapoarte',i:'📈',l:'Rapoarte'},
    ...(hasSalaryAccess?[{p:'/salarii',i:'💵',l:'Salarii'}]:[]),
    ...(isAdmin?[{p:'/admin',i:'⚙️',l:'Admin'}]:[]),
  ]
  return (
    <div style={S.page}><style>{css}</style>
      <div style={{background:G.surface,borderBottom:`1px solid ${G.border}`,padding:'0 22px',display:'flex',alignItems:'center',height:56,gap:18,position:'sticky',top:0,zIndex:100}}>
        <div style={{display:'flex',alignItems:'center',gap:9,marginRight:6}}>
          <div style={{width:28,height:28,background:'linear-gradient(135deg,#1F6FEB,#388BFD)',borderRadius:7,display:'flex',alignItems:'center',justifyContent:'center',fontSize:14}}>⏱</div>
          <span style={{fontWeight:800,fontSize:14,letterSpacing:'-.3px'}}>PontajPRO</span>
        </div>
        {navItems.map(x=><button key={x.p} className={`nl ${loc.pathname===x.p?'active':''}`} onClick={()=>nav(x.p)}>{x.i} {x.l}</button>)}
        <div style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:12}}>
          <div style={{textAlign:'right'}}>
            <div style={{fontSize:17,fontWeight:800,color:G.blue,fontVariantNumeric:'tabular-nums'}}>{now.toLocaleTimeString('ro-RO',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false})}</div>
            <div style={{fontSize:10,color:G.muted}}>{now.toLocaleDateString('ro-RO',{weekday:'short',day:'numeric',month:'short'})}</div>
          </div>
          <div style={{width:1,height:28,background:G.border}}/>
          <Avatar name={profile?.name} id={1} size={28}/>
          <div>
            <div style={{fontSize:12,fontWeight:600,lineHeight:1.3}}>{profile?.name||profile?.email?.split('@')[0]}</div>
            <span className={`badge ${isAdmin?'ba':profile?.role==='contabil'?'bs':'bm'}`}>{profile?.role==='superadmin'?'⭐ Super Admin':isAdmin?'⚙ Admin':profile?.role==='contabil'?'💵 Contabil':'👤 Manager'}</span>
          </div>
          <button className="nl" onClick={signOut} style={{color:G.red,padding:'5px 8px'}}>⎋</button>
        </div>
      </div>
      <div style={{padding:'22px 26px',maxWidth:1500,margin:'0 auto'}} className="fi">{children}</div>
      <div style={{textAlign:'center',padding:'12px',fontSize:12,color:'#E53935',fontWeight:700,borderTop:`1px solid ${G.border}`,marginTop:20,letterSpacing:'.3px'}}>
        Made by Trusu Razvan - Administrator Gazpet Instal
      </div>
    </div>
  )
}


// ─── Home Dashboard (Module Selector) ─────────────────────────────────────────
function HomeDashboard() {
  const { profile, signOut } = useAuth()
  const nav = useNavigate()
  const [now, setNow] = useState(new Date())
  useEffect(()=>{ const t=setInterval(()=>setNow(new Date()),1000); return ()=>clearInterval(t) },[])
  const isSuperAdmin = profile?.role==='superadmin'
  const isAdmin = ['admin','superadmin'].includes(profile?.role)
  const isContabil = profile?.role==='contabil'
  const hasSalaryAccess = isSuperAdmin || isContabil

  const modules = [
    { path:'/panou',    icon:'⏱',  label:'PontajPRO',   color:'#1F6FEB', desc:'Pontaj · Diurne · Salarii · ITM', active:true },
    { path:null,        icon:'💰', label:'Financiar',   color:'#2EA043', desc:'Facturi · Cash flow · Bugete',     active:false },
    { path:null,        icon:'🚛', label:'Logistică',   color:'#E3B341', desc:'Flotă · Combustibil · Trasee',     active:false },
    { path:null,        icon:'📦', label:'Comercial',   color:'#A371F7', desc:'Oferte · Contracte · CRM',         active:false },
    { path:null,        icon:'🏢', label:'Administrativ',color:'#F0883E',desc:'Documente · Furnizori · Ticketing',active:false },
    { path:null,        icon:'👥', label:'HR',           color:'#EC6CB9', desc:'Recrutare · Evaluări · Training',  active:false },
    { path:'/panou',    icon:'🏗️', label:'Execuție',    color:'#58A6FF', desc:'Șantiere · Devize · Vreme live',   active:false },
  ]

  return (
    <div style={{minHeight:'100vh',background:'#0D1117',display:'flex',flexDirection:'column'}}>
      <style>{css}</style>
      {/* Header */}
      <div style={{background:'#161B22',borderBottom:'1px solid #30363D',padding:'0 32px',height:60,display:'flex',alignItems:'center',gap:16,position:'sticky',top:0,zIndex:100}}>
        <div style={{display:'flex',alignItems:'center',gap:10,flex:1}}>
          <div style={{width:32,height:32,background:'linear-gradient(135deg,#1F6FEB,#388BFD)',borderRadius:8,display:'flex',alignItems:'center',justifyContent:'center',fontSize:16}}>⏱</div>
          <span style={{fontWeight:800,fontSize:16,letterSpacing:'-.3px',color:'#E6EDF3'}}>Gazpet</span>
          <span style={{fontWeight:300,fontSize:16,color:'#8B949E'}}>ERP</span>
        </div>
        <div style={{textAlign:'right',marginRight:16}}>
          <div style={{fontSize:18,fontWeight:800,color:'#58A6FF',fontVariantNumeric:'tabular-nums'}}>{now.toLocaleTimeString('ro-RO',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false})}</div>
          <div style={{fontSize:11,color:'#8B949E'}}>{now.toLocaleDateString('ro-RO',{weekday:'short',day:'numeric',month:'long',year:'numeric'})}</div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <Avatar name={profile?.name} id={1} size={32}/>
          <div>
            <div style={{fontSize:13,fontWeight:600,color:'#E6EDF3',lineHeight:1.3}}>{profile?.name||profile?.email?.split('@')[0]}</div>
            <span className={`badge ${isAdmin?'ba':profile?.role==='contabil'?'bs':'bm'}`}>{profile?.role==='superadmin'?'⭐ Super Admin':isAdmin?'⚙ Admin':profile?.role==='contabil'?'💵 Contabil':'👤 Manager'}</span>
          </div>
          <button onClick={signOut} style={{background:'transparent',border:'1px solid #30363D',color:'#8B949E',borderRadius:6,padding:'5px 12px',cursor:'pointer',fontSize:12,marginLeft:8}}>Ieșire</button>
        </div>
      </div>

      {/* Hero */}
      <div style={{textAlign:'center',padding:'52px 32px 32px'}}>
        <div style={{fontSize:28,fontWeight:800,color:'#E6EDF3',marginBottom:8,letterSpacing:'-.5px'}}>
          Bună{profile?.name?`, ${profile.name.split(' ')[0]}`:''}! 👋
        </div>
        <div style={{fontSize:15,color:'#8B949E'}}>Alege modulul cu care vrei să lucrezi</div>
      </div>

      {/* Module grid */}
      <div style={{maxWidth:1100,margin:'0 auto',padding:'0 32px 60px',width:'100%'}}>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))',gap:16}}>
          {modules.map((m,i)=>(
            <div key={i}
              onClick={()=>m.path&&nav(m.path)}
              style={{
                background: m.active ? '#161B22' : '#0D1117',
                border: `1px solid ${m.active ? m.color+'55' : '#21262D'}`,
                borderRadius:12,
                padding:'28px 24px',
                cursor: m.active ? 'pointer' : 'default',
                transition:'all .18s ease',
                position:'relative',
                overflow:'hidden',
              }}
              onMouseEnter={e=>{if(m.active){e.currentTarget.style.borderColor=m.color+'99';e.currentTarget.style.transform='translateY(-2px)';e.currentTarget.style.boxShadow=`0 8px 24px ${m.color}22`}}}
              onMouseLeave={e=>{if(m.active){e.currentTarget.style.borderColor=m.color+'55';e.currentTarget.style.transform='';e.currentTarget.style.boxShadow=''}}}
            >
              {/* Glow accent */}
              {m.active&&<div style={{position:'absolute',top:0,left:0,right:0,height:2,background:`linear-gradient(90deg,transparent,${m.color},transparent)`,borderRadius:'12px 12px 0 0'}}/>}

              <div style={{fontSize:36,marginBottom:12,lineHeight:1}}>{m.icon}</div>
              <div style={{fontSize:17,fontWeight:700,color: m.active ? '#E6EDF3' : '#484F58',marginBottom:6,letterSpacing:'-.2px'}}>{m.label}</div>
              <div style={{fontSize:12,color: m.active ? '#8B949E' : '#30363D',lineHeight:1.5}}>{m.desc}</div>

              {!m.active&&(
                <div style={{marginTop:12,display:'inline-block',background:'#21262D',color:'#484F58',fontSize:10,fontWeight:700,padding:'3px 8px',borderRadius:4,letterSpacing:'.5px',textTransform:'uppercase'}}>
                  În curând
                </div>
              )}
              {m.active&&(
                <div style={{marginTop:14,display:'inline-flex',alignItems:'center',gap:5,color:m.color,fontSize:12,fontWeight:600}}>
                  Deschide <span style={{fontSize:14}}>→</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div style={{textAlign:'center',padding:'16px',fontSize:11,color:'#E53935',fontWeight:700,borderTop:'1px solid #21262D',marginTop:'auto',letterSpacing:'.3px'}}>
        Made by Trusu Razvan - Administrator Gazpet Instal
      </div>
    </div>
  )
}

// ─── Login ────────────────────────────────────────────────────────────────────
function LoginPage() {
  const { signIn, session } = useAuth()
  const [email,setEmail]=useState(''); const [pass,setPass]=useState(''); const [load,setLoad]=useState(false); const [err,setErr]=useState('')
  if (session) return <Navigate to="/" replace/>
  const go = async e => { e.preventDefault(); setLoad(true); setErr(''); const {error}=await signIn(email,pass); if(error) setErr('Email sau parolă incorectă'); setLoad(false) }
  return (
    <div style={{...S.page,display:'flex',alignItems:'center',justifyContent:'center',minHeight:'100vh'}}><style>{css}</style>
      <div style={{position:'absolute',inset:0,background:'radial-gradient(ellipse at 30% 40%,#1F6FEB08 0%,transparent 60%)'}}/>
      <div style={{...S.card,padding:38,width:420,position:'relative'}}>
        <div style={{textAlign:'center',marginBottom:26}}>
          <div style={{fontSize:24,fontWeight:800,letterSpacing:'3px',color:G.text,marginBottom:4}}>
            <span style={{color:'#1F6FEB'}}>GAZPET</span>
            <span style={{color:G.muted,fontWeight:300,margin:'0 6px'}}>|</span>
            <span style={{color:G.text}}>INSTAL</span>
          </div>
          <div style={{fontSize:10,color:G.muted,letterSpacing:'2px',textTransform:'uppercase',marginBottom:14}}>S.C. Gazpet Instal S.R.L.</div>
          <div style={{width:36,height:2,background:'linear-gradient(90deg,#1F6FEB,#388BFD)',borderRadius:2,margin:'0 auto 14px'}}/>
          <div style={{fontSize:18,fontWeight:700}}>PontajPRO</div>
          <div style={{color:G.muted,fontSize:12,marginTop:3}}>Sistem de evidență a prezenței</div>
        </div>
        <form onSubmit={go}>
          <div style={{marginBottom:13}}><Lbl>Email</Lbl><input style={S.input} type="email" placeholder="email@gazpet.ro" value={email} onChange={e=>setEmail(e.target.value)} required autoFocus/></div>
          <div style={{marginBottom:18}}><Lbl>Parolă</Lbl><input style={S.input} type="password" placeholder="••••••••" value={pass} onChange={e=>setPass(e.target.value)} required/></div>
          {err&&<div style={{background:G.redDim,color:G.red,border:`1px solid ${G.red}33`,borderRadius:8,padding:'8px 12px',fontSize:12,marginBottom:12}}>⚠ {err}</div>}
          <button style={{...S.btnP,width:'100%',display:'flex',alignItems:'center',justifyContent:'center',gap:7}} type="submit" disabled={load}>{load?<><div className="sp"/>...</>:'→ Conectare'}</button>
        </form>
        <div style={{textAlign:'center',marginTop:16,fontSize:11,color:G.dim}}>Contactați administratorul pentru acces</div>
        <div style={{textAlign:'center',marginTop:8,fontSize:11,color:'#E53935',fontWeight:700}}>Made by Trusu Razvan - Administrator Gazpet Instal</div>
      </div>
    </div>
  )
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
function DashboardPage() {
  const { profile } = useAuth()
  const [stats,setStats]=useState({present:0,checkedOut:0,total:0,avgMins:0,diurna:0})
  const [deptStats,setDeptStats]=useState([])
  const [recent,setRecent]=useState([])
  const [unalloc,setUnalloc]=useState([])
  const [load,setLoad]=useState(true)
  const [weekStats,setWeekStats]=useState(null)
  const [monthStats,setMonthStats]=useState(null)
  const [absent3,setAbsent3]=useState([])
  const isAdmin=(['admin','superadmin'].includes(profile?.role))
  const [expiringContracts,setExpiringContracts]=useState([])
  useEffect(()=>{ if(profile!==null) loadData() },[profile])
  const loadData = async () => {
    setLoad(true)
    const today=todayStr()
    let eq=supabase.from('employees').select('*,sites(name)').eq('active',true)
    if (!isAdmin){
      const siteIds=profile?.site_ids||[]
      if(siteIds.length===0){setLoad(false);return}
      eq=eq.in('site_id',siteIds)
    }
    const {data:emps}=await eq; if(!emps){setLoad(false);return}
    setUnalloc(emps.filter(e=>!e.site_id))
    const {data:recs}=await supabase.from('pontaj_records').select('*,employees(name,department,sites(name))').eq('date',today).in('employee_id',emps.map(e=>e.id)).order('check_in',{ascending:false})
    const present=(recs||[]).filter(r=>r.check_in&&!r.norma).length
    const checkedOut=(recs||[]).filter(r=>r.check_out&&!r.norma).length
    const diurna=(recs||[]).filter(r=>r.diurna).length
    const totalMins=(recs||[]).reduce((s,r)=>s+netMins(r.check_in,r.check_out,r.lunch_break!==false),0)
    // Norme stats
    const normeStats={}
    NORME.forEach(n=>{ const cnt=(recs||[]).filter(r=>r.norma===n).length; if(cnt>0) normeStats[n]=cnt })
    setStats({present,checkedOut,total:emps.length,avgMins:present>0?Math.round(totalMins/present):0,diurna,normeStats})
    setRecent((recs||[]).slice(0,8))
    // All departments, even those with 0 present
    setDeptStats(DEPARTMENTS.map(dept=>({dept,total:emps.filter(e=>e.department===dept).length,present:(recs||[]).filter(r=>r.employees?.department===dept&&r.check_in&&!r.norma).length})))
    setLoad(false)

    // Raport saptamanal si lunar
    const now = new Date()
    // Saptamana curenta: luni -> azi
    const dayOfWeek = now.getDay()===0 ? 6 : now.getDay()-1
    const weekStart = new Date(now); weekStart.setDate(now.getDate()-dayOfWeek); weekStart.setHours(0,0,0,0)
    const weekStartStr = weekStart.toISOString().split('T')[0]
    // Luna curenta: 1 -> azi
    const monthStartStr = now.toISOString().split('T')[0].slice(0,7)+'-01'
    const empIds = emps.map(e=>e.id)
    const [{data:weekRecs},{data:monthRecs}] = await Promise.all([
      supabase.from('pontaj_records').select('*').gte('date',weekStartStr).lte('date',todayStr()).in('employee_id',empIds),
      supabase.from('pontaj_records').select('*').gte('date',monthStartStr).lte('date',todayStr()).in('employee_id',empIds)
    ])
    const calcStats = (r) => {
      const present=(r||[]).filter(x=>x.check_in&&!x.norma).length
      const diurnaC=(r||[]).filter(x=>x.diurna).length
      const normeC={}
      NORME.forEach(n=>{ const c=(r||[]).filter(x=>x.norma===n).length; if(c>0) normeC[n]=c })
      const totalDays=[...new Set((r||[]).map(x=>x.date))].length
      return {present,diurna:diurnaC,norme:normeC,totalDays}
    }
    setWeekStats(calcStats(weekRecs))
    setMonthStats(calcStats(monthRecs))

    // Angajati fara pontaj 3 zile consecutive
    const last3 = []
    for(let i=1;i<=3;i++){const d=new Date(now);d.setDate(d.getDate()-i);const ds=d.toISOString().split('T')[0];const dow=d.getDay();if(dow!==0&&dow!==6)last3.push(ds)}
    if(last3.length>=3){
      const {data:last3Recs}=await supabase.from('pontaj_records').select('employee_id,date,check_in,norma').in('date',last3).in('employee_id',empIds)
      const absentEmps=emps.filter(e=>{
        return last3.every(day=>{
          const r=(last3Recs||[]).find(x=>x.employee_id===e.id&&x.date===day)
          return !r||(r.norma===null&&r.check_in===null)
        })
      })
      setAbsent3(absentEmps)
    }

    // Check expiring contracts (next 30 days) - only for admin/superadmin
    if(['admin','superadmin'].includes(profile?.role)){
      const in30=new Date(); in30.setDate(in30.getDate()+30)
      const {data:expiring}=await supabase.from('employee_salaries').select('*,employees(name)').not('contract_expiry','is',null).lte('contract_expiry',in30.toISOString().split('T')[0]).gte('contract_expiry',todayStr())
      setExpiringContracts(expiring||[])
    }
  }
  if (load) return <Layout><div style={{display:'flex',justifyContent:'center',padding:80}}><div className="sp" style={{width:30,height:30}}/></div></Layout>
  return (
    <Layout>
      <div style={{fontSize:19,fontWeight:800,marginBottom:18}}>Bun venit{profile?.name?`, ${profile.name.split(' ')[0]}`:''}! 👋</div>

      {/* Alerta contracte care expira */}
      {expiringContracts.length>0&&<div style={{background:'#1A1A3A',border:`1px solid ${G.purple}44`,borderRadius:10,padding:'10px 16px',marginBottom:12,display:'flex',alignItems:'center',gap:10}}>
        <span style={{fontSize:18}}>📋</span>
        <div><div style={{fontSize:12,fontWeight:700,color:G.purple}}>{expiringContracts.length} contracte expiră în următoarele 30 zile!</div>
        <div style={{fontSize:11,color:G.purple+'99'}}>{expiringContracts.slice(0,3).map(e=>`${e.employees?.name} (${new Date(e.contract_expiry).toLocaleDateString('ro-RO')})`).join(', ')}{expiringContracts.length>3?` +${expiringContracts.length-3}`:''}</div></div>
      </div>}
      {unalloc.length>0&&<div style={{background:G.redDim,border:`1px solid ${G.red}44`,borderRadius:10,padding:'12px 16px',marginBottom:12,display:'flex',alignItems:'center',gap:12,overflow:'hidden'}}>
        <style>{`@keyframes marquee{0%{transform:translateX(100%)}100%{transform:translateX(-100%)}}`}</style>
        <span style={{fontSize:22,flexShrink:0}}>⚠️</span>
        <div style={{overflow:'hidden',flex:1}}>
          <div style={{fontSize:14,fontWeight:700,color:G.red,whiteSpace:'nowrap',animation:'marquee 18s linear infinite'}}>
            {unalloc.length} angajați nealocați pe niciun șantier! &nbsp;&nbsp;&nbsp;—&nbsp;&nbsp;&nbsp; {unalloc.map(e=>e.name).join(' • ')}
          </div>
        </div>
      </div>}

      {/* Alerta 3 zile fara pontaj */}
      {absent3.length>0&&<div style={{background:'#2A1A2A',border:`1px solid ${G.purple}55`,borderRadius:10,padding:'10px 14px',marginBottom:12}}>
        <div style={{fontSize:12,fontWeight:700,color:G.purple,marginBottom:5}}>🚨 {absent3.length} angajați fără pontaj 3 zile consecutive!</div>
        <div style={{display:'flex',flexWrap:'wrap',gap:'3px 10px'}}>
          {absent3.map(e=><span key={e.id} style={{fontSize:11,color:G.purple+'CC',whiteSpace:'nowrap'}}>• {e.name}</span>)}
        </div>
      </div>}

      {/* Alerta diurne > prezenti */}
      {stats.diurna>stats.present&&<div style={{background:'#3A2A00',border:`1px solid ${G.orange}44`,borderRadius:10,padding:'10px 16px',marginBottom:12,display:'flex',alignItems:'center',gap:10}}>
        <span style={{fontSize:18}}>⚠️</span>
        <div><div style={{fontSize:12,fontWeight:700,color:G.orange}}>Diurne ({stats.diurna}) mai mari decât prezenți ({stats.present})!</div>
        <div style={{fontSize:11,color:G.orange+'99'}}>Verificați în Pontaj dacă diurnele sunt corect bifate.</div></div>
      </div>}

      <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:13,marginBottom:20}}>
        {[{l:'Total Angajați',v:stats.total,i:'👥',c:G.blue,s:'activi'},{l:'Prezenți Azi',v:stats.present,i:'✅',c:G.green,s:`din ${stats.total}`},{l:'Au Plecat',v:stats.checkedOut,i:'🚪',c:G.yellow,s:'ieșire'},{l:'Medie Ore',v:minsToHM(stats.avgMins),i:'⏱',c:G.purple,s:'azi'},{l:'Cu Diurnă',v:stats.diurna,i:'💰',c:stats.diurna>stats.present?G.red:G.orange,s:'azi'}].map(x=>(
          <div key={x.l} style={{...S.card,padding:'16px 18px'}}>
            <div style={{display:'flex',justifyContent:'space-between'}}>
              <div><div style={{fontSize:10,color:G.muted,marginBottom:6,fontWeight:600,textTransform:'uppercase',letterSpacing:'.5px'}}>{x.l}</div>
              <div style={{fontSize:28,fontWeight:800,color:x.c,lineHeight:1}}>{x.v}</div>
              <div style={{fontSize:10,color:G.dim,marginTop:4}}>{x.s}</div></div>
              <div style={{fontSize:22}}>{x.i}</div>
            </div>
          </div>
        ))}
      </div>

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:16}}>
        {/* Prezenta pe departamente - mereu vizibil */}
        <div style={{...S.card,padding:20}}>
          <div style={{fontSize:13,fontWeight:700,marginBottom:16}}>Prezență pe Departamente</div>
          {deptStats.map(d=>(
            <div key={d.dept} style={{marginBottom:11}}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}><span style={{fontSize:12}}>{d.dept}</span><span style={{fontSize:12,fontWeight:700,color:G.blue}}>{d.present}/{d.total}</span></div>
              <div style={{height:4,background:'#21262D',borderRadius:2}}><div style={{height:'100%',width:`${d.total?(d.present/d.total)*100:0}%`,background:d.present/d.total>.7?G.green:d.present/d.total>.4?G.yellow:G.red,borderRadius:2,transition:'width .5s'}}/></div>
            </div>
          ))}
        </div>

        {/* Raport zilnic - norme */}
        <div style={{...S.card,padding:20}}>
          <div style={{fontSize:13,fontWeight:700,marginBottom:16}}>📋 Raport Zilnic — {new Date().toLocaleDateString('ro-RO',{day:'2-digit',month:'long'})}
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            <div style={{display:'flex',justifyContent:'space-between',padding:'7px 10px',background:G.greenDim,borderRadius:8,border:`1px solid ${G.green}22`}}>
              <span style={{fontSize:12,fontWeight:600,color:G.green}}>✅ Prezenți la muncă</span>
              <span style={{fontSize:14,fontWeight:800,color:G.green}}>{stats.present}</span>
            </div>
            {Object.entries(stats.normeStats||{}).length===0
              ?<div style={{fontSize:11,color:G.dim,textAlign:'center',padding:'10px 0'}}>Nicio normă specială azi</div>
              :Object.entries(stats.normeStats||{}).map(([norma,cnt])=>(
                <div key={norma} style={{display:'flex',justifyContent:'space-between',padding:'7px 10px',background:G.yellowDim,borderRadius:8,border:`1px solid ${G.yellow}22`}}>
                  <span style={{fontSize:12,color:G.yellow}}><strong>{norma}</strong> — {NORME_LABELS[norma]}</span>
                  <span style={{fontSize:13,fontWeight:800,color:G.yellow}}>{cnt}</span>
                </div>
              ))
            }
            <div style={{display:'flex',justifyContent:'space-between',padding:'7px 10px',background:'#1A1A2A',borderRadius:8}}>
              <span style={{fontSize:12,color:G.muted}}>💰 Cu diurnă</span>
              <span style={{fontSize:13,fontWeight:800,color:G.orange}}>{stats.diurna}</span>
            </div>
            <div style={{display:'flex',justifyContent:'space-between',padding:'9px 12px',background:G.redDim,borderRadius:8,border:`1px solid ${G.red}33`}}>
              <span style={{fontSize:14,fontWeight:700,color:G.red}}>‼️ Fără pontaj</span>
              <span style={{fontSize:16,fontWeight:900,color:G.red}}>{stats.total-stats.present-Object.values(stats.normeStats||{}).reduce((s,v)=>s+v,0)}</span>
            </div>
          </div>
        </div>

        {/* Raport Saptamanal */}
        {weekStats&&<div style={{...S.card,padding:20}}>
          <div style={{fontSize:13,fontWeight:700,marginBottom:16}}>📅 Raport Săptămânal — <span style={{color:G.blue,fontWeight:500}}>săpt. curentă</span></div>
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            <div style={{display:'flex',justifyContent:'space-between',padding:'7px 10px',background:G.greenDim,borderRadius:8,border:`1px solid ${G.green}22`}}>
              <span style={{fontSize:12,fontWeight:600,color:G.green}}>✅ Prezențe totale</span>
              <span style={{fontSize:14,fontWeight:800,color:G.green}}>{weekStats.present}</span>
            </div>
            {Object.entries(weekStats.norme||{}).map(([norma,cnt])=>(
              <div key={norma} style={{display:'flex',justifyContent:'space-between',padding:'7px 10px',background:G.yellowDim,borderRadius:8,border:`1px solid ${G.yellow}22`}}>
                <span style={{fontSize:12,color:G.yellow}}><strong>{norma}</strong> — {NORME_LABELS[norma]}</span>
                <span style={{fontSize:13,fontWeight:800,color:G.yellow}}>{cnt}</span>
              </div>
            ))}
            <div style={{display:'flex',justifyContent:'space-between',padding:'7px 10px',background:'#1A1A2A',borderRadius:8}}>
              <span style={{fontSize:12,color:G.muted}}>💰 Diurne acordate</span>
              <span style={{fontSize:13,fontWeight:800,color:G.orange}}>{weekStats.diurna}</span>
            </div>
            <div style={{display:'flex',justifyContent:'space-between',padding:'7px 10px',background:'#1A1A2A',borderRadius:8}}>
              <span style={{fontSize:12,color:G.muted}}>📆 Zile lucrate (cu prezențe)</span>
              <span style={{fontSize:13,fontWeight:800,color:G.blue}}>{weekStats.totalDays}</span>
            </div>
          </div>
        </div>}

        {/* Raport Lunar */}
        {monthStats&&<div style={{...S.card,padding:20}}>
          <div style={{fontSize:13,fontWeight:700,marginBottom:16}}>🗓️ Raport Lunar — <span style={{color:G.purple,fontWeight:500}}>{new Date().toLocaleDateString('ro-RO',{month:'long',year:'numeric'})}</span></div>
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            <div style={{display:'flex',justifyContent:'space-between',padding:'7px 10px',background:G.greenDim,borderRadius:8,border:`1px solid ${G.green}22`}}>
              <span style={{fontSize:12,fontWeight:600,color:G.green}}>✅ Prezențe totale</span>
              <span style={{fontSize:14,fontWeight:800,color:G.green}}>{monthStats.present}</span>
            </div>
            {Object.entries(monthStats.norme||{}).map(([norma,cnt])=>(
              <div key={norma} style={{display:'flex',justifyContent:'space-between',padding:'7px 10px',background:G.yellowDim,borderRadius:8,border:`1px solid ${G.yellow}22`}}>
                <span style={{fontSize:12,color:G.yellow}}><strong>{norma}</strong> — {NORME_LABELS[norma]}</span>
                <span style={{fontSize:13,fontWeight:800,color:G.yellow}}>{cnt}</span>
              </div>
            ))}
            <div style={{display:'flex',justifyContent:'space-between',padding:'7px 10px',background:'#1A1A2A',borderRadius:8}}>
              <span style={{fontSize:12,color:G.muted}}>💰 Diurne acordate</span>
              <span style={{fontSize:13,fontWeight:800,color:G.orange}}>{monthStats.diurna}</span>
            </div>
            <div style={{display:'flex',justifyContent:'space-between',padding:'7px 10px',background:'#1A1A2A',borderRadius:8}}>
              <span style={{fontSize:12,color:G.muted}}>📆 Zile cu activitate</span>
              <span style={{fontSize:13,fontWeight:800,color:G.purple}}>{monthStats.totalDays}</span>
            </div>
          </div>
        </div>}

        {/* Activitate recenta */}
        <div style={{...S.card,padding:20}}>
          <div style={{fontSize:13,fontWeight:700,marginBottom:13}}>Activitate Recentă</div>
          <div style={{display:'flex',flexDirection:'column',gap:7}}>
            {recent.length===0?<div style={{textAlign:'center',color:G.muted,padding:'18px 0',fontSize:12}}>Nicio activitate azi</div>
            :recent.map(r=>(
              <div key={r.id} style={{display:'flex',alignItems:'center',gap:10,padding:'7px 10px',background:'#1C2128',borderRadius:8}}>
                <Avatar name={r.employees?.name} size={26}/>
                <div style={{flex:1}}><div style={{fontSize:12,fontWeight:600}}>{r.employees?.name}</div><div style={{fontSize:10,color:G.muted}}>{r.employees?.sites?.name||r.employees?.department}</div></div>
                <div style={{textAlign:'right',fontSize:11}}>
                  {r.norma?<span style={{color:G.yellow,fontWeight:700}}>{r.norma}</span>:<>{r.check_in&&<div style={{color:G.green}}>⬇ {fmt24(r.check_in)}</div>}{r.check_out&&<div style={{color:G.red}}>⬆ {fmt24(r.check_out)}</div>}</>}
                  {r.diurna&&<span style={{color:G.orange}}> 💰</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Layout>
  )
}

// ─── Pontaj Row ───────────────────────────────────────────────────────────────
function PontajRow({ emp, rec, sites, selectedDate, onSave, onAllocate, saving, isAdmin, diurnaAmt, suplAmt, isTerminated, isFuture }) {
  const [ci,setCi]=useState(rec?.check_in?new Date(rec.check_in).toTimeString().slice(0,5):'')
  const [co,setCo]=useState(rec?.check_out?new Date(rec.check_out).toTimeString().slice(0,5):'')
  const [norma,setNorma]=useState(rec?.norma||'')
  const [diurna,setDiurna]=useState(rec?.diurna||false)
  const [supl,setSupl]=useState(rec?.meal_supplement||false)
  const [mode,setMode]=useState(rec?.norma?'norma':'ore')
  const [exp,setExp]=useState(false)
  useEffect(()=>{
    setCi(rec?.check_in?new Date(rec.check_in).toTimeString().slice(0,5):'')
    setCo(rec?.check_out?new Date(rec.check_out).toTimeString().slice(0,5):'')
    setNorma(rec?.norma||''); setDiurna(rec?.diurna||false); setSupl(rec?.meal_supplement||false); setMode(rec?.norma?'norma':'ore')
  },[rec])
  const previewNet = () => { if(!ci) return null; const a=dateToISO(selectedDate,ci),b=co?dateToISO(selectedDate,co):null; return b?netMins(a,b,true):null }
  const pNet=previewNet()
  const recNet=netMins(rec?.check_in,rec?.check_out,rec?.lunch_break!==false)
  const hasRec=rec?.check_in||rec?.norma
  const save = () => {
    if (mode==='norma'&&norma) onSave(emp,{norma,check_in:null,check_out:null,lunch_break:false,diurna,meal_supplement:supl})
    else if (mode==='ore'&&ci) onSave(emp,{check_in:dateToISO(selectedDate,ci),check_out:co?dateToISO(selectedDate,co):null,norma:null,lunch_break:true,diurna,meal_supplement:supl})
    else onSave(emp,{...(rec||{}),diurna,meal_supplement:supl,norma:rec?.norma||null,check_in:rec?.check_in||null,check_out:rec?.check_out||null})
  }
  if(isTerminated) return (
    <div style={{...S.card,padding:'10px 14px',opacity:0.55,border:`1px solid #FF000022`,background:'#1A0A0A',pointerEvents:'none'}}>
      <div style={{display:'flex',alignItems:'center',gap:11}}>
        <Avatar name={emp.name} id={emp.id} size={34}/>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:13,fontWeight:700,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',color:G.muted}}>{emp.name}</div>
          <div style={{fontSize:10,color:G.muted,display:'flex',gap:5,alignItems:'center'}}>
            {emp.department&&<span className="badge bd" style={{fontSize:9,padding:'1px 5px'}}>{emp.department}</span>}
            {emp.position&&<span>{emp.position}</span>}
          </div>
        </div>
        <span style={{fontSize:11,color:G.red,fontWeight:700,background:G.redDim,padding:'3px 10px',borderRadius:20,border:`1px solid ${G.red}44`}}>🔴 Contract încetat {new Date(emp.termination_date).toLocaleDateString('ro-RO')}</span>
      </div>
    </div>
  )
  return (
    <div style={{...S.card,padding:'10px 14px',transition:'border-color .2s'}}>
      <div style={{display:'flex',alignItems:'center',gap:11,flexWrap:'nowrap'}}>
        <Avatar name={emp.name} id={emp.id} size={34}/>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:'flex',alignItems:'center',gap:6}}>
            <div style={{fontSize:13,fontWeight:700,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{emp.name}</div>
            {emp.hire_date&&emp.hire_date===selectedDate&&<span style={{fontSize:10,color:G.green,fontWeight:700,background:G.greenDim,padding:'2px 7px',borderRadius:20,border:`1px solid ${G.green}44`}}>🆕 Prima zi</span>}
          </div>
          <div style={{fontSize:10,color:G.muted,display:'flex',gap:5,alignItems:'center'}}>
            {emp.department&&<span className="badge bd" style={{fontSize:9,padding:'1px 5px'}}>{emp.department}</span>}
            {emp.position&&<span>{emp.position}</span>}
          </div>
        </div>

        {/* Santier */}
        <div style={{minWidth:130}}>
          {emp.site_id?<span className="badge bs" style={{fontSize:10,display:'block',marginBottom:3}}>{emp.sites?.name||'Șantier'}</span>
          :<span style={{fontSize:10,color:G.red,fontWeight:700,display:'block',marginBottom:3}}>⚠ Nealocate</span>}
          {isAdmin&&<select value={emp.site_id||''} onChange={e=>onAllocate(emp,e.target.value?Number(e.target.value):null)} style={{padding:'2px 5px',fontSize:10,width:'100%'}}>
            <option value="">— fără —</option>{sites.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
          </select>}
        </div>

        {/* Status actual */}
        {hasRec&&!exp&&<div style={{textAlign:'center',minWidth:80}}>
          {rec?.norma?<span style={{background:G.yellowDim,color:G.yellow,border:`1px solid ${G.yellow}44`,padding:'2px 8px',borderRadius:20,fontSize:11,fontWeight:700}}>{rec.norma}</span>
          :<>{rec?.check_in&&<div style={{fontSize:11,color:G.green,fontWeight:600}}>⬇ {fmt24(rec.check_in)}</div>}{rec?.check_out&&<div style={{fontSize:11,color:G.red,fontWeight:600}}>⬆ {fmt24(rec.check_out)}</div>}</>}
        </div>}

        {/* Ore nete */}
        {recNet>0&&!rec?.norma&&!exp&&<div style={{minWidth:65,textAlign:'center'}}>
          <div style={{fontSize:12,fontWeight:700,color:G.yellow}}>{minsToHM(recNet)}</div>
          {spansLunch(rec?.check_in,rec?.check_out)&&<div style={{fontSize:10,color:'#79C0FF'}}>☕−1h</div>}
        </div>}

        {/* Diurna */}
        <label style={{display:'flex',flexDirection:'column',alignItems:'center',gap:2,cursor:'pointer',minWidth:55}}>
          <input type="checkbox" checked={diurna} onChange={e=>setDiurna(e.target.checked)} style={{width:15,height:15,accentColor:G.orange}}/>
          <span style={{fontSize:9,color:diurna?G.orange:G.dim,fontWeight:600}}>{diurna?`💰${diurnaAmt}RON`:'💰 Diurnă'}</span>
        </label>

        {/* Supliment Hrana */}
        <label style={{display:'flex',flexDirection:'column',alignItems:'center',gap:2,cursor:'pointer',minWidth:55}}>
          <input type="checkbox" checked={supl} onChange={e=>setSupl(e.target.checked)} style={{width:15,height:15,accentColor:'#56D364'}}/>
          <span style={{fontSize:9,color:supl?'#56D364':G.dim,fontWeight:600}}>{supl?`🍔${suplAmt}RON`:'🍔 Hrană'}</span>
        </label>

        {/* Edit toggle */}
        <button onClick={()=>setExp(!exp)} style={{background:'none',border:`1px solid ${G.border}`,borderRadius:7,padding:'4px 9px',cursor:'pointer',color:G.muted,fontSize:11}}>{exp?'▲':'✏️'}</button>

        {/* Save */}
        <button onClick={save} disabled={saving} style={{...S.btnP,padding:'6px 13px',fontSize:12,display:'flex',alignItems:'center',gap:5}}>{saving?<div className="sp"/>:'💾'}</button>
      </div>

      {exp&&<div style={{marginTop:11,padding:13,background:'#0D1117',borderRadius:8,border:`1px solid ${G.border}`}}>
        <div style={{display:'flex',gap:14,alignItems:'flex-start',flexWrap:'wrap'}}>
          <div>
            <Lbl>Tip</Lbl>
            <div style={{display:'flex',gap:12}}>
              <label style={{display:'flex',alignItems:'center',gap:5,fontSize:12,cursor:'pointer'}}>
                <input type="radio" name={`m${emp.id}`} checked={mode==='ore'} onChange={()=>{setMode('ore');setNorma('')}} style={{accentColor:G.blue}}/> Ore lucrate
              </label>
              <label style={{display:'flex',alignItems:'center',gap:5,fontSize:12,cursor:'pointer'}}>
                <input type="radio" name={`m${emp.id}`} checked={mode==='norma'} onChange={()=>{setMode('norma');setCi('');setCo('')}} style={{accentColor:G.yellow}}/> Normă specială
              </label>
            </div>
          </div>
          {mode==='ore'?(
            <>
              <div><Lbl>Intrare</Lbl><input type="time" value={ci} onChange={e=>setCi(e.target.value)} style={{...S.input,width:110}}/></div>
              <div><Lbl>Ieșire</Lbl><input type="time" value={co} onChange={e=>setCo(e.target.value)} style={{...S.input,width:110}}/></div>
              {pNet!==null&&<div style={{paddingTop:18,fontSize:12,color:G.yellow,fontWeight:700}}>{minsToHM(pNet)} net</div>}
            </>
          ):(
            <div><Lbl>Normă</Lbl>
              <select value={norma} onChange={e=>setNorma(e.target.value)} style={{width:230}}>
                <option value="">— Selectează —</option>
                {NORME.map(n=><option key={n} value={n}>{n} — {NORME_LABELS[n]}</option>)}
              </select>
            </div>
          )}
          <div style={{paddingTop:18}}>
            <label style={{display:'flex',alignItems:'center',gap:7,fontSize:12,cursor:'pointer'}}>
              <input type="checkbox" checked={diurna} onChange={e=>setDiurna(e.target.checked)} style={{accentColor:G.orange}}/> 💰 Diurnă ({diurnaAmt} RON)
            </label>
          </div>
          <div style={{paddingTop:18}}>
            <label style={{display:'flex',alignItems:'center',gap:7,fontSize:12,cursor:'pointer'}}>
              <input type="checkbox" checked={supl} onChange={e=>setSupl(e.target.checked)} style={{accentColor:'#56D364'}}/> 🍔 Supliment Hrană ({suplAmt} RON)
            </label>
          </div>
        </div>
      </div>}
    </div>
  )
}

// ─── Pontaj Page ──────────────────────────────────────────────────────────────
function PontajPage() {
  const { profile } = useAuth()
  const [emps,setEmps]=useState([]); const [recs,setRecs]=useState({}); const [sites,setSites]=useState([])
  const [search,setSearch]=useState(''); const [deptF,setDeptF]=useState('Toate'); const [siteF,setSiteF]=useState('Toate')
  const [onlyDiurna,setOnlyDiurna]=useState(false)
  const [date,setDate]=useState(todayStr()); const [load,setLoad]=useState(true); const [saving,setSaving]=useState(null)
  const [diurnaAmt,setDiurnaAmt]=useState(50); const [suplAmt,setSuplAmt]=useState(15); const [toast,showToast]=useToast()
  const isAdmin=['admin','superadmin'].includes(profile?.role)
  useEffect(()=>{ loadSites(); loadSettings() },[])
  useEffect(()=>{ loadEmps() },[profile,sites,date.slice(0,7)])
  useEffect(()=>{ if(emps.length>0) loadRecs() },[emps,date])
  const loadSettings=async()=>{ const {data}=await supabase.from('settings').select('*'); const d=data?.find(s=>s.key==='diurna_amount'); if(d) setDiurnaAmt(Number(d.value)); const s=data?.find(x=>x.key==='meal_supplement_amount'); if(s) setSuplAmt(Number(s.value)) }
  const loadSites=async()=>{ const {data}=await supabase.from('sites').select('*').eq('active',true).order('name'); setSites(data||[]) }
  const loadEmps=async()=>{
    const monthStart=date.slice(0,7)+'-01'
    let q=supabase.from('employees').select('*,sites(name)').or(`active.eq.true,and(active.eq.false,termination_date.gte.${monthStart})`).order('name')
    if(!isAdmin){
      const siteIds=profile?.site_ids||[]
      if(siteIds.length===0){setEmps([]);setLoad(false);return}
      q=q.in('site_id',siteIds)
    }
    const {data}=await q; setEmps(data||[])
  }
  const loadRecs=async()=>{ setLoad(true); const ids=emps.map(e=>e.id); if(!ids.length){setLoad(false);return}; const {data}=await supabase.from('pontaj_records').select('*').eq('date',date).in('employee_id',ids); const m={}; (data||[]).forEach(r=>{m[r.employee_id]=r}); setRecs(m); setLoad(false) }

  const saveRecord = async (emp, fields) => {
    setSaving(emp.id)
    if (!fields.norma && !emp.site_id) { showToast('Șantierul este obligatoriu pentru ore!','error'); setSaving(null); return }
    const uid=(await supabase.auth.getUser()).data.user?.id
    const {data,error}=await supabase.from('pontaj_records').upsert({employee_id:emp.id,date,site_id:emp.site_id,created_by:uid,updated_by:uid,updated_at:new Date().toISOString(),...fields},{onConflict:'employee_id,date'}).select().single()
    if(!error){setRecs(prev=>({...prev,[emp.id]:data}));showToast(`✓ Salvat: ${emp.name}`)} else showToast('Eroare la salvare','error')
    setSaving(null)
  }
  const allocate = async (emp, siteId) => {
    await supabase.from('employees').update({site_id:siteId||null}).eq('id',emp.id)
    setEmps(prev=>prev.map(e=>e.id===emp.id?{...e,site_id:siteId||null,sites:sites.find(s=>s.id===siteId)||null}:e))
    showToast(siteId?`✓ Alocat: ${sites.find(s=>s.id===siteId)?.name}`:'Dezalocat','warn')
  }
  const filtered=emps.filter(e=>{
    if(e.hire_date&&e.hire_date>date) return false
    const monthStart=date.slice(0,7)+'-01'
    if(!e.active&&e.termination_date&&e.termination_date<monthStart) return false
    const ms=e.name.toLowerCase().includes(search.toLowerCase())
    const md=deptF==='Toate'||e.department===deptF
    const ms2=siteF==='Toate'||String(e.site_id)===String(siteF)
    const md2=!onlyDiurna||recs[e.id]?.diurna
    return ms&&md&&ms2&&md2
  })
  const unalloc=emps.filter(e=>!e.site_id)
  return (
    <Layout>
      <Toast toast={toast}/>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
        <div><div style={{fontSize:19,fontWeight:800}}>Pontaj</div><div style={{fontSize:11,color:G.muted,marginTop:2}}>{filtered.length} angajați · {Object.values(recs).filter(r=>r.check_in||r.norma).length} înreg.</div></div>
        <div style={{display:'flex',gap:7,alignItems:'center',flexWrap:'wrap'}}>
          <div style={{display:'flex',alignItems:'center',gap:4}}>
            <button onClick={()=>{ const d=new Date(date); d.setDate(d.getDate()-1); setDate(d.toISOString().split('T')[0]) }}
              style={{background:G.surface,border:`1px solid ${G.border}`,color:G.text,borderRadius:7,padding:'6px 10px',cursor:'pointer',fontSize:14,fontWeight:700}}>◀</button>
            <input type="date" value={date} onChange={e=>setDate(e.target.value)} style={{...S.input,width:'auto',padding:'6px 10px'}}/>
            <button onClick={()=>{ const d=new Date(date); d.setDate(d.getDate()+1); setDate(d.toISOString().split('T')[0]) }}
              style={{background:G.surface,border:`1px solid ${G.border}`,color:G.text,borderRadius:7,padding:'6px 10px',cursor:'pointer',fontSize:14,fontWeight:700}}>▶</button>
          </div>
          <input placeholder="🔍 Caută..." value={search} onChange={e=>setSearch(e.target.value)} style={{...S.input,width:170}}/>
          <select value={deptF} onChange={e=>setDeptF(e.target.value)}><option>Toate</option>{DEPARTMENTS.map(d=><option key={d}>{d}</option>)}</select>
          {isAdmin&&<select value={siteF} onChange={e=>setSiteF(e.target.value)}><option value="Toate">Toate șantierele</option>{sites.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select>}
          <button onClick={()=>setOnlyDiurna(!onlyDiurna)} style={{...S.btnS,fontSize:12,background:onlyDiurna?'#3A2A00':'',color:onlyDiurna?G.orange:G.muted,borderColor:onlyDiurna?G.orange+'44':G.border}}>
            💰 {onlyDiurna?'Doar Diurnă':'Toți'}
          </button>
        </div>
      </div>
      <div style={{background:'#1A2A3A',border:`1px solid ${G.blue}33`,borderRadius:9,padding:'8px 14px',marginBottom:12,fontSize:11,color:'#79C0FF'}}>
        ☕ Pauza masă 12–13 se scade automat &nbsp;·&nbsp; 💰 Diurnă {diurnaAmt} RON/zi &nbsp;·&nbsp; Șantierul obligatoriu la ore
      </div>
      {unalloc.length>0&&<div style={{background:G.redDim,border:`1px solid ${G.red}33`,borderRadius:9,padding:'8px 12px',marginBottom:12,color:G.red}}>
        <div style={{fontSize:11,fontWeight:700,marginBottom:4}}>⚠️ {unalloc.length} angajați nealocați pe niciun șantier:</div>
        <div style={{fontSize:11,lineHeight:1.7,flexWrap:'wrap',display:'flex',gap:'4px 10px'}}>
          {unalloc.map(e=><span key={e.id} style={{whiteSpace:'nowrap'}}>• {e.name}</span>)}
        </div>
      </div>}
      {load?<div style={{display:'flex',justifyContent:'center',padding:60}}><div className="sp" style={{width:28,height:28}}/></div>
      :<div style={{display:'flex',flexDirection:'column',gap:5}}>
        {filtered.map(emp=><PontajRow key={emp.id} emp={emp} rec={recs[emp.id]} sites={sites} selectedDate={date} onSave={saveRecord} onAllocate={allocate} saving={saving===emp.id} isAdmin={isAdmin} diurnaAmt={diurnaAmt} suplAmt={suplAmt} isTerminated={!!(emp.termination_date&&emp.termination_date<date)} isFuture={!!(emp.hire_date&&emp.hire_date>date)}/>)}
        {!filtered.length&&<div style={{textAlign:'center',color:G.muted,padding:'50px 0',fontSize:12}}>Niciun angajat găsit</div>}
      </div>}
    </Layout>
  )
}

// ─── Reports Page ─────────────────────────────────────────────────────────────
function ReportsPage() {
  const { profile } = useAuth()
  const now=new Date()
  const [month,setMonth]=useState(`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`)
  const [deptF,setDeptF]=useState('Toate'); const [siteF,setSiteF]=useState('Toate')
  const [sites,setSites]=useState([]); const [data,setData]=useState([]); const [detailed,setDetailed]=useState([])
  const [load,setLoad]=useState(true); const [expITM,setExpITM]=useState(false); const [expD,setExpD]=useState(false); const [expS,setExpS]=useState(false); const [expBT,setExpBT]=useState(false)
  const [rSearch,setRSearch]=useState('')
  const [impPontajPrev,setImpPontajPrev]=useState(null); const [importingPontaj,setImportingPontaj]=useState(false)
  const importPontajRef=useRef(null)
  const [view,setView]=useState('summary'); const [diurnaAmt,setDiurnaAmt]=useState(50); const [suplAmt,setSuplAmt]=useState(15)
  const [df,setDf]=useState(todayStr()); const [dt,setDt]=useState(todayStr())
  const [sf,setSf]=useState(todayStr()); const [st2,setSt2]=useState(todayStr())
  const [savingPayment,setSavingPayment]=useState(false)
  const [payments,setPayments]=useState([])
  const [selectedPayment,setSelectedPayment]=useState(null)
  const [paymentDetails,setPaymentDetails]=useState([])
  const [showIstoric,setShowIstoric]=useState(false)
  const [toast,showToast]=useToast()
  const isAdmin=['admin','superadmin'].includes(profile?.role)
  useEffect(()=>{ supabase.from('sites').select('*').eq('active',true).then(({data:s})=>setSites(s||[])); supabase.from('settings').select('*').then(({data:st})=>{const d=st?.find(x=>x.key==='diurna_amount');if(d)setDiurnaAmt(Number(d.value));const s=st?.find(x=>x.key==='meal_supplement_amount');if(s)setSuplAmt(Number(s.value))}) },[])
  useEffect(()=>{ loadReport() },[month,deptF,siteF,profile])
  useEffect(()=>{ if(showIstoric) loadPayments() },[showIstoric])

  const loadPayments=async()=>{
    const {data}=await supabase.from('diurna_payments').select('*').order('payment_date',{ascending:false}).limit(50)
    setPayments(data||[])
  }

  const loadPaymentDetails=async(paymentId)=>{
    const {data}=await supabase.from('diurna_payment_details').select('*').eq('payment_id',paymentId).order('employee_name')
    setPaymentDetails(data||[])
  }

  const savePayment=async()=>{
    if(!df||!dt){showToast('Selectează perioada','warn');return}
    setSavingPayment(true)
    try{
    // Check for overlap
    const {data:existing}=await supabase.from('diurna_payments').select('*').lte('period_from',dt).gte('period_to',df)
    if(existing?.length>0){
      showToast(`⚠ Suprapunere cu plata din ${new Date(existing[0].period_from).toLocaleDateString('ro-RO')} — ${new Date(existing[0].period_to).toLocaleDateString('ro-RO')}!`,'error')
      setSavingPayment(false); return
    }

    // Calculeaza bugetul lunar din Admin→Calendar (type='work')
    const d0=new Date(df)
    const monthStart=`${d0.getFullYear()}-${String(d0.getMonth()+1).padStart(2,'0')}-01`
    const mE=new Date(monthStart);mE.setMonth(mE.getMonth()+1);mE.setDate(0)
    const monthEnd=mE.toISOString().split('T')[0]
    const {data:calDat}=await supabase.from('calendar_days').select('date,type').gte('date',monthStart).lte('date',monthEnd)
    const legalSetSave=new Set((calDat||[]).filter(d=>d.type==='legal').map(d=>d.date))
    let bugetZileSave=0
    const bwS=new Date(monthStart),bwE=new Date(monthEnd)
    while(bwS<=bwE){const s=bwS.toISOString().split('T')[0];if(bwS.getDay()!==0&&bwS.getDay()!==6&&!legalSetSave.has(s))bugetZileSave++;bwS.setDate(bwS.getDate()+1)}
    const bugetLunar=bugetZileSave*diurnaAmt

    // Transe anterioare din aceeasi luna (pentru rest buget per angajat)
    const {data:prevPay}=await supabase.from('diurna_payments').select('*,diurna_payment_details(employee_id,amount)').gte('period_from',monthStart).lt('period_to',df).order('period_from',{ascending:true})

    // Get diurna data
    let eq=supabase.from('employees').select('*').eq('active',true)
    if(!isAdmin){const siteIds=profile?.site_ids||[];if(siteIds.length>0)eq=eq.in('site_id',siteIds)}
    const {data:emps}=await eq
    const {data:recs}=await supabase.from('pontaj_records').select('*').eq('diurna',true).gte('date',df).lte('date',dt).in('employee_id',(emps||[]).map(e=>e.id))

    const empStats=(emps||[]).map(emp=>{
      const er=(recs||[]).filter(r=>r.employee_id===emp.id)
      if(!er.length) return null
      const sumaExport=er.length*diurnaAmt
      // Suma platita anterior din aceeasi luna pentru acest angajat
      const platitAnt=(prevPay||[]).reduce((s,p)=>{const d=(p.diurna_payment_details||[]).find(x=>x.employee_id===emp.id);return s+(d?d.amount:0)},0)
      const restBuget=Math.max(0,bugetLunar-platitAnt)
      // Salvam DOAR suma confirmata (in limita bugetului) — surplusul merge in salariu
      const sumaConfirmata=Math.min(sumaExport,restBuget)
      return {id:emp.id,name:emp.name,days:er.length,amount:sumaConfirmata}
    }).filter(Boolean).filter(e=>e.days>0)  // includem toti cu diurne, chiar daca suma confirmata=0 (tot merge in salariu)

    if(!empStats.length){showToast('Nu există diurne în perioadă','warn');setSavingPayment(false);return}
    const uid=(await supabase.auth.getUser()).data.user?.id
    const {data:payment,error}=await supabase.from('diurna_payments').insert({
      period_from:df,period_to:dt,payment_date:todayStr(),
      total_employees:empStats.length,total_days:empStats.reduce((s,e)=>s+e.days,0),
      total_amount:empStats.reduce((s,e)=>s+e.amount,0),created_by:uid
    }).select().single()
    if(!error&&payment){
      await supabase.from('diurna_payment_details').insert(empStats.map(e=>({payment_id:payment.id,employee_id:e.id,employee_name:e.name,days:e.days,amount:e.amount})))
      playBeep(920,0.1); setTimeout(()=>playBeep(1100,0.1),130); showToast(`✅ Plată salvată: ${empStats.length} angajați · ${empStats.reduce((s,e)=>s+e.amount,0)} RON`)
    } else showToast('Eroare la salvare','error')
  }catch(e){showToast('Eroare la salvare','error')}finally{setSavingPayment(false)}
  }

  const reexportPayment=async(payment)=>{
    const {data:details}=await supabase.from('diurna_payment_details').select('*').eq('payment_id',payment.id).order('employee_name')
    if(!details?.length){showToast('Nicio dată','warn');return}
    const from=new Date(payment.period_from).toLocaleDateString('ro-RO')
    const to=new Date(payment.period_to).toLocaleDateString('ro-RO')
    const bd={top:{style:'thin',color:{rgb:'000000'}},bottom:{style:'thin',color:{rgb:'000000'}},left:{style:'thin',color:{rgb:'000000'}},right:{style:'thin',color:{rgb:'000000'}}}
    const hdr=['Nr.','Prenume','Nume','Zile','Diurnă/zi (RON)','TOTAL RON']
    const rows=[
      ['S.C. GAZPET INSTAL S.R.L.','','','Str. Fluturilor, nr.34, Loc.Ploiesti, Jud.Prahova'],
      ['RO 22029920; J2007001650296','','','Tel./Fax 0244/435005  office@gazpet.ro'],
      [],
      [`SITUAȚIE DIURNE: ${from} — ${to}`],
      [],
      hdr,
      ...details.map((d,i)=>{const p=d.employee_name.split(' ');return [i+1,p[0],p.slice(1).join(' '),d.days,diurnaAmt,d.amount]}),
      [],
      ['','','TOTAL',details.reduce((s,d)=>s+d.days,0),diurnaAmt,details.reduce((s,d)=>s+d.amount,0)]
    ]
    const ws=XLSX.utils.aoa_to_sheet(rows)
    ws['!cols']=[{wch:5},{wch:16},{wch:18},{wch:10},{wch:14},{wch:14}]
    hdr.forEach((_,c)=>{const a=XLSX.utils.encode_cell({r:5,c});if(!ws[a])ws[a]={v:hdr[c],t:'s'};ws[a].s={fill:{fgColor:{rgb:'1F497D'}},font:{bold:true,color:{rgb:'FFFFFF'},sz:10},border:bd,alignment:{horizontal:'center',vertical:'center'}}})
    const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'Diurne')
    XLSX.writeFile(wb,`Diurne_${from.replace(/\//g,'-')}_${to.replace(/\//g,'-')}.xlsx`)
    showToast('✓ Export gata!')
  }

  const getRange=()=>{ const [y,m]=month.split('-').map(Number); return {y,m,from:new Date(y,m-1,1).toISOString().split('T')[0],to:new Date(y,m,0).toISOString().split('T')[0],days:new Date(y,m,0).getDate()} }

  const loadReport=async()=>{
    setLoad(true)
    const {y,m,from,to,days}=getRange()
    let eq=supabase.from('employees').select('*,sites(name)').eq('active',true).order('name')
    if (!isAdmin){
      const siteIds=profile?.site_ids||[]
      if(siteIds.length>0) eq=eq.in('site_id',siteIds)
    }
    if (deptF!=='Toate'&&isAdmin) eq=eq.eq('department',deptF)
    if (siteF!=='Toate'&&isAdmin) eq=eq.eq('site_id',siteF)
    const {data:emps}=await eq; if(!emps){setLoad(false);return}
    const {data:recs}=await supabase.from('pontaj_records').select('*').gte('date',from).lte('date',to).in('employee_id',emps.map(e=>e.id))
    const stats=emps.map(emp=>{
      const er=(recs||[]).filter(r=>r.employee_id===emp.id)
      const workDays=er.filter(r=>r.check_in&&!r.norma).length
      const totalMins=er.reduce((s,r)=>s+netMins(r.check_in,r.check_out,r.lunch_break!==false),0)
      const totalGross=er.reduce((s,r)=>s+diffMins(r.check_in,r.check_out),0)
      const lunchDays=er.filter(r=>r.lunch_break!==false&&spansLunch(r.check_in,r.check_out)).length
      const diurnaDays=er.filter(r=>r.diurna).length
      const norme={}; er.forEach(r=>{if(r.norma)norme[r.norma]=(norme[r.norma]||0)+1})
      return {...emp,workDays,totalMins,totalGross,lunchDays,diurnaDays,norme,avgMins:workDays>0?Math.round(totalMins/workDays):0,days,records:er}
    }).sort((a,b)=>a.name.localeCompare(b.name))
    setData(stats)
    setDetailed((recs||[]).map(r=>{const e=emps.find(x=>x.id===r.employee_id);return {...r,empName:e?.name||'?',empDept:e?.department||'',empPos:e?.position||'',empSite:e?.sites?.name||''}}).sort((a,b)=>a.date.localeCompare(b.date)||a.empName.localeCompare(b.empName)))
    setLoad(false)
  }

  // ── Import Pontaj ──────────────────────────────────────────────────────────
  const dlImportTemplate=()=>{
    const {y,m,days}=getRange()
    const mName=new Date(y,m-1).toLocaleString('ro-RO',{month:'long',year:'numeric'})
    const dayAbbr=['D','L','Ma','Mi','J','V','S']
    const wb=XLSX.utils.book_new()
    const dayNums=Array.from({length:days},(_,i)=>i+1)
    const hdr=['ANGAJAT',...dayNums]
    const dayRow=['',...dayNums.map(d=>dayAbbr[new Date(y,m-1,d).getDay()])]
    const rows=[hdr,dayRow]
    // Add current employees as empty rows
    data.forEach(emp=>rows.push([emp.name,...Array(days).fill('')]))
    rows.push([])
    rows.push(['INSTRUCȚIUNI: Completați fiecare zi cu: ore (08:00-16:00), sau cod normă (CO, CM, BO, O, N, CFP...). Lăsați gol dacă nu lucrează.'])
    const ws=XLSX.utils.aoa_to_sheet(rows)
    ws['!cols']=[{wch:28},...dayNums.map(()=>({wch:8}))]
    // Style header
    const bd={top:{style:'thin',color:{rgb:'000000'}},bottom:{style:'thin',color:{rgb:'000000'}},left:{style:'thin',color:{rgb:'000000'}},right:{style:'thin',color:{rgb:'000000'}}}
    hdr.forEach((_,c)=>{ const a=XLSX.utils.encode_cell({r:0,c}); if(!ws[a])ws[a]={v:'',t:'s'}; ws[a].s={fill:{fgColor:{rgb:'1F497D'}},font:{bold:true,color:{rgb:'FFFFFF'},sz:10},border:bd,alignment:{horizontal:'center'}} })
    dayRow.forEach((v,c)=>{
      if(c===0) return
      const a=XLSX.utils.encode_cell({r:1,c})
      if(!ws[a])ws[a]={v:v,t:'s'}
      const d=c; const dt=new Date(y,m-1,d); const isWE=dt.getDay()===0||dt.getDay()===6
      ws[a].s={fill:{fgColor:{rgb:isWE?'BFBFBF':'4472C4'}},font:{bold:true,color:{rgb:'FFFFFF'},sz:9},border:bd,alignment:{horizontal:'center'}}
    })
    XLSX.utils.book_append_sheet(wb,ws,`Pontaj ${mName}`)
    XLSX.writeFile(wb,`Template_Pontaj_${mName.replace(' ','_')}.xlsx`)
    showToast('✓ Template descărcat!')
  }

  const handleImportPontaj=async(e)=>{
    const file=e.target.files?.[0]; if(!file) return
    importPontajRef.current.value=''
    const reader=new FileReader()
    reader.onload=async(ev)=>{
      try{
        const wb=XLSX.read(ev.target.result,{type:'array'})
        const ws=wb.Sheets[wb.SheetNames[0]]
        const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:''})
        // Find header row (has 'ANGAJAT')
        const hdrIdx=rows.findIndex(r=>String(r[0]).toUpperCase().includes('ANGAJAT'))
        if(hdrIdx<0){showToast('Nu găsesc coloana ANGAJAT!','error');return}
        const hdr=rows[hdrIdx]
        const {y,m,days}=getRange()
        const records=[]
        for(let ri=hdrIdx+2;ri<rows.length;ri++){
          const row=rows[ri]
          const name=String(row[0]||'').trim(); if(!name||name.toUpperCase().includes('INSTRUC')) continue
          const emp=data.find(e=>e.name.toLowerCase()===name.toLowerCase())
          if(!emp) continue
          for(let ci=1;ci<hdr.length;ci++){
            const dayNum=Number(hdr[ci]); if(!dayNum||dayNum<1||dayNum>days) continue
            const val=String(row[ci]||'').trim(); if(!val) continue
            const dateStr=`${y}-${String(m).padStart(2,'0')}-${String(dayNum).padStart(2,'0')}`
            const normaCodes=['CO','CM','BO','BP','AM','CFP','M','O','N','PRM','PRB','LL']
            if(normaCodes.includes(val.toUpperCase())){
              records.push({employee_id:emp.id,date:dateStr,norma:val.toUpperCase(),check_in:null,check_out:null,lunch_break:false,diurna:false})
            } else {
              // Parse time: "08:00-16:00" or "08:00" or "8-16" 
              const timeMatch=val.match(/(\d{1,2})[:\.]?(\d{2})?\s*[-–]\s*(\d{1,2})[:\.]?(\d{2})?/)
              if(timeMatch){
                const ciT=`${String(timeMatch[1]).padStart(2,'0')}:${timeMatch[2]||'00'}`
                const coT=`${String(timeMatch[3]).padStart(2,'0')}:${timeMatch[4]||'00'}`
                records.push({employee_id:emp.id,date:dateStr,check_in:`${dateStr}T${ciT}:00+00:00`,check_out:`${dateStr}T${coT}:00+00:00`,norma:null,lunch_break:true,diurna:false})
              } else if(val==='1'||val.toUpperCase()==='P'||val.toUpperCase()==='X'){
                records.push({employee_id:emp.id,date:dateStr,check_in:`${dateStr}T08:00:00+00:00`,check_out:`${dateStr}T17:00:00+00:00`,norma:null,lunch_break:true,diurna:false})
              }
            }
          }
        }
        if(!records.length){showToast('Nicio înregistrare validă găsită','warn');return}
        setImpPontajPrev(records)
      }catch(err){showToast('Eroare la citire fișier: '+err.message,'error')}
    }
    reader.readAsArrayBuffer(file)
  }

  const confirmImportPontaj=async()=>{
    if(!impPontajPrev?.length) return
    setImportingPontaj(true)
    try{
      const uid=(await supabase.auth.getUser()).data.user?.id
      const withMeta=impPontajPrev.map(r=>({...r,created_by:uid,updated_by:uid,updated_at:new Date().toISOString()}))
      // Insert in chunks of 200
      for(let i=0;i<withMeta.length;i+=200){
        await supabase.from('pontaj_records').upsert(withMeta.slice(i,i+200),{onConflict:'employee_id,date',ignoreDuplicates:false})
      }
      showToast(`✓ ${impPontajPrev.length} înregistrări importate!`)
      setImpPontajPrev(null)
      loadReport()
    }catch(err){showToast('Eroare import: '+err.message,'error')}
    finally{setImportingPontaj(false)}
  }

  const exportITM=async()=>{
    if (!data.length){showToast('Fără date','warn');return}
    setExpITM(true)
    try {
      const {y,m,days}=getRange()
      const mName=new Date(y,m-1).toLocaleString('ro-RO',{month:'long',year:'numeric'})
      const wb=XLSX.utils.book_new()
      const dayNums=Array.from({length:days},(_,i)=>i+1)
      const dayAbbr=['D','L','Ma','Mi','J','V','S']
      const FIXED=3 // Col A=Nume, B=Functia, C=Program de Lucru

      // Load holidays
      const {data:calData}=await supabase.from('calendar_days').select('date').gte('date',`${y}-${String(m).padStart(2,'0')}-01`).lte('date',`${y}-${String(m).padStart(2,'0')}-${String(days).padStart(2,'0')}`)
      const legalSet=new Set((calData||[]).map(c=>c.date))

      const isOff=(d)=>{ const dt=new Date(y,m-1,d); return {we:dt.getDay()===0||dt.getDay()===6, leg:legalSet.has(`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`)} }

      // ── Build rows ──
      const R=[] // array of arrays

      // Antet
      R.push(['S.C. GAZPET INSTAL S.R.L.','','','Str. Fluturilor, nr.34, Loc.Ploiesti, Jud.Prahova'])
      R.push(['RO 22029920; J2007001650296','','','Tel./Fax 0244/435005  office@gazpet.ro'])
      R.push([])
      R.push([`FOAIE COLECTIVĂ DE PREZENȚĂ — ${mName.toUpperCase()}`])
      R.push([])

      // Header row (row idx 5)
      const HDR=['NUME ȘI PRENUME SALARIAT','FUNCȚIA','PROGRAM DE LUCRU',...dayNums,'TOTAL ZILE','TOTAL ORE']
      R.push(HDR)

      // Day names row (row idx 6)
      const DNR=['','','',...dayNums.map(d=>dayAbbr[new Date(y,m-1,d).getDay()]),'','']
      R.push(DNR)

      // Employee rows
      data.forEach(emp=>{
        const rCI=[emp.name, emp.position||'', 'Ora Intrare']
        const rCO=['','','Ora Ieșire']
        const rPM=['','','Pauza de Masă (ore)']
        const rOL=['','','Ore Lucrate']
        let tz=0, to=0

        for(let d=1;d<=days;d++){
          const ds=`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`
          const {we,leg}=isOff(d)
          const rec=emp.records?.find(r=>r.date===ds)
          if(rec?.norma){
            // Norma - always shown regardless of day type
            rCI.push(rec.norma); rCO.push(''); rPM.push(''); rOL.push('')
          } else if(rec?.check_in){
            // Has pontaj - show it even on weekends/holidays
            const hp=spansLunch(rec.check_in,rec.check_out)&&rec.lunch_break!==false
            const mins=netMins(rec.check_in,rec.check_out,rec.lunch_break!==false)
            rCI.push(fmt24(rec.check_in)); rCO.push(rec.check_out?fmt24(rec.check_out):'')
            rPM.push(hp?1:''); rOL.push(+(mins/60).toFixed(1))
            tz++; to+=mins
          } else if(we||leg){
            // No pontaj, it's a day off
            rCI.push(''); rCO.push(''); rPM.push(''); rOL.push(leg?'SL':'')
          } else {
            rCI.push(''); rCO.push(''); rPM.push(''); rOL.push('')
          }
        }
        rCI.push(tz,+(to/60).toFixed(1))
        rCO.push('',''); rPM.push('',''); rOL.push('','')
        R.push(rCI,rCO,rPM,rOL,[]) // 4 data rows + 1 empty separator
      })

      const ws=XLSX.utils.aoa_to_sheet(R)
      ws['!cols']=[{wch:26},{wch:16},{wch:22},...dayNums.map(()=>({wch:5.5})),{wch:11},{wch:11}]

      // ── Style cells ──
      const bd={top:{style:'thin',color:{rgb:'000000'}},bottom:{style:'thin',color:{rgb:'000000'}},left:{style:'thin',color:{rgb:'000000'}},right:{style:'thin',color:{rgb:'000000'}}}
      const sc=(r,c,s)=>{ const a=XLSX.utils.encode_cell({r,c}); if(!ws[a]) ws[a]={v:'',t:'s'}; ws[a].s=s }
      const alC={horizontal:'center',vertical:'center'}
      const alL={horizontal:'left',vertical:'center'}

      // Header row (5)
      HDR.forEach((v,c)=> sc(5,c,{fill:{fgColor:{rgb:'1F497D'}},font:{bold:true,color:{rgb:'FFFFFF'},sz:10},border:bd,alignment:c<3?alL:alC}))

      // Day names row (6)
      DNR.forEach((v,c)=>{
        const isWE=c>=3&&c<3+days&&(()=>{const d=c-2;const dt=new Date(y,m-1,d);return dt.getDay()===0||dt.getDay()===6})()
        const isLeg=c>=3&&c<3+days&&legalSet.has(`${y}-${String(m).padStart(2,'0')}-${String(c-2).padStart(2,'0')}`)
        sc(6,c,{fill:{fgColor:{rgb:isWE?'BFBFBF':isLeg?'FF8888':'4472C4'}},font:{bold:true,color:{rgb:'FFFFFF'},sz:9},border:bd,alignment:alC})
      })

      // Employee rows starting at 7
      let ri=7
      data.forEach(emp=>{
        for(let ro=0;ro<4;ro++){
          const TOTAL_C=FIXED+days+2
          for(let c=0;c<TOTAL_C;c++){
            let s={}
            if(c===0){ // Nume
              s=ro===0?{fill:{fgColor:{rgb:'E2EFDA'}},font:{bold:true,sz:10},border:bd,alignment:alL}:{fill:{fgColor:{rgb:'F5F5F5'}},border:bd,alignment:alL}
            } else if(c===1){ // Functia
              s=ro===0?{fill:{fgColor:{rgb:'E2EFDA'}},border:bd,alignment:alL}:{fill:{fgColor:{rgb:'F5F5F5'}},border:bd}
            } else if(c===2){ // Program de Lucru label
              s={fill:{fgColor:{rgb:'D6E4F0'}},font:{bold:true,sz:8},border:bd,alignment:alL}
            } else if(c>=3&&c<3+days){ // Day columns
              const d=c-2
              const ds=`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`
              const {we,leg}=isOff(d)
              const rec=emp.records?.find(r=>r.date===ds)
              const hasWork=rec?.check_in&&!rec?.norma
              const hasNorma=rec?.norma
              let rgb=null
              if(hasWork&&(we||leg)) rgb='FFC000'      // lucrat in zi libera = portocaliu
              else if(hasNorma) rgb='FFFF00'            // norma = galben
              else if(we) rgb='C0C0C0'                  // weekend fara pontaj = gri
              else if(leg) rgb='FFAAAA'                 // sarbatoare fara pontaj = rosu deschis
              s={...(rgb?{fill:{fgColor:{rgb}}}:{}),border:bd,alignment:alC,font:{sz:9}}
            } else { // Totals
              s={fill:{fgColor:{rgb:ro===0?'D9E1F2':'F5F5F5'}},font:ro===0?{bold:true}:{sz:9},border:bd,alignment:alC}
            }
            sc(ri+ro,c,s)
          }
        }
        ri+=5
      })

      XLSX.utils.book_append_sheet(wb,ws,'Pontaj ITM')
      XLSX.writeFile(wb,`Pontaj_ITM_${mName.replace(' ','_')}.xlsx`)
      playBeep(660,0.15); showToast('✓ Export ITM gata!')
    } catch(e){ showToast('Eroare: '+e.message,'error'); console.error(e) }
    finally{ setExpITM(false) }
  }

  const exportDiurne=async()=>{
    if(!df||!dt){showToast('Selectează perioada','warn');return}
    setExpD(true)
    try{
    let eq=supabase.from('employees').select('*').eq('active',true).order('name')
    if(!isAdmin){const siteIds=profile?.site_ids||[];if(siteIds.length>0)eq=eq.in('site_id',siteIds)}
    const {data:emps}=await eq

    // Determine month range
    const endDate=new Date(dt)
    const monthStart=`${endDate.getFullYear()}-${String(endDate.getMonth()+1).padStart(2,'0')}-01`
    // monthEnd = ultimă zi reală a lunii (nu dt!)
    const mEnd=new Date(monthStart);mEnd.setMonth(mEnd.getMonth()+1);mEnd.setDate(0)
    const monthEnd=mEnd.toISOString().split('T')[0]

    // Get working days from calendar for FULL month (not just to dt)
    const {data:calData}=await supabase.from('calendar_days').select('date,type').gte('date',monthStart).lte('date',monthEnd)
    const legalSet=new Set((calData||[]).filter(d=>d.type==='legal').map(d=>d.date))

    // Zile lucrătoare TOATĂ luna = Luni-Vineri minus sărbători legale (din calendar)
    // Nu folosim type='work' — calendarul stochează doar zilele non-lucrătoare
    let totalMonthWorkDays=0
    const mWd=new Date(monthStart)
    while(mWd<=mEnd){
      const s=mWd.toISOString().split('T')[0]
      if(mWd.getDay()!==0&&mWd.getDay()!==6&&!legalSet.has(s)) totalMonthWorkDays++
      mWd.setDate(mWd.getDate()+1)
    }

    // workDaySet pentru filtrarea normelor (Bug 2 fix)
    const workDaySet=new Set()
    const mWd2=new Date(monthStart)
    while(mWd2<=mEnd){
      const s=mWd2.toISOString().split('T')[0]
      if(mWd2.getDay()!==0&&mWd2.getDay()!==6&&!legalSet.has(s)) workDaySet.add(s)
      mWd2.setDate(mWd2.getDate()+1)
    }

    // Count working days from 1st to end of export period (dt) — pentru diurnaMax per perioadă
    let calWorkDays=0
    const d=new Date(monthStart)
    while(d<=endDate){
      const ds=d.toISOString().split('T')[0]
      if(d.getDay()!==0&&d.getDay()!==6&&!legalSet.has(ds)) calWorkDays++
      d.setDate(d.getDate()+1)
    }

    // Calculate working days ONLY within the export window df→dt (Bug 1 fix)
    let workDaysInPeriod=0
    const pd=new Date(df)
    const periodEnd=new Date(dt)
    while(pd<=periodEnd){const pds=pd.toISOString().split('T')[0];if(pd.getDay()!==0&&pd.getDay()!==6&&!legalSet.has(pds))workDaysInPeriod++;pd.setDate(pd.getDate()+1)}

    // Get all pontaj records from start of month to end of period (for norme cumulate)
    const {data:allRecs}=await supabase.from('pontaj_records').select('*,sites(name)').gte('date',monthStart).lte('date',monthEnd).in('employee_id',(emps||[]).map(e=>e.id))

    // Transe anterioare din aceeași lună — pentru calculul surplusului deja plătit
    // Luăm toate plățile cu period_from în aceeași lună ȘI period_to < df (perioadele deja finalizate)
    const {data:prevPaymentsInMonth}=await supabase.from('diurna_payments').select('*,diurna_payment_details(employee_id,amount)').gte('period_from',monthStart).lt('period_to',df).order('period_from',{ascending:true})

    // Get diurna records for the export period only
    const {data:diurnaRecs}=await supabase.from('pontaj_records').select('*,sites(name)').eq('diurna',true).gte('date',df).lte('date',dt).in('employee_id',(emps||[]).map(e=>e.id))

    // Build per-employee stats
    const empStats=(emps||[]).map(emp=>{
      const er=(diurnaRecs||[]).filter(r=>r.employee_id===emp.id)
      if(!er.length) return null

      // Norme cumulate: DOAR pe zile lucrătoare (exclude weekend/sărbători)
      const normeRecs=(allRecs||[]).filter(r=>r.employee_id===emp.id&&r.norma&&NORME.includes(r.norma)&&workDaySet.has(r.date))
      const normeCumulate=normeRecs.length

      // FIX CASCADĂ: numărăm diurne legitime ÎNAINTE de df direct din allRecs,
      // DOAR pe zile lucrătoare (workDaySet). Astfel, zilele "peste limită" din
      // perioadele anterioare NU mai consumă din capacitatea lunară a perioadelor următoare.
      const zilePlatiteAnterior=(allRecs||[]).filter(r=>
        r.employee_id===emp.id&&r.diurna===true&&r.date<df&&workDaySet.has(r.date)
      ).length

      // diurnaMax = min(capacitate lunară rămasă, capacitate reală a perioadei df→dt)
      const monthlyRemaining=Math.max(0,calWorkDays-normeCumulate-zilePlatiteAnterior)
      const normeInPeriod=(normeRecs||[]).filter(r=>r.date>=df&&r.date<=dt).length
      const periodCapacity=Math.max(0,workDaysInPeriod-normeInPeriod)
      const diurnaMax=Math.min(monthlyRemaining,periodCapacity)

      // Diurna reala = zile cu bifa diurna in perioada exportata (TOATE zilele, inclusiv weekend)
      const diurnaReala=er.length

      // Peste limita (per perioadă - folosit în tabelul principal)
      const pesteLimita=Math.max(0,diurnaReala-diurnaMax)

      // ── BUGET LUNAR & SURPLUS ────────────────────────────────────────────
      // Buget lunar = zile lucratoare din luna × diurna/zi (ex: 20 × 50 = 1000 RON)
      const bugetLunar=totalMonthWorkDays*diurnaAmt

      // Diurne bifate ÎNAINTE de această perioadă (din allRecs, indiferent dacă au fost salvate)
      // Folosim allRecs, NU diurna_payments — astfel funcționează corect chiar dacă
      // o perioadă anterioară nu a fost salvată (ex: export fără "Salvează Plată")
      const totalDiurneBefore=(allRecs||[]).filter(r=>
        r.employee_id===emp.id&&r.diurna===true&&r.date<df
      ).length
      // Plafonam la bugetLunar ca sa nu ajungem la rest negativ
      const platitAnteriorSuma=Math.min(bugetLunar,totalDiurneBefore*diurnaAmt)

      // Rest buget disponibil pentru această tranșă
      const restBuget=Math.max(0,bugetLunar-platitAnteriorSuma)

      // Suma acestui export pentru angajat
      const sumaAcestExport=diurnaReala*diurnaAmt

      // Depășire = cât din această tranșă depășește bugetul rămas
      const pesteBuget=Math.max(0,sumaAcestExport-restBuget)

      // Flag: există depășire de buget în această tranșă
      const depasesteLunar=pesteBuget>0

      // Alias pentru compatibilitate cu tabelul nota
      const pesteCumulat=pesteBuget
      const restDePlata=pesteBuget
      // ─────────────────────────────────────────────────────────────────────

      // Group by site
      const siteMap={}
      er.forEach(r=>{const s=r.sites?.name||'Nealocate'; siteMap[s]=(siteMap[s]||0)+1})
      const sites=Object.entries(siteMap).map(([name,zile])=>({name,zile,val:zile*diurnaAmt}))
      const p=emp.name.split(' ')
      return {prenume:p[0],nume:p.slice(1).join(' '),sites,totalZile:diurnaReala,totalVal:diurnaReala*diurnaAmt,diurnaMax,normeCumulate,zilePlatiteAnterior,pesteLimita,pesteCumulat,depasesteLunar,bugetLunar,platitAnteriorSuma,sumaAcestExport,restBuget,restDePlata}
    }).filter(Boolean).sort((a,b)=>(a.nume+a.prenume).localeCompare(b.nume+b.prenume))

    if(!empStats.length){showToast('Nu există diurne în perioadă','warn');setExpD(false);return}

    const from=new Date(df).toLocaleDateString('ro-RO'), to=new Date(dt).toLocaleDateString('ro-RO')
    const bd={top:{style:'thin',color:{rgb:'000000'}},bottom:{style:'thin',color:{rgb:'000000'}},left:{style:'thin',color:{rgb:'000000'}},right:{style:'thin',color:{rgb:'000000'}}}
    const HFILL='1F497D'; const TFILL='D9E1F2'; const GFILL='1F497D'; const WFILL='FFF2CC'
    const wb=XLSX.utils.book_new()
    const hdrCols=['Nr.','Prenume','Nume','Șantier','Zile Diurnă','Diurnă/zi (RON)','TOTAL RON','Diurnă Max. Admisă','Diurnă Peste Limită']

    const wsData=[]
    wsData.push(['S.C. GAZPET INSTAL S.R.L.','','','Str. Fluturilor, nr.34, Loc.Ploiesti, Jud.Prahova'])
    wsData.push(['RO 22029920; J2007001650296','','','Tel./Fax 0244/435005  office@gazpet.ro'])
    wsData.push([])
    wsData.push([`SITUAȚIE DIURNE: ${from} — ${to} (zile lucrătoare cumulate lună: ${calWorkDays})`])
    wsData.push([])
    wsData.push(hdrCols)

    let rowIdx=6; let nr=1
    const siteRowIdxs=[]
    const totalRowIdxs=[]
    const empRanges=[]

    empStats.forEach(emp=>{
      const startRow=rowIdx
      emp.sites.forEach((site,si)=>{
        // Only show diurnaMax and pesteLimita on first row per employee
        wsData.push([
          si===0?nr:'',
          si===0?emp.prenume:'',
          si===0?emp.nume:'',
          site.name,
          site.zile,
          diurnaAmt,
          site.val,
          si===0?emp.diurnaMax:'',
          si===0?(emp.pesteLimita>0?emp.pesteLimita:''):''
        ])
        siteRowIdxs.push({row:rowIdx,isAlt:si%2===1,hasPeste:si===0&&emp.pesteLimita>0})
        rowIdx++
      })
      // Total per angajat
      wsData.push(['','',`Total ${emp.prenume} ${emp.nume}`,'',emp.totalZile,'',emp.totalVal,emp.diurnaMax,emp.pesteLimita>0?emp.pesteLimita:0])
      totalRowIdxs.push({row:rowIdx,hasPeste:emp.pesteLimita>0})
      empRanges.push({start:startRow,end:rowIdx-1,rows:emp.sites.length})
      rowIdx++; nr++
    })

    wsData.push([])
    const totalGenZile=empStats.reduce((s,e)=>s+e.totalZile,0)
    const totalGenVal=empStats.reduce((s,e)=>s+e.totalVal,0)
    const totalPeste=empStats.reduce((s,e)=>s+e.pesteLimita,0)
    wsData.push(['','','','TOTAL GENERAL',totalGenZile,diurnaAmt,totalGenVal,'',totalPeste>0?totalPeste:0])
    const totalGenRow=rowIdx+1

    const ws=XLSX.utils.aoa_to_sheet(wsData)
    ws['!cols']=[{wch:5},{wch:16},{wch:18},{wch:28},{wch:12},{wch:14},{wch:12},{wch:18},{wch:18}]

    const sc=(r,c,s)=>{ const a=XLSX.utils.encode_cell({r,c}); if(!ws[a]) ws[a]={v:'',t:'s'}; ws[a].s=s }

    // Header row
    hdrCols.forEach((_,c)=>{
      const a=XLSX.utils.encode_cell({r:5,c})
      if(!ws[a]) ws[a]={v:hdrCols[c],t:'s'}
      const isWarn=c>=7
      ws[a].s={fill:{fgColor:{rgb:isWarn?'7F6000':HFILL}},font:{bold:true,color:{rgb:'FFFFFF'},sz:10},border:bd,alignment:{horizontal:'center',vertical:'center',wrapText:true}}
    })

    // Site rows
    siteRowIdxs.forEach(({row,isAlt,hasPeste})=>{
      for(let c=0;c<9;c++){
        const isWarnCol=c>=7
        let fill=isAlt?'F5F5F5':'FFFFFF'
        if(isWarnCol&&hasPeste) fill='FFF2CC'
        sc(row,c,{fill:{fgColor:{rgb:fill}},border:bd,alignment:{horizontal:c===0||c>=4?'center':'left',vertical:'center'},font:{sz:10,bold:isWarnCol&&hasPeste,color:{rgb:isWarnCol&&hasPeste?'7F6000':'000000'}}})
      }
    })

    // Total per angajat rows
    totalRowIdxs.forEach(({row,hasPeste})=>{
      for(let c=0;c<9;c++){
        const isWarnCol=c>=7
        sc(row,c,{fill:{fgColor:{rgb:isWarnCol&&hasPeste?'FFE699':TFILL}},font:{bold:true,sz:10,color:{rgb:isWarnCol&&hasPeste?'7F6000':'1F497D'}},border:bd,alignment:{horizontal:c===0||c>=4?'center':'left',vertical:'center'}})
      }
    })

    // Total general row
    for(let c=0;c<9;c++){
      sc(totalGenRow,c,{fill:{fgColor:{rgb:c>=7&&totalPeste>0?'FF0000':GFILL}},font:{bold:true,sz:10,color:{rgb:'FFFFFF'}},border:bd,alignment:{horizontal:'center',vertical:'center'}})
    }

    // Merge cells
    ws['!merges']=ws['!merges']||[]
    empRanges.forEach(({start,end,rows})=>{
      if(rows>1){
        [0,1,2,7,8].forEach(c=>{
          ws['!merges'].push({s:{r:start,c},e:{r:end,c}})
        })
      }
    })

    // Row heights
    ws['!rows']=[...Array(6).fill({hpx:14}),{hpx:22}]

    // ── NOTĂ SALARIALĂ ──────────────────────────────────────────────────────
    // Nota apare DOAR când angajatul depășește cumulat plafonul lunar (nu per perioadă)
    const angajatiPeste=empStats.filter(e=>e.depasesteLunar)
    if(angajatiPeste.length>0){
      let nr2=totalGenRow+2
      ws['!merges']=ws['!merges']||[]

      // Rând alertă ATENȚIE contabilitate (deasupra titlului)
      const ac=XLSX.utils.encode_cell({r:nr2,c:0})
      ws[ac]={v:'⚠  ATENTIE CONTABILITATE  ⚠  —  Verificati angajatii de mai jos inainte de procesarea salariilor  —  ⚠  ATENTIE CONTABILITATE  ⚠',t:'s'}
      ws[ac].s={fill:{fgColor:{rgb:'FF0000'}},font:{bold:true,sz:12,color:{rgb:'FFFFFF'}},alignment:{horizontal:'center',vertical:'center'}}
      ws['!merges'].push({s:{r:nr2,c:0},e:{r:nr2,c:9}})
      nr2++

      // Titlu
      const tc=XLSX.utils.encode_cell({r:nr2,c:0})
      ws[tc]={v:'NOTA SALARIALA — Zile diurna peste limita admisa (se adauga in salariu)',t:'s'}
      ws[tc].s={fill:{fgColor:{rgb:'C00000'}},font:{bold:true,sz:11,color:{rgb:'FFFFFF'}},border:bd,alignment:{horizontal:'left',vertical:'center'}}
      ws['!merges'].push({s:{r:nr2,c:0},e:{r:nr2,c:8}})
      nr2++

      // Sub-titlu
      const sc2=XLSX.utils.encode_cell({r:nr2,c:0})
      ws[sc2]={v:`Perioada: ${from} — ${to}  |  Zilele de mai jos depasesc nr. maxim de zile lucratoare si NU pot fi acordate ca diurna neimpozabila. Se impoziteaza ca venit salarial.`,t:'s'}
      ws[sc2].s={fill:{fgColor:{rgb:'FCE4D6'}},font:{italic:true,sz:9,color:{rgb:'843C0C'}},alignment:{horizontal:'left',vertical:'center',wrapText:true}}
      ws['!merges'].push({s:{r:nr2,c:0},e:{r:nr2,c:8}})
      nr2++

      // Header
      const nh=['Nr.','Prenume','Nume','Buget lunar (RON)','Platit anterior (RON)','Rest buget (RON)','Suma acest export (RON)','PESTE BUGET (RON)','→ DE ADAUGAT IN SALARIU (RON)']
      nh.forEach((h,c)=>{const a=XLSX.utils.encode_cell({r:nr2,c});ws[a]={v:h,t:'s'};ws[a].s={fill:{fgColor:{rgb:'843C0C'}},font:{bold:true,sz:10,color:{rgb:'FFFFFF'}},border:bd,alignment:{horizontal:'center',vertical:'center',wrapText:true}}})
      nr2++

      // Randuri angajati
      angajatiPeste.forEach((emp,i)=>{
        const row=[i+1,emp.prenume,emp.nume,emp.bugetLunar,emp.platitAnteriorSuma,emp.restBuget,emp.sumaAcestExport,emp.pesteCumulat,emp.restDePlata]
        row.forEach((v,c)=>{
          const a=XLSX.utils.encode_cell({r:nr2,c})
          ws[a]={v,t:typeof v==='number'?'n':'s'}
          const isKey=c===7||c===8
          ws[a].s={fill:{fgColor:{rgb:c===8?'C6EFCE':c===7?'FCE4D6':i%2===0?'FFFFFF':'F5F5F5'}},font:{bold:isKey,sz:10,color:{rgb:c===8?'375623':c===7?'843C0C':'000000'}},border:bd,alignment:{horizontal:c===0||c>=3?'center':'left',vertical:'center'}}
        })
        nr2++
      })

      // Total
      const totPlatitAnt=angajatiPeste.reduce((s,e)=>s+e.platitAnteriorSuma,0)
      const totSumaExport=angajatiPeste.reduce((s,e)=>s+e.sumaAcestExport,0)
      const totPeste=angajatiPeste.reduce((s,e)=>s+e.pesteCumulat,0)
      const totRest=angajatiPeste.reduce((s,e)=>s+e.restDePlata,0)
      const totRow=['','','TOTAL','-',totPlatitAnt,'-',totSumaExport,totPeste,totRest]
      totRow.forEach((v,c)=>{const a=XLSX.utils.encode_cell({r:nr2,c});ws[a]={v,t:typeof v==='number'?'n':'s'};ws[a].s={fill:{fgColor:{rgb:'C00000'}},font:{bold:true,sz:10,color:{rgb:'FFFFFF'}},border:bd,alignment:{horizontal:c===0||c>=3?'center':'left',vertical:'center'}}})
      // Extinde !ref ca SheetJS sa includa randurile noi in export
      const rng=XLSX.utils.decode_range(ws['!ref']||'A1')
      rng.e.r=Math.max(rng.e.r,nr2)
      rng.e.c=Math.max(rng.e.c,8)
      ws['!ref']=XLSX.utils.encode_range(rng)
    }
    // ────────────────────────────────────────────────────────────────────────

    XLSX.utils.book_append_sheet(wb,ws,'Diurne')
    XLSX.writeFile(wb,`Diurne_${from.replace(/\//g,'-')}.xlsx`)
    const msgPeste=totalPeste>0?` · ⚠ ${totalPeste} zile in salariu!`:''
    playBeep(); showToast(`✓ ${empStats.length} angajati · ${calWorkDays} zile lucr. cumulate${msgPeste}`)
    }catch(e){showToast('Eroare la export diurne','error')}finally{setExpD(false)}
  }

  const exportBancaDiurne=async()=>{
    // Export BT format — DOAR suma confirmată de diurnă (în limita bugetului lunar)
    // Surplusul care merge în salariu NU se include aici
    if(!df||!dt){showToast('Selectează perioada pentru diurne','warn');return}
    setExpBT(true)
    try{
      const d0=new Date(df); const monthStart=`${d0.getFullYear()}-${String(d0.getMonth()+1).padStart(2,'0')}-01`
      const d1=new Date(monthStart); d1.setMonth(d1.getMonth()+1); d1.setDate(0)
      const monthEnd=d1.toISOString().split('T')[0]

      let eq=supabase.from('employees').select('*').eq('active',true)
      if(!isAdmin){const siteIds=profile?.site_ids||[];if(siteIds.length>0)eq=eq.in('site_id',siteIds)}
      const {data:emps}=await eq
      const {data:recs}=await supabase.from('pontaj_records').select('*').eq('diurna',true).gte('date',df).lte('date',dt).in('employee_id',(emps||[]).map(e=>e.id))
      const {data:st}=await supabase.from('settings').select('*')
      const getSetting=(k,def)=>{const f=st?.find(x=>x.key===k);return f?f.value:def}
      const diurnaAmt=Number(getSetting('diurna_amount',50))
      const ibanFirma=getSetting('iban_firma','RO25BTRLRONCRT0T18017E01')
      const {data:calData2}=await supabase.from('calendar_days').select('date,type').gte('date',monthStart).lte('date',monthEnd)
      const legalSet=new Set((calData2||[]).filter(d=>d.type==='legal').map(d=>d.date))

      // Buget lunar = Luni-Vineri minus sărbători legale, toată luna
      let bugetZile=0
      const bWd=new Date(monthStart),bEnd=new Date(monthEnd)
      while(bWd<=bEnd){const s=bWd.toISOString().split('T')[0];if(bWd.getDay()!==0&&bWd.getDay()!==6&&!legalSet.has(s))bugetZile++;bWd.setDate(bWd.getDate()+1)}
      const bugetLunar=bugetZile*diurnaAmt

      // Transe anterioare platite in aceeasi luna
      const {data:prevPay}=await supabase.from('diurna_payments').select('*,diurna_payment_details(employee_id,amount)').gte('period_from',monthStart).lt('period_to',df).order('period_from',{ascending:true})

      // BIC lookup
      const BIC_MAP={BTRL:'BTRLRO22XXX',INGB:'INGBROBUXX',RNCB:'RNCBROBUXX',BRDE:'BRDEROBUXX',BACX:'BACXROBUXX',RZBR:'RZBRROBUXX',CECE:'CECEROBUXX',BRMA:'BRMAROBUXX',UGBI:'UGBIROBUXX',OTPV:'OTPVROBUXX',TCCL:'TCCLGB3L'}
      const getBIC=(iban)=>{if(!iban)return '';const code=(iban||'').replace(/\s/g,'').substring(4,8).toUpperCase();return BIC_MAP[code]||code+'ROBUXX'}
      const today=new Date()
      const excelDateStr=`${String(today.getDate()).padStart(2,'0')}/${String(today.getMonth()+1).padStart(2,'0')}/${today.getFullYear()}`

      const _td=new Date(); const excelDateStr2=`${String(_td.getDate()).padStart(2,'0')}/${String(_td.getMonth()+1).padStart(2,'0')}/${_td.getFullYear()}`
      const HDR=['OrderNumber','SourceAccountNumber','TargetAccountNumber','BeneficiaryName','BeneficiaryBankBIC','BeneficiaryFiscalCode','Amount','PaymentRef1','PaymentRef2','ValueDate','Urgent']
      const rows=[];let nr=1
      const faraIBAN=[]

      ;(emps||[]).forEach(emp=>{
        const diurneReale=(recs||[]).filter(r=>r.employee_id===emp.id).length
        if(!diurneReale) return
        const sumaExport=diurneReale*diurnaAmt
        // Suma platita anterior din aceeasi luna pentru acest angajat
        const platitAnt=(prevPay||[]).reduce((s,p)=>{const d=(p.diurna_payment_details||[]).find(x=>x.employee_id===emp.id);return s+(d?d.amount:0)},0)
        const restBuget=Math.max(0,bugetLunar-platitAnt)
        // Suma confirmata = doar ce incape in buget
        const sumaConfirmata=Math.min(sumaExport,restBuget)
        if(sumaConfirmata<=0) return  // tot surplusul — nu apare in BT diurne

        if(!emp.iban) faraIBAN.push(emp.name)
        rows.push([nr++,ibanFirma,emp.iban||'',emp.name,getBIC(emp.iban),'',sumaConfirmata,'diurna','diurna',excelDateStr2,'F'])
      })

      if(!rows.length){showToast('Nu există diurne confirmate de plătit în această perioadă','warn');setExpBT(false);return}

      const data=[HDR,...rows]
      const ws=XLSX.utils.aoa_to_sheet(data)
      ws['!cols']=[{wch:12},{wch:28},{wch:28},{wch:38},{wch:14},{wch:16},{wch:12},{wch:10},{wch:10},{wch:12},{wch:8}]
      const wb=XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb,ws,'DIURNE')
      XLSX.writeFile(wb,`BT_Diurne_${df}_${dt}.xlsx`)
      const totalConfirmat=rows.reduce((s,r)=>s+r[6],0)
      const msg=faraIBAN.length?` · ⚠ IBAN lipsă: ${faraIBAN.join(', ')}`:' ✓'
      playBeep(1040,0.18); showToast(`✓ Export BT Diurne — ${rows.length} angajați · ${totalConfirmat.toLocaleString('ro-RO')} RON${msg}`)
    }catch(e){showToast('Eroare export BT','error')}finally{setExpBT(false)}
  }

  const exportSupl=async()=>{
    if(!sf||!st2){showToast('Selectează perioada','warn');return}
    setExpS(true)
    try{
    let eq=supabase.from('employees').select('*').eq('active',true).order('name')
    if(!isAdmin){const siteIds=profile?.site_ids||[];if(siteIds.length>0)eq=eq.in('site_id',siteIds)}
    const {data:emps}=await eq
    const {data:recs}=await supabase.from('pontaj_records').select('*').eq('meal_supplement',true).gte('date',sf).lte('date',st2).in('employee_id',(emps||[]).map(e=>e.id))
    const empStats=(emps||[]).map(emp=>{const er=(recs||[]).filter(r=>r.employee_id===emp.id);return {...emp,zile:er.length,val:er.length*suplAmt}}).filter(e=>e.zile>0).sort((a,b)=>a.name.localeCompare(b.name))
    if(!empStats.length){showToast('Nu există suplimente în perioadă','warn');setExpS(false);return}
    const from=new Date(sf).toLocaleDateString('ro-RO'),to=new Date(st2).toLocaleDateString('ro-RO')
    const bd={top:{style:'thin',color:{rgb:'000000'}},bottom:{style:'thin',color:{rgb:'000000'}},left:{style:'thin',color:{rgb:'000000'}},right:{style:'thin',color:{rgb:'000000'}}}
    const wb=XLSX.utils.book_new()
    const hdrCols=['Nr.','Prenume','Nume','Departament','Funcție','Zile Supliment','Valoare/zi (RON)','TOTAL RON']
    const rows=[
      ['S.C. GAZPET INSTAL S.R.L.','','','Str. Fluturilor, nr.34, Loc.Ploiesti, Jud.Prahova'],
      ['RO 22029920; J2007001650296','','','Tel./Fax 0244/435005  office@gazpet.ro'],
      [],
      [`SITUAȚIE SUPLIMENT HRANĂ: ${from} — ${to}`],
      [],
      hdrCols,
      ...empStats.map((e,i)=>{const p=e.name.split(' ');return [i+1,p[0],p.slice(1).join(' '),e.department,e.position||'',e.zile,suplAmt,e.val]}),
      [],
      ['','','','','TOTAL',empStats.reduce((s,e)=>s+e.zile,0),suplAmt,empStats.reduce((s,e)=>s+e.val,0)]
    ]
    const ws=XLSX.utils.aoa_to_sheet(rows)
    ws['!cols']=[{wch:5},{wch:18},{wch:18},{wch:14},{wch:20},{wch:16},{wch:14},{wch:14}]
    hdrCols.forEach((_,c)=>{
      const a=XLSX.utils.encode_cell({r:5,c})
      if(!ws[a]) ws[a]={v:hdrCols[c],t:'s'}
      ws[a].s={fill:{fgColor:{rgb:'1A6B1A'}},font:{bold:true,color:{rgb:'FFFFFF'},sz:10},border:bd,alignment:{horizontal:'center',vertical:'center'}}
    })
    empStats.forEach((_,i)=>{
      for(let c=0;c<8;c++){
        const a=XLSX.utils.encode_cell({r:6+i,c})
        if(!ws[a]) ws[a]={v:'',t:'s'}
        ws[a].s={fill:{fgColor:{rgb:i%2===0?'FFFFFF':'F5F5F5'}},border:bd,alignment:{horizontal:c===0||c>=5?'center':'left',vertical:'center'},font:{sz:10}}
      }
    })
    const tr=6+empStats.length+1
    for(let c=0;c<8;c++){
      const a=XLSX.utils.encode_cell({r:tr,c})
      if(!ws[a]) ws[a]={v:'',t:'s'}
      ws[a].s={fill:{fgColor:{rgb:'D9F2D9'}},font:{bold:true,sz:10},border:bd,alignment:{horizontal:'center',vertical:'center'}}
    }
    XLSX.utils.book_append_sheet(wb,ws,'Supliment Hrana')
    XLSX.writeFile(wb,`Supliment_Hrana_${from.replace(/\//g,'-')}.xlsx`)
    playBeep(); showToast(`✓ ${empStats.length} angajați exportați`)
    }catch(e){showToast('Eroare la export supliment','error')}finally{setExpS(false)}
  }

  const mLabel=()=>{const [y,m]=month.split('-').map(Number);return new Date(y,m-1).toLocaleString('ro-RO',{month:'long',year:'numeric'})}

  return (
    <Layout>
      <Toast toast={toast}/>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:18}}>
        <div style={{fontSize:19,fontWeight:800}}>Rapoarte</div>
        <div style={{display:'flex',gap:7,flexWrap:'wrap',alignItems:'center'}}>
          <input type="month" value={month} onChange={e=>setMonth(e.target.value)} style={{...S.input,width:'auto',padding:'6px 10px'}}/>
          {isAdmin&&<><select value={deptF} onChange={e=>setDeptF(e.target.value)}><option>Toate</option>{DEPARTMENTS.map(d=><option key={d}>{d}</option>)}</select>
          <select value={siteF} onChange={e=>setSiteF(e.target.value)}><option value="Toate">Toate</option>{sites.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></>}
          <div style={{display:'flex',background:G.surface,border:`1px solid ${G.border}`,borderRadius:8,overflow:'hidden'}}>
            {[['summary','📊'],['detailed','📋']].map(([v,l])=><button key={v} onClick={()=>setView(v)} style={{background:view===v?'#21262D':'none',color:view===v?G.text:G.muted,border:'none',padding:'6px 11px',cursor:'pointer',fontFamily:'inherit',fontSize:12,fontWeight:700}}>{l}</button>)}
          </div>
          <div style={{position:'relative'}}>
            <span style={{position:'absolute',left:9,top:'50%',transform:'translateY(-50%)',fontSize:13,pointerEvents:'none'}}>🔍</span>
            <input value={rSearch} onChange={e=>setRSearch(e.target.value)} placeholder="Caută angajat..." style={{...S.input,paddingLeft:30,margin:0,fontSize:11,height:32,width:170}}/>
          </div>
          <button onClick={exportITM} disabled={expITM||load||!data.length} style={{...S.btnP,background:'#1A6B1A',fontSize:12,display:'flex',alignItems:'center',gap:5}}>{expITM?<><div className="sp"/>...</>:'📄 Export ITM'}</button>
          <button onClick={dlImportTemplate} disabled={load||!data.length} style={{...S.btnS,fontSize:12,display:'flex',alignItems:'center',gap:5}} title="Descarcă template Excel pentru import">⬇ Template Import</button>
          <input ref={importPontajRef} type="file" accept=".xlsx,.xls" style={{display:'none'}} onChange={handleImportPontaj}/>
          <button onClick={()=>importPontajRef.current?.click()} disabled={load} style={{...S.btnP,background:'#3A1A6B',fontSize:12,display:'flex',alignItems:'center',gap:5}}>📥 Import Pontaj</button>
        </div>
      </div>

      {/* Istoric modal */}
      {showIstoric&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.8)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
          <div style={{...S.card,width:900,maxHeight:'85vh',display:'flex',flexDirection:'column'}}>
            <div style={{padding:'16px 20px',borderBottom:`1px solid ${G.border}`,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div style={{fontSize:15,fontWeight:800}}>📋 Istoric Plăți Diurne</div>
              <button onClick={()=>{setShowIstoric(false);setSelectedPayment(null);setPaymentDetails([])}} style={{background:'none',border:'none',color:G.muted,cursor:'pointer',fontSize:20}}>✕</button>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1.5fr',flex:1,overflow:'hidden'}}>
              {/* Lista plati */}
              <div style={{borderRight:`1px solid ${G.border}`,overflowY:'auto'}}>
                {!payments.length?<div style={{padding:30,textAlign:'center',color:G.muted,fontSize:12}}>Nicio plată înregistrată</div>
                :payments.map(p=>{
                  const isSelected=selectedPayment?.id===p.id
                  return <div key={p.id} onClick={()=>{setSelectedPayment(p);loadPaymentDetails(p.id)}}
                    style={{padding:'12px 16px',cursor:'pointer',background:isSelected?'#1C2128':'transparent',borderBottom:`1px solid ${G.border}`,transition:'background .15s'}}>
                    <div style={{display:'flex',justifyContent:'space-between',marginBottom:4,alignItems:'flex-start'}}>
                      <span style={{fontSize:12,fontWeight:700,color:G.blue}}>
                        {new Date(p.period_from).toLocaleDateString('ro-RO')} — {new Date(p.period_to).toLocaleDateString('ro-RO')}
                      </span>
                      <div style={{display:'flex',gap:6,alignItems:'center'}}>
                        <span style={{fontSize:11,color:G.muted}}>{new Date(p.payment_date).toLocaleDateString('ro-RO')}</span>
                        <button onClick={async(e)=>{
                          e.stopPropagation()
                          if(!window.confirm(`Ștergi plata ${new Date(p.period_from).toLocaleDateString('ro-RO')} — ${new Date(p.period_to).toLocaleDateString('ro-RO')}?`)) return
                          await supabase.from('diurna_payments').delete().eq('id',p.id)
                          if(selectedPayment?.id===p.id){setSelectedPayment(null);setPaymentDetails([])}
                          loadPayments()
                          showToast('✓ Plată ștearsă')
                        }} style={{background:'none',border:`1px solid ${G.red}44`,borderRadius:6,padding:'2px 7px',cursor:'pointer',color:G.red,fontSize:11}}>🗑️</button>
                      </div>
                    </div>
                    <div style={{display:'flex',gap:12,fontSize:11}}>
                      <span style={{color:G.muted}}>👥 {p.total_employees} ang.</span>
                      <span style={{color:G.muted}}>📅 {p.total_days} zile</span>
                      <span style={{color:G.green,fontWeight:700}}>{Number(p.total_amount).toLocaleString('ro-RO')} RON</span>
                    </div>
                  </div>
                })}
              </div>
              {/* Detalii plata selectata */}
              <div style={{overflowY:'auto',padding:16}}>
                {!selectedPayment?<div style={{textAlign:'center',color:G.muted,padding:40,fontSize:12}}>← Selectează o plată</div>
                :<>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
                    <div style={{fontSize:13,fontWeight:700}}>
                      {new Date(selectedPayment.period_from).toLocaleDateString('ro-RO')} — {new Date(selectedPayment.period_to).toLocaleDateString('ro-RO')}
                    </div>
                    <button onClick={()=>reexportPayment(selectedPayment)} style={{...S.btnP,background:'#1A6B1A',fontSize:11,padding:'5px 12px'}}>⬇ Reexportă Excel</button>
                  </div>
                  <table style={{width:'100%',fontSize:12}}>
                    <thead><tr style={{background:G.bg}}><th>Prenume</th><th>Nume</th><th style={{textAlign:'center'}}>Zile</th><th style={{textAlign:'right'}}>Sumă</th></tr></thead>
                    <tbody>
                      {paymentDetails.map((d,i)=>{
                        const p=d.employee_name.split(' ')
                        return <tr key={d.id} style={{background:i%2===0?'transparent':'#1C2128'}}>
                          <td style={{padding:'6px 8px'}}>{p[0]}</td>
                          <td style={{padding:'6px 8px',fontWeight:600}}>{p.slice(1).join(' ')}</td>
                          <td style={{padding:'6px 8px',textAlign:'center',color:G.blue}}>{d.days}</td>
                          <td style={{padding:'6px 8px',textAlign:'right',color:G.green,fontWeight:700}}>{Number(d.amount).toLocaleString('ro-RO')} RON</td>
                        </tr>
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{background:'#1C2128',fontWeight:700}}>
                        <td colSpan={2} style={{padding:'8px',color:G.muted}}>TOTAL</td>
                        <td style={{padding:'8px',textAlign:'center',color:G.blue}}>{selectedPayment.total_days}</td>
                        <td style={{padding:'8px',textAlign:'right',color:G.green}}>{Number(selectedPayment.total_amount).toLocaleString('ro-RO')} RON</td>
                      </tr>
                    </tfoot>
                  </table>
                </>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Export Diurne + Supliment Hrana */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:16}}>
        <div style={{...S.card,padding:14,display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
          <span style={{fontSize:12,fontWeight:700,color:G.orange}}>💰 Export Diurne</span>
          <span style={{fontSize:11,color:G.muted}}>De la:</span>
          <input type="date" value={df} onChange={e=>setDf(e.target.value)} style={{...S.input,width:'auto',padding:'5px 9px',fontSize:12}}/>
          <span style={{fontSize:11,color:G.muted}}>Până la:</span>
          <input type="date" value={dt} onChange={e=>setDt(e.target.value)} style={{...S.input,width:'auto',padding:'5px 9px',fontSize:12}}/>
          <button onClick={exportDiurne} disabled={expD} style={{...S.btnP,background:'#5A3A00',fontSize:12,display:'flex',alignItems:'center',gap:5}}>{expD?<><div className="sp"/>...</>:'⬇ Excel'}</button>
          <button onClick={savePayment} disabled={savingPayment} style={{...S.btnP,background:'#1A4A1A',fontSize:12,display:'flex',alignItems:'center',gap:5}}>{savingPayment?<><div className="sp"/>...</>:'💾 Salvează Plată'}</button>
          <button onClick={exportBancaDiurne} disabled={expBT} style={{...S.btnP,background:'#0A3A6A',fontSize:12,display:'flex',alignItems:'center',gap:5}}>{expBT?<><div className="sp"/>...</>:'🏦 Export Bancă'}</button>
          <button onClick={()=>setShowIstoric(true)} style={{...S.btnS,fontSize:12}}>📋 Istoric</button>
        </div>
        <div style={{...S.card,padding:14,display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
          <span style={{fontSize:12,fontWeight:700,color:'#56D364'}}>🍔 Export Supliment Hrană</span>
          <span style={{fontSize:11,color:G.muted}}>De la:</span>
          <input type="date" value={sf} onChange={e=>setSf(e.target.value)} style={{...S.input,width:'auto',padding:'5px 9px',fontSize:12}}/>
          <span style={{fontSize:11,color:G.muted}}>Până la:</span>
          <input type="date" value={st2} onChange={e=>setSt2(e.target.value)} style={{...S.input,width:'auto',padding:'5px 9px',fontSize:12}}/>
          <button onClick={exportSupl} disabled={expS} style={{...S.btnP,background:'#1A3A1A',fontSize:12,display:'flex',alignItems:'center',gap:5}}>{expS?<><div className="sp"/>...</>:'⬇ Excel'}</button>
        </div>
      </div>

      {/* Import preview modal */}
      {impPontajPrev&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.8)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
          <div style={{...S.card,width:700,maxHeight:'80vh',display:'flex',flexDirection:'column'}}>
            <div style={{padding:'16px 20px',borderBottom:`1px solid ${G.border}`,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div style={{fontSize:14,fontWeight:800}}>📥 Preview Import — {impPontajPrev.length} înregistrări</div>
              <button onClick={()=>setImpPontajPrev(null)} style={{background:'none',border:'none',color:G.muted,cursor:'pointer',fontSize:20}}>✕</button>
            </div>
            <div style={{overflowY:'auto',flex:1,padding:16}}>
              <table><thead><tr style={{background:G.bg}}><th>#</th><th>Angajat</th><th>Data</th><th>Intrare</th><th>Ieșire</th><th>Normă</th></tr></thead>
              <tbody>{impPontajPrev.slice(0,50).map((r,i)=>{
                const emp=data.find(e=>e.id===r.employee_id)
                return <tr key={i}>
                  <td style={{fontSize:10,color:G.dim}}>{i+1}</td>
                  <td style={{fontWeight:600,fontSize:12}}>{emp?.name||r.employee_id}</td>
                  <td style={{fontSize:11,color:G.blue}}>{new Date(r.date+'T12:00').toLocaleDateString('ro-RO',{day:'2-digit',month:'2-digit'})}</td>
                  <td style={{fontSize:11,color:G.green}}>{r.check_in?new Date(r.check_in).toTimeString().slice(0,5):'—'}</td>
                  <td style={{fontSize:11,color:G.red}}>{r.check_out?new Date(r.check_out).toTimeString().slice(0,5):'—'}</td>
                  <td>{r.norma?<span style={{background:G.yellowDim,color:G.yellow,padding:'1px 6px',borderRadius:10,fontSize:11}}>{r.norma}</span>:'—'}</td>
                </tr>
              })}</tbody></table>
              {impPontajPrev.length>50&&<div style={{textAlign:'center',fontSize:11,color:G.muted,marginTop:8}}>...și încă {impPontajPrev.length-50} înregistrări</div>}
            </div>
            <div style={{padding:'12px 20px',borderTop:`1px solid ${G.border}`,display:'flex',gap:10,justifyContent:'flex-end'}}>
              <button onClick={()=>setImpPontajPrev(null)} style={{...S.btnS}}>Anulează</button>
              <button onClick={confirmImportPontaj} disabled={importingPontaj} style={{...S.btnP,background:'#3A1A6B',display:'flex',alignItems:'center',gap:6}}>{importingPontaj?<><div className="sp"/>Se importă...</>:`✓ Confirmă import (${impPontajPrev.length} rec.)`}</button>
            </div>
          </div>
        </div>
      )}

      {load?<div style={{display:'flex',justifyContent:'center',padding:60}}><div className="sp" style={{width:28,height:28}}/></div>
      :view==='summary'?(
        <div style={{...S.card,overflow:'hidden'}}>
          <table>
            <thead><tr style={{background:G.bg}}><th>Angajat</th><th>Dept.</th><th>Șantier</th><th>Zile Lucrate</th><th>Ore Brute</th><th>☕</th><th>Ore Nete</th><th>💰 Diurne</th><th>Norme</th><th>Status</th></tr></thead>
            <tbody>
              {!data.length?<tr><td colSpan={10} style={{textAlign:'center',color:G.muted,padding:40}}>Nicio dată</td></tr>
              :data.filter(emp=>!rSearch||emp.name.toLowerCase().includes(rSearch.toLowerCase())).map(emp=>{
                const over=emp.avgMins>510
                return <tr key={emp.id}>
                  <td><div style={{display:'flex',alignItems:'center',gap:8}}><Avatar name={emp.name} id={emp.id} size={26}/><span style={{fontWeight:600,fontSize:12}}>{emp.name}</span></div></td>
                  <td><span className="badge bd">{emp.department}</span></td>
                  <td style={{fontSize:11,color:G.purple}}>{emp.sites?.name||'—'}</td>
                  <td><span style={{color:G.blue,fontWeight:700}}>{emp.workDays}</span><span style={{color:G.dim,fontSize:11}}> /{emp.days}</span></td>
                  <td style={{color:G.muted,fontSize:11}}>{minsToHM(emp.totalGross)}</td>
                  <td style={{fontSize:11}}>{emp.lunchDays>0?<span style={{color:'#79C0FF'}}>☕{emp.lunchDays}×</span>:'—'}</td>
                  <td style={{fontWeight:800,color:G.yellow}}>{minsToHM(emp.totalMins)}</td>
                  <td style={{color:G.orange,fontWeight:700,fontSize:12}}>{emp.diurnaDays>0?`${emp.diurnaDays}z·${emp.diurnaDays*diurnaAmt}RON`:'—'}</td>
                  <td style={{fontSize:11}}>{Object.entries(emp.norme||{}).map(([k,v])=><span key={k} style={{color:G.yellow,marginRight:3}}>{k}:{v}</span>)}</td>
                  <td><span style={{padding:'2px 7px',borderRadius:20,fontSize:11,fontWeight:700,background:over?G.yellowDim:G.greenDim,color:over?G.yellow:G.green,border:`1px solid ${over?G.yellow:G.green}44`}}>{over?'⚡Extra':'✓Normal'}</span></td>
                </tr>
              })}
            </tbody>
          </table>
        </div>
      ):(
        <div style={{...S.card,overflow:'hidden'}}>
          <table>
            <thead><tr style={{background:G.bg}}><th>Data</th><th>Angajat</th><th>Dept.</th><th>Intrare</th><th>Ieșire</th><th>Pauză</th><th>Net</th><th>Normă</th><th>💰</th></tr></thead>
            <tbody>
              {!detailed.length?<tr><td colSpan={9} style={{textAlign:'center',color:G.muted,padding:40}}>Nicio înregistrare</td></tr>
              :detailed.filter(r=>!rSearch||r.empName.toLowerCase().includes(rSearch.toLowerCase())).map(r=>{
                const net=netMins(r.check_in,r.check_out,r.lunch_break!==false)
                const lo=r.lunch_break!==false&&spansLunch(r.check_in,r.check_out)
                return <tr key={r.id}>
                  <td style={{fontWeight:600,color:G.blue,fontSize:11}}>{new Date(r.date+'T12:00').toLocaleDateString('ro-RO',{weekday:'short',day:'2-digit',month:'2-digit'})}</td>
                  <td><div style={{display:'flex',alignItems:'center',gap:6}}><Avatar name={r.empName} size={22}/><span style={{fontWeight:600,fontSize:12}}>{r.empName}</span></div></td>
                  <td><span className="badge bd">{r.empDept}</span></td>
                  <td style={{color:G.green,fontWeight:600,fontSize:11}}>{r.check_in?`⬇ ${fmt24(r.check_in)}`:'—'}</td>
                  <td style={{color:r.check_out?G.red:G.yellow,fontWeight:600,fontSize:11}}>{r.check_out?`⬆ ${fmt24(r.check_out)}`:r.check_in?'lipsă':'—'}</td>
                  <td style={{fontSize:11}}>{lo?<span style={{color:'#79C0FF'}}>☕</span>:'—'}</td>
                  <td style={{fontWeight:700,color:G.yellow,fontSize:12}}>{net>0?minsToHM(net):'—'}</td>
                  <td>{r.norma?<span style={{background:G.yellowDim,color:G.yellow,padding:'2px 6px',borderRadius:12,fontSize:11,fontWeight:700}}>{r.norma}</span>:'—'}</td>
                  <td>{r.diurna?<span style={{color:G.orange}}>💰</span>:'—'}</td>
                </tr>
              })}
            </tbody>
          </table>
        </div>
      )}
    </Layout>
  )
}

// ─── Admin Page ───────────────────────────────────────────────────────────────
function AdminPage() {
  const { profile } = useAuth()
  const isAdmin=['admin','superadmin'].includes(profile?.role)
  const isSuperAdmin=profile?.role==='superadmin'
  const [tab,setTab]=useState('sites')
  const [sites,setSites]=useState([]); const [managers,setManagers]=useState([]); const [employees,setEmployees]=useState([])
  const [calDays,setCalDays]=useState([]); const [settings,setSettings]=useState({diurna_amount:'50',work_hours_per_day:'8'})
  const [load,setLoad]=useState(true); const [toast,showToast]=useToast()
  const fileRef=useRef(null); const calRef=useRef(null)
  const [siteName,setSiteName]=useState(''); const [addingSite,setAddingSite]=useState(false)
  const [editSiteItem,setEditSiteItem]=useState(null); const [editSiteName,setEditSiteName]=useState('')
  const [deletingSite,setDeletingSite]=useState(null) // site being confirmed for delete
  const [nEmail,setNEmail]=useState(''); const [nName,setNName]=useState(''); const [nSite,setNSite]=useState(''); const [nRole,setNRole]=useState('manager'); const [nPwd,setNPwd]=useState(''); const [creating,setCreating]=useState(false)
  const [editMgr,setEditMgr]=useState(null) // manager being edited
  const [eName,setEName]=useState(''); const [eDept,setEDept]=useState(DEPARTMENTS[0]); const [ePos,setEPos]=useState(''); const [eSite,setESite]=useState(''); const [eHireDate,setEHireDate]=useState(''); const [addingE,setAddingE]=useState(false)
  const [empStatusFilter,setEmpStatusFilter]=useState('active') // all | active | inactive
  const [empSearch,setEmpSearch]=useState('')
  const [empDeptFilter,setEmpDeptFilter]=useState('all')
  const [empPosFilter,setEmpPosFilter]=useState('all')
  const [editEmp,setEditEmp]=useState(null)
  const [deleteEmpItem,setDeleteEmpItem]=useState(null)
  const [impPrev,setImpPrev]=useState(null); const [importing,setImporting]=useState(false)

  const [calYear,setCalYear]=useState(new Date().getFullYear())
  useEffect(()=>{ loadAll() },[tab])
  const loadAll=async()=>{
    setLoad(true)
    const [s,p,e,c,st,ps]=await Promise.all([
      supabase.from('sites').select('*').order('name'),
      supabase.from('profiles').select('*').order('name'),
      supabase.from('employees').select('*,sites(name)').order('name'),
      supabase.from('calendar_days').select('*').order('date').limit(60),
      supabase.from('settings').select('*'),
      supabase.from('profile_sites').select('*'),
    ])
    setSites(s.data||[])
    // Attach site_ids to each manager
    const mgrs=(p.data||[]).map(m=>({...m,site_ids:(ps.data||[]).filter(x=>x.profile_id===m.id).map(x=>x.site_id)}))
    setManagers(mgrs)
    setEmployees(e.data||[]); setCalDays(c.data||[])
    const sm={}; (st.data||[]).forEach(x=>{sm[x.key]=x.value}); setSettings(sm)
    setLoad(false)
  }

  const addSite=async()=>{ if(!siteName.trim()){showToast('Introduceți numele','warn');return}; setAddingSite(true); const {error}=await supabase.from('sites').insert({name:siteName.trim(),active:true}); if(!error){showToast(`✓ ${siteName}`);setSiteName('');loadAll()} else showToast('Eroare','error'); setAddingSite(false) }
  const toggleSite=async(s)=>{ await supabase.from('sites').update({active:!s.active}).eq('id',s.id); setSites(prev=>prev.map(x=>x.id===s.id?{...x,active:!x.active}:x)) }
  const saveSiteName=async()=>{ if(!editSiteItem||!editSiteName.trim()) return; const {error}=await supabase.from('sites').update({name:editSiteName.trim()}).eq('id',editSiteItem.id); if(!error){showToast(`✓ Redenumit: ${editSiteName}`);setEditSiteItem(null);loadAll()} else showToast('Eroare','error') }
  const deleteSite=async(s)=>{
    // Check if any employees are on this site
    const {data:emps}=await supabase.from('employees').select('id').eq('site_id',s.id).limit(1)
    if(emps?.length>0){showToast('Nu poți șterge — există angajați alocați pe acest șantier!','error');setDeletingSite(null);return}
    const {error}=await supabase.from('sites').delete().eq('id',s.id)
    if(!error){showToast(`✓ Șantier "${s.name}" șters`);setDeletingSite(null);loadAll()} else showToast('Eroare la ștergere','error')
  }
  const saveEditMgr=async()=>{
    if(!editMgr) return
    const {error}=await supabase.from('profiles').update({name:editMgr.name,role:editMgr.role}).eq('id',editMgr.id)
    if(!error){
      // Update sites in profile_sites table
      await supabase.from('profile_sites').delete().eq('profile_id',editMgr.id)
      if(editMgr.role!=='admin'&&editMgr.site_ids?.length>0){
        await supabase.from('profile_sites').insert(editMgr.site_ids.map(sid=>({profile_id:editMgr.id,site_id:sid})))
      }
      showToast(`✓ Manager actualizat: ${editMgr.name}`);setEditMgr(null);loadAll()
    } else showToast('Eroare','error')
  }
  const saveSetting=async(k,v)=>{ await supabase.from('settings').upsert({key:k,value:v,updated_at:new Date().toISOString()},{onConflict:'key'}); setSettings(prev=>({...prev,[k]:v})); showToast('✓ Salvat') }

  const createManager=async()=>{
    if(!nEmail||!nPwd||!nName){showToast('Completați toate câmpurile','warn');return}
    setCreating(true)
    const {data:au,error:ae}=await supabase.auth.signUp({email:nEmail,password:nPwd})
    if(ae){showToast(ae.message,'error');setCreating(false);return}
    if(au.user){
      await supabase.from('profiles').upsert({id:au.user.id,email:nEmail,name:nName,role:nRole})
      if(nRole==='manager'&&nSite) await supabase.from('profile_sites').insert({profile_id:au.user.id,site_id:Number(nSite)})
      showToast(`✓ ${nName}`); setNEmail('');setNName('');setNPwd('');loadAll()
    }
    setCreating(false)
  }

  const addEmployee=async()=>{ if(!eName.trim()){showToast('Introduceți numele','warn');return}; setAddingE(true); const {error}=await supabase.from('employees').insert({name:eName.trim(),department:eDept,position:ePos||null,site_id:eSite?Number(eSite):null,active:true,hire_date:eHireDate||null}); if(!error){showToast(`✓ ${eName}`);setEName('');setEPos('');setEHireDate('');loadAll()} else showToast('Eroare','error'); setAddingE(false) }
  const toggleEmp=async(emp)=>{ const updates={active:!emp.active}; if(emp.active&&!emp.termination_date) updates.termination_date=new Date().toISOString().split('T')[0]; await supabase.from('employees').update(updates).eq('id',emp.id); setEmployees(prev=>prev.map(e=>e.id===emp.id?{...e,...updates}:e)); showToast(emp.active?`${emp.name} dezactivat`:`${emp.name} reactivat`,emp.active?'warn':'success') }
  const saveEditEmp=async()=>{
    if(!editEmp) return
    const {error}=await supabase.from('employees').update({name:editEmp.name,position:editEmp.position||null,department:editEmp.department,site_id:editEmp.site_id||null,iban:editEmp.iban||null,hire_date:editEmp.hire_date||null,termination_date:editEmp.termination_date||null}).eq('id',editEmp.id)
    if(!error){showToast(`✓ Salvat: ${editEmp.name}`);setEditEmp(null);loadAll()} else showToast('Eroare','error')
  }
  const deleteEmp=async()=>{
    if(!deleteEmpItem) return
    if(deleteEmpItem.active){showToast('Nu poți șterge un angajat activ!','error');setDeleteEmpItem(null);return}
    const {error}=await supabase.from('employees').delete().eq('id',deleteEmpItem.id)
    if(!error){showToast(`✓ ${deleteEmpItem.name} șters`);setDeleteEmpItem(null);loadAll()} else showToast('Eroare la ștergere','error')
  }

  const handleImport=e=>{
    const file=e.target.files[0]; if(!file) return
    const ext=file.name.split('.').pop().toLowerCase()
    const reader=new FileReader()
    reader.onload=ev=>{
      try{
        let rows=[]
        if(ext==='csv') rows=ev.target.result.split('\n').filter(l=>l.trim()).map(l=>l.split(',').map(c=>c.replace(/^"|"$/g,'').trim()))
        else{const wb=XLSX.read(ev.target.result,{type:'array'});const ws=wb.Sheets[wb.SheetNames[0]];rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:''})}
        const hdr=rows[0].map(h=>String(h).toLowerCase().trim())
        const ni=hdr.findIndex(h=>['nume','name','angajat'].some(k=>h.includes(k)))
        const di=hdr.findIndex(h=>['departament','department'].some(k=>h.includes(k)))
        const pi=hdr.findIndex(h=>['functie','funcție','position'].some(k=>h.includes(k)))
        const si=hdr.findIndex(h=>['santier','șantier','site'].some(k=>h.includes(k)))
        if(ni===-1){showToast('Coloana Nume lipsă!','error');return}
        setImpPrev(rows.slice(1).filter(r=>r[ni]?.toString().trim()).map(r=>({name:r[ni]?.toString().trim(),department:di>=0?r[di]?.toString().trim():'',position:pi>=0?r[pi]?.toString().trim():'',siteName:si>=0?r[si]?.toString().trim():''})))
      }catch(err){showToast('Eroare: '+err.message,'error')}
      e.target.value=''
    }
    if(ext==='csv') reader.readAsText(file,'UTF-8'); else reader.readAsArrayBuffer(file)
  }

  const confirmImport=async()=>{
    if(!impPrev?.length) return
    setImporting(true)
    const ins=impPrev.map(r=>{const site=sites.find(s=>s.name.toLowerCase()===r.siteName?.toLowerCase());return {name:r.name,department:r.department||DEPARTMENTS[0],position:r.position||null,site_id:site?.id||null,active:true}})
    let imported=0
    for(let i=0;i<ins.length;i+=50){const {error}=await supabase.from('employees').insert(ins.slice(i,i+50));if(!error)imported+=Math.min(50,ins.length-i)}
    showToast(`✓ ${imported} importați!`); setImpPrev(null); loadAll()
    setImporting(false)
  }

  const dlTemplate=()=>{ const ws=XLSX.utils.aoa_to_sheet([['Nume','Departament','Functie','Santier'],['Ion Popescu','Execuție','Sudor Electric','Santier 1'],['Maria Ionescu','TESA','Inginer','Sediu']]); ws['!cols']=[{wch:28},{wch:14},{wch:22},{wch:18}]; const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'Angajati'); XLSX.writeFile(wb,'template_angajati.xlsx') }

  const handleCalImport=e=>{
    const file=e.target.files[0]; if(!file) return
    const reader=new FileReader()
    reader.onload=async ev=>{
      try{
        const wb=XLSX.read(ev.target.result,{type:'array'}); const ws=wb.Sheets[wb.SheetNames[0]]; const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:''})
        const hdr=rows[0].map(h=>String(h).toLowerCase().trim())
        const di=hdr.findIndex(h=>h.includes('data')||h.includes('date'))
        const ti=hdr.findIndex(h=>h.includes('tip')||h.includes('type'))
        const desi=hdr.findIndex(h=>h.includes('descriere')||h.includes('desc'))
        if(di===-1){showToast('Coloana Data lipsă!','error');return}
        const ins=rows.slice(1).filter(r=>r[di]).map(r=>{
          let date=r[di]
          if(typeof date==='number') date=new Date(Math.round((date-25569)*86400*1000)).toISOString().split('T')[0]
          else date=String(date).trim()
          return {date,type:ti>=0?r[ti]?.toString().trim()||'holiday':'holiday',description:desi>=0?r[desi]?.toString().trim():''}
        }).filter(r=>r.date.match(/^\d{4}-\d{2}-\d{2}$/))
        const {error}=await supabase.from('calendar_days').upsert(ins,{onConflict:'date'})
        if(!error){showToast(`✓ ${ins.length} zile importate!`);loadAll()} else showToast('Eroare','error')
      }catch(err){showToast('Eroare: '+err.message,'error')}
      e.target.value=''
    }
    reader.readAsArrayBuffer(file)
  }

  const dlCalTemplate=()=>{
    const rows=[
      ['Data (YYYY-MM-DD)','Tip (legal/holiday)','Descriere'],
      // 2027 Zile libere legale Romania
      ['2027-01-01','legal','Anul Nou'],
      ['2027-01-02','legal','Anul Nou'],
      ['2027-01-06','legal','Boboteaza'],
      ['2027-01-07','legal','Sfantul Ioan'],
      ['2027-01-24','legal','Ziua Unirii Principatelor'],
      ['2027-04-30','legal','Vinerea Mare'],
      ['2027-05-02','legal','Pastele Ortodox'],
      ['2027-05-03','legal','Pastele Ortodox'],
      ['2027-05-01','legal','Ziua Muncii'],
      ['2027-06-20','legal','Rusalii'],
      ['2027-06-21','legal','A doua zi de Rusalii'],
      ['2027-08-15','legal','Adormirea Maicii Domnului'],
      ['2027-11-30','legal','Sfantul Andrei'],
      ['2027-12-01','legal','Ziua Nationala a Romaniei'],
      ['2027-12-25','legal','Craciunul'],
      ['2027-12-26','legal','Craciunul'],
      // Puteti adauga zile libere specifice firmei
      ['2027-06-15','holiday','Exemplu: Zi libera firma'],
    ]
    const ws=XLSX.utils.aoa_to_sheet(rows)
    ws['!cols']=[{wch:22},{wch:22},{wch:34}]
    const wb=XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb,ws,'Calendar 2027')
    XLSX.writeFile(wb,'template_calendar_2027.xlsx')
  }

  const tabs=[['sites','🏗️ Șantiere'],['managers','👤 Manageri'],['employees','👥 Angajați'],['calendar','📅 Calendar'],['settings','⚙️ Setări']]

  return (
    <Layout>
      <Toast toast={toast}/>
      <div style={{fontSize:19,fontWeight:800,marginBottom:18}}>⚙ Administrare</div>
      <div style={{display:'flex',gap:6,marginBottom:20,borderBottom:`1px solid ${G.border}`,paddingBottom:10}}>
        {tabs.map(([v,l])=><button key={v} onClick={()=>setTab(v)} style={{...S.btnS,background:tab===v?'#21262D':G.bg,color:tab===v?G.text:G.muted,fontSize:12}}>{l}</button>)}
      </div>

      {/* Edit site name modal */}
      {editSiteItem&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.7)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center'}}>
          <div style={{...S.card,padding:28,width:380}}>
            <div style={{fontSize:15,fontWeight:700,marginBottom:18}}>✏️ Redenumește Șantier</div>
            <div style={{marginBottom:18}}><Lbl>Nume nou</Lbl><input style={S.input} value={editSiteName} onChange={e=>setEditSiteName(e.target.value)} onKeyDown={e=>e.key==='Enter'&&saveSiteName()} autoFocus/></div>
            <div style={{display:'flex',gap:10}}>
              <button onClick={()=>setEditSiteItem(null)} style={{...S.btnS,flex:1}}>Anulează</button>
              <button onClick={saveSiteName} style={{...S.btnP,flex:1}}>✓ Salvează</button>
            </div>
          </div>
        </div>
      )}
      {deletingSite&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.7)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center'}}>
          <div style={{...S.card,padding:28,width:380,textAlign:'center'}}>
            <div style={{fontSize:32,marginBottom:12}}>🗑️</div>
            <div style={{fontSize:16,fontWeight:700,marginBottom:8}}>Ștergi șantierul?</div>
            <div style={{fontSize:13,color:G.muted,marginBottom:22}}>„{deletingSite.name}" va fi șters permanent. Această acțiune nu poate fi anulată.</div>
            <div style={{display:'flex',gap:10,justifyContent:'center'}}>
              <button onClick={()=>setDeletingSite(null)} style={{...S.btnS,flex:1}}>Anulează</button>
              <button onClick={()=>deleteSite(deletingSite)} style={{...S.btnP,flex:1,background:G.red}}>Șterge</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit employee modal */}
      {editEmp&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.7)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center'}}>
          <div style={{...S.card,padding:28,width:420}}>
            <div style={{fontSize:15,fontWeight:700,marginBottom:18}}>✏️ Editează Angajat</div>
            <div style={{marginBottom:12}}><Lbl>Nume complet *</Lbl><input style={S.input} value={editEmp.name||''} onChange={e=>setEditEmp({...editEmp,name:e.target.value})}/></div>
            <div style={{marginBottom:12}}><Lbl>Funcție</Lbl><input style={S.input} value={editEmp.position||''} onChange={e=>setEditEmp({...editEmp,position:e.target.value})}/></div>
            {isAdmin&&<div style={{marginBottom:12}}><Lbl>IBAN (plăți bancă) {isSuperAdmin&&<span style={{fontSize:10,color:G.yellow}}>· editabil Super Admin & Admin</span>}</Lbl><input style={S.input} placeholder="RO49AAAA1B31007593840000" value={editEmp.iban||''} onChange={e=>setEditEmp({...editEmp,iban:e.target.value.toUpperCase().replace(/\s/g,'')})} maxLength={34}/></div>}
            <div style={{marginBottom:12}}><Lbl>Departament</Lbl>
              <select value={editEmp.department} onChange={e=>setEditEmp({...editEmp,department:e.target.value})} style={{width:'100%'}}>
                {DEPARTMENTS.map(d=><option key={d}>{d}</option>)}
              </select>
            </div>
            <div style={{marginBottom:12}}><Lbl>Șantier</Lbl>
              <select value={editEmp.site_id||''} onChange={e=>setEditEmp({...editEmp,site_id:e.target.value?Number(e.target.value):null})} style={{width:'100%'}}>
                <option value="">— fără șantier —</option>
                {sites.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div style={{display:'flex',gap:10,marginBottom:12}}>
              <div style={{flex:1}}><Lbl>📅 Data angajării</Lbl><input type="date" style={S.input} value={editEmp.hire_date||''} onChange={e=>setEditEmp({...editEmp,hire_date:e.target.value||null})}/></div>
              <div style={{flex:1}}><Lbl>🔴 Data încetării ctr.</Lbl><input type="date" style={S.input} value={editEmp.termination_date||''} onChange={e=>setEditEmp({...editEmp,termination_date:e.target.value||null})}/></div>
            </div>
            {editEmp.termination_date&&<div style={{background:G.redDim,border:`1px solid ${G.red}33`,borderRadius:8,padding:'8px 12px',marginBottom:14,fontSize:11,color:G.red}}>⚠️ Contract încetat pe {new Date(editEmp.termination_date).toLocaleDateString('ro-RO')} — angajatul va fi vizibil în pontaj până la finalul lunii respective.</div>}
            <div style={{display:'flex',gap:10}}>
              <button onClick={()=>setEditEmp(null)} style={{...S.btnS,flex:1}}>Anulează</button>
              <button onClick={saveEditEmp} style={{...S.btnP,flex:1}}>✓ Salvează</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete employee modal */}
      {deleteEmpItem&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.7)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center'}}>
          <div style={{...S.card,padding:28,width:380,textAlign:'center'}}>
            <div style={{fontSize:32,marginBottom:12}}>🗑️</div>
            <div style={{fontSize:16,fontWeight:700,marginBottom:8}}>Ștergi angajatul?</div>
            <div style={{fontSize:13,color:G.muted,marginBottom:8}}>„{deleteEmpItem.name}"</div>
            {deleteEmpItem.active
              ? <div style={{background:G.redDim,color:G.red,border:`1px solid ${G.red}33`,borderRadius:8,padding:'10px',fontSize:12,marginBottom:16}}>⚠ Nu poți șterge un angajat activ! Dezactivează-l mai întâi.</div>
              : <div style={{fontSize:12,color:G.muted,marginBottom:16}}>Această acțiune este permanentă și nu poate fi anulată. Istoricul pontajului va fi șters.</div>
            }
            <div style={{display:'flex',gap:10,justifyContent:'center'}}>
              <button onClick={()=>setDeleteEmpItem(null)} style={{...S.btnS,flex:1}}>Anulează</button>
              {!deleteEmpItem.active&&<button onClick={deleteEmp} style={{...S.btnP,flex:1,background:G.red}}>Șterge definitiv</button>}
            </div>
          </div>
        </div>
      )}
      {editMgr&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.7)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center'}}>
          <div style={{...S.card,padding:28,width:440}}>
            <div style={{fontSize:15,fontWeight:700,marginBottom:18}}>✏️ Editează Manager</div>
            <div style={{marginBottom:12}}><Lbl>Nume complet</Lbl><input style={S.input} value={editMgr.name||''} onChange={e=>setEditMgr({...editMgr,name:e.target.value})}/></div>
            <div style={{marginBottom:12}}><Lbl>Rol</Lbl>
              <select value={editMgr.role} onChange={e=>setEditMgr({...editMgr,role:e.target.value})} style={{width:'100%'}}>
                <option value="manager">👤 Manager Proiect</option>
                <option value="admin">⚙ Admin</option>
                <option value="superadmin">⭐ Super Admin</option>
                <option value="contabil">💵 Contabil</option>
              </select>
            </div>
            {editMgr.role==='manager'&&(
              <div style={{marginBottom:18}}>
                <Lbl>Șantiere Alocate (poate selecta mai multe)</Lbl>
                <div style={{display:'flex',flexDirection:'column',gap:8,maxHeight:200,overflowY:'auto',padding:'10px 12px',background:G.bg,borderRadius:8,border:`1px solid ${G.border2}`}}>
                  {sites.map(s=>(
                    <label key={s.id} style={{display:'flex',alignItems:'center',gap:10,cursor:'pointer',fontSize:13}}>
                      <input type="checkbox"
                        checked={(editMgr.site_ids||[]).includes(s.id)}
                        onChange={e=>{
                          const current=editMgr.site_ids||[]
                          const updated=e.target.checked?[...current,s.id]:current.filter(id=>id!==s.id)
                          setEditMgr({...editMgr,site_ids:updated})
                        }}
                        style={{accentColor:G.blue,width:16,height:16}}
                      />
                      <span style={{color:(editMgr.site_ids||[]).includes(s.id)?G.blue:G.text}}>{s.name}</span>
                    </label>
                  ))}
                </div>
                <div style={{fontSize:11,color:G.muted,marginTop:6}}>
                  {(editMgr.site_ids||[]).length>0
                    ? `✓ ${(editMgr.site_ids||[]).length} șantier(e) selectat(e)`
                    : '⚠ Niciun șantier selectat'}
                </div>
              </div>
            )}
            <div style={{display:'flex',gap:10}}>
              <button onClick={()=>setEditMgr(null)} style={{...S.btnS,flex:1}}>Anulează</button>
              <button onClick={saveEditMgr} style={{...S.btnP,flex:1}}>✓ Salvează</button>
            </div>
          </div>
        </div>
      )}

      {tab==='sites'&&(
        <div style={{display:'grid',gridTemplateColumns:'1fr 280px',gap:18}}>
          <div style={{...S.card,overflow:'hidden'}}>
            {load?<div style={{padding:40,textAlign:'center'}}><div className="sp" style={{margin:'0 auto'}}/></div>:(
              <table><thead><tr style={{background:G.bg}}><th>Șantier / Sediu</th><th>Status</th><th>Acțiuni</th></tr></thead>
              <tbody>{sites.map(s=>(
                <tr key={s.id}><td style={{fontWeight:600}}>{s.name}</td>
                <td><span style={{padding:'2px 8px',borderRadius:20,fontSize:11,fontWeight:700,background:s.active?G.greenDim:G.redDim,color:s.active?G.green:G.red,border:`1px solid ${s.active?G.green:G.red}44`}}>{s.active?'● Activ':'○ Inactiv'}</span></td>
                <td style={{display:'flex',gap:6}}>
                  <button onClick={()=>{setEditSiteItem(s);setEditSiteName(s.name)}} style={{...S.btnS,padding:'3px 9px',fontSize:11}}>✏️</button>
                  <button onClick={()=>toggleSite(s)} style={{...S.btnS,padding:'3px 9px',fontSize:11}}>{s.active?'Dezact.':'Activ.'}</button>
                  <button onClick={()=>setDeletingSite(s)} style={{...S.btnS,padding:'3px 9px',fontSize:11,color:G.red,borderColor:G.red+'44'}}>🗑️</button>
                </td></tr>
              ))}{!sites.length&&<tr><td colSpan={3} style={{textAlign:'center',color:G.muted,padding:28,fontSize:12}}>Niciun șantier</td></tr>}</tbody></table>
            )}
          </div>
          <div style={{...S.card,padding:20}}>
            <div style={{fontSize:13,fontWeight:700,marginBottom:14}}>Adaugă Șantier</div>
            <div style={{marginBottom:14}}><Lbl>Nume</Lbl><input style={S.input} placeholder="ex: Șantier Ploiești" value={siteName} onChange={e=>setSiteName(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addSite()}/></div>
            <button style={{...S.btnP,width:'100%',display:'flex',alignItems:'center',justifyContent:'center',gap:7}} onClick={addSite} disabled={addingSite}>{addingSite?<><div className="sp"/>...</>:'+ Adaugă'}</button>
          </div>
        </div>
      )}

      {tab==='managers'&&(
        <div style={{display:'grid',gridTemplateColumns:'1fr 340px',gap:18}}>
          <div style={{...S.card,overflow:'hidden'}}>
            {load?<div style={{padding:40,textAlign:'center'}}><div className="sp" style={{margin:'0 auto'}}/></div>:(
              <table><thead><tr style={{background:G.bg}}><th>Nume</th><th>Email</th><th>Rol</th><th>Șantier</th><th></th></tr></thead>
              <tbody>{managers.map(m=>(
                <tr key={m.id}><td style={{fontWeight:600}}>{m.name||<span style={{color:G.red}}>— fără nume —</span>}</td>
                <td style={{color:G.muted,fontSize:12}}>{m.email}</td>
                <td><span className={`badge ${['admin','superadmin'].includes(m.role)?'ba':m.role==='contabil'?'bs':'bm'}`}>{m.role==='superadmin'?'⭐ Super Admin':m.role==='admin'?'⚙ Admin':m.role==='contabil'?'💵 Contabil':'👤 Manager'}</span></td>
                <td style={{fontSize:11,color:G.purple}}>{(m.site_ids||[]).length>0?m.site_ids.map(id=>sites.find(s=>s.id===id)?.name).filter(Boolean).join(', '):'—'}</td>
                <td><button onClick={()=>setEditMgr({...m})} style={{...S.btnS,padding:'3px 9px',fontSize:11}}>✏️ Edit</button></td></tr>
              ))}</tbody></table>
            )}
          </div>
          <div style={{...S.card,padding:20}}>
            <div style={{fontSize:13,fontWeight:700,marginBottom:14}}>Adaugă Manager</div>
            {[['Nume complet',nName,setNName,'text','Ion Popescu'],['Email',nEmail,setNEmail,'email','ion@gazpet.ro'],['Parolă temporară',nPwd,setNPwd,'password','••••••']].map(([l,v,s,t,ph])=>(
              <div key={l} style={{marginBottom:10}}><Lbl>{l}</Lbl><input style={S.input} type={t} placeholder={ph} value={v} onChange={e=>s(e.target.value)}/></div>
            ))}
            <div style={{marginBottom:10}}><Lbl>Rol</Lbl><select value={nRole} onChange={e=>setNRole(e.target.value)} style={{width:'100%'}}>
              <option value="manager">👤 Manager Proiect</option>
              <option value="admin">⚙ Admin</option>
              <option value="superadmin">⭐ Super Admin</option>
              <option value="contabil">💵 Contabil</option>
            </select></div>
            {nRole==='manager'&&<div style={{marginBottom:14}}><Lbl>Șantier Alocat</Lbl><select value={nSite} onChange={e=>setNSite(e.target.value)} style={{width:'100%'}}><option value="">— selectează —</option>{sites.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></div>}
            <button style={{...S.btnP,width:'100%',display:'flex',alignItems:'center',justifyContent:'center',gap:7}} onClick={createManager} disabled={creating}>{creating?<><div className="sp"/>...</>:'+ Adaugă Manager'}</button>
          </div>
        </div>
      )}

      {tab==='employees'&&(
        <div style={{display:'grid',gridTemplateColumns:'1fr 300px',gap:18}}>
          <div>
            {/* Filters row */}
            <div style={{display:'flex',gap:7,marginBottom:10,alignItems:'center',flexWrap:'wrap'}}>
              {[['active','● Activi'],['inactive','○ Inactivi'],['all','Toți']].map(([v,l])=>(
                <button key={v} onClick={()=>setEmpStatusFilter(v)} style={{...S.btnS,fontSize:11,background:empStatusFilter===v?'#21262D':G.bg,color:empStatusFilter===v?G.text:G.muted,borderColor:empStatusFilter===v?G.border2:G.border}}>
                  {l}
                </button>
              ))}
              <div style={{position:'relative',flex:'1',minWidth:160,maxWidth:260}}>
                <span style={{position:'absolute',left:9,top:'50%',transform:'translateY(-50%)',fontSize:13,pointerEvents:'none'}}>🔍</span>
                <input value={empSearch} onChange={e=>setEmpSearch(e.target.value)} placeholder="Caută după nume..." style={{...S.input,paddingLeft:30,margin:0,fontSize:11,height:30}}/>
              </div>
              <select value={empDeptFilter} onChange={e=>setEmpDeptFilter(e.target.value)} style={{...S.input,margin:0,fontSize:11,height:30,minWidth:130,maxWidth:170}}>
                <option value="all">Toate dept.</option>
                {DEPARTMENTS.map(d=><option key={d} value={d}>{d}</option>)}
              </select>
              <select value={empPosFilter} onChange={e=>setEmpPosFilter(e.target.value)} style={{...S.input,margin:0,fontSize:11,height:30,minWidth:130,maxWidth:170}}>
                <option value="all">Toate funcțiile</option>
                {[...new Set(employees.map(e=>e.position).filter(Boolean))].sort().map(p=><option key={p} value={p}>{p}</option>)}
              </select>
              <span style={{fontSize:11,color:G.muted,marginLeft:'auto',whiteSpace:'nowrap'}}>
                {employees.filter(e=>{
                  const s=empStatusFilter==='all'?true:empStatusFilter==='active'?e.active:!e.active
                  const q=empSearch.trim().toLowerCase()
                  const n=!q||e.name?.toLowerCase().includes(q)
                  const d=empDeptFilter==='all'||e.department===empDeptFilter
                  const p=empPosFilter==='all'||e.position===empPosFilter
                  return s&&n&&d&&p
                }).length} angajați
              </span>
            </div>
            <div style={{...S.card,overflow:'hidden',marginBottom:impPrev?14:0}}>
              {load?<div style={{padding:40,textAlign:'center'}}><div className="sp" style={{margin:'0 auto'}}/></div>:(
                <table><thead><tr style={{background:G.bg}}><th>Nume</th><th>Dept.</th><th>Funcție</th><th>Șantier</th><th>Angajat</th><th>Încetat</th><th>Status</th><th>Acțiuni</th></tr></thead>
                <tbody>{employees.filter(e=>{
                  const s=empStatusFilter==='all'?true:empStatusFilter==='active'?e.active:!e.active
                  const q=empSearch.trim().toLowerCase()
                  const n=!q||e.name?.toLowerCase().includes(q)
                  const d=empDeptFilter==='all'||e.department===empDeptFilter
                  const p=empPosFilter==='all'||e.position===empPosFilter
                  return s&&n&&d&&p
                }).map(emp=>(
                  <tr key={emp.id}>
                    <td><div style={{display:'flex',alignItems:'center',gap:7}}><Avatar name={emp.name} id={emp.id} size={24}/><span style={{fontWeight:600,fontSize:12}}>{emp.name}</span></div></td>
                    <td><span className="badge bd">{emp.department}</span></td>
                    <td style={{color:G.muted,fontSize:11}}>{emp.position||'—'}</td>
                    <td style={{fontSize:11,color:G.purple}}>{emp.sites?.name||<span style={{color:G.red}}>⚠ Nealocate</span>}</td>
                    <td style={{fontSize:11,color:G.green}}>{emp.hire_date?new Date(emp.hire_date).toLocaleDateString('ro-RO'):<span style={{color:G.dim}}>—</span>}</td>
                    <td style={{fontSize:11,color:emp.termination_date?G.red:G.dim}}>{emp.termination_date?new Date(emp.termination_date).toLocaleDateString('ro-RO'):'—'}</td>
                    <td><span style={{padding:'2px 7px',borderRadius:20,fontSize:11,fontWeight:700,background:emp.active?G.greenDim:G.redDim,color:emp.active?G.green:G.red,border:`1px solid ${emp.active?G.green:G.red}44`}}>{emp.active?'●Activ':'○Inactiv'}</span></td>
                    <td><div style={{display:'flex',gap:5}}>
                      <button onClick={()=>setEditEmp({...emp})} style={{...S.btnS,padding:'2px 7px',fontSize:10}}>✏️</button>
                      <button onClick={()=>toggleEmp(emp)} style={{...S.btnS,padding:'2px 7px',fontSize:10}}>{emp.active?'Dezact.':'Activ.'}</button>
                      {!emp.active&&<button onClick={()=>setDeleteEmpItem(emp)} style={{...S.btnS,padding:'2px 7px',fontSize:10,color:G.red,borderColor:G.red+'44'}}>🗑️</button>}
                    </div></td>
                  </tr>
                ))}</tbody></table>
              )}
            </div>
            {impPrev&&<div style={{...S.card,padding:16,border:`1px solid ${G.green}44`}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
                <div style={{fontSize:12,fontWeight:700,color:G.green}}>✓ {impPrev.length} angajați pregătiți pentru import</div>
                <div style={{display:'flex',gap:7}}>
                  <button onClick={()=>setImpPrev(null)} style={{...S.btnS,fontSize:11}}>Anulează</button>
                  <button onClick={confirmImport} disabled={importing} style={{...S.btnP,fontSize:11,background:'#1A6B1A',display:'flex',alignItems:'center',gap:5}}>{importing?<><div className="sp"/>...</>:`Confirmă (${impPrev.length})`}</button>
                </div>
              </div>
              <div style={{maxHeight:180,overflowY:'auto'}}>
                <table><thead><tr style={{background:G.bg}}><th>#</th><th>Nume</th><th>Dept.</th><th>Funcție</th><th>Șantier</th></tr></thead>
                <tbody>{impPrev.slice(0,30).map((r,i)=><tr key={i}><td style={{fontSize:10,color:G.dim}}>{i+1}</td><td style={{fontWeight:600,fontSize:12}}>{r.name}</td><td style={{fontSize:11}}>{r.department}</td><td style={{fontSize:11}}>{r.position||'—'}</td><td style={{fontSize:11,color:G.purple}}>{r.siteName||'—'}</td></tr>)}</tbody></table>
              </div>
            </div>}
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:13}}>
            <div style={{...S.card,padding:18,border:`1px solid #1F6FEB44`}}>
              <div style={{fontSize:12,fontWeight:700,marginBottom:9}}>📥 Import Excel / CSV</div>
              <div style={{fontSize:11,color:G.muted,marginBottom:11,lineHeight:1.5}}>Coloane: <strong>Nume</strong>, Departament, Functie, Santier</div>
              <button onClick={dlTemplate} style={{...S.btnS,width:'100%',fontSize:11,marginBottom:9,display:'flex',alignItems:'center',justifyContent:'center',gap:5}}>⬇ Template Excel</button>
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{display:'none'}} onChange={handleImport}/>
              <div onClick={()=>fileRef.current?.click()} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();const f=e.dataTransfer.files[0];if(f){const dt=new DataTransfer();dt.items.add(f);fileRef.current.files=dt.files;handleImport({target:fileRef.current})}}}
                style={{border:`2px dashed ${G.border2}`,borderRadius:9,padding:'16px 12px',textAlign:'center',cursor:'pointer'}}
                onMouseEnter={e=>e.currentTarget.style.borderColor=G.blue} onMouseLeave={e=>e.currentTarget.style.borderColor=G.border2}>
                <div style={{fontSize:22,marginBottom:5}}>📂</div>
                <div style={{fontSize:11,fontWeight:600}}>Click sau drag & drop</div>
                <div style={{fontSize:10,color:G.muted,marginTop:2}}>.xlsx .xls .csv</div>
              </div>
            </div>
            <div style={{...S.card,padding:18}}>
              <div style={{fontSize:12,fontWeight:700,marginBottom:13}}>+ Adaugă Manual</div>
              <div style={{marginBottom:9}}><Lbl>Nume *</Lbl><input style={S.input} placeholder="Ana Ionescu" value={eName} onChange={e=>setEName(e.target.value)}/></div>
              <div style={{marginBottom:9}}><Lbl>Funcție</Lbl><input style={S.input} placeholder="Inginer" value={ePos} onChange={e=>setEPos(e.target.value)}/></div>
              <div style={{marginBottom:9}}><Lbl>Departament</Lbl><select value={eDept} onChange={e=>setEDept(e.target.value)} style={{width:'100%'}}>{DEPARTMENTS.map(d=><option key={d}>{d}</option>)}</select></div>
              <div style={{marginBottom:9}}><Lbl>Șantier</Lbl><select value={eSite} onChange={e=>setESite(e.target.value)} style={{width:'100%'}}><option value="">— fără —</option>{sites.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
              <div style={{marginBottom:14}}><Lbl>📅 Data angajării</Lbl><input type="date" style={S.input} value={eHireDate} onChange={e=>setEHireDate(e.target.value)}/></div>
              <button style={{...S.btnP,width:'100%',display:'flex',alignItems:'center',justifyContent:'center',gap:7}} onClick={addEmployee} disabled={addingE}>{addingE?<><div className="sp"/>...</>:'+ Adaugă'}</button>
            </div>
          </div>
        </div>
      )}

      {tab==='calendar'&&(
        <div style={{display:'grid',gridTemplateColumns:'1fr 280px',gap:18}}>
          <div style={{...S.card,overflow:'hidden'}}>
            <div style={{padding:'12px 14px',borderBottom:`1px solid ${G.border}`,display:'flex',justifyContent:'space-between'}}>
              <span style={{fontSize:13,fontWeight:700}}>Zile Speciale</span>
              <span style={{fontSize:11,color:G.muted}}>{calDays.length} zile înregistrate</span>
            </div>
            {/* Year nav + working days */}
            <div style={{padding:'12px 14px',borderBottom:`1px solid ${G.border}`}}>
              <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10}}>
                <button onClick={()=>setCalYear(y=>y-1)} style={{background:G.surface,border:`1px solid ${G.border}`,color:G.text,borderRadius:7,padding:'4px 10px',cursor:'pointer',fontWeight:700}}>◀</button>
                <span style={{fontSize:15,fontWeight:800,color:G.blue,minWidth:50,textAlign:'center'}}>{calYear}</span>
                <button onClick={()=>setCalYear(y=>y+1)} style={{background:G.surface,border:`1px solid ${G.border}`,color:G.text,borderRadius:7,padding:'4px 10px',cursor:'pointer',fontWeight:700}}>▶</button>
                <span style={{fontSize:11,color:G.muted}}>zile lucrătoare per lună</span>
              </div>
              <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
              {Array.from({length:12},(_,i)=>{
                const year=calYear
                const month=i+1
                const daysInMonth=new Date(year,month,0).getDate()
                const legalOnWeekdays=calDays.filter(d=>{
                  const dm=new Date(d.date+'T12:00:00')
                  return dm.getFullYear()===year&&dm.getMonth()===i&&d.type==='legal'&&dm.getDay()!==0&&dm.getDay()!==6
                }).length
                let workDays=0
                for(let d=1;d<=daysInMonth;d++){const dt=new Date(year,i,d);if(dt.getDay()!==0&&dt.getDay()!==6)workDays++}
                workDays-=legalOnWeekdays
                return(
                  <div key={i} style={{background:'#0D1117',border:`1px solid ${G.border}`,borderRadius:8,padding:'6px 10px',textAlign:'center',minWidth:70}}>
                    <div style={{fontSize:10,color:G.muted,fontWeight:600}}>{new Date(year,i).toLocaleString('ro-RO',{month:'short'}).toUpperCase()}</div>
                    <div style={{fontSize:18,fontWeight:800,color:G.blue}}>{workDays}</div>
                    <div style={{fontSize:9,color:G.dim}}>zile lucr.</div>
                  </div>
                )
              })}
              </div>
            </div>
            <div style={{maxHeight:300,overflowY:'auto'}}>
              <table><thead><tr style={{background:G.bg}}><th>Data</th><th>Tip</th><th>Descriere</th></tr></thead>
              <tbody>{calDays.filter(d=>new Date(d.date+'T12:00:00').getFullYear()===calYear).map(d=>(
                <tr key={d.id}><td style={{fontWeight:600,fontSize:12}}>{d.date}</td>
                <td><span style={{padding:'2px 7px',borderRadius:12,fontSize:11,fontWeight:700,background:d.type==='legal'?G.redDim:G.yellowDim,color:d.type==='legal'?G.red:G.yellow}}>{d.type}</span></td>
                <td style={{fontSize:11,color:G.muted}}>{d.description}</td></tr>
              ))}{!calDays.filter(d=>new Date(d.date+'T12:00:00').getFullYear()===calYear).length&&<tr><td colSpan={3} style={{textAlign:'center',color:G.muted,padding:28,fontSize:12}}>Nicio zi pentru {calYear}</td></tr>}</tbody></table>
            </div>
          </div>
          <div style={{...S.card,padding:20}}>
            <div style={{fontSize:12,fontWeight:700,marginBottom:9}}>📅 Import Calendar</div>
            <div style={{fontSize:11,color:G.muted,marginBottom:12,lineHeight:1.5}}>Coloane: <strong>Data</strong> (YYYY-MM-DD), Tip (legal/holiday), Descriere</div>
            <button onClick={dlCalTemplate} style={{...S.btnS,width:'100%',fontSize:11,marginBottom:9,display:'flex',alignItems:'center',justifyContent:'center',gap:5}}>⬇ Template Calendar</button>
            <input ref={calRef} type="file" accept=".xlsx,.csv" style={{display:'none'}} onChange={handleCalImport}/>
            <div onClick={()=>calRef.current?.click()} style={{border:`2px dashed ${G.border2}`,borderRadius:9,padding:'16px 12px',textAlign:'center',cursor:'pointer',marginBottom:12}}
              onMouseEnter={e=>e.currentTarget.style.borderColor=G.blue} onMouseLeave={e=>e.currentTarget.style.borderColor=G.border2}>
              <div style={{fontSize:22,marginBottom:5}}>📅</div>
              <div style={{fontSize:11,fontWeight:600}}>Click pentru import</div>
            </div>
            <div style={{padding:10,background:G.greenDim,borderRadius:8,border:`1px solid ${G.green}33`,fontSize:11,color:'#8FD490'}}>
              ✓ Zile legale 2026 preîncărcate
            </div>
          </div>
        </div>
      )}

      {tab==='settings'&&(
        <div style={{maxWidth:500}}>
          <div style={{...S.card,padding:22,marginBottom:16}}>
            <div style={{fontSize:13,fontWeight:700,marginBottom:18}}>⚙️ Setări Generale</div>
            {[['Valoare Diurnă (RON/zi)','diurna_amount','50'],['Ore normale/zi','work_hours_per_day','8'],['Valoare Supliment Hrană (RON/zi)','meal_supplement_amount','15']].map(([l,k,ph])=>(
              <div key={k} style={{marginBottom:18}}>
                <Lbl>{l}</Lbl>
                <div style={{display:'flex',gap:9}}>
                  <input style={S.input} type="number" value={settings[k]||ph} onChange={e=>setSettings(prev=>({...prev,[k]:e.target.value}))} min="0" step={k==='work_hours_per_day'?1:5}/>
                  <button onClick={()=>saveSetting(k,settings[k])} style={{...S.btnP,whiteSpace:'nowrap'}}>Salvează</button>
                </div>
              </div>
            ))}
            {isSuperAdmin&&<div style={{marginBottom:18}}>
              <Lbl>🔐 IBAN Firmă — cont sursă plăți BT <span style={{fontSize:10,color:G.yellow}}>(doar Super Admin)</span></Lbl>
              <div style={{display:'flex',gap:9}}>
                <input style={S.input} placeholder="RO25BTRLRONCRT0T18017E01" value={settings['iban_firma']||''} onChange={e=>setSettings(prev=>({...prev,iban_firma:e.target.value.toUpperCase().replace(/\s/g,'')}))} maxLength={34}/>
                <button onClick={()=>saveSetting('iban_firma',settings['iban_firma'])} style={{...S.btnP,whiteSpace:'nowrap'}}>Salvează</button>
              </div>
              <div style={{fontSize:10,color:G.muted,marginTop:4}}>Contul Gazpet din care se fac plățile (coloana B în exportul BT)</div>
            </div>}
          </div>

          <div style={{...S.card,padding:22}}>
            <div style={{fontSize:13,fontWeight:700,marginBottom:6}}>📊 Procente Salariale Implicite</div>
            <div style={{fontSize:11,color:G.muted,marginBottom:16,lineHeight:1.6}}>
              Valorile implicite folosite la crearea unui salariat nou. Pot fi modificate individual per angajat.<br/>
              <span style={{color:G.yellow}}>⚠ Actualizează când se schimbă legislația!</span>
            </div>
            {[
              ['CAS Angajat (%)','default_cas_employee','25'],
              ['CASS Angajat (%)','default_cass_employee','10'],
              ['CAM Angajator (%)','default_cam_employer','2.25'],
              ['Impozit Venit (%)','default_income_tax','10'],
              ['Fond Construcții (%)','default_construction_fund','0'],
            ].map(([l,k,ph])=>(
              <div key={k} style={{marginBottom:14}}>
                <Lbl>{l}</Lbl>
                <div style={{display:'flex',gap:9}}>
                  <input style={S.input} type="number" value={settings[k]!==undefined?settings[k]:ph} onChange={e=>setSettings(prev=>({...prev,[k]:e.target.value}))} min="0" step="0.25" max="100"/>
                  <button onClick={()=>saveSetting(k,settings[k]!==undefined?settings[k]:ph)} style={{...S.btnP,whiteSpace:'nowrap'}}>Salvează</button>
                </div>
              </div>
            ))}
            <div style={{padding:12,background:'#1A2A1A',borderRadius:8,border:`1px solid ${G.green}33`,fontSize:11,color:'#8FD490',marginTop:8}}>
              ✓ Valori curente 2025-2026 conform OUG 156/2024 (scutire impozit eliminată)
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}

// ─── Salarii Page ─────────────────────────────────────────────────────────────
function SalariiPage() {
  const { profile } = useAuth()
  const [employees,setEmployees]=useState([])
  const [salaries,setSalaries]=useState({})
  const [defaults,setDefaults]=useState({cas:25,cass:10,cam:2.25,tax:10,fond:0})
  const [search,setSearch]=useState('')
  const [deptF,setDeptF]=useState('Toate')
  const [load,setLoad]=useState(true)
  const [editSal,setEditSal]=useState(null)
  const [saving,setSaving]=useState(false)
  const [toast,showToast]=useToast()

  useEffect(()=>{ loadData() },[])

  const loadData=async()=>{
    setLoad(true)
    const [{data:emps},{data:sals},{data:st}]=await Promise.all([
      supabase.from('employees').select('*,sites(name)').eq('active',true).order('name'),
      supabase.from('employee_salaries').select('*'),
      supabase.from('settings').select('*')
    ])
    setEmployees(emps||[])
    const m={}; (sals||[]).forEach(s=>{m[s.employee_id]=s}); setSalaries(m)
    // Load defaults from settings
    const g=(k,d)=>{ const f=(st||[]).find(x=>x.key===k); return f?Number(f.value):d }
    setDefaults({cas:g('default_cas_employee',25),cass:g('default_cass_employee',10),cam:g('default_cam_employer',2.25),tax:g('default_income_tax',10),fond:g('default_construction_fund',0)})
    setLoad(false)
  }

  const openEdit=(emp)=>{
    const e=salaries[emp.id]||{}
    setEditSal({
      employee_id:emp.id, empName:emp.name, empDept:emp.department, empEmail:emp.email||'',
      contract_number:e.contract_number||'',
      contract_date:e.contract_date||'',
      contract_expiry:e.contract_expiry||'',
      salary_gross:e.salary_gross||0,
      salary_net:e.salary_net||0,
      work_hours_per_day:e.work_hours_per_day||8,
      cas_employee:e.cas_employee??defaults.cas,
      cass_employee:e.cass_employee??defaults.cass,
      cas_employer:e.cas_employer??defaults.cam,
      tax_exempt:e.tax_exempt??false, // default FALSE din 2025
      income_tax:e.income_tax??defaults.tax,
      construction_fund:e.construction_fund??defaults.fond,
      other_deductions:e.other_deductions||0,
      other_deductions_desc:e.other_deductions_desc||'',
      personal_deduction:e.personal_deduction??587,
      use_personal_deduction:e.personal_deduction!=null&&e.personal_deduction>0,
      notes:e.notes||''
    })
  }

  const saveSalary=async()=>{
    setSaving(true)
    // Update email on employee
    if(editSal.empEmail!==undefined){
      await supabase.from('employees').update({email:editSal.empEmail}).eq('id',editSal.employee_id)
    }
    const payload={
      employee_id:editSal.employee_id,
      contract_number:editSal.contract_number||null,
      contract_date:editSal.contract_date||null,
      contract_expiry:editSal.contract_expiry||null,
      salary_gross:Number(editSal.salary_gross)||0,
      salary_net:Number(editSal.salary_net)||0,
      work_hours_per_day:Number(editSal.work_hours_per_day)||8,
      cas_employee:Number(editSal.cas_employee)||25,
      cass_employee:Number(editSal.cass_employee)||10,
      cas_employer:Number(editSal.cas_employer)||4,
      tax_exempt:editSal.tax_exempt,
      income_tax:Number(editSal.income_tax)||10,
      construction_fund:0,
      personal_deduction:Number(editSal.personal_deduction)||587,
      other_deductions:Number(editSal.other_deductions)||0,
      other_deductions_desc:editSal.other_deductions_desc||null,
      notes:editSal.notes||null,
      updated_at:new Date().toISOString()
    }
    const {error}=await supabase.from('employee_salaries').upsert(payload,{onConflict:'employee_id'})
    if(!error){showToast(`✓ Salvat: ${editSal.empName}`);setEditSal(null);loadData()}
    else showToast('Eroare la salvare','error')
    setSaving(false)
  }

  const exportBanca=()=>{ showToast('❤️','warn') }

  const filtered=employees.filter(e=>{
    const ms=e.name.toLowerCase().includes(search.toLowerCase())
    const md=deptF==='Toate'||e.department===deptF
    return ms&&md
  })

  const today=todayStr()
  const in30=new Date(); in30.setDate(in30.getDate()+30); const in30str=in30.toISOString().split('T')[0]
  const isExpiring=(date)=>date&&date>=today&&date<=in30str
  const isExpired=(date)=>date&&date<today

  const f=(v,set,label,type='number',step='0.1')=>(
    <div style={{marginBottom:10}}>
      <Lbl>{label}</Lbl>
      <input style={S.input} type={type} step={step} value={v} onChange={e=>set(e.target.value)}/>
    </div>
  )

  return (
    <Layout>
      <Toast toast={toast}/>
      {/* Edit modal */}
      {editSal&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.8)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center',overflow:'auto',padding:20}}>
          <div style={{...S.card,padding:28,width:700,maxHeight:'90vh',overflowY:'auto'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
              <div>
                <div style={{fontSize:16,fontWeight:800}}>{editSal.empName}</div>
                <span className="badge bd">{editSal.empDept}</span>
              </div>
              <button onClick={()=>setEditSal(null)} style={{background:'none',border:'none',color:G.muted,cursor:'pointer',fontSize:20}}>✕</button>
            </div>

            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:20}}>
              {/* Coloana stanga */}
              <div>
                <div style={{fontSize:12,fontWeight:700,color:G.blue,marginBottom:12,textTransform:'uppercase',letterSpacing:'.5px'}}>📧 Contact</div>
                <div style={{marginBottom:16}}>
                  <Lbl>Email angajat</Lbl>
                  <input style={S.input} type="email" placeholder="email@gazpet.ro" value={editSal.empEmail} onChange={e=>setEditSal({...editSal,empEmail:e.target.value})}/>
                </div>

                <div style={{fontSize:12,fontWeight:700,color:G.blue,marginBottom:12,textTransform:'uppercase',letterSpacing:'.5px'}}>📋 Contract</div>
                {f(editSal.contract_number,v=>setEditSal({...editSal,contract_number:v}),'Nr. Contract','text','any')}
                <div style={{marginBottom:10}}><Lbl>Data Contract</Lbl><input style={S.input} type="date" value={editSal.contract_date} onChange={e=>setEditSal({...editSal,contract_date:e.target.value})}/></div>
                
                {/* Bifa perioada nelimitata */}
                <div style={{marginBottom:10}}>
                  <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',marginBottom:8}}>
                    <input type="checkbox" checked={editSal.unlimited_contract||false} onChange={e=>setEditSal({...editSal,unlimited_contract:e.target.checked,contract_expiry:e.target.checked?'':editSal.contract_expiry})} style={{accentColor:G.blue,width:15,height:15}}/>
                    <span style={{fontSize:12,color:editSal.unlimited_contract?G.blue:G.muted,fontWeight:600}}>∞ Perioadă Nelimitată</span>
                  </label>
                  {!editSal.unlimited_contract&&(
                    <div>
                      <Lbl>Valabilitate Contract</Lbl>
                      <input style={{...S.input,borderColor:isExpired(editSal.contract_expiry)?G.red:isExpiring(editSal.contract_expiry)?G.yellow:G.border2}} type="date" value={editSal.contract_expiry} onChange={e=>setEditSal({...editSal,contract_expiry:e.target.value})}/>
                      {isExpired(editSal.contract_expiry)&&<div style={{fontSize:10,color:G.red,marginTop:3}}>⚠ Contract expirat!</div>}
                      {isExpiring(editSal.contract_expiry)&&<div style={{fontSize:10,color:G.yellow,marginTop:3}}>⚠ Expiră în curând!</div>}
                    </div>
                  )}
                  {editSal.unlimited_contract&&<div style={{fontSize:10,color:G.blue,padding:'5px 8px',background:'#1A2A3A',borderRadius:6}}>∞ Contract pe perioadă nedeterminată</div>}
                </div>

                <div style={{fontSize:12,fontWeight:700,color:G.green,marginBottom:12,textTransform:'uppercase',letterSpacing:'.5px'}}>💰 Salariu</div>
                
                {/* Salariu Brut cu calcul din net */}
                <div style={{marginBottom:10}}>
                  <Lbl>Salariu Brut (RON)</Lbl>
                  <input style={S.input} type="number" step="1" value={editSal.salary_gross} onChange={e=>setEditSal({...editSal,salary_gross:e.target.value})}/>
                </div>
                
                {/* Salariu Net cu buton calcul brut */}
                <div style={{marginBottom:10}}>
                  <Lbl>Salariu Net (RON)</Lbl>
                  <div style={{display:'flex',gap:8}}>
                    <input style={S.input} type="number" step="1" value={editSal.salary_net} onChange={e=>setEditSal({...editSal,salary_net:e.target.value})}/>
                    <button onClick={()=>{
                      const net=Number(editSal.salary_net)||0
                      const cas=Number(editSal.cas_employee)/100
                      const cass=Number(editSal.cass_employee)/100
                      const fond=0 // Eliminat din 2025
                      const tax=editSal.tax_exempt?0:Number(editSal.income_tax)/100
                      const dp=(!editSal.tax_exempt&&editSal.use_personal_deduction)?Number(editSal.personal_deduction)||0:0
                      // Net = Brut - Brut*cas - Brut*cass - (Brut*(1-cas-cass) - dp) * tax
                      // Net = Brut*(1-cas-cass) - (Brut*(1-cas-cass) - dp)*tax
                      // Net = Brut*(1-cas-cass)*(1-tax) + dp*tax
                      // Brut = (Net - dp*tax) / ((1-cas-cass)*(1-tax))
                      const factor=(1-cas-cass)*(1-tax)
                      const brut=factor>0?(net-dp*tax)/factor:0
                      setEditSal(prev=>({...prev,salary_gross:Math.round(brut*100)/100}))
                    }} style={{...S.btnS,whiteSpace:'nowrap',fontSize:11,color:G.blue,borderColor:G.blue+'44'}}>
                      ⟵ Calc. Brut
                    </button>
                  </div>
                  <div style={{fontSize:10,color:G.dim,marginTop:3}}>Introduce net → click "Calc. Brut" pentru calcul automat</div>
                </div>

                <div style={{marginBottom:16}}>
                  <Lbl>Normă Lucru (ore/zi)</Lbl>
                  <div style={{display:'flex',gap:8,alignItems:'center'}}>
                    <button onClick={()=>setEditSal({...editSal,work_hours_per_day:Math.max(1,Number(editSal.work_hours_per_day)-0.5)})} style={{...S.btnS,padding:'6px 12px',fontWeight:800,fontSize:16}}>−</button>
                    <input style={{...S.input,textAlign:'center',width:80}} type="number" step="0.5" min="1" max="12" value={editSal.work_hours_per_day} onChange={e=>setEditSal({...editSal,work_hours_per_day:e.target.value})}/>
                    <button onClick={()=>setEditSal({...editSal,work_hours_per_day:Math.min(12,Number(editSal.work_hours_per_day)+0.5)})} style={{...S.btnS,padding:'6px 12px',fontWeight:800,fontSize:16}}>+</button>
                    <span style={{fontSize:12,color:G.muted}}>ore/zi</span>
                  </div>
                </div>
              </div>

              {/* Coloana dreapta - Retineri */}
              <div>
                <div style={{fontSize:12,fontWeight:700,color:G.yellow,marginBottom:12,textTransform:'uppercase',letterSpacing:'.5px'}}>📊 Rețineri (Construcții)</div>

                <div style={{marginBottom:14,padding:12,background:editSal.tax_exempt?'#1A2A1A':'#2A1A1A',borderRadius:8,border:`1px solid ${editSal.tax_exempt?G.green:G.red}33`}}>
                  <label style={{display:'flex',alignItems:'center',gap:10,cursor:'pointer'}}>
                    <input type="checkbox" checked={editSal.tax_exempt} onChange={e=>setEditSal({...editSal,tax_exempt:e.target.checked})} style={{accentColor:G.green,width:16,height:16}}/>
                    <div>
                      <div style={{fontSize:12,fontWeight:700,color:editSal.tax_exempt?G.green:G.muted}}>{editSal.tax_exempt?'✓ Scutit Impozit Venit':'✗ Impozit Venit aplicabil'}</div>
                      <div style={{fontSize:10,color:G.muted}}>OUG 114/2018 — eliminat din 2025 (OUG 156/2024)</div>
                    </div>
                  </label>
                </div>

                {f(editSal.cas_employee,v=>setEditSal({...editSal,cas_employee:v}),'CAS Angajat (%)')}
                {f(editSal.cass_employee,v=>setEditSal({...editSal,cass_employee:v}),'CASS Angajat (%)')}
                {f(editSal.cas_employer,v=>setEditSal({...editSal,cas_employer:v}),'CAM Angajator (%)')}
                <div style={{marginBottom:10}}>
                  <Lbl>Fond Construcții (%)</Lbl>
                  <input style={{...S.input,opacity:.5,cursor:'not-allowed'}} type="number" value="0" disabled/>
                  <div style={{fontSize:10,color:G.dim,marginTop:3}}>Eliminat din 2025 — OUG 156/2024</div>
                </div>
                {!editSal.tax_exempt&&f(editSal.income_tax,v=>setEditSal({...editSal,income_tax:v}),'Impozit Venit (%)')}
                <div style={{marginBottom:10}}>
                  <Lbl>Deducere Personală (RON/lună)</Lbl>
                  <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',marginBottom:7}}>
                    <input type="checkbox" checked={editSal.use_personal_deduction||false} onChange={e=>setEditSal({...editSal,use_personal_deduction:e.target.checked})} style={{accentColor:G.blue,width:15,height:15}}/>
                    <span style={{fontSize:12,color:editSal.use_personal_deduction?G.blue:G.muted,fontWeight:600}}>Aplică Deducere Personală</span>
                  </label>
                  {editSal.use_personal_deduction&&<>
                    <input style={S.input} type="number" step="1" value={editSal.personal_deduction} onChange={e=>setEditSal({...editSal,personal_deduction:e.target.value})}/>
                    <div style={{fontSize:10,color:G.dim,marginTop:3}}>587 RON pentru salariul minim 2026 · variază după salariu</div>
                  </>}
                </div>
                {f(editSal.other_deductions,v=>setEditSal({...editSal,other_deductions:v}),'Alte Rețineri (RON)')}
                <div style={{marginBottom:10}}><Lbl>Descriere alte rețineri</Lbl><input style={S.input} type="text" placeholder="ex: Poprire, Avans..." value={editSal.other_deductions_desc} onChange={e=>setEditSal({...editSal,other_deductions_desc:e.target.value})}/></div>
                <div style={{marginBottom:10}}><Lbl>Note</Lbl><input style={S.input} type="text" value={editSal.notes} onChange={e=>setEditSal({...editSal,notes:e.target.value})}/></div>

                {/* Calcul estimativ */}
                <div style={{padding:12,background:'#0D1117',borderRadius:8,border:`1px solid ${G.border}`,marginTop:8}}>
                  <div style={{fontSize:11,color:G.muted,fontWeight:700,marginBottom:8,textTransform:'uppercase'}}>Calcul Estimativ</div>
                  {(()=>{
                    const brut=Number(editSal.salary_gross)||0
                    const cas=brut*Number(editSal.cas_employee)/100
                    const cass=brut*Number(editSal.cass_employee)/100
                    const dp=(!editSal.tax_exempt&&editSal.use_personal_deduction)?Number(editSal.personal_deduction)||0:0
                    const bazaImpozit=Math.max(0,brut-cas-cass-dp)
                    const impozit=editSal.tax_exempt?0:(bazaImpozit*Number(editSal.income_tax)/100)
                    const altele=Number(editSal.other_deductions)||0
                    const net=brut-cas-cass-impozit-altele
                    return <>
                      <div style={{display:'flex',justifyContent:'space-between',fontSize:11,marginBottom:4}}><span style={{color:G.muted}}>Salariu Brut</span><span style={{fontWeight:700}}>{brut.toFixed(2)} RON</span></div>
                      <div style={{display:'flex',justifyContent:'space-between',fontSize:11,marginBottom:4}}><span style={{color:G.muted}}>− CAS ({editSal.cas_employee}%)</span><span style={{color:G.red}}>-{cas.toFixed(2)} RON</span></div>
                      <div style={{display:'flex',justifyContent:'space-between',fontSize:11,marginBottom:4}}><span style={{color:G.muted}}>− CASS ({editSal.cass_employee}%)</span><span style={{color:G.red}}>-{cass.toFixed(2)} RON</span></div>
                      {!editSal.tax_exempt&&dp>0&&<div style={{display:'flex',justifyContent:'space-between',fontSize:11,marginBottom:4}}><span style={{color:G.muted}}>− Deducere Personală</span><span style={{color:G.blue}}>-{dp.toFixed(2)} RON</span></div>}
                      <div style={{display:'flex',justifyContent:'space-between',fontSize:10,marginBottom:4,opacity:.7}}><span style={{color:G.muted}}>  Bază impozabilă</span><span>{bazaImpozit.toFixed(2)} RON</span></div>
                      {!editSal.tax_exempt
                        ?<div style={{display:'flex',justifyContent:'space-between',fontSize:11,marginBottom:4}}><span style={{color:G.muted}}>− Impozit venit ({editSal.income_tax}%)</span><span style={{color:G.red}}>-{impozit.toFixed(2)} RON</span></div>
                        :<div style={{display:'flex',justifyContent:'space-between',fontSize:11,marginBottom:4}}><span style={{color:G.muted}}>− Impozit venit</span><span style={{color:G.green}}>Scutit</span></div>
                      }
                      {altele>0&&<div style={{display:'flex',justifyContent:'space-between',fontSize:11,marginBottom:4}}><span style={{color:G.muted}}>− Alte rețineri</span><span style={{color:G.red}}>-{altele.toFixed(2)} RON</span></div>}
                      <div style={{display:'flex',justifyContent:'space-between',fontSize:11,marginBottom:4,paddingTop:4,borderTop:`1px solid ${G.border}`}}><span style={{color:G.muted}}>CAM angajator ({editSal.cas_employer}%)</span><span style={{color:G.orange}}>{(brut*Number(editSal.cas_employer)/100).toFixed(2)} RON</span></div>
                      <div style={{borderTop:`1px solid ${G.border}`,marginTop:6,paddingTop:6,display:'flex',justifyContent:'space-between',fontSize:13,fontWeight:800}}><span style={{color:G.green}}>= Net Calculat</span><span style={{color:G.green}}>{net.toFixed(2)} RON</span></div>
                    </>
                  })()}
                </div>
              </div>
            </div>

            <div style={{display:'flex',gap:10,marginTop:20}}>
              <button onClick={()=>setEditSal(null)} style={{...S.btnS,flex:1}}>Anulează</button>
              <button onClick={saveSalary} disabled={saving} style={{...S.btnP,flex:2,display:'flex',alignItems:'center',justifyContent:'center',gap:7}}>{saving?<><div className="sp"/>Se salvează...</>:'💾 Salvează'}</button>
            </div>
          </div>
        </div>
      )}

      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
        <div>
          <div style={{fontSize:19,fontWeight:800}}>💵 Salarii</div>
          <div style={{fontSize:11,color:G.muted,marginTop:3}}>{filtered.length} angajați · {Object.keys(salaries).length} cu date salariale</div>
        </div>
        <div style={{display:'flex',gap:8}}>
          <input placeholder="🔍 Caută..." value={search} onChange={e=>setSearch(e.target.value)} style={{...S.input,width:180}}/>
          <select value={deptF} onChange={e=>setDeptF(e.target.value)}>
            <option>Toate</option>{DEPARTMENTS.map(d=><option key={d}>{d}</option>)}
          </select>
          <button onClick={exportBanca} style={{...S.btnP,background:'#1A4A1A',display:'flex',alignItems:'center',gap:6}}>🏦 Export Bancă Salarii</button>
        </div>
      </div>

      {load?<div style={{display:'flex',justifyContent:'center',padding:60}}><div className="sp" style={{width:30,height:30}}/></div>
      :<div style={{...S.card,overflow:'hidden'}}>
        <table>
          <thead><tr style={{background:G.bg}}>
            <th>Angajat</th><th>Dept.</th><th>Nr. Contract</th><th>Valabilitate</th>
            <th>Salariu Brut</th><th>Salariu Net</th><th>Normă</th><th>Email</th><th></th>
          </tr></thead>
          <tbody>
            {filtered.length===0?<tr><td colSpan={9} style={{textAlign:'center',color:G.muted,padding:40}}>Niciun angajat</td></tr>
            :filtered.map(emp=>{
              const sal=salaries[emp.id]
              const expiring=isExpiring(sal?.contract_expiry)
              const expired=isExpired(sal?.contract_expiry)
              return <tr key={emp.id}>
                <td><div style={{display:'flex',alignItems:'center',gap:8}}><Avatar name={emp.name} id={emp.id} size={28}/><span style={{fontWeight:600,fontSize:12}}>{emp.name}</span></div></td>
                <td><span className="badge bd">{emp.department}</span></td>
                <td style={{fontSize:12,color:G.muted}}>{sal?.contract_number||'—'}</td>
                <td>
                  {!sal?.contract_expiry
                    ?<span style={{fontSize:11,fontWeight:700,color:sal?G.blue:G.dim}}>{sal?'∞ Nelimitat':'—'}</span>
                    :<span style={{fontSize:11,fontWeight:700,color:expired?G.red:expiring?G.yellow:G.green}}>
                      {expired?'⚠ ':expiring?'⏰ ':''}{new Date(sal.contract_expiry+'T12:00').toLocaleDateString('ro-RO')}
                    </span>}
                </td>
                <td style={{fontWeight:700,color:sal?.salary_gross?G.text:G.dim}}>{sal?.salary_gross?`${Number(sal.salary_gross).toLocaleString('ro-RO')} RON`:'—'}</td>
                <td style={{fontWeight:700,color:sal?.salary_net?G.green:G.dim}}>{sal?.salary_net?`${Number(sal.salary_net).toLocaleString('ro-RO')} RON`:'—'}</td>
                <td style={{fontSize:12,color:G.muted}}>{sal?.work_hours_per_day||8}h/zi</td>
                <td style={{fontSize:11,color:G.muted}}>{emp.email||'—'}</td>
                <td><button onClick={()=>openEdit(emp)} style={{...S.btnS,padding:'4px 10px',fontSize:11}}>✏️ Edit</button></td>
              </tr>
            })}
          </tbody>
        </table>
      </div>}
    </Layout>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage/>}/>
        <Route path="/" element={<ProtectedRoute><HomeDashboard/></ProtectedRoute>}/>
        <Route path="/panou" element={<ProtectedRoute><DashboardPage/></ProtectedRoute>}/>
        <Route path="/pontaj" element={<ProtectedRoute><PontajPage/></ProtectedRoute>}/>
        <Route path="/rapoarte" element={<ProtectedRoute><ReportsPage/></ProtectedRoute>}/>
        <Route path="/salarii" element={<ProtectedRoute salaryAccess><SalariiPage/></ProtectedRoute>}/>
        <Route path="/admin" element={<ProtectedRoute adminOnly><AdminPage/></ProtectedRoute>}/>
        <Route path="*" element={<Navigate to="/" replace/>}/>
      </Routes>
    </AuthProvider>
  )
}
