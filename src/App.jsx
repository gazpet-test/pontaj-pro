import { useState, useEffect, useCallback, createContext, useContext, useRef } from 'react'
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { supabase } from './lib/supabase.js'
import * as XLSX from 'xlsx-js-style'
import LOGO_B64 from './logo.js'
import LogisticaPage from './Logistica.jsx'
import AppMobilManageri from './AppMobilManageri.jsx'
import RapoarteSantierPage from './RapoarteSantierPage.jsx'
import SedintePage from './SedintePage.jsx'
import Marketing from './Marketing.jsx'
import HRPage from './HR.jsx'
import AdministrativPage from './Administrativ.jsx'
import Tichete from './Tichete.jsx'
import Consumabile from './Consumabile.jsx'
import TabSemnaturi from './TabSemnaturi.jsx'
import ChatbotWidget from './ChatbotWidget.jsx'
import BugReportButton from './BugReportButton.jsx'
import TichetModulButton from './TichetModulButton.jsx'
import InternalChat from './InternalChat.jsx'
// ════════════ Etapa 15 Faza 1: Module Comercial (placeholder) ════════════
import ComercialPage from './Comercial.jsx'
import AchizitiiPage from './Achizitii.jsx'
import OfertarePage from './Ofertare.jsx'
import CTCPage from './CTC.jsx'
import MagaziePage from './Magazie.jsx'
// ════════════ Modul Execuție (Izometrie - Pachete lansare țeavă, 20.05.2026) ════════════
import ExecutiePage from './Executie.jsx'
import FinanciarPage from './Financiar.jsx'
// ════════════ QR Utilaje (27.05.2026) ════════════
import QrUtilajPage from './QrUtilajPage.jsx'
import RsvpSedintaPage from './RsvpSedintaPage.jsx'
import ConcediuMobilPage from './ConcediuMobilPage.jsx'
import HomeScada from './HomeScada.jsx'
// ════════════ Buton global „De aprobat" în navbar (12.06.2026) ════════════
import DeAprobatButton from './DeAprobatButton.jsx'
// Meniurile din bara de sus se randează prin portal — bara are overflow-x:auto
// (swipe pe telefon) și le-ar tăia pe verticală. Vezi PopoverBara.jsx.
import PopoverBara from './PopoverBara.jsx'
// ════════════ PROVIZORIU: corecții registru imobilizări ↔ inventar (24.08.2026) ════════════
// Se scoate (ruta + fișierul InventarCorectii.jsx) când proiectul de aliniere e încheiat.
import InventarCorectii from './InventarCorectii.jsx'
import GraficLucrare from './GraficLucrare.jsx'
import { MeteoStrip } from './Meteo.jsx'

const AuthContext = createContext(null)
const useAuth = () => useContext(AuthContext)

function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined)
  const [profile, setProfile] = useState(null)
  // Anti N+1: previne multiple fetchProfile simultane (GoTrueClient poate emite onAuthStateChange de 5x)
  const fetchingRef = useRef(null)
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => { setSession(session); if (session) fetchProfile(session.user.id) })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => { setSession(session); if (session) fetchProfile(session.user.id); else setProfile(null) })
    return () => subscription.unsubscribe()
  }, [])
  const fetchProfile = async (userId) => {
    if (fetchingRef.current === userId) return
    fetchingRef.current = userId
    try {
      const { data } = await supabase.from('profiles').select('*').eq('id', userId).single()
      if (data) {
        // Load all sites for this manager
        const { data: ps } = await supabase.from('profile_sites').select('site_id').eq('profile_id', userId)
        data.site_ids = (ps || []).map(x => x.site_id)
        // Load module access (Logistică, Pontaj, etc.)
        const { data: ma } = await supabase.from('user_module_access').select('module, access_level').eq('profile_id', userId)
        data.module_access = (ma || []).map(x => x.module)
        data.module_access_levels = Object.fromEntries((ma || []).map(x => [x.module, x.access_level]))
        setProfile(data)
      } else {
        setTimeout(async () => {
          const { data: d2 } = await supabase.from('profiles').select('*').eq('id', userId).single()
          if (d2) {
            const { data: ps } = await supabase.from('profile_sites').select('site_id').eq('profile_id', userId)
            d2.site_ids = (ps || []).map(x => x.site_id)
            const { data: ma2 } = await supabase.from('user_module_access').select('module, access_level').eq('profile_id', userId)
            d2.module_access = (ma2 || []).map(x => x.module)
            d2.module_access_levels = Object.fromEntries((ma2 || []).map(x => [x.module, x.access_level]))
            setProfile(d2)
          }
        }, 1000)
      }
    } catch (e) { console.error(e) }
    finally { if (fetchingRef.current === userId) fetchingRef.current = null }
  }
  const signIn = (email, password) => supabase.auth.signInWithPassword({ email, password })
  const signOut = () => supabase.auth.signOut()
  return <AuthContext.Provider value={{ session, profile, signIn, signOut, fetchProfile }}>{children}</AuthContext.Provider>
}

// ─── Module access helper ───────────────────────────────────────────────────
// Acces dacă: is_owner (bypass total - Razvan + Marilena), SAU user_module_access conține fix cheia,
// SAU conține orice sub-modul de tipul "<cheia>.xxx" (ex: 'pontajpro.pontaj' => are acces la 'pontajpro')
function hasModuleAccess(profile, moduleName) {
  if (!profile) return false
  if (profile.is_owner === true) return true
  const ma = profile.module_access || []
  return ma.some(m => m === moduleName || m.startsWith(moduleName + '.'))
}

function ProtectedRoute({ children, adminOnly = false, salaryAccess = false, requireModule = null }) {
  const { session, profile } = useAuth()
  if (session === undefined) return <LoadingScreen />
  if (!session) return <Navigate to="/login" replace />
  // 25.05.2026: AdminPage acces permisiv granular - is_owner SAU can_modify_employees (Natalia HR)
  // Filtrarea tab-urilor sensibile (Setări) e făcută în interiorul AdminPage
  if (adminOnly && !(profile?.is_owner || profile?.can_modify_employees)) return <Navigate to="/" replace />
  if (salaryAccess && !profile?.can_access_salarii && !profile?.is_owner) return <Navigate to="/" replace />
  if (requireModule && !hasModuleAccess(profile, requireModule)) return <Navigate to="/" replace />
  return children
}

// Consumabile are nevoie de profile (cine cere, ce locații are voie, dacă
// gestionează). Rutele nu primesc props, deci îl iau aici din context.
function ConsumabileRoute() {
  const { profile } = useAuth()
  return <Consumabile profile={profile} />
}

// PROVIZORIU (24.08.2026): corecții registru imobilizări. Gate-ul pe persoane
// (owner + Mitrache/Oancea/Marilena) e în interiorul componentei.
function InventarCorectiiRoute() {
  const { profile } = useAuth()
  return <InventarCorectii profile={profile} />
}

// Graficul de execuție (Gantt + drum critic) al unei lucrări — /grafic/proiect/25
// sau /grafic/licitatie/3. Componenta stă în GraficLucrare.jsx.
function GraficLucrareRoute() {
  const { profile } = useAuth()
  return <GraficLucrare profile={profile} />
}

// ─── Constants ────────────────────────────────────────────────────────────────
const DEPARTMENTS = ['Execuție', 'Logistică', 'TESA']
const NORME = ['BO','BP','AM','CO','CFP','CM','M','O','N','PRM','PRB','LL']
const NORME_LABELS = { BO:'Boală Obișnuită', BP:'Boală Profesională', AM:'Accident de Muncă', CO:'Concediu Odihnă', CFP:'Concediu Fără Plată', CM:'Concediu Medical', M:'Maternitate', O:'Obligații Cetățenești', N:'Absențe Nemotivate', PRM:'Prog.Redus Maternitate', PRB:'Prog.Redus Boală', LL:'Liber Legal' }

// === Helper paginare pentru bypass PostgREST max-rows (1000) ===
// Folosit la query-uri mari (raport lunar, export ITM, etc.) cand pot exista >1000 records.
// Returnează TOATE records-urile fără limită.
async function fetchAllRecords(queryBuilder, pageSize = 1000) {
  const all = []
  let offset = 0
  while (true) {
    const { data, error } = await queryBuilder.range(offset, offset + pageSize - 1)
    if (error) { console.error('fetchAllRecords error:', error); break }
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < pageSize) break
    offset += pageSize
    if (offset > 200000) break  // safety
  }
  return all
}
const LUNCH_START = 12; const LUNCH_END = 13; const LUNCH_MINS = 60
const todayStr = () => new Date().toISOString().split('T')[0]
const fmt24 = (ts) => ts ? new Date(ts).toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit', hour12: false }) : '—'

// Audio feedback pentru acțiuni reușite (Web Audio API, fail-safe)
const playBeep = (freq = 880, dur = 0.1) => {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = freq
    osc.connect(gain); gain.connect(ctx.destination)
    gain.gain.setValueAtTime(0.1, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur)
    osc.start(); osc.stop(ctx.currentTime + dur)
  } catch (_) { /* silent fail dacă AudioContext indisponibil */ }
}
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
.nl{background:none;border:none;cursor:pointer;padding:7px 13px;border-radius:8px;font-family:inherit;font-size:13px;font-weight:600;color:#8B949E;transition:all .2s;white-space:nowrap;flex-shrink:0}
.topbar{overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch}
.topbar::-webkit-scrollbar{display:none}
@media (max-width:719px){.nl{display:none}}
.nl:hover,.nl.active{background:#21262D;color:#E6EDF3}
.nl.active{color:#58A6FF;background:#1F6FEB15}
.badge{display:inline-flex;align-items:center;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700}
.bd{background:#1F3A5A;color:#79C0FF}.bs{background:#2D1F4A;color:#BC8CFF}.ba{background:#2D1F4A;color:#BC8CFF}.bm{background:#1F3A2D;color:#56D364}
@keyframes fi{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
.fi{animation:fi .3s ease}
@keyframes sp{to{transform:rotate(360deg)}}
.sp{width:16px;height:16px;border:2px solid #30363D;border-top-color:#1F6FEB;border-radius:50%;animation:sp .7s linear infinite}
.toast{position:fixed;bottom:96px;right:18px;padding:10px 16px;border-radius:10px;font-size:13px;font-weight:600;z-index:9999;box-shadow:0 8px 32px rgba(0,0,0,.5);animation:fi .3s ease;max-width:min(420px,calc(100vw - 36px))}
`

// ─── Role definitions ─────────────────────────────────────────────────────────
// Cele 6 roluri valide (aliniate cu CHECK constraint profiles_role_chk din BD)
const ROLES_WITH_SITES = ['manager_santier', 'sef_echipa']
const ROLE_BADGES = {
  superadmin:      { label:'⭐ Super Admin',     bg:'#2D1F4A', color:'#BC8CFF' },
  admin_logistica: { label:'🚛 Admin Logistică', bg:'#3A2A0A', color:'#E3B341' },
  manager_santier: { label:'👤 Manager Șantier', bg:'#1F3A2D', color:'#56D364' },
  sef_echipa:      { label:'🏗️ Șef Echipă',     bg:'#1F3A5A', color:'#79C0FF' },
  contabilitate:   { label:'💵 Contabilitate',   bg:'#2D1F4A', color:'#BC8CFF' },
  hr:              { label:'👥 HR',              bg:'#3A1F2D', color:'#F778BA' },
}
function RoleBadge({ role, size='normal' }) {
  const r = ROLE_BADGES[role]
  if (!r) return <span className="badge" style={{background:G.border,color:G.muted}}>— {role||'fără rol'} —</span>
  const px = size==='small' ? '2px 7px' : '2px 8px'
  const fs = size==='small' ? 10 : 11
  return <span className="badge" style={{background:r.bg, color:r.color, padding:px, fontSize:fs}}>{r.label}</span>
}

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
// ─── Change Password Modal ───────────────────────────────────────────────────
function ChangePasswordModal({ onClose }) {
  const [oldPwd, setOldPwd] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [show1, setShow1] = useState(false)
  const [show2, setShow2] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [success, setSuccess] = useState(false)
  
  const handleSubmit = async (e) => {
    e?.preventDefault()
    setErr('')
    if (!oldPwd) { setErr('Completează parola veche'); return }
    if (newPwd.length < 8) { setErr('Parola nouă trebuie minim 8 caractere'); return }
    if (newPwd !== confirmPwd) { setErr('Parolele nu se potrivesc'); return }
    if (newPwd === oldPwd) { setErr('Parola nouă trebuie să fie diferită de cea veche'); return }
    
    setSaving(true)
    
    // Verific parola veche prin re-auth
    const { data: userData } = await supabase.auth.getUser()
    const userEmail = userData?.user?.email
    if (!userEmail) {
      setErr('Sesiune invalidă, deconectează-te și reintră')
      setSaving(false); return
    }
    const { error: signInErr } = await supabase.auth.signInWithPassword({ email: userEmail, password: oldPwd })
    if (signInErr) {
      setErr('Parola veche este incorectă')
      setSaving(false); return
    }
    
    // Update parola
    const { error } = await supabase.auth.updateUser({ password: newPwd })
    setSaving(false)
    if (error) { setErr(`Eroare: ${error.message}`); return }
    
    setSuccess(true)
    setOldPwd(''); setNewPwd(''); setConfirmPwd('')
    setTimeout(onClose, 2500)
  }
  
  if (success) {
    return (
      <div style={{position:'fixed',inset:0,background:'#000000aa',zIndex:300,display:'flex',alignItems:'center',justifyContent:'center'}}>
        <div style={{...S.card,padding:36,maxWidth:420,textAlign:'center'}} className="fi">
          <div style={{fontSize:64,marginBottom:14}}>✅</div>
          <div style={{fontSize:18,fontWeight:800,color:G.green,marginBottom:6}}>Parola schimbată cu succes!</div>
          <div style={{fontSize:13,color:G.muted}}>Folosește-o data viitoare când te conectezi.</div>
        </div>
      </div>
    )
  }
  
  return (
    <div onClick={onClose} style={{position:'fixed',inset:0,background:'#000000aa',zIndex:300,display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'60px 16px'}}>
      <div onClick={e=>e.stopPropagation()} style={{...S.card,padding:24,width:'100%',maxWidth:440,boxShadow:'0 20px 80px rgba(0,0,0,.6)'}} className="fi">
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:18}}>
          <div>
            <div style={{fontSize:18,fontWeight:800,color:G.text,marginBottom:4}}>🔑 Schimbă parola</div>
            <div style={{fontSize:12,color:G.muted}}>Minim 8 caractere</div>
          </div>
          <button onClick={onClose} style={{background:'transparent',border:'none',color:G.muted,fontSize:22,cursor:'pointer',padding:4}}>×</button>
        </div>
        
        <form onSubmit={handleSubmit}>
          <div style={{display:'flex',flexDirection:'column',gap:12}}>
            <div>
              <div style={{fontSize:11,color:G.muted,fontWeight:700,textTransform:'uppercase',letterSpacing:'.5px',marginBottom:5}}>Parola veche</div>
              <input type="password" value={oldPwd} onChange={e=>setOldPwd(e.target.value)} autoFocus style={S.input} placeholder="••••••••"/>
            </div>
            <div>
              <div style={{fontSize:11,color:G.muted,fontWeight:700,textTransform:'uppercase',letterSpacing:'.5px',marginBottom:5}}>Parola nouă</div>
              <div style={{position:'relative'}}>
                <input type={show1?'text':'password'} value={newPwd} onChange={e=>setNewPwd(e.target.value)} style={{...S.input,paddingRight:38}} placeholder="minim 8 caractere"/>
                <button type="button" onClick={()=>setShow1(!show1)} style={{position:'absolute',right:8,top:'50%',transform:'translateY(-50%)',background:'transparent',border:'none',cursor:'pointer',color:G.muted,fontSize:14}}>{show1?'🙈':'👁️'}</button>
              </div>
            </div>
            <div>
              <div style={{fontSize:11,color:G.muted,fontWeight:700,textTransform:'uppercase',letterSpacing:'.5px',marginBottom:5}}>Confirmă parola nouă</div>
              <div style={{position:'relative'}}>
                <input type={show2?'text':'password'} value={confirmPwd} onChange={e=>setConfirmPwd(e.target.value)} style={{...S.input,paddingRight:38}} placeholder="repetă noua parolă"/>
                <button type="button" onClick={()=>setShow2(!show2)} style={{position:'absolute',right:8,top:'50%',transform:'translateY(-50%)',background:'transparent',border:'none',cursor:'pointer',color:G.muted,fontSize:14}}>{show2?'🙈':'👁️'}</button>
              </div>
              {confirmPwd && newPwd && (
                <div style={{fontSize:11,marginTop:4,color:newPwd===confirmPwd?G.green:G.red}}>
                  {newPwd===confirmPwd?'✓ se potrivesc':'✗ nu se potrivesc'}
                </div>
              )}
            </div>
          </div>
          
          {err && <div style={{marginTop:14,padding:10,background:G.redDim,border:`1px solid ${G.red}33`,borderRadius:8,fontSize:12,color:G.red,fontWeight:600}}>⚠️ {err}</div>}
          
          <div style={{display:'flex',justifyContent:'flex-end',gap:8,marginTop:18,paddingTop:14,borderTop:`1px solid ${G.border}`}}>
            <button type="button" onClick={onClose} style={{...S.btnS,fontSize:13,color:G.muted}} disabled={saving}>Anulează</button>
            <button type="submit" disabled={saving||!oldPwd||!newPwd||!confirmPwd} style={{...S.btnP,opacity:(saving||!oldPwd||!newPwd||!confirmPwd)?.5:1}}>
              {saving?'⏳ Se salvează...':'✓ Schimbă parola'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// CHAT NAV BUTTON — buton chat intern în navbar (comunica cu InternalChat via events)
// ════════════════════════════════════════════════════════════════════════════
function ChatNavButton() {
  const [open, setOpen] = useState(false)
  const [unread, setUnread] = useState(0)
  
  useEffect(() => {
    const unreadHandler = (e) => setUnread(e.detail?.count || 0)
    window.addEventListener('gazpet:chat-unread', unreadHandler)
    return () => window.removeEventListener('gazpet:chat-unread', unreadHandler)
  }, [])
  
  const toggle = () => {
    const newState = !open
    setOpen(newState)
    window.dispatchEvent(new CustomEvent('gazpet:chat-toggle', { detail: { open: newState } }))
  }
  
  return (
    <button
      onClick={toggle}
      title="Chat intern Gazpet"
      style={{
        position: 'relative',
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '7px 12px',
        background: open ? G.red + '22' : G.primary + '22',
        color: open ? G.red : G.blue,
        border: `1px solid ${open ? G.red + '55' : G.primary + '55'}`,
        borderRadius: 8,
        fontSize: 14,
        fontWeight: 700,
        cursor: 'pointer',
        transition: 'all .15s',
        fontFamily: 'inherit',
      }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)' }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)' }}
    >
      {open ? '✕' : '💬'} Chat
      {!open && unread > 0 && (
        <span style={{
          background: G.red,
          color: '#fff',
          borderRadius: '50%',
          minWidth: 18,
          height: 18,
          fontSize: 10,
          fontWeight: 800,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0 5px',
          animation: 'cn-pulse 1.5s ease-in-out infinite',
        }}>
          {unread > 99 ? '99+' : unread}
        </span>
      )}
      <style>{`@keyframes cn-pulse { 0%, 100% { transform: scale(1) } 50% { transform: scale(1.18) } }`}</style>
    </button>
  )
}


// ════════════════════════════════════════════════════════════════════════════
// NOTIFICATION BELL — clopoțel notificări cu badge count + dropdown listă
// Auto-refresh la 30s. Click pe item → marchează read_at + navigate la link_to.
// ════════════════════════════════════════════════════════════════════════════
function NotificationBell() {
  const { profile } = useAuth()
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const [notifs, setNotifs] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const dropdownRef = useRef(null)
  const bellBtnRef = useRef(null)
  
  const loadNotifs = useCallback(async () => {
    if (!profile?.id) return
    setLoading(true)
    // Iau ultimele 30, prioritar necitite + recente
    const { data, error } = await supabase
      .from('notifications')
      .select('id, type, modul, title, message, link_to, read_at, created_at')
      .eq('profile_id', profile.id)
      .order('created_at', { ascending: false })
      .limit(30)
    if (!error) {
      setNotifs(data || [])
      setUnreadCount((data || []).filter(n => !n.read_at).length)
    }
    setLoading(false)
  }, [profile?.id])
  
  useEffect(() => {
    loadNotifs()
    // Auto-refresh la 30s
    const t = setInterval(loadNotifs, 30000)
    return () => clearInterval(t)
  }, [loadNotifs])
  
  // Închiderea la click în afară o face overlay-ul din PopoverBara. Nu mai
  // punem handler pe document: panoul e randat prin portal în <body>, deci
  // dropdownRef nu-l mai „conține" — handler-ul l-ar închide chiar la clickul
  // pe el, înainte să apuce butonul dinăuntru să reacționeze.
  
  const markAsRead = async (id) => {
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id)
    setNotifs(prev => prev.map(n => n.id === id ? { ...n, read_at: new Date().toISOString() } : n))
    setUnreadCount(c => Math.max(0, c - 1))
  }
  
  const markAllAsRead = async () => {
    const unreadIds = notifs.filter(n => !n.read_at).map(n => n.id)
    if (unreadIds.length === 0) return
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).in('id', unreadIds)
    setNotifs(prev => prev.map(n => n.read_at ? n : { ...n, read_at: new Date().toISOString() }))
    setUnreadCount(0)
  }
  
  const handleClickNotif = (n) => {
    if (!n.read_at) markAsRead(n.id)
    setOpen(false)
    if (n.link_to) nav(n.link_to)
  }
  
  const timeAgo = (iso) => {
    const diff = (Date.now() - new Date(iso).getTime()) / 1000
    if (diff < 60) return 'acum'
    if (diff < 3600) return `${Math.floor(diff/60)} min`
    if (diff < 86400) return `${Math.floor(diff/3600)} h`
    if (diff < 604800) return `${Math.floor(diff/86400)} zile`
    return new Date(iso).toLocaleDateString('ro-RO', { day: '2-digit', month: 'short' })
  }
  
  const iconForType = (type) => {
    if (type === 'warning' || type === 'error') return '⚠️'
    if (type === 'success') return '✓'
    if (type === 'info') return 'ℹ'
    return '🔔'
  }
  
  const colorForType = (type) => {
    if (type === 'warning') return G.yellow
    if (type === 'error') return G.red
    if (type === 'success') return G.green
    return G.blue
  }
  
  return (
    <div ref={dropdownRef} style={{ position: 'relative' }}>
      <button
        ref={bellBtnRef}
        onClick={() => setOpen(o => !o)}
        title={`Notificări${unreadCount > 0 ? ` (${unreadCount} necitite)` : ''}`}
        style={{
          position: 'relative',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 38, height: 38,
          background: open ? G.blue + '22' : (unreadCount > 0 ? G.red + '11' : 'transparent'),
          color: open ? G.blue : (unreadCount > 0 ? G.red : G.muted),
          border: `1px solid ${open ? G.blue + '55' : (unreadCount > 0 ? G.red + '44' : G.border)}`,
          borderRadius: 8,
          fontSize: 18,
          cursor: 'pointer',
          transition: 'all .15s',
          fontFamily: 'inherit',
        }}
        onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)' }}
        onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)' }}
      >
        🔔
        {unreadCount > 0 && (
          <span style={{
            position: 'absolute',
            top: -4,
            right: -4,
            background: G.red,
            color: '#fff',
            borderRadius: '50%',
            minWidth: 18,
            height: 18,
            fontSize: 10,
            fontWeight: 800,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 5px',
            border: `2px solid #fff`,
            animation: 'nb-pulse 1.8s ease-in-out infinite',
          }}>
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>
      
      {open && (
        <PopoverBara anchorRef={bellBtnRef} onClose={() => setOpen(false)} width={400}>
        <div style={{
          maxHeight: 540,
          background: G.surface,
          border: `1px solid ${G.border}`,
          borderRadius: 12,
          boxShadow: '0 10px 40px rgba(0,0,0,0.4)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}>
          <div style={{
            padding: '12px 16px',
            borderBottom: `1px solid ${G.border}`,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: G.text }}>
              🔔 Notificări {unreadCount > 0 && <span style={{ color: G.red, fontWeight: 600 }}>· {unreadCount} noi</span>}
            </div>
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: G.blue,
                  fontSize: 12,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  padding: 4,
                }}
              >
                Marchează toate
              </button>
            )}
          </div>
          
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {loading && notifs.length === 0 && (
              <div style={{ padding: 40, textAlign: 'center', color: G.muted, fontSize: 13 }}>⏳ Se încarcă...</div>
            )}
            {!loading && notifs.length === 0 && (
              <div style={{ padding: 40, textAlign: 'center', color: G.muted, fontSize: 13 }}>
                <div style={{ fontSize: 36, marginBottom: 8 }}>🔕</div>
                <div>Nicio notificare</div>
              </div>
            )}
            {notifs.map(n => (
              <div
                key={n.id}
                onClick={() => handleClickNotif(n)}
                style={{
                  padding: '12px 16px',
                  borderBottom: `1px solid ${G.border}`,
                  cursor: 'pointer',
                  background: n.read_at ? 'transparent' : G.blue + '08',
                  transition: 'background .15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = G.border + '44' }}
                onMouseLeave={e => { e.currentTarget.style.background = n.read_at ? 'transparent' : G.blue + '08' }}
              >
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{
                    fontSize: 16,
                    width: 26, height: 26,
                    background: colorForType(n.type) + '22',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}>{iconForType(n.type)}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 13,
                      fontWeight: n.read_at ? 500 : 700,
                      color: G.text,
                      marginBottom: 2,
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 8,
                    }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.title}</span>
                      <span style={{ fontSize: 11, color: G.muted, fontWeight: 500, flexShrink: 0 }}>{timeAgo(n.created_at)}</span>
                    </div>
                    {n.modul && (
                      <div style={{ fontSize: 10, color: G.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{n.modul}</div>
                    )}
                    <div style={{
                      fontSize: 12,
                      color: G.muted,
                      lineHeight: 1.4,
                      whiteSpace: 'pre-wrap',
                      display: '-webkit-box',
                      WebkitLineClamp: 4,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}>{n.message}</div>
                    {!n.read_at && (
                      <div style={{
                        marginTop: 6,
                        display: 'inline-block',
                        width: 8, height: 8,
                        background: G.blue,
                        borderRadius: '50%',
                      }}/>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
        </PopoverBara>
      )}
      <style>{`@keyframes nb-pulse { 0%, 100% { transform: scale(1) } 50% { transform: scale(1.2) } }`}</style>
    </div>
  )
}


function Layout({ children }) {
  const { profile, signOut } = useAuth()
  const nav = useNavigate(); const loc = useLocation()
  const [now, setNow] = useState(new Date())
  useEffect(()=>{ const t=setInterval(()=>setNow(new Date()),1000); return ()=>clearInterval(t) },[])
  const isSuperAdmin = profile?.is_owner === true
  const isContabilitate = profile?.role==='contabilitate'
  const hasSalaryAccess = profile?.can_access_salarii === true || profile?.is_owner === true
  const [showPwd, setShowPwd] = useState(false)
  // Tichete ale mele — split deschise de mine vs asignate mie + de confirmat (12.06.2026)
  const [ticheteMele, setTicheteMele] = useState({ deschise: 0, asignate: 0, deConfirmat: 0 })
  const [showTicheteMele, setShowTicheteMele] = useState(false)
  const ticheteMeleRef = useRef(null)
  useEffect(() => {
    if (!profile?.id) return
    // FIX 12.06.2026: + 'rezolvat' (workflow generic) — lipsea, tichetele care așteptau
    // "Confirm rezolvat" de la creator nu se numărau și se uitau neconfirmate
    const ACTIVE = ['deschis','in_analiza','programat_service','in_service','in_lucru','atribuit','reparat','rezolvat']
    const DE_CONFIRMAT = ['rezolvat','reparat']  // așteaptă confirmarea creatorului
    const load = async () => {
      const [r1, r2, r3] = await Promise.all([
        supabase.from('tichete').select('id', { count:'exact', head:true })
          .eq('deschis_de', profile.id).in('status', ACTIVE),
        supabase.from('tichete').select('id', { count:'exact', head:true })
          .eq('persoana_responsabila', profile.id).in('status', ACTIVE),
        supabase.from('tichete').select('id', { count:'exact', head:true })
          .eq('deschis_de', profile.id).in('status', DE_CONFIRMAT),
      ])
      setTicheteMele({ deschise: r1.count || 0, asignate: r2.count || 0, deConfirmat: r3.count || 0 })
    }
    load()
    const t = setInterval(load, 60000)
    return () => clearInterval(t)
  }, [profile?.id])
  // Externii (email non-@gazpet.ro, ex. partenerul Adrom Evolution) nu văd Tichete/Consumabile
  const esteExtern = !(profile?.email || '').toLowerCase().endsWith('@gazpet.ro')
  const navItems = [
    {p:'/',i:'🏠',l:'Acasă'},
    ...(hasModuleAccess(profile, 'pontajpro') ? [
      {p:'/panou',i:'📊',l:'Panou'},
      {p:'/pontaj',i:'👥',l:'Pontaj'},
      {p:'/rapoarte',i:'📈',l:'Rapoarte'},
    ] : []),
    ...(hasModuleAccess(profile, 'logistica') ? [{p:'/logistica',i:'🚛',l:'Logistică'}] : []),
    ...(hasModuleAccess(profile, 'hr') ? [{p:'/hr',i:'👥',l:'HR'}] : []),
    ...(hasModuleAccess(profile, 'administrativ') ? [{p:'/administrativ',i:'🏢',l:'Administrativ'}] : []),
    ...(esteExtern ? [] : [
      { p:'/tichete', i:'🎫', l:'Tichete' },
      { p:'/consumabile', i:'🛒', l:'Consumabile' },
    ]),
    ...(hasSalaryAccess?[{p:'/salarii',i:'💵',l:'Salarii'}]:[]),
    ...(isSuperAdmin || profile?.can_modify_employees === true ? [{p:'/admin',i:'⚙️',l:'Admin'}] : []),
  ]
  return (
    <div style={S.page}><style>{css}</style>
      {/* topbar: pe telefon toată banda se derulează cu degetul (nimic nu forțează pagina la zoom-out) */}
      <div className="topbar" style={{background:G.surface,borderBottom:`1px solid ${G.border}`,padding:'0 14px',display:'flex',alignItems:'center',height:56,gap:14,position:'sticky',top:0,zIndex:100}}>
        {/* logo = buton Acasă (pe mobil taburile-s ascunse, navigarea se face din cardurile de pe home) */}
        <div onClick={()=>nav('/')} title="Acasă" style={{display:'flex',alignItems:'center',gap:9,marginRight:6,flexShrink:0,cursor:'pointer'}}>
          <div style={{width:28,height:28,background:'linear-gradient(135deg,#1F6FEB,#388BFD)',borderRadius:7,display:'flex',alignItems:'center',justifyContent:'center',fontSize:14}}>⏱</div>
          <span style={{fontWeight:800,fontSize:14,letterSpacing:'-.3px'}}>PontajPRO</span>
        </div>
        {navItems.map(x=><button key={x.p} className={`nl ${loc.pathname===x.p?'active':''}`} onClick={()=>nav(x.p)}>{x.i} {x.l}</button>)}
        <div style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:12,flexShrink:0}}>
          {/* Buton global De aprobat — comenzi furnizor + transporturi care așteaptă decizia user-ului (12.06.2026) */}
          <DeAprobatButton profile={profile} />
          {/* Buton global Cere Transport — vizibil pentru oricine cu acces la modulul comanda_transport */}
          {hasModuleAccess(profile, 'comanda_transport') && (
            <button
              onClick={() => nav('/logistica?tab=transporturi&action=new')}
              title="Solicită un transport (acces rapid din orice modul)"
              style={{
                display:'flex', alignItems:'center', gap:6,
                padding:'7px 14px',
                background: '#E3B341' + '22',
                color: '#E3B341',
                border: `1px solid #E3B341` + '55',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'all .15s',
                fontFamily: 'inherit',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = '#E3B341' + '33'; e.currentTarget.style.transform = 'translateY(-1px)' }}
              onMouseLeave={e => { e.currentTarget.style.background = '#E3B341' + '22'; e.currentTarget.style.transform = 'translateY(0)' }}
            >
              🚚 Cere transport
            </button>
          )}
          {!esteExtern && (<>
          <button
            onClick={() => nav('/tichete')}
            title="Modul Tichete - avarii, defecțiuni, reclamații"
            style={{
              display:'flex', alignItems:'center', gap:6,
              padding:'7px 14px',
              background: G.purple + '22',
              color: G.purple,
              border: `1px solid ${G.purple}55`,
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'all .15s',
              fontFamily: 'inherit',
              position: 'relative',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = G.purple + '33'; e.currentTarget.style.transform = 'translateY(-1px)' }}
            onMouseLeave={e => { e.currentTarget.style.background = G.purple + '22'; e.currentTarget.style.transform = 'translateY(0)' }}
          >
            🎫 Tichete
          </button>
          {/* Ale mele — popover split */}
          <div style={{ position:'relative' }}>
            <button
              ref={ticheteMeleRef}
              onClick={() => setShowTicheteMele(v => !v)}
              title={ticheteMele.deConfirmat > 0 ? `Ai ${ticheteMele.deConfirmat} tichet(e) rezolvate care așteaptă confirmarea ta!` : "Tichete ale mele — deschise de mine + asignate mie"}
              style={{
                display:'flex', alignItems:'center', gap:6,
                padding:'6px 12px',
                background: ticheteMele.deConfirmat > 0 ? G.green+'33' : (ticheteMele.deschise + ticheteMele.asignate) > 0 ? G.purple+'33' : G.bg,
                color: ticheteMele.deConfirmat > 0 ? G.green : (ticheteMele.deschise + ticheteMele.asignate) > 0 ? G.purple : G.dim,
                border:`1px solid ${ticheteMele.deConfirmat > 0 ? G.green : (ticheteMele.deschise + ticheteMele.asignate) > 0 ? G.purple : G.border}`,
                borderRadius:8, fontSize:11, fontWeight:700, cursor:'pointer',
                fontFamily:'inherit', marginLeft:-8, transition:'all .15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = (ticheteMele.deConfirmat>0?G.green:G.purple)+'33'; e.currentTarget.style.color = ticheteMele.deConfirmat>0?G.green:G.purple; e.currentTarget.style.borderColor = ticheteMele.deConfirmat>0?G.green:G.purple }}
              onMouseLeave={e => { const tot = ticheteMele.deschise+ticheteMele.asignate; const c = ticheteMele.deConfirmat>0?G.green:G.purple; e.currentTarget.style.background = ticheteMele.deConfirmat>0?c+'33':tot>0?c+'33':G.bg; e.currentTarget.style.color = (ticheteMele.deConfirmat>0||tot>0)?c:G.dim; e.currentTarget.style.borderColor = (ticheteMele.deConfirmat>0||tot>0)?c:G.border }}
            >
              Ale mele
              {ticheteMele.deConfirmat > 0 && (
                <span style={{ background:G.green, color:'#fff', borderRadius:10, padding:'1px 6px', fontSize:10, fontWeight:800, animation:'nb-pulse 1.5s infinite' }}>
                  🎉 {ticheteMele.deConfirmat}
                </span>
              )}
              {(ticheteMele.deschise + ticheteMele.asignate) > 0 && (
                <span style={{ background:ticheteMele.deConfirmat > 0 ? G.purple+'88' : G.purple, color:'#fff', borderRadius:10, padding:'1px 6px', fontSize:10, fontWeight:800 }}>
                  {ticheteMele.deschise + ticheteMele.asignate}
                </span>
              )}
              <span style={{ fontSize:9, opacity:.6 }}>{showTicheteMele ? '▲' : '▼'}</span>
            </button>

            {showTicheteMele && (
              <PopoverBara anchorRef={ticheteMeleRef} onClose={() => setShowTicheteMele(false)} width={240}>
                <div style={{
                  background:G.surface, border:`1px solid ${G.border}`,
                  borderRadius:12, boxShadow:'0 8px 32px rgba(0,0,0,.4)',
                  overflow:'hidden',
                }}>
                  {/* Header */}
                  <div style={{ padding:'10px 14px', borderBottom:`1px solid ${G.border}`, fontSize:11, color:G.muted, fontWeight:700, textTransform:'uppercase', letterSpacing:'.5px' }}>
                    🎫 Tichete active ale mele
                  </div>
                  {/* De confirmat — tichete rezolvate/reparate create de mine, așteaptă confirmarea mea (12.06.2026) */}
                  {ticheteMele.deConfirmat > 0 && (
                    <button onClick={() => { nav('/tichete?mine=true&filter=de_confirmat'); setShowTicheteMele(false) }}
                      style={{ display:'flex', alignItems:'center', gap:10, width:'100%', padding:'12px 14px', background:G.green+'11', border:'none', cursor:'pointer', borderBottom:`1px solid ${G.border}`, transition:'background .1s' }}
                      onMouseEnter={e => e.currentTarget.style.background=G.green+'22'}
                      onMouseLeave={e => e.currentTarget.style.background=G.green+'11'}>
                      <div style={{ width:36, height:36, borderRadius:8, background:G.green+'22', display:'flex', alignItems:'center', justifyContent:'center', fontSize:18, flexShrink:0 }}>🎉</div>
                      <div style={{ textAlign:'left' }}>
                        <div style={{ fontSize:12, fontWeight:700, color:G.green }}>De confirmat rezolvate</div>
                        <div style={{ fontSize:11, color:G.muted }}>Așteaptă confirmarea ta!</div>
                      </div>
                      <div style={{ marginLeft:'auto', fontSize:22, fontWeight:800, color:G.green }}>
                        {ticheteMele.deConfirmat}
                      </div>
                    </button>
                  )}
                  {/* Deschise de mine */}
                  <button onClick={() => { nav('/tichete?mine=true&filter=deschise'); setShowTicheteMele(false) }}
                    style={{ display:'flex', alignItems:'center', gap:10, width:'100%', padding:'12px 14px', background:'transparent', border:'none', cursor:'pointer', borderBottom:`1px solid ${G.border}`, transition:'background .1s' }}
                    onMouseEnter={e => e.currentTarget.style.background=G.bg}
                    onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                    <div style={{ width:36, height:36, borderRadius:8, background:G.blue+'22', display:'flex', alignItems:'center', justifyContent:'center', fontSize:18, flexShrink:0 }}>📝</div>
                    <div style={{ textAlign:'left' }}>
                      <div style={{ fontSize:12, fontWeight:700, color:G.text }}>Deschise de mine</div>
                      <div style={{ fontSize:11, color:G.muted }}>Tichete create de tine</div>
                    </div>
                    <div style={{ marginLeft:'auto', fontSize:22, fontWeight:800, color: ticheteMele.deschise > 0 ? G.blue : G.dim }}>
                      {ticheteMele.deschise}
                    </div>
                  </button>
                  {/* Asignate mie */}
                  <button onClick={() => { nav('/tichete?mine=true&filter=asignate'); setShowTicheteMele(false) }}
                    style={{ display:'flex', alignItems:'center', gap:10, width:'100%', padding:'12px 14px', background:'transparent', border:'none', cursor:'pointer', borderBottom:`1px solid ${G.border}`, transition:'background .1s' }}
                    onMouseEnter={e => e.currentTarget.style.background=G.bg}
                    onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                    <div style={{ width:36, height:36, borderRadius:8, background:G.orange+'22', display:'flex', alignItems:'center', justifyContent:'center', fontSize:18, flexShrink:0 }}>👤</div>
                    <div style={{ textAlign:'left' }}>
                      <div style={{ fontSize:12, fontWeight:700, color:G.text }}>Asignate mie</div>
                      <div style={{ fontSize:11, color:G.muted }}>Tichete de rezolvat</div>
                    </div>
                    <div style={{ marginLeft:'auto', fontSize:22, fontWeight:800, color: ticheteMele.asignate > 0 ? G.orange : G.dim }}>
                      {ticheteMele.asignate}
                    </div>
                  </button>
                  {/* Total + link */}
                  <button onClick={() => { nav('/tichete?mine=true'); setShowTicheteMele(false) }}
                    style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:6, width:'100%', padding:'10px 14px', background:G.purple+'11', border:'none', cursor:'pointer', fontSize:12, fontWeight:700, color:G.purple, transition:'background .1s' }}
                    onMouseEnter={e => e.currentTarget.style.background=G.purple+'22'}
                    onMouseLeave={e => e.currentTarget.style.background=G.purple+'11'}>
                    📋 Vezi toate ale mele ({ticheteMele.deschise + ticheteMele.asignate})
                  </button>
                </div>
              </PopoverBara>
            )}
          </div>
          <button
            onClick={() => nav('/tichete?action=new')}
            title="Deschide tichet nou rapid (avarie / defecțiune / reclamație)"
            style={{
              display:'flex', alignItems:'center', justifyContent:'center',
              width: 34, height: 34,
              padding: 0,
              background: G.purple + '11',
              color: G.purple,
              border: `1px dashed ${G.purple}66`,
              borderRadius: 8,
              fontSize: 18,
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'all .15s',
              fontFamily: 'inherit',
              marginLeft: -4,
            }}
            onMouseEnter={e => { e.currentTarget.style.background = G.purple + '33'; e.currentTarget.style.borderStyle = 'solid'; e.currentTarget.style.transform = 'scale(1.08)' }}
            onMouseLeave={e => { e.currentTarget.style.background = G.purple + '11'; e.currentTarget.style.borderStyle = 'dashed'; e.currentTarget.style.transform = 'scale(1)' }}
          >
            ＋
          </button>
          </>)}
          <ChatNavButton />
          <NotificationBell />
          <div style={{textAlign:'right'}}>
            <div style={{fontSize:17,fontWeight:800,color:G.blue,fontVariantNumeric:'tabular-nums'}}>{now.toLocaleTimeString('ro-RO',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false})}</div>
            <div style={{fontSize:10,color:G.muted}}>{now.toLocaleDateString('ro-RO',{weekday:'short',day:'numeric',month:'short'})}</div>
          </div>
          <div style={{width:1,height:28,background:G.border}}/>
          <Avatar name={profile?.name} id={1} size={28}/>
          <div>
            <div style={{fontSize:12,fontWeight:600,lineHeight:1.3}}>{profile?.name||profile?.email?.split('@')[0]}</div>
            <RoleBadge role={profile?.role} size="small"/>
          </div>
          <button className="nl" onClick={()=>setShowPwd(true)} title="Schimbă parola" style={{padding:'5px 8px',color:G.muted}}>🔑</button>
          <button className="nl" onClick={signOut} title="Ieșire" style={{color:G.red,padding:'5px 8px'}}>⎋</button>
        </div>
      </div>
      <div style={{padding:'22px 26px',maxWidth:1500,margin:'0 auto'}} className="fi">{children}</div>
      <div style={{textAlign:'center',padding:'12px',fontSize:12,color:'#E53935',fontWeight:700,borderTop:`1px solid ${G.border}`,marginTop:20,letterSpacing:'.3px'}}>
        Made by Trusu Razvan - Administrator Gazpet Instal
      </div>
      {showPwd && <ChangePasswordModal onClose={()=>setShowPwd(false)} />}
    </div>
  )
}


// ─── Home Dashboard (Module Selector) ─────────────────────────────────────────
function HomeDashboard() {
  const { profile, signOut } = useAuth()
  const nav = useNavigate()
  const [now, setNow] = useState(new Date())
  useEffect(()=>{ const t=setInterval(()=>setNow(new Date()),1000); return ()=>clearInterval(t) },[])
  const isSuperAdmin = profile?.is_owner === true
  const isContabilitate = profile?.role==='contabilitate'
  const hasSalaryAccess = profile?.can_access_salarii === true || profile?.is_owner === true

  const allModules = [
    { path:'/panou',    icon:'⏱',  label:'PontajPRO',   color:'#1F6FEB', desc:'Pontaj · Diurne · Salarii · ITM', active:true, requireModule:'pontajpro' },
    { path:'/financiar', icon:'💰', label:'Financiar',   color:'#2EA043', desc:'Facturi emise · Generator · Email · NAS', active:true, requireModule:'financiar' },
    { path:'/logistica', icon:'🚛', label:'Logistică',   color:'#E3B341', desc:'Flotă · Combustibil · Trasee',     active:true, requireModule:'logistica' },
    { path:'/ofertare', icon:'📋', label:'Ofertare',    color:'#3FB6E2', desc:'Cereri ofertă · Licitații · Calculații', active:true, requireModule:'ofertare' },
    { path:'/magazie',  icon:'📦', label:'Magazie',     color:'#FF7B72', desc:'Stocuri · Inventar · Materiale',   active:true, requireModule:'magazie' },
    { path:'/comercial', icon:'🛒', label:'Comercial',   color:'#A371F7', desc:'Vânzări · Contracte · CRM',        active:true, requireModule:'comercial' },
    { path:'/achizitii', icon:'📥', label:'Achiziții',   color:'#3FB950', desc:'Inbox comenzi · Procesare · Recepție', active:true, requireModule:'achizitii' },
    { path:'/ctc',      icon:'📑', label:'CTC',         color:'#BC8CFF', desc:'Cărți Tehnice · Arhivă documente', active:true, requireModule:'ctc' },
    { path:'/administrativ', icon:'🏢', label:'Administrativ',color:'#F0883E',desc:'Documente · Furnizori · Active', active:true, requireModule:'administrativ' },
    { path:'/hr',       icon:'👥', label:'HR',           color:'#EC6CB9', desc:'Personal · Autorizații · Training',  active:true, requireModule:'hr' },
    { path:'/tichete',  icon:'🎫', label:'Tichete',      color:'#BC8CFF', desc:'Avarii · Defecțiuni · Reclamații',   active:true },
    { path:'/consumabile', icon:'🛒', label:'Consumabile', color:'#F0883E', desc:'Papetărie · Protocol · Curățenie · IT', active:true },
    { path:'/executie', icon:'🏗️', label:'Execuție',    color:'#58A6FF', desc:'Izometrie · Șantiere · Devize · Vreme live', active:true, requireModule:'executie' },
    { path:'/rapoarte-santier', icon:'📋', label:'Rapoarte Șantier', color:'#E3B341', desc:'Rapoarte zilnice · Istoric · Poze', active:true, rolesAllow:['manager_santier','sef_echipa','contabilitate'], moduleKey:'rapoarte_santier' },
    { path:'/sedinte',  icon:'🗓️', label:'Ședințe',      color:'#56D4DD', desc:'Progres · Acțiuni · Restanțe', active:true, rolesAllow:['manager_santier','sef_echipa','contabilitate','admin_logistica'], moduleKey:'sedinte' },
    { path:'/marketing', icon:'📣', label:'Marketing',   color:'#1877F2', desc:'Postări Facebook · din rapoartele de șantier', active:true, requireModule:'marketing' },
    // TEMPORAR (24.08.2026): se șterge împreună cu ruta + InventarCorectii.jsx la finalul proiectului de aliniere
    { path:'/inventar-corectii', icon:'🏷️', label:'Inventar Corecții', color:'#D29922', desc:'Registru ↔ BD · VECHI→NOU · TEMPORAR', active:true, emailsAllow:['m.alexandru@gazpet.ro','daniel.oancea@gazpet.ro','marilena.tudorache@gazpet.ro'] },
  ]
  // Filtrez modulele active la care user-ul nu are acces (zero scurgere de info)
  // rolesAllow = vizibil pt owner + rolurile listate + oricine are cheia moduleKey
  // bifată explicit în user_module_access (modelul DUAL — rol SAU bifă per persoană).
  const modules = allModules.filter(m => {
    if (!m.active) return true
    // emailsAllow = card temporar vizibil doar pt owner + emailurile listate (ex. Inventar Corecții)
    if (m.emailsAllow) return profile?.is_owner || m.emailsAllow.includes((profile?.email || '').toLowerCase())
    if (m.rolesAllow) return profile?.is_owner || m.rolesAllow.includes(profile?.role) || (m.moduleKey && hasModuleAccess(profile, m.moduleKey))
    if (!m.requireModule) return true
    return hasModuleAccess(profile, m.requireModule)
  })

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
        <ChatNavButton />
        <button
          onClick={() => nav('/tichete')}
          title="Modul Tichete"
          style={{
            display:'flex', alignItems:'center', gap:6,
            padding:'7px 14px',
            background: '#BC8CFF22',
            color: '#BC8CFF',
            border: '1px solid #BC8CFF55',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 700,
            cursor: 'pointer',
            fontFamily: 'inherit',
            marginLeft: 4,
          }}>
          🎫 Tichete
        </button>
        <div style={{display:'flex',alignItems:'center',gap:10,marginLeft:10}}>
          <Avatar name={profile?.name} id={1} size={32}/>
          <div>
            <div style={{fontSize:13,fontWeight:600,color:'#E6EDF3',lineHeight:1.3}}>{profile?.name||profile?.email?.split('@')[0]}</div>
            <RoleBadge role={profile?.role} size="small"/>
          </div>
          <button onClick={signOut} style={{background:'transparent',border:'1px solid #30363D',color:'#8B949E',borderRadius:6,padding:'5px 12px',cursor:'pointer',fontSize:12,marginLeft:8}}>Ieșire</button>
        </div>
      </div>
      <MeteoStrip />

      {/* PWA: propunere de instalare pe telefon (dismissable) */}
      <InstallPwaBanner />

      {/* Corp home: salut + module (cifre live) + SCADA (todo #693) — componentă separată */}
      <HomeScada profile={profile} modules={modules} onOpen={p => nav(p)} />

      <div style={{textAlign:'center',padding:'16px',fontSize:11,color:'#E53935',fontWeight:700,borderTop:'1px solid #21262D',marginTop:'auto',letterSpacing:'.3px'}}>
        Made by Trusu Razvan - Administrator Gazpet Instal
      </div>
    </div>
  )
}

// ─── PWA: banner „Instalează aplicația" (prompt nativ Android/desktop, hint iPhone)
function InstallPwaBanner() {
  const [deferred, setDeferred] = useState(null)
  const [ascuns, setAscuns] = useState(() => { try { return localStorage.getItem('pwa_banner_ascuns') === '1' } catch { return false } })
  const [instalat, setInstalat] = useState(false)
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true
  const esteiOS = /iphone|ipad|ipod/i.test(navigator.userAgent)

  useEffect(() => {
    const h = (e) => { e.preventDefault(); setDeferred(e) }
    const done = () => setInstalat(true)
    window.addEventListener('beforeinstallprompt', h)
    window.addEventListener('appinstalled', done)
    return () => { window.removeEventListener('beforeinstallprompt', h); window.removeEventListener('appinstalled', done) }
  }, [])

  if (standalone || instalat || ascuns) return null
  if (!deferred && !esteiOS) return null
  const inchide = () => { try { localStorage.setItem('pwa_banner_ascuns', '1') } catch { /* privat */ } setAscuns(true) }

  return (
    <div style={{maxWidth:1200,margin:'0 auto',padding:'0 24px'}}>
      <div style={{display:'flex',alignItems:'center',gap:12,background:'#161B22',border:'1px solid #30363D',borderRadius:12,padding:'10px 14px',marginTop:14}}>
        <img src="/icon-192.png" alt="" style={{width:34,height:34,borderRadius:8,background:'#fff'}}/>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:14,fontWeight:700,color:'#E6EDF3'}}>Instalează PontajPRO pe telefon</div>
          <div style={{fontSize:12,color:'#8B949E'}}>
            {esteiOS && !deferred
              ? 'Pe iPhone: Safari → butonul Share (pătratul cu săgeată) → „Adaugă pe ecranul principal".'
              : 'Icon pe ecran, pornește pe tot ecranul — ca o aplicație normală.'}
          </div>
        </div>
        {deferred && (
          <button
            onClick={async () => { deferred.prompt(); const r = await deferred.userChoice.catch(() => null); if (r?.outcome === 'accepted') setInstalat(true); setDeferred(null) }}
            style={{background:'#1F6FEB',border:'none',color:'#fff',borderRadius:8,padding:'8px 14px',fontSize:13,fontWeight:700,cursor:'pointer',whiteSpace:'nowrap'}}>
            📲 Instalează
          </button>
        )}
        <button onClick={inchide} title="Nu-mi mai arăta" style={{background:'transparent',border:'none',color:'#6E7681',fontSize:18,cursor:'pointer',padding:'0 2px'}}>×</button>
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

// ─── Mesaj de la companie (afișat pe toate paginile) ─────────────────────────
function MesajCompanieBox() {
  const [mesaj, setMesaj] = useState(null)
  const [dismissed, setDismissed] = useState(false)
  
  useEffect(() => {
    let mounted = true
    const load = async () => {
      const { data } = await supabase.from('settings').select('key, value')
        .in('key', ['mesaj_companie_text', 'mesaj_companie_activ', 'mesaj_companie_tip', 'mesaj_companie_data'])
      if (!mounted || !data) return
      const map = Object.fromEntries(data.map(s => [s.key, s.value]))
      if (map.mesaj_companie_activ === 'true' && map.mesaj_companie_text?.trim()) {
        setMesaj({
          text: map.mesaj_companie_text,
          tip: map.mesaj_companie_tip || 'info',
          data: map.mesaj_companie_data
        })
      } else {
        setMesaj(null)
      }
    }
    load()
    // Reload la 60 sec dacă tab-ul e vizibil (mesaje noi)
    const iv = setInterval(load, 60000)
    return () => { mounted = false; clearInterval(iv) }
  }, [])
  
  // Verifică dismiss state din sessionStorage
  useEffect(() => {
    if (mesaj && mesaj.data) {
      const dismissedAt = sessionStorage.getItem('mesaj_companie_dismissed')
      if (dismissedAt === mesaj.data) setDismissed(true)
      else setDismissed(false)
    }
  }, [mesaj?.data])
  
  if (!mesaj || dismissed) return null
  
  const styles = {
    info:     { bg: 'linear-gradient(135deg, #1E3A8A 0%, #2563EB 100%)', border: '#3B82F6', icon: '📢' },
    warning:  { bg: 'linear-gradient(135deg, #78350F 0%, #C2410C 100%)', border: '#F59E0B', icon: '⚠️' },
    critical: { bg: 'linear-gradient(135deg, #7F1D1D 0%, #DC2626 100%)', border: '#EF4444', icon: '🚨' },
  }[mesaj.tip] || styles?.info
  
  const handleDismiss = () => {
    sessionStorage.setItem('mesaj_companie_dismissed', mesaj.data || '')
    setDismissed(true)
  }
  
  return (
    <div style={{
      background: styles.bg,
      border: `2px solid ${styles.border}`,
      borderRadius: 12,
      padding: '14px 18px',
      marginBottom: 14,
      display: 'flex',
      alignItems: 'flex-start',
      gap: 14,
      position: 'relative'
    }}>
      <div style={{fontSize: 28, lineHeight: 1, flexShrink: 0}}>{styles.icon}</div>
      <div style={{flex: 1, minWidth: 0}}>
        <div style={{fontSize: 11, fontWeight: 800, color: '#FFF', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6, opacity: 0.9}}>
          📨 Mesaj din partea companiei
        </div>
        <div style={{fontSize: 14, color: '#FFF', lineHeight: 1.55, whiteSpace: 'pre-wrap', wordWrap: 'break-word'}}>
          {mesaj.text}
        </div>
        {mesaj.data && (
          <div style={{fontSize: 10, color: 'rgba(255,255,255,0.7)', marginTop: 6}}>
            {new Date(mesaj.data).toLocaleString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </div>
        )}
      </div>
      <button
        onClick={handleDismiss}
        style={{
          padding: '4px 10px',
          background: 'rgba(255,255,255,0.15)',
          color: '#FFF',
          border: '1px solid rgba(255,255,255,0.3)',
          borderRadius: 6,
          fontSize: 12,
          cursor: 'pointer',
          fontWeight: 600,
          flexShrink: 0
        }}
        title="Marchează ca citit (până la următorul mesaj)"
      >✕</button>
    </div>
  )
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
function DashboardPage() {
  const { profile } = useAuth()
  const [stats,setStats]=useState({present:0,checkedOut:0,total:0,avgMins:0,diurna:0})
  const [deptStats,setDeptStats]=useState([])
  const [siteStats,setSiteStats]=useState([])  // prezență pe fiecare șantier (nr persoane prezente azi)
  const [unalloc,setUnalloc]=useState([])
  const [load,setLoad]=useState(true)
  const [weekStats,setWeekStats]=useState(null)
  const [monthStats,setMonthStats]=useState(null)
  const [absent3,setAbsent3]=useState([])
  const isAdmin = profile?.is_owner === true || profile?.role === 'contabilitate' || profile?.can_access_pontaj_brut === true
  const [expiringContracts,setExpiringContracts]=useState([])
  const [avizeNesemnate, setAvizeNesemnate] = useState([])  // avize cu 2/3 semnături > 3 zile (pentru manageri destinație)
  const navigate = useNavigate()
  useEffect(()=>{ if(profile!==null) loadData() },[profile])
  const loadData = async () => {
    setLoad(true)
    const today=todayStr()
    let eq=supabase.from('employees').select('*,sites(name)').eq('active',true)
      .or(`termination_date.is.null,termination_date.gte.${today}`)
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
    // Prezență pe fiecare șantier: grupez prezenții de azi (check_in fără normă) după șantierul angajatului
    const siteMap = {}
    ;(recs||[]).filter(x=>x.check_in&&!x.norma).forEach(r=>{
      const s = r.employees?.sites?.name || 'Fără șantier'
      siteMap[s] = (siteMap[s]||0) + 1
    })
    setSiteStats(Object.entries(siteMap).map(([name,present])=>({name,present})).sort((a,b)=>b.present-a.present))
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
      supabase.from('pontaj_records').select('*').gte('date',weekStartStr).lte('date',todayStr()).in('employee_id',empIds).limit(50000),
      supabase.from('pontaj_records').select('*').gte('date',monthStartStr).lte('date',todayStr()).in('employee_id',empIds).limit(50000)
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
      const {data:last3Recs}=await supabase.from('pontaj_records').select('employee_id,date,check_in,norma').in('date',last3).in('employee_id',empIds).limit(50000)
      const absentEmps=emps.filter(e=>{
        return last3.every(day=>{
          const r=(last3Recs||[]).find(x=>x.employee_id===e.id&&x.date===day)
          return !r||(r.norma===null&&r.check_in===null)
        })
      })
      setAbsent3(absentEmps)
    }
    
    // Avize cu 2/3 semnături > 3 zile fără confirmare destinatar
    // Vizibile pentru: managerul destinatie + aprobatori + admin
    const isAprobatorTransport = profile?.is_owner === true || profile?.role === 'admin_logistica'
    {
      const treshold = new Date(); treshold.setDate(treshold.getDate() - 3)
      const tresholdStr = treshold.toISOString()
      let q = supabase
        .from('logistica_transporturi')
        .select('id, numar_transport, data_transport, aviz_data, manager_destinatie:profiles!manager_destinatie_id(id, name, email), destinatie_site:sites!destinatie_site_id(name), destinatie_locatie_text, destinatie_tip')
        .not('semnatura_expeditor_data', 'is', null)
        .not('semnatura_sofer_data', 'is', null)
        .is('semnatura_destinatar_data', null)
        .lt('aviz_data', tresholdStr)
        .order('aviz_data', { ascending: true })
        .limit(20)
      
      // Restrict pentru manager destinatie: doar avizele LUI
      if (!isAdmin && !isAprobatorTransport) {
        q = q.eq('manager_destinatie_id', profile?.id)
      }
      
      const { data: avizeNesem } = await q
      setAvizeNesemnate(avizeNesem || [])
    }

    // Check expiring contracts (next 30 days) - superadmin + contabilitate + hr
    if(profile?.is_owner === true || ['contabilitate','hr'].includes(profile?.role)){
      const in30=new Date(); in30.setDate(in30.getDate()+30)
      const {data:expiring}=await supabase.from('employee_salaries').select('*,employees(name)').not('contract_expiry','is',null).lte('contract_expiry',in30.toISOString().split('T')[0]).gte('contract_expiry',todayStr())
      setExpiringContracts(expiring||[])
    }
  }
  if (load) return <Layout><div style={{display:'flex',justifyContent:'center',padding:80}}><div className="sp" style={{width:30,height:30}}/></div></Layout>
  return (
    <Layout>
      <div style={{fontSize:19,fontWeight:800,marginBottom:18}}>Bun venit{profile?.name?`, ${profile.name.split(' ')[0]}`:''}! 👋</div>

      {/* Mesaj global de la companie (administrat din Admin → Setări) */}
      <MesajCompanieBox />

      {/* Alerta contracte care expira */}
      {expiringContracts.length>0&&<div style={{background:'#1A1A3A',border:`1px solid ${G.purple}44`,borderRadius:10,padding:'10px 16px',marginBottom:12,display:'flex',alignItems:'center',gap:10}}>
        <span style={{fontSize:18}}>📋</span>
        <div><div style={{fontSize:12,fontWeight:700,color:G.purple}}>{expiringContracts.length} contracte expiră în următoarele 30 zile!</div>
        <div style={{fontSize:11,color:G.purple+'99'}}>{expiringContracts.slice(0,3).map(e=>`${e.employees?.name} (${new Date(e.contract_expiry).toLocaleDateString('ro-RO')})`).join(', ')}{expiringContracts.length>3?` +${expiringContracts.length-3}`:''}</div></div>
      </div>}
      
      {/* Alerta transporturi pendinte a fost mutată exclusiv în modulul Logistică
         (widget „Transporturi cerute — așteaptă aprobare"), ca să nu apară în Pontaj/Panou. */}

      {/* === ALERTĂ AVIZE NESEMNATE DE DESTINATAR > 3 ZILE === */}
      {avizeNesemnate.length > 0 && (
        <div 
          onClick={() => navigate('/logistica?tab=transporturi')}
          style={{
            background: 'linear-gradient(135deg, #78350F 0%, #92400E 100%)',
            border: `2px solid #F59E0B`,
            borderRadius: 12,
            padding: '12px 18px',
            marginBottom: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            cursor: 'pointer',
            transition: 'transform 0.15s'
          }}
          onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-2px)'}
          onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}
        >
          <div style={{fontSize: 28, lineHeight: 1}}>⏰</div>
          <div style={{flex: 1}}>
            <div style={{fontSize: 14, fontWeight: 800, color: '#FFF', marginBottom: 4}}>
              {avizeNesemnate.length} {avizeNesemnate.length === 1 ? 'aviz așteaptă' : 'avize așteaptă'} confirmare destinatar &gt; 3 zile!
            </div>
            <div style={{fontSize: 11, color: '#FCD34D', lineHeight: 1.5}}>
              {avizeNesemnate.slice(0, 3).map(a => {
                const dest = a.destinatie_tip === 'site' ? (a.destinatie_site?.name || '?') : (a.destinatie_locatie_text || '?')
                const days = Math.floor((Date.now() - new Date(a.aviz_data).getTime()) / 86400000)
                return `${a.numar_transport} → ${dest} (${days}z, ${a.manager_destinatie?.name || 'fără mgr'})`
              }).join(' · ')}
              {avizeNesemnate.length > 3 && ` · +${avizeNesemnate.length - 3} alte`}
            </div>
          </div>
          <div style={{fontSize: 13, color: '#FFF', fontWeight: 700, padding: '6px 12px', background: 'rgba(255,255,255,0.15)', borderRadius: 8, whiteSpace: 'nowrap'}}>
            Verifică →
          </div>
        </div>
      )}
      
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
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'14px 16px',background:G.redDim,borderRadius:10,border:`2px solid ${G.red}66`,marginTop:4}}>
              <span style={{fontSize:17,fontWeight:800,color:G.red,letterSpacing:0.3}}>‼️ Fără pontaj</span>
              <span style={{fontSize:24,fontWeight:900,color:G.red,letterSpacing:0.5}}>{stats.total-stats.present-Object.values(stats.normeStats||{}).reduce((s,v)=>s+v,0)}</span>
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

        {/* Prezență pe fiecare șantier — nr persoane prezente azi */}
        <div style={{...S.card,padding:20}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:13}}>
            <div style={{fontSize:13,fontWeight:700}}>🏗️ Prezență pe fiecare șantier</div>
            <span style={{fontSize:11,color:G.muted}}>{siteStats.reduce((s,x)=>s+x.present,0)} pers. · {siteStats.length} șantiere</span>
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:7,maxHeight:360,overflowY:'auto'}}>
            {siteStats.length===0?<div style={{textAlign:'center',color:G.muted,padding:'18px 0',fontSize:12}}>Nicio prezență azi</div>
            :siteStats.map(s=>{
              const maxP = siteStats[0]?.present || 1
              return (
                <div key={s.name} style={{padding:'8px 11px',background:'#1C2128',borderRadius:8}}>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,marginBottom:5}}>
                    <span style={{fontSize:12,fontWeight:600,color:G.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{s.name}</span>
                    <span style={{fontSize:14,fontWeight:800,color:G.green,fontVariantNumeric:'tabular-nums',flexShrink:0}}>{s.present}<span style={{fontSize:10,color:G.muted,fontWeight:600,marginLeft:3}}>pers.</span></span>
                  </div>
                  <div style={{height:4,background:'#21262D',borderRadius:2}}><div style={{height:'100%',width:`${(s.present/maxP)*100}%`,background:G.green,borderRadius:2,transition:'width .5s'}}/></div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </Layout>
  )
}

// Helper: ore default funcție de norma angajatului (din v_employee_work_hours)
// Sursa: view v_employee_work_hours (fara RLS), merged in loadEmps ca emp.work_hours_per_day
// Logic: ≥8h → 08:00-17:00 (cu pauza); 3-7h → start = 17:00 - n, end = 17:00 (afternoon ending);
//        ≤2h → start = 17:00, end = 17:00 + n (after-hours)
function defaultOreFromNorma(h) {
  const n = Number(h) || 8
  if (n >= 8) return { intrare: '08:00', iesire: '17:00' }  // 8h efective + 1h pauză scăzută auto
  if (n >= 3) {
    const startH = 17 - Math.floor(n)
    const startM = (n % 1) * 60  // dacă norma e 3.5, ajustez minutele
    return { intrare: `${String(startH).padStart(2,'0')}:${String(60 - startM).padStart(2,'0').replace('60','00')}`, iesire: '17:00' }
  }
  // n <= 2
  const endH = 17 + Math.floor(n)
  const endM = (n % 1) * 60
  return { intrare: '17:00', iesire: `${String(endH).padStart(2,'0')}:${String(endM).padStart(2,'0')}` }
}

// ─── Pontaj Row ───────────────────────────────────────────────────────────────
function PontajRow({ emp, rec, sites, selectedDate, onSave, onAllocate, saving, isAdmin, diurnaAmt, suplAmt, isTerminated, isFuture, showToast, onDirty }) {
  // Norma angajatului (pentru auto-fill ore) — vine din v_employee_work_hours
  const normaH = emp.work_hours_per_day || 8
  const oreDefault = defaultOreFromNorma(normaH)
  
  // State init: dacă rec are check_in folosesc valorile lui; altfel auto-fill cu defaults bazat pe normă
  const [ci,setCi]=useState(rec?.check_in?new Date(rec.check_in).toTimeString().slice(0,5):(rec ? '' : oreDefault.intrare))
  const [co,setCo]=useState(rec?.check_out?new Date(rec.check_out).toTimeString().slice(0,5):(rec ? '' : oreDefault.iesire))
  const [norma,setNorma]=useState(rec?.norma||'')
  const [diurna,setDiurna]=useState(rec?.diurna||false)
  const [supl,setSupl]=useState(rec?.meal_supplement||false)
  const [mode,setMode]=useState(rec?.norma?'norma':'ore')
  const [exp,setExp]=useState(false)

  // Enforce regulă: supliment hrană DOAR dacă e bifată diurna
  const handleSuplToggle = (val) => {
    if (val && !diurna) { showToast?.('Bifează întâi diurna înainte de supliment','warn'); return }
    setSupl(val)
  }
  const handleDiurnaToggle = (val) => {
    if (!val && supl) { setSupl(false); showToast?.('Suplimentul a fost debifat automat (necesită diurnă)','info') }
    setDiurna(val)
  }
  useEffect(()=>{
    setCi(rec?.check_in?new Date(rec.check_in).toTimeString().slice(0,5):(rec ? '' : oreDefault.intrare))
    setCo(rec?.check_out?new Date(rec.check_out).toTimeString().slice(0,5):(rec ? '' : oreDefault.iesire))
    setNorma(rec?.norma||''); setDiurna(rec?.diurna||false); setSupl(rec?.meal_supplement||false); setMode(rec?.norma?'norma':'ore')
  },[rec])
  // TKT-2026-0064: anunț planșa când rândul are modificări nesalvate, ca refresh-ul
  // automat (poll/focus) să nu-mi șteargă ce am tastat. Baza de comparație e exact
  // ce ar pune sync-ul de mai sus din rec (inclusiv auto-fill-ul pe rând gol).
  const baseCi=rec?.check_in?new Date(rec.check_in).toTimeString().slice(0,5):(rec ? '' : oreDefault.intrare)
  const baseCo=rec?.check_out?new Date(rec.check_out).toTimeString().slice(0,5):(rec ? '' : oreDefault.iesire)
  const isDirty=ci!==baseCi||co!==baseCo||norma!==(rec?.norma||'')||diurna!==(rec?.diurna||false)||supl!==(rec?.meal_supplement||false)
  useEffect(()=>{
    onDirty?.(emp.id,isDirty)
    return ()=>onDirty?.(emp.id,false)
  },[isDirty,emp.id,onDirty])
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
          {(rec?.site_id||emp.site_id)?<span className="badge bs" style={{fontSize:10,display:'block',marginBottom:3}}>{sites.find(s=>s.id===(rec?.site_id||emp.site_id))?.name||emp.sites?.name||'Șantier'}</span>
          :<span style={{fontSize:10,color:G.red,fontWeight:700,display:'block',marginBottom:3}}>⚠ Nealocate</span>}
          {isAdmin&&<select value={rec?.site_id??emp.site_id??''} onChange={e=>onAllocate(emp,e.target.value?Number(e.target.value):null)} style={{padding:'2px 5px',fontSize:10,width:'100%'}}>
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
          <input type="checkbox" checked={diurna} onChange={e=>handleDiurnaToggle(e.target.checked)} style={{width:15,height:15,accentColor:G.orange}}/>
          <span style={{fontSize:9,color:diurna?G.orange:G.dim,fontWeight:600}}>{diurna?`💰${diurnaAmt}RON`:'💰 Diurnă'}</span>
        </label>

        {/* Supliment Hrana */}
        <label style={{display:'flex',flexDirection:'column',alignItems:'center',gap:2,cursor:diurna?'pointer':'not-allowed',minWidth:55,opacity:diurna?1:.45}} title={diurna?'':'Bifează întâi diurna'}>
          <input type="checkbox" checked={supl} onChange={e=>handleSuplToggle(e.target.checked)} style={{width:15,height:15,accentColor:'#56D364'}}/>
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
                <input type="radio" name={`m${emp.id}`} checked={mode==='ore'} onChange={()=>{
                  setMode('ore')
                  setNorma('')
                  // Auto-fill ore default bazat pe norma angajatului (dacă nu sunt deja completate)
                  if (!ci && !co) { setCi(oreDefault.intrare); setCo(oreDefault.iesire) }
                }} style={{accentColor:G.blue}}/> Ore lucrate
              </label>
              <label style={{display:'flex',alignItems:'center',gap:5,fontSize:12,cursor:'pointer'}}>
                <input type="radio" name={`m${emp.id}`} checked={mode==='norma'} onChange={()=>{setMode('norma');setCi('');setCo('')}} style={{accentColor:G.yellow}}/> Normă specială
              </label>
            </div>
          </div>
          {mode==='ore'?(
            <>
              <div><Lbl>Intrare</Lbl><input type="time" value={ci} onChange={e=>setCi(e.target.value)} style={{...S.input,width:140}}/></div>
              <div><Lbl>Ieșire</Lbl><input type="time" value={co} onChange={e=>setCo(e.target.value)} style={{...S.input,width:140}}/></div>
              {pNet!==null&&<div style={{paddingTop:18,fontSize:12,color:G.yellow,fontWeight:700}}>{minsToHM(pNet)} net</div>}
              {emp.work_hours_per_day && (
                <div style={{paddingTop:18,fontSize:11,color:G.muted}}>
                  📋 Normă: <strong style={{color:G.text}}>{normaH}h/zi</strong>
                </div>
              )}
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
              <input type="checkbox" checked={diurna} onChange={e=>handleDiurnaToggle(e.target.checked)} style={{accentColor:G.orange}}/> 💰 Diurnă ({diurnaAmt} RON)
            </label>
          </div>
          <div style={{paddingTop:18}}>
            <label style={{display:'flex',alignItems:'center',gap:7,fontSize:12,cursor:diurna?'pointer':'not-allowed',opacity:diurna?1:.45}} title={diurna?'':'Bifează întâi diurna'}>
              <input type="checkbox" checked={supl} onChange={e=>handleSuplToggle(e.target.checked)} style={{accentColor:'#56D364'}}/> 🍔 Supliment Hrană ({suplAmt} RON)
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
  // Password gate pe zile deja exportate ca diurna_payments (Razvan 22.05.2026)
  const [isDateExported,setIsDateExported]=useState(false)
  const [exportPeriodInfo,setExportPeriodInfo]=useState(null) // {period_from, period_to, payment_date, total_amount}
  const [passwordPrompt,setPasswordPrompt]=useState(null) // {onConfirm, onCancel, employeeName}
  const [pwdInput,setPwdInput]=useState('')
  const [pwdErr,setPwdErr]=useState('')
  const [pwdVerifying,setPwdVerifying]=useState(false)
  const isAdmin = profile?.is_owner === true || profile?.role === 'contabilitate' || profile?.can_access_pontaj_brut === true
  useEffect(()=>{ loadSites(); loadSettings() },[])
  useEffect(()=>{ loadEmps() },[profile,sites,date.slice(0,7)])
  useEffect(()=>{ if(emps.length>0) loadRecs() },[emps,date])
  // TKT-2026-0054: sincronizare pontaj între utilizatori — modificarea unui user
  // nu apărea în plansa altuia până la refresh. Reîncarc înregistrările la revenirea
  // în tab (focus/visibilitychange) + poll ușor la 35s cât ești pe pagină, dar NU în
  // timpul unei salvări (ca să nu suprascriu editarea în curs).
  // TKT-2026-0064: refresh-ul e SILENT (fără spinner) — altfel lista se demontează la
  // fiecare focus/poll și pierzi orele tastate. Sar și peste refresh cât un rând e în
  // curs de editare (dirtyRef), ca să nu-i sufle valorile de sub degete.
  const dirtyRef=useRef(new Set())
  const markDirty=useCallback((empId,isDirty)=>{ if(isDirty) dirtyRef.current.add(empId); else dirtyRef.current.delete(empId) },[])
  useEffect(()=>{
    if(emps.length===0) return
    const refresh=()=>{ if(document.visibilityState==='visible' && !saving && !load && dirtyRef.current.size===0) loadRecs(true) }
    window.addEventListener('focus',refresh)
    document.addEventListener('visibilitychange',refresh)
    const iv=setInterval(refresh,35000)
    return ()=>{ window.removeEventListener('focus',refresh); document.removeEventListener('visibilitychange',refresh); clearInterval(iv) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[emps,date,saving,load])
  // Verific dacă data afișată e în interiorul unei perioade exportate ca plată
  // Folosesc RPC SECURITY DEFINER ca să funcționeze pentru orice user authenticated (RLS bypass controlat)
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .rpc('fn_get_export_period_for_date', { p_date: date })
      if (data && data.length > 0) {
        setIsDateExported(true)
        setExportPeriodInfo(data[0])
      } else {
        setIsDateExported(false)
        setExportPeriodInfo(null)
      }
    })()
  }, [date])
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
    // Fetch employees + work_hours separat (employee_salaries are RLS strict pe can_access_salarii, view v_employee_work_hours e public)
    const [empsRes, whRes] = await Promise.all([
      q,
      supabase.from('v_employee_work_hours').select('*')
    ])
    const whMap = new Map((whRes.data||[]).map(w => [w.employee_id, w.work_hours_per_day]))
    const enriched = (empsRes.data||[]).map(e => ({...e, work_hours_per_day: whMap.get(e.id) || null}))
    setEmps(enriched)
  }
  // silent=true → refresh în fundal (poll/focus): NU aprind spinnerul, altfel lista se
  // demontează și pierzi ce ai tastat. Păstrez și identitatea obiectelor nemodificate,
  // ca PontajRow să nu-și reseteze state-ul local pe rândurile neatinse de alții.
  const loadRecs=async(silent=false)=>{ if(!silent) setLoad(true); const ids=emps.map(e=>e.id); if(!ids.length){setLoad(false);return}; const {data}=await supabase.from('pontaj_records').select('*').eq('date',date).in('employee_id',ids); setRecs(prev=>{ const m={}; (data||[]).forEach(r=>{ const old=prev[r.employee_id]; m[r.employee_id]=(old&&JSON.stringify(old)===JSON.stringify(r))?old:r }); return m }); setLoad(false) }

  // Helper: cere parolă pentru zile exportate (Razvan 22.05.2026 - parolă per modificare)
  // Gate de permisiune: doar Razvan + Marilena (is_owner) + Natalia Udrea (can_modify_employees)
  const canEditRetroactivePontaj = profile?.is_owner === true || profile?.can_modify_employees === true
  const requestPasswordIfExported = (empName) => new Promise((resolve) => {
    if (!isDateExported) { resolve(true); return }
    if (!canEditRetroactivePontaj) {
      showToast('🚫 Modificare retroactivă blocată — doar Trusu Razvan, Marilena și Natalia pot modifica zile exportate. Contactează unul dintre ei.', 'error')
      resolve(false)
      return
    }
    setPasswordPrompt({
      employeeName: empName,
      onConfirm: () => resolve(true),
      onCancel: () => resolve(false),
    })
  })

  const handlePwdConfirm = async () => {
    if (!profile?.email) { setPwdErr('Lipsește email contul'); return }
    if (!pwdInput) { setPwdErr('Introdu parola'); return }
    setPwdVerifying(true); setPwdErr('')
    const { error } = await supabase.auth.signInWithPassword({ email: profile.email, password: pwdInput })
    if (error) {
      setPwdErr('Parolă greșită'); setPwdVerifying(false); return
    }
    setPwdVerifying(false)
    setPwdInput(''); setPwdErr('')
    if (passwordPrompt?.onConfirm) passwordPrompt.onConfirm()
    setPasswordPrompt(null)
  }
  const handlePwdCancel = () => {
    setPwdInput(''); setPwdErr(''); setPwdVerifying(false)
    if (passwordPrompt?.onCancel) passwordPrompt.onCancel()
    setPasswordPrompt(null)
  }

  const saveRecord = async (emp, fields) => {
    // Gate parolă dacă data afișată e în perioadă deja exportată
    const okAuth = await requestPasswordIfExported(emp.name)
    if (!okAuth) {
      showToast('Modificare anulată — parolă necesară pentru zi plătită', 'warn')
      return
    }
    setSaving(emp.id)
    // site_id: use per-day record site if exists, else employee default
    const recSiteId = recs[emp.id]?.site_id ?? emp.site_id ?? null
    if (!fields.norma && !recSiteId) { showToast('Șantierul este obligatoriu pentru ore!','error'); setSaving(null); return }
    const uid=(await supabase.auth.getUser()).data.user?.id
    const {data,error}=await supabase.from('pontaj_records').upsert({employee_id:emp.id,date,site_id:recSiteId,created_by:uid,updated_by:uid,updated_at:new Date().toISOString(),...fields},{onConflict:'employee_id,date'}).select().single()
    if(!error){setRecs(prev=>({...prev,[emp.id]:data}));showToast(`✓ Salvat: ${emp.name}`)} else showToast('Eroare la salvare','error')
    setSaving(null)
  }
  const allocate = async (emp, siteId) => {
    // Gate parolă dacă data afișată e în perioadă deja exportată
    const okAuth = await requestPasswordIfExported(emp.name)
    if (!okAuth) {
      showToast('Realocare anulată — parolă necesară pentru zi plătită', 'warn')
      return
    }
    // Salvam site_id in pontaj_records pentru ziua selectata (nu global pe angajat)
    const uid=(await supabase.auth.getUser()).data.user?.id
    const {data:rec}=await supabase.from('pontaj_records')
      .upsert({employee_id:emp.id,date,site_id:siteId||null,updated_by:uid,updated_at:new Date().toISOString()},{onConflict:'employee_id,date'})
      .select().single()
    if(rec) setRecs(prev=>({...prev,[emp.id]:rec}))
    // Daca angajatul nu are niciun santier default, setam si pe employee (scoate din "nealocati")
    if(!emp.site_id&&siteId){
      await supabase.from('employees').update({site_id:siteId}).eq('id',emp.id)
      setEmps(prev=>prev.map(e=>e.id===emp.id?{...e,site_id:siteId,sites:sites.find(s=>s.id===siteId)||null}:e))
    }
    showToast(siteId?`✓ ${emp.name} → ${sites.find(s=>s.id===siteId)?.name} (doar ${date})`:'Dezalocat zi','warn')
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
      <MesajCompanieBox />
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
      {isDateExported && exportPeriodInfo && (
        <div style={{background:(canEditRetroactivePontaj?G.orange:G.red)+'14',border:`2px solid ${canEditRetroactivePontaj?G.orange:G.red}`,borderRadius:10,padding:'10px 14px',marginBottom:12,display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
          <span style={{fontSize:20}}>{canEditRetroactivePontaj?'🔒':'🚫'}</span>
          <div style={{flex:1,minWidth:200}}>
            <div style={{fontSize:13,fontWeight:700,color:canEditRetroactivePontaj?G.orange:G.red}}>
              Zi din perioadă deja exportată ca plată
            </div>
            <div style={{fontSize:11,color:G.text,marginTop:2}}>
              Plată export <strong>{new Date(exportPeriodInfo.period_from).toLocaleDateString('ro-RO')}</strong> — <strong>{new Date(exportPeriodInfo.period_to).toLocaleDateString('ro-RO')}</strong>
              {exportPeriodInfo.total_amount != null && <>{' · '}{Number(exportPeriodInfo.total_amount).toFixed(0)} RON</>}
              {exportPeriodInfo.payment_date && <>{' · '}data plății {new Date(exportPeriodInfo.payment_date).toLocaleDateString('ro-RO')}</>}
            </div>
            <div style={{fontSize:11,color:G.muted,marginTop:4}}>
              {canEditRetroactivePontaj
                ? <>⚠ Orice modificare la pontaj (ore, diurnă, masă) va cere <strong>parola de cont</strong>. După modificare, refă exportul pentru această perioadă.</>
                : <>🚫 <strong>Modificare blocată.</strong> Doar <strong>Trusu Razvan</strong>, <strong>Marilena</strong> și <strong>Natalia Udrea</strong> pot modifica zile deja exportate. Contactează unul dintre ei pentru corecții retroactive.</>
              }
            </div>
          </div>
        </div>
      )}
      {unalloc.length>0&&<div style={{background:G.redDim,border:`1px solid ${G.red}33`,borderRadius:9,padding:'8px 12px',marginBottom:12,color:G.red}}>
        <div style={{fontSize:11,fontWeight:700,marginBottom:4}}>⚠️ {unalloc.length} angajați nealocați pe niciun șantier:</div>
        <div style={{fontSize:11,lineHeight:1.7,flexWrap:'wrap',display:'flex',gap:'4px 10px'}}>
          {unalloc.map(e=><span key={e.id} style={{whiteSpace:'nowrap'}}>• {e.name}</span>)}
        </div>
      </div>}
      {load?<div style={{display:'flex',justifyContent:'center',padding:60}}><div className="sp" style={{width:28,height:28}}/></div>
      :<div style={{display:'flex',flexDirection:'column',gap:5}}>
        {filtered.map(emp=><PontajRow key={emp.id} emp={emp} rec={recs[emp.id]} sites={sites} selectedDate={date} onSave={saveRecord} onAllocate={allocate} saving={saving===emp.id} isAdmin={isAdmin} diurnaAmt={diurnaAmt} suplAmt={suplAmt} isTerminated={!!(emp.termination_date&&emp.termination_date<date)} isFuture={!!(emp.hire_date&&emp.hire_date>date)} showToast={showToast} isDateExported={isDateExported} onDirty={markDirty}/>)}
        {!filtered.length&&<div style={{textAlign:'center',color:G.muted,padding:'50px 0',fontSize:12}}>Niciun angajat găsit</div>}
      </div>}
      {passwordPrompt && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.65)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
          <div style={{background:G.card,border:`2px solid ${G.orange}`,borderRadius:12,maxWidth:440,width:'100%',padding:24,boxShadow:'0 20px 60px rgba(0,0,0,0.5)'}}>
            <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:14}}>
              <span style={{fontSize:32}}>🔒</span>
              <div>
                <div style={{fontSize:17,fontWeight:700,color:G.orange}}>Parolă necesară</div>
                <div style={{fontSize:12,color:G.muted,marginTop:2}}>Modificare pontaj pe zi exportată</div>
              </div>
            </div>
            <div style={{background:G.bg,border:`1px solid ${G.border}`,borderRadius:8,padding:'10px 14px',marginBottom:14,fontSize:12,lineHeight:1.5}}>
              <div><strong>Angajat:</strong> {passwordPrompt.employeeName}</div>
              <div><strong>Data:</strong> {new Date(date).toLocaleDateString('ro-RO')}</div>
              {exportPeriodInfo && (
                <div style={{color:G.orange,marginTop:4}}>
                  ⚠ Plătit deja în export {new Date(exportPeriodInfo.period_from).toLocaleDateString('ro-RO')} — {new Date(exportPeriodInfo.period_to).toLocaleDateString('ro-RO')}
                </div>
              )}
            </div>
            <div style={{fontSize:12,color:G.muted,marginBottom:8}}>Confirmă parola contului <strong>{profile?.email}</strong>:</div>
            <input
              type="password"
              value={pwdInput}
              onChange={e=>{setPwdInput(e.target.value); setPwdErr('')}}
              onKeyDown={e=>{ if(e.key==='Enter') handlePwdConfirm(); else if(e.key==='Escape') handlePwdCancel() }}
              autoFocus
              placeholder="Parolă..."
              disabled={pwdVerifying}
              style={{...S.input,width:'100%',padding:'10px 14px',fontSize:14,fontFamily:'monospace'}}
            />
            {pwdErr && <div style={{color:G.red,fontSize:11,marginTop:6}}>❌ {pwdErr}</div>}
            <div style={{display:'flex',justifyContent:'flex-end',gap:8,marginTop:16}}>
              <button onClick={handlePwdCancel} disabled={pwdVerifying} style={{...S.btnS,padding:'9px 18px'}}>Anulează</button>
              <button onClick={handlePwdConfirm} disabled={pwdVerifying||!pwdInput} style={{...S.btnP,padding:'9px 20px',background:G.orange,color:'#fff',opacity:pwdVerifying||!pwdInput?0.5:1,cursor:pwdVerifying||!pwdInput?'not-allowed':'pointer'}}>
                {pwdVerifying ? '⏳ Verific...' : '🔓 Confirmă & modifică'}
              </button>
            </div>
          </div>
        </div>
      )}
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
  const [load,setLoad]=useState(true); const [expD,setExpD]=useState(false); const [expS,setExpS]=useState(false); const [expBT,setExpBT]=useState(false)
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
  // Istoric Ordine Deplasare (PDF-uri arhivate)
  const [showIstoricOrd, setShowIstoricOrd] = useState(false)
  const [istoricOrd, setIstoricOrd] = useState([])
  const [istoricOrdLoading, setIstoricOrdLoading] = useState(false)
  const [istoricOrdSearch, setIstoricOrdSearch] = useState('')
  const [istoricOrdMonth, setIstoricOrdMonth] = useState('')
  const [istoricOrdSel, setIstoricOrdSel] = useState(null) // record selectat pentru preview
  // Accordion + multi-select (Etapa 7.5 Faza 3.4)
  const [istoricOrdExpanded, setIstoricOrdExpanded] = useState(new Set()) // chei luni expanded (YYYY-MM)
  const [istoricOrdSelected, setIstoricOrdSelected] = useState(new Set()) // id-uri ordine selectate
  const [bulkDeletingOrd, setBulkDeletingOrd] = useState(false)
  // Registru Ordine (jurnal contabil)
  const [showRegistruOrd, setShowRegistruOrd] = useState(false)
  const [registruOrdMonth, setRegistruOrdMonth] = useState('')
  const [registruOrdSearch, setRegistruOrdSearch] = useState('')
  const [registruOrdSortAsc, setRegistruOrdSortAsc] = useState(false) // false = cele mai recente sus
  const [exportingRegistru, setExportingRegistru] = useState(false)
  // Notificare Ordine Lipsă/Overdue (Etapa 7.5 Faza 3.2)
  const [ordineLipsa, setOrdineLipsa] = useState([])
  const [ordineLipsaExpanded, setOrdineLipsaExpanded] = useState(false)
  const [ordineLipsaDismissed, setOrdineLipsaDismissed] = useState(false)
  // Generator Ordin Deplasare
  const [showOrdGen, setShowOrdGen] = useState(false)
  const [ordGenLoading, setOrdGenLoading] = useState(false)
  const [ordGenPayment, setOrdGenPayment] = useState(null)
  const [ordGenEmps, setOrdGenEmps] = useState([])  // [{employee_id, name, days_real, diurna_max, diurna_records, santiere_list, selected}]
  const [ordGenerating, setOrdGenerating] = useState(false)
  const [ordGenProgress, setOrdGenProgress] = useState({ done: 0, total: 0 })
  
  // Pontaj Brut (fost Export ITM) + Istoric — acces gate-uit
  const [expPontajBrut, setExpPontajBrut] = useState(false)
  const [showHistoricPB, setShowHistoricPB] = useState(false)
  const [historicPB, setHistoricPB] = useState([])
  const [historicPBLoad, setHistoricPBLoad] = useState(false)
  // Lock-screen pentru Istoric (re-auth ca la Salarii, 20 min timeout)
  const PB_TIMEOUT_MIN = 20
  const [pbUnlocked, setPbUnlocked] = useState(() => {
    const until = Number(sessionStorage.getItem('pontajBrutUnlockedUntil') || 0)
    return until > Date.now()
  })
  const [pbUnlockUntil, setPbUnlockUntil] = useState(() => Number(sessionStorage.getItem('pontajBrutUnlockedUntil') || 0))
  const [pbPwdInput, setPbPwdInput] = useState('')
  const [pbPwdErr, setPbPwdErr] = useState('')
  const [pbVerifying, setPbVerifying] = useState(false)
  
  // Pontaj Net — buton „Generează Pontaj Net" + Istoric Net (același gating ca brutul)
  const [showSelectBrutForNet, setShowSelectBrutForNet] = useState(false)  // modal selectare brut
  const [genNetLoading, setGenNetLoading] = useState(false)  // în curs de procesare
  const [genNetProgress, setGenNetProgress] = useState('')  // mesaj de status
  const [showHistoricPN, setShowHistoricPN] = useState(false)
  const [historicPN, setHistoricPN] = useState([])
  const [historicPNLoad, setHistoricPNLoad] = useState(false)
  // Lock-screen partajat: dacă brutul e deblocat, și netul e deblocat (același flag de acces)
  // Folosim ACELAȘI session key pb pentru ambele — UX mai simplu (re-auth 1 dată)
  
  // Re-auth pentru butoanele de Export (Brut + Diurne + Hrană) — folosește același pbUnlocked
  // Când userul apasă un buton Export și !pbUnlocked, se setează pendingExportAction
  // și se afișează modal-ul de unlock. După unlock cu succes, acțiunea pendentă rulează automat.
  const [pendingExportAction, setPendingExportAction] = useState(null)  // 'brut' | 'diurne' | 'hrana' | 'hrana-istoric' | null
  
  // Istoric Suplimente Hrană (același pattern ca PB + PN)
  const [showHistoricHrana, setShowHistoricHrana] = useState(false)
  const [historicHrana, setHistoricHrana] = useState([])
  const [historicHranaLoad, setHistoricHranaLoad] = useState(false)
  const [toast,showToast]=useToast()
  const isAdmin = profile?.is_owner === true || profile?.role === 'contabilitate' || profile?.can_access_pontaj_brut === true
  // Acces Pontaj Brut + Istoric: doar Owner sau utilizatori bifați (Razvan, Marilena, Natalia)
  const hasPontajBrutAccess = profile?.is_owner === true || profile?.can_access_pontaj_brut === true
  
  // Lock-screen Istoric: reset timer la fiecare interactiune (mouse, keyboard, scroll, touch)
  useEffect(() => {
    if (!pbUnlocked || !showHistoricPB) return
    const resetTimer = () => {
      const until = Date.now() + PB_TIMEOUT_MIN * 60 * 1000
      sessionStorage.setItem('pontajBrutUnlockedUntil', String(until))
      setPbUnlockUntil(until)
    }
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart']
    events.forEach(e => window.addEventListener(e, resetTimer, { passive: true }))
    const tid = setInterval(() => {
      const until = Number(sessionStorage.getItem('pontajBrutUnlockedUntil') || 0)
      if (until <= Date.now()) {
        setPbUnlocked(false)
        sessionStorage.removeItem('pontajBrutUnlockedUntil')
      }
    }, 10000)
    return () => {
      events.forEach(e => window.removeEventListener(e, resetTimer))
      clearInterval(tid)
    }
  }, [pbUnlocked, showHistoricPB])
  
  const handlePbUnlock = async () => {
    if (!profile?.email) { setPbPwdErr('Lipsește email-ul contului'); return }
    if (!pbPwdInput) { setPbPwdErr('Introdu parola'); return }
    setPbVerifying(true); setPbPwdErr('')
    const { error } = await supabase.auth.signInWithPassword({ email: profile.email, password: pbPwdInput })
    if (error) { setPbPwdErr('Parolă greșită'); setPbVerifying(false); return }
    const until = Date.now() + PB_TIMEOUT_MIN * 60 * 1000
    sessionStorage.setItem('pontajBrutUnlockedUntil', String(until))
    setPbUnlockUntil(until); setPbUnlocked(true); setPbPwdInput(''); setPbVerifying(false)
    loadHistoricPB()
  }
  const handlePbLock = () => {
    sessionStorage.removeItem('pontajBrutUnlockedUntil')
    setPbUnlocked(false); setPbUnlockUntil(0)
  }
  const loadHistoricPB = async () => {
    setHistoricPBLoad(true)
    const { data } = await supabase.from('pontaj_brut_istoric').select('*').order('exported_at', { ascending: false }).limit(100)
    setHistoricPB(data || [])
    setHistoricPBLoad(false)
  }
  // Redownload xlsx dintr-o intrare istoric
  const redownloadHistoricPB = async (entry) => {
    if (!entry?.storage_path) { showToast('Fără storage_path — fișier inexistent', 'warn'); return }
    const { data, error } = await supabase.storage.from('pontaj-brut-istoric').createSignedUrl(entry.storage_path, 120)
    if (error || !data?.signedUrl) { showToast('Eroare descărcare: ' + (error?.message || 'fără URL'), 'error'); return }
    const a = document.createElement('a'); a.href = data.signedUrl; a.download = entry.filename || 'pontaj_brut.xlsx'
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
  }
  // Ștergere intrare istoric (doar OWNER per RLS)
  const deleteHistoricPB = async (entry) => {
    if (!window.confirm(`Ștergi exportul "${entry.filename}" (${new Date(entry.exported_at).toLocaleDateString('ro-RO')})?\nFișierul Excel + metadata sunt șterse permanent.`)) return
    // Șterg Storage object (RLS permite owner)
    if (entry.storage_path) {
      await supabase.storage.from('pontaj-brut-istoric').remove([entry.storage_path])
    }
    await supabase.from('pontaj_brut_istoric').delete().eq('id', entry.id)
    showToast('✓ Intrare ștearsă')
    loadHistoricPB()
  }

  // ─── PONTAJ NET ─────────────────────────────────────────────────
  const loadHistoricPN = async () => {
    setHistoricPNLoad(true)
    const { data } = await supabase.from('pontaj_net_istoric').select('*').order('exported_at', { ascending: false }).limit(100)
    setHistoricPN(data || [])
    setHistoricPNLoad(false)
  }
  const redownloadHistoricPN = async (entry) => {
    if (!entry?.storage_path) { showToast('Fără storage_path — fișier inexistent', 'warn'); return }
    const { data, error } = await supabase.storage.from('pontaj-net-istoric').createSignedUrl(entry.storage_path, 120)
    if (error || !data?.signedUrl) { showToast('Eroare descărcare: ' + (error?.message || 'fără URL'), 'error'); return }
    const a = document.createElement('a'); a.href = data.signedUrl; a.download = entry.filename || 'pontaj_net.xlsx'
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
  }
  const deleteHistoricPN = async (entry) => {
    if (!window.confirm(`Ștergi exportul Net "${entry.filename}"?`)) return
    if (entry.storage_path) await supabase.storage.from('pontaj-net-istoric').remove([entry.storage_path])
    await supabase.from('pontaj_net_istoric').delete().eq('id', entry.id)
    showToast('✓ Intrare Net ștearsă')
    loadHistoricPN()
  }

  // ─── ISTORIC SUPLIMENTE HRANĂ (același pattern ca PB + PN) ───────────────
  const loadHistoricHrana = async () => {
    setHistoricHranaLoad(true)
    const { data } = await supabase.from('supliment_hrana_istoric').select('*').order('exported_at', { ascending: false }).limit(100)
    setHistoricHrana(data || [])
    setHistoricHranaLoad(false)
  }
  const redownloadHistoricHrana = async (entry) => {
    if (!entry?.storage_path) { showToast('Fără storage_path', 'warn'); return }
    const { data, error } = await supabase.storage.from('supliment-hrana-istoric').createSignedUrl(entry.storage_path, 120)
    if (error || !data?.signedUrl) { showToast('Eroare descărcare: ' + (error?.message || 'fără URL'), 'error'); return }
    const a = document.createElement('a'); a.href = data.signedUrl; a.download = entry.filename || 'supliment_hrana.xlsx'
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
  }
  const deleteHistoricHrana = async (entry) => {
    if (!window.confirm(`Ștergi exportul "${entry.filename}"?`)) return
    if (entry.storage_path) await supabase.storage.from('supliment-hrana-istoric').remove([entry.storage_path])
    await supabase.from('supliment_hrana_istoric').delete().eq('id', entry.id)
    showToast('✓ Intrare ștearsă')
    loadHistoricHrana()
  }

  // ─── Re-auth pentru butoane Export (Brut + Diurne + Hrană) ────────────────
  // Dacă pbUnlocked=false, setează pendingExportAction (afișează modal de unlock).
  // După unlock cu succes, acțiunea rulează automat (via useEffect mai jos).
  const requireUnlockThen = (action) => {
    if (pbUnlocked) {
      runPendingAction(action)
    } else {
      setPendingExportAction(action)
    }
  }
  const runPendingAction = (action) => {
    if (action === 'brut') exportPontajBrut()
    else if (action === 'diurne') exportDiurne()
    else if (action === 'hrana') exportSupl()
    else if (action === 'hrana-istoric') { setShowHistoricHrana(true); loadHistoricHrana() }
    else if (action === 'brut-istoric') { setShowHistoricPB(true); loadHistoricPB() }
    else if (action === 'diurne-istoric') setShowIstoric(true)
    setPendingExportAction(null)
  }
  // După unlock cu succes (pbUnlocked devine true), execută acțiunea pendentă
  useEffect(() => {
    if (pbUnlocked && pendingExportAction) {
      const a = pendingExportAction
      setPendingExportAction(null)
      // delay mic ca să se închidă modal-ul de unlock vizual
      setTimeout(() => runPendingAction(a), 100)
    }
  }, [pbUnlocked, pendingExportAction])

  // Generează Pontaj Net dintr-un export brut selectat
  // Algoritm: surse (WE/LEG cu ore reale, NU coduri NORME) → destinații (LUCR cu LL)
  // Mutare cronologică; orfani sursă → LL galben; orfani destinație → rămân
  const generatePontajNet = async (brutEntry) => {
    if (!brutEntry?.storage_path) { showToast('Brut fără fișier în Storage', 'error'); return }
    if (!hasPontajBrutAccess) { showToast('Acces refuzat', 'error'); return }
    setGenNetLoading(true)
    setGenNetProgress('Descărcare brut din Storage...')
    try {
      // 1. Fetch xlsx brut din Storage
      const { data: signedData, error: sigErr } = await supabase.storage.from('pontaj-brut-istoric').createSignedUrl(brutEntry.storage_path, 120)
      if (sigErr || !signedData?.signedUrl) throw new Error('Signed URL eșuat: ' + (sigErr?.message || 'fără URL'))
      const resp = await fetch(signedData.signedUrl)
      if (!resp.ok) throw new Error('Fetch xlsx brut eșuat: ' + resp.status)
      const arrBuf = await resp.arrayBuffer()

      // 2. Parse xlsx
      setGenNetProgress('Parse fișier Excel...')
      const wbIn = XLSX.read(arrBuf, { type: 'array', cellStyles: true })
      const wsIn = wbIn.Sheets[wbIn.SheetNames[0]]
      const decodeRange = XLSX.utils.decode_range(wsIn['!ref'] || 'A1:AK646')
      const getCell = (r0, c0) => wsIn[XLSX.utils.encode_cell({ r: r0, c: c0 })]
      const cellVal = (r0, c0) => { const c = getCell(r0, c0); return c ? c.v : undefined }

      // 3. Fetch calendar legal pentru perioada brut-ului
      const y = brutEntry.period_year, m = brutEntry.period_month
      const days = new Date(y, m, 0).getDate()  // ultima zi a lunii
      const { data: calData } = await supabase.from('calendar_days').select('date,type')
        .gte('date', `${y}-${String(m).padStart(2,'0')}-01`)
        .lte('date', `${y}-${String(m).padStart(2,'0')}-${String(days).padStart(2,'0')}`)
      const legalSet = new Set((calData||[]).filter(c => c.type === 'legal').map(c => c.date))
      const dayType = (d) => {
        const dt = new Date(y, m-1, d)
        const ds = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`
        if (legalSet.has(ds)) return 'LEG'
        if (dt.getDay() === 0 || dt.getDay() === 6) return 'WE'
        return 'LUCR'
      }

      // Normă/zi per angajat (name → work_hours_per_day) pentru plafonarea NET la 8h.
      // TKT-2026-0044: în NET, orele > 8/zi se aduc la 8 DOAR pentru full-time (normă ≥ 8h);
      // part-time (normă < 8h) rămâne cu orele reale. Brutul NU se modifică.
      const [{ data: whRows }, { data: empRows }] = await Promise.all([
        supabase.from('v_employee_work_hours').select('employee_id, work_hours_per_day'),
        supabase.from('employees').select('id, name'),
      ])
      const whById = new Map((whRows || []).map(w => [w.employee_id, Number(w.work_hours_per_day) || 8]))
      const normaByName = new Map((empRows || []).map(e => [String(e.name || '').trim().toUpperCase(), whById.get(e.id) || 8]))

      // 4. Aplicăm algoritmul de procesare per salariat
      // Format identic cu brut: rândurile 1-7 antet, salariați de la r=8 cu pas 5 (r, r+1, r+2, r+3, r+4=separator)
      // Coloane: A=Nume, B=Functia, C=Program; D..(D+days-1) = zile; +TotalZile, +TotalOre
      // Identifică ultimul rând cu salariat
      const NORME_SET = new Set(['BO','BP','AM','CO','CFP','CM','M','O','N','PRM','PRB','LL'])
      const FIXED = 3
      const DATA_COL_START = FIXED  // 0-indexed: D = col 3
      const DATA_COL_END   = FIXED + days - 1  // ultima zi
      
      setGenNetProgress('Aplicare reguli mutare...')
      
      // Construim noua matrice de date (clonată din brut)
      // Pentru fiecare salariat: aplicăm mutările
      const employees = []  // [{name, position, rowData: [r, r+1, r+2, r+3] cu valori și flag pentru fundal}]
      let totalMoves = 0, totalOrphansSrc = 0, totalOrphansDst = 0, totalOreLunarSum = 0
      
      for (let row0 = 7; row0 <= decodeRange.e.r; row0 += 5) {  // r=8 Excel → row0=7 (0-indexed)
        const name = cellVal(row0, 0)
        if (!name) continue
        const position = cellVal(row0, 1) || ''
        // full-time dacă norma ≥ 8h; doar atunci plafonăm orele NET la 8/zi
        const normaAng = normaByName.get(String(name).trim().toUpperCase()) || 8
        const eFullTime = normaAng >= 8
        
        // Citește valorile din cele 4 rânduri (Intrare, Ieșire, Pauză, Ore) pentru toate zilele
        // Plus metadata WE/LEG/LUCR per coloană
        const rowData = [[], [], [], []]  // 4 sub-rânduri
        const dayInfo = []  // [{col, day, type, isSrc, isDst, vals: [intrare, ieșire, pauza, ore]}]
        
        for (let c0 = DATA_COL_START; c0 <= DATA_COL_END; c0++) {
          const day = c0 - DATA_COL_START + 1
          const dt = dayType(day)
          const vals = [
            cellVal(row0, c0),       // intrare
            cellVal(row0+1, c0),     // ieșire
            cellVal(row0+2, c0),     // pauză
            cellVal(row0+3, c0),     // ore
          ]
          const intrare = vals[0]
          // SURSĂ: WE sau LEG, are valoare reală (nu null, nu LL, nu cod NORMĂ)
          const isSrc = (dt === 'WE' || dt === 'LEG') 
                     && intrare !== null && intrare !== undefined && intrare !== ''
                     && !NORME_SET.has(String(intrare).trim())
          // DESTINAȚIE: LUCR cu valoarea LL
          const isDst = (dt === 'LUCR') && String(intrare).trim() === 'LL'
          dayInfo.push({ c0, day, type: dt, isSrc, isDst, vals: [...vals] })
        }
        
        // Aplică algoritmul: mut surse → destinații în ordine cronologică
        const surse = dayInfo.filter(d => d.isSrc)
        const dest = dayInfo.filter(d => d.isDst)
        const nMoves = Math.min(surse.length, dest.length)
        
        for (let i = 0; i < nMoves; i++) {
          const src = surse[i]
          const dst = dest[i]
          // Mut valorile sursă → destinație
          const dstInfo = dayInfo.find(d => d.c0 === dst.c0)
          dstInfo.vals = [...src.vals]
          dstInfo.bgRole = 'MOVED_DST'  // fundal alb FFFFFF
          // Sursa devine LL galben
          const srcInfo = dayInfo.find(d => d.c0 === src.c0)
          srcInfo.vals = ['LL', '', '', '']
          srcInfo.bgRole = 'LL_YELLOW'
        }
        // Surse orfane → LL galben + ore șterse
        for (let i = nMoves; i < surse.length; i++) {
          const srcInfo = dayInfo.find(d => d.c0 === surse[i].c0)
          srcInfo.vals = ['LL', '', '', '']
          srcInfo.bgRole = 'LL_YELLOW'
        }
        // Destinații orfane rămân ca atare (LL galben, neschimbat)

        // TKT-2026-0044: plafonare NET la 8h/zi pentru full-time (part-time neatins)
        if (eFullTime) {
          for (const di of dayInfo) {
            const v = di.vals[3]
            const n = typeof v === 'number' ? v : (v !== '' && v != null && !isNaN(Number(v)) ? Number(v) : null)
            if (n != null && n > 8) di.vals[3] = 8
          }
        }

        totalMoves += nMoves
        totalOrphansSrc += Math.max(0, surse.length - nMoves)
        totalOrphansDst += Math.max(0, dest.length - nMoves)
        
        // Calcul total ore lunar pentru metadata BD
        let oreSum = 0
        for (const di of dayInfo) {
          const oreV = di.vals[3]
          if (typeof oreV === 'number') oreSum += oreV
          else if (oreV && !isNaN(Number(oreV))) oreSum += Number(oreV)
        }
        totalOreLunarSum += oreSum
        
        employees.push({ name, position, dayInfo, oreSum })
      }
      
      setGenNetProgress(`Generare Excel: ${employees.length} salariați, ${totalMoves} mutări...`)

      // 5. Build noul workbook
      const wbOut = XLSX.utils.book_new()
      const dayNums = Array.from({ length: days }, (_, i) => i+1)
      const dayAbbr = ['D','L','Ma','Mi','J','V','S']
      const mName = new Date(y, m-1).toLocaleString('ro-RO', { month: 'long', year: 'numeric' })
      
      // Coloane finale: A=Nume, B=Funcție, C=Program, D..AG/AH/AI(zile), Total Zile, Total Ore (FĂRĂ ORE SUPL)
      // Plus etichetă AK4/AL4 (Razvan a zis să le păstrăm ca info informativă)
      const TOTAL_ZILE_C = FIXED + days       // col index al „Total Zile"
      const TOTAL_ORE_C  = FIXED + days + 1   // col index al „Total Ore"
      const WD_LABEL_C   = FIXED + days + 2   // col index al etichetei „Zile lucr. lună:"
      const WD_VALUE_C   = FIXED + days + 3   // col index al valorii
      
      const R = []
      R.push(['S.C. GAZPET INSTAL S.R.L.','','','Str. Fluturilor, nr.34, Loc.Ploiesti, Jud.Prahova'])
      R.push(['RO 22029920; J2007001650296','','','Tel./Fax 0244/435005  office@gazpet.ro'])
      R.push([])
      // Rând 4 (idx 3): titlu + zile lucr lună la dreapta
      const titleRow = [`FOAIE COLECTIVĂ DE PREZENȚĂ (NET) — ${mName.toUpperCase()}`]
      while (titleRow.length < WD_LABEL_C) titleRow.push('')
      titleRow.push('Zile lucr. lună:')
      titleRow.push(brutEntry.work_days_in_month)
      R.push(titleRow)
      R.push([])
      // Header rând 6
      const HDR = ['NUME ȘI PRENUME SALARIAT','FUNCȚIA','PROGRAM DE LUCRU', ...dayNums, 'TOTAL ZILE','TOTAL ORE']
      R.push(HDR)
      // Day abbr rând 7
      const DNR = ['','','', ...dayNums.map(d => dayAbbr[new Date(y, m-1, d).getDay()]), '', '']
      R.push(DNR)
      
      // Salariați
      employees.forEach((emp, empIdx) => {
        const excelRow = 8 + empIdx * 5  // 1-indexed Excel
        const rCI = [emp.name, emp.position, 'Ora Intrare']
        const rCO = ['', '', 'Ora Ieșire']
        const rPM = ['', '', 'Pauza de Masă (ore)']
        const rOL = ['', '', 'Ore Lucrate']
        for (const di of emp.dayInfo) {
          rCI.push(di.vals[0] ?? '')
          rCO.push(di.vals[1] ?? '')
          rPM.push(di.vals[2] ?? '')
          rOL.push(di.vals[3] ?? '')
        }
        // Total Zile + Total Ore = FORMULE (nu valori), pe rândul Ora Intrare (r)
        // COUNTIF / SUM pe rândul Ore Lucrate (r+3)
        rCI.push({ f: `COUNTIF(D${excelRow+3}:${XLSX.utils.encode_col(DATA_COL_END)}${excelRow+3},">0")`, t: 'n' })
        rCI.push({ f: `SUM(D${excelRow+3}:${XLSX.utils.encode_col(DATA_COL_END)}${excelRow+3})`, t: 'n' })
        rCO.push('', '')
        rPM.push('', '')
        rOL.push('', '')
        R.push(rCI, rCO, rPM, rOL, [])
      })
      
      const wsOut = XLSX.utils.aoa_to_sheet(R)
      wsOut['!cols'] = [
        {wch:26},{wch:16},{wch:22},
        ...dayNums.map(()=>({wch:5.5})),
        {wch:11}, {wch:11},
        {wch:18}, {wch:11}
      ]
      
      // ── Stilizare conform paletei Razvan ──
      const bd = {top:{style:'thin',color:{rgb:'000000'}},bottom:{style:'thin',color:{rgb:'000000'}},left:{style:'thin',color:{rgb:'000000'}},right:{style:'thin',color:{rgb:'000000'}}}
      const sc = (r0, c0, s) => { const a = XLSX.utils.encode_cell({r:r0, c:c0}); if (!wsOut[a]) wsOut[a] = {v:'', t:'s'}; wsOut[a].s = s }
      const alC = {horizontal:'center', vertical:'center'}
      const alL = {horizontal:'left', vertical:'center'}
      
      // Title row (idx 3) — etichetă + valoare
      sc(3, WD_LABEL_C, {fill:{fgColor:{rgb:'1F497D'}}, font:{bold:true,color:{rgb:'FFFFFF'},sz:10}, border:bd, alignment:{horizontal:'right',vertical:'center'}})
      sc(3, WD_VALUE_C, {fill:{fgColor:{rgb:'FFE699'}}, font:{bold:true,sz:11,color:{rgb:'7F6000'}}, border:bd, alignment:alC})
      
      // Header rândul 5
      HDR.forEach((v,c) => sc(5, c, {fill:{fgColor:{rgb:'1F497D'}}, font:{bold:true,color:{rgb:'FFFFFF'},sz:10}, border:bd, alignment:c<3?alL:alC}))
      
      // Day names rândul 6 cu culori per tip zi
      DNR.forEach((v,c) => {
        const isDayCol = c >= 3 && c < 3+days
        if (!isDayCol) {
          sc(6, c, {fill:{fgColor:{rgb:'4472C4'}}, font:{bold:true,color:{rgb:'FFFFFF'},sz:9}, border:bd, alignment:alC})
          return
        }
        const day = c - 2
        const dt = dayType(day)
        let rgb = '4472C4'  // lucr
        if (dt === 'WE') rgb = 'BFBFBF'
        else if (dt === 'LEG') rgb = 'FF8888'
        sc(6, c, {fill:{fgColor:{rgb}}, font:{bold:true,color:{rgb:'FFFFFF'},sz:9}, border:bd, alignment:alC})
      })
      
      // Salariați: stilizare cu paleta Razvan
      let ri = 7  // 0-indexed (Excel rând 8)
      employees.forEach(emp => {
        for (let ro = 0; ro < 4; ro++) {
          const TOTAL_C = FIXED + days + 2  // FĂRĂ ORE SUPL
          for (let c = 0; c < TOTAL_C; c++) {
            let s = {}
            if (c === 0) {
              s = ro===0 ? {fill:{fgColor:{rgb:'E2EFDA'}}, font:{bold:true,sz:10}, border:bd, alignment:alL}
                         : {fill:{fgColor:{rgb:'F5F5F5'}}, border:bd, alignment:alL}
            } else if (c === 1) {
              s = ro===0 ? {fill:{fgColor:{rgb:'E2EFDA'}}, border:bd, alignment:alL}
                         : {fill:{fgColor:{rgb:'F5F5F5'}}, border:bd}
            } else if (c === 2) {
              s = {fill:{fgColor:{rgb:'D6E4F0'}}, font:{bold:true,sz:8}, border:bd, alignment:alL}
            } else if (c >= 3 && c < 3+days) {
              const di = emp.dayInfo[c-3]
              const dt = di.type
              const intrare = di.vals[0]
              let rgb = null
              // Determină culoarea finală conform paletei Razvan
              if (di.bgRole === 'MOVED_DST') {
                rgb = 'FFFFFF'  // destinație care a primit mutare → alb
              } else if (di.bgRole === 'LL_YELLOW') {
                rgb = 'FFFF00'  // sursă convertită la LL → galben
              } else if (intrare === 'LL') {
                rgb = 'FFFF00'  // LL natural (în zi lucr fără sursă, sau orig pe WE/LEG)
              } else if (intrare && intrare !== '' && !NORME_SET.has(String(intrare).trim()) && (dt === 'WE' || dt === 'LEG')) {
                // Caz teoretic: sursă care nu a fost mișcată (nu ar trebui să apară după algoritm)
                rgb = 'FFC000'
              } else if (intrare && intrare !== '' && dt === 'LUCR') {
                rgb = null  // alb default (zi lucrătoare normală)
              } else if (dt === 'WE') {
                rgb = 'C0C0C0'  // weekend gol
              } else if (dt === 'LEG') {
                rgb = 'FFAAAA'  // legal gol
              }
              s = {...(rgb?{fill:{fgColor:{rgb}}}:{}), border:bd, alignment:alC, font:{sz: ro===3 ? 9 : 9}}
            } else {
              s = {fill:{fgColor:{rgb: ro===0 ? 'D9E1F2' : 'F5F5F5'}}, font: ro===0?{bold:true}:{sz:9}, border:bd, alignment:alC}
            }
            sc(ri+ro, c, s)
          }
        }
        ri += 5
      })
      
      XLSX.utils.book_append_sheet(wbOut, wsOut, 'Pontaj Net')
      
      // 6. Write + Download + Upload Storage + INSERT istoric net
      setGenNetProgress('Salvare în Storage...')
      const wbArr = XLSX.write(wbOut, { bookType: 'xlsx', type: 'array', cellStyles: true })
      const blob = new Blob([wbArr], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const filename = `Pontaj_Net_${mName.replace(/\s/g,'_')}.xlsx`
      
      // Download local
      const localUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = localUrl; a.download = filename
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      URL.revokeObjectURL(localUrl)
      
      // Upload Storage + INSERT istoric
      const storagePath = `${y}/${String(m).padStart(2,'0')}/${Date.now()}_${filename}`
      try {
        const { error: upErr } = await supabase.storage.from('pontaj-net-istoric').upload(storagePath, blob, {
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          upsert: false
        })
        if (upErr) {
          showToast('⚠ Excel descărcat, Storage net a eșuat: ' + upErr.message, 'warn')
        } else {
          await supabase.from('pontaj_net_istoric').insert({
            source_brut_id: brutEntry.id,
            period_year: y, period_month: m,
            work_days_in_month: brutEntry.work_days_in_month,
            total_employees: employees.length,
            moves_count: totalMoves,
            orphans_src_count: totalOrphansSrc,
            orphans_dst_count: totalOrphansDst,
            total_ore_lunar: +totalOreLunarSum.toFixed(2),
            exported_by: profile?.id,
            exported_by_name: profile?.name || profile?.email,
            filename, storage_path: storagePath
          })
        }
      } catch (e) {
        showToast('⚠ Eroare salvare istoric Net: ' + (e?.message||e), 'warn')
      }
      
      playBeep(880, 0.15); setTimeout(()=>playBeep(1100, 0.12), 130)
      showToast(`✓ Pontaj Net — ${employees.length} ang. · ${totalMoves} mutări · ${totalOrphansSrc} surse orfane → LL`)
      setShowSelectBrutForNet(false)  // închide modal selectare
    } catch (e) {
      console.error('generatePontajNet err:', e)
      showToast('Eroare procesare Net: ' + (e?.message || e), 'error')
    } finally {
      setGenNetLoading(false)
      setGenNetProgress('')
    }
  }

  useEffect(()=>{ supabase.from('sites').select('*').eq('active',true).then(({data:s})=>setSites(s||[])); supabase.from('settings').select('*').then(({data:st})=>{const d=st?.find(x=>x.key==='diurna_amount');if(d)setDiurnaAmt(Number(d.value));const s=st?.find(x=>x.key==='meal_supplement_amount');if(s)setSuplAmt(Number(s.value))}) },[])
  useEffect(()=>{ loadReport() },[month,deptF,siteF,profile])
  useEffect(()=>{ if(showIstoric) loadPayments() },[showIstoric])
  useEffect(()=>{ if(showIstoricOrd) loadIstoricOrd() },[showIstoricOrd])
  useEffect(()=>{ loadOrdineLipsa() },[profile])
  useEffect(()=>{ if(showHistoricPN && pbUnlocked) loadHistoricPN() }, [showHistoricPN, pbUnlocked])

  const loadOrdineLipsa = async () => {
    // Doar pentru cei care pot genera ordine (owners + can_access_personal_data)
    if (!profile?.is_owner && !profile?.can_access_personal_data) { setOrdineLipsa([]); return }
    try {
      const { data, error } = await supabase
        .from('v_ordine_lipsa')
        .select('*')
        .order('period_from', { ascending: false })
      if (error) throw error
      setOrdineLipsa(data || [])
    } catch (e) {
      console.error('loadOrdineLipsa err:', e)
      // Silent fail - banner-ul e nice-to-have
    }
  }

  const loadPayments=async()=>{
    const {data}=await supabase.from('diurna_payments').select('*').order('payment_date',{ascending:false}).limit(50)
    setPayments(data||[])
  }

  const loadIstoricOrd = async () => {
    setIstoricOrdLoading(true)
    try {
      const { data, error } = await supabase
        .from('ordine_deplasare_arhiva')
        .select('id, employee_id, period_from, period_to, pdf_path, pdf_nume, pdf_size_bytes, semnaturi_snapshot, observatii, created_at, numar_ordin, data_emiterii, zile_lucrate, suma_totala, employees!inner(name, functie)')
        .order('created_at', { ascending: false })
        .limit(1000)
      if (error) throw error
      setIstoricOrd(data || [])
      // Auto-expand luna cea mai recentă (Etapa 7.5 Faza 3.4)
      if (data && data.length > 0) {
        const monthKeys = [...new Set(data.map(r => r.period_from?.substring(0, 7)).filter(Boolean))]
        monthKeys.sort((a,b) => b.localeCompare(a))
        if (monthKeys[0]) setIstoricOrdExpanded(new Set([monthKeys[0]]))
      }
      setIstoricOrdSelected(new Set()) // reset selecție la reload
    } catch (e) {
      console.error('loadIstoricOrd err:', e)
      showToast('Eroare încărcare istoric ordine: ' + (e?.message || e), 'error')
    } finally {
      setIstoricOrdLoading(false)
    }
  }

  // Toggle expand/collapse lună
  const toggleMonthExpanded = (monthKey) => {
    setIstoricOrdExpanded(prev => {
      const next = new Set(prev)
      if (next.has(monthKey)) next.delete(monthKey)
      else next.add(monthKey)
      return next
    })
  }

  // Toggle selecție individuală sau bulk
  const toggleSelectOrd = (id) => {
    setIstoricOrdSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const selectAllInList = (records) => {
    setIstoricOrdSelected(prev => {
      const next = new Set(prev)
      records.forEach(r => next.add(r.id))
      return next
    })
  }
  const deselectAllInList = (records) => {
    setIstoricOrdSelected(prev => {
      const next = new Set(prev)
      records.forEach(r => next.delete(r.id))
      return next
    })
  }

  // Bulk delete: șterge multiple ordine selectate (Storage + DB)
  const bulkDeleteOrd = async () => {
    if (!profile?.is_owner) { showToast('Doar owner-ii pot șterge bulk', 'warn'); return }
    if (istoricOrdSelected.size === 0) { showToast('Niciun ordin selectat', 'warn'); return }
    const idsToDelete = Array.from(istoricOrdSelected)
    const recordsToDelete = istoricOrd.filter(r => idsToDelete.includes(r.id))
    if (!window.confirm(
      `🗑️ Ștergi ${recordsToDelete.length} ordin${recordsToDelete.length === 1 ? '' : 'e'} de deplasare?\n\n` +
      `Acțiunea șterge PDF-urile din Storage ȘI înregistrările din BD definitiv.\n` +
      `După ștergere, banner-ul de notificare „Ordine lipsă" va apărea automat dacă rămân plăți lunare fără ordine.\n\n` +
      `Continui?`
    )) return
    setBulkDeletingOrd(true)
    try {
      // 1. Storage bulk delete (în batch, tolerant la erori)
      const paths = recordsToDelete.map(r => r.pdf_path).filter(Boolean)
      if (paths.length > 0) {
        // Supabase Storage permite max 100 paths per call, splittăm
        const chunkSize = 100
        for (let i = 0; i < paths.length; i += chunkSize) {
          const chunk = paths.slice(i, i + chunkSize)
          const { error: stErr } = await supabase.storage.from('ordine-deplasare-pdf').remove(chunk)
          if (stErr) console.warn(`Storage delete chunk ${i}:`, stErr)
        }
      }
      // 2. DB bulk delete
      const { error: dbErr } = await supabase.from('ordine_deplasare_arhiva').delete().in('id', idsToDelete)
      if (dbErr) throw dbErr
      showToast(`✓ ${recordsToDelete.length} ordin${recordsToDelete.length === 1 ? '' : 'e'} ștearse din arhivă`)
      // Reload (resetează și selecția)
      await loadIstoricOrd()
      // Reload banner notificare
      loadOrdineLipsa()
    } catch (e) {
      console.error('bulkDeleteOrd err:', e)
      showToast('Eroare bulk delete: ' + (e?.message || e), 'error')
    } finally {
      setBulkDeletingOrd(false)
    }
  }

  // Export Registru Ordine Excel (Etapa 7.5 Faza 3.1)
  const exportRegistruOrdineExcel = async () => {
    if (!istoricOrd.length) { showToast('Niciun ordin în registru pentru export', 'warn'); return }
    setExportingRegistru(true)
    try {
      const XLSX = await import('xlsx-js-style')
      // Filtrez + sortez la fel ca UI
      const filtered = istoricOrd.filter(r => {
        if (registruOrdSearch) {
          const q = registruOrdSearch.toLowerCase()
          if (!(r.employees?.name || '').toLowerCase().includes(q) && !((r.numar_ordin || '').toLowerCase().includes(q))) return false
        }
        if (registruOrdMonth) {
          const m = (r.data_emiterii || r.period_from)?.substring(0,7)
          if (m !== registruOrdMonth) return false
        }
        return true
      })
      filtered.sort((a, b) => {
        const da = (a.data_emiterii || a.period_from || '') + (a.numar_ordin || '')
        const db = (b.data_emiterii || b.period_from || '') + (b.numar_ordin || '')
        return registruOrdSortAsc ? da.localeCompare(db) : db.localeCompare(da)
      })
      
      const headerStyle = {
        fill: { fgColor: { rgb: '1F497D' } },
        font: { name: 'Calibri', sz: 10, bold: true, color: { rgb: 'FFFFFF' } },
        alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
        border: { top: {style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} },
      }
      const cellBase = {
        font: { name: 'Calibri', sz: 10 },
        alignment: { vertical: 'center', wrapText: false },
        border: { top: {style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} },
      }
      
      const aoa = [
        [`REGISTRU ORDINE DE DEPLASARE`],
        [`Generat: ${new Date().toLocaleString('ro-RO')}  •  Total: ${filtered.length} ordine`],
        [],
        ['Nr crt', 'Nr Ordin', 'Data emiterii', 'Angajat', 'Funcția', 'Perioada', 'Zile', 'Suma (RON)', 'Generat la', 'Generat de'],
      ]
      filtered.forEach((r, i) => {
        aoa.push([
          i + 1,
          r.numar_ordin || '—',
          r.data_emiterii ? new Date(r.data_emiterii).toLocaleDateString('ro-RO') : '—',
          r.employees?.name || `#${r.employee_id}`,
          r.employees?.functie || '—',
          `${new Date(r.period_from).toLocaleDateString('ro-RO')} – ${new Date(r.period_to).toLocaleDateString('ro-RO')}`,
          r.zile_lucrate || 0,
          Number(r.suma_totala || 0),
          new Date(r.created_at).toLocaleString('ro-RO', {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}),
          r.semnaturi_snapshot?.director_aproba?.nume || '—',
        ])
      })
      // TOTAL
      const totalZile = filtered.reduce((s, r) => s + (Number(r.zile_lucrate) || 0), 0)
      const totalSuma = filtered.reduce((s, r) => s + (Number(r.suma_totala) || 0), 0)
      aoa.push([])
      aoa.push(['', '', '', '', '', 'TOTAL:', totalZile, totalSuma, '', ''])
      
      const ws = XLSX.utils.aoa_to_sheet(aoa)
      // Merge titlu
      ws['!merges'] = [
        { s:{r:0,c:0}, e:{r:0,c:9} },
        { s:{r:1,c:0}, e:{r:1,c:9} },
      ]
      // Title style
      ws['A1'] = { v: aoa[0][0], t: 's', s: { font:{sz:14,bold:true,color:{rgb:'1F497D'}}, alignment:{horizontal:'center',vertical:'center'} } }
      ws['A2'] = { v: aoa[1][0], t: 's', s: { font:{sz:9,italic:true,color:{rgb:'666666'}}, alignment:{horizontal:'center'} } }
      // Header row (4 = row index 3)
      for (let c = 0; c < 10; c++) {
        const cell = XLSX.utils.encode_cell({ r: 3, c })
        if (ws[cell]) ws[cell].s = headerStyle
      }
      // Body cells
      for (let r = 4; r < aoa.length; r++) {
        for (let c = 0; c < 10; c++) {
          const cellRef = XLSX.utils.encode_cell({ r, c })
          if (ws[cellRef]) {
            ws[cellRef].s = { ...cellBase }
            if (c === 0 || c === 6) ws[cellRef].s.alignment = { ...cellBase.alignment, horizontal: 'center' }
            if (c === 7) {
              ws[cellRef].s.alignment = { ...cellBase.alignment, horizontal: 'right' }
              ws[cellRef].s.numFmt = '#,##0.00'
            }
          }
        }
      }
      // TOTAL row highlight (last data row)
      const totalRowIdx = aoa.length - 1
      for (let c = 5; c < 10; c++) {
        const cellRef = XLSX.utils.encode_cell({ r: totalRowIdx, c })
        if (ws[cellRef]) {
          ws[cellRef].s = { 
            ...cellBase, 
            font: { name: 'Calibri', sz: 10, bold: true, color: { rgb: '1F497D' } },
            fill: { fgColor: { rgb: 'D9E1F2' } },
            alignment: { ...cellBase.alignment, horizontal: c === 5 ? 'right' : (c === 6 ? 'center' : (c === 7 ? 'right' : 'left')) },
          }
          if (c === 7) ws[cellRef].s.numFmt = '#,##0.00'
        }
      }
      // Column widths
      ws['!cols'] = [
        {wch:6}, {wch:14}, {wch:14}, {wch:32}, {wch:24}, {wch:24}, {wch:7}, {wch:13}, {wch:18}, {wch:22}
      ]
      
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Registru Ordine')
      const filename = `Registru_Ordine_Deplasare_${new Date().toISOString().split('T')[0]}.xlsx`
      XLSX.writeFile(wb, filename)
      showToast(`✓ ${filename} descărcat`)
    } catch (e) {
      console.error('exportRegistru err:', e)
      showToast('Eroare export registru: ' + (e?.message || e), 'error')
    } finally {
      setExportingRegistru(false)
    }
  }

  const openIstoricOrdPDF = async (rec) => {
    try {
      const { data, error } = await supabase.storage
        .from('ordine-deplasare-pdf')
        .createSignedUrl(rec.pdf_path, 600)
      if (error) throw error
      if (data?.signedUrl) window.open(data.signedUrl, '_blank')
    } catch (e) {
      console.error('openIstoricOrdPDF err:', e)
      showToast('Eroare deschidere PDF: ' + (e?.message || e), 'error')
    }
  }

  const deleteIstoricOrd = async (rec) => {
    if (!profile?.is_owner) { showToast('Doar owner-ii pot șterge din arhivă', 'warn'); return }
    if (!window.confirm(`Șterg ordin pentru ${rec.employees?.name || 'angajat'} (${rec.period_from} → ${rec.period_to})?\n\nAcțiunea șterge PDF-ul din Storage și înregistrarea din BD definitiv.`)) return
    try {
      // 1. Delete din Storage (chiar dacă fail, continui cu BD)
      const { error: stErr } = await supabase.storage.from('ordine-deplasare-pdf').remove([rec.pdf_path])
      if (stErr) console.warn('Storage delete warning:', stErr)
      // 2. Delete din BD
      const { error: dbErr } = await supabase.from('ordine_deplasare_arhiva').delete().eq('id', rec.id)
      if (dbErr) throw dbErr
      setIstoricOrd(prev => prev.filter(x => x.id !== rec.id))
      if (istoricOrdSel?.id === rec.id) setIstoricOrdSel(null)
      showToast('✓ Ordin șters din arhivă')
    } catch (e) {
      console.error('deleteIstoricOrd err:', e)
      showToast('Eroare ștergere: ' + (e?.message || e), 'error')
    }
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
    
    // Detect dacă perioada e o LUNĂ ÎNTREAGĂ (ziua 1 → ultima zi a aceleiași luni)
    // Plățile lunare au scop diferit: generarea ordinelor de deplasare pentru toată luna.
    // Trebuie să poată coexista cu plățile săptămânale (cash flow).
    const isFullMonthPeriod = (() => {
      const f = new Date(df + 'T12:00'); const t = new Date(dt + 'T12:00')
      if (f.getDate() !== 1) return false
      const lastDay = new Date(f.getFullYear(), f.getMonth() + 1, 0).getDate()
      if (t.getDate() !== lastDay) return false
      if (f.getMonth() !== t.getMonth() || f.getFullYear() !== t.getFullYear()) return false
      return true
    })()
    
    if(existing?.length>0){
      if (isFullMonthPeriod) {
        // Bypass cu confirmation pentru plata lunară
        const lunaName = new Date(df + 'T12:00').toLocaleDateString('ro-RO', { month: 'long', year: 'numeric' })
        const listaSupra = existing.slice(0, 5).map(p => 
          `  • ${new Date(p.period_from).toLocaleDateString('ro-RO')} – ${new Date(p.period_to).toLocaleDateString('ro-RO')} (${p.total_employees} ang.)`
        ).join('\n')
        const ok = window.confirm(
          `📅 Perioada selectată acoperă luna ÎNTREAGĂ: ${lunaName}\n\n` +
          `Există deja ${existing.length} ${existing.length===1?'plată săptămânală':'plăți săptămânale'} în această lună:\n` +
          `${listaSupra}\n` +
          (existing.length > 5 ? `  • ... și încă ${existing.length - 5}\n` : '') +
          `\nGENEREZI DIURNELE PENTRU ORDINELE DE DEPLASARE?\n\n` +
          `(Plata lunară se salvează în PARALEL cu cele săptămânale, fără să le afecteze. ` +
          `Vei putea apoi genera ordinele de deplasare pentru întreaga lună.)`
        )
        if (!ok) { setSavingPayment(false); return }
        // Continuă - skip overlap check
      } else {
        showToast(`⚠ Suprapunere cu plata din ${new Date(existing[0].period_from).toLocaleDateString('ro-RO')} — ${new Date(existing[0].period_to).toLocaleDateString('ro-RO')}!`,'error')
        setSavingPayment(false); return
      }
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
    // Paginare manuală
    let recs = []
    { let off=0; while(true){ const {data:p}=await supabase.from('pontaj_records').select('*').eq('diurna',true).gte('date',df).lte('date',dt).in('employee_id',(emps||[]).map(e=>e.id)).range(off,off+999); if(!p||p.length===0)break; recs.push(...p); if(p.length<1000)break; off+=1000; if(off>200000)break } }

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
    const hdr=['Nr.','Nume','Prenume','Zile','Diurnă/zi (RON)','TOTAL RON']
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
    ws['!cols']=[{wch:5},{wch:30,wpx:225},{wch:24,wpx:180},{wch:10},{wch:14},{wch:14}]
    // Merge celule antet firmă: A1:B1 (nume firmă) și A2:B2 (CUI/Reg.Com.)
    ws['!merges']=ws['!merges']||[]
    ws['!merges'].push({s:{r:0,c:0},e:{r:0,c:1}})
    ws['!merges'].push({s:{r:1,c:0},e:{r:1,c:1}})
    hdr.forEach((_,c)=>{const a=XLSX.utils.encode_cell({r:5,c});if(!ws[a])ws[a]={v:hdr[c],t:'s'};ws[a].s={fill:{fgColor:{rgb:'1F497D'}},font:{bold:true,color:{rgb:'FFFFFF'},sz:10},border:bd,alignment:{horizontal:'center',vertical:'center'}}})
    const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'Diurne')
    XLSX.writeFile(wb,`Diurne_${from.replace(/\//g,'-')}_${to.replace(/\//g,'-')}.xlsx`)
    showToast('✓ Export gata!')
  }

  // ─── ORDIN DEPLASARE — Generator ────────────────────────────────────────────
  // Pregătește datele pentru modal: recalculează diurna_max per angajat (pattern cascade din exportDiurne)
  // + colectează pontaj_records cronologice pentru distribuția pe zile
  const openOrdGen = async (payment) => {
    setOrdGenPayment(payment)
    setOrdGenLoading(true)
    setShowOrdGen(true)
    setOrdGenEmps([])
    try {
      // Detalii payment (employee_ids)
      const { data: details } = await supabase.from('diurna_payment_details')
        .select('*').eq('payment_id', payment.id).order('employee_name')
      if (!details?.length) { showToast('Plata nu are detalii angajați', 'warn'); setShowOrdGen(false); return }

      const empIds = details.map(d => d.employee_id)
      const periodFrom = payment.period_from
      const periodTo = payment.period_to

      // Month boundaries (pentru cascade)
      const d0 = new Date(periodFrom)
      const monthStart = `${d0.getFullYear()}-${String(d0.getMonth()+1).padStart(2,'0')}-01`
      const mE = new Date(monthStart); mE.setMonth(mE.getMonth()+1); mE.setDate(0)
      const monthEnd = mE.toISOString().split('T')[0]

      // Calendar legal days
      const { data: calData } = await supabase.from('calendar_days')
        .select('date,type,description').gte('date', monthStart).lte('date', monthEnd)
      const legalSet = new Set((calData || []).filter(x => x.type === 'legal').map(x => x.date))
      const legalNameMap = new Map((calData || []).filter(x => x.type === 'legal').map(x => [x.date, x.description || '']))

      // Calc work-day sets + counters
      const workDaySet = new Set()
      let calWorkDays = 0       // monthStart → periodTo (pentru diurnaMax cascade)
      let workDaysInPeriod = 0  // periodFrom → periodTo (pentru periodCapacity)
      const periodStartD = new Date(periodFrom)
      const periodEndD = new Date(periodTo)
      const wdIter = new Date(monthStart)
      while (wdIter <= mE) {
        const ds = wdIter.toISOString().split('T')[0]
        const dow = wdIter.getDay()
        const isWork = dow !== 0 && dow !== 6 && !legalSet.has(ds)
        if (isWork) {
          workDaySet.add(ds)
          if (wdIter <= periodEndD) calWorkDays++
          if (wdIter >= periodStartD && wdIter <= periodEndD) workDaysInPeriod++
        }
        wdIter.setDate(wdIter.getDate() + 1)
      }

      // Fetch pontaj records cu sites join (paginat) + employees details în paralel
      const [empsDetailsRes] = await Promise.all([
        supabase.from('employees').select('id, functie, position, departament_hr, department').in('id', empIds),
      ])
      const empDetailsMap = new Map((empsDetailsRes.data || []).map(e => [e.id, e]))

      let allRecs = []
      let off = 0
      while (true) {
        const { data: page } = await supabase.from('pontaj_records')
          .select('*, sites(name)')
          .gte('date', monthStart).lte('date', monthEnd)
          .in('employee_id', empIds)
          .range(off, off + 999)
        if (!page || page.length === 0) break
        allRecs.push(...page)
        if (page.length < 1000) break
        off += 1000
        if (off > 200000) break
      }

      // Per employee: aplic algoritmul Pontaj NET ca să determin zilele de pe ordin
      // Logica: ordinul reflectă zilele LUCR pe care angajatul a fost detașat după redistribuire
      // (WE/sărbătoare lucrate sunt mutate în locul LL-urilor de pe zile lucrătoare)
      const NORME_LIST = ['BO','BP','AM','CO','CFP','CM','M','O','N','PRM','PRB','LL']
      const sortedWorkDays = [...workDaySet].sort()
      const empData = details.map(d => {
        const empRecs = allRecs.filter(r => r.employee_id === d.employee_id)
        const recsInPeriod = empRecs
          .filter(r => r.date >= periodFrom && r.date <= periodTo)
          .sort((a, b) => (a.date || '').localeCompare(b.date || ''))

        // SURSE = WE/LEG cu check_in, fără cod NORME (lucrat efectiv în weekend/sărbătoare)
        const surse = recsInPeriod.filter(r =>
          !workDaySet.has(r.date) &&  // NU e zi lucrătoare → WE sau LEG
          r.check_in &&
          !(r.norma && NORME_LIST.includes(r.norma))
        )
        // DESTINAȚII = zi LUCR cu norma=LL (învoire în zi lucrătoare)
        const dest = recsInPeriod.filter(r =>
          workDaySet.has(r.date) && r.norma === 'LL'
        )
        // Mutare cronologică: src[i] → dest[i]
        const moveMap = new Map()  // destDate -> srcRec
        const nMoves = Math.min(surse.length, dest.length)
        for (let i = 0; i < nMoves; i++) {
          moveMap.set(dest[i].date, surse[i])
        }

        // Lista zile NET cu diurnă (= zile LUCR pe ordin) — iterare cronologică prin zile lucr ale lunii
        const netDays = []
        for (const ds of sortedWorkDays) {
          if (ds < periodFrom || ds > periodTo) continue
          const rec = empRecs.find(r => r.date === ds)
          if (rec?.check_in && rec?.diurna === true && !rec.norma) {
            // Zi LUCR cu diurnă reală (păstrat în NET)
            netDays.push({ date: ds, sites: rec.sites || { name: 'Nealocate' } })
          } else if (moveMap.has(ds)) {
            // Zi LUCR fost LL care a primit mutare → preia șantierul din sursa weekend/sărbătoare
            const srcRec = moveMap.get(ds)
            netDays.push({ date: ds, sites: srcRec.sites || { name: 'Nealocate' } })
          }
          // Altfel: zi LUCR fără ore în NET (LL rămas, gol, normă) → NU intră pe ordin
        }

        // diurnaMax = plafonată la buget lunar (consistent cu savePayment) și la zilele NET
        const zilePlatiteAnterior = empRecs.filter(r =>
          r.diurna === true && r.date < periodFrom && workDaySet.has(r.date)
        ).length
        const bugetLunarRamasZile = Math.max(0, workDaySet.size - zilePlatiteAnterior)
        const diurnaMax = Math.min(bugetLunarRamasZile, netDays.length)

        // Distribuția = primele diurnaMax din netDays (cronologic)
        const distribution = netDays.slice(0, diurnaMax)
        const seen = new Set()
        const santiereList = []
        distribution.forEach(r => {
          const s = r.sites?.name || 'Nealocate'
          if (!seen.has(s)) { seen.add(s); santiereList.push(s) }
        })

        const empDet = empDetailsMap.get(d.employee_id) || {}
        // Fallback: prioritate functie (COR oficial), apoi position (descriptiv) — pentru angajări recente
        // unde doar position e completat în BD
        const functieRaw = empDet.functie && String(empDet.functie).trim()
          ? String(empDet.functie).trim()
          : (empDet.position && String(empDet.position).trim() ? String(empDet.position).trim() : null)
        const hasFunctie = !!functieRaw
        // Departament: același pattern (departament_hr nou, department vechi)
        const deptRaw = empDet.departament_hr || empDet.department || null

        // FIX 15.05.2026: construire allDays per angajat (schema așteptată de buildOrdinHTML)
        // Pattern identic cu generateOrdine (xlsx) dar cu câmpuri suplimentare pentru PDF
        const allDaysForEmp = []
        const distMapPdf = new Map(netDays.slice(0, diurnaMax).map(r => [r.date, r]))
        const pDStart = new Date(periodFrom)
        const pDEnd = new Date(periodTo)
        const dItPdf = new Date(pDStart)
        while (dItPdf <= pDEnd) {
          const ds = dItPdf.toISOString().split('T')[0]
          const dow = dItPdf.getDay()
          const isWeekend = dow === 0 || dow === 6
          const isLegal = legalSet.has(ds)
          const recPdf = distMapPdf.get(ds)
          allDaysForEmp.push({
            date: ds,
            is_weekend: isWeekend,
            is_legal: isLegal,
            legal_name: isLegal ? (legalNameMap.get(ds) || '') : '',
            shantier_name: recPdf ? (recPdf.sites?.name || 'Nealocate') : '',
          })
          dItPdf.setDate(dItPdf.getDate() + 1)
        }

        return {
          employee_id: d.employee_id,
          name: d.employee_name,
          functie: functieRaw,
          departament_hr: deptRaw,
          has_functie: hasFunctie,
          days_real: d.days,
          diurna_max: diurnaMax,
          diurna_records: netDays,
          allDays: allDaysForEmp,
          santiere_list: santiereList,
          selected: diurnaMax > 0,  // bifați automat doar cei cu zile > 0
        }
      })

      setOrdGenEmps(empData)
    } catch (e) {
      console.error('openOrdGen err:', e)
      showToast('Eroare la pregătire: ' + (e?.message || e), 'error')
      setShowOrdGen(false)
    } finally {
      setOrdGenLoading(false)
    }
  }

  // ─── HELPERI Faza 7.5 — Generare PDF cu semnături ────────────────────────
  
  // Fuzzy match nume → employee (pentru lookup setări semnatari)
  // Normalizează (lowercase + strip diacritice + non-alfanumeric → space)
  // Match dacă ≥2 tokens din needle se găsesc în empName (sau 1 token dacă needle are doar 1)
  const findEmployeeFuzzy = (needle, employees) => {
    if (!needle) return null
    const normalize = (s) => (s || '').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/).filter(Boolean)
    const needleTokens = normalize(needle)
    if (needleTokens.length === 0) return null
    for (const emp of employees) {
      const empTokens = normalize(emp.name)
      const matches = needleTokens.filter(t => empTokens.includes(t)).length
      if (matches >= 2 || (needleTokens.length === 1 && matches === 1)) return emp
    }
    return null
  }
  
  // Fetch o imagine (signed URL Supabase) și o transformă în dataURL base64
  // Necesar pentru html2canvas — evită probleme CORS și async loading
  const fetchAsDataURL = async (url) => {
    try {
      const response = await fetch(url)
      const blob = await response.blob()
      return await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onloadend = () => resolve(reader.result)
        reader.onerror = reject
        reader.readAsDataURL(blob)
      })
    } catch (e) {
      console.warn('fetchAsDataURL fail:', e)
      return null
    }
  }
  
  // Escape pentru HTML safety (folosit în template-uri PDF)
  const esc = (s) => String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
  
  // ───────────────────────────────────────────────────────────────────────
  // GENERATOR PDF — Construiește HTML offscreen identic vizual cu xlsx,
  // captureaza cu html2canvas, wrappează în jsPDF cu 2 pagini A4.
  // Include 4 semnături reale inserate ca <img> (dataURL base64).
  // ───────────────────────────────────────────────────────────────────────
  
  // Builds 2-pagini HTML pentru ordin (returnează string)
  // semnaturiData = { aproba: 'data:...'|null, control: ..., verificat: ..., titular: ... }
  const buildOrdinHTML = ({ emp, ordGenPayment, allDays, setari, denumireSocietate, nrRegCom, cui, periodStartFmt, periodEndFmt, fmtRO, semnaturiData, genTimestamp, numarOrd, dataEmit }) => {
    // Lățime canvas: 794px = 210mm @ 96 DPI
    // Coloane proporțional cu xlsx (4/11/18/17/8/9/12/4 = 83 units):
    //   A=38px B=105px C=172px D=163px E=76px F=86px G=115px H=38px (total 793px)
    
    const numeAng = esc(emp.name)
    const functieAng = esc(emp.functie || '—')
    // FIX 15.05.2026: confuzie semantică între ZILE și SUMA PE ZI
    // ziluLcrate = numărul de zile cu șantier alocat (excl. WE/sărbători)
    // Fallback la emp.diurna_max (= numărul de zile cascade) dacă allDays e gol din motive vechi
    const zileDinAllDays = allDays.filter(d => d.shantier_name && !d.is_weekend && !d.is_legal).length
    const ziluLcrate = zileDinAllDays || (emp.diurna_max || 0)
    const zileTotal = ziluLcrate
    const diurnaPerZi = Number(diurnaAmt) || 0  // SUMA pe zi din settings (din scope ReportsPage prin closure)
    const totalChelt = (zileTotal * diurnaPerZi).toFixed(2)
    
    const A4_W = 794   // 210mm @ 96 DPI
    const A4_H = 1123  // 297mm @ 96 DPI
    
    // ─── Stiluri inline ────────────────────────────────────────────
    const pageStyle = `width:${A4_W}px;min-height:${A4_H}px;background:#fff;padding:38px 28px;font-family:Calibri,Arial,sans-serif;color:#000;box-sizing:border-box;font-size:11px;line-height:1.35;`
    const tblStyle = 'width:100%;border-collapse:collapse;table-layout:fixed;'
    const blueDark = '#1F497D'
    const blueLight = '#D9E1F2'
    const grayBg = '#F5F5F5'
    
    const colgroup = `<colgroup>
      <col style="width:4.82%"><col style="width:13.25%"><col style="width:21.69%"><col style="width:20.48%">
      <col style="width:9.64%"><col style="width:10.84%"><col style="width:14.46%"><col style="width:4.82%">
    </colgroup>`
    
    // Semnătură image cell (cu fallback gol dacă lipsește)
    const sigCell = (dataUrl) => dataUrl
      ? `<img src="${dataUrl}" style="max-width:160px;max-height:50px;object-fit:contain;display:block;margin:0 auto;" alt="semnatura"/>`
      : `<div style="height:50px;display:flex;align-items:center;justify-content:center;color:#bbb;font-size:9px;font-style:italic;">semnătură lipsă</div>`
    
    // ═══════════════════════════════════════════════════════════════
    // PAGINA 1 — ORDIN DEPLASARE
    // ═══════════════════════════════════════════════════════════════
    const page1 = `
      <div class="pdf-page-1" style="${pageStyle}">
        <!-- Titlu -->
        <div style="text-align:center;color:${blueDark};font-size:22px;font-weight:800;letter-spacing:2px;margin-bottom:4px;">ORDIN DE DEPLASARE</div>
        <div style="text-align:center;color:#666;font-size:10px;margin-bottom:14px;">(delegație)</div>
        
        <!-- Nr / Data -->
        <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:10px;">
          <span><strong>Nr.:</strong> ${esc(numarOrd || '_____________________')}</span>
          <span><strong>Data emiterii:</strong> ${esc(dataEmit || '_____________________')}</span>
        </div>
        
        <!-- Date angajat -->
        <table style="${tblStyle}margin-bottom:10px;">${colgroup}
          <tr>
            <td colspan="2" style="font-weight:600;padding:4px 6px;border:1px solid #ccc;background:${grayBg};font-size:10px;">Numele și prenumele:</td>
            <td colspan="6" style="padding:4px 6px;border:1px solid #ccc;font-weight:700;font-size:12px;">${numeAng}</td>
          </tr>
          <tr>
            <td colspan="2" style="font-weight:600;padding:4px 6px;border:1px solid #ccc;background:${grayBg};font-size:10px;">Funcția:</td>
            <td colspan="6" style="padding:4px 6px;border:1px solid #ccc;font-size:11px;">${functieAng}</td>
          </tr>
        </table>
        
        <!-- DURATA -->
        <div style="background:${blueDark};color:#fff;padding:5px 10px;font-weight:700;font-size:11px;letter-spacing:.5px;">
          DURATA DEPLASĂRII: ${periodStartFmt} — ${periodEndFmt}  •  ${zileTotal} zile lucrate
        </div>
        
        <!-- CONFIRMĂRI -->
        <div style="background:${blueLight};color:${blueDark};padding:4px 10px;font-weight:700;font-size:10px;border:1px solid #ccc;margin-top:8px;">CONFIRMĂRI:</div>
        <table style="${tblStyle}font-size:10px;border:1px solid #ccc;border-top:0;">
          <tr><td style="padding:4px 10px;font-weight:700;width:90px;">UNITATEA 1:</td>
              <td style="padding:4px 6px;">Sosit la ___________________ Data __________ Sem. __________</td></tr>
          <tr><td style="padding:4px 10px;"></td>
              <td style="padding:4px 6px;">Plecat din _________________ Data __________ Sem. __________</td></tr>
          <tr><td style="padding:4px 10px;font-weight:700;">UNITATEA 2:</td>
              <td style="padding:4px 6px;">Sosit la ___________________ Data __________ Sem. __________</td></tr>
          <tr><td style="padding:4px 10px;"></td>
              <td style="padding:4px 6px;">Plecat din _________________ Data __________ Sem. __________</td></tr>
        </table>
        
        <!-- DECONT -->
        <div style="background:${blueLight};color:${blueDark};padding:4px 10px;font-weight:700;font-size:10px;border:1px solid #ccc;margin-top:8px;">DECONT:</div>
        <table style="${tblStyle}font-size:10px;border:1px solid #ccc;border-top:0;">
          <tr><td style="padding:4px 10px;width:170px;">Avans primit la plecare:</td>
              <td style="padding:4px 6px;">_______________ lei</td></tr>
          <tr><td style="padding:4px 10px;">Avans rest neutilizat:</td>
              <td style="padding:4px 6px;">_______________ lei</td></tr>
        </table>
        
        <!-- CHELTUIELI -->
        <div style="background:${blueLight};color:${blueDark};padding:4px 10px;font-weight:700;font-size:10px;border:1px solid #ccc;margin-top:8px;">CHELTUIELI:</div>
        <table style="${tblStyle}font-size:10px;border:1px solid #ccc;border-top:0;text-align:center;">${colgroup}
          <tr style="background:${grayBg};font-weight:700;">
            <td colspan="1" style="padding:4px;border-right:1px solid #ccc;">Nr.</td>
            <td colspan="3" style="padding:4px;border-right:1px solid #ccc;text-align:left;">Documente justificative</td>
            <td colspan="1" style="padding:4px;border-right:1px solid #ccc;">Val./buc</td>
            <td colspan="1" style="padding:4px;border-right:1px solid #ccc;">Cant.</td>
            <td colspan="2" style="padding:4px;">Total</td>
          </tr>
          <tr>
            <td colspan="1" style="padding:4px;border-right:1px solid #ccc;border-top:1px solid #ccc;">1.</td>
            <td colspan="3" style="padding:4px;border-right:1px solid #ccc;border-top:1px solid #ccc;text-align:left;">Diurnă internă</td>
            <td colspan="1" style="padding:4px;border-right:1px solid #ccc;border-top:1px solid #ccc;">${diurnaPerZi.toFixed(2)} lei</td>
            <td colspan="1" style="padding:4px;border-right:1px solid #ccc;border-top:1px solid #ccc;">${zileTotal} zile</td>
            <td colspan="2" style="padding:4px;border-top:1px solid #ccc;font-weight:700;">${totalChelt} lei</td>
          </tr>
          <tr style="background:${blueLight};color:${blueDark};font-weight:700;">
            <td colspan="6" style="padding:5px;text-align:right;border-top:1px solid #ccc;">TOTAL CHELTUIELI:</td>
            <td colspan="2" style="padding:5px;border-top:1px solid #ccc;">${totalChelt} lei</td>
          </tr>
          <tr style="font-weight:700;">
            <td colspan="6" style="padding:5px;text-align:right;border-top:1px solid #ccc;">DIFERENȚA DE PRIMIT:</td>
            <td colspan="2" style="padding:5px;border-top:1px solid #ccc;">${totalChelt} lei</td>
          </tr>
        </table>
        
        <!-- SEMNĂTURI — banda principală cu IMAGINI -->
        <div style="background:${blueDark};color:#fff;padding:5px 10px;font-weight:700;font-size:11px;letter-spacing:.5px;margin-top:14px;">SEMNĂTURI:</div>
        <table style="${tblStyle}border:1px solid #ccc;border-top:0;text-align:center;">${colgroup}
          <!-- Header coloane -->
          <tr style="background:${blueLight};color:${blueDark};font-weight:700;font-size:9px;">
            <td colspan="2" style="padding:5px 4px;border-right:1px solid #ccc;">SE APROBĂ</td>
            <td colspan="2" style="padding:5px 4px;border-right:1px solid #ccc;">CONTROL FIN. PREVENTIV</td>
            <td colspan="2" style="padding:5px 4px;border-right:1px solid #ccc;">VERIFICAT DECONT</td>
            <td colspan="2" style="padding:5px 4px;">TITULAR ORDIN</td>
          </tr>
          <!-- Spațiu imagini semnături (înălțime 60px) -->
          <tr style="height:60px;background:#fff;">
            <td colspan="2" style="padding:4px;border-right:1px solid #eee;vertical-align:middle;">${sigCell(semnaturiData.aproba)}</td>
            <td colspan="2" style="padding:4px;border-right:1px solid #eee;vertical-align:middle;">${sigCell(semnaturiData.control)}</td>
            <td colspan="2" style="padding:4px;border-right:1px solid #eee;vertical-align:middle;">${sigCell(semnaturiData.verificat)}</td>
            <td colspan="2" style="padding:4px;vertical-align:middle;">${sigCell(semnaturiData.titular)}</td>
          </tr>
          <!-- Numele sub semnături -->
          <tr style="background:${grayBg};color:${blueDark};font-weight:700;font-size:9px;border-top:1px solid #ccc;">
            <td colspan="2" style="padding:5px 4px;border-right:1px solid #ccc;">${esc((setari.director_aproba || 'Trusu Razvan').toUpperCase())}</td>
            <td colspan="2" style="padding:5px 4px;border-right:1px solid #ccc;">${esc((setari.control_preventiv || 'Tudorache Marilena').toUpperCase())}</td>
            <td colspan="2" style="padding:5px 4px;border-right:1px solid #ccc;">${esc((setari.verificat_decont || 'Mirela Popescu').toUpperCase())}</td>
            <td colspan="2" style="padding:5px 4px;">${esc(numeAng)}</td>
          </tr>
        </table>
        
        <!-- Footer companie -->
        <div style="background:${blueDark};color:#fff;padding:5px 10px;font-weight:700;font-size:9px;text-align:center;letter-spacing:1px;margin-top:14px;">
          ${esc(denumireSocietate)}  •  ${esc(nrRegCom)}  •  CUI: ${esc(cui)}
        </div>
        
        <!-- Log audit generare (mic, gri, pentru trasabilitate) -->
        <div style="color:#999;font-size:7px;text-align:right;margin-top:6px;font-style:italic;letter-spacing:.3px;">
          📋 Document generat electronic în PontajPRO la ${esc(genTimestamp)} • Semnături inserate automat din baza de date
        </div>
      </div>
    `
    
    // ═══════════════════════════════════════════════════════════════
    // PAGINA 2 — SITUAȚIE PREZENȚĂ ZILNICĂ
    // ═══════════════════════════════════════════════════════════════
    const rows = allDays.map((d, i) => {
      const isWE = d.is_weekend || (d.date && [0, 6].includes(new Date(d.date + 'T12:00').getDay()))
      const isLegal = d.is_legal || !!d.legal_name
      const skip = isWE || isLegal
      const dataFmt = d.date ? fmtRO(d.date) : ''
      const shantier = skip ? '—' : esc(d.shantier_name || '')
      const obs = isLegal
        ? `Sărbătoare legală${d.legal_name ? ' (' + esc(d.legal_name) + ')' : ''}`
        : (isWE ? 'Weekend' : '')
      const styleRow = skip ? 'background:#FAFAFA;color:#888;font-style:italic;' : ''
      return `<tr style="${styleRow}">
        <td style="padding:3px 6px;border:1px solid #ddd;text-align:center;font-size:10px;">${i + 1}.</td>
        <td style="padding:3px 6px;border:1px solid #ddd;text-align:center;font-size:10px;">${dataFmt}</td>
        <td style="padding:3px 6px;border:1px solid #ddd;font-size:10px;">${shantier}</td>
        <td style="padding:3px 6px;border:1px solid #ddd;font-size:10px;">${esc(obs)}</td>
      </tr>`
    }).join('')
    
    const page2 = `
      <div class="pdf-page-2" style="${pageStyle}">
        <div style="color:${blueDark};font-size:18px;font-weight:800;letter-spacing:1px;margin-bottom:4px;">SITUAȚIE PREZENȚĂ ZILNICĂ</div>
        <div style="font-size:10px;font-style:italic;color:#666;margin-bottom:10px;">
          Angajat: <strong style="color:#000;">${numeAng}</strong>  •
          Funcția: <strong style="color:#000;">${functieAng}</strong>  •
          Perioada: <strong style="color:#000;">${periodStartFmt} – ${periodEndFmt}</strong>
        </div>
        <table style="${tblStyle}">
          <colgroup><col style="width:7%"><col style="width:13%"><col><col style="width:28%"></colgroup>
          <thead>
            <tr style="background:${blueLight};color:${blueDark};font-weight:700;font-size:10px;">
              <td style="padding:6px;border:1px solid #ccc;text-align:center;">Nr. zi</td>
              <td style="padding:6px;border:1px solid #ccc;text-align:center;">Data</td>
              <td style="padding:6px;border:1px solid #ccc;">Șantier</td>
              <td style="padding:6px;border:1px solid #ccc;">Observații</td>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
          <tfoot>
            <tr style="background:${blueLight};color:${blueDark};font-weight:700;font-size:10px;">
              <td colspan="2" style="padding:6px;border:1px solid #ccc;text-align:right;">TOTAL ZILE LUCRATE:</td>
              <td colspan="2" style="padding:6px;border:1px solid #ccc;">${ziluLcrate} zile</td>
            </tr>
          </tfoot>
        </table>
        <div style="background:${blueDark};color:#fff;padding:5px 10px;font-weight:700;font-size:9px;text-align:center;letter-spacing:1px;margin-top:14px;">
          ${esc(denumireSocietate)}  •  ${esc(nrRegCom)}  •  CUI: ${esc(cui)}
        </div>
        <div style="color:#999;font-size:7px;text-align:right;margin-top:6px;font-style:italic;letter-spacing:.3px;">
          📋 Document generat electronic în PontajPRO la ${esc(genTimestamp)} • Pagina 2/2
        </div>
      </div>
    `
    
    return { page1, page2 }
  }
  
  // Generează ZIP cu PDF-uri per angajat (cu semnături inserate)
  // ─── Helpers Numerotare + Validare Fereastră (Etapa 7.5 Faza 3.1) ───
  // Format Nr.: OD {INITIALE_PRIMELE_2_CUVINTE} {LUNA_NR}. Ex: OD AD 4 pentru ABSER DIDARUL Aprilie
  const getInitialsOrdin = (name) => {
    if (!name) return 'XX'
    const words = String(name).trim().toUpperCase().split(/\s+/).filter(Boolean)
    if (words.length === 0) return 'XX'
    if (words.length === 1) return words[0].substring(0, 2)
    return (words[0][0] || '') + (words[1][0] || '')
  }
  const getDataEmiteriiOrdin = (periodFromStr) => {
    if (!periodFromStr) return null
    const d = new Date(periodFromStr + 'T12:00')
    return new Date(d.getFullYear(), d.getMonth() + 1, 0)  // ultima zi a lunii
  }
  const getNumarOrdin = (name, periodFromStr) => {
    const d = new Date(periodFromStr + 'T12:00')
    const luna = d.getMonth() + 1
    return `OD ${getInitialsOrdin(name)} ${luna}`
  }
  const isInGenerationWindow = (periodFromStr) => {
    const pf = new Date(periodFromStr + 'T12:00')
    const Y = pf.getFullYear(); const M = pf.getMonth()
    const lastDay = new Date(Y, M + 1, 0).getDate()
    const today = new Date()
    const Ty = today.getFullYear(); const Tm = today.getMonth(); const Td = today.getDate()
    // Ultima zi a lunii M
    if (Ty === Y && Tm === M && Td === lastDay) return true
    // Primele 7 zile ale lunii M+1
    const nextMonth = M === 11 ? { y: Y + 1, m: 0 } : { y: Y, m: M + 1 }
    if (Ty === nextMonth.y && Tm === nextMonth.m && Td >= 1 && Td <= 7) return true
    return false
  }

  const generateOrdinePDF = async () => {
    const selected = ordGenEmps.filter(e => e.selected && e.diurna_max > 0)
    if (!selected.length) {
      showToast('Selectează cel puțin un angajat cu zile admise > 0', 'warn')
      return
    }
    if (!ordGenPayment) { showToast('Eroare: plată necunoscută', 'error'); return }
    
    // ─── Validare fereastră generare (Etapa 7.5 Faza 3.1) ───
    const inWindow = isInGenerationWindow(ordGenPayment.period_from)
    if (!inWindow) {
      const lastDay = getDataEmiteriiOrdin(ordGenPayment.period_from)
      const lastDayFmt = lastDay.toLocaleDateString('ro-RO')
      const todayFmt = new Date().toLocaleDateString('ro-RO')
      if (profile?.is_owner) {
        const ok = window.confirm(
          `⚠ FEREASTRA RECOMANDATĂ pentru generarea ordinelor:\n\n` +
          `  • Ultima zi a lunii: ${lastDayFmt}\n` +
          `  • SAU primele 7 zile ale lunii următoare\n\n` +
          `Azi: ${todayFmt} (în afara ferestrei)\n\n` +
          `Doar tu (owner) poți face override. Continui?`
        )
        if (!ok) return
      } else {
        showToast(
          `⛔ Ordinele de deplasare pot fi generate doar în ultima zi a lunii (${lastDayFmt}) sau în primele 7 zile ale lunii următoare. Pentru excepții contactează owner-ul.`,
          'warn'
        )
        return
      }
    }
    
    setOrdGenerating(true)
    setOrdGenProgress({ done: 0, total: selected.length })
    
    try {
      // 1. Fetch setari + firma + toate semnăturile active + lista employees în paralel
      const [setariRes, firmaSetRes, sigsRes, empsRes] = await Promise.all([
        supabase.from('setari_ordin_deplasare').select('*').eq('id', 1).maybeSingle(),
        supabase.from('logistica_setari').select('key,value').like('key', 'firma%'),
        supabase.from('hr_semnaturi_electronice').select('employee_id, fisier_path').eq('activ', true),
        supabase.from('employees').select('id, name').eq('active', true),
      ])
      
      const setari = setariRes.data || {
        director_aproba: 'Trusu Razvan',
        control_preventiv: 'Tudorache Marilena',
        verificat_decont: 'Mirela Popescu',
      }
      const fm = {}; (firmaSetRes.data || []).forEach(x => fm[x.key] = x.value)
      const denumireSocietate = fm['firma_nume'] || 'GAZPET INSTAL SRL'
      const nrRegCom = fm['firma_reg_com'] || 'J29/0001650/2007'
      const cui = fm['firma_cui'] || 'RO 22029920'
      
      // 2. Map employee_id → fisier_path semnătură activă
      const sigPathByEmpId = {}
      ;(sigsRes.data || []).forEach(s => { sigPathByEmpId[s.employee_id] = s.fisier_path })
      const allEmployees = empsRes.data || []
      
      // 3. Lookup fuzzy 3 semnatari fix → employee_id → signed URL → dataURL (cache global)
      const dataURLCache = new Map()  // employee_id → dataURL
      const getSigDataURLByEmpId = async (empId) => {
        if (!empId) return null
        if (dataURLCache.has(empId)) return dataURLCache.get(empId)
        const path = sigPathByEmpId[empId]
        if (!path) { dataURLCache.set(empId, null); return null }
        const { data: signed } = await supabase.storage.from('hr-semnaturi').createSignedUrl(path, 600)
        if (!signed?.signedUrl) { dataURLCache.set(empId, null); return null }
        const dataUrl = await fetchAsDataURL(signed.signedUrl)
        dataURLCache.set(empId, dataUrl)
        return dataUrl
      }
      
      const empAproba = findEmployeeFuzzy(setari.director_aproba, allEmployees)
      const empControl = findEmployeeFuzzy(setari.control_preventiv, allEmployees)
      const empVerificat = findEmployeeFuzzy(setari.verificat_decont, allEmployees)
      
      // Pre-load cele 3 semnături fixe (paralel)
      const [sigAproba, sigControl, sigVerificat] = await Promise.all([
        getSigDataURLByEmpId(empAproba?.id),
        getSigDataURLByEmpId(empControl?.id),
        getSigDataURLByEmpId(empVerificat?.id),
      ])
      
      // Warn dacă lipsesc semnături obligatorii
      const missing = []
      if (!sigAproba) missing.push(`SE APROBĂ (${setari.director_aproba || 'Trusu Razvan'})`)
      if (!sigControl) missing.push(`CONTROL FIN. (${setari.control_preventiv || 'Tudorache Marilena'})`)
      if (!sigVerificat) missing.push(`VERIFICAT DECONT (${setari.verificat_decont || 'Mirela Popescu'})`)
      if (missing.length) {
        const ok = window.confirm(
          `⚠ Semnături lipsă pentru:\n\n  • ${missing.join('\n  • ')}\n\n` +
          `Aceste rubrici vor apărea GOALE în PDF. Continui? Apasă OK pentru a continua, sau Cancel pentru a opri și a uploada întâi semnăturile lipsă (HR → Semnături).`
        )
        if (!ok) { setOrdGenerating(false); return }
      }
      
      // Helper format date dd.mm.yyyy
      const fmtRO = (s) => {
        if (!s) return ''
        const d = new Date(s + (s.length === 10 ? 'T12:00' : ''))
        return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`
      }
      const periodStartFmt = fmtRO(ordGenPayment.period_from)
      const periodEndFmt = fmtRO(ordGenPayment.period_to)
      
      // Timestamp generare pentru log audit (apare jos pe fiecare pagină)
      const now = new Date()
      const genTimestamp = `${String(now.getDate()).padStart(2,'0')}.${String(now.getMonth()+1).padStart(2,'0')}.${now.getFullYear()} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`
      
      // 4. Dynamic imports (jsPDF + html2canvas + JSZip)
      const [{ default: jsPDF }, { default: html2canvas }, { default: JSZip }] = await Promise.all([
        import('jspdf'),
        import('html2canvas'),
        import('jszip'),
      ])
      const zip = new JSZip()
      const archiveQueue = []  // { emp, pdfBlob, filename }
      
      // 5. Container offscreen unic (reutilizat pentru fiecare angajat)
      const wrapper = document.createElement('div')
      wrapper.style.cssText = 'position:absolute;left:-99999px;top:0;width:794px;background:#fff;'
      document.body.appendChild(wrapper)
      
      try {
        for (let idx = 0; idx < selected.length; idx++) {
          const emp = selected[idx]
          // Titular semnătură (lookup direct pe employee_id)
          // FIX 15.05.2026: era emp.id (undefined) - structura ordGenEmps folosește employee_id
          const sigTitular = await getSigDataURLByEmpId(emp.employee_id)
          
          const allDays = emp.allDays || []
          
          // Calculez numar_ordin + data_emiterii per angajat (Etapa 7.5 Faza 3.1)
          const numarOrdEmp = getNumarOrdin(emp.name, ordGenPayment.period_from)
          const dataEmitEmp = getDataEmiteriiOrdin(ordGenPayment.period_from)
          const dataEmitFmt = `${String(dataEmitEmp.getDate()).padStart(2,'0')}.${String(dataEmitEmp.getMonth()+1).padStart(2,'0')}.${dataEmitEmp.getFullYear()}`
          const dataEmitISO = dataEmitEmp.toISOString().split('T')[0]
          // Zile lucrate + sumă (pentru INSERT + registru)
          const zileLucrateEmp = allDays.filter(d => d.shantier_name && !d.is_weekend && !d.is_legal).length || (emp.diurna_max || 0)
          const sumaTotalaEmp = zileLucrateEmp * (Number(diurnaAmt) || 0)
          
          // Build HTML 2 pagini cu semnături inserate
          const { page1, page2 } = buildOrdinHTML({
            emp, ordGenPayment, allDays, setari,
            denumireSocietate, nrRegCom, cui, periodStartFmt, periodEndFmt, fmtRO,
            semnaturiData: { aproba: sigAproba, control: sigControl, verificat: sigVerificat, titular: sigTitular },
            genTimestamp,
            numarOrd: numarOrdEmp,
            dataEmit: dataEmitFmt,
          })
          
          wrapper.innerHTML = page1 + page2
          
          // Wait pentru imagini să se încarce (data URLs sunt sync dar lasă să se așeze layout-ul)
          await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
          
          const page1Elem = wrapper.querySelector('.pdf-page-1')
          const page2Elem = wrapper.querySelector('.pdf-page-2')
          
          const canvasOpts = { scale: 2, useCORS: true, logging: false, background: '#fff' }
          const canvas1 = await html2canvas(page1Elem, canvasOpts)
          const canvas2 = await html2canvas(page2Elem, canvasOpts)
          
          // jsPDF A4: 210 × 297mm
          const pdf = new jsPDF('p', 'mm', 'a4')
          pdf.addImage(canvas1.toDataURL('image/png'), 'PNG', 0, 0, 210, 297, undefined, 'FAST')
          pdf.addPage()
          pdf.addImage(canvas2.toDataURL('image/png'), 'PNG', 0, 0, 210, 297, undefined, 'FAST')
          
          const pdfBlob = pdf.output('blob')
          const safeName = emp.name.replace(/[^a-zA-Z0-9_\-]/g, '_')
          const filename = `Ordin_Deplasare_${safeName}_${ordGenPayment.period_from}_${ordGenPayment.period_to}.pdf`
          zip.file(filename, pdfBlob)
          archiveQueue.push({ 
            emp, pdfBlob, filename, 
            sigTitularPath: sigPathByEmpId[emp.employee_id] || null,
            numarOrd: numarOrdEmp,
            dataEmitISO,
            zileLucrate: zileLucrateEmp,
            sumaTotala: sumaTotalaEmp,
          })
          
          setOrdGenProgress({ done: idx + 1, total: selected.length })
        }
      } finally {
        document.body.removeChild(wrapper)
      }
      
      // 6. Generate ZIP + download (rapid, pentru ca Razvan să vadă rezultatul)
      const zipBlob = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(zipBlob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Ordine_Deplasare_PDF_${ordGenPayment.period_from}_${ordGenPayment.period_to}.zip`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      
      // 7. ARHIVARE (background - upload Storage + INSERT BD)
      showToast(`📦 Arhivare ${archiveQueue.length} PDF-uri în BD...`)
      const uid = (await supabase.auth.getUser()).data.user?.id || null
      const snapshotBase = {
        director_aproba: empAproba ? { nume: setari.director_aproba, employee_id: empAproba.id, semnatura_path: sigPathByEmpId[empAproba.id] || null } : { nume: setari.director_aproba, employee_id: null, semnatura_path: null },
        control_preventiv: empControl ? { nume: setari.control_preventiv, employee_id: empControl.id, semnatura_path: sigPathByEmpId[empControl.id] || null } : { nume: setari.control_preventiv, employee_id: null, semnatura_path: null },
        verificat_decont: empVerificat ? { nume: setari.verificat_decont, employee_id: empVerificat.id, semnatura_path: sigPathByEmpId[empVerificat.id] || null } : { nume: setari.verificat_decont, employee_id: null, semnatura_path: null },
        generat_la: genTimestamp,
      }
      const folderPath = `${ordGenPayment.period_from.substring(0,7)}/${ordGenPayment.period_from}_${ordGenPayment.period_to}`
      const arhivareResults = await Promise.allSettled(
        archiveQueue.map(async ({ emp, pdfBlob, filename, sigTitularPath, numarOrd, dataEmitISO, zileLucrate, sumaTotala }) => {
          const uuid8 = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36)).replace(/-/g,'').substring(0, 8)
          const storagePath = `${folderPath}/${emp.employee_id}_${uuid8}.pdf`
          const { error: upErr } = await supabase.storage
            .from('ordine-deplasare-pdf')
            .upload(storagePath, pdfBlob, { contentType: 'application/pdf', upsert: false })
          if (upErr) throw new Error(`Upload ${emp.name}: ${upErr.message}`)
          const semnaturi = {
            ...snapshotBase,
            titular: { nume: emp.name, employee_id: emp.employee_id, semnatura_path: sigTitularPath },
          }
          const { error: insErr } = await supabase.from('ordine_deplasare_arhiva').insert({
            employee_id: emp.employee_id,
            period_from: ordGenPayment.period_from,
            period_to: ordGenPayment.period_to,
            pdf_path: storagePath,
            pdf_nume: filename,
            pdf_size_bytes: pdfBlob.size,
            semnaturi_snapshot: semnaturi,
            numar_ordin: numarOrd,
            data_emiterii: dataEmitISO,
            zile_lucrate: zileLucrate,
            suma_totala: sumaTotala,
            created_by: uid,
          })
          if (insErr) {
            // Rollback Storage dacă INSERT eșuează
            await supabase.storage.from('ordine-deplasare-pdf').remove([storagePath]).catch(()=>{})
            throw new Error(`Insert ${emp.name}: ${insErr.message}`)
          }
          return emp.name
        })
      )
      const okCount = arhivareResults.filter(r => r.status === 'fulfilled').length
      const errCount = arhivareResults.length - okCount
      const errMsgs = arhivareResults.filter(r => r.status === 'rejected').map(r => r.reason?.message || r.reason).slice(0, 3)
      if (errCount > 0) console.error('Arhivare erori:', arhivareResults.filter(r => r.status === 'rejected'))
      
      playBeep(920, 0.12); setTimeout(() => playBeep(1100, 0.12), 130)
      if (errCount === 0) {
        showToast(`✅ ${okCount} PDF-uri generate, descărcate și arhivate`)
      } else {
        showToast(`⚠ ${okCount}/${archiveQueue.length} arhivate (${errCount} erori). ZIP-ul a fost descărcat OK. ${errMsgs.length ? 'Primele erori: ' + errMsgs.join('; ') : ''}`, 'warn')
      }
      setShowOrdGen(false)
      setOrdGenEmps([])
      setOrdGenPayment(null)
      // Reload notificarea ordine lipsă (Etapa 7.5 Faza 3.2)
      loadOrdineLipsa()
    } catch (e) {
      console.error('generateOrdinePDF err:', e)
      showToast('Eroare la generare PDF: ' + (e?.message || e), 'error')
    } finally {
      setOrdGenerating(false)
      setOrdGenProgress({ done: 0, total: 0 })
    }
  }
  
  // Generează ZIP cu xlsx per angajat (build from-scratch, fără template Storage)
  // Layout: pagina 1 = ordin deplasare (CONFIRMĂRI, DECONT, SEMNĂTURI) + pagina 2 = Situație Prezență Zilnică
  const generateOrdine = async () => {
    const selected = ordGenEmps.filter(e => e.selected && e.diurna_max > 0)
    if (!selected.length) {
      showToast('Selectează cel puțin un angajat cu zile admise > 0', 'warn')
      return
    }
    if (!ordGenPayment) { showToast('Eroare: plată necunoscută', 'error'); return }

    setOrdGenerating(true)
    setOrdGenProgress({ done: 0, total: selected.length })

    try {
      // 1. Fetch semnatari + date firmă în paralel
      const [setariRes, firmaSetRes] = await Promise.all([
        supabase.from('setari_ordin_deplasare').select('*').eq('id', 1).maybeSingle(),
        supabase.from('logistica_setari').select('key,value').like('key', 'firma%'),
      ])
      const setari = setariRes.data || {
        director_aproba: 'Trusu Razvan',
        control_preventiv: 'Tudorache Marilena',
        verificat_decont: 'Mirela Popescu',
        sef_compartiment: 'Udrea Natalia',
      }
      const fm = {}; (firmaSetRes.data || []).forEach(x => fm[x.key] = x.value)
      const denumireSocietate = fm['firma_nume'] || 'GAZPET INSTAL SRL'
      const nrRegCom = fm['firma_reg_com'] || 'J29/0001650/2007'
      const cui = fm['firma_cui'] || 'RO 22029920'

      // Helper format date dd.mm.yyyy
      const fmtRO = (s) => {
        if (!s) return ''
        const d = new Date(s + (s.length === 10 ? 'T12:00' : ''))
        return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`
      }
      const periodStartFmt = fmtRO(ordGenPayment.period_from)
      const periodEndFmt = fmtRO(ordGenPayment.period_to)

      // 2. Dynamic import JSZip
      const JSZip = (await import('jszip')).default
      const zip = new JSZip()

      // ─── Paleta culori ─────────────────────────────────────────────
      const BLUE_DARK = '1F497D', BLUE_LIGHT = 'D9E1F2', GRAY_BG = 'F5F5F5'
      const WHITE = 'FFFFFF', TEXT_MUTED = '7F7F7F', BORDER_GRAY = 'BFBFBF'

      // Border thin
      const tb = {
        top: { style: 'thin', color: { rgb: BORDER_GRAY } },
        bottom: { style: 'thin', color: { rgb: BORDER_GRAY } },
        left: { style: 'thin', color: { rgb: BORDER_GRAY } },
        right: { style: 'thin', color: { rgb: BORDER_GRAY } },
      }

      // ─── Helper: setCell ──────────────────────────────────────────
      const setCell = (ws, addr, opts) => { ws[addr] = opts }
      const merge = (ws, fromAddr, toAddr) => {
        ws['!merges'] = ws['!merges'] || []
        ws['!merges'].push({ s: XLSX.utils.decode_cell(fromAddr), e: XLSX.utils.decode_cell(toAddr) })
      }

      // ─── Stiluri pre-construite ───────────────────────────────────
      const styleTitlu = {
        fill: { fgColor: { rgb: WHITE } },
        font: { name: 'Calibri', sz: 16, bold: true, color: { rgb: BLUE_DARK } },
        alignment: { horizontal: 'center', vertical: 'center' },
      }
      const styleBanner = {
        fill: { fgColor: { rgb: BLUE_DARK } },
        font: { name: 'Calibri', sz: 11, bold: true, color: { rgb: WHITE } },
        alignment: { horizontal: 'left', vertical: 'center', indent: 1 },
        border: tb,
      }
      const styleBannerCenter = {
        fill: { fgColor: { rgb: BLUE_DARK } },
        font: { name: 'Calibri', sz: 11, bold: true, color: { rgb: WHITE } },
        alignment: { horizontal: 'center', vertical: 'center' },
        border: tb,
      }
      const styleSubHeader = {
        fill: { fgColor: { rgb: BLUE_DARK } },
        font: { name: 'Calibri', sz: 10, bold: true, color: { rgb: WHITE } },
        alignment: { horizontal: 'center', vertical: 'center' },
        border: tb,
      }
      const styleFieldLabel = {
        fill: { fgColor: { rgb: GRAY_BG } },
        font: { name: 'Calibri', sz: 9 },
        alignment: { horizontal: 'left', vertical: 'center', indent: 1 },
        border: tb,
      }
      const styleFieldValue = {
        fill: { fgColor: { rgb: WHITE } },
        font: { name: 'Calibri', sz: 10 },
        alignment: { horizontal: 'left', vertical: 'center', indent: 1 },
        border: tb,
      }
      const styleAmount = (bold = false) => ({
        fill: { fgColor: { rgb: WHITE } },
        font: { name: 'Calibri', sz: 10, bold },
        alignment: { horizontal: 'right', vertical: 'center', indent: 1 },
        border: tb,
        numFmt: '#,##0.00',
      })
      const styleAmountTotal = {
        fill: { fgColor: { rgb: WHITE } },
        font: { name: 'Calibri', sz: 10, bold: true },
        alignment: { horizontal: 'right', vertical: 'center', indent: 1 },
        border: tb,
        numFmt: '#,##0.00 "RON"',
      }
      const styleAmountTotalHighlight = {
        fill: { fgColor: { rgb: BLUE_LIGHT } },
        font: { name: 'Calibri', sz: 11, bold: true, color: { rgb: BLUE_DARK } },
        alignment: { horizontal: 'right', vertical: 'center', indent: 1 },
        border: tb,
        numFmt: '#,##0.00 "RON"',
      }
      const styleItalicNote = {
        font: { name: 'Calibri', sz: 9, italic: true, color: { rgb: TEXT_MUTED } },
        alignment: { horizontal: 'center', vertical: 'center' },
      }
      const styleSignature = {
        font: { name: 'Calibri', sz: 11, bold: true, color: { rgb: BLUE_DARK } },
        alignment: { horizontal: 'center', vertical: 'center' },
        border: { top: { style: 'thin', color: { rgb: TEXT_MUTED } } },
      }
      const styleDateDuratahdr = {
        font: { name: 'Calibri', sz: 10, bold: true },
        alignment: { horizontal: 'right', vertical: 'center' },
      }
      const styleDateDurataVal = {
        font: { name: 'Calibri', sz: 10, bold: true, color: { rgb: BLUE_DARK } },
        alignment: { horizontal: 'center', vertical: 'center' },
      }
      const styleSuffixLei = {
        fill: { fgColor: { rgb: WHITE } },
        font: { name: 'Calibri', sz: 9, italic: true, color: { rgb: TEXT_MUTED } },
        alignment: { horizontal: 'left', vertical: 'center' },
        border: tb,
      }
      const styleCheltuieliBanner = {
        fill: { fgColor: { rgb: BLUE_LIGHT } },
        font: { name: 'Calibri', sz: 10, bold: true, color: { rgb: BLUE_DARK } },
        alignment: { horizontal: 'left', vertical: 'center', indent: 1 },
        border: tb,
      }
      const styleTotalLabelHighlight = {
        fill: { fgColor: { rgb: BLUE_LIGHT } },
        font: { name: 'Calibri', sz: 11, bold: true, color: { rgb: BLUE_DARK } },
        alignment: { horizontal: 'left', vertical: 'center', indent: 1 },
        border: tb,
      }
      const styleSubHeaderRole = {
        font: { name: 'Calibri', sz: 9, italic: true, color: { rgb: TEXT_MUTED } },
        alignment: { horizontal: 'center', vertical: 'center' },
      }
      const styleCompanyBanner = {
        fill: { fgColor: { rgb: BLUE_DARK } },
        font: { name: 'Calibri', sz: 10, bold: true, color: { rgb: WHITE } },
        alignment: { horizontal: 'center', vertical: 'center' },
        border: tb,
      }
      const styleSitTitle = {
        font: { name: 'Calibri', sz: 14, bold: true, color: { rgb: BLUE_DARK } },
        alignment: { horizontal: 'center', vertical: 'center' },
      }
      const styleDayCell = (isOff) => isOff ? {
        font: { name: 'Calibri', sz: 9, italic: true, color: { rgb: TEXT_MUTED } },
        alignment: { horizontal: 'center', vertical: 'center' },
        border: tb,
        fill: { fgColor: { rgb: GRAY_BG } },
      } : {
        font: { name: 'Calibri', sz: 10 },
        alignment: { horizontal: 'center', vertical: 'center' },
        border: tb,
      }
      const styleDaySite = (isOff) => isOff ? {
        font: { name: 'Calibri', sz: 9, italic: true, color: { rgb: TEXT_MUTED } },
        alignment: { horizontal: 'center', vertical: 'center' },
        border: tb,
        fill: { fgColor: { rgb: GRAY_BG } },
      } : {
        font: { name: 'Calibri', sz: 10 },
        alignment: { horizontal: 'left', vertical: 'center', indent: 1 },
        border: tb,
      }
      const styleDayObs = (isOff) => ({
        fill: { fgColor: { rgb: isOff ? GRAY_BG : WHITE } },
        border: tb,
      })

      // ─── Construire ordin per angajat ─────────────────────────────
      for (let idx = 0; idx < selected.length; idx++) {
        const emp = selected[idx]

        // Lista zile completă pentru perioada de export (cu/fără șantier)
        const allDays = []
        const periodStartD = new Date(ordGenPayment.period_from)
        const periodEndD = new Date(ordGenPayment.period_to)
        const distMap = new Map(emp.diurna_records.slice(0, emp.diurna_max).map(r => [r.date, r]))
        const dIter = new Date(periodStartD)
        while (dIter <= periodEndD) {
          const ds = dIter.toISOString().split('T')[0]
          const rec = distMap.get(ds)
          allDays.push({
            nr: allDays.length + 1,
            data: fmtRO(ds),
            santier: rec ? (rec.sites?.name || 'Nealocate') : null,
          })
          dIter.setDate(dIter.getDate() + 1)
        }

        // Build worksheet
        const ws = {}

        // ───────── COLOANE A-H (lățimi optime pentru A4 portrait) ─────────
        // Total: 83 units = ~436 pt < 535 pt A4 useful → încape cu marjă confort (~2 cm liber stânga+dreapta)
        ws['!cols'] = [
          { wch: 4 },   // A: Nr. zi
          { wch: 11 },  // B: Data
          { wch: 18 },  // C: Conținut/Șantier
          { wch: 17 },  // D
          { wch: 8 },   // E: Nr. zile
          { wch: 9 },   // F: Lei/zi
          { wch: 12 },  // G: Suma RON
          { wch: 4 },   // H: lei suffix
        ]
        ws['!rows'] = []

        // ───────── R1: TITLU ─────────
        setCell(ws, 'A1', { v: 'ORDIN DE DEPLASARE', t: 's', s: styleTitlu })
        merge(ws, 'A1', 'H1')
        ws['!rows'][0] = { hpx: 28 }

        // ───────── R2: Durata deplasării ─────────
        setCell(ws, 'A2', { v: 'Durata deplasării:', t: 's', s: styleDateDuratahdr })
        merge(ws, 'A2', 'B2')
        setCell(ws, 'C2', { v: 'de la  ' + periodStartFmt, t: 's', s: styleDateDurataVal })
        merge(ws, 'C2', 'D2')
        setCell(ws, 'E2', { v: 'până la', t: 's', s: { font: { name: 'Calibri', sz: 10 }, alignment: { horizontal: 'center', vertical: 'center' } } })
        setCell(ws, 'F2', { v: periodEndFmt, t: 's', s: styleDateDurataVal })
        merge(ws, 'F2', 'H2')
        ws['!rows'][1] = { hpx: 20 }

        // ───────── R3: gol ─────────
        ws['!rows'][2] = { hpx: 6 }

        // ───────── R4: banda CONFIRMĂRI ─────────
        setCell(ws, 'A4', { v: '  CONFIRMĂRI SOSIT / PLECAT', t: 's', s: styleBanner })
        merge(ws, 'A4', 'H4')
        ws['!rows'][3] = { hpx: 22 }

        // ───────── R5: UNITATEA 1 | UNITATEA 2 ─────────
        setCell(ws, 'A5', { v: 'UNITATEA 1', t: 's', s: styleSubHeader })
        merge(ws, 'A5', 'D5')
        setCell(ws, 'E5', { v: 'UNITATEA 2', t: 's', s: styleSubHeader })
        merge(ws, 'E5', 'H5')
        ws['!rows'][4] = { hpx: 18 }

        // ───────── R6-R8: Sosit/Plecat/Cazare ─────────
        const fields = ['Sosit', 'Plecat', 'Cu / fără cazare']
        fields.forEach((label, i) => {
          const r = 6 + i
          setCell(ws, `A${r}`, { v: label, t: 's', s: styleFieldLabel })
          merge(ws, `A${r}`, `B${r}`)
          setCell(ws, `C${r}`, { v: '', t: 's', s: styleFieldValue })
          merge(ws, `C${r}`, `D${r}`)
          setCell(ws, `E${r}`, { v: label, t: 's', s: styleFieldLabel })
          merge(ws, `E${r}`, `F${r}`)
          setCell(ws, `G${r}`, { v: '', t: 's', s: styleFieldValue })
          merge(ws, `G${r}`, `H${r}`)
          ws['!rows'][r - 1] = { hpx: 16 }
        })

        // ───────── R9-R10: ștampila ─────────
        setCell(ws, 'A9', { v: 'Ștampila unității și semnătura', t: 's', s: styleItalicNote })
        merge(ws, 'A9', 'D10')
        setCell(ws, 'E9', { v: 'Ștampila unității și semnătura', t: 's', s: styleItalicNote })
        merge(ws, 'E9', 'H10')
        ws['!rows'][8] = { hpx: 14 }
        ws['!rows'][9] = { hpx: 14 }

        // ───────── R11: gol ─────────
        ws['!rows'][10] = { hpx: 6 }

        // ───────── R12: banda DECONT DEPLASARE ─────────
        setCell(ws, 'A12', { v: '  DECONT DEPLASARE', t: 's', s: styleBanner })
        merge(ws, 'A12', 'H12')
        ws['!rows'][11] = { hpx: 22 }

        // ───────── R13-R16: rândurile decont ─────────
        const decontRows = [
          ['Ziua și ora plecării', 'Avans de decontare', ''],
          ['Ziua și ora sosirii', 'Primit la plecare', 'lei'],
          ['Data depunerii decontului', 'Primit în timpul deplasării', 'lei'],
          ['Penalități calculate', 'Total avans', 'lei'],
        ]
        decontRows.forEach((row, i) => {
          const r = 13 + i
          const [l1, l2, suf] = row
          setCell(ws, `A${r}`, { v: l1, t: 's', s: styleFieldLabel })
          merge(ws, `A${r}`, `B${r}`)
          setCell(ws, `C${r}`, { v: '', t: 's', s: styleFieldValue })
          merge(ws, `C${r}`, `D${r}`)
          setCell(ws, `E${r}`, { v: l2, t: 's', s: styleFieldLabel })
          merge(ws, `E${r}`, `F${r}`)
          setCell(ws, `G${r}`, { v: '', t: 's', s: styleFieldValue })
          setCell(ws, `H${r}`, { v: suf, t: 's', s: styleSuffixLei })
          ws['!rows'][r - 1] = { hpx: 17 }
        })

        // ───────── R17: gol ─────────
        ws['!rows'][16] = { hpx: 6 }

        // ───────── R18: banda Cheltuieli ─────────
        setCell(ws, 'A18', { v: '  Cheltuieli efectuate conform documente anexate', t: 's', s: styleCheltuieliBanner })
        merge(ws, 'A18', 'H18')
        ws['!rows'][17] = { hpx: 20 }

        // ───────── R19: Header tabel cheltuieli ─────────
        setCell(ws, 'A19', { v: 'Felul actului', t: 's', s: styleSubHeader })
        merge(ws, 'A19', 'D19')
        setCell(ws, 'E19', { v: 'Nr. zile', t: 's', s: styleSubHeader })
        setCell(ws, 'F19', { v: 'Lei / zi', t: 's', s: styleSubHeader })
        setCell(ws, 'G19', { v: 'Suma (RON)', t: 's', s: styleSubHeader })
        merge(ws, 'G19', 'H19')
        ws['!rows'][18] = { hpx: 18 }

        // ───────── R20: Diurnă cu FORMULĂ G20=E20*F20 ─────────
        setCell(ws, 'A20', { v: 'Diurnă', t: 's', s: styleFieldValue })
        merge(ws, 'A20', 'D20')
        setCell(ws, 'E20', { v: emp.diurna_max, t: 'n', s: { ...styleAmount(false), numFmt: '0' } })
        setCell(ws, 'F20', { v: diurnaAmt, t: 'n', s: styleAmount(false) })
        setCell(ws, 'G20', { f: 'E20*F20', t: 'n', s: styleAmountTotal })
        merge(ws, 'G20', 'H20')
        ws['!rows'][19] = { hpx: 18 }

        // ───────── R21-R22: rânduri goale pentru cheltuieli adăugate manual ─────────
        for (const r of [21, 22]) {
          setCell(ws, `A${r}`, { v: '', t: 's', s: styleFieldValue })
          merge(ws, `A${r}`, `D${r}`)
          setCell(ws, `E${r}`, { v: '', t: 's', s: styleAmount(false) })
          setCell(ws, `F${r}`, { v: '', t: 's', s: styleAmount(false) })
          setCell(ws, `G${r}`, { v: '', t: 's', s: styleAmount(false) })
          merge(ws, `G${r}`, `H${r}`)
          ws['!rows'][r - 1] = { hpx: 18 }
        }

        // ───────── R23: TOTAL CHELTUIELI cu FORMULĂ ─────────
        setCell(ws, 'A23', { v: 'TOTAL CHELTUIELI', t: 's', s: styleTotalLabelHighlight })
        merge(ws, 'A23', 'F23')
        setCell(ws, 'G23', { f: 'SUM(G20:G22)', t: 'n', s: styleAmountTotalHighlight })
        merge(ws, 'G23', 'H23')
        ws['!rows'][22] = { hpx: 22 }

        // ───────── R24: gol ─────────
        ws['!rows'][23] = { hpx: 6 }

        // ───────── R25: Diferența de primit/restituit cu FORMULĂ ─────────
        setCell(ws, 'A25', { v: 'Diferența de primit / restituit:', t: 's', s: { font: { name: 'Calibri', sz: 10 }, alignment: { horizontal: 'left', vertical: 'center' } } })
        merge(ws, 'A25', 'E25')
        setCell(ws, 'F25', { f: 'G23-G16', t: 'n', s: { font: { name: 'Calibri', sz: 11, bold: true }, alignment: { horizontal: 'right', vertical: 'center' }, numFmt: '#,##0.00 "RON"' } })
        merge(ws, 'F25', 'G25')
        setCell(ws, 'H25', { v: 'lei', t: 's', s: { font: { name: 'Calibri', sz: 9, italic: true, color: { rgb: TEXT_MUTED } }, alignment: { horizontal: 'left', vertical: 'center' } } })
        ws['!rows'][24] = { hpx: 20 }

        // ───────── R26: subtitle chitanță ─────────
        setCell(ws, 'A26', { v: 'Diferența de restituit s-a depus cu chitanța nr.______ din______', t: 's', s: styleItalicNote })
        merge(ws, 'A26', 'H26')
        ws['!rows'][25] = { hpx: 14 }

        // ───────── R27: note bancă ─────────
        setCell(ws, 'A27', { v: '* sume virate prin bancă, în contul de salarii', t: 's', s: { font: { name: 'Calibri', sz: 8, italic: true, color: { rgb: TEXT_MUTED } }, alignment: { horizontal: 'left', vertical: 'center' } } })
        merge(ws, 'A27', 'H27')
        ws['!rows'][26] = { hpx: 12 }

        // ───────── R28: gol ─────────
        ws['!rows'][27] = { hpx: 6 }

        // ───────── R29: banda SEMNĂTURI ─────────
        setCell(ws, 'A29', { v: '  SEMNĂTURI ȘI APROBĂRI', t: 's', s: styleBanner })
        merge(ws, 'A29', 'H29')
        ws['!rows'][28] = { hpx: 22 }

        // ───────── R30: sub-headere 4 coloane ─────────
        setCell(ws, 'A30', { v: 'SE APROBĂ', t: 's', s: styleSubHeader })
        merge(ws, 'A30', 'B30')
        setCell(ws, 'C30', { v: 'CONTROL FIN.', t: 's', s: styleSubHeader })
        merge(ws, 'C30', 'D30')
        setCell(ws, 'E30', { v: 'VERIFICAT', t: 's', s: styleSubHeader })
        merge(ws, 'E30', 'F30')
        setCell(ws, 'G30', { v: 'TITULAR', t: 's', s: styleSubHeader })
        merge(ws, 'G30', 'H30')
        ws['!rows'][29] = { hpx: 18 }

        // ───────── R31: sub-roluri ─────────
        const roles = [['A', 'B', 'Conducător unitate'], ['C', 'D', 'Preventiv'], ['E', 'F', 'Decont'], ['G', 'H', 'Avans']]
        for (const [c1, c2, role] of roles) {
          setCell(ws, `${c1}31`, { v: role, t: 's', s: styleSubHeaderRole })
          merge(ws, `${c1}31`, `${c2}31`)
        }
        ws['!rows'][30] = { hpx: 14 }

        // ───────── R32: spațiu semnătură ─────────
        ws['!rows'][31] = { hpx: 18 }

        // ───────── R33: NUMELE semnatari ─────────
        const numeAng = emp.name
        const semnatari = [
          ['A', 'B', setari.director_aproba || 'Trusu Razvan'],
          ['C', 'D', setari.control_preventiv || 'Tudorache Marilena'],
          ['E', 'F', setari.verificat_decont || 'Mirela Popescu'],
          ['G', 'H', numeAng],
        ]
        for (const [c1, c2, nm] of semnatari) {
          setCell(ws, `${c1}33`, { v: nm, t: 's', s: styleSignature })
          merge(ws, `${c1}33`, `${c2}33`)
        }
        ws['!rows'][32] = { hpx: 20 }

        // ───────── R34: gol ─────────
        ws['!rows'][33] = { hpx: 6 }

        // ───────── R35: banda companie ─────────
        setCell(ws, 'A35', { v: `   ${denumireSocietate}   •   ${nrRegCom}   •   CUI: ${cui}`, t: 's', s: styleCompanyBanner })
        merge(ws, 'A35', 'H35')
        ws['!rows'][34] = { hpx: 20 }

        // ═══════════════════════════════════════════════════
        // PARTEA 2 — SITUAȚIE PREZENȚĂ ZILNICĂ (PAGINA 2)
        // ═══════════════════════════════════════════════════

        // ───────── R36: gol ─────────
        ws['!rows'][35] = { hpx: 12 }

        // ───────── R37: titlu mare ─────────
        setCell(ws, 'A37', { v: 'SITUAȚIE PREZENȚĂ ZILNICĂ', t: 's', s: styleSitTitle })
        merge(ws, 'A37', 'H37')
        ws['!rows'][36] = { hpx: 24 }

        // ───────── R38: sub-titlu cu detalii angajat ─────────
        const functieAng = emp.functie || '—'
        setCell(ws, 'A38', { v: `Angajat: ${numeAng}   •   Funcția: ${functieAng}   •   Perioada: ${periodStartFmt} – ${periodEndFmt}`, t: 's', s: styleItalicNote })
        merge(ws, 'A38', 'H38')
        ws['!rows'][37] = { hpx: 16 }

        // ───────── R39: gol ─────────
        ws['!rows'][38] = { hpx: 6 }

        // ───────── R40: HEADER tabel zile ─────────
        setCell(ws, 'A40', { v: 'Nr. zi', t: 's', s: styleSubHeader })
        setCell(ws, 'B40', { v: 'Data', t: 's', s: styleSubHeader })
        setCell(ws, 'C40', { v: 'Șantier', t: 's', s: styleSubHeader })
        merge(ws, 'C40', 'F40')
        setCell(ws, 'G40', { v: 'Observații', t: 's', s: styleSubHeader })
        merge(ws, 'G40', 'H40')
        ws['!rows'][39] = { hpx: 18 }

        // ───────── R41+: rânduri zile ─────────
        const startRow = 41
        allDays.forEach((day, i) => {
          const r = startRow + i
          const isOff = day.santier === null
          setCell(ws, `A${r}`, { v: day.nr, t: 'n', s: styleDayCell(isOff) })
          setCell(ws, `B${r}`, { v: day.data, t: 's', s: styleDayCell(isOff) })
          setCell(ws, `C${r}`, { v: isOff ? '—' : day.santier, t: 's', s: styleDaySite(isOff) })
          merge(ws, `C${r}`, `F${r}`)
          setCell(ws, `G${r}`, { v: '', t: 's', s: styleDayObs(isOff) })
          merge(ws, `G${r}`, `H${r}`)
          ws['!rows'][r - 1] = { hpx: 16 }
        })

        // ───────── Total zile cu FORMULĂ ─────────
        const totalRow = startRow + allDays.length
        const endZileRow = startRow + allDays.length - 1
        setCell(ws, `A${totalRow}`, { v: 'TOTAL ZILE LUCRATE:', t: 's', s: { ...styleTotalLabelHighlight, alignment: { horizontal: 'right', vertical: 'center', indent: 1 } } })
        merge(ws, `A${totalRow}`, `F${totalRow}`)
        // Formula: numără șantierele reale (exclude "—")
        setCell(ws, `G${totalRow}`, {
          f: `COUNTA(C${startRow}:C${endZileRow})-COUNTIF(C${startRow}:C${endZileRow},"—")`,
          t: 'n',
          s: {
            fill: { fgColor: { rgb: BLUE_LIGHT } },
            font: { name: 'Calibri', sz: 12, bold: true, color: { rgb: BLUE_DARK } },
            alignment: { horizontal: 'center', vertical: 'center' },
            border: tb,
          }
        })
        merge(ws, `G${totalRow}`, `H${totalRow}`)
        ws['!rows'][totalRow - 1] = { hpx: 22 }

        // ───────── Set !ref ca SheetJS să cunoască range-ul ─────────
        ws['!ref'] = `A1:H${totalRow}`

        // ───────── Page break ÎNAINTE de R36 (după R35) ─────────
        ws['!rowBreaks'] = [{ id: 35, manual: 1 }]

        // ───────── Page setup ─────────
        // IMPORTANT: scale FIX 80% (nu fitToPage — Excel real îl ignoră deseori).
        // Scale + lățimi optime garantează 2 pagini A4 portrait la orice client.
        ws['!pageSetup'] = {
          orientation: 'portrait',
          paperSize: 9,    // A4
          scale: 80,
          fitToWidth: 0,
          fitToHeight: 0,
        }
        ws['!margins'] = { left: 0.3, right: 0.3, top: 0.3, bottom: 0.3, header: 0.1, footer: 0.1 }
        ws['!printOptions'] = { horizontalCentered: true }

        // ───────── Build workbook + add to ZIP ─────────
        const wb = XLSX.utils.book_new()
        const cleanName = emp.name.replace(/[\\/?*\[\]:]/g, '').slice(0, 31).trim() || 'Ordin'
        XLSX.utils.book_append_sheet(wb, ws, cleanName)

        const wbArr = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true })
        const safeName = emp.name.replace(/[^a-zA-Z0-9_\-]/g, '_')
        const filename = `Ordin_Deplasare_${safeName}_${ordGenPayment.period_from}_${ordGenPayment.period_to}.xlsx`
        zip.file(filename, wbArr)

        setOrdGenProgress({ done: idx + 1, total: selected.length })
      }

      // ───────── Generate ZIP blob + download ─────────
      const zipBlob = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(zipBlob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Ordine_Deplasare_${ordGenPayment.period_from}_${ordGenPayment.period_to}.zip`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      playBeep(920, 0.12); setTimeout(() => playBeep(1100, 0.12), 130)
      showToast(`✅ ${selected.length} ordine generate în ZIP`)
      setShowOrdGen(false)
      setOrdGenEmps([])
      setOrdGenPayment(null)
    } catch (e) {
      console.error('generateOrdine err:', e)
      showToast('Eroare la generare: ' + (e?.message || e), 'error')
    } finally {
      setOrdGenerating(false)
      setOrdGenProgress({ done: 0, total: 0 })
    }
  }

    const getRange=()=>{ const [y,m]=month.split('-').map(Number); const days=new Date(y,m,0).getDate(); const mm=String(m).padStart(2,'0'); const dd=String(days).padStart(2,'0'); return {y,m,from:`${y}-${mm}-01`,to:`${y}-${mm}-${dd}`,days} }

  const loadReport=async()=>{
    setLoad(true)
    const {y,m,from,to,days}=getRange()
    
    // 1. Fetch TOATE pontaj_records în perioada (paginat) — INVERSARE LOGICĂ
    // Înainte: fetch active emps → fetch records pentru ei. Excludea angajații dezactivați
    // după ce lucraseră în luna respectivă (raport istoric incomplet).
    // Acum: fetch records → găsesc TOATE employee_id implicate → fetch employees (active + cei cu records)
    let recs = []
    let off = 0
    while (true) {
      const { data: page } = await supabase.from('pontaj_records').select('*').gte('date',from).lte('date',to).range(off, off+999)
      if (!page || page.length === 0) break
      recs.push(...page)
      if (page.length < 1000) break
      off += 1000
      if (off > 200000) break
    }
    
    // 2. Determină ID-uri distincte care au records în perioada (inclusiv inactivi)
    const recEmpIds = [...new Set(recs.map(r=>r.employee_id))].filter(Boolean)
    
    // 3. Fetch employees: cei activi + cei cu records (chiar dacă acum inactivi)
    let eq=supabase.from('employees').select('*,sites(name)').order('name')
    if (recEmpIds.length > 0) {
      // OR logic: includ toți active=true SAU cei cu records în perioadă
      eq = eq.or(`active.eq.true,id.in.(${recEmpIds.join(',')})`)
    } else {
      eq = eq.eq('active', true)
    }
    if (!isAdmin){
      const siteIds=profile?.site_ids||[]
      if(siteIds.length>0) eq=eq.in('site_id',siteIds)
    }
    if (deptF!=='Toate'&&isAdmin) eq=eq.eq('department',deptF)
    if (siteF!=='Toate'&&isAdmin) eq=eq.eq('site_id',siteF)
    const {data:emps}=await eq; if(!emps){setLoad(false);return}
    
    // 4. Filtrez records pe IDs din emps (pentru cazul când site/dept filter exclude unii)
    const empIdsSet = new Set(emps.map(e=>e.id))
    const filteredRecs = recs.filter(r => empIdsSet.has(r.employee_id))
    
    const stats=emps.map(emp=>{
      const er=(filteredRecs||[]).filter(r=>r.employee_id===emp.id)
      const workDays=er.filter(r=>r.check_in&&!r.norma).length
      const totalMins=er.reduce((s,r)=>s+netMins(r.check_in,r.check_out,r.lunch_break!==false),0)
      const totalGross=er.reduce((s,r)=>s+diffMins(r.check_in,r.check_out),0)
      const lunchDays=er.filter(r=>r.lunch_break!==false&&spansLunch(r.check_in,r.check_out)).length
      const diurnaDays=er.filter(r=>r.diurna).length
      const norme={}; er.forEach(r=>{if(r.norma)norme[r.norma]=(norme[r.norma]||0)+1})
      return {...emp,workDays,totalMins,totalGross,lunchDays,diurnaDays,norme,avgMins:workDays>0?Math.round(totalMins/workDays):0,days,records:er}
    }).sort((a,b)=>a.name.localeCompare(b.name))
    setData(stats)
    setDetailed((filteredRecs||[]).map(r=>{const e=emps.find(x=>x.id===r.employee_id);return {...r,empName:e?.name||'?',empDept:e?.department||'',empPos:e?.position||'',empSite:e?.sites?.name||''}}).sort((a,b)=>a.date.localeCompare(b.date)||a.empName.localeCompare(b.empName)))
    setLoad(false)
  }

  // ── Import Pontaj ──────────────────────────────────────────────────────────
  const dlImportTemplate=async()=>{
    const {y,m,days}=getRange()
    const mName=new Date(y,m-1).toLocaleString('ro-RO',{month:'long',year:'numeric'})
    const dayAbbr=['D','L','Ma','Mi','J','V','S']
    const wb=XLSX.utils.book_new()
    const dayNums=Array.from({length:days},(_,i)=>i+1)
    // Load holidays for this month
    const {data:calData}=await supabase.from('calendar_days').select('date').gte('date',`${y}-${String(m).padStart(2,'0')}-01`).lte('date',`${y}-${String(m).padStart(2,'0')}-${String(days).padStart(2,'0')}`)
    const legalSet=new Set((calData||[]).map(c=>c.date))
    const isOff=(d)=>{ const dt=new Date(y,m-1,d); return dt.getDay()===0||dt.getDay()===6||legalSet.has(`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`)}
    const bd={top:{style:'thin',color:{rgb:'000000'}},bottom:{style:'thin',color:{rgb:'000000'}},left:{style:'thin',color:{rgb:'000000'}},right:{style:'thin',color:{rgb:'000000'}}}
    const sc=(ws,r,c,v,s)=>{ const a=XLSX.utils.encode_cell({r,c}); ws[a]={v,t:typeof v==='number'?'n':'s',s} }
    const R=[]
    // Antet identic cu ITM
    R.push(['S.C. GAZPET INSTAL S.R.L.','','','Str. Fluturilor, nr.34, Loc.Ploiesti, Jud.Prahova'])
    R.push(['RO 22029920; J2007001650296','','','Tel./Fax 0244/435005  office@gazpet.ro'])
    R.push([])
    R.push([`FOAIE COLECTIVĂ DE PREZENȚĂ — ${mName.toUpperCase()}`])
    R.push([])
    // Header row (row 5)
    const HDR=['NUME ȘI PRENUME SALARIAT','FUNCȚIA','PROGRAM DE LUCRU',...dayNums,'TOTAL ZILE','TOTAL ORE']
    R.push(HDR)
    // Day abbr row (row 6)
    const DNR=['','','',...dayNums.map(d=>dayAbbr[new Date(y,m-1,d).getDay()]),'','']
    R.push(DNR)
    // Employee rows — pre-completate cu 08:00/17:00 pe zile lucratoare
    data.forEach(emp=>{
      let tz=0, toMins=0
      const rCI=[emp.name, emp.position||'', 'Ora Intrare']
      const rCO=['','','Ora Ieșire']
      const rPM=['','','Pauza de Masă (ore)']
      const rOL=['','','Ore Lucrate']
      for(let d=1;d<=days;d++){
        if(isOff(d)){ rCI.push(''); rCO.push(''); rPM.push(''); rOL.push('') }
        else { rCI.push('08:00'); rCO.push('17:00'); rPM.push(1); rOL.push(8); tz++; toMins+=8*60 }
      }
      rCI.push(tz, +(toMins/60).toFixed(1))
      rCO.push('',''); rPM.push('',''); rOL.push('','')
      R.push(rCI,rCO,rPM,rOL,[])
    })
    const ws=XLSX.utils.aoa_to_sheet(R)
    ws['!cols']=[{wch:28},{wch:18},{wch:22},...dayNums.map(()=>({wch:6})),{wch:11},{wch:11}]
    // Style header row 5
    HDR.forEach((_,c)=>sc(ws,5,c,'',{fill:{fgColor:{rgb:'1F497D'}},font:{bold:true,color:{rgb:'FFFFFF'},sz:10},border:bd,alignment:{horizontal:c<3?'left':'center'}}))
    // Style day abbr row 6
    DNR.forEach((v,c)=>{
      if(c<3) return
      const d=c-2; const dt=new Date(y,m-1,d)
      const isWE=dt.getDay()===0||dt.getDay()===6
      const isLeg=legalSet.has(`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`)
      sc(ws,6,c,v,{fill:{fgColor:{rgb:isWE?'BFBFBF':isLeg?'FF8888':'4472C4'}},font:{bold:true,color:{rgb:'FFFFFF'},sz:9},border:bd,alignment:{horizontal:'center'}})
    })
    XLSX.utils.book_append_sheet(wb,ws,`Pontaj ${mName}`)
    XLSX.writeFile(wb,`Template_Pontaj_${mName.replace(' ','_')}.xlsx`)
    showToast('✓ Template ITM descărcat — pre-completat 08:00-17:00!')
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

  // ─── EXPORT PONTAJ BRUT (fost Export ITM) — cu coloană Ore Suplimentare + Istoric ─────
  // Acces gate-uit: doar Owner sau utilizatori cu can_access_pontaj_brut
  // După export: salvează xlsx în Storage (pontaj-brut-istoric) + INSERT în pontaj_brut_istoric
  const exportPontajBrut=async()=>{
    if (!data.length){showToast('Fără date','warn');return}
    if (!hasPontajBrutAccess) { showToast('Acces refuzat — necesită bifa „Pontaj Brut" pe profil','error'); return }
    setExpPontajBrut(true)
    try {
      const {y,m,days}=getRange()
      const mName=new Date(y,m-1).toLocaleString('ro-RO',{month:'long',year:'numeric'})
      const wb=XLSX.utils.book_new()
      const dayNums=Array.from({length:days},(_,i)=>i+1)
      const dayAbbr=['D','L','Ma','Mi','J','V','S']
      const FIXED=3 // Col A=Nume, B=Functia, C=Program de Lucru

      // Load holidays (cu type ca să distingem legal vs holiday firmă)
      const {data:calData}=await supabase.from('calendar_days').select('date,type').gte('date',`${y}-${String(m).padStart(2,'0')}-01`).lte('date',`${y}-${String(m).padStart(2,'0')}-${String(days).padStart(2,'0')}`)
      const legalSet=new Set((calData||[]).filter(c=>c.type==='legal').map(c=>c.date))

      // Zile lucrătoare lună = Mon-Fri minus sărbători legale (consistent cu AdminPage)
      let workDaysInMonth=0
      for(let d=1;d<=days;d++){
        const dt=new Date(y,m-1,d)
        const ds=`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`
        if(dt.getDay()!==0 && dt.getDay()!==6 && !legalSet.has(ds)) workDaysInMonth++
      }

      const isOff=(d)=>{ const dt=new Date(y,m-1,d); return {we:dt.getDay()===0||dt.getDay()===6, leg:legalSet.has(`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`)} }

      // Coloane dinamice (lățimea depinde de numărul de zile ale lunii)
      const TOTAL_ZILE_C = FIXED + days        // ex Apr(30): col 33=AH; Mai(31): col 34=AI
      const TOTAL_ORE_C  = FIXED + days + 1    // ex Apr: col 34=AI; Mai: col 35=AJ
      const ORE_SUPL_C   = FIXED + days + 2    // ex Apr: col 35=AJ; Mai: col 36=AK
      const WD_LABEL_C   = FIXED + days + 3    // etichetă „Zile lucr. lună:"
      const WD_VALUE_C   = FIXED + days + 4    // valoarea numerică (folosită în formulă)
      const totalOreColLetter = XLSX.utils.encode_col(TOTAL_ORE_C)
      const wdValueColLetter  = XLSX.utils.encode_col(WD_VALUE_C)

      // ── Build rows ──
      const R=[]
      // Antet firmă
      R.push(['S.C. GAZPET INSTAL S.R.L.','','','Str. Fluturilor, nr.34, Loc.Ploiesti, Jud.Prahova'])
      R.push(['RO 22029920; J2007001650296','','','Tel./Fax 0244/435005  office@gazpet.ro'])
      R.push([])
      // Rândul 4 (idx 3): titlu + zile lucr. lună la dreapta (etichetă + valoare)
      const titleRow = [`FOAIE COLECTIVĂ DE PREZENȚĂ — ${mName.toUpperCase()}`]
      while (titleRow.length < WD_LABEL_C) titleRow.push('')
      titleRow.push('Zile lucr. lună:')   // WD_LABEL_C — etichetă
      titleRow.push(workDaysInMonth)       // WD_VALUE_C — valoarea (numeric pentru formulă)
      R.push(titleRow)
      R.push([])
      // Header row (idx 5)
      const HDR=['NUME ȘI PRENUME SALARIAT','FUNCȚIA','PROGRAM DE LUCRU',...dayNums,'TOTAL ZILE','TOTAL ORE','ORE SUPLIMENTARE']
      R.push(HDR)
      // Day names row (idx 6)
      const DNR=['','','',...dayNums.map(d=>dayAbbr[new Date(y,m-1,d).getDay()]),'','','']
      R.push(DNR)

      // Tracking metadata pentru istoric BD
      let totalOreLunarSum = 0
      let totalOreSuplSum  = 0

      // Employee rows (5 rânduri per angajat: 4 date + 1 separator)
      data.forEach((emp, empIdx)=>{
        // Excel row number (1-indexed) pentru primul rând al acestui angajat (Ora Intrare)
        // Rândurile 1-7 sunt antet, deci primul angajat începe la rând 8
        const excelRow = 8 + empIdx * 5

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
            rCI.push(rec.norma); rCO.push(''); rPM.push(''); rOL.push('')
          } else if(rec?.check_in){
            const hp=spansLunch(rec.check_in,rec.check_out)&&rec.lunch_break!==false
            const mins=netMins(rec.check_in,rec.check_out,rec.lunch_break!==false)
            rCI.push(fmt24(rec.check_in)); rCO.push(rec.check_out?fmt24(rec.check_out):'')
            rPM.push(hp?1:''); rOL.push(+(mins/60).toFixed(1))
            tz++; to+=mins
          } else if(we||leg){
            rCI.push(''); rCO.push(''); rPM.push(''); rOL.push(leg?'SL':'')
          } else {
            rCI.push(''); rCO.push(''); rPM.push(''); rOL.push('')
          }
        }
        const empOreLunar = +(to/60).toFixed(1)
        const empOreSupl  = Math.max(0, empOreLunar - workDaysInMonth*8)
        totalOreLunarSum += empOreLunar
        totalOreSuplSum  += empOreSupl

        rCI.push(tz, empOreLunar)
        // ORE SUPLIMENTARE — formula Excel pe primul rând (Ora Intrare)
        // = MAX(0, TotalOre{row} - WdValue$4 * 8) — referință absolută pe rând 4 pentru zile lucr.
        rCI.push({ f: `MAX(0, ${totalOreColLetter}${excelRow} - ${wdValueColLetter}$4*8)`, t: 'n' })

        rCO.push('','',''); rPM.push('','',''); rOL.push('','','')
        R.push(rCI,rCO,rPM,rOL,[])
      })

      const ws=XLSX.utils.aoa_to_sheet(R)
      // Lățimi: A,B,C + zile + TOTAL ZILE + TOTAL ORE + ORE SUPL (216px = ~30 char) + label + value
      ws['!cols']=[
        {wch:26},{wch:16},{wch:22},
        ...dayNums.map(()=>({wch:5.5})),
        {wch:11},                  // TOTAL ZILE
        {wch:11},                  // TOTAL ORE
        {wch:30},                  // ORE SUPLIMENTARE (216px ≈ 30 char)
        {wch:18},                  // 'Zile lucr. lună:' label
        {wch:11}                   // valoare zile lucr.
      ]

      // ── Stilizare ──
      const bd={top:{style:'thin',color:{rgb:'000000'}},bottom:{style:'thin',color:{rgb:'000000'}},left:{style:'thin',color:{rgb:'000000'}},right:{style:'thin',color:{rgb:'000000'}}}
      const sc=(r,c,s)=>{ const a=XLSX.utils.encode_cell({r,c}); if(!ws[a]) ws[a]={v:'',t:'s'}; ws[a].s=s }
      const alC={horizontal:'center',vertical:'center'}
      const alL={horizontal:'left',vertical:'center'}

      // Title row (idx 3) — etichetă „Zile lucr. lună:" + valoare la dreapta
      sc(3, WD_LABEL_C, {fill:{fgColor:{rgb:'1F497D'}}, font:{bold:true,color:{rgb:'FFFFFF'},sz:10}, border:bd, alignment:{horizontal:'right',vertical:'center'}})
      sc(3, WD_VALUE_C, {fill:{fgColor:{rgb:'FFE699'}}, font:{bold:true,sz:11,color:{rgb:'7F6000'}}, border:bd, alignment:alC})

      // Header row (5) — 'TOTAL ZILE', 'TOTAL ORE', 'ORE SUPLIMENTARE'
      HDR.forEach((v,c)=> sc(5,c,{fill:{fgColor:{rgb:'1F497D'}},font:{bold:true,color:{rgb:'FFFFFF'},sz:10},border:bd,alignment:c<3?alL:alC}))

      // Day names row (6) — inclusiv sub-header pentru ORE SUPL (#4472C4 ca specs)
      DNR.forEach((v,c)=>{
        const isDayCol = c >= 3 && c < 3+days
        const isWE = isDayCol && (()=>{const d=c-2;const dt=new Date(y,m-1,d);return dt.getDay()===0||dt.getDay()===6})()
        const isLeg = isDayCol && legalSet.has(`${y}-${String(m).padStart(2,'0')}-${String(c-2).padStart(2,'0')}`)
        let rgb = '4472C4'
        if (isWE) rgb = 'BFBFBF'
        else if (isLeg) rgb = 'FF8888'
        sc(6,c,{fill:{fgColor:{rgb}},font:{bold:true,color:{rgb:'FFFFFF'},sz:9},border:bd,alignment:alC})
      })

      // Employee rows starting at idx 7 (Excel rândul 8)
      let ri=7
      data.forEach(emp=>{
        for(let ro=0;ro<4;ro++){
          const TOTAL_C = FIXED + days + 3  // include ORE SUPL
          for(let c=0;c<TOTAL_C;c++){
            let s={}
            if(c===0){
              s=ro===0?{fill:{fgColor:{rgb:'E2EFDA'}},font:{bold:true,sz:10},border:bd,alignment:alL}:{fill:{fgColor:{rgb:'F5F5F5'}},border:bd,alignment:alL}
            } else if(c===1){
              s=ro===0?{fill:{fgColor:{rgb:'E2EFDA'}},border:bd,alignment:alL}:{fill:{fgColor:{rgb:'F5F5F5'}},border:bd}
            } else if(c===2){
              s={fill:{fgColor:{rgb:'D6E4F0'}},font:{bold:true,sz:8},border:bd,alignment:alL}
            } else if(c>=3 && c<3+days){
              const d=c-2
              const ds=`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`
              const {we,leg}=isOff(d)
              const rec=emp.records?.find(r=>r.date===ds)
              const hasWork=rec?.check_in&&!rec?.norma
              const hasNorma=rec?.norma
              let rgb=null
              if(hasWork&&(we||leg)) rgb='FFC000'
              else if(hasNorma) rgb='FFFF00'
              else if(we) rgb='C0C0C0'
              else if(leg) rgb='FFAAAA'
              s={...(rgb?{fill:{fgColor:{rgb}}}:{}),border:bd,alignment:alC,font:{sz:9}}
            } else if(c === ORE_SUPL_C) {
              // ORE SUPLIMENTARE — stil per specs Razvan
              // ro=0 (Ora Intrare = rândul principal): bold #D9E1F2 centrat font 11
              // ro=1-3 (sub-rânduri): #F5F5F5 font 9 centrat
              s = ro===0
                ? {fill:{fgColor:{rgb:'D9E1F2'}}, font:{bold:true,sz:11,color:{rgb:'1F497D'}}, border:bd, alignment:alC}
                : {fill:{fgColor:{rgb:'F5F5F5'}}, font:{sz:9}, border:bd, alignment:alC}
            } else {
              s={fill:{fgColor:{rgb:ro===0?'D9E1F2':'F5F5F5'}},font:ro===0?{bold:true}:{sz:9},border:bd,alignment:alC}
            }
            sc(ri+ro,c,s)
          }
        }
        ri+=5
      })

      XLSX.utils.book_append_sheet(wb,ws,'Pontaj Brut')

      // ── Write + Download + Upload Storage + INSERT istoric ──
      const wbArr = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true })
      const blob = new Blob([wbArr], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const filename = `Pontaj_Brut_${mName.replace(' ','_').replace(/\s/g,'_')}.xlsx`

      // Download local
      const localUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = localUrl; a.download = filename
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      URL.revokeObjectURL(localUrl)

      // Upload Storage + INSERT istoric (non-blocking pentru download)
      const storagePath = `${y}/${String(m).padStart(2,'0')}/${Date.now()}_${filename}`
      try {
        const { error: upErr } = await supabase.storage.from('pontaj-brut-istoric').upload(storagePath, blob, {
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          upsert: false
        })
        if (upErr) {
          showToast('⚠ Excel descărcat, dar istoric nu a fost salvat în Storage: ' + upErr.message, 'warn')
        } else {
          const { error: insErr } = await supabase.from('pontaj_brut_istoric').insert({
            period_year: y,
            period_month: m,
            work_days_in_month: workDaysInMonth,
            total_employees: data.length,
            total_ore_lunar: +totalOreLunarSum.toFixed(2),
            total_ore_supl: +totalOreSuplSum.toFixed(2),
            exported_by: profile?.id,
            exported_by_name: profile?.name || profile?.email,
            filename, storage_path: storagePath
          })
          if (insErr) showToast('⚠ Fișier salvat dar metadata istoric a eșuat: ' + insErr.message, 'warn')
        }
      } catch (e) {
        showToast('⚠ Eroare salvare istoric (fișierul s-a descărcat OK): ' + (e?.message||e), 'warn')
      }

      playBeep(660,0.15)
      showToast(`✓ Pontaj Brut — ${data.length} ang. · ${workDaysInMonth} zile lucr. · ${totalOreSuplSum.toFixed(1)}h supl.`)
    } catch(e){ showToast('Eroare: '+e.message,'error'); console.error(e) }
    finally{ setExpPontajBrut(false) }
  }

  const exportDiurne=async()=>{
    if(!df||!dt){showToast('Selectează perioada','warn');return}
    setExpD(true)
    try{
    // TKT-2026-0110 (Marilena, 10.08.2026): cine a avut încetare în cursul lunii
    // dispărea DEFINITIV din export — nu doar zilele lui de diurnă, ci rândul întreg.
    // Din exportul ăsta se întocmesc ordinele de deplasare și se împart diurnele pe
    // lucrări, deci omul trebuie să rămână în listă până se închide luna, cu zilele
    // lucrate și cu 0 în dreptul zilelor de după încetare.
    // Se includ deci și inactivii cu încetare în luna exportată.
    const dLuna=new Date(dt)
    const lunaStart=`${dLuna.getFullYear()}-${String(dLuna.getMonth()+1).padStart(2,'0')}-01`
    const lFin=new Date(lunaStart); lFin.setMonth(lFin.getMonth()+1); lFin.setDate(0)
    const lunaEnd=lFin.toISOString().split('T')[0]

    // Criteriul e „încetare DE LA începutul lunii exportate încolo", nu „încetare
    // ÎN luna exportată": cine a plecat pe 7 august a lucrat tot iulie, iar la
    // exportul pe iulie trebuie să apară. Un filtru pe luna exportată l-ar sări.
    let eq=supabase.from('employees').select('*').order('name')
      .or(`active.eq.true,termination_date.gte.${lunaStart}`)
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
    // Paginare manuală
    let allRecs = []
    { let off=0; while(true){ const {data:p}=await supabase.from('pontaj_records').select('*,sites(name)').gte('date',monthStart).lte('date',monthEnd).in('employee_id',(emps||[]).map(e=>e.id)).range(off,off+999); if(!p||p.length===0)break; allRecs.push(...p); if(p.length<1000)break; off+=1000; if(off>200000)break } }

    // Transe anterioare din aceeași lună — pentru calculul surplusului deja plătit
    // Luăm toate plățile cu period_from în aceeași lună ȘI period_to < df (perioadele deja finalizate)
    const {data:prevPaymentsInMonth}=await supabase.from('diurna_payments').select('*,diurna_payment_details(employee_id,amount)').gte('period_from',monthStart).lt('period_to',df).order('period_from',{ascending:true})

    // Get diurna records for the export period only
    // Paginare manuală
    let diurnaRecs = []
    { let off=0; while(true){ const {data:p}=await supabase.from('pontaj_records').select('*,sites(name)').eq('diurna',true).gte('date',df).lte('date',dt).in('employee_id',(emps||[]).map(e=>e.id)).range(off,off+999); if(!p||p.length===0)break; diurnaRecs.push(...p); if(p.length<1000)break; off+=1000; if(off>200000)break } }

    // Build per-employee stats
    const empStats=(emps||[]).map(emp=>{
      const er=(diurnaRecs||[]).filter(r=>r.employee_id===emp.id)
      // Angajatul cu încetare în luna exportată rămâne în listă chiar dacă în
      // tranșa asta are zero zile — apare cu 0, ca să poată fi întocmit ordinul
      // de deplasare și împărțită diurna pe lucrări până la închiderea lunii.
      const incetatInLuna=!emp.active && emp.termination_date && emp.termination_date>=monthStart
      if(!er.length && !incetatInLuna) return null

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
      let sites=Object.entries(siteMap).map(([name,zile])=>({name,zile,val:zile*diurnaAmt}))
      // Fără nicio zi în tranșă (încetare înainte de începutul perioadei) — un rând
      // cu 0, ca omul să nu dispară din listă până la închiderea lunii.
      if(!sites.length) sites=[{name:'Nealocate',zile:0,val:0}]
      const p=emp.name.split(' ')
      // Rândul de încetare fără zile: toate cifrele pe 0 — inclusiv „Diurnă Max.
      // Admisă", altfel ar arăta un plafon disponibil pentru cineva care a plecat.
      const faraZile=diurnaReala===0&&incetatInLuna
      return {nume:p[0],prenume:p.slice(1).join(' '),sites,totalZile:diurnaReala,totalVal:diurnaReala*diurnaAmt,
              diurnaMax:faraZile?0:diurnaMax,
              normeCumulate,zilePlatiteAnterior,pesteLimita,pesteCumulat,depasesteLunar,bugetLunar,platitAnteriorSuma,sumaAcestExport,restBuget,restDePlata,
              incetatLa:incetatInLuna?emp.termination_date:null}
    }).filter(Boolean).sort((a,b)=>{
      const n=(a.nume||'').localeCompare((b.nume||''),'ro')
      if(n!==0) return n
      return (a.prenume||'').localeCompare((b.prenume||''),'ro')
    })

    if(!empStats.length){showToast('Nu există diurne în perioadă','warn');setExpD(false);return}

    const from=new Date(df).toLocaleDateString('ro-RO'), to=new Date(dt).toLocaleDateString('ro-RO')
    const bd={top:{style:'thin',color:{rgb:'000000'}},bottom:{style:'thin',color:{rgb:'000000'}},left:{style:'thin',color:{rgb:'000000'}},right:{style:'thin',color:{rgb:'000000'}}}
    const HFILL='1F497D'; const TFILL='D9E1F2'; const GFILL='1F497D'; const WFILL='FFF2CC'
    const wb=XLSX.utils.book_new()
    const hdrCols=['Nr.','Nume','Prenume','Șantier','Zile Diurnă','Diurnă/zi (RON)','TOTAL RON','Diurnă Max. Admisă','Diurnă Peste Limită']

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

    const fmtInc=d=>d?new Date(d).toLocaleDateString('ro-RO'):''
    empStats.forEach(emp=>{
      const startRow=rowIdx
      emp.sites.forEach((site,si)=>{
        // Only show diurnaMax and pesteLimita on first row per employee
        wsData.push([
          si===0?nr:'',
          si===0?emp.nume:'',
          si===0?emp.prenume:'',
          // la rândul gol al unui angajat cu încetare, în loc de „Nealocate" se
          // scrie motivul — altfel un 0 fără explicație pare o greșeală de export
          (site.zile===0&&emp.incetatLa)?`Încetat ${fmtInc(emp.incetatLa)}`:site.name,
          site.zile,
          diurnaAmt,
          site.val,
          si===0?emp.diurnaMax:'',
          si===0?(emp.pesteLimita>0?emp.pesteLimita:(emp.incetatLa?0:'')):''
        ])
        siteRowIdxs.push({row:rowIdx,isAlt:si%2===1,hasPeste:si===0&&emp.pesteLimita>0})
        rowIdx++
      })
      // Total per angajat
      wsData.push(['','',`Total ${emp.nume} ${emp.prenume}${emp.incetatLa?` (încetat ${fmtInc(emp.incetatLa)})`:''}`,'',emp.totalZile,'',emp.totalVal,emp.diurnaMax,emp.pesteLimita>0?emp.pesteLimita:0])
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
    ws['!cols']=[{wch:5},{wch:30,wpx:225},{wch:24,wpx:180},{wch:30,wpx:225},{wch:12},{wch:14},{wch:12},{wch:18},{wch:18}]

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
    // Antet firmă: A1:B1 (nume firmă) și A2:B2 (CUI/Reg.Com.) — îmbinate pe 2 coloane
    ws['!merges'].push({s:{r:0,c:0},e:{r:0,c:1}})
    ws['!merges'].push({s:{r:1,c:0},e:{r:1,c:1}})
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
      const nh=['Nr.','Nume','Prenume','Buget lunar (RON)','Platit anterior (RON)','Rest buget (RON)','Suma acest export (RON)','PESTE BUGET (RON)','→ DE ADAUGAT IN SALARIU (RON)']
      nh.forEach((h,c)=>{const a=XLSX.utils.encode_cell({r:nr2,c});ws[a]={v:h,t:'s'};ws[a].s={fill:{fgColor:{rgb:'843C0C'}},font:{bold:true,sz:10,color:{rgb:'FFFFFF'}},border:bd,alignment:{horizontal:'center',vertical:'center',wrapText:true}}})
      nr2++

      // Randuri angajati
      angajatiPeste.forEach((emp,i)=>{
        const row=[i+1,emp.nume,emp.prenume,emp.bugetLunar,emp.platitAnteriorSuma,emp.restBuget,emp.sumaAcestExport,emp.pesteCumulat,emp.restDePlata]
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
      // Paginare manuală
      let recs = []
      { let off=0; while(true){ const {data:p}=await supabase.from('pontaj_records').select('*').eq('diurna',true).gte('date',df).lte('date',dt).in('employee_id',(emps||[]).map(e=>e.id)).range(off,off+999); if(!p||p.length===0)break; recs.push(...p); if(p.length<1000)break; off+=1000; if(off>200000)break } }
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
    if (!hasPontajBrutAccess) { showToast('Acces refuzat — necesită bifa „Pontaj Brut" pe profil','error'); return }
    setExpS(true)
    try{
    let eq=supabase.from('employees').select('*').eq('active',true).order('name')
    if(!isAdmin){const siteIds=profile?.site_ids||[];if(siteIds.length>0)eq=eq.in('site_id',siteIds)}
    const {data:emps}=await eq
    // Paginare manuală
    let recs = []
    { let off=0; while(true){ const {data:p}=await supabase.from('pontaj_records').select('*').eq('meal_supplement',true).gte('date',sf).lte('date',st2).in('employee_id',(emps||[]).map(e=>e.id)).range(off,off+999); if(!p||p.length===0)break; recs.push(...p); if(p.length<1000)break; off+=1000; if(off>200000)break } }
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

    // Build blob + download local + upload Storage + INSERT istoric (consistent cu Pontaj Brut)
    const wbArr = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true })
    const blob = new Blob([wbArr], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const filename = `Supliment_Hrana_${from.replace(/\//g,'-')}_${to.replace(/\//g,'-')}.xlsx`
    
    // Download local
    const localUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = localUrl; a.download = filename
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    URL.revokeObjectURL(localUrl)
    
    // Upload Storage + INSERT istoric (non-blocking pentru download)
    const totalDays = empStats.reduce((s,e)=>s+e.zile, 0)
    const totalAmount = empStats.reduce((s,e)=>s+e.val, 0)
    const storagePath = `${sf.substring(0,7)}/${Date.now()}_${filename}`
    try {
      const { error: upErr } = await supabase.storage.from('supliment-hrana-istoric').upload(storagePath, blob, {
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        upsert: false
      })
      if (upErr) {
        showToast('⚠ Excel descărcat, Storage istoric a eșuat: ' + upErr.message, 'warn')
      } else {
        const { error: insErr } = await supabase.from('supliment_hrana_istoric').insert({
          period_from: sf, period_to: st2,
          total_employees: empStats.length,
          total_days: totalDays,
          total_amount: +totalAmount.toFixed(2),
          amount_per_day: suplAmt,
          exported_by: profile?.id,
          exported_by_name: profile?.name || profile?.email,
          filename, storage_path: storagePath
        })
        if (insErr) showToast('⚠ Fișier salvat dar metadata istoric a eșuat: ' + insErr.message, 'warn')
      }
    } catch (e) {
      showToast('⚠ Eroare salvare istoric (fișierul s-a descărcat OK)', 'warn')
    }
    
    playBeep(); showToast(`✓ ${empStats.length} angajați · ${totalDays} zile · ${totalAmount.toLocaleString('ro-RO')} RON`)
    }catch(e){showToast('Eroare la export supliment','error')}finally{setExpS(false)}
  }

  const mLabel=()=>{const [y,m]=month.split('-').map(Number);return new Date(y,m-1).toLocaleString('ro-RO',{month:'long',year:'numeric'})}

  return (
    <Layout>
      <Toast toast={toast}/>
      <MesajCompanieBox />
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
          {hasPontajBrutAccess && (
            <>
              <button onClick={()=>requireUnlockThen('brut')} disabled={expPontajBrut||load||!data.length} style={{...S.btnP,background:'#1A6B1A',fontSize:12,display:'flex',alignItems:'center',gap:5}} title="Foaie Colectivă de Prezență cu Ore Suplimentare — necesită parolă">{expPontajBrut?<><div className="sp"/>...</>:'📄 Export Pontaj Brut'}</button>
              <button onClick={()=>requireUnlockThen('brut-istoric')} disabled={load} style={{...S.btnS,fontSize:12,background:'#2A1A4A',color:'#BC8CFF',borderColor:G.purple+'66'}} title="Istoric exporturi Pontaj Brut (parolat)">📋 Istoric Pontaj Brut</button>
              <button onClick={()=>{setShowSelectBrutForNet(true); loadHistoricPB()}} disabled={load} style={{...S.btnP,background:'#1A4A6B',fontSize:12,display:'flex',alignItems:'center',gap:5}} title="Procesează un export Brut prin reguli de salarizare → Pontaj Net">🔄 Generează Pontaj Net</button>
              <button onClick={()=>setShowHistoricPN(true)} disabled={load} style={{...S.btnS,fontSize:12,background:'#1A2A4A',color:'#7FB3FF',borderColor:G.blue+'66'}} title="Istoric exporturi Pontaj Net (parolat)">📑 Istoric Pontaj Net</button>
            </>
          )}
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
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14,gap:8,flexWrap:'wrap'}}>
                    <div style={{fontSize:13,fontWeight:700}}>
                      {new Date(selectedPayment.period_from).toLocaleDateString('ro-RO')} — {new Date(selectedPayment.period_to).toLocaleDateString('ro-RO')}
                    </div>
                    <div style={{display:'flex',gap:6}}>
                      <button onClick={()=>reexportPayment(selectedPayment)} style={{...S.btnP,background:'#1A6B1A',fontSize:11,padding:'5px 12px'}}>⬇ Reexportă Excel</button>
                      <button onClick={()=>openOrdGen(selectedPayment)} style={{...S.btnP,background:G.orange,fontSize:11,padding:'5px 12px'}} title="Generează ordine de deplasare xlsx (1 per angajat) într-un ZIP">📄 Ordine Deplasare</button>
                    </div>
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

      {/* Istoric Ordine Deplasare modal - cu accordion pe luni + multi-select */}
      {showIstoricOrd && (() => {
        const filtered = istoricOrd.filter(r => {
          if (istoricOrdSearch) {
            const q = istoricOrdSearch.toLowerCase()
            if (!(r.employees?.name || '').toLowerCase().includes(q) 
                && !(r.pdf_nume || '').toLowerCase().includes(q)
                && !((r.numar_ordin || '').toLowerCase().includes(q))) return false
          }
          if (istoricOrdMonth) {
            const m = r.period_from?.substring(0,7)
            if (m !== istoricOrdMonth) return false
          }
          return true
        })
        // Grupare pe LUNĂ → în interior pe PERIOADĂ (Etapa 7.5 Faza 3.4)
        const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : ''
        const grouped = {}
        filtered.forEach(r => {
          const monthKey = r.period_from?.substring(0, 7) || 'unknown'
          if (!grouped[monthKey]) grouped[monthKey] = {
            monthKey,
            monthLabel: cap(new Date(monthKey + '-01T12:00').toLocaleDateString('ro-RO', { month: 'long', year: 'numeric' })),
            periodeGroups: {},
            totalOrders: 0,
            totalSum: 0,
            totalZile: 0,
            allIds: [],
          }
          const periodKey = `${r.period_from}__${r.period_to}`
          if (!grouped[monthKey].periodeGroups[periodKey]) {
            grouped[monthKey].periodeGroups[periodKey] = { period_from: r.period_from, period_to: r.period_to, items: [] }
          }
          grouped[monthKey].periodeGroups[periodKey].items.push(r)
          grouped[monthKey].totalOrders++
          grouped[monthKey].totalSum += Number(r.suma_totala || 0)
          grouped[monthKey].totalZile += Number(r.zile_lucrate || 0)
          grouped[monthKey].allIds.push(r.id)
        })
        const months = Object.values(grouped).sort((a, b) => b.monthKey.localeCompare(a.monthKey))
        const totalSelected = istoricOrdSelected.size
        const filteredIds = filtered.map(r => r.id)
        const allFilteredSelected = filteredIds.length > 0 && filteredIds.every(id => istoricOrdSelected.has(id))
        
        return (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.8)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
          <div style={{...S.card,width:1150,maxHeight:'90vh',display:'flex',flexDirection:'column',position:'relative'}}>
            <div style={{padding:'14px 18px',borderBottom:`1px solid ${G.border}`,display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,flexWrap:'wrap'}}>
              <div style={{fontSize:15,fontWeight:800,color:G.orange}}>📚 Istoric Ordine Deplasare</div>
              <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                <input type="text" placeholder="🔍 Caută angajat/nr ordin..." value={istoricOrdSearch} onChange={e=>setIstoricOrdSearch(e.target.value)} style={{...S.input,width:220,padding:'6px 10px',fontSize:12}}/>
                <input type="month" value={istoricOrdMonth} onChange={e=>setIstoricOrdMonth(e.target.value)} style={{...S.input,width:'auto',padding:'6px 10px',fontSize:12}} title="Filtru luna period_from"/>
                {(istoricOrdSearch||istoricOrdMonth)&&<button onClick={()=>{setIstoricOrdSearch('');setIstoricOrdMonth('')}} style={{...S.btnS,fontSize:11,padding:'5px 10px'}}>✕ Reset</button>}
                <button onClick={()=>setShowRegistruOrd(true)} style={{...S.btnP,background:G.blue,fontSize:12,padding:'6px 12px'}} title="Vezi registru contabil cu export Excel">📋 Registru</button>
                <button onClick={()=>{setShowIstoricOrd(false);setIstoricOrdSel(null);setIstoricOrdSelected(new Set())}} style={{background:'none',border:'none',color:G.muted,cursor:'pointer',fontSize:20}}>✕</button>
              </div>
            </div>
            <div style={{padding:'8px 18px',background:G.bg,borderBottom:`1px solid ${G.border}`,fontSize:11,color:G.muted,display:'flex',gap:14,alignItems:'center',flexWrap:'wrap'}}>
              <span>📊 {istoricOrd.length} total</span>
              <span>🔎 {filtered.length} afișate</span>
              <span>📅 {months.length} {months.length===1?'lună':'luni'}</span>
              {istoricOrdLoading && <span style={{color:G.blue}}>⏳ Se încarcă...</span>}
              {profile?.is_owner && filtered.length > 0 && (
                <span style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:6}}>
                  <label style={{display:'flex',alignItems:'center',gap:5,cursor:'pointer',color:allFilteredSelected?G.orange:G.muted,fontWeight:allFilteredSelected?700:400}}>
                    <input type="checkbox" checked={allFilteredSelected} onChange={e=>{
                      if (e.target.checked) selectAllInList(filtered)
                      else deselectAllInList(filtered)
                    }} style={{accentColor:G.orange}}/>
                    {allFilteredSelected ? `✓ Toate ${filtered.length} selectate` : `Selectează toate ${filtered.length}`}
                  </label>
                </span>
              )}
            </div>
            <div style={{flex:1,overflowY:'auto',padding:'8px 18px ' + (totalSelected > 0 ? '70px' : '18px')}}>
              {!istoricOrdLoading && months.length===0 && (
                <div style={{padding:60,textAlign:'center',color:G.muted,fontSize:13}}>
                  {istoricOrd.length===0 ? '🗂️ Nu există ordine arhivate încă' : '🔍 Niciun rezultat pentru filtrele curente'}
                </div>
              )}
              {months.map(m => {
                const isExpanded = istoricOrdExpanded.has(m.monthKey)
                const monthSelected = m.allIds.every(id => istoricOrdSelected.has(id))
                const monthPartialSelected = !monthSelected && m.allIds.some(id => istoricOrdSelected.has(id))
                const periodeArr = Object.values(m.periodeGroups).sort((a,b) => b.period_from.localeCompare(a.period_from))
                return (
                <div key={m.monthKey} style={{marginTop:10,border:`1px solid ${isExpanded?G.orange+'66':G.border}`,borderRadius:8,overflow:'hidden',transition:'border-color .15s'}}>
                  <div style={{padding:'12px 14px',display:'flex',justifyContent:'space-between',alignItems:'center',background:isExpanded?G.orange+'11':'#1C2128',gap:10,flexWrap:'wrap'}}>
                    <div style={{display:'flex',alignItems:'center',gap:10,cursor:'pointer',flex:1}} onClick={()=>toggleMonthExpanded(m.monthKey)}>
                      <span style={{fontSize:14,color:isExpanded?G.orange:G.muted,transition:'transform .15s',transform:isExpanded?'rotate(0deg)':'rotate(-90deg)',display:'inline-block'}}>▼</span>
                      <span style={{fontSize:14,fontWeight:700,color:G.blue}}>📅 {m.monthLabel}</span>
                      <span style={{fontSize:11,color:G.muted}}>{m.totalOrders} ordine · {periodeArr.length} {periodeArr.length===1?'perioadă':'perioade'}</span>
                    </div>
                    <div style={{display:'flex',gap:14,alignItems:'center'}}>
                      <span style={{fontSize:11,color:G.muted}}>📅 {m.totalZile} zile</span>
                      <span style={{fontSize:13,fontWeight:700,color:G.green}}>{m.totalSum.toLocaleString('ro-RO',{minimumFractionDigits:2})} RON</span>
                      {profile?.is_owner && (
                        <label onClick={e=>e.stopPropagation()} style={{display:'flex',alignItems:'center',gap:5,cursor:'pointer',padding:'4px 8px',borderRadius:5,background:monthSelected?G.orange+'22':'transparent',fontSize:11,fontWeight:monthSelected?700:400,color:monthSelected?G.orange:G.muted}}>
                          <input type="checkbox" checked={monthSelected} ref={el => { if(el) el.indeterminate = monthPartialSelected }} onChange={e=>{
                            if (e.target.checked) selectAllInList(m.allIds.map(id=>({id})))
                            else deselectAllInList(m.allIds.map(id=>({id})))
                          }} style={{accentColor:G.orange}}/>
                          {monthSelected ? '✓' : 'Sel.'} luna
                        </label>
                      )}
                    </div>
                  </div>
                  {isExpanded && (
                    <div style={{padding:'10px 14px',background:'#0D1117'}}>
                      {periodeArr.map(g => {
                        const groupIds = g.items.map(it => it.id)
                        const groupSelected = groupIds.every(id => istoricOrdSelected.has(id))
                        const groupPartial = !groupSelected && groupIds.some(id => istoricOrdSelected.has(id))
                        return (
                        <div key={`${g.period_from}__${g.period_to}`} style={{marginBottom:14}}>
                          <div style={{padding:'7px 12px',background:'#1C2128',borderRadius:6,marginBottom:6,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                            <div style={{display:'flex',alignItems:'center',gap:10}}>
                              {profile?.is_owner && (
                                <input type="checkbox" checked={groupSelected} ref={el => { if(el) el.indeterminate = groupPartial }} onChange={e=>{
                                  if (e.target.checked) selectAllInList(g.items)
                                  else deselectAllInList(g.items)
                                }} style={{accentColor:G.orange}} title="Selectează toate din această perioadă"/>
                              )}
                              <div style={{fontSize:12,fontWeight:700,color:G.blue}}>
                                {new Date(g.period_from).toLocaleDateString('ro-RO')} — {new Date(g.period_to).toLocaleDateString('ro-RO')}
                              </div>
                            </div>
                            <div style={{fontSize:11,color:G.muted}}>{g.items.length} ordine</div>
                          </div>
                          <table style={{width:'100%',fontSize:12,borderCollapse:'collapse'}}>
                            <thead><tr style={{background:G.bg,color:G.muted}}>
                              {profile?.is_owner && <th style={{padding:'6px 4px',width:30}}></th>}
                              <th style={{padding:'6px 8px',textAlign:'left',fontWeight:600,width:90}}>Nr Ordin</th>
                              <th style={{padding:'6px 8px',textAlign:'left',fontWeight:600}}>Angajat</th>
                              <th style={{padding:'6px 8px',textAlign:'left',fontWeight:600}}>Funcție</th>
                              <th style={{padding:'6px 8px',textAlign:'center',fontWeight:600,width:55}}>Zile</th>
                              <th style={{padding:'6px 8px',textAlign:'right',fontWeight:600,width:90}}>Suma</th>
                              <th style={{padding:'6px 8px',textAlign:'left',fontWeight:600}}>Generat la</th>
                              <th style={{padding:'6px 8px',textAlign:'center',fontWeight:600,width:120}}>Acțiuni</th>
                            </tr></thead>
                            <tbody>
                              {g.items.map((r,i) => {
                                const isSel = istoricOrdSelected.has(r.id)
                                return (
                                <tr key={r.id} style={{background:isSel?G.orange+'18':(i%2===0?'transparent':'#1C2128'),borderBottom:`1px solid ${G.border}33`}}>
                                  {profile?.is_owner && (
                                    <td style={{padding:'7px 4px',textAlign:'center'}}>
                                      <input type="checkbox" checked={isSel} onChange={()=>toggleSelectOrd(r.id)} style={{accentColor:G.orange}}/>
                                    </td>
                                  )}
                                  <td style={{padding:'7px 8px',fontWeight:700,color:G.orange,fontSize:11,fontFamily:'monospace'}}>{r.numar_ordin || '—'}</td>
                                  <td style={{padding:'7px 8px',fontWeight:600}}>{r.employees?.name || `#${r.employee_id}`}</td>
                                  <td style={{padding:'7px 8px',color:G.muted,fontSize:11}}>{r.employees?.functie || '—'}</td>
                                  <td style={{padding:'7px 8px',textAlign:'center',color:G.blue}}>{r.zile_lucrate || 0}</td>
                                  <td style={{padding:'7px 8px',textAlign:'right',color:G.green,fontWeight:700}}>{Number(r.suma_totala || 0).toLocaleString('ro-RO',{minimumFractionDigits:2})} RON</td>
                                  <td style={{padding:'7px 8px',color:G.muted,fontSize:11}}>{new Date(r.created_at).toLocaleString('ro-RO',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})}</td>
                                  <td style={{padding:'7px 8px',textAlign:'center'}}>
                                    <button onClick={()=>openIstoricOrdPDF(r)} style={{background:'none',border:`1px solid ${G.blue}66`,borderRadius:5,padding:'3px 9px',cursor:'pointer',color:G.blue,fontSize:11,marginRight:4}} title="Deschide PDF">📄 Vezi</button>
                                    {profile?.is_owner && (
                                      <button onClick={()=>deleteIstoricOrd(r)} style={{background:'none',border:`1px solid ${G.red}44`,borderRadius:5,padding:'3px 9px',cursor:'pointer',color:G.red,fontSize:11}} title="Șterge din arhivă (doar owner)">🗑️</button>
                                    )}
                                  </td>
                                </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                        )
                      })}
                    </div>
                  )}
                </div>
                )
              })}
            </div>
            {/* Floating bulk action bar (Etapa 7.5 Faza 3.4) */}
            {profile?.is_owner && totalSelected > 0 && (
              <div style={{position:'absolute',bottom:0,left:0,right:0,padding:'12px 18px',background:'#1C2128',borderTop:`2px solid ${G.orange}`,display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,borderRadius:'0 0 8px 8px'}}>
                <div style={{display:'flex',alignItems:'center',gap:10}}>
                  <span style={{fontSize:13,fontWeight:700,color:G.orange}}>✓ {totalSelected} ordin{totalSelected===1?'':'e'} selectat{totalSelected===1?'':'e'}</span>
                  <button onClick={()=>setIstoricOrdSelected(new Set())} style={{...S.btnS,fontSize:11,padding:'5px 10px'}}>✕ Deselectează tot</button>
                </div>
                <button onClick={bulkDeleteOrd} disabled={bulkDeletingOrd} style={{...S.btnP,background:G.red,fontSize:12,padding:'8px 16px',opacity:bulkDeletingOrd?.5:1}}>
                  {bulkDeletingOrd ? '⏳ Se șterge...' : `🗑️ Șterge ${totalSelected} selectat${totalSelected===1?'':'e'}`}
                </button>
              </div>
            )}
          </div>
        </div>
        )
      })()}

      {/* Registru Ordine Deplasare modal (jurnal contabil cu export Excel) */}
      {showRegistruOrd && (() => {
        const filtered = istoricOrd.filter(r => {
          if (registruOrdSearch) {
            const q = registruOrdSearch.toLowerCase()
            if (!(r.employees?.name || '').toLowerCase().includes(q) 
                && !((r.numar_ordin || '').toLowerCase().includes(q))) return false
          }
          if (registruOrdMonth) {
            const m = (r.data_emiterii || r.period_from)?.substring(0,7)
            if (m !== registruOrdMonth) return false
          }
          return true
        })
        const sorted = [...filtered].sort((a, b) => {
          const da = (a.data_emiterii || a.period_from || '') + (a.numar_ordin || '')
          const db = (b.data_emiterii || b.period_from || '') + (b.numar_ordin || '')
          return registruOrdSortAsc ? da.localeCompare(db) : db.localeCompare(da)
        })
        const totalZile = filtered.reduce((s, r) => s + (Number(r.zile_lucrate) || 0), 0)
        const totalSuma = filtered.reduce((s, r) => s + (Number(r.suma_totala) || 0), 0)
        return (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.85)',zIndex:210,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
          <div style={{...S.card,width:1200,maxHeight:'90vh',display:'flex',flexDirection:'column'}}>
            <div style={{padding:'14px 18px',borderBottom:`1px solid ${G.border}`,display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,flexWrap:'wrap'}}>
              <div>
                <div style={{fontSize:16,fontWeight:800,color:G.blue}}>📋 Registru Ordine Deplasare</div>
                <div style={{fontSize:11,color:G.muted,marginTop:2}}>Jurnal cronologic cu toate ordinele generate · {filtered.length} ordine afișate din {istoricOrd.length} totale</div>
              </div>
              <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                <input type="text" placeholder="🔍 Angajat / Nr ordin..." value={registruOrdSearch} onChange={e=>setRegistruOrdSearch(e.target.value)} style={{...S.input,width:200,padding:'6px 10px',fontSize:12}}/>
                <input type="month" value={registruOrdMonth} onChange={e=>setRegistruOrdMonth(e.target.value)} style={{...S.input,width:'auto',padding:'6px 10px',fontSize:12}} title="Filtru lună data emiterii"/>
                <button onClick={()=>setRegistruOrdSortAsc(!registruOrdSortAsc)} style={{...S.btnS,fontSize:11,padding:'5px 10px'}} title="Toggle sortare">
                  {registruOrdSortAsc ? '⬆ Vechi → Nou' : '⬇ Nou → Vechi'}
                </button>
                {(registruOrdSearch||registruOrdMonth)&&<button onClick={()=>{setRegistruOrdSearch('');setRegistruOrdMonth('')}} style={{...S.btnS,fontSize:11,padding:'5px 10px'}}>✕ Reset</button>}
                <button onClick={exportRegistruOrdineExcel} disabled={exportingRegistru||!filtered.length} style={{...S.btnP,background:'#1A6B1A',fontSize:12,padding:'6px 12px',opacity:exportingRegistru||!filtered.length?.5:1}} title="Export Excel registru">
                  {exportingRegistru ? '⏳' : '⬇ Excel'}
                </button>
                <button onClick={()=>setShowRegistruOrd(false)} style={{background:'none',border:'none',color:G.muted,cursor:'pointer',fontSize:20}}>✕</button>
              </div>
            </div>
            <div style={{flex:1,overflowY:'auto',padding:'12px 18px'}}>
              {sorted.length===0 ? (
                <div style={{padding:60,textAlign:'center',color:G.muted,fontSize:13}}>
                  {istoricOrd.length===0 ? '🗂️ Registru gol — nu există ordine arhivate încă' : '🔍 Niciun rezultat pentru filtrele curente'}
                </div>
              ) : (
                <table style={{width:'100%',fontSize:12,borderCollapse:'collapse'}}>
                  <thead style={{position:'sticky',top:0,background:'#0D1117',zIndex:1}}>
                    <tr style={{background:G.blue+'22',borderBottom:`2px solid ${G.blue}`}}>
                      <th style={{padding:'8px 6px',textAlign:'center',fontWeight:700,fontSize:11,color:G.blue,width:50}}>Nr crt</th>
                      <th style={{padding:'8px 6px',textAlign:'left',fontWeight:700,fontSize:11,color:G.blue,width:100}}>Nr Ordin</th>
                      <th style={{padding:'8px 6px',textAlign:'left',fontWeight:700,fontSize:11,color:G.blue,width:100}}>Data emit.</th>
                      <th style={{padding:'8px 6px',textAlign:'left',fontWeight:700,fontSize:11,color:G.blue}}>Angajat</th>
                      <th style={{padding:'8px 6px',textAlign:'left',fontWeight:700,fontSize:11,color:G.blue,width:140}}>Funcția</th>
                      <th style={{padding:'8px 6px',textAlign:'left',fontWeight:700,fontSize:11,color:G.blue,width:170}}>Perioada</th>
                      <th style={{padding:'8px 6px',textAlign:'center',fontWeight:700,fontSize:11,color:G.blue,width:55}}>Zile</th>
                      <th style={{padding:'8px 6px',textAlign:'right',fontWeight:700,fontSize:11,color:G.blue,width:100}}>Suma</th>
                      <th style={{padding:'8px 6px',textAlign:'center',fontWeight:700,fontSize:11,color:G.blue,width:80}}>PDF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((r,i) => (
                      <tr key={r.id} style={{background:i%2===0?'transparent':'#1C2128',borderBottom:`1px solid ${G.border}33`}}>
                        <td style={{padding:'7px 6px',textAlign:'center',color:G.muted,fontSize:11}}>{i + 1}</td>
                        <td style={{padding:'7px 6px',fontWeight:700,color:G.orange,fontSize:11,fontFamily:'monospace'}}>{r.numar_ordin || '—'}</td>
                        <td style={{padding:'7px 6px',fontSize:11}}>{r.data_emiterii ? new Date(r.data_emiterii).toLocaleDateString('ro-RO') : '—'}</td>
                        <td style={{padding:'7px 6px',fontWeight:600}}>{r.employees?.name || `#${r.employee_id}`}</td>
                        <td style={{padding:'7px 6px',color:G.muted,fontSize:11}}>{r.employees?.functie || '—'}</td>
                        <td style={{padding:'7px 6px',fontSize:11}}>{new Date(r.period_from).toLocaleDateString('ro-RO')} – {new Date(r.period_to).toLocaleDateString('ro-RO')}</td>
                        <td style={{padding:'7px 6px',textAlign:'center',color:G.blue,fontWeight:600}}>{r.zile_lucrate || 0}</td>
                        <td style={{padding:'7px 6px',textAlign:'right',color:G.green,fontWeight:700}}>{Number(r.suma_totala || 0).toLocaleString('ro-RO',{minimumFractionDigits:2})}</td>
                        <td style={{padding:'7px 6px',textAlign:'center'}}>
                          <button onClick={()=>openIstoricOrdPDF(r)} style={{background:'none',border:`1px solid ${G.blue}66`,borderRadius:5,padding:'3px 9px',cursor:'pointer',color:G.blue,fontSize:11}} title="Deschide PDF">📄</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot style={{position:'sticky',bottom:0,background:'#0D1117'}}>
                    <tr style={{background:G.blue+'33',borderTop:`2px solid ${G.blue}`,fontWeight:700}}>
                      <td colSpan={6} style={{padding:'10px 6px',textAlign:'right',color:G.blue}}>TOTAL REGISTRU:</td>
                      <td style={{padding:'10px 6px',textAlign:'center',color:G.blue}}>{totalZile}</td>
                      <td style={{padding:'10px 6px',textAlign:'right',color:G.green}}>{totalSuma.toLocaleString('ro-RO',{minimumFractionDigits:2})} RON</td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          </div>
        </div>
        )
      })()}

      {/* Modal Istoric Pontaj Brut — cu lock-screen (re-auth + 20 min) */}
      {showHistoricPB && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.85)',zIndex:300,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
          {!pbUnlocked ? (
            // Lock screen
            <div style={{...S.card,padding:32,maxWidth:460,width:'100%',border:`2px solid ${G.purple}66`,boxShadow:`0 8px 40px ${G.purple}33`}}>
              <div style={{fontSize:42,textAlign:'center',marginBottom:14}}>🔐</div>
              <div style={{fontSize:18,fontWeight:800,textAlign:'center',marginBottom:8,color:G.purple}}>Istoric Pontaj Brut</div>
              <div style={{fontSize:12,color:G.muted,textAlign:'center',marginBottom:22,lineHeight:1.7}}>
                Conține date GDPR-sensibile cu ore reale lucrate.<br/>
                Re-introdu parola contului tău pentru <strong style={{color:G.yellow}}>{PB_TIMEOUT_MIN} minute</strong>.
              </div>
              <div style={{marginBottom:12}}>
                <Lbl>Email contului tău</Lbl>
                <div style={{fontSize:12,color:G.text,padding:'10px 12px',background:G.bg,borderRadius:8,border:`1px solid ${G.border}`,fontFamily:'monospace'}}>{profile?.email || '—'}</div>
              </div>
              <div style={{marginBottom:16}}>
                <Lbl>Parolă</Lbl>
                <input type="password" style={{...S.input,borderColor:pbPwdErr?G.red:G.border2}}
                  value={pbPwdInput} onChange={e=>setPbPwdInput(e.target.value)}
                  onKeyDown={e=>{if(e.key==='Enter') handlePbUnlock()}}
                  autoFocus disabled={pbVerifying} placeholder="••••••••"/>
                {pbPwdErr && <div style={{fontSize:11,color:G.red,marginTop:5,fontWeight:600}}>⚠ {pbPwdErr}</div>}
              </div>
              <button onClick={handlePbUnlock} disabled={pbVerifying} style={{...S.btnP,width:'100%',padding:'11px',background:pbVerifying?G.dim:G.purple,fontSize:13,fontWeight:700}}>
                {pbVerifying ? '⏳ Verificare...' : '🔓 Deblochează acces'}
              </button>
              <div style={{textAlign:'center',marginTop:14}}>
                <button onClick={()=>{setShowHistoricPB(false);setPbPwdInput('');setPbPwdErr('')}} style={{...S.btnS,fontSize:11,padding:'6px 14px'}}>← Anulează</button>
              </div>
            </div>
          ) : (
            // Conținut istoric
            <div style={{...S.card,width:900,maxHeight:'88vh',display:'flex',flexDirection:'column',borderTop:`3px solid ${G.purple}`}}>
              <div style={{padding:'14px 20px',borderBottom:`1px solid ${G.border}`,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div>
                  <div style={{fontSize:15,fontWeight:800,display:'flex',alignItems:'center',gap:8}}>📋 Istoric Pontaj Brut</div>
                  <div style={{fontSize:11,color:G.muted,marginTop:3}}>
                    🔓 Deblocat până la {new Date(pbUnlockUntil).toLocaleTimeString('ro-RO',{hour:'2-digit',minute:'2-digit'})} · {historicPB.length} exporturi
                  </div>
                </div>
                <div style={{display:'flex',gap:6}}>
                  <button onClick={handlePbLock} style={{...S.btnS,padding:'4px 10px',fontSize:11,borderColor:G.red+'66',color:G.red}}>🔒 Lock</button>
                  <button onClick={()=>setShowHistoricPB(false)} style={{background:'none',border:'none',color:G.muted,cursor:'pointer',fontSize:20}}>×</button>
                </div>
              </div>
              <div style={{overflowY:'auto',flex:1,padding:'0 20px'}}>
                {historicPBLoad ? (
                  <div style={{textAlign:'center',padding:60}}><div className="sp" style={{display:'inline-block'}}/></div>
                ) : !historicPB.length ? (
                  <div style={{padding:60,textAlign:'center',color:G.muted,fontSize:13}}>
                    Niciun export salvat încă. Folosește „📄 Export Pontaj Brut" pentru a începe istoricul.
                  </div>
                ) : (
                  <table style={{width:'100%',fontSize:12}}>
                    <thead style={{position:'sticky',top:0,background:G.surface,zIndex:1}}>
                      <tr style={{borderBottom:`1px solid ${G.border}`}}>
                        <th style={{padding:'10px 6px',textAlign:'left'}}>Perioadă</th>
                        <th style={{padding:'10px 6px',textAlign:'center'}}>Zile lucr.</th>
                        <th style={{padding:'10px 6px',textAlign:'center'}}>Angajați</th>
                        <th style={{padding:'10px 6px',textAlign:'right'}}>Total ore</th>
                        <th style={{padding:'10px 6px',textAlign:'right'}}>Total ore supl.</th>
                        <th style={{padding:'10px 6px',textAlign:'left'}}>Exportat de</th>
                        <th style={{padding:'10px 6px',textAlign:'left'}}>Data</th>
                        <th style={{padding:'10px 6px',textAlign:'center'}}>Acțiuni</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historicPB.map((e,i)=>{
                        const mLabel = new Date(e.period_year, e.period_month-1).toLocaleString('ro-RO',{month:'long',year:'numeric'})
                        return (
                          <tr key={e.id} style={{background:i%2===0?'transparent':'#1C2128',borderBottom:`1px solid ${G.border}33`}}>
                            <td style={{padding:'8px 6px',fontWeight:600,color:G.blue,textTransform:'capitalize'}}>{mLabel}</td>
                            <td style={{padding:'8px 6px',textAlign:'center',color:G.yellow,fontWeight:700}}>{e.work_days_in_month}</td>
                            <td style={{padding:'8px 6px',textAlign:'center'}}>{e.total_employees}</td>
                            <td style={{padding:'8px 6px',textAlign:'right',color:G.text}}>{Number(e.total_ore_lunar).toLocaleString('ro-RO',{maximumFractionDigits:1})} h</td>
                            <td style={{padding:'8px 6px',textAlign:'right',color:Number(e.total_ore_supl)>0?G.orange:G.dim,fontWeight:Number(e.total_ore_supl)>0?700:400}}>{Number(e.total_ore_supl).toLocaleString('ro-RO',{maximumFractionDigits:1})} h</td>
                            <td style={{padding:'8px 6px',fontSize:11,color:G.muted}}>{e.exported_by_name || '—'}</td>
                            <td style={{padding:'8px 6px',fontSize:11,color:G.muted}}>{new Date(e.exported_at).toLocaleString('ro-RO',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'})}</td>
                            <td style={{padding:'8px 6px',textAlign:'center'}}>
                              <div style={{display:'flex',gap:4,justifyContent:'center'}}>
                                {e.storage_path && <button onClick={()=>redownloadHistoricPB(e)} style={{...S.btnS,padding:'3px 8px',fontSize:10,color:G.green,borderColor:G.green+'44'}} title="Descarcă Excel">⬇</button>}
                                {e.storage_path && <button onClick={()=>{setShowHistoricPB(false); generatePontajNet(e)}} disabled={genNetLoading} style={{...S.btnS,padding:'3px 8px',fontSize:10,color:G.blue,borderColor:G.blue+'66'}} title="Generează Pontaj Net din acest brut">➡</button>}
                                {profile?.is_owner === true && <button onClick={()=>deleteHistoricPB(e)} style={{...S.btnS,padding:'3px 8px',fontSize:10,color:G.red,borderColor:G.red+'44'}} title="Șterge (doar OWNER)">🗑️</button>}
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>
              <div style={{padding:'10px 20px',borderTop:`1px solid ${G.border}`,fontSize:11,color:G.muted,background:G.bg}}>
                💡 Fișierele Excel sunt salvate în Storage privat. Doar OWNER poate șterge intrările.
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal Selectare Brut pentru Generare Net */}
      {showSelectBrutForNet && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.85)',zIndex:300,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
          {!pbUnlocked ? (
            <div style={{...S.card,padding:32,maxWidth:460,width:'100%',border:`2px solid ${G.blue}66`,boxShadow:`0 8px 40px ${G.blue}33`}}>
              <div style={{fontSize:42,textAlign:'center',marginBottom:14}}>🔐</div>
              <div style={{fontSize:18,fontWeight:800,textAlign:'center',marginBottom:8,color:G.blue}}>Generează Pontaj Net</div>
              <div style={{fontSize:12,color:G.muted,textAlign:'center',marginBottom:22,lineHeight:1.7}}>
                Procesează un brut existent prin reguli de salarizare.<br/>Necesită parola contului tău pentru <strong style={{color:G.yellow}}>{PB_TIMEOUT_MIN} min</strong>.
              </div>
              <div style={{marginBottom:12}}>
                <Lbl>Email contului tău</Lbl>
                <div style={{fontSize:12,color:G.text,padding:'10px 12px',background:G.bg,borderRadius:8,border:`1px solid ${G.border}`,fontFamily:'monospace'}}>{profile?.email || '—'}</div>
              </div>
              <div style={{marginBottom:16}}>
                <Lbl>Parolă</Lbl>
                <input type="password" style={{...S.input,borderColor:pbPwdErr?G.red:G.border2}}
                  value={pbPwdInput} onChange={e=>setPbPwdInput(e.target.value)}
                  onKeyDown={e=>{if(e.key==='Enter') handlePbUnlock()}}
                  autoFocus disabled={pbVerifying} placeholder="••••••••"/>
                {pbPwdErr && <div style={{fontSize:11,color:G.red,marginTop:5,fontWeight:600}}>⚠ {pbPwdErr}</div>}
              </div>
              <button onClick={handlePbUnlock} disabled={pbVerifying} style={{...S.btnP,width:'100%',padding:'11px',background:pbVerifying?G.dim:G.blue,fontSize:13,fontWeight:700}}>
                {pbVerifying ? '⏳ Verificare...' : '🔓 Deblochează acces'}
              </button>
              <div style={{textAlign:'center',marginTop:14}}>
                <button onClick={()=>{setShowSelectBrutForNet(false);setPbPwdInput('');setPbPwdErr('')}} style={{...S.btnS,fontSize:11,padding:'6px 14px'}}>← Anulează</button>
              </div>
            </div>
          ) : (
            <div style={{...S.card,width:840,maxHeight:'88vh',display:'flex',flexDirection:'column',borderTop:`3px solid ${G.blue}`}}>
              <div style={{padding:'14px 20px',borderBottom:`1px solid ${G.border}`,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div>
                  <div style={{fontSize:15,fontWeight:800,display:'flex',alignItems:'center',gap:8}}>🔄 Generează Pontaj Net</div>
                  <div style={{fontSize:11,color:G.muted,marginTop:3}}>Selectează un export Brut din care să generez Pontajul Net (după aplicarea regulilor de salarizare)</div>
                </div>
                <button onClick={()=>setShowSelectBrutForNet(false)} disabled={genNetLoading} style={{background:'none',border:'none',color:G.muted,cursor:'pointer',fontSize:20}}>×</button>
              </div>
              {genNetLoading && (
                <div style={{padding:'14px 20px',background:'#1A2A4A',borderBottom:`1px solid ${G.blue}66`,fontSize:12,color:G.text,display:'flex',alignItems:'center',gap:10}}>
                  <div className="sp"/>
                  <span>⚙️ {genNetProgress || 'Procesare...'}</span>
                </div>
              )}
              <div style={{overflowY:'auto',flex:1,padding:'0 20px'}}>
                {historicPBLoad ? (
                  <div style={{textAlign:'center',padding:60}}><div className="sp" style={{display:'inline-block'}}/></div>
                ) : !historicPB.length ? (
                  <div style={{padding:60,textAlign:'center',color:G.muted,fontSize:13}}>
                    Nu există încă exporturi Brut. Generează un Pontaj Brut întâi.
                  </div>
                ) : (
                  <table style={{width:'100%',fontSize:12}}>
                    <thead style={{position:'sticky',top:0,background:G.surface,zIndex:1}}>
                      <tr style={{borderBottom:`1px solid ${G.border}`}}>
                        <th style={{padding:'10px 6px',textAlign:'left'}}>Perioadă</th>
                        <th style={{padding:'10px 6px',textAlign:'center'}}>Zile lucr.</th>
                        <th style={{padding:'10px 6px',textAlign:'center'}}>Angajați</th>
                        <th style={{padding:'10px 6px',textAlign:'right'}}>Ore Brut</th>
                        <th style={{padding:'10px 6px',textAlign:'right'}}>Ore Supl</th>
                        <th style={{padding:'10px 6px',textAlign:'left'}}>Exportat</th>
                        <th style={{padding:'10px 6px',textAlign:'center'}}>Acțiune</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historicPB.map((e,i)=>{
                        const mLabel = new Date(e.period_year, e.period_month-1).toLocaleString('ro-RO',{month:'long',year:'numeric'})
                        return (
                          <tr key={e.id} style={{background:i%2===0?'transparent':'#1C2128',borderBottom:`1px solid ${G.border}33`}}>
                            <td style={{padding:'8px 6px',fontWeight:600,color:G.blue,textTransform:'capitalize'}}>{mLabel}</td>
                            <td style={{padding:'8px 6px',textAlign:'center',color:G.yellow,fontWeight:700}}>{e.work_days_in_month}</td>
                            <td style={{padding:'8px 6px',textAlign:'center'}}>{e.total_employees}</td>
                            <td style={{padding:'8px 6px',textAlign:'right',color:G.text}}>{Number(e.total_ore_lunar).toLocaleString('ro-RO',{maximumFractionDigits:1})}h</td>
                            <td style={{padding:'8px 6px',textAlign:'right',color:Number(e.total_ore_supl)>0?G.orange:G.dim}}>{Number(e.total_ore_supl).toLocaleString('ro-RO',{maximumFractionDigits:1})}h</td>
                            <td style={{padding:'8px 6px',fontSize:11,color:G.muted}}>{new Date(e.exported_at).toLocaleDateString('ro-RO')}<br/><span style={{fontSize:10}}>{e.exported_by_name}</span></td>
                            <td style={{padding:'8px 6px',textAlign:'center'}}>
                              <button onClick={()=>generatePontajNet(e)} disabled={genNetLoading || !e.storage_path} style={{...S.btnP,padding:'6px 12px',fontSize:11,background:G.blue,minWidth:90}}>
                                {genNetLoading?'⏳':'➡ Procesează'}
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>
              <div style={{padding:'10px 20px',borderTop:`1px solid ${G.border}`,fontSize:11,color:G.muted,background:G.bg}}>
                💡 Algoritm: mută orele lucrate în WE/sărbătoare → zile lucrătoare cu LL. Surse orfane → LL galben.
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal Istoric Pontaj Net — cu lock-screen (același mecanism) */}
      {showHistoricPN && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.85)',zIndex:300,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
          {!pbUnlocked ? (
            <div style={{...S.card,padding:32,maxWidth:460,width:'100%',border:`2px solid ${G.blue}66`,boxShadow:`0 8px 40px ${G.blue}33`}}>
              <div style={{fontSize:42,textAlign:'center',marginBottom:14}}>🔐</div>
              <div style={{fontSize:18,fontWeight:800,textAlign:'center',marginBottom:8,color:G.blue}}>Istoric Pontaj Net</div>
              <div style={{fontSize:12,color:G.muted,textAlign:'center',marginBottom:22,lineHeight:1.7}}>
                Re-introdu parola contului tău pentru <strong style={{color:G.yellow}}>{PB_TIMEOUT_MIN} min</strong>.
              </div>
              <div style={{marginBottom:12}}>
                <Lbl>Email contului tău</Lbl>
                <div style={{fontSize:12,color:G.text,padding:'10px 12px',background:G.bg,borderRadius:8,border:`1px solid ${G.border}`,fontFamily:'monospace'}}>{profile?.email || '—'}</div>
              </div>
              <div style={{marginBottom:16}}>
                <Lbl>Parolă</Lbl>
                <input type="password" style={{...S.input,borderColor:pbPwdErr?G.red:G.border2}}
                  value={pbPwdInput} onChange={e=>setPbPwdInput(e.target.value)}
                  onKeyDown={e=>{if(e.key==='Enter') handlePbUnlock()}}
                  autoFocus disabled={pbVerifying} placeholder="••••••••"/>
                {pbPwdErr && <div style={{fontSize:11,color:G.red,marginTop:5,fontWeight:600}}>⚠ {pbPwdErr}</div>}
              </div>
              <button onClick={()=>{handlePbUnlock().then(()=>loadHistoricPN())}} disabled={pbVerifying} style={{...S.btnP,width:'100%',padding:'11px',background:pbVerifying?G.dim:G.blue,fontSize:13,fontWeight:700}}>
                {pbVerifying ? '⏳ Verificare...' : '🔓 Deblochează'}
              </button>
              <div style={{textAlign:'center',marginTop:14}}>
                <button onClick={()=>{setShowHistoricPN(false);setPbPwdInput('');setPbPwdErr('')}} style={{...S.btnS,fontSize:11,padding:'6px 14px'}}>← Anulează</button>
              </div>
            </div>
          ) : (
            <div style={{...S.card,width:1000,maxHeight:'88vh',display:'flex',flexDirection:'column',borderTop:`3px solid ${G.blue}`}}>
              <div style={{padding:'14px 20px',borderBottom:`1px solid ${G.border}`,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div>
                  <div style={{fontSize:15,fontWeight:800,display:'flex',alignItems:'center',gap:8}}>📑 Istoric Pontaj Net</div>
                  <div style={{fontSize:11,color:G.muted,marginTop:3}}>
                    🔓 Deblocat până la {new Date(pbUnlockUntil).toLocaleTimeString('ro-RO',{hour:'2-digit',minute:'2-digit'})} · {historicPN.length} exporturi
                  </div>
                </div>
                <div style={{display:'flex',gap:6}}>
                  <button onClick={()=>{loadHistoricPN()}} style={{...S.btnS,padding:'4px 10px',fontSize:11}}>🔄 Reîncarcă</button>
                  <button onClick={handlePbLock} style={{...S.btnS,padding:'4px 10px',fontSize:11,borderColor:G.red+'66',color:G.red}}>🔒 Lock</button>
                  <button onClick={()=>setShowHistoricPN(false)} style={{background:'none',border:'none',color:G.muted,cursor:'pointer',fontSize:20}}>×</button>
                </div>
              </div>
              <div style={{overflowY:'auto',flex:1,padding:'0 20px'}}>
                {historicPNLoad ? (
                  <div style={{textAlign:'center',padding:60}}><div className="sp" style={{display:'inline-block'}}/></div>
                ) : !historicPN.length ? (
                  <div style={{padding:60,textAlign:'center',color:G.muted,fontSize:13}}>
                    Niciun export Net încă. Folosește „🔄 Generează Pontaj Net" sau butonul ➡ din Istoric Brut.
                  </div>
                ) : (
                  <table style={{width:'100%',fontSize:12}}>
                    <thead style={{position:'sticky',top:0,background:G.surface,zIndex:1}}>
                      <tr style={{borderBottom:`1px solid ${G.border}`}}>
                        <th style={{padding:'10px 6px',textAlign:'left'}}>Perioadă</th>
                        <th style={{padding:'10px 6px',textAlign:'center'}}>Angajați</th>
                        <th style={{padding:'10px 6px',textAlign:'center'}}>Mutări</th>
                        <th style={{padding:'10px 6px',textAlign:'center'}}>Orfani→LL</th>
                        <th style={{padding:'10px 6px',textAlign:'right'}}>Total ore</th>
                        <th style={{padding:'10px 6px',textAlign:'left'}}>Exportat de</th>
                        <th style={{padding:'10px 6px',textAlign:'left'}}>Data</th>
                        <th style={{padding:'10px 6px',textAlign:'center'}}>Acțiuni</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historicPN.map((e,i)=>{
                        const mLabel = new Date(e.period_year, e.period_month-1).toLocaleString('ro-RO',{month:'long',year:'numeric'})
                        return (
                          <tr key={e.id} style={{background:i%2===0?'transparent':'#1C2128',borderBottom:`1px solid ${G.border}33`}}>
                            <td style={{padding:'8px 6px',fontWeight:600,color:G.blue,textTransform:'capitalize'}}>{mLabel}</td>
                            <td style={{padding:'8px 6px',textAlign:'center'}}>{e.total_employees}</td>
                            <td style={{padding:'8px 6px',textAlign:'center',color:G.green,fontWeight:700}}>{e.moves_count}</td>
                            <td style={{padding:'8px 6px',textAlign:'center',color:G.orange,fontWeight:700}}>{e.orphans_src_count}</td>
                            <td style={{padding:'8px 6px',textAlign:'right',color:G.text}}>{Number(e.total_ore_lunar).toLocaleString('ro-RO',{maximumFractionDigits:1})}h</td>
                            <td style={{padding:'8px 6px',fontSize:11,color:G.muted}}>{e.exported_by_name || '—'}</td>
                            <td style={{padding:'8px 6px',fontSize:11,color:G.muted}}>{new Date(e.exported_at).toLocaleString('ro-RO',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'})}</td>
                            <td style={{padding:'8px 6px',textAlign:'center'}}>
                              <div style={{display:'flex',gap:4,justifyContent:'center'}}>
                                {e.storage_path && <button onClick={()=>redownloadHistoricPN(e)} style={{...S.btnS,padding:'3px 8px',fontSize:10,color:G.green,borderColor:G.green+'44'}} title="Descarcă Excel">⬇</button>}
                                {profile?.is_owner === true && <button onClick={()=>deleteHistoricPN(e)} style={{...S.btnS,padding:'3px 8px',fontSize:10,color:G.red,borderColor:G.red+'44'}} title="Șterge (doar OWNER)">🗑️</button>}
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>
              <div style={{padding:'10px 20px',borderTop:`1px solid ${G.border}`,fontSize:11,color:G.muted,background:G.bg}}>
                💡 Net = brut procesat (WE/sărbătoare lucrată mutate în zile cu LL). Coloana Ore Suplimentare eliminată.
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal de unlock pentru butoanele de Export (Brut / Diurne / Hrană / Istoric) */}
      {pendingExportAction && !pbUnlocked && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.88)',zIndex:310,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
          <div style={{...S.card,padding:32,maxWidth:460,width:'100%',border:`2px solid ${G.yellow}66`,boxShadow:`0 8px 40px ${G.yellow}33`}}>
            <div style={{fontSize:42,textAlign:'center',marginBottom:14}}>🔐</div>
            <div style={{fontSize:18,fontWeight:800,textAlign:'center',marginBottom:8,color:G.yellow}}>
              {pendingExportAction === 'brut' ? 'Export Pontaj Brut' :
               pendingExportAction === 'diurne' ? 'Export Diurne' :
               pendingExportAction === 'hrana' ? 'Export Supliment Hrană' :
               pendingExportAction === 'brut-istoric' ? 'Istoric Pontaj Brut' :
               pendingExportAction === 'hrana-istoric' ? 'Istoric Supliment Hrană' :
               'Acțiune protejată'}
            </div>
            <div style={{fontSize:12,color:G.muted,textAlign:'center',marginBottom:22,lineHeight:1.7}}>
              Acțiune sensibilă cu date salariale.<br/>
              Re-introdu parola pentru <strong style={{color:G.yellow}}>{PB_TIMEOUT_MIN} min</strong>.
            </div>
            <div style={{marginBottom:12}}>
              <Lbl>Email contului tău</Lbl>
              <div style={{fontSize:12,color:G.text,padding:'10px 12px',background:G.bg,borderRadius:8,border:`1px solid ${G.border}`,fontFamily:'monospace'}}>{profile?.email || '—'}</div>
            </div>
            <div style={{marginBottom:16}}>
              <Lbl>Parolă</Lbl>
              <input type="password" style={{...S.input,borderColor:pbPwdErr?G.red:G.border2}}
                value={pbPwdInput} onChange={e=>setPbPwdInput(e.target.value)}
                onKeyDown={e=>{if(e.key==='Enter') handlePbUnlock()}}
                autoFocus disabled={pbVerifying} placeholder="••••••••"/>
              {pbPwdErr && <div style={{fontSize:11,color:G.red,marginTop:5,fontWeight:600}}>⚠ {pbPwdErr}</div>}
            </div>
            <button onClick={handlePbUnlock} disabled={pbVerifying} style={{...S.btnP,width:'100%',padding:'11px',background:pbVerifying?G.dim:G.yellow,color:'#000',fontSize:13,fontWeight:700}}>
              {pbVerifying ? '⏳ Verificare...' : '🔓 Deblochează & execută'}
            </button>
            <div style={{textAlign:'center',marginTop:14}}>
              <button onClick={()=>{setPendingExportAction(null);setPbPwdInput('');setPbPwdErr('')}} style={{...S.btnS,fontSize:11,padding:'6px 14px'}}>← Anulează</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Istoric Supliment Hrană — cu lock-screen identic */}
      {showHistoricHrana && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.85)',zIndex:300,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
          {!pbUnlocked ? (
            <div style={{...S.card,padding:32,maxWidth:460,width:'100%',border:`2px solid ${G.green}66`}}>
              <div style={{fontSize:42,textAlign:'center',marginBottom:14}}>🔐</div>
              <div style={{fontSize:18,fontWeight:800,textAlign:'center',marginBottom:8,color:G.green}}>Istoric Supliment Hrană</div>
              <div style={{fontSize:12,color:G.muted,textAlign:'center',marginBottom:22,lineHeight:1.7}}>
                Re-introdu parola pentru <strong style={{color:G.yellow}}>{PB_TIMEOUT_MIN} min</strong>.
              </div>
              <div style={{marginBottom:12}}>
                <Lbl>Email contului tău</Lbl>
                <div style={{fontSize:12,color:G.text,padding:'10px 12px',background:G.bg,borderRadius:8,border:`1px solid ${G.border}`,fontFamily:'monospace'}}>{profile?.email || '—'}</div>
              </div>
              <div style={{marginBottom:16}}>
                <Lbl>Parolă</Lbl>
                <input type="password" style={{...S.input,borderColor:pbPwdErr?G.red:G.border2}}
                  value={pbPwdInput} onChange={e=>setPbPwdInput(e.target.value)}
                  onKeyDown={e=>{if(e.key==='Enter') handlePbUnlock()}}
                  autoFocus disabled={pbVerifying} placeholder="••••••••"/>
                {pbPwdErr && <div style={{fontSize:11,color:G.red,marginTop:5,fontWeight:600}}>⚠ {pbPwdErr}</div>}
              </div>
              <button onClick={()=>handlePbUnlock().then(()=>loadHistoricHrana())} disabled={pbVerifying} style={{...S.btnP,width:'100%',padding:'11px',background:pbVerifying?G.dim:G.green,fontSize:13,fontWeight:700}}>
                {pbVerifying ? '⏳ Verificare...' : '🔓 Deblochează'}
              </button>
              <div style={{textAlign:'center',marginTop:14}}>
                <button onClick={()=>{setShowHistoricHrana(false);setPbPwdInput('');setPbPwdErr('')}} style={{...S.btnS,fontSize:11,padding:'6px 14px'}}>← Anulează</button>
              </div>
            </div>
          ) : (
            <div style={{...S.card,width:1000,maxHeight:'88vh',display:'flex',flexDirection:'column',borderTop:`3px solid ${G.green}`}}>
              <div style={{padding:'14px 20px',borderBottom:`1px solid ${G.border}`,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div>
                  <div style={{fontSize:15,fontWeight:800,display:'flex',alignItems:'center',gap:8}}>📋 Istoric Supliment Hrană</div>
                  <div style={{fontSize:11,color:G.muted,marginTop:3}}>
                    🔓 Deblocat până la {new Date(pbUnlockUntil).toLocaleTimeString('ro-RO',{hour:'2-digit',minute:'2-digit'})} · {historicHrana.length} exporturi
                  </div>
                </div>
                <div style={{display:'flex',gap:6}}>
                  <button onClick={()=>loadHistoricHrana()} style={{...S.btnS,padding:'4px 10px',fontSize:11}}>🔄 Reîncarcă</button>
                  <button onClick={handlePbLock} style={{...S.btnS,padding:'4px 10px',fontSize:11,borderColor:G.red+'66',color:G.red}}>🔒 Lock</button>
                  <button onClick={()=>setShowHistoricHrana(false)} style={{background:'none',border:'none',color:G.muted,cursor:'pointer',fontSize:20}}>×</button>
                </div>
              </div>
              <div style={{overflowY:'auto',flex:1,padding:'0 20px'}}>
                {historicHranaLoad ? (
                  <div style={{textAlign:'center',padding:60}}><div className="sp" style={{display:'inline-block'}}/></div>
                ) : !historicHrana.length ? (
                  <div style={{padding:60,textAlign:'center',color:G.muted,fontSize:13}}>
                    Niciun export salvat încă.
                  </div>
                ) : (
                  <table style={{width:'100%',fontSize:12}}>
                    <thead style={{position:'sticky',top:0,background:G.surface,zIndex:1}}>
                      <tr style={{borderBottom:`1px solid ${G.border}`}}>
                        <th style={{padding:'10px 6px',textAlign:'left'}}>Perioadă</th>
                        <th style={{padding:'10px 6px',textAlign:'center'}}>Angajați</th>
                        <th style={{padding:'10px 6px',textAlign:'center'}}>Zile</th>
                        <th style={{padding:'10px 6px',textAlign:'right'}}>Total RON</th>
                        <th style={{padding:'10px 6px',textAlign:'left'}}>Exportat de</th>
                        <th style={{padding:'10px 6px',textAlign:'left'}}>Data</th>
                        <th style={{padding:'10px 6px',textAlign:'center'}}>Acțiuni</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historicHrana.map((e,i)=>(
                        <tr key={e.id} style={{background:i%2===0?'transparent':'#1C2128',borderBottom:`1px solid ${G.border}33`}}>
                          <td style={{padding:'8px 6px',fontWeight:600,color:G.green}}>{new Date(e.period_from).toLocaleDateString('ro-RO')} → {new Date(e.period_to).toLocaleDateString('ro-RO')}</td>
                          <td style={{padding:'8px 6px',textAlign:'center'}}>{e.total_employees}</td>
                          <td style={{padding:'8px 6px',textAlign:'center',color:G.yellow,fontWeight:700}}>{e.total_days}</td>
                          <td style={{padding:'8px 6px',textAlign:'right',color:G.green,fontWeight:700}}>{Number(e.total_amount).toLocaleString('ro-RO')} RON</td>
                          <td style={{padding:'8px 6px',fontSize:11,color:G.muted}}>{e.exported_by_name || '—'}</td>
                          <td style={{padding:'8px 6px',fontSize:11,color:G.muted}}>{new Date(e.exported_at).toLocaleString('ro-RO',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'})}</td>
                          <td style={{padding:'8px 6px',textAlign:'center'}}>
                            <div style={{display:'flex',gap:4,justifyContent:'center'}}>
                              {e.storage_path && <button onClick={()=>redownloadHistoricHrana(e)} style={{...S.btnS,padding:'3px 8px',fontSize:10,color:G.green,borderColor:G.green+'44'}} title="Descarcă Excel">⬇</button>}
                              {profile?.is_owner === true && <button onClick={()=>deleteHistoricHrana(e)} style={{...S.btnS,padding:'3px 8px',fontSize:10,color:G.red,borderColor:G.red+'44'}} title="Șterge (doar OWNER)">🗑️</button>}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal Generator Ordin Deplasare */}
      {showOrdGen && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.85)',zIndex:300,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
          <div style={{...S.card,width:880,maxHeight:'90vh',display:'flex',flexDirection:'column',borderTop:`3px solid ${G.orange}`}}>
            <div style={{padding:'16px 20px',borderBottom:`1px solid ${G.border}`,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div>
                <div style={{fontSize:15,fontWeight:800,display:'flex',alignItems:'center',gap:8}}>📄 Generator Ordine Deplasare</div>
                {ordGenPayment && (
                  <div style={{fontSize:11,color:G.muted,marginTop:3}}>
                    Plata: {new Date(ordGenPayment.period_from).toLocaleDateString('ro-RO')} — {new Date(ordGenPayment.period_to).toLocaleDateString('ro-RO')}
                  </div>
                )}
              </div>
              <button 
                onClick={()=>{if(!ordGenerating){setShowOrdGen(false);setOrdGenEmps([]);setOrdGenPayment(null)}}} 
                style={{background:'none',border:'none',color:G.muted,cursor:ordGenerating?'not-allowed':'pointer',fontSize:20,opacity:ordGenerating?.4:1}}
              >✕</button>
            </div>
            
            {ordGenLoading ? (
              <div style={{padding:60,textAlign:'center',color:G.muted,fontSize:13}}>
                <div className="sp" style={{display:'inline-block',marginBottom:12}}/>
                <div>Calculez Diurna Max. Admisă pentru fiecare angajat...</div>
              </div>
            ) : ordGenEmps.length === 0 ? (
              <div style={{padding:60,textAlign:'center',color:G.muted,fontSize:13}}>Niciun angajat în această plată.</div>
            ) : (
              <>
                <div style={{padding:'10px 20px',background:G.bg,borderBottom:`1px solid ${G.border}`,display:'flex',gap:14,fontSize:11,color:G.muted,flexWrap:'wrap'}}>
                  <span>📊 {ordGenEmps.length} angajați</span>
                  <span>✓ {ordGenEmps.filter(e=>e.selected).length} selectați</span>
                  <span style={{color:G.orange}}>⚠ {ordGenEmps.filter(e=>e.diurna_max===0).length} cu 0 zile admise (excluși auto)</span>
                  <span style={{marginLeft:'auto',color:G.green}}>Total zile în ZIP: <strong>{ordGenEmps.filter(e=>e.selected).reduce((s,e)=>s+e.diurna_max,0)}</strong></span>
                </div>
                
                {/* Banner warning: angajați selectați fără funcție */}
                {ordGenEmps.filter(e=>e.selected && !e.has_functie).length > 0 && (
                  <div style={{padding:'10px 20px',background:'#3A1A00',borderBottom:`1px solid ${G.orange}66`,fontSize:11,color:G.orange,display:'flex',gap:8,alignItems:'flex-start',lineHeight:1.5}}>
                    <span style={{fontSize:14}}>⚠️</span>
                    <div>
                      <strong>{ordGenEmps.filter(e=>e.selected && !e.has_functie).length} angajat(i) selectat(i) fără funcție în BD</strong> — pe ordin va apărea „—" în loc de funcție.
                      &nbsp;Recomandare: completează funcția în <strong>HR → Personal</strong> înainte de generare.
                      <div style={{marginTop:4,opacity:.85}}>
                        Lipsesc: {ordGenEmps.filter(e=>e.selected && !e.has_functie).map(e=>e.name).join(', ')}
                      </div>
                    </div>
                  </div>
                )}
                
                <div style={{padding:'8px 20px',background:G.bg,borderBottom:`1px solid ${G.border}`,display:'flex',gap:8}}>
                  <button 
                    onClick={()=>setOrdGenEmps(prev=>prev.map(e=>({...e,selected:e.diurna_max>0})))}
                    disabled={ordGenerating}
                    style={{...S.btnS,fontSize:10,padding:'4px 10px'}}
                  >✓ Selectează toți (cu zile&gt;0)</button>
                  <button 
                    onClick={()=>setOrdGenEmps(prev=>prev.map(e=>({...e,selected:false})))}
                    disabled={ordGenerating}
                    style={{...S.btnS,fontSize:10,padding:'4px 10px'}}
                  >✗ Deselectează tot</button>
                </div>
                
                <div style={{overflowY:'auto',flex:1,padding:'0 20px'}}>
                  <table style={{width:'100%',fontSize:12,borderCollapse:'collapse'}}>
                    <thead style={{position:'sticky',top:0,background:G.surface,zIndex:1}}>
                      <tr style={{borderBottom:`1px solid ${G.border}`}}>
                        <th style={{padding:'10px 6px',textAlign:'left',width:30}}></th>
                        <th style={{padding:'10px 6px',textAlign:'left'}}>Angajat</th>
                        <th style={{padding:'10px 6px',textAlign:'left',color:G.muted,fontWeight:600}}>Funcție</th>
                        <th style={{padding:'10px 6px',textAlign:'center',color:G.muted,fontWeight:600}}>Zile reale</th>
                        <th style={{padding:'10px 6px',textAlign:'center',color:G.orange,fontWeight:700}}>Zile admise</th>
                        <th style={{padding:'10px 6px',textAlign:'left',color:G.muted,fontWeight:600}}>Șantiere</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ordGenEmps.map((emp,i) => {
                        const noZile = emp.diurna_max === 0
                        return (
                          <tr key={emp.employee_id} style={{background:i%2===0?'transparent':'#1C2128',borderBottom:`1px solid ${G.border}33`,opacity:noZile?.5:1}}>
                            <td style={{padding:'8px 6px'}}>
                              <input 
                                type="checkbox" 
                                checked={emp.selected} 
                                disabled={noZile||ordGenerating}
                                onChange={e=>setOrdGenEmps(prev=>prev.map(x=>x.employee_id===emp.employee_id?{...x,selected:e.target.checked}:x))}
                                style={{accentColor:G.orange,cursor:noZile?'not-allowed':'pointer'}}
                              />
                            </td>
                            <td style={{padding:'8px 6px',fontWeight:600}}>{emp.name}</td>
                            <td style={{padding:'8px 6px',fontSize:11}}>
                              {emp.has_functie ? (
                                <span style={{color:G.text}}>{emp.functie}</span>
                              ) : (
                                <span style={{color:G.orange,fontWeight:600}} title="Funcția lipsește în BD — pe ordin va apărea '—'">⚠️ lipsă</span>
                              )}
                            </td>
                            <td style={{padding:'8px 6px',textAlign:'center',color:G.blue}}>{emp.days_real}</td>
                            <td style={{padding:'8px 6px',textAlign:'center',fontWeight:700,color:noZile?G.red:G.orange}}>
                              {emp.diurna_max}
                              {noZile && <span style={{marginLeft:4,fontSize:9,color:G.red}}>(buget consumat)</span>}
                            </td>
                            <td style={{padding:'8px 6px',fontSize:11,color:G.muted}}>
                              {emp.santiere_list.length === 0 ? '—' : emp.santiere_list.join(' / ')}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                
                <div style={{padding:'12px 20px',borderTop:`1px solid ${G.border}`,display:'flex',gap:10,alignItems:'center',justifyContent:'space-between',background:G.bg}}>
                  <div style={{fontSize:11,color:G.muted,flex:1}}>
                    {ordGenerating ? (
                      <div>
                        <div style={{marginBottom:4}}>⏳ Generez {ordGenProgress.done}/{ordGenProgress.total}...</div>
                        <div style={{height:4,background:G.surface,borderRadius:2,overflow:'hidden'}}>
                          <div style={{height:'100%',width:`${ordGenProgress.total?(ordGenProgress.done/ordGenProgress.total)*100:0}%`,background:G.orange,transition:'width .2s'}}/>
                        </div>
                      </div>
                    ) : (
                      <span>💡 Distribuție cronologică pe zile · Template din Storage privat · Semnatari din Admin → Setări</span>
                    )}
                  </div>
                  <button 
                    onClick={()=>{if(!ordGenerating){setShowOrdGen(false);setOrdGenEmps([]);setOrdGenPayment(null)}}} 
                    disabled={ordGenerating}
                    style={{...S.btnS,fontSize:12}}
                  >Anulează</button>
                  <button 
                    onClick={generateOrdine} 
                    disabled={ordGenerating || ordGenEmps.filter(e=>e.selected&&e.diurna_max>0).length===0}
                    style={{...S.btnS,fontSize:12,background:G.orange+'22',color:G.orange,border:`1px solid ${G.orange}66`,opacity:(ordGenerating||ordGenEmps.filter(e=>e.selected&&e.diurna_max>0).length===0)?.5:1}}
                    title="Generează xlsx editabile (fără semnături)"
                  >{ordGenerating ? '⏳' : `📦 ZIP xlsx (${ordGenEmps.filter(e=>e.selected&&e.diurna_max>0).length})`}</button>
                  <button 
                    onClick={generateOrdinePDF} 
                    disabled={ordGenerating || ordGenEmps.filter(e=>e.selected&&e.diurna_max>0).length===0}
                    style={{...S.btnP,background:G.orange,fontSize:12,opacity:(ordGenerating||ordGenEmps.filter(e=>e.selected&&e.diurna_max>0).length===0)?.5:1}}
                    title="Generează PDF-uri cu semnături inserate (gata de printat/semnat)"
                  >{ordGenerating ? '⏳ Generez...' : `📄 PDF cu semnături (${ordGenEmps.filter(e=>e.selected&&e.diurna_max>0).length})`}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Notificare Ordine Lipsă/Overdue (Etapa 7.5 Faza 3.2)
         TKT-2026-0045: ascunsă la cererea Marilenei („nu folosește la nimic").
         Generarea ordinelor rămâne disponibilă din butonul „📄 Ordine Deplasare" de mai jos.
         Reactivare: șterge `false &&` din condiția de mai jos. */}
      {false && !ordineLipsaDismissed && ordineLipsa.length > 0 && (() => {
        const overdueList = ordineLipsa.filter(x => x.status === 'overdue')
        const pendingList = ordineLipsa.filter(x => x.status === 'pending')
        const hasOverdue = overdueList.length > 0
        const accent = hasOverdue ? G.red : G.orange
        const bg = hasOverdue ? '#3D1A1A' : '#3D2A0A'
        const fmtDate = (s) => new Date(s).toLocaleDateString('ro-RO')
        const monthName = (s) => new Date(s + 'T12:00').toLocaleDateString('ro-RO', { month: 'long', year: 'numeric' })
        const openGenForPayment = async (payment_id) => {
          const { data: payment, error } = await supabase.from('diurna_payments').select('*').eq('id', payment_id).maybeSingle()
          if (error || !payment) { showToast('Eroare deschidere plată: ' + (error?.message || 'inexistentă'), 'error'); return }
          openOrdGen(payment)
        }
        return (
          <div style={{
            background: bg,
            border: `2px solid ${accent}`,
            borderRadius: 10,
            marginBottom: 16,
            padding: '12px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,flexWrap:'wrap'}}>
              <div style={{display:'flex',alignItems:'center',gap:10}}>
                <span style={{fontSize:22}}>{hasOverdue ? '🚨' : '⚠️'}</span>
                <div>
                  <div style={{fontSize:14,fontWeight:800,color:accent}}>
                    {hasOverdue 
                      ? `Ordine de deplasare DEPĂȘITE termen (${overdueList.length} ${overdueList.length===1?'plată':'plăți'})`
                      : `Ordine de deplasare de generat (${pendingList.length} ${pendingList.length===1?'plată':'plăți'})`}
                  </div>
                  <div style={{fontSize:11,color:G.muted,marginTop:2}}>
                    {hasOverdue && `${overdueList.length} ${overdueList.length===1?'plată depășită':'plăți depășite'} termen.`}
                    {hasOverdue && pendingList.length > 0 && ' '}
                    {pendingList.length > 0 && `${pendingList.length} în fereastră (1-7 ${monthName(pendingList[0].period_from).split(' ')[0]} viitor).`}
                  </div>
                </div>
              </div>
              <div style={{display:'flex',gap:6,alignItems:'center'}}>
                <button onClick={()=>setOrdineLipsaExpanded(!ordineLipsaExpanded)} style={{...S.btnS,fontSize:11,padding:'5px 10px'}}>
                  {ordineLipsaExpanded ? '▲ Ascunde' : '▼ Detalii'}
                </button>
                <button onClick={()=>setOrdineLipsaDismissed(true)} title="Ascunde până la următorul refresh" style={{background:'none',border:`1px solid ${G.muted}44`,borderRadius:6,padding:'5px 8px',cursor:'pointer',color:G.muted,fontSize:11}}>✕</button>
              </div>
            </div>
            {ordineLipsaExpanded && (
              <div style={{marginTop:4,borderTop:`1px solid ${accent}44`,paddingTop:10}}>
                <table style={{width:'100%',fontSize:11,borderCollapse:'collapse'}}>
                  <thead>
                    <tr style={{color:G.muted}}>
                      <th style={{padding:'4px 6px',textAlign:'left',fontWeight:600}}>Status</th>
                      <th style={{padding:'4px 6px',textAlign:'left',fontWeight:600}}>Perioada</th>
                      <th style={{padding:'4px 6px',textAlign:'center',fontWeight:600}}>Angajați</th>
                      <th style={{padding:'4px 6px',textAlign:'center',fontWeight:600}}>Arhivate</th>
                      <th style={{padding:'4px 6px',textAlign:'center',fontWeight:600}}>Lipsă</th>
                      <th style={{padding:'4px 6px',textAlign:'left',fontWeight:600}}>Deadline</th>
                      <th style={{padding:'4px 6px',textAlign:'center',fontWeight:600,width:170}}>Acțiune</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ordineLipsa.map(r => {
                      const isOver = r.status === 'overdue'
                      const cAccent = isOver ? G.red : G.orange
                      return (
                        <tr key={r.payment_id} style={{borderTop:`1px solid ${G.border}33`}}>
                          <td style={{padding:'6px 6px'}}>
                            <span style={{padding:'2px 8px',borderRadius:10,background:cAccent+'33',color:cAccent,fontSize:10,fontWeight:700}}>
                              {isOver ? `🔴 OVERDUE +${r.zile_depasire}z` : '🟠 PENDING'}
                            </span>
                          </td>
                          <td style={{padding:'6px 6px',fontWeight:600}}>{fmtDate(r.period_from)} – {fmtDate(r.period_to)}</td>
                          <td style={{padding:'6px 6px',textAlign:'center'}}>{r.angajati_cu_zile}</td>
                          <td style={{padding:'6px 6px',textAlign:'center',color:G.green}}>{r.ordine_arhivate}</td>
                          <td style={{padding:'6px 6px',textAlign:'center',color:cAccent,fontWeight:700}}>{r.ordine_lipsa}</td>
                          <td style={{padding:'6px 6px',color:G.muted}}>{fmtDate(r.deadline_generare)}</td>
                          <td style={{padding:'6px 6px',textAlign:'center'}}>
                            <button onClick={()=>openGenForPayment(r.payment_id)} style={{...S.btnP,background:cAccent,fontSize:10,padding:'4px 10px'}} title="Deschide Generator Ordin pentru această plată">📄 Generează acum</button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      })()}

      {/* Export Diurne + Supliment Hrana */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:16}}>
        <div style={{...S.card,padding:14,display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
          <span style={{fontSize:12,fontWeight:700,color:G.orange}}>💰 Export Diurne</span>
          <span style={{fontSize:11,color:G.muted}}>De la:</span>
          <input type="date" value={df} onChange={e=>setDf(e.target.value)} style={{...S.input,width:'auto',padding:'5px 9px',fontSize:12}}/>
          <span style={{fontSize:11,color:G.muted}}>Până la:</span>
          <input type="date" value={dt} onChange={e=>setDt(e.target.value)} style={{...S.input,width:'auto',padding:'5px 9px',fontSize:12}}/>
          <button onClick={()=>requireUnlockThen('diurne')} disabled={expD} style={{...S.btnP,background:'#5A3A00',fontSize:12,display:'flex',alignItems:'center',gap:5}} title="Export Diurne (necesită parolă)">{expD?<><div className="sp"/>...</>:'⬇ Excel'}</button>
          <button onClick={savePayment} disabled={savingPayment} style={{...S.btnP,background:'#1A4A1A',fontSize:12,display:'flex',alignItems:'center',gap:5}}>{savingPayment?<><div className="sp"/>...</>:'💾 Salvează Plată'}</button>
          <button onClick={exportBancaDiurne} disabled={expBT} style={{...S.btnP,background:'#0A3A6A',fontSize:12,display:'flex',alignItems:'center',gap:5}}>{expBT?<><div className="sp"/>...</>:'🏦 Export Bancă'}</button>
          <button onClick={()=>setShowIstoric(true)} style={{...S.btnP,background:G.orange,fontSize:12,display:'flex',alignItems:'center',gap:5}} title="Generează ordine de deplasare (xlsx + PDF cu semnături) — deschide Istoric Plăți Diurne, alegi luna, apoi generezi">📄 Ordine Deplasare</button>
          <button onClick={()=>setShowIstoric(true)} style={{...S.btnS,fontSize:12}}>📋 Istoric</button>
          <button onClick={()=>setShowIstoricOrd(true)} style={{...S.btnS,fontSize:12,background:G.orange+'22',color:G.orange,border:`1px solid ${G.orange}66`}} title="Arhivă PDF-uri ordine deplasare generate">📚 Istoric Ordine</button>
        </div>
        <div style={{...S.card,padding:14,display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
          <span style={{fontSize:12,fontWeight:700,color:'#56D364'}}>🍔 Export Supliment Hrană</span>
          <span style={{fontSize:11,color:G.muted}}>De la:</span>
          <input type="date" value={sf} onChange={e=>setSf(e.target.value)} style={{...S.input,width:'auto',padding:'5px 9px',fontSize:12}}/>
          <span style={{fontSize:11,color:G.muted}}>Până la:</span>
          <input type="date" value={st2} onChange={e=>setSt2(e.target.value)} style={{...S.input,width:'auto',padding:'5px 9px',fontSize:12}}/>
          {hasPontajBrutAccess && (
            <>
              <button onClick={()=>requireUnlockThen('hrana')} disabled={expS} style={{...S.btnP,background:'#1A3A1A',fontSize:12,display:'flex',alignItems:'center',gap:5}} title="Export Supliment Hrană (necesită parolă)">{expS?<><div className="sp"/>...</>:'⬇ Excel'}</button>
              <button onClick={()=>requireUnlockThen('hrana-istoric')} style={{...S.btnS,fontSize:12,background:'#1A3A1A',color:'#56D364',borderColor:'#56D36466'}} title="Istoric exporturi Supliment Hrană (parolat)">📋 Istoric</button>
            </>
          )}
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
  const isSuperAdmin = profile?.is_owner === true
  const isAdmin = isSuperAdmin
  const canEditIban = isSuperAdmin || profile?.can_modify_employees === true
  const [tab,setTab]=useState('sites')
  const [sites,setSites]=useState([]); const [managers,setManagers]=useState([]); const [employees,setEmployees]=useState([])
  const [depozite,setDepozite]=useState([]); const [savingDep,setSavingDep]=useState(false)
  const [depForm,setDepForm]=useState({name:'',cod_3litere:'',site_id:'',adresa:''})
  const [editDep,setEditDep]=useState(null)
  const [calDays,setCalDays]=useState([]); const [settings,setSettings]=useState({diurna_amount:'50',work_hours_per_day:'8'})
  const [load,setLoad]=useState(true); const [toast,showToast]=useToast()
  const fileRef=useRef(null); const calRef=useRef(null)
  const [siteName,setSiteName]=useState(''); const [addingSite,setAddingSite]=useState(false)
  const [editSiteItem,setEditSiteItem]=useState(null); const [editSiteName,setEditSiteName]=useState('')
  const [deletingSite,setDeletingSite]=useState(null) // site being confirmed for delete
  const [nEmail,setNEmail]=useState(''); const [nName,setNName]=useState(''); const [nSite,setNSite]=useState(''); const [nRole,setNRole]=useState('manager_santier'); const [nPwd,setNPwd]=useState(''); const [nDept,setNDept]=useState(''); const [creating,setCreating]=useState(false)
  const [editMgr,setEditMgr]=useState(null) // manager being edited
  const [editMgrModules,setEditMgrModules]=useState({}) // acces module pentru editMgr (key→bool)
  const [editMgrModuleLevels,setEditMgrModuleLevels]=useState({}) // nivel acces per modul: 'editor'|'admin'
  const [eName,setEName]=useState(''); const [eDept,setEDept]=useState(DEPARTMENTS[0]); const [ePos,setEPos]=useState(''); const [eSite,setESite]=useState(''); const [eHireDate,setEHireDate]=useState(''); const [addingE,setAddingE]=useState(false)
  const [empStatusFilter,setEmpStatusFilter]=useState('active') // all | active | inactive
  const [empSearch,setEmpSearch]=useState('')
  const [empDeptFilter,setEmpDeptFilter]=useState('all')
  const [empPosFilter,setEmpPosFilter]=useState('all')
  const [editEmp,setEditEmp]=useState(null)
  const [deleteEmpItem,setDeleteEmpItem]=useState(null)
  const [impPrev,setImpPrev]=useState(null); const [importing,setImporting]=useState(false)

  const [calYear,setCalYear]=useState(new Date().getFullYear())
  // Date Identificare Firmă (din logistica_setari) — folosite pentru aviz, contracte HR, contracte comercial
  const [firmaSettings, setFirmaSettings] = useState({})
  // Setări Ordin Deplasare (singleton row, semnatari)
  const [ordSetari, setOrdSetari] = useState({
    director_aproba: 'Trusu Razvan',
    control_preventiv: 'Tudorache Marilena',
    verificat_decont: 'Mirela Popescu',
    sef_compartiment: 'Udrea Natalia',
  })
  useEffect(()=>{ loadAll() },[tab])
  const loadAll=async()=>{
    setLoad(true)
    const [s,p,e,c,st,ps,fs,os,dep]=await Promise.all([
      supabase.from('sites').select('*').order('name'),
      supabase.from('profiles').select('*').order('name'),
      supabase.from('employees').select('*,sites(name)').order('name'),
      supabase.from('calendar_days').select('*').order('date').limit(60),
      supabase.from('settings').select('*'),
      supabase.from('profile_sites').select('*'),
      supabase.from('logistica_setari').select('key,value').like('key', 'firma%'),
      supabase.from('setari_ordin_deplasare').select('*').eq('id', 1).maybeSingle(),
      supabase.from('logistica_depozite').select('*,sites(name)').order('name'),
    ])
    setSites(s.data||[])
    setDepozite(dep.data||[])
    // Attach site_ids to each manager
    const mgrs=(p.data||[]).map(m=>({...m,site_ids:(ps.data||[]).filter(x=>x.profile_id===m.id).map(x=>x.site_id)}))
    setManagers(mgrs)
    setEmployees(e.data||[]); setCalDays(c.data||[])
    const sm={}; (st.data||[]).forEach(x=>{sm[x.key]=x.value}); setSettings(sm)
    const fm={}; (fs.data||[]).forEach(x=>{fm[x.key]=x.value}); setFirmaSettings(fm)
    if (os.data) setOrdSetari(os.data)
    setLoad(false)
  }
  
  // Save date firmă (în logistica_setari)
  const saveFirmaSetting = async (k, v) => {
    const { error } = await supabase.from('logistica_setari').upsert({ key: k, value: v, updated_at: new Date().toISOString() }, { onConflict: 'key' })
    if (error) { showToast('Eroare salvare: ' + error.message, 'error'); return }
    setFirmaSettings(prev => ({ ...prev, [k]: v }))
    showToast('✓ Salvat')
  }
  
  // Save setări Ordin Deplasare (singleton update)
  const saveOrdSetari = async () => {
    const { error } = await supabase.from('setari_ordin_deplasare').update({
      director_aproba: ordSetari.director_aproba || 'Trusu Razvan',
      control_preventiv: ordSetari.control_preventiv || 'Tudorache Marilena',
      verificat_decont: ordSetari.verificat_decont || 'Mirela Popescu',
      sef_compartiment: ordSetari.sef_compartiment || 'Udrea Natalia',
    }).eq('id', 1)
    if (error) { showToast('Eroare: ' + error.message, 'error'); return }
    showToast('✓ Semnatari salvați — folosiți la generarea ordinelor de deplasare')
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
    const updates = {
      name: editMgr.name,
      role: editMgr.role,
      department: editMgr.department || null
    }
    // Adaug email update doar dacă e diferit (evităm trigger-uri inutile)
    if (editMgr.email && editMgr.email !== editMgr.original_email) {
      updates.email = editMgr.email
    }
    // Acces Salarii: doar OWNER poate modifica acest flag (BD-ul are si un trigger care verifica)
    if (profile?.is_owner === true && editMgr.can_access_salarii !== undefined) {
      updates.can_access_salarii = !!editMgr.can_access_salarii
    }
    // Acces Date Personale (GDPR): doar OWNER (trigger BD verifica la fel)
    if (profile?.is_owner === true && editMgr.can_access_personal_data !== undefined) {
      updates.can_access_personal_data = !!editMgr.can_access_personal_data
    }
    // Acces Pontaj Brut (FCP cu Ore Suplimentare + Istoric): doar OWNER (trigger BD verifică la fel)
    if (profile?.is_owner === true && editMgr.can_access_pontaj_brut !== undefined) {
      updates.can_access_pontaj_brut = !!editMgr.can_access_pontaj_brut
    }
    // Acces Diurne (istoric plăți diurne + ordine deplasare, FĂRĂ salarii): doar OWNER
    if (profile?.is_owner === true && editMgr.can_access_diurne !== undefined) {
      updates.can_access_diurne = !!editMgr.can_access_diurne
    }
    // Modifică Angajați (HR write): doar OWNER (trigger BD verifică la fel). Separat de can_access_personal_data care e DOAR vizualizare GDPR.
    if (profile?.is_owner === true && editMgr.can_modify_employees !== undefined) {
      updates.can_modify_employees = !!editMgr.can_modify_employees
      updates.can_manage_contracts = !!editMgr.can_manage_contracts
    }
    // Scanner Documente AI (Vision): doar OWNER. Trigger BD enforce_owner_only_salary_flags protejeaza la fel.
    if (profile?.is_owner === true && editMgr.can_use_document_scanner !== undefined) {
      updates.can_use_document_scanner = !!editMgr.can_use_document_scanner
    }
    // Etapa 14: 5 flag-uri receive_tichete_* — doar OWNER (trigger BD enforce_owner_only_salary_flags protejeaza)
    ;['receive_tichete_logistica','receive_tichete_hr','receive_tichete_administrativ','receive_tichete_it','receive_tichete_comercial','receive_tichete_financiar'].forEach(flag => {
      if (profile?.is_owner === true && editMgr[flag] !== undefined) {
        updates[flag] = !!editMgr[flag]
      }
    })
    // Etapa 15 Faza 1: 4 flag-uri Comercial — doar OWNER (trigger BD enforce_owner_only_salary_flags protejeaza)
    ;['can_create_comenzi','can_process_achizitii','can_manage_stoc','can_access_ctc'].forEach(flag => {
      if (profile?.is_owner === true && editMgr[flag] !== undefined) {
        updates[flag] = !!editMgr[flag]
      }
    })
    // WhatsApp: phone + enabled poate fi editat de orice owner; tier DOAR de owner (trigger BD verifică)
    if (editMgr.phone_whatsapp !== undefined) {
      updates.phone_whatsapp = editMgr.phone_whatsapp?.trim() || null
    }
    if (editMgr.whatsapp_enabled !== undefined) {
      updates.whatsapp_enabled = !!editMgr.whatsapp_enabled
    }
    if (profile?.is_owner === true && editMgr.whatsapp_tier !== undefined) {
      updates.whatsapp_tier = editMgr.whatsapp_tier || 'info'
    }
    const {error}=await supabase.from('profiles').update(updates).eq('id',editMgr.id)
    if(!error){
      // Update sites in profile_sites table — doar pentru rolurile care au șantiere alocate
      await supabase.from('profile_sites').delete().eq('profile_id',editMgr.id)
      if(ROLES_WITH_SITES.includes(editMgr.role) && editMgr.site_ids?.length>0){
        await supabase.from('profile_sites').insert(editMgr.site_ids.map(sid=>({profile_id:editMgr.id,site_id:sid})))
      }
      // ════ Sync user_module_access — doar Owner (DELETE all + re-INSERT selectate) ════
      if (profile?.is_owner === true) {
        await supabase.from('user_module_access').delete().eq('profile_id', editMgr.id)
        const selectedMods = Object.entries(editMgrModules).filter(([,v])=>v).map(([k])=>k)
        if (selectedMods.length > 0) {
          await supabase.from('user_module_access').insert(
            selectedMods.map(mod => ({ profile_id: editMgr.id, module: mod, access_level: editMgrModuleLevels[mod] || 'editor' }))
          )
        }
      }
      // Update email și în auth.users (dacă schimbat) — via RPC
      if (updates.email) {
        const {error: aErr} = await supabase.rpc('update_user_email_by_admin', { user_id: editMgr.id, new_email: updates.email })
        if (aErr) showToast(`Profil ok dar auth email nu s-a actualizat: ${aErr.message}`, 'warn')
      }
      showToast(`✓ Manager actualizat: ${editMgr.name}`);setEditMgr(null);loadAll()
    } else showToast('Eroare: '+error.message,'error')
  }
  const saveSetting=async(k,v)=>{ await supabase.from('settings').upsert({key:k,value:v,updated_at:new Date().toISOString()},{onConflict:'key'}); setSettings(prev=>({...prev,[k]:v})); showToast('✓ Salvat') }

  const createManager=async()=>{
    if(!nEmail||!nPwd||!nName){showToast('Completați toate câmpurile','warn');return}
    setCreating(true)
    const {data:au,error:ae}=await supabase.auth.signUp({email:nEmail,password:nPwd})
    if(ae){showToast(ae.message,'error');setCreating(false);return}
    if(au.user){
      await supabase.from('profiles').upsert({id:au.user.id,email:nEmail,name:nName,role:nRole,department:nDept||null})
      if(ROLES_WITH_SITES.includes(nRole) && nSite) await supabase.from('profile_sites').insert({profile_id:au.user.id,site_id:Number(nSite)})
      showToast(`✓ ${nName}`); setNEmail('');setNName('');setNPwd('');loadAll()
    }
    setCreating(false)
  }

  const addEmployee=async()=>{ if(!eName.trim()){showToast('Introduceți numele','warn');return}; setAddingE(true); const {error}=await supabase.from('employees').insert({name:eName.trim(),department:eDept,position:ePos||null,site_id:eSite?Number(eSite):null,active:true,hire_date:eHireDate||null}); if(!error){showToast(`✓ ${eName}`);setEName('');setEPos('');setEHireDate('');loadAll()} else showToast('Eroare','error'); setAddingE(false) }
  const toggleEmp=async(emp)=>{ const updates={active:!emp.active}; if(emp.active&&!emp.termination_date) updates.termination_date=new Date().toISOString().split('T')[0]; await supabase.from('employees').update(updates).eq('id',emp.id); setEmployees(prev=>prev.map(e=>e.id===emp.id?{...e,...updates}:e)); showToast(emp.active?`${emp.name} dezactivat`:`${emp.name} reactivat`,emp.active?'warn':'success') }
  const saveEditEmp=async()=>{
    if(!editEmp) return
    // Validare CNP (daca a fost completat)
    if(editEmp.cnp && !/^[0-9]{13}$/.test(editEmp.cnp)){ showToast('CNP invalid: trebuie 13 cifre','warn'); return }
    // Update employees - campurile de baza + 4 noi (date contract)
    const empUpdates = {
      name:editEmp.name,
      position:editEmp.position||null,
      department:editEmp.department,
      site_id:editEmp.site_id||null,
      iban:editEmp.iban||null,
      hire_date:editEmp.hire_date||null,
      termination_date:editEmp.termination_date||null,
      cetatenie:editEmp.cetatenie||null,
      tip_contract:editEmp.tip_contract||null,
      procent_ocupare:editEmp.procent_ocupare?Number(editEmp.procent_ocupare):null,
      co_maxim_zile:editEmp.co_maxim_zile?Number(editEmp.co_maxim_zile):null
    }
    const {error}=await supabase.from('employees').update(empUpdates).eq('id',editEmp.id)
    if(error){ showToast('Eroare: '+error.message,'error'); return }
    // Upsert date personale GDPR in hr_employees_private (gated pe can_access_personal_data || is_owner)
    if(profile?.can_access_personal_data===true || profile?.is_owner===true){
      const hasPrivate = editEmp.cnp||editEmp.data_nastere||editEmp.adresa_strada||editEmp.adresa_oras||editEmp.adresa_judet||editEmp.adresa_cod_postal
      if(hasPrivate){
        const {error:pErr}=await supabase.from('hr_employees_private').upsert({
          employee_id:editEmp.id,
          cnp:editEmp.cnp||null,
          data_nastere:editEmp.data_nastere||null,
          adresa_strada:editEmp.adresa_strada||null,
          adresa_oras:editEmp.adresa_oras||null,
          adresa_judet:editEmp.adresa_judet||null,
          adresa_cod_postal:editEmp.adresa_cod_postal||null,
          adresa_tara:editEmp.adresa_tara||'România'
        },{onConflict:'employee_id'})
        if(pErr){ showToast('Eroare date personale: '+pErr.message,'warn') /* nu blocam, employees a salvat */ }
      }
    }
    showToast(`✓ Salvat: ${editEmp.name}`)
    setEditEmp(null)
    loadAll()
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

  // 25.05.2026: Tab-urile vizibile per flag - Setări strict is_owner
  const allTabs = [
    ['sites',     '🏗️ Șantiere'],
    ['managers',  '👤 Manageri'],
    ['employees', '👥 Angajați'],
    ['calendar',  '📅 Calendar'],
    ['semnaturi', '🖋️ Semnături'],
    ['settings',  '⚙️ Setări'],  // restricted is_owner only
  ]
  const tabs = allTabs.filter(([v]) => {
    if (!isSuperAdmin && !['employees','semnaturi'].includes(v)) return false
    return true
  })
  
  // non-owner (ex. Natalia cu can_modify_employees): redirect orice tab restricționat → 'employees'
  useEffect(() => {
    if (!isSuperAdmin && !['employees','semnaturi'].includes(tab)) setTab('employees')
  }, [isSuperAdmin, tab])

  return (
    <Layout>
      <Toast toast={toast}/>
      <div style={{fontSize:19,fontWeight:800,marginBottom:18}}>
        ⚙ Administrare
        {!isSuperAdmin && (
          <span style={{
            fontSize: 11, color: G.muted, fontWeight: 500, marginLeft: 12,
            background: G.purple+'22', padding: '3px 9px', borderRadius: 6,
            border: `1px solid ${G.purple}55`,
          }}>
            🔓 Acces granular HR
          </span>
        )}
      </div>
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
          <div style={{...S.card,padding:28,width:520,maxHeight:'90vh',overflowY:'auto'}}>
            <div style={{fontSize:15,fontWeight:700,marginBottom:18}}>✏️ Editează Angajat</div>
            <div style={{marginBottom:12}}><Lbl>Nume complet *</Lbl><input style={S.input} value={editEmp.name||''} onChange={e=>setEditEmp({...editEmp,name:e.target.value})}/></div>
            <div style={{marginBottom:12}}><Lbl>Funcție</Lbl><input style={S.input} value={editEmp.position||''} onChange={e=>setEditEmp({...editEmp,position:e.target.value})}/></div>
            {canEditIban&&<div style={{marginBottom:12}}><Lbl>IBAN (plăți bancă) <span style={{fontSize:10,color:G.yellow}}>· editabil Super Admin & HR</span></Lbl><input style={S.input} placeholder="RO49AAAA1B31007593840000" value={editEmp.iban||''} onChange={e=>setEditEmp({...editEmp,iban:e.target.value.toUpperCase().replace(/\s/g,'')})} maxLength={34}/></div>}
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

            {/* === SECTIUNE: Date Contract === */}
            <div style={{marginTop:18,marginBottom:14,padding:'8px 12px',background:G.bg,borderRadius:8,borderLeft:`3px solid ${G.blue}`}}>
              <div style={{fontSize:11,fontWeight:700,color:G.blue,letterSpacing:.3}}>📋 DATE CONTRACT</div>
              <div style={{fontSize:10,color:G.muted,marginTop:2}}>Cetățenie + tip contract + normă + CO maxim</div>
            </div>
            <div style={{display:'flex',gap:10,marginBottom:12}}>
              <div style={{flex:1}}><Lbl>🌍 Cetățenie</Lbl>
                <select value={editEmp.cetatenie||''} onChange={e=>setEditEmp({...editEmp,cetatenie:e.target.value||null})} style={{width:'100%'}}>
                  <option value="">— neselectat —</option>
                  <option value="roman">🇷🇴 Român</option>
                  <option value="ue">🇪🇺 UE</option>
                  <option value="non_ue">🌐 Non-UE</option>
                </select>
              </div>
              <div style={{flex:1}}><Lbl>📑 Tip Contract</Lbl>
                <select value={editEmp.tip_contract||''} onChange={e=>setEditEmp({...editEmp,tip_contract:e.target.value||null})} style={{width:'100%'}}>
                  <option value="">— neselectat —</option>
                  <option value="cim_nedeterminat">CIM Nedeterminat</option>
                  <option value="cim_determinat">CIM Determinat</option>
                  <option value="part_time">Part-time</option>
                </select>
              </div>
            </div>
            <div style={{display:'flex',gap:10,marginBottom:12}}>
              <div style={{flex:1}}><Lbl>⏱ Procent Ocupare</Lbl>
                <select value={editEmp.procent_ocupare||''} onChange={e=>setEditEmp({...editEmp,procent_ocupare:e.target.value||null})} style={{width:'100%'}}>
                  <option value="">— neselectat —</option>
                  <option value="100">100% (8H/zi)</option>
                  <option value="50">50% (4H/zi)</option>
                  <option value="25">25% (2H/zi)</option>
                </select>
              </div>
              <div style={{flex:1}}><Lbl>🏖 CO Maxim (zile/an)</Lbl>
                <input style={S.input} type="number" min={1} max={50} placeholder="21" value={editEmp.co_maxim_zile||''} onChange={e=>setEditEmp({...editEmp,co_maxim_zile:e.target.value||null})}/>
              </div>
            </div>

            {/* === SECTIUNE: Date Personale GDPR (RLS filtreaza automat) === */}
            {(profile?.can_access_personal_data===true || profile?.is_owner===true) && (
              <>
                <div style={{marginTop:18,marginBottom:14,padding:'8px 12px',background:'#2A1A1A',borderRadius:8,borderLeft:`3px solid ${G.red}`}}>
                  <div style={{fontSize:11,fontWeight:700,color:G.red,letterSpacing:.3}}>🔒 DATE PERSONALE (GDPR)</div>
                  <div style={{fontSize:10,color:G.muted,marginTop:2}}>CNP + data naștere + adresă · Acces strict HR/SuperAdmin · Salvate în <code style={{fontSize:9,color:G.yellow}}>hr_employees_private</code></div>
                </div>
                <div style={{display:'flex',gap:10,marginBottom:12}}>
                  <div style={{flex:1.5}}><Lbl>🆔 CNP (13 cifre)</Lbl>
                    <input style={{...S.input,borderColor:editEmp.cnp&&!/^[0-9]{13}$/.test(editEmp.cnp)?G.red:G.border2,fontFamily:'monospace',letterSpacing:1}} placeholder="1234567890123" value={editEmp.cnp||''} onChange={e=>setEditEmp({...editEmp,cnp:e.target.value.replace(/\D/g,'').slice(0,13)})} maxLength={13}/>
                    {editEmp.cnp&&!/^[0-9]{13}$/.test(editEmp.cnp)&&<div style={{fontSize:10,color:G.red,marginTop:3}}>⚠ Trebuie 13 cifre</div>}
                  </div>
                  <div style={{flex:1}}><Lbl>🎂 Data Nașterii</Lbl>
                    <input style={S.input} type="date" value={editEmp.data_nastere||''} onChange={e=>setEditEmp({...editEmp,data_nastere:e.target.value||null})}/>
                  </div>
                </div>
                <div style={{marginBottom:12}}><Lbl>🏠 Stradă, Număr, Bloc, Apartament</Lbl>
                  <input style={S.input} placeholder="Str. Memorandumului nr. 12, bl. A, ap. 5" value={editEmp.adresa_strada||''} onChange={e=>setEditEmp({...editEmp,adresa_strada:e.target.value})}/>
                </div>
                <div style={{display:'flex',gap:10,marginBottom:12}}>
                  <div style={{flex:1.5}}><Lbl>🏙 Oraș</Lbl>
                    <input style={S.input} placeholder="Brașov" value={editEmp.adresa_oras||''} onChange={e=>setEditEmp({...editEmp,adresa_oras:e.target.value})}/>
                  </div>
                  <div style={{flex:1.5}}><Lbl>📍 Județ</Lbl>
                    <input style={S.input} placeholder="Brașov" value={editEmp.adresa_judet||''} onChange={e=>setEditEmp({...editEmp,adresa_judet:e.target.value})}/>
                  </div>
                  <div style={{flex:1}}><Lbl>📮 Cod Poștal</Lbl>
                    <input style={S.input} placeholder="500001" value={editEmp.adresa_cod_postal||''} onChange={e=>setEditEmp({...editEmp,adresa_cod_postal:e.target.value.replace(/\D/g,'').slice(0,6)})} maxLength={6}/>
                  </div>
                </div>
              </>
            )}

            <div style={{display:'flex',gap:10,marginTop:18}}>
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
          <div style={{...S.card,padding:28,width:440,maxHeight:'90vh',overflowY:'auto'}}>
            <div style={{fontSize:15,fontWeight:700,marginBottom:18}}>✏️ Editează Manager</div>
            <div style={{marginBottom:12}}><Lbl>Nume complet</Lbl><input style={S.input} value={editMgr.name||''} onChange={e=>setEditMgr({...editMgr,name:e.target.value})}/></div>
            <div style={{marginBottom:12}}><Lbl>Email</Lbl>
              <input style={S.input} type="email" value={editMgr.email||''} onChange={e=>setEditMgr({...editMgr,email:e.target.value})}/>
              <div style={{fontSize:10,color:G.muted,marginTop:3}}>⚠ Schimbarea email-ului afectează autentificarea</div>
            </div>
            <div style={{marginBottom:12}}><Lbl>Rol</Lbl>
              <select value={editMgr.role} onChange={e=>setEditMgr({...editMgr,role:e.target.value})} style={{width:'100%'}}>
                <option value="superadmin">⭐ Super Admin</option>
                <option value="admin_logistica">🚛 Admin Logistică</option>
                <option value="manager_santier">👤 Manager Șantier</option>
                <option value="sef_echipa">🏗️ Șef Echipă</option>
                <option value="contabilitate">💵 Contabilitate</option>
                <option value="hr">👥 HR</option>
                <option value="gestionar">🏭 Gestionar</option>
                <option value="magazioner">📦 Magazioner</option>
              </select>
            </div>
            <div style={{marginBottom:12}}><Lbl>🏢 Departament</Lbl>
              <select value={editMgr.department || ''} onChange={e=>setEditMgr({...editMgr,department:e.target.value || null})} style={{width:'100%'}}>
                <option value="">— niciunul —</option>
                <option value="Execuție">⚙️ Execuție</option>
                <option value="Logistică">🚛 Logistică</option>
                <option value="TESA">📋 TESA</option>
                <option value="HR">👥 HR</option>
                <option value="Administrativ">🏢 Administrativ</option>
                <option value="Contabilitate">💵 Contabilitate</option>
                <option value="Financiar">💰 Financiar</option>
                <option value="Comercial">🛒 Comercial</option>
                <option value="Ofertare">📋 Ofertare</option>
                <option value="Magazie">📦 Magazie</option>
                <option value="IT">💻 IT</option>
              </select>
              <div style={{fontSize:10,color:G.muted,marginTop:3}}>Pe viitor: drepturile pot fi legate de departament</div>
            </div>
            {profile?.is_owner === true && editMgr.id !== profile?.id && (
              <div style={{marginBottom:14,padding:12,background:editMgr.can_access_salarii?'#2A1A2A':'#1A1A1F',borderRadius:8,border:`1px solid ${editMgr.can_access_salarii?G.red:G.border}66`}}>
                <label style={{display:'flex',alignItems:'flex-start',gap:10,cursor:'pointer'}}>
                  <input type="checkbox"
                    checked={!!editMgr.can_access_salarii}
                    onChange={e=>setEditMgr({...editMgr,can_access_salarii:e.target.checked})}
                    style={{accentColor:G.red,width:16,height:16,marginTop:2}}
                  />
                  <div style={{flex:1}}>
                    <div style={{fontSize:12,fontWeight:700,color:editMgr.can_access_salarii?G.red:G.text}}>
                      🔐 Acces la Salarii (GDPR)
                    </div>
                    <div style={{fontSize:10,color:G.muted,marginTop:3,lineHeight:1.5}}>
                      Doar <strong style={{color:G.yellow}}>OWNER</strong> poate modifica. Permite vizualizare salarii brute/nete, contracte, taxe, declarația 112. Toate accesele sunt înregistrate în audit log.
                    </div>
                  </div>
                </label>
              </div>
            )}
            {profile?.is_owner === true && editMgr.id !== profile?.id && (
              <div style={{marginBottom:14,padding:12,background:editMgr.can_access_personal_data?'#2A1A2A':'#1A1A1F',borderRadius:8,border:`1px solid ${editMgr.can_access_personal_data?G.purple:G.border}66`}}>
                <label style={{display:'flex',alignItems:'flex-start',gap:10,cursor:'pointer'}}>
                  <input type="checkbox"
                    checked={!!editMgr.can_access_personal_data}
                    onChange={e=>setEditMgr({...editMgr,can_access_personal_data:e.target.checked})}
                    style={{accentColor:G.purple,width:16,height:16,marginTop:2}}
                  />
                  <div style={{flex:1}}>
                    <div style={{fontSize:12,fontWeight:700,color:editMgr.can_access_personal_data?G.purple:G.text}}>
                      🆔 Acces Date Personale (GDPR)
                    </div>
                    <div style={{fontSize:10,color:G.muted,marginTop:3,lineHeight:1.5}}>
                      Doar <strong style={{color:G.yellow}}>OWNER</strong> poate modifica. Permite vizualizare/edit CNP, data nașterii, adresă completă. Necesar pentru HR/contracte.
                    </div>
                  </div>
                </label>
              </div>
            )}
            {profile?.is_owner === true && editMgr.id !== profile?.id && (
              <div style={{marginBottom:14,padding:12,background:editMgr.can_access_pontaj_brut?'#1A2A1F':'#1A1A1F',borderRadius:8,border:`1px solid ${editMgr.can_access_pontaj_brut?G.green:G.border}66`}}>
                <label style={{display:'flex',alignItems:'flex-start',gap:10,cursor:'pointer'}}>
                  <input type="checkbox"
                    checked={!!editMgr.can_access_pontaj_brut}
                    onChange={e=>setEditMgr({...editMgr,can_access_pontaj_brut:e.target.checked})}
                    style={{accentColor:G.green,width:16,height:16,marginTop:2}}
                  />
                  <div style={{flex:1}}>
                    <div style={{fontSize:12,fontWeight:700,color:editMgr.can_access_pontaj_brut?G.green:G.text}}>
                      📊 Acces Pontaj Brut
                    </div>
                    <div style={{fontSize:10,color:G.muted,marginTop:3,lineHeight:1.5}}>
                      Doar <strong style={{color:G.yellow}}>OWNER</strong> poate modifica. Permite Export Pontaj Brut (FCP cu Ore Suplimentare) + Istoric exporturi (parolat). Bifează doar pentru utilizatorii responsabili cu salariile.
                    </div>
                  </div>
                </label>
              </div>
            )}
            {profile?.is_owner === true && editMgr.id !== profile?.id && (
              <div style={{marginBottom:14,padding:12,background:editMgr.can_access_diurne?'#1F1A2A':'#1A1A1F',borderRadius:8,border:`1px solid ${editMgr.can_access_diurne?G.purple:G.border}66`}}>
                <label style={{display:'flex',alignItems:'flex-start',gap:10,cursor:'pointer'}}>
                  <input type="checkbox"
                    checked={!!editMgr.can_access_diurne}
                    onChange={e=>setEditMgr({...editMgr,can_access_diurne:e.target.checked})}
                    style={{accentColor:G.purple,width:16,height:16,marginTop:2}}
                  />
                  <div style={{flex:1}}>
                    <div style={{fontSize:12,fontWeight:700,color:editMgr.can_access_diurne?G.purple:G.text}}>
                      💶 Acces Diurne & Ordine Deplasare
                    </div>
                    <div style={{fontSize:10,color:G.muted,marginTop:3,lineHeight:1.5}}>
                      Doar <strong style={{color:G.yellow}}>OWNER</strong> poate modifica. Permite vizualizarea istoricului plăților diurne + generarea ordinelor de deplasare. <strong>NU</strong> dă acces la salarii. Potrivit pentru HR.
                    </div>
                  </div>
                </label>
              </div>
            )}
            {profile?.is_owner === true && editMgr.id !== profile?.id && (
              <>
              <div style={{marginBottom:14,padding:12,background:editMgr.can_modify_employees?'#2A1F0F':'#1A1A1F',borderRadius:8,border:`1px solid ${editMgr.can_modify_employees?G.orange:G.border}66`}}>
                <label style={{display:'flex',alignItems:'flex-start',gap:10,cursor:'pointer'}}>
                  <input type="checkbox"
                    checked={!!editMgr.can_modify_employees}
                    onChange={e=>setEditMgr({...editMgr,can_modify_employees:e.target.checked})}
                    style={{accentColor:G.orange,width:16,height:16,marginTop:2}}
                  />
                  <div style={{flex:1}}>
                    <div style={{fontSize:12,fontWeight:700,color:editMgr.can_modify_employees?G.orange:G.text}}>
                      ✏️ Modifică Angajați (WRITE)
                    </div>
                    <div style={{fontSize:10,color:G.muted,marginTop:3,lineHeight:1.5}}>
                      Doar <strong style={{color:G.yellow}}>OWNER</strong> poate modifica. Permite <strong>adăugare/editare/ștergere</strong> angajați în modulul HR. Necesar pentru personalul de resurse umane. <strong style={{color:G.purple}}>Separat de „Acces Date Personale"</strong> care permite DOAR vizualizare CNP/adresă (fără modificare).
                    </div>
                  </div>
                </label>
              </div>
              <div style={{marginBottom:14,padding:12,background:editMgr.can_manage_contracts?'#1F2A1F':'#1A1A1F',borderRadius:8,border:`1px solid ${editMgr.can_manage_contracts?'#2EA043':G.border}66`}}>
                <label style={{display:'flex',alignItems:'flex-start',gap:10,cursor:'pointer'}}>
                  <input type="checkbox"
                    checked={!!editMgr.can_manage_contracts}
                    onChange={e=>setEditMgr({...editMgr,can_manage_contracts:e.target.checked})}
                    style={{accentColor:'#2EA043',width:16,height:16,marginTop:2}}
                  />
                  <div style={{flex:1}}>
                    <div style={{fontSize:12,fontWeight:700,color:editMgr.can_manage_contracts?'#2EA043':G.text}}>
                      📋 Contracte cu Terți (WRITE)
                    </div>
                    <div style={{fontSize:10,color:G.muted,marginTop:3,lineHeight:1.5}}>
                      Permite <strong>adăugare/editare contracte</strong> în Administrativ → Contracte cu Terți. Fără acest flag, utilizatorul poate doar vizualiza. Necesar pentru personalul care gestionează contractele.
                    </div>
                  </div>
                </label>
              </div>
              </>
            )}
            {profile?.is_owner === true && editMgr.id !== profile?.id && (
              <div style={{marginBottom:14,padding:12,background:editMgr.can_use_document_scanner?'#0F1F3A':'#1A1A1F',borderRadius:8,border:`1px solid ${editMgr.can_use_document_scanner?G.blue:G.border}66`}}>
                <label style={{display:'flex',alignItems:'flex-start',gap:10,cursor:'pointer'}}>
                  <input type="checkbox"
                    checked={!!editMgr.can_use_document_scanner}
                    onChange={e=>setEditMgr({...editMgr,can_use_document_scanner:e.target.checked})}
                    style={{accentColor:G.blue,width:16,height:16,marginTop:2}}
                  />
                  <div style={{flex:1}}>
                    <div style={{fontSize:12,fontWeight:700,color:editMgr.can_use_document_scanner?G.blue:G.text}}>
                      📷 Scanner Documente AI
                    </div>
                    <div style={{fontSize:10,color:G.muted,marginTop:3,lineHeight:1.5}}>
                      Doar <strong style={{color:G.yellow}}>OWNER</strong> poate modifica. Permite scanare automată documente (ITP/RCA/Buletin/Aviz Medical etc.) cu Claude Vision AI. Costuri vizibile în <strong style={{color:G.green}}>Administrativ → Costuri AI</strong> (~$0.009/scan, ~0.05 RON).
                    </div>
                  </div>
                </label>
              </div>
            )}
            {/* ════════════════ Etapa 14: Tichete - flag-uri per departament ════════════════ */}
            {profile?.is_owner === true && editMgr.id !== profile?.id && (
              <div style={{marginBottom:14,padding:14,background:'#1A1A1F',borderRadius:8,border:`1px solid ${G.border}66`}}>
                <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}>
                  <span style={{fontSize:18}}>🎫</span>
                  <div style={{fontSize:13,fontWeight:800,color:G.text}}>
                    Tichete — Primește notificări pe departament
                  </div>
                </div>
                <div style={{fontSize:10,color:G.muted,marginBottom:10,lineHeight:1.5}}>
                  Doar <strong style={{color:G.yellow}}>OWNER</strong> poate modifica. Utilizatorii cu flag bifat <strong>văd widgetul „Tichete deschise"</strong> în modulul respectiv, pot prelua tichete neatribuite, și primesc notificare in-app la fiecare tichet nou.
                </div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(2, 1fr)',gap:8}}>
                  {[
                    { key:'receive_tichete_logistica',     label:'🚜 Logistica',     color:G.orange },
                    { key:'receive_tichete_hr',            label:'👥 HR',            color:'#F778BA' },
                    { key:'receive_tichete_administrativ', label:'🏢 Administrativ', color:G.blue   },
                    { key:'receive_tichete_it',            label:'💻 IT',            color:G.purple },
                    { key:'receive_tichete_comercial',     label:'🛒 Comercial',     color:G.green  },
                    { key:'receive_tichete_financiar',     label:'💰 Financiar',     color:G.yellow },
                  ].map(f => (
                    <label key={f.key} style={{
                      display:'flex',alignItems:'center',gap:8,cursor:'pointer',padding:'8px 10px',
                      background:editMgr[f.key]?f.color+'22':G.bg,
                      border:`1px solid ${editMgr[f.key]?f.color+'88':G.border2}`,
                      borderRadius:6
                    }}>
                      <input type="checkbox"
                        checked={!!editMgr[f.key]}
                        onChange={e=>setEditMgr({...editMgr,[f.key]:e.target.checked})}
                        style={{accentColor:f.color,width:14,height:14}}
                      />
                      <span style={{fontSize:12,fontWeight:editMgr[f.key]?700:500,color:editMgr[f.key]?f.color:G.text}}>
                        {f.label}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            {/* ════════════════ Etapa 15 Faza 1: Comercial - 4 flag-uri acces ════════════════ */}
            {profile?.is_owner === true && editMgr.id !== profile?.id && (
              <div style={{marginBottom:14,padding:14,background:'#1A1A1F',borderRadius:8,border:`1px solid ${G.border}66`}}>
                <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}>
                  <span style={{fontSize:18}}>🛒</span>
                  <div style={{fontSize:13,fontWeight:800,color:G.text}}>
                    Comercial — Acces module Faza 4-6
                  </div>
                </div>
                <div style={{fontSize:10,color:G.muted,marginBottom:10,lineHeight:1.5}}>
                  Doar <strong style={{color:G.yellow}}>OWNER</strong> poate modifica. Flag-urile bifate permit acces la modulele specifice când le construim (Faza 4 = Comenzi, Faza 5 = CTC, Faza 6 = Magazie). Acces la pagini NU înseamnă acces automat — modulele tot trebuie adăugate în <code style={{background:G.bg,padding:'1px 5px',borderRadius:3}}>user_module_access</code> separat.
                </div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(2, 1fr)',gap:8}}>
                  {[
                    { key:'can_create_comenzi',     label:'🛒 Creează comenzi (MP)', color:'#A371F7' },
                    { key:'can_process_achizitii',  label:'📥 Procesează Achiziții',  color:G.green   },
                    { key:'can_manage_stoc',        label:'📦 Gestionează Magazie',   color:'#FF7B72' },
                    { key:'can_access_ctc',         label:'📑 Acces CTC',             color:G.purple  },
                  ].map(f => (
                    <label key={f.key} style={{
                      display:'flex',alignItems:'center',gap:8,cursor:'pointer',padding:'8px 10px',
                      background:editMgr[f.key]?f.color+'22':G.bg,
                      border:`1px solid ${editMgr[f.key]?f.color+'88':G.border2}`,
                      borderRadius:6
                    }}>
                      <input type="checkbox"
                        checked={!!editMgr[f.key]}
                        onChange={e=>setEditMgr({...editMgr,[f.key]:e.target.checked})}
                        style={{accentColor:f.color,width:14,height:14}}
                      />
                      <span style={{fontSize:12,fontWeight:editMgr[f.key]?700:500,color:editMgr[f.key]?f.color:G.text}}>
                        {f.label}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            {/* ════════════════ Acces Module — Owner Only ════════════════ */}
            {profile?.is_owner === true && editMgr.id !== profile?.id && (
              <div style={{marginBottom:14,padding:14,background:'#15111F',borderRadius:8,border:`1px solid ${G.purple}55`}}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
                  <div style={{display:'flex',alignItems:'center',gap:8}}>
                    <span style={{fontSize:18}}>🗂️</span>
                    <div style={{fontSize:13,fontWeight:800,color:G.text}}>Acces Module</div>
                  </div>
                  <span style={{fontSize:10,padding:'2px 8px',background:G.purple+'22',color:G.purple,borderRadius:10,fontWeight:700}}>OWNER ONLY</span>
                </div>
                <div style={{fontSize:10,color:G.muted,marginBottom:10,lineHeight:1.5}}>
                  Bifează modulele vizibile în navigație. Tichete + Execuție + Financiar sunt accesibile tuturor dar apar în meniu doar dacă sunt bifate. Sensibile (Salarii, Date Personale) → flag-urile de mai sus.
                </div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:6}}>
                  {[
                    {key:'logistica',    label:'Logistică',    emoji:'🚜', color:G.yellow},
                    {key:'administrativ',label:'Administrativ',emoji:'🏢', color:G.blue},
                    {key:'comercial',    label:'Comercial',    emoji:'🛒', color:G.green},
                    {key:'achizitii',    label:'Achiziții',    emoji:'📥', color:G.purple},
                    {key:'ofertare',     label:'Ofertare',     emoji:'💡', color:'#2DD4BF'},
                    {key:'magazie',      label:'Magazie',      emoji:'📦', color:G.orange},
                    {key:'ctc',          label:'CTC',          emoji:'📑', color:'#58A6FF'},
                    {key:'executie',     label:'Execuție',     emoji:'⚙️', color:G.green},
                    {key:'financiar',    label:'Financiar',    emoji:'💰', color:'#2EA043'},
                    {key:'hr',           label:'HR',           emoji:'👥', color:'#EC6CB9'},
                    {key:'pontajpro',    label:'PontajPRO',    emoji:'📊', color:'#58A6FF'},
                  ].map(m => {
                    const active = !!editMgrModules[m.key]
                    const lvl = editMgrModuleLevels[m.key] || 'editor'
                    return (
                      <div key={m.key} style={{background:active?m.color+'22':G.bg,border:`1px solid ${active?m.color+'88':G.border2}`,borderRadius:6,overflow:'hidden'}}>
                        <label style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer',padding:'7px 9px'}}>
                          <input type="checkbox" checked={active} onChange={e=>setEditMgrModules({...editMgrModules,[m.key]:e.target.checked})} style={{accentColor:m.color,width:13,height:13}}/>
                          <span style={{fontSize:11,fontWeight:active?700:500,color:active?m.color:G.text,whiteSpace:'nowrap',flex:1}}>{m.emoji} {m.label}</span>
                        </label>
                        {active && (
                          <select
                            value={lvl}
                            onChange={e=>setEditMgrModuleLevels({...editMgrModuleLevels,[m.key]:e.target.value})}
                            style={{width:'100%',fontSize:10,padding:'2px 6px',background:m.color+'11',border:`none`,borderTop:`1px solid ${m.color+'33'}`,color:m.color,cursor:'pointer',outline:'none'}}
                          >
                            <option value="editor">👁 Vizualizare (editor)</option>
                            <option value="admin">✏️ Editare completă (admin)</option>
                          </select>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
            {/* ════════════════ WhatsApp Notifications ════════════════ */}
            <div style={{marginBottom:14,padding:14,background:editMgr.whatsapp_enabled?'#0F2A1F':'#1A1A1F',borderRadius:8,border:`1px solid ${editMgr.whatsapp_enabled?'#25D366':G.border}66`}}>
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}>
                <span style={{fontSize:18}}>📱</span>
                <div style={{fontSize:13,fontWeight:800,color:editMgr.whatsapp_enabled?'#25D366':G.text}}>
                  WhatsApp Business — Notificări
                </div>
              </div>
              
              {/* Telefon */}
              <div style={{marginBottom:10}}>
                <Lbl>Telefon WhatsApp (format internațional)</Lbl>
                <input 
                  style={{...S.input,fontFamily:'monospace'}} 
                  value={editMgr.phone_whatsapp||''} 
                  onChange={e=>setEditMgr({...editMgr,phone_whatsapp:e.target.value})}
                  placeholder="+40712345678"
                  pattern="^\+[0-9]{10,15}$"
                />
                <div style={{fontSize:10,color:G.muted,marginTop:3}}>Format: +40 urmat de prefix și număr, fără spații (ex: +40712345678)</div>
              </div>
              
              {/* Tier - DOAR pentru owner */}
              {profile?.is_owner === true && editMgr.id !== profile?.id && (
                <div style={{marginBottom:10}}>
                  <Lbl>📊 Tier alerte (cine ce primește) — doar OWNER setează</Lbl>
                  <select 
                    value={editMgr.whatsapp_tier || 'info'} 
                    onChange={e=>setEditMgr({...editMgr,whatsapp_tier:e.target.value})} 
                    style={{width:'100%'}}>
                    <option value="critic">🔴 Critic (owners - tot inclusiv security)</option>
                    <option value="manager">🟠 Manager (șefi proiect - echipa lor)</option>
                    <option value="hr_contabil">🟡 HR/Contabil (plăți, concedii, ITM)</option>
                    <option value="info">⚪ Info (doar UI banner, FĂRĂ WhatsApp)</option>
                  </select>
                  <div style={{fontSize:10,color:G.muted,marginTop:3,lineHeight:1.5}}>
                    Tier-ul determină ce <strong>tipuri</strong> de alerte primește userul pe WhatsApp.
                  </div>
                </div>
              )}
              
              {/* Toggle activ */}
              <label style={{display:'flex',alignItems:'center',gap:10,cursor:'pointer',padding:'8px 10px',background:G.bg,borderRadius:6,border:`1px solid ${G.border}`}}>
                <input type="checkbox"
                  checked={!!editMgr.whatsapp_enabled}
                  onChange={e=>setEditMgr({...editMgr,whatsapp_enabled:e.target.checked})}
                  disabled={!editMgr.phone_whatsapp || editMgr.whatsapp_tier === 'info'}
                  style={{accentColor:'#25D366',width:16,height:16}}
                />
                <div style={{flex:1}}>
                  <div style={{fontSize:12,fontWeight:700,color:editMgr.whatsapp_enabled?'#25D366':G.text}}>
                    {editMgr.whatsapp_enabled ? '✅ Notificări WhatsApp ACTIVE' : '⏸️ Notificări WhatsApp inactive'}
                  </div>
                  <div style={{fontSize:10,color:G.muted,marginTop:2}}>
                    {!editMgr.phone_whatsapp ? '⚠️ Adaugă telefon mai întâi' : 
                     editMgr.whatsapp_tier === 'info' ? '⚠️ Tier „Info" nu primește WhatsApp (doar UI)' :
                     'Userul poate opt-out singur din contul propriu (când implementăm UI Setări)'}
                  </div>
                </div>
              </label>
            </div>
            {ROLES_WITH_SITES.includes(editMgr.role)&&(
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
            <div style={{display:'flex',gap:10,marginBottom:10}}>
              <button onClick={()=>setEditMgr(null)} style={{...S.btnS,flex:1}}>Anulează</button>
              <button onClick={saveEditMgr} style={{...S.btnP,flex:1}}>✓ Salvează</button>
            </div>
            
            {/* Delete user (admin only, nu te poți șterge pe tine) */}
            {editMgr.id !== profile?.id && (
              <div style={{marginTop:18,paddingTop:14,borderTop:`1px dashed ${G.border}`}}>
                <button onClick={async () => {
                  if (!confirm(`⚠️ ATENȚIE: ștergi PERMANENT user-ul "${editMgr.name}" (${editMgr.email})?\n\n• Profil + autentificare șterse\n• Pontajele și transporturile rămân (referințe la nume)\n• Acțiune IREVERSIBILĂ`)) return
                  // Delete profile_sites mapping
                  await supabase.from('profile_sites').delete().eq('profile_id', editMgr.id)
                  // Delete profile
                  const {error: pErr} = await supabase.from('profiles').delete().eq('id', editMgr.id)
                  if (pErr) { showToast('Eroare ștergere profil: '+pErr.message,'error'); return }
                  // Delete auth user via RPC (server-side)
                  const {error: aErr} = await supabase.rpc('delete_user_by_admin', { user_id: editMgr.id })
                  if (aErr) { showToast(`Profil șters dar auth user a rămas: ${aErr.message}`,'warn') }
                  else { showToast(`✓ User "${editMgr.name}" șters complet`) }
                  setEditMgr(null); loadAll()
                }} style={{...S.btnS,width:'100%',color:G.red,borderColor:G.red+'88'}}>
                  🗑️ Șterge user permanent
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {tab==='sites'&&(
        <>
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

        {/* ═══════════ DEPOZITE MATERIALE ═══════════ */}
        <div style={{marginTop:22}}>
          <div style={{fontSize:14,fontWeight:800,color:G.text,marginBottom:12,display:'flex',alignItems:'center',gap:8}}>
            🏭 Depozite materiale
            <span style={{fontSize:10,color:G.muted,fontWeight:500}}>— locații fizice de stocare (legate la șantier, generează seria avizului)</span>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 300px',gap:18}}>
            <div style={{...S.card,overflow:'hidden'}}>
              <table><thead><tr style={{background:G.bg}}>
                <th>Depozit</th><th>Serie aviz</th><th>Șantier</th><th>Adresă</th><th>Status</th><th></th>
              </tr></thead>
              <tbody>{depozite.map(d=>(
                <tr key={d.id}>
                  <td style={{fontWeight:700}}>{d.name}</td>
                  <td><span style={{fontFamily:'monospace',fontSize:11,padding:'2px 7px',background:G.purple+'22',color:G.purple,borderRadius:5,fontWeight:700}}>GAZ/TR/INTERN/{d.cod_3litere}</span></td>
                  <td style={{color:G.muted,fontSize:12}}>{d.sites?.name||<span style={{color:G.dim}}>—</span>}</td>
                  <td style={{fontSize:11,color:G.muted}}>{d.adresa||'—'}</td>
                  <td><span style={{padding:'2px 8px',borderRadius:20,fontSize:11,fontWeight:700,background:d.activ?G.greenDim:G.redDim,color:d.activ?G.green:G.red}}>{d.activ?'● Activ':'○ Inactiv'}</span></td>
                  <td style={{display:'flex',gap:5}}>
                    <button onClick={()=>setEditDep(d)} style={{...S.btnS,padding:'3px 9px',fontSize:11}}>✏️</button>
                    <button onClick={async()=>{await supabase.from('logistica_depozite').update({activ:!d.activ}).eq('id',d.id);loadAll()}} style={{...S.btnS,padding:'3px 9px',fontSize:11}}>{d.activ?'Dezact.':'Activ.'}</button>
                  </td>
                </tr>
              ))}{!depozite.length&&<tr><td colSpan={6} style={{textAlign:'center',color:G.muted,padding:24,fontSize:12}}>Niciun depozit adăugat</td></tr>}</tbody>
              </table>
            </div>
            <div style={{...S.card,padding:20}}>
              <div style={{fontSize:13,fontWeight:700,marginBottom:14}}>{editDep?'✏️ Editează depozit':'+ Depozit nou'}</div>
              {[{l:'Nume depozit',k:'name',ph:'ex: Balvanești'},{l:'Cod 3 litere',k:'cod_3litere',ph:'ex: BAL',max:3},{l:'Adresă',k:'adresa',ph:'Localitate, județ'}].map(f=>(
                <div key={f.k} style={{marginBottom:10}}>
                  <Lbl>{f.l}</Lbl>
                  <input style={S.input} placeholder={f.ph} maxLength={f.max||100}
                    value={editDep?editDep[f.k]||'':depForm[f.k]}
                    onChange={e=>{const v=f.k==='cod_3litere'?e.target.value.toUpperCase().replace(/[^A-Z]/g,'').substring(0,3):e.target.value;editDep?setEditDep({...editDep,[f.k]:v}):setDepForm({...depForm,[f.k]:v})}}/>
                </div>
              ))}
              <div style={{marginBottom:14}}>
                <Lbl>Șantier asociat</Lbl>
                <select style={S.input} value={editDep?editDep.site_id||'':depForm.site_id} onChange={e=>editDep?setEditDep({...editDep,site_id:e.target.value}):setDepForm({...depForm,site_id:e.target.value})}>
                  <option value=''>— Fără șantier —</option>
                  {sites.filter(s=>s.active).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              {editDep?(
                <div style={{display:'flex',gap:8}}>
                  <button onClick={()=>setEditDep(null)} style={{...S.btnS,flex:1}}>Anulează</button>
                  <button disabled={savingDep} style={{...S.btnP,flex:1}} onClick={async()=>{
                    if(!editDep.name||!editDep.cod_3litere){showToast('Completați numele și codul','warn');return}
                    setSavingDep(true)
                    await supabase.from('logistica_depozite').update({name:editDep.name,cod_3litere:editDep.cod_3litere,site_id:editDep.site_id?parseInt(editDep.site_id):null,adresa:editDep.adresa||null}).eq('id',editDep.id)
                    showToast('✓ Depozit actualizat');setEditDep(null);loadAll();setSavingDep(false)
                  }}>✓ Salvează</button>
                </div>
              ):(
                <button disabled={savingDep||!depForm.name||!depForm.cod_3litere} style={{...S.btnP,width:'100%'}} onClick={async()=>{
                  if(!depForm.name||!depForm.cod_3litere){showToast('Completați numele și codul','warn');return}
                  setSavingDep(true)
                  const cod=depForm.cod_3litere.toUpperCase()
                  await supabase.from('logistica_depozite').insert({name:depForm.name,cod_3litere:cod,site_id:depForm.site_id?parseInt(depForm.site_id):null,adresa:depForm.adresa||null})
                  await supabase.from('avize_serii_counter').upsert({serie:`GAZ/TR/INTERN/${cod}`,last_nr:0},{onConflict:'serie',ignoreDuplicates:true})
                  showToast(`✓ ${depForm.name} adăugat`);setDepForm({name:'',cod_3litere:'',site_id:'',adresa:''});loadAll();setSavingDep(false)
                }}>+ Adaugă depozit</button>
              )}
              <div style={{marginTop:10,padding:'8px 10px',background:G.bg,borderRadius:6,fontSize:10,color:G.muted}}>
                💡 Codul 3 litere → seria avizului: <strong style={{color:G.purple,fontFamily:'monospace'}}>GAZ/TR/INTERN/BAL</strong>
              </div>
            </div>
          </div>
        </div>
        </>
      )}

      {tab==='managers'&&(
        <div style={{display:'grid',gridTemplateColumns:'1fr 340px',gap:18}}>
          <div style={{...S.card,overflow:'hidden'}}>
            {load?<div style={{padding:40,textAlign:'center'}}><div className="sp" style={{margin:'0 auto'}}/></div>:(
              <table><thead><tr style={{background:G.bg}}><th>Nume</th><th>Email</th><th>Rol</th><th>Șantier / Departament</th><th></th></tr></thead>
              <tbody>{managers.map(m=>(
                <tr key={m.id}><td style={{fontWeight:600}}>{m.name||<span style={{color:G.red}}>— fără nume —</span>}</td>
                <td style={{color:G.muted,fontSize:12}}>{m.email}</td>
                <td><RoleBadge role={m.role}/></td>
                <td style={{fontSize:11}}>
                  <div style={{color:G.purple}}>{(m.site_ids||[]).length>0?m.site_ids.map(id=>sites.find(s=>s.id===id)?.name).filter(Boolean).join(', '):''}</div>
                  {m.department && <div style={{color:G.blue,marginTop:2,fontSize:10,fontWeight:600}}>🏢 {m.department}</div>}
                  {!m.department && (m.site_ids||[]).length===0 && <span style={{color:G.dim}}>—</span>}
                </td>
                <td><button onClick={async()=>{setEditMgr({...m,original_email:m.email});const{data:ma}=await supabase.from('user_module_access').select('module, access_level').eq('profile_id',m.id);const mods={};const levels={};(ma||[]).forEach(x=>{mods[x.module]=true;levels[x.module]=x.access_level||'editor'});setEditMgrModules(mods);setEditMgrModuleLevels(levels)}} style={{...S.btnS,padding:'3px 9px',fontSize:11}}>✏️ Edit</button></td></tr>
              ))}</tbody></table>
            )}
          </div>
          <div style={{...S.card,padding:20}}>
            <div style={{fontSize:13,fontWeight:700,marginBottom:14}}>Adaugă Manager</div>
            {[['Nume complet',nName,setNName,'text','Ion Popescu'],['Email',nEmail,setNEmail,'email','ion@gazpet.ro'],['Parolă temporară',nPwd,setNPwd,'password','••••••']].map(([l,v,s,t,ph])=>(
              <div key={l} style={{marginBottom:10}}><Lbl>{l}</Lbl><input style={S.input} type={t} placeholder={ph} value={v} onChange={e=>s(e.target.value)}/></div>
            ))}
            <div style={{marginBottom:10}}><Lbl>Rol</Lbl><select value={nRole} onChange={e=>setNRole(e.target.value)} style={{width:'100%'}}>
              <option value="superadmin">⭐ Super Admin</option>
              <option value="admin_logistica">🚛 Admin Logistică</option>
              <option value="manager_santier">👤 Manager Șantier</option>
              <option value="sef_echipa">🏗️ Șef Echipă</option>
              <option value="contabilitate">💵 Contabilitate</option>
              <option value="hr">👥 HR</option>
              <option value="gestionar">🏭 Gestionar</option>
              <option value="magazioner">📦 Magazioner</option>
            </select></div>
            <div style={{marginBottom:10}}><Lbl>🏢 Departament (opțional)</Lbl><select value={nDept} onChange={e=>setNDept(e.target.value)} style={{width:'100%'}}>
              <option value="">— niciunul —</option>
              <option value="Execuție">⚙️ Execuție</option>
              <option value="Logistică">🚛 Logistică</option>
              <option value="TESA">📋 TESA</option>
              <option value="HR">👥 HR</option>
              <option value="Administrativ">🏢 Administrativ</option>
              <option value="Contabilitate">💵 Contabilitate</option>
              <option value="Financiar">💰 Financiar</option>
              <option value="Comercial">🛒 Comercial</option>
              <option value="Ofertare">📋 Ofertare</option>
              <option value="Magazie">📦 Magazie</option>
              <option value="IT">💻 IT</option>
            </select></div>
            {ROLES_WITH_SITES.includes(nRole)&&<div style={{marginBottom:14}}><Lbl>Șantier Alocat (poți adăuga mai multe după salvare, din butonul Edit)</Lbl><select value={nSite} onChange={e=>setNSite(e.target.value)} style={{width:'100%'}}><option value="">— selectează —</option>{sites.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></div>}
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
                      <button onClick={async()=>{
                        const editObj={...emp}
                        // Pre-fetch date personale GDPR din hr_employees_private (RLS filtreaza automat)
                        const {data:pData}=await supabase.from('hr_employees_private').select('*').eq('employee_id',emp.id).maybeSingle()
                        if(pData){
                          editObj.cnp=pData.cnp||''
                          editObj.data_nastere=pData.data_nastere||''
                          editObj.adresa_strada=pData.adresa_strada||''
                          editObj.adresa_oras=pData.adresa_oras||''
                          editObj.adresa_judet=pData.adresa_judet||''
                          editObj.adresa_cod_postal=pData.adresa_cod_postal||''
                          editObj.adresa_tara=pData.adresa_tara||'România'
                        }
                        setEditEmp(editObj)
                      }} style={{...S.btnS,padding:'2px 7px',fontSize:10}}>✏️</button>
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

      {tab==='semnaturi'&&(
        <div style={{maxWidth:1300}}>
          <div style={{...S.card,padding:18,marginBottom:14,borderLeft:`4px solid ${G.purple}`}}>
            <div style={{fontSize:13,fontWeight:700,marginBottom:6,color:G.text,display:'flex',alignItems:'center',gap:8}}>
              🖋️ Semnături Electronice Angajați
            </div>
            <div style={{fontSize:11,color:G.muted,lineHeight:1.5}}>
              Stochează semnături PNG/JPG pentru fiecare angajat activ. Folosite la generare automată <strong>ordin deplasare PDF</strong> (Faza 2),
              contracte HR, formulare interne. Acces strict: utilizatori cu bifa <strong>„Acces Date Personale"</strong>.
            </div>
          </div>
          <TabSemnaturi profile={profile} showToast={showToast} />
        </div>
      )}

      {tab==='settings'&&isSuperAdmin&&(
        <div style={{maxWidth:680}}>
          {/* === MESAJ PENTRU UTILIZATORI — afișat ca banner în top-ul tuturor paginilor === */}
          <div style={{...S.card,padding:22,marginBottom:16,borderLeft:`4px solid ${G.purple}`}}>
            <div style={{fontSize:13,fontWeight:700,marginBottom:6,color:G.text}}>📨 Mesaj pentru utilizatori</div>
            <div style={{fontSize:11,color:G.muted,marginBottom:18,lineHeight:1.5}}>
              Mesajul va apărea ca <strong>banner în top-ul tuturor paginilor</strong> (Acasă, Pontaj, Rapoarte, etc). 
              Useri pot închide bannerul cu ✕, dar va reapărea dacă editezi mesajul.
            </div>
            
            <div style={{marginBottom:14}}>
              <Lbl>Activează / Dezactivează</Lbl>
              <div style={{display:'flex',gap:8}}>
                <button 
                  onClick={()=>saveSetting('mesaj_companie_activ','true')}
                  style={{...S.btnP, background: settings.mesaj_companie_activ==='true'?G.green:G.surface, border: `1px solid ${settings.mesaj_companie_activ==='true'?G.green:G.border}`, color: settings.mesaj_companie_activ==='true'?'#fff':G.muted, flex:1}}
                >✓ Activ</button>
                <button 
                  onClick={()=>saveSetting('mesaj_companie_activ','false')}
                  style={{...S.btnP, background: settings.mesaj_companie_activ!=='true'?G.red:G.surface, border: `1px solid ${settings.mesaj_companie_activ!=='true'?G.red:G.border}`, color: settings.mesaj_companie_activ!=='true'?'#fff':G.muted, flex:1}}
                >✗ Dezactivat</button>
              </div>
            </div>
            
            <div style={{marginBottom:14}}>
              <Lbl>Tip mesaj</Lbl>
              <div style={{display:'flex',gap:8}}>
                {[
                  ['info','📢 Info',G.blue],
                  ['warning','⚠️ Avertisment',G.orange],
                  ['critical','🚨 Critical',G.red],
                ].map(([val, label, color]) => (
                  <button key={val}
                    onClick={()=>saveSetting('mesaj_companie_tip',val)}
                    style={{
                      flex:1, padding:'8px 10px', borderRadius:8, cursor:'pointer', fontSize:12, fontWeight:600,
                      background: settings.mesaj_companie_tip===val?color:G.surface,
                      color: settings.mesaj_companie_tip===val?'#fff':G.muted,
                      border: `1px solid ${settings.mesaj_companie_tip===val?color:G.border}`
                    }}
                  >{label}</button>
                ))}
              </div>
            </div>
            
            <div style={{marginBottom:14}}>
              <Lbl>Conținut mesaj</Lbl>
              <textarea
                value={settings.mesaj_companie_text || ''}
                onChange={e=>setSettings(prev=>({...prev,mesaj_companie_text:e.target.value}))}
                placeholder="Ex: Vineri 15 mai vom efectua mentenanță sistem între 18:00-20:00. Vă rugăm salvați munca înainte!"
                style={{...S.input, minHeight: 100, resize: 'vertical', fontFamily: 'inherit'}}
                maxLength={500}
              />
              <div style={{fontSize:10,color:G.muted,marginTop:4,textAlign:'right'}}>
                {(settings.mesaj_companie_text || '').length}/500 caractere
              </div>
            </div>
            
            <div style={{display:'flex',gap:8}}>
              <button 
                onClick={async()=>{
                  await saveSetting('mesaj_companie_text', settings.mesaj_companie_text || '')
                  await saveSetting('mesaj_companie_data', new Date().toISOString())
                  showToast('✓ Mesaj actualizat — apare la toți utilizatorii imediat')
                }}
                style={{...S.btnP,background:G.purple,flex:1}}
              >💾 Salvează & Publică</button>
              <button
                onClick={async()=>{
                  if(confirm('Ștergi mesajul curent?')) {
                    await saveSetting('mesaj_companie_text', '')
                    await saveSetting('mesaj_companie_activ', 'false')
                    setSettings(prev=>({...prev,mesaj_companie_text:'',mesaj_companie_activ:'false'}))
                    showToast('✓ Mesaj șters')
                  }
                }}
                style={S.btnS}
              >🗑️ Șterge</button>
            </div>
            
            {settings.mesaj_companie_text && settings.mesaj_companie_activ === 'true' && (
              <div style={{marginTop:14, padding:12, background: G.bg, border:`1px dashed ${G.border}`, borderRadius:8}}>
                <div style={{fontSize:10, color:G.muted, fontWeight:700, textTransform:'uppercase', marginBottom:6}}>👁 PREVIEW (cum vede user-ul):</div>
                <div style={{padding:10, background: settings.mesaj_companie_tip==='critical'?'#7F1D1D33':settings.mesaj_companie_tip==='warning'?'#78350F33':'#1E3A8A33', border:`1px solid ${settings.mesaj_companie_tip==='critical'?G.red:settings.mesaj_companie_tip==='warning'?G.orange:G.blue}`, borderRadius:6, fontSize:13, color:G.text, whiteSpace:'pre-wrap'}}>
                  {settings.mesaj_companie_tip==='critical'?'🚨':settings.mesaj_companie_tip==='warning'?'⚠️':'📢'} {settings.mesaj_companie_text}
                </div>
              </div>
            )}
          </div>
          
          {/* === DATE IDENTIFICARE FIRMĂ — folosite pentru aviz, contracte HR, contracte Comercial === */}
          <div style={{...S.card,padding:22,marginBottom:16,borderLeft:`4px solid ${G.blue}`}}>
            <div style={{fontSize:13,fontWeight:700,marginBottom:6,color:G.text}}>🏢 Date Identificare Firmă</div>
            <div style={{fontSize:11,color:G.muted,marginBottom:18,lineHeight:1.5}}>
              Aceste date vor apărea pe <strong>avizele de însoțire marfă</strong>, <strong>contractele cu terți</strong> (modul Comercial) și <strong>contractele de muncă</strong> (modul HR).
            </div>
            {[
              ['🏢 Denumire Societate', 'firma_nume', 'GAZPET INSTAL SRL'],
              ['🏷️ CUI / CIF', 'firma_cui', 'RO 12345678'],
              ['📋 Nr. Reg. Comerțului', 'firma_reg_com', 'J29/...'],
              ['📍 Sediu Social', 'firma_adresa', 'Str. ..., Localitate, Județ'],
              ['📞 Telefon', 'firma_telefon', '0244...'],
              ['📧 Email companie', 'firma_email', 'office@...'],
            ].map(([label, key, placeholder]) => (
              <div key={key} style={{marginBottom:14}}>
                <Lbl>{label}</Lbl>
                <div style={{display:'flex',gap:9}}>
                  <input 
                    style={S.input} 
                    type="text" 
                    placeholder={placeholder}
                    value={firmaSettings[key]||''} 
                    onChange={e=>setFirmaSettings(prev=>({...prev,[key]:e.target.value}))} 
                  />
                  <button onClick={()=>saveFirmaSetting(key,firmaSettings[key]||'')} style={{...S.btnP,whiteSpace:'nowrap',background:G.blue}}>Salvează</button>
                </div>
              </div>
            ))}
          </div>
          
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
          
          {/* === ORDIN DEPLASARE — SEMNATARI === */}
          <div style={{...S.card,padding:22,marginBottom:16,borderLeft:`4px solid ${G.orange}`}}>
            <div style={{fontSize:13,fontWeight:700,marginBottom:6,color:G.text}}>📄 Ordin Deplasare — Semnatari</div>
            <div style={{fontSize:11,color:G.muted,marginBottom:18,lineHeight:1.5}}>
              Numele care apar pe <strong>ordinele de deplasare</strong> generate din Istoric Plăți Diurne (modul Rapoarte). 
              Modifică doar dacă se schimbă persoanele responsabile cu aprobarea/decontarea.
            </div>
            
            {[
              ['director_aproba', '✓ Se aprobă (conducătorul unității)', 'Trusu Razvan'],
              ['control_preventiv', '🔍 Control financiar preventiv', 'Tudorache Marilena'],
              ['verificat_decont', '📋 Verificat decont', 'Mirela Popescu'],
              ['sef_compartiment', '👤 Șef compartiment', 'Udrea Natalia'],
            ].map(([key, label, placeholder]) => (
              <div key={key} style={{marginBottom:12}}>
                <Lbl>{label}</Lbl>
                <input 
                  style={S.input} 
                  type="text" 
                  value={ordSetari[key] || ''} 
                  onChange={e => setOrdSetari(prev => ({...prev, [key]: e.target.value}))} 
                  placeholder={placeholder}
                />
              </div>
            ))}
            
            <button 
              onClick={saveOrdSetari} 
              style={{...S.btnP, background: G.orange, width:'100%', marginTop:8}}
            >💾 Salvează semnatari</button>
            
            <div style={{padding:10,background:G.orange+'15',borderRadius:8,border:`1px solid ${G.orange}33`,fontSize:11,color:G.orange,marginTop:12,lineHeight:1.5}}>
              💡 <strong>Cum se folosesc:</strong> În <strong>Rapoarte → Istoric Plăți Diurne</strong>, butonul „📄 Generează Ordine Deplasare" creează câte un xlsx per angajat cu aceste 4 nume preumplute.
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}

// ─── Salarii Page ─────────────────────────────────────────────────────────────
export function SalariiPage({ noExport = false } = {}) {
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
  const [tab,setTab]=useState('contracte')
  // Stat lunar (salarii_importuri + salarii_stat_linii — RLS strict: owner/can_access_salarii)
  const [statImporturi,setStatImporturi]=useState(null) // null = neîncărcat încă
  const [statImportSel,setStatImportSel]=useState(null)
  const [statLinii,setStatLinii]=useState([])
  const [statLoad,setStatLoad]=useState(false)
  const [statSearch,setStatSearch]=useState('')
  const [statSect,setStatSect]=useState('Toate')

  // === RE-AUTENTIFICARE: lockscreen cu parolă + inactivity timer ===
  const SALARII_TIMEOUT_MIN = 20  // minute valabilitate unlock (reset la activitate)
  const [unlocked, setUnlocked] = useState(() => {
    const until = Number(sessionStorage.getItem('salariiUnlockedUntil') || 0)
    return until > Date.now()
  })
  const [unlockUntil, setUnlockUntil] = useState(() => Number(sessionStorage.getItem('salariiUnlockedUntil') || 0))
  const [pwdInput, setPwdInput] = useState('')
  const [pwdErr, setPwdErr] = useState('')
  const [verifying, setVerifying] = useState(false)

  // Inactivity tracking: reset timer la fiecare interactiune (mouse, keyboard, scroll, touch)
  useEffect(() => {
    if (!unlocked) return
    const resetTimer = () => {
      const until = Date.now() + SALARII_TIMEOUT_MIN * 60 * 1000
      sessionStorage.setItem('salariiUnlockedUntil', String(until))
      setUnlockUntil(until)
    }
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart']
    events.forEach(e => window.addEventListener(e, resetTimer, { passive: true }))
    const tid = setInterval(() => {
      const until = Number(sessionStorage.getItem('salariiUnlockedUntil') || 0)
      if (until <= Date.now()) {
        setUnlocked(false)
        sessionStorage.removeItem('salariiUnlockedUntil')
      }
    }, 10000) // verifica la fiecare 10s
    return () => {
      events.forEach(e => window.removeEventListener(e, resetTimer))
      clearInterval(tid)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked])

  const handleUnlock = async () => {
    if (!profile?.email) { setPwdErr('Lipsește email-ul contului tău'); return }
    if (!pwdInput) { setPwdErr('Introdu parola'); return }
    setVerifying(true)
    setPwdErr('')
    const { error } = await supabase.auth.signInWithPassword({ email: profile.email, password: pwdInput })
    if (error) {
      setPwdErr('Parolă greșită')
      // Audit access_denied (best-effort, ignoram erorile)
      try {
        await supabase.from('hr_salarii_audit').insert({
          user_id: profile.id,
          user_email: profile.email,
          action: 'access_denied',
          target_table: 'employee_salaries',
          user_agent: navigator.userAgent || null
        })
      } catch (e) { /* ignore */ }
      setVerifying(false)
      return
    }
    // Success
    const until = Date.now() + SALARII_TIMEOUT_MIN * 60 * 1000
    sessionStorage.setItem('salariiUnlockedUntil', String(until))
    setUnlockUntil(until)
    setUnlocked(true)
    setPwdInput('')
    setVerifying(false)
    // Audit unlock
    try {
      await supabase.from('hr_salarii_audit').insert({
        user_id: profile.id,
        user_email: profile.email,
        action: 'unlock',
        target_table: 'employee_salaries',
        user_agent: navigator.userAgent || null
      })
    } catch (e) { /* ignore */ }
  }

  const handleLock = () => {
    sessionStorage.removeItem('salariiUnlockedUntil')
    setUnlocked(false)
    setUnlockUntil(0)
  }

  useEffect(()=>{ if(unlocked) loadData() },[unlocked])

  useEffect(()=>{ if(unlocked&&tab==='stat'&&statImporturi===null) loadStatImporturi() },[unlocked,tab])
  useEffect(()=>{ if(unlocked&&statImportSel!=null) loadStatLinii(statImportSel) },[unlocked,statImportSel])

  const loadStatImporturi=async()=>{
    setStatLoad(true)
    const {data}=await supabase.from('salarii_importuri').select('*').order('luna',{ascending:false})
    setStatImporturi(data||[])
    if((data||[]).length) setStatImportSel(data[0].id)
    else setStatLoad(false)
  }
  const loadStatLinii=async(impId)=>{
    setStatLoad(true)
    const {data}=await supabase.from('salarii_stat_linii').select('*').eq('import_id',impId).order('sectiune').order('nume')
    setStatLinii(data||[])
    setStatLoad(false)
  }

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

  // === LOCKSCREEN: dacă nu e deblocat, afișez modal cu parolă ===
  if (!unlocked) {
    const LockScreen = (
      <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.92)',zIndex:300,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
        <div style={{...S.card,padding:32,maxWidth:460,width:'100%',border:`2px solid ${G.red}66`,boxShadow:`0 8px 40px ${G.red}33`}}>
          <div style={{fontSize:42,textAlign:'center',marginBottom:14}}>🔐</div>
          <div style={{fontSize:18,fontWeight:800,textAlign:'center',marginBottom:8,color:G.red}}>Acces Restricționat</div>
          <div style={{fontSize:12,color:G.muted,textAlign:'center',marginBottom:22,lineHeight:1.7}}>
            Tab-ul <strong style={{color:G.text}}>Salarii</strong> conține date GDPR-sensibile.<br/>
            Re-introdu parola contului tău pentru <strong style={{color:G.yellow}}>{SALARII_TIMEOUT_MIN} minute</strong>.<br/>
            <span style={{fontSize:10,color:G.dim}}>Toate accesele sunt înregistrate în audit log.</span>
          </div>
          <div style={{marginBottom:12}}>
            <Lbl>Email contului tău</Lbl>
            <div style={{fontSize:12,color:G.text,padding:'10px 12px',background:G.bg,borderRadius:8,border:`1px solid ${G.border}`,fontFamily:'monospace'}}>{profile?.email || '—'}</div>
          </div>
          <div style={{marginBottom:16}}>
            <Lbl>Parolă</Lbl>
            <input type="password" style={{...S.input,borderColor:pwdErr?G.red:G.border2}}
              value={pwdInput} onChange={e=>setPwdInput(e.target.value)}
              onKeyDown={e=>{if(e.key==='Enter') handleUnlock()}}
              autoFocus disabled={verifying} placeholder="••••••••"/>
            {pwdErr && <div style={{fontSize:11,color:G.red,marginTop:5,fontWeight:600}}>⚠ {pwdErr}</div>}
          </div>
          <button onClick={handleUnlock} disabled={verifying} style={{...S.btnP,width:'100%',padding:'11px',background:verifying?G.dim:G.red,fontSize:13,fontWeight:700}}>
            {verifying ? '⏳ Verificare...' : '🔓 Deblochează acces'}
          </button>
          <div style={{textAlign:'center',marginTop:14}}>
            <button onClick={()=>window.history.back()} style={{...S.btnS,fontSize:11,padding:'6px 14px'}}>← Înapoi</button>
          </div>
        </div>
      </div>
    )
    return noExport ? LockScreen : (<Layout>{LockScreen}</Layout>)
  }

  return (
    // SalariiInner() apelat ca funcție, NU ca <SalariiInner/>: componentă inline = tip nou la fiecare
    // render → remount total → inputurile pierd focusul (resetTimer face setState la fiecare keydown)
    noExport ? (<><Toast toast={toast}/>{SalariiInner()}</>) : (<Layout><Toast toast={toast}/>{SalariiInner()}</Layout>)
  )

  function SalariiInner() { return (<>
      {/* Bara unlock cu countdown + lock manual */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'8px 14px',background:G.greenDim,borderLeft:`3px solid ${G.green}`,borderRadius:6,marginBottom:14,gap:10,flexWrap:'wrap'}}>
        <div style={{fontSize:11,color:G.green,fontWeight:600}}>
          🔓 Acces deblocat · valabil până la {new Date(unlockUntil).toLocaleTimeString('ro-RO',{hour:'2-digit',minute:'2-digit'})} (se resetează la activitate)
        </div>
        <button onClick={handleLock} style={{...S.btnS,padding:'4px 10px',fontSize:11,borderColor:G.red+'66',color:G.red}}>🔒 Lock acum</button>
      </div>

      {/* Tab-uri: Contracte (date contractuale) | Stat lunar (statul importat de la Mari) */}
      <div style={{display:'flex',gap:8,marginBottom:16}}>
        <button onClick={()=>setTab('contracte')} style={{...S.btnS,padding:'8px 18px',fontSize:12,fontWeight:700,...(tab==='contracte'?{background:G.blue+'22',borderColor:G.blue,color:G.blue}:{})}}>📋 Contracte</button>
        <button onClick={()=>setTab('stat')} style={{...S.btnS,padding:'8px 18px',fontSize:12,fontWeight:700,...(tab==='stat'?{background:G.green+'22',borderColor:G.green,color:G.green}:{})}}>📊 Stat lunar</button>
      </div>

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

      {tab==='stat' ? StatLunarTab() : (<>
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
          <button onClick={exportBanca} style={{...S.btnP,background:'#1A4A1A',alignItems:'center',gap:6, display: noExport ? 'none' : 'flex'}}>🏦 Export Bancă Salarii</button>
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
      </>)}
    </>) }

  // ── Tab „Stat lunar": read-only peste salarii_importuri + salarii_stat_linii ──
  function StatLunarTab() {
    const imp=(statImporturi||[]).find(i=>i.id===statImportSel)
    const lunaRo=(d)=>{ const s=new Date(d+'T12:00').toLocaleDateString('ro-RO',{month:'long',year:'numeric'}); return s.charAt(0).toUpperCase()+s.slice(1) }
    const fmt=(v)=>Number(v||0).toLocaleString('ro-RO',{maximumFractionDigits:0})
    const linii=statLinii.filter(l=>{
      const ms=(l.nume||'').toLowerCase().includes(statSearch.toLowerCase())
      const md=statSect==='Toate'||l.sectiune===statSect
      return ms&&md
    })
    const tot=linii.reduce((a,l)=>({brut:a.brut+Number(l.total_brut||0),net:a.net+Number(l.salariu_net||0),cost:a.cost+Number(l.cost_angajator||0),premii:a.premii+Number(l.premii||0),avans:a.avans+Number(l.avans||0),rest:a.rest+Number(l.rest_plata||0)}),{brut:0,net:0,cost:0,premii:0,avans:0,rest:0})
    const chip=(v)=>(<button key={v} onClick={()=>setStatSect(v)} style={{...S.btnS,padding:'5px 12px',fontSize:11,fontWeight:700,...(statSect===v?{background:G.green+'22',borderColor:G.green,color:G.green}:{})}}>{v==='SANTIER'?'🏗️ Șantier':v==='SEDIU'?'🏢 Sediu':'Toate'}</button>)
    return (<>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,gap:10,flexWrap:'wrap'}}>
        <div>
          <div style={{fontSize:19,fontWeight:800}}>📊 Stat lunar</div>
          <div style={{fontSize:11,color:G.muted,marginTop:3}}>
            {imp?`${imp.fisier_nume||'stat'}${imp.importat_la?` · importat ${new Date(imp.importat_la).toLocaleDateString('ro-RO')}`:''}${imp.provizoriu?' · ⚠️ PROVIZORIU (fără prime)':''}`:'statul de salarii importat în platformă'}
          </div>
        </div>
        <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
          {(statImporturi||[]).length>0&&(
            <select value={statImportSel||''} onChange={e=>setStatImportSel(Number(e.target.value))}>
              {(statImporturi||[]).map(i=><option key={i.id} value={i.id}>{lunaRo(i.luna)}{i.provizoriu?' (provizoriu)':''}</option>)}
            </select>
          )}
          {['Toate','SANTIER','SEDIU'].map(chip)}
          <input placeholder="🔍 Caută..." value={statSearch} onChange={e=>setStatSearch(e.target.value)} style={{...S.input,width:170}}/>
        </div>
      </div>

      {statLoad?<div style={{display:'flex',justifyContent:'center',padding:60}}><div className="sp" style={{width:30,height:30}}/></div>
      :(statImporturi||[]).length===0?(
        <div style={{...S.card,padding:40,textAlign:'center',color:G.muted,fontSize:13}}>
          📭 Niciun stat importat încă.<br/><span style={{fontSize:11,color:G.dim}}>Statul lunar de la Mari se importă în BD — primul disponibil: Iulie 2026.</span>
        </div>
      ):(<>
        {/* KPI */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:10,marginBottom:14}}>
          {[['👥 Angajați',linii.length,G.text],['💰 Total brut',fmt(tot.brut)+' RON',G.text],['💸 Prime',fmt(tot.premii)+' RON',G.yellow],['✅ Total net',fmt(tot.net)+' RON',G.green],['🏭 Cost angajator',fmt(tot.cost)+' RON',G.orange]].map(([l,v,c])=>(
            <div key={l} style={{...S.card,padding:'12px 14px'}}>
              <div style={{fontSize:10,color:G.muted,fontWeight:700,textTransform:'uppercase',letterSpacing:'.4px'}}>{l}</div>
              <div style={{fontSize:17,fontWeight:800,color:c,marginTop:4}}>{v}</div>
            </div>
          ))}
        </div>

        <div style={{...S.card,overflowX:'auto'}}>
          <table style={{minWidth:1150}}>
            <thead><tr style={{background:G.bg}}>
              <th>Angajat</th><th>Secț.</th><th style={{textAlign:'right'}}>Tarifar</th><th style={{textAlign:'right'}}>Ore</th><th style={{textAlign:'right'}}>Zile CO</th><th style={{textAlign:'right'}}>Prime</th><th style={{textAlign:'right'}}>Brut</th><th style={{textAlign:'right'}}>CAS</th><th style={{textAlign:'right'}}>CASS</th><th style={{textAlign:'right'}}>Impozit</th><th style={{textAlign:'right'}}>Net</th><th style={{textAlign:'right'}}>Avans</th><th style={{textAlign:'right'}}>Rest plată</th><th style={{textAlign:'right'}}>Cost angajator</th>
            </tr></thead>
            <tbody>
              {linii.length===0?<tr><td colSpan={14} style={{textAlign:'center',color:G.muted,padding:40}}>Nicio linie</td></tr>
              :linii.map(l=>(
                <tr key={l.id}>
                  <td><span style={{fontWeight:600,fontSize:12}}>{l.nume}</span>{!l.employee_id&&<span title="fără corespondent în angajați" style={{marginLeft:6,fontSize:10,color:G.yellow}}>⚠</span>}</td>
                  <td><span className="badge bd" style={l.sectiune==='SEDIU'?{color:G.blue}:{}}>{l.sectiune==='SANTIER'?'Șantier':'Sediu'}</span></td>
                  <td style={{textAlign:'right',fontSize:12,color:G.muted}}>{fmt(l.salar_tarifar)}</td>
                  <td style={{textAlign:'right',fontSize:12,color:G.muted}}>{fmt(l.ore_lucrate)}</td>
                  <td style={{textAlign:'right',fontSize:12,color:Number(l.zile_co)>0?G.yellow:G.dim}}>{Number(l.zile_co)>0?fmt(l.zile_co):'—'}</td>
                  <td style={{textAlign:'right',fontSize:12,color:Number(l.premii)>0?G.yellow:G.dim}}>{Number(l.premii)>0?fmt(l.premii):'—'}</td>
                  <td style={{textAlign:'right',fontSize:12,fontWeight:700}}>{fmt(l.total_brut)}</td>
                  <td style={{textAlign:'right',fontSize:11,color:G.muted}}>{fmt(l.cas)}</td>
                  <td style={{textAlign:'right',fontSize:11,color:G.muted}}>{fmt(l.sanatate)}</td>
                  <td style={{textAlign:'right',fontSize:11,color:G.muted}}>{fmt(l.impozit)}</td>
                  <td style={{textAlign:'right',fontSize:12,fontWeight:700,color:G.green}}>{fmt(l.salariu_net)}</td>
                  <td style={{textAlign:'right',fontSize:11,color:G.muted}}>{fmt(l.avans)}</td>
                  <td style={{textAlign:'right',fontSize:11,color:G.muted}}>{fmt(l.rest_plata)}</td>
                  <td style={{textAlign:'right',fontSize:12,fontWeight:700,color:G.orange}}>{fmt(l.cost_angajator)}</td>
                </tr>
              ))}
            </tbody>
            {linii.length>0&&(
              <tfoot><tr style={{background:G.bg,fontWeight:800}}>
                <td style={{fontSize:12}}>TOTAL ({linii.length})</td><td/><td/><td/><td/>
                <td style={{textAlign:'right',fontSize:12,color:G.yellow}}>{fmt(tot.premii)}</td>
                <td style={{textAlign:'right',fontSize:12}}>{fmt(tot.brut)}</td><td/><td/><td/>
                <td style={{textAlign:'right',fontSize:12,color:G.green}}>{fmt(tot.net)}</td>
                <td style={{textAlign:'right',fontSize:11,color:G.muted}}>{fmt(tot.avans)}</td>
                <td style={{textAlign:'right',fontSize:11,color:G.muted}}>{fmt(tot.rest)}</td>
                <td style={{textAlign:'right',fontSize:12,color:G.orange}}>{fmt(tot.cost)}</td>
              </tr></tfoot>
            )}
          </table>
        </div>
        <div style={{fontSize:10,color:G.dim,marginTop:8}}>Cost angajator = Brut × 1,0225 (CAM 2,25%) · Date read-only din statul de salarii importat · unde Net ≠ Avans+Rest, diferența = rețineri/popriri din stat</div>
      </>)}
    </>)
  }
}

// ════════════════════════════════════════════════════════════════════════════
// CHATBOT GATE - afișează ChatbotWidget DOAR pentru useri logați (cu profile)
// ════════════════════════════════════════════════════════════════════════════
function ChatbotWidgetGate() {
  const { session, profile } = useAuth()
  // NU afișa dacă: nu există sesiune SAU profilul nu s-a încărcat încă SAU pe pagina login
  if (!session || !profile) return null
  return <ChatbotWidget profile={profile} />
}

// ════════════════════════════════════════════════════════════════════════════
// INTERNAL CHAT GATE - afișează chat-ul intern DOAR pentru useri logați
// ════════════════════════════════════════════════════════════════════════════
function InternalChatGate() {
  const { session, profile } = useAuth()
  if (!session || !profile) return null
  return <InternalChat profile={profile} />
}

// ════════════════════════════════════════════════════════════════════════════
// BUG REPORT GATE - buton flotant 🐛 DOAR pentru useri logați
// ════════════════════════════════════════════════════════════════════════════
function BugReportGate() {
  const { session, profile } = useAuth()
  if (!session || !profile) return null
  return <BugReportButton profile={profile} />
}

// ════════════════════════════════════════════════════════════════════════════
// TICHET MODUL GATE - buton flotant contextual 🎫 per modul (doar useri logați)
// ════════════════════════════════════════════════════════════════════════════
function TichetModulGate() {
  const { session, profile } = useAuth()
  if (!session || !profile) return null
  return <TichetModulButton profile={profile} />
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage/>}/>
        {/* Route PUBLIC pentru QR scan utilaj - FĂRĂ ProtectedRoute, accesibil pentru șoferi fără cont */}
        <Route path="/q/:id" element={<QrUtilajPage/>}/>
        {/* Route PUBLIC cerere concediu mobil (token personal) — FĂRĂ cont, pt. toți angajații */}
        <Route path="/co" element={<ConcediuMobilPage/>}/>
        {/* Route PUBLIC RSVP ședință (token din email invitație) — FĂRĂ cont */}
        <Route path="/rsvp/:token/:status" element={<RsvpSedintaPage/>}/>
        <Route path="/" element={<ProtectedRoute><HomeDashboard/></ProtectedRoute>}/>
        <Route path="/panou" element={<ProtectedRoute requireModule="pontajpro"><DashboardPage/></ProtectedRoute>}/>
        <Route path="/pontaj" element={<ProtectedRoute requireModule="pontajpro"><PontajPage/></ProtectedRoute>}/>
        <Route path="/logistica" element={<ProtectedRoute requireModule="logistica"><Layout><LogisticaPage/></Layout></ProtectedRoute>}/>
        <Route path="/hr" element={<ProtectedRoute requireModule="hr"><Layout><HRPage/></Layout></ProtectedRoute>}/>
        <Route path="/administrativ" element={<ProtectedRoute requireModule="administrativ"><Layout><AdministrativPage/></Layout></ProtectedRoute>}/>
        <Route path="/executie" element={<ProtectedRoute requireModule="executie"><Layout><ExecutiePage/></Layout></ProtectedRoute>}/>
        <Route path="/financiar" element={<ProtectedRoute requireModule="financiar"><Layout><FinanciarPage/></Layout></ProtectedRoute>}/>
        <Route path="/tichete" element={<ProtectedRoute><Layout><DoarIntern><Tichete/></DoarIntern></Layout></ProtectedRoute>}/>
        {/* Consumabile birou: fără requireModule — e cerința explicită să ajungă
            toată lumea, iar modulul Administrativ are doar 6 utilizatori. */}
        <Route path="/consumabile" element={<ProtectedRoute><Layout><DoarIntern><ConsumabileRoute/></DoarIntern></Layout></ProtectedRoute>}/>
        {/* PROVIZORIU: corecții registru imobilizări (se scoate la finalul proiectului) */}
        <Route path="/inventar-corectii" element={<ProtectedRoute><Layout><InventarCorectiiRoute/></Layout></ProtectedRoute>}/>
        <Route path="/grafic/:tip/:id" element={<ProtectedRoute><GraficLucrareRoute/></ProtectedRoute>}/>
        {/* ════════════ Etapa 15 Faza 1: Routes module Comercial ════════════ */}
        <Route path="/comercial" element={<ProtectedRoute requireModule="comercial"><Layout><ComercialPage/></Layout></ProtectedRoute>}/>
        <Route path="/achizitii" element={<ProtectedRoute requireModule="achizitii"><Layout><AchizitiiPage/></Layout></ProtectedRoute>}/>
        <Route path="/ofertare" element={<ProtectedRoute requireModule="ofertare"><Layout><OfertarePage/></Layout></ProtectedRoute>}/>
        <Route path="/ctc" element={<ProtectedRoute requireModule="ctc"><Layout><CTCPage/></Layout></ProtectedRoute>}/>
        <Route path="/magazie" element={<ProtectedRoute requireModule="magazie"><Layout><MagaziePage/></Layout></ProtectedRoute>}/>
        <Route path="/rapoarte" element={<ProtectedRoute requireModule="pontajpro"><ReportsPage/></ProtectedRoute>}/>
        <Route path="/salarii" element={<ProtectedRoute salaryAccess><SalariiPage/></ProtectedRoute>}/>
        <Route path="/admin" element={<ProtectedRoute adminOnly><AdminPage/></ProtectedRoute>}/>
        <Route path="/m" element={<ProtectedRoute><AppMobilManageri/></ProtectedRoute>}/>
        <Route path="/rapoarte-santier" element={<ProtectedRoute><RapoarteSantierPage/></ProtectedRoute>}/>
        <Route path="/sedinte" element={<ProtectedRoute><SedintePage/></ProtectedRoute>}/>
        <Route path="/marketing" element={<ProtectedRoute requireModule="marketing"><Marketing/></ProtectedRoute>}/>
        <Route path="*" element={<Navigate to="/" replace/>}/>
      </Routes>
      <ChatbotWidgetGate />
      <InternalChatGate />
      <BugReportGate />
      <TichetModulGate />
    </AuthProvider>
  )
}

// Gardă rută: doar utilizatorii interni (@gazpet.ro) — externii (ex. Adrom Evolution)
// sunt trimiși pe Acasă chiar dacă tastează URL-ul direct (tichetele-s interne).
function DoarIntern({ children }) {
  const [ok, setOk] = useState(null)
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) =>
      setOk((user?.email || '').toLowerCase().endsWith('@gazpet.ro')))
  }, [])
  if (ok === null) return null
  return ok ? children : <Navigate to="/" replace />
}
