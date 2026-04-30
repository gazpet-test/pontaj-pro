import { useState, useEffect, useCallback, createContext, useContext, useRef } from 'react'
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { supabase } from './lib/supabase.js'
import * as XLSX from 'xlsx'

// ─── Auth Context ─────────────────────────────────────────────────────────────
const AuthContext = createContext(null)
const useAuth = () => useContext(AuthContext)

function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined) // undefined = loading
  const [profile, setProfile] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session) fetchProfile(session.user.id)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setSession(session)
      if (session) fetchProfile(session.user.id)
      else setProfile(null)
    })
    return () => subscription.unsubscribe()
  }, [])

  const fetchProfile = async (userId) => {
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).single()
    setProfile(data)
  }

  const signIn = (email, password) => supabase.auth.signInWithPassword({ email, password })
  const signOut = () => supabase.auth.signOut()

  return (
    <AuthContext.Provider value={{ session, profile, signIn, signOut, fetchProfile }}>
      {children}
    </AuthContext.Provider>
  )
}

function ProtectedRoute({ children, adminOnly = false }) {
  const { session, profile } = useAuth()
  if (session === undefined) return <LoadingScreen />
  if (!session) return <Navigate to="/login" replace />
  if (adminOnly && profile?.role !== 'admin') return <Navigate to="/" replace />
  return children
}

// ─── Constants ────────────────────────────────────────────────────────────────
const DEPARTMENTS = ['IT', 'Vânzări', 'HR', 'Financiar', 'Producție', 'Logistică', 'Marketing', 'Administrație']

const LUNCH_START = 12   // 12:00
const LUNCH_END   = 13   // 13:00
const LUNCH_MINS  = (LUNCH_END - LUNCH_START) * 60  // 60 minute

const todayStr = () => new Date().toISOString().split('T')[0]
const fmt = (ts) => ts ? new Date(ts).toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' }) : '—'
const diffMins = (a, b) => a && b ? Math.max(0, Math.floor((new Date(b) - new Date(a)) / 60000)) : 0
const minsToHM = (m) => { const mm = Math.abs(m); return `${Math.floor(mm / 60)}h ${mm % 60}m` }

// Verifica daca angajatul a lucrat in intervalul 12:00-13:00
const spansLunch = (checkIn, checkOut) => {
  if (!checkIn || !checkOut) return false
  const ci = new Date(checkIn)
  const co = new Date(checkOut)
  const base = ci.toDateString()
  const lunchStart = new Date(`${base} ${LUNCH_START}:00:00`)
  const lunchEnd   = new Date(`${base} ${LUNCH_END}:00:00`)
  return ci <= lunchStart && co >= lunchEnd
}

// Ore nete = ore brute - pauza de masa (daca se aplica)
const netMins = (checkIn, checkOut, lunchBreak) => {
  const gross = diffMins(checkIn, checkOut)
  if (!gross) return 0
  const deduct = lunchBreak && spansLunch(checkIn, checkOut) ? LUNCH_MINS : 0
  return Math.max(0, gross - deduct)
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const G = {
  bg: '#0D1117', surface: '#161B22', border: '#21262D', border2: '#30363D',
  text: '#E6EDF3', muted: '#8B949E', dim: '#6E7681',
  blue: '#58A6FF', green: '#3FB950', red: '#F85149', yellow: '#D29922', purple: '#BC8CFF',
  blueDim: '#1F6FEB22', greenDim: '#1A3A1A', redDim: '#3A1A1A', yellowDim: '#3A2A0A',
}
const S = {
  page: { fontFamily: "'Syne', 'Barlow', sans-serif", background: G.bg, minHeight: '100vh', color: G.text },
  card: { background: G.surface, border: `1px solid ${G.border}`, borderRadius: 12 },
  input: { background: G.bg, border: `1px solid ${G.border2}`, color: G.text, borderRadius: 8, padding: '10px 14px', fontFamily: 'inherit', fontSize: 14, outline: 'none', width: '100%' },
  btnPrimary: { background: '#1F6FEB', color: 'white', border: 'none', borderRadius: 8, padding: '11px 22px', fontFamily: 'inherit', fontSize: 14, fontWeight: 700, cursor: 'pointer' },
  btnSecondary: { background: G.surface, color: G.text, border: `1px solid ${G.border}`, borderRadius: 8, padding: '9px 18px', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  btnGhost: { background: 'none', color: G.muted, border: 'none', borderRadius: 8, padding: '9px 16px', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer' },
}

const css = `
  @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=Barlow:wght@300;400;500;600&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  ::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-track { background: #161B22; } ::-webkit-scrollbar-thumb { background: #30363D; border-radius: 3px; }
  input:focus { border-color: #1F6FEB !important; box-shadow: 0 0 0 3px #1F6FEB22; }
  select { background: #0D1117; border: 1px solid #30363D; color: #E6EDF3; border-radius: 8px; padding: 9px 14px; font-family: inherit; font-size: 14px; outline: none; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; padding: 10px 14px; font-size: 11px; font-weight: 700; color: #8B949E; text-transform: uppercase; letter-spacing: 0.8px; border-bottom: 1px solid #21262D; }
  td { padding: 12px 14px; font-size: 14px; border-bottom: 1px solid #161B22; vertical-align: middle; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: #1C2128; }
  .nav-link { background: none; border: none; cursor: pointer; padding: 9px 16px; border-radius: 8px; font-family: inherit; font-size: 13px; font-weight: 600; color: #8B949E; display: flex; align-items: center; gap: 8px; transition: all 0.2s; text-decoration: none; }
  .nav-link:hover, .nav-link.active { background: #21262D; color: #E6EDF3; }
  .nav-link.active { color: #58A6FF; background: #1F6FEB15; }
  .badge { display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 700; }
  .badge-dept { background: #1F3A5A; color: #79C0FF; }
  .badge-admin { background: #2D1F4A; color: #BC8CFF; }
  .badge-manager { background: #1F3A2D; color: #56D364; }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .fade-in { animation: fadeIn 0.3s ease; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .spinner { width: 20px; height: 20px; border: 2px solid #30363D; border-top-color: #1F6FEB; border-radius: 50%; animation: spin 0.7s linear infinite; }
  .toast { position: fixed; bottom: 24px; right: 24px; padding: 12px 20px; border-radius: 10px; font-size: 14px; font-weight: 600; z-index: 9999; box-shadow: 0 8px 32px rgba(0,0,0,0.5); animation: fadeIn 0.3s ease; }
`

// ─── Helpers ──────────────────────────────────────────────────────────────────
function Avatar({ name, id = 1, size = 38 }) {
  const hue = ((name?.charCodeAt(0) || 0) * 37 + id * 13) % 360
  const initials = name?.split(' ').map(n => n[0]).join('').slice(0, 2) || '?'
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: `hsl(${hue},50%,22%)`, color: `hsl(${hue},70%,72%)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.33, fontWeight: 700, flexShrink: 0 }}>
      {initials}
    </div>
  )
}

function Toast({ toast }) {
  if (!toast) return null
  const colors = { success: [G.greenDim, G.green], error: [G.redDim, G.red], warn: [G.yellowDim, G.yellow] }
  const [bg, color] = colors[toast.type] || colors.success
  return <div className="toast" style={{ background: bg, color, border: `1px solid ${color}44` }}>{toast.msg}</div>
}

function useToast() {
  const [toast, setToast] = useState(null)
  const show = useCallback((msg, type = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }, [])
  return [toast, show]
}

function LoadingScreen() {
  return (
    <div style={{ ...S.page, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16 }}>
      <style>{css}</style>
      <div className="spinner" style={{ width: 36, height: 36 }} />
      <div style={{ color: G.muted, fontSize: 14 }}>Se încarcă...</div>
    </div>
  )
}

// ─── Layout ───────────────────────────────────────────────────────────────────
function Layout({ children }) {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  const isAdmin = profile?.role === 'admin'

  const navItems = [
    { path: '/', icon: '📊', label: 'Panou' },
    { path: '/pontaj', icon: '👥', label: 'Pontaj' },
    { path: '/rapoarte', icon: '📈', label: 'Rapoarte' },
    ...(isAdmin ? [{ path: '/admin', icon: '⚙️', label: 'Admin' }] : []),
  ]

  return (
    <div style={S.page}>
      <style>{css}</style>
      <div style={{ background: G.surface, borderBottom: `1px solid ${G.border}`, padding: '0 28px', display: 'flex', alignItems: 'center', height: 60, gap: 24, position: 'sticky', top: 0, zIndex: 100 }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginRight: 8 }}>
          <div style={{ width: 32, height: 32, background: 'linear-gradient(135deg, #1F6FEB, #388BFD)', borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>⏱</div>
          <span style={{ fontWeight: 800, fontSize: 15, letterSpacing: '-0.3px' }}>PontajPRO</span>
        </div>
        {/* Nav */}
        {navItems.map(item => (
          <button key={item.path} className={`nav-link ${location.pathname === item.path ? 'active' : ''}`} onClick={() => navigate(item.path)}>
            {item.icon} {item.label}
          </button>
        ))}
        {/* Right */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: G.blue, fontVariantNumeric: 'tabular-nums' }}>
              {now.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </div>
            <div style={{ fontSize: 10, color: G.muted }}>
              {now.toLocaleDateString('ro-RO', { weekday: 'short', day: 'numeric', month: 'short' })}
            </div>
          </div>
          <div style={{ width: 1, height: 32, background: G.border }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Avatar name={profile?.name} id={1} size={32} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.2 }}>{profile?.name || profile?.email?.split('@')[0]}</div>
              <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
                <span className={`badge ${isAdmin ? 'badge-admin' : 'badge-manager'}`}>{isAdmin ? '⚙ Admin' : '👤 Manager'}</span>
                {!isAdmin && profile?.department && <span className="badge badge-dept">{profile.department}</span>}
              </div>
            </div>
          </div>
          <button className="nav-link" onClick={signOut} style={{ color: G.red }}>⎋ Ieșire</button>
        </div>
      </div>
      <div style={{ padding: '28px 32px', maxWidth: 1400, margin: '0 auto' }} className="fade-in">
        {children}
      </div>
    </div>
  )
}

// ─── Login Page ───────────────────────────────────────────────────────────────
function LoginPage() {
  const { signIn, session } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  if (session) return <Navigate to="/" replace />

  const handleLogin = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await signIn(email, password)
    if (error) setError(error.message === 'Invalid login credentials' ? 'Email sau parolă incorectă' : error.message)
    setLoading(false)
  }

  return (
    <div style={{ ...S.page, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
      <style>{css}</style>
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at 30% 40%, #1F6FEB08 0%, transparent 60%), radial-gradient(ellipse at 70% 60%, #3FB95008 0%, transparent 60%)' }} />
      <div style={{ ...S.card, padding: 40, width: 420, position: 'relative' }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ width: 56, height: 56, background: 'linear-gradient(135deg, #1F6FEB, #388BFD)', borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, margin: '0 auto 16px' }}>⏱</div>
          <div style={{ fontSize: 26, fontWeight: 800 }}>PontajPRO</div>
          <div style={{ color: G.muted, fontSize: 14, marginTop: 6 }}>Sistem de evidență a prezenței</div>
        </div>

        <form onSubmit={handleLogin}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, color: G.muted, fontWeight: 600, display: 'block', marginBottom: 7, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Email</label>
            <input style={S.input} type="email" placeholder="manager@companie.ro" value={email} onChange={e => setEmail(e.target.value)} required autoFocus />
          </div>
          <div style={{ marginBottom: 24 }}>
            <label style={{ fontSize: 12, color: G.muted, fontWeight: 600, display: 'block', marginBottom: 7, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Parolă</label>
            <input style={S.input} type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} required />
          </div>
          {error && <div style={{ background: G.redDim, color: G.red, border: `1px solid ${G.red}33`, borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 16 }}>⚠ {error}</div>}
          <button style={{ ...S.btnPrimary, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }} type="submit" disabled={loading}>
            {loading ? <><div className="spinner" />Se conectează...</> : '→ Conectare'}
          </button>
        </form>
        <div style={{ textAlign: 'center', marginTop: 20, fontSize: 12, color: G.dim }}>
          Contactați administratorul pentru acces
        </div>
      </div>
    </div>
  )
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
function DashboardPage() {
  const { profile } = useAuth()
  const [stats, setStats] = useState({ present: 0, checkedOut: 0, total: 0, avgMins: 0 })
  const [deptStats, setDeptStats] = useState([])
  const [recent, setRecent] = useState([])
  const [loading, setLoading] = useState(true)
  const isAdmin = profile?.role === 'admin'

  useEffect(() => { loadData() }, [profile])

  const loadData = async () => {
    setLoading(true)
    const today = todayStr()
    let empQuery = supabase.from('employees').select('id, name, department').eq('active', true)
    if (!isAdmin) empQuery = empQuery.eq('department', profile?.department)
    const { data: employees } = await empQuery

    if (!employees) { setLoading(false); return }

    const empIds = employees.map(e => e.id)
    const { data: records } = await supabase.from('pontaj_records').select('*, employees(name, department)').eq('date', today).in('employee_id', empIds).order('check_in', { ascending: false })

    const present = records?.filter(r => r.check_in).length || 0
    const checkedOut = records?.filter(r => r.check_out).length || 0
    const totalMins = records?.reduce((s, r) => s + diffMins(r.check_in, r.check_out), 0) || 0
    setStats({ present, checkedOut, total: employees.length, avgMins: present > 0 ? Math.round(totalMins / present) : 0 })
    setRecent(records?.slice(0, 10) || [])

    const depts = isAdmin ? DEPARTMENTS : [profile?.department]
    setDeptStats(depts.map(dept => {
      const deptEmps = employees.filter(e => e.department === dept)
      const deptPresent = records?.filter(r => r.employees?.department === dept && r.check_in).length || 0
      return { dept, total: deptEmps.length, present: deptPresent }
    }).filter(d => d.total > 0))

    setLoading(false)
  }

  if (loading) return <Layout><LoadingScreen /></Layout>

  const statCards = [
    { label: 'Total Angajați', val: stats.total, icon: '👥', color: G.blue, sub: 'activi în sistem' },
    { label: 'Prezenți Azi', val: stats.present, icon: '✅', color: G.green, sub: `din ${stats.total}` },
    { label: 'Au Plecat', val: stats.checkedOut, icon: '🚪', color: G.yellow, sub: 'ieșire înregistrată' },
    { label: 'Medie Ore/Om', val: minsToHM(stats.avgMins), icon: '⏱', color: G.purple, sub: 'pentru cei prezenți' },
  ]

  return (
    <Layout>
      <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 24 }}>
        Bun venit{profile?.name ? `, ${profile.name.split(' ')[0]}` : ''}! 👋
        {!isAdmin && <span style={{ fontSize: 14, color: G.muted, fontWeight: 400, marginLeft: 12 }}>Departament: {profile?.department}</span>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        {statCards.map(s => (
          <div key={s.label} style={{ ...S.card, padding: '20px 24px', transition: 'transform 0.2s, border-color 0.2s' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 12, color: G.muted, marginBottom: 8, fontWeight: 600 }}>{s.label}</div>
                <div style={{ fontSize: 34, fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.val}</div>
                <div style={{ fontSize: 12, color: G.dim, marginTop: 6 }}>{s.sub}</div>
              </div>
              <div style={{ fontSize: 28 }}>{s.icon}</div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isAdmin ? '1fr 1fr' : '1fr', gap: 20 }}>
        {isAdmin && (
          <div style={{ ...S.card, padding: 24 }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 20 }}>Prezență pe Departamente</div>
            {deptStats.map(d => (
              <div key={d.dept} style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 13 }}>{d.dept}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: G.blue }}>{d.present}/{d.total}</span>
                </div>
                <div style={{ height: 5, background: '#21262D', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${d.total ? (d.present / d.total) * 100 : 0}%`, background: d.present / d.total > 0.7 ? G.green : d.present / d.total > 0.4 ? G.yellow : G.red, borderRadius: 3, transition: 'width 0.5s' }} />
                </div>
              </div>
            ))}
          </div>
        )}
        <div style={{ ...S.card, padding: 24 }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>Activitate Recentă</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {recent.length === 0 ? (
              <div style={{ textAlign: 'center', color: G.muted, padding: '24px 0', fontSize: 13 }}>Nicio activitate înregistrată azi</div>
            ) : recent.map(r => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', background: '#1C2128', borderRadius: 8 }}>
                <Avatar name={r.employees?.name} size={32} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{r.employees?.name}</div>
                  <div style={{ fontSize: 11, color: G.muted }}>{r.employees?.department}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  {r.check_in && <div style={{ fontSize: 12, color: G.green }}>⬇ {fmt(r.check_in)}</div>}
                  {r.check_out && <div style={{ fontSize: 12, color: G.red }}>⬆ {fmt(r.check_out)}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Layout>
  )
}

// ─── Pontaj Page ──────────────────────────────────────────────────────────────
function PontajPage() {
  const { profile } = useAuth()
  const [employees, setEmployees] = useState([])
  const [records, setRecords] = useState({})
  const [search, setSearch] = useState('')
  const [deptFilter, setDeptFilter] = useState('Toate')
  const [selectedDate, setSelectedDate] = useState(todayStr())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(null)
  const [toast, showToast] = useToast()
  const isAdmin = profile?.role === 'admin'
  const isToday = selectedDate === todayStr()

  useEffect(() => { loadEmployees() }, [profile])
  useEffect(() => { if (employees.length > 0) loadRecords() }, [employees, selectedDate])

  const loadEmployees = async () => {
    let q = supabase.from('employees').select('*').eq('active', true).order('name')
    if (!isAdmin) q = q.eq('department', profile?.department)
    const { data } = await q
    setEmployees(data || [])
  }

  const loadRecords = async () => {
    setLoading(true)
    const ids = employees.map(e => e.id)
    const { data } = await supabase.from('pontaj_records').select('*').eq('date', selectedDate).in('employee_id', ids)
    const map = {}
    data?.forEach(r => { map[r.employee_id] = r })
    setRecords(map)
    setLoading(false)
  }

  const handleCheckIn = async (emp) => {
    if (records[emp.id]?.check_in) return
    setSaving(emp.id)
    const { data, error } = await supabase.from('pontaj_records').upsert({
      employee_id: emp.id, date: selectedDate, check_in: new Date().toISOString(), check_out: null
    }, { onConflict: 'employee_id,date' }).select().single()
    if (!error) { setRecords(prev => ({ ...prev, [emp.id]: data })); showToast(`✓ Intrare: ${emp.name}`) }
    else showToast('Eroare la salvare', 'error')
    setSaving(null)
  }

  const handleCheckOut = async (emp) => {
    const rec = records[emp.id]
    if (!rec?.check_in || rec?.check_out) return
    setSaving(emp.id)
    const { data, error } = await supabase.from('pontaj_records').update({ check_out: new Date().toISOString() }).eq('id', rec.id).select().single()
    if (!error) { setRecords(prev => ({ ...prev, [emp.id]: data })); showToast(`✓ Ieșire: ${emp.name}`) }
    else showToast('Eroare la salvare', 'error')
    setSaving(null)
  }

  const handleManualSave = async (emp, checkIn, checkOut) => {
    if (!checkIn) return
    setSaving(emp.id)
    const ciISO = new Date(`${selectedDate}T${checkIn}:00`).toISOString()
    const coISO = checkOut ? new Date(`${selectedDate}T${checkOut}:00`).toISOString() : null
    const { data, error } = await supabase.from('pontaj_records').upsert({
      employee_id: emp.id, date: selectedDate, check_in: ciISO, check_out: coISO
    }, { onConflict: 'employee_id,date' }).select().single()
    if (!error) { setRecords(prev => ({ ...prev, [emp.id]: data })); showToast(`✓ Salvat: ${emp.name}`) }
    else showToast('Eroare la salvare', 'error')
    setSaving(null)
  }

  const handleToggleLunch = async (emp) => {
    const rec = records[emp.id]
    if (!rec?.check_in || !rec?.check_out) return
    if (!spansLunch(rec.check_in, rec.check_out)) return
    setSaving(emp.id)
    const newVal = rec.lunch_break === false ? true : false
    const { data, error } = await supabase.from('pontaj_records').update({ lunch_break: newVal }).eq('id', rec.id).select().single()
    if (!error) { setRecords(prev => ({ ...prev, [emp.id]: data })); showToast(newVal ? '☕ Pauză masă activată' : '⚡ Pauză masă dezactivată', 'warn') }
    setSaving(null)
  }

  const depts = isAdmin ? ['Toate', ...DEPARTMENTS] : [profile?.department || 'Toate']

  const filtered = employees.filter(e => {
    const ms = e.name.toLowerCase().includes(search.toLowerCase()) || e.department.toLowerCase().includes(search.toLowerCase())
    const md = deptFilter === 'Toate' || e.department === deptFilter
    return ms && md
  })

  // Stats for header
  const presentCount = filtered.filter(e => records[e.id]?.check_in).length

  return (
    <Layout>
      <Toast toast={toast} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>Pontaj</div>
          <div style={{ fontSize: 13, color: G.muted, marginTop: 4 }}>
            {presentCount} prezenți din {filtered.length} angajați
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} style={{ ...S.input, width: 'auto', padding: '8px 12px' }} />
          <input placeholder="🔍 Caută..." value={search} onChange={e => setSearch(e.target.value)} style={{ ...S.input, width: 200 }} />
          {isAdmin && (
            <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)}>
              {depts.map(d => <option key={d}>{d}</option>)}
            </select>
          )}
        </div>
      </div>

      {/* Lunch info banner */}
      <div style={{ background: '#1A2A3A', border: `1px solid #58A6FF33`, borderRadius: 10, padding: '10px 18px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
        <span style={{ fontSize: 18 }}>☕</span>
        <span style={{ color: '#79C0FF' }}>
          <strong>Pauză masă automată 12:00–13:00</strong> — se scade 1 oră dacă angajatul a lucrat în intervalul 12:00–13:00. Poți dezactiva individual cu butonul ☕.
        </span>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><div className="spinner" style={{ width: 32, height: 32 }} /></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {filtered.map(emp => {
            const rec = records[emp.id]
            const isIn = rec?.check_in && !rec?.check_out
            const isDone = rec?.check_in && rec?.check_out
            const isSav = saving === emp.id
            const lunchApplies = spansLunch(rec?.check_in, rec?.check_out)
            const lunchActive = rec?.lunch_break !== false && lunchApplies
            const gross = diffMins(rec?.check_in, rec?.check_out)
            const net = netMins(rec?.check_in, rec?.check_out, rec?.lunch_break !== false)

            return (
              <div key={emp.id} style={{ ...S.card, padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 14, transition: 'border-color 0.2s' }}>
                <Avatar name={emp.name} id={emp.id} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{emp.name}</div>
                  <div style={{ fontSize: 12, color: G.muted }}>{emp.position}</div>
                </div>
                <span className="badge badge-dept">{emp.department}</span>

                {/* Times */}
                <div style={{ textAlign: 'center', minWidth: 100 }}>
                  {rec?.check_in ? <div style={{ fontSize: 12, color: G.green, fontWeight: 600 }}>⬇ {fmt(rec.check_in)}</div> : <div style={{ fontSize: 12, color: G.dim }}>—</div>}
                  {rec?.check_out ? <div style={{ fontSize: 12, color: G.red, fontWeight: 600 }}>⬆ {fmt(rec.check_out)}</div> : null}
                </div>

                {/* Hours + lunch */}
                <div style={{ minWidth: 120, textAlign: 'center' }}>
                  {gross > 0 ? (
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: G.yellow }}>{minsToHM(net)}</div>
                      {lunchApplies && (
                        <div style={{ fontSize: 10, color: lunchActive ? '#79C0FF' : G.dim }}>
                          {lunchActive ? `☕ −1h pauză` : `⚡ brut ${minsToHM(gross)}`}
                        </div>
                      )}
                    </div>
                  ) : isIn ? <span style={{ fontSize: 12, color: G.green }}>● activ</span> : null}
                </div>

                {/* Lunch toggle (only if has check_out and spans lunch) */}
                {isDone && lunchApplies && (
                  <button
                    onClick={() => handleToggleLunch(emp)}
                    disabled={isSav}
                    title={lunchActive ? 'Dezactivează pauza de masă' : 'Activează pauza de masă'}
                    style={{ background: lunchActive ? '#1A2A3A' : '#2A1A1A', color: lunchActive ? '#79C0FF' : G.dim, border: `1px solid ${lunchActive ? '#58A6FF44' : G.border}`, borderRadius: 7, padding: '5px 10px', cursor: 'pointer', fontSize: 14, transition: 'all 0.2s' }}>
                    ☕
                  </button>
                )}

                {/* Action buttons */}
                {isToday ? (
                  <div style={{ display: 'flex', gap: 8 }}>
                    {!rec?.check_in && (
                      <button disabled={isSav} onClick={() => handleCheckIn(emp)}
                        style={{ background: G.greenDim, color: G.green, border: `1px solid ${G.green}44`, borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 700 }}>
                        {isSav ? '...' : 'Intrare'}
                      </button>
                    )}
                    {isIn && (
                      <button disabled={isSav} onClick={() => handleCheckOut(emp)}
                        style={{ background: G.redDim, color: G.red, border: `1px solid ${G.red}44`, borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 700 }}>
                        {isSav ? '...' : 'Ieșire'}
                      </button>
                    )}
                    {isDone && <span style={{ fontSize: 12, color: G.muted, padding: '7px 0' }}>✓ Complet</span>}
                  </div>
                ) : (
                  <ManualTimeInputRow emp={emp} rec={rec} onSave={handleManualSave} saving={isSav} />
                )}
              </div>
            )
          })}
          {filtered.length === 0 && (
            <div style={{ textAlign: 'center', color: G.muted, padding: '60px 0', fontSize: 14 }}>Niciun angajat găsit</div>
          )}
        </div>
      )}
    </Layout>
  )
}

function ManualTimeInputRow({ emp, rec, onSave, saving }) {
  const existIn = rec?.check_in ? new Date(rec.check_in).toTimeString().slice(0, 5) : ''
  const existOut = rec?.check_out ? new Date(rec.check_out).toTimeString().slice(0, 5) : ''
  const [ci, setCi] = useState(existIn)
  const [co, setCo] = useState(existOut)
  useEffect(() => { setCi(existIn); setCo(existOut) }, [existIn, existOut])
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <input type="time" value={ci} onChange={e => setCi(e.target.value)} style={{ ...S.input, width: 100, padding: '6px 10px', fontSize: 12 }} />
      <span style={{ color: G.dim, fontSize: 12 }}>—</span>
      <input type="time" value={co} onChange={e => setCo(e.target.value)} style={{ ...S.input, width: 100, padding: '6px 10px', fontSize: 12 }} />
      <button disabled={saving || !ci} onClick={() => onSave(emp, ci, co)}
        style={{ background: '#1F6FEB22', color: G.blue, border: `1px solid #1F6FEB44`, borderRadius: 7, padding: '6px 12px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 700 }}>
        {saving ? '...' : '💾'}
      </button>
    </div>
  )
}

// ─── Reports Page ─────────────────────────────────────────────────────────────
function ReportsPage() {
  const { profile } = useAuth()
  const now = new Date()
  const [selectedMonth, setSelectedMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
  const [deptFilter, setDeptFilter] = useState('Toate')
  const [data, setData] = useState([])
  const [detailedRecords, setDetailedRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [viewMode, setViewMode] = useState('summary') // 'summary' | 'detailed'
  const [toast, showToast] = useToast()
  const isAdmin = profile?.role === 'admin'

  useEffect(() => { loadReport() }, [selectedMonth, deptFilter, profile])

  const getMonthRange = () => {
    const [year, month] = selectedMonth.split('-').map(Number)
    const from = new Date(year, month - 1, 1)
    const to = new Date(year, month, 0) // last day of month
    return {
      fromStr: from.toISOString().split('T')[0],
      toStr: to.toISOString().split('T')[0],
      daysInMonth: to.getDate()
    }
  }

  const loadReport = async () => {
    setLoading(true)
    const { fromStr, toStr, daysInMonth } = getMonthRange()

    let empQ = supabase.from('employees').select('*').eq('active', true).order('name')
    if (!isAdmin) empQ = empQ.eq('department', profile?.department)
    else if (deptFilter !== 'Toate') empQ = empQ.eq('department', deptFilter)
    const { data: employees } = await empQ
    if (!employees) { setLoading(false); return }

    const { data: records } = await supabase.from('pontaj_records').select('*')
      .gte('date', fromStr).lte('date', toStr).in('employee_id', employees.map(e => e.id))

    // Summary per employee — ore nete (cu pauza de masa scazuta)
    const stats = employees.map(emp => {
      const empRecs = records?.filter(r => r.employee_id === emp.id) || []
      const daysPresent = empRecs.filter(r => r.check_in).length
      const totalMins = empRecs.reduce((s, r) => s + netMins(r.check_in, r.check_out, r.lunch_break !== false), 0)
      const totalGross = empRecs.reduce((s, r) => s + diffMins(r.check_in, r.check_out), 0)
      const lunchDays = empRecs.filter(r => r.lunch_break !== false && spansLunch(r.check_in, r.check_out)).length
      const avgMins = daysPresent > 0 ? Math.round(totalMins / daysPresent) : 0
      return { ...emp, daysPresent, totalMins, totalGross, lunchDays, avgMins, daysInMonth }
    }).sort((a, b) => b.totalMins - a.totalMins)
    setData(stats)

    // Detailed records with employee info
    const detailed = (records || []).map(r => {
      const emp = employees.find(e => e.id === r.employee_id)
      return { ...r, empName: emp?.name || '?', empDept: emp?.department || '?', empPos: emp?.position || '' }
    }).sort((a, b) => a.date.localeCompare(b.date) || a.empName.localeCompare(b.empName))
    setDetailedRecords(detailed)

    setLoading(false)
  }

  const exportToExcel = async () => {
    if (data.length === 0) { showToast('Nu există date de exportat', 'warn'); return }
    setExporting(true)
    const [year, month] = selectedMonth.split('-').map(Number)
    const monthName = new Date(year, month - 1).toLocaleString('ro-RO', { month: 'long', year: 'numeric' })

    const wb = XLSX.utils.book_new()

    // ── Sheet 1: Rezumat ──
    const summaryRows = [
      [`Pontaj ${monthName}${deptFilter !== 'Toate' ? ` — ${deptFilter}` : ''}`],
      [`Notă: Orele nete exclud pauza de masă 12:00-13:00 (1 oră) acolo unde se aplică`],
      [],
      ['Angajat', 'Departament', 'Funcție', 'Zile Prezent', `Zile Lucratoare (${getMonthRange().daysInMonth})`, 'Zile cu Pauza Masa', 'Ore Brute', 'Ore Nete', 'Medie Ore Nete/Zi', 'Overtime'],
      ...data.map(emp => [
        emp.name,
        emp.department,
        emp.position || '',
        emp.daysPresent,
        emp.daysInMonth,
        emp.lunchDays,
        +(emp.totalGross / 60).toFixed(2),
        +(emp.totalMins / 60).toFixed(2),
        +(emp.avgMins / 60).toFixed(2),
        emp.avgMins > 510 ? 'DA' : 'NU'
      ])
    ]
    const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows)
    wsSummary['!cols'] = [{ wch: 28 }, { wch: 16 }, { wch: 20 }, { wch: 14 }, { wch: 20 }, { wch: 18 }, { wch: 12 }, { wch: 12 }, { wch: 18 }, { wch: 10 }]
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Rezumat')

    // ── Sheet 2: Detaliat (fiecare zi) ──
    const detailRows = [
      [`Pontaj Detaliat — ${monthName}`],
      [],
      ['Data', 'Angajat', 'Departament', 'Funcție', 'Oră Intrare', 'Oră Ieșire', 'Ore Brute', 'Pauza Masa', 'Ore Nete', 'Note'],
      ...detailedRecords.filter(r => r.check_in).map(r => {
        const gross = diffMins(r.check_in, r.check_out)
        const lunchOn = r.lunch_break !== false && spansLunch(r.check_in, r.check_out)
        const net = netMins(r.check_in, r.check_out, r.lunch_break !== false)
        return [
          r.date,
          r.empName,
          r.empDept,
          r.empPos,
          r.check_in ? new Date(r.check_in).toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' }) : '',
          r.check_out ? new Date(r.check_out).toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' }) : 'Lipsă ieșire',
          +(gross / 60).toFixed(2),
          lunchOn ? '12:00-13:00 (−1h)' : 'Nu',
          +(net / 60).toFixed(2),
          r.notes || ''
        ]
      })
    ]
    const wsDetail = XLSX.utils.aoa_to_sheet(detailRows)
    wsDetail['!cols'] = [{ wch: 12 }, { wch: 28 }, { wch: 16 }, { wch: 20 }, { wch: 13 }, { wch: 13 }, { wch: 12 }, { wch: 20 }, { wch: 12 }, { wch: 20 }]
    XLSX.utils.book_append_sheet(wb, wsDetail, 'Detaliat pe Zile')

    // ── Sheet 3: Calendar prezenta (angajat x zi) — ore nete ──
    const { daysInMonth } = getMonthRange()
    const days = Array.from({ length: daysInMonth }, (_, i) => {
      const d = new Date(year, month - 1, i + 1)
      return `${String(i + 1).padStart(2, '0')} ${['Du', 'Lu', 'Ma', 'Mi', 'Jo', 'Vi', 'Sâ'][d.getDay()]}`
    })
    const calHeader = ['Angajat', 'Departament', ...days, 'TOTAL ORE NETE']
    const calRows = data.map(emp => {
      const row = [emp.name, emp.department]
      let total = 0
      for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
        const rec = detailedRecords.find(r => r.employee_id === emp.id && r.date === dateStr)
        const mins = rec ? netMins(rec.check_in, rec.check_out, rec.lunch_break !== false) : 0
        total += mins
        if (!rec?.check_in) row.push('')
        else if (!rec?.check_out) row.push('P')
        else row.push(+(mins / 60).toFixed(1))
      }
      row.push(+(total / 60).toFixed(2))
      return row
    })
    const wsCalendar = XLSX.utils.aoa_to_sheet([calHeader, ...calRows])
    wsCalendar['!cols'] = [{ wch: 28 }, { wch: 14 }, ...days.map(() => ({ wch: 6 })), { wch: 16 }]
    XLSX.utils.book_append_sheet(wb, wsCalendar, 'Calendar Prezenta')

    XLSX.writeFile(wb, `Pontaj_${monthName.replace(' ', '_')}.xlsx`)
    showToast(`✓ Export Excel: Pontaj_${monthName}.xlsx`)
    setExporting(false)
  }

  const monthLabel = () => {
    const [y, m] = selectedMonth.split('-').map(Number)
    return new Date(y, m - 1).toLocaleString('ro-RO', { month: 'long', year: 'numeric' })
  }

  return (
    <Layout>
      <Toast toast={toast} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>Rapoarte</div>
          <div style={{ fontSize: 13, color: G.muted, marginTop: 4 }}>
            {data.filter(e => e.daysPresent > 0).length} angajați activi în {monthLabel()}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {/* Month picker */}
          <input type="month" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}
            style={{ ...S.input, width: 'auto', padding: '8px 12px', fontSize: 14 }} />
          {isAdmin && (
            <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)}>
              <option>Toate</option>
              {DEPARTMENTS.map(d => <option key={d}>{d}</option>)}
            </select>
          )}
          {/* View toggle */}
          <div style={{ display: 'flex', background: G.surface, border: `1px solid ${G.border}`, borderRadius: 8, overflow: 'hidden' }}>
            {[['summary', '📊 Rezumat'], ['detailed', '📋 Detaliat']].map(([v, l]) => (
              <button key={v} onClick={() => setViewMode(v)} style={{ background: viewMode === v ? '#21262D' : 'none', color: viewMode === v ? G.text : G.muted, border: 'none', padding: '8px 14px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 700 }}>{l}</button>
            ))}
          </div>
          {/* Export button */}
          <button onClick={exportToExcel} disabled={exporting || loading || data.length === 0}
            style={{ ...S.btnPrimary, display: 'flex', alignItems: 'center', gap: 8, background: '#1A6B1A', opacity: data.length === 0 ? 0.5 : 1 }}>
            {exporting ? <><div className="spinner" />Export...</> : '⬇ Export Excel'}
          </button>
        </div>
      </div>

      {/* Info banner */}
      <div style={{ background: '#1F3A1F', border: `1px solid ${G.green}33`, borderRadius: 10, padding: '12px 18px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 12, fontSize: 13 }}>
        <span style={{ fontSize: 18 }}>📥</span>
        <span style={{ color: '#8FD490' }}>Exportul Excel conține <strong>3 foi</strong>: Rezumat, Detaliat pe Zile și Calendar Prezență (cu ore per zi per angajat)</span>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><div className="spinner" style={{ width: 32, height: 32 }} /></div>
      ) : viewMode === 'summary' ? (
        <div style={{ ...S.card, overflow: 'hidden' }}>
          <table>
            <thead>
              <tr style={{ background: G.bg }}>
                <th>Angajat</th><th>Departament</th><th>Zile Prezent</th>
                <th>Ore Brute</th><th>☕ Pauze Masă</th><th>Ore Nete</th><th>Medie / Zi</th><th>Overtime</th>
              </tr>
            </thead>
            <tbody>
              {data.length === 0 ? (
                <tr><td colSpan={8} style={{ textAlign: 'center', color: G.muted, padding: 48 }}>Nicio dată pentru luna selectată</td></tr>
              ) : data.map(emp => {
                const isOver = emp.avgMins > 510
                const lunchDeduct = emp.lunchDays * LUNCH_MINS
                return (
                  <tr key={emp.id}>
                    <td><div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><Avatar name={emp.name} id={emp.id} size={30} /><span style={{ fontWeight: 600 }}>{emp.name}</span></div></td>
                    <td><span className="badge badge-dept">{emp.department}</span></td>
                    <td>
                      <span style={{ color: G.blue, fontWeight: 700 }}>{emp.daysPresent}</span>
                      <span style={{ color: G.dim, fontSize: 12 }}> / {emp.daysInMonth}</span>
                      <div style={{ marginTop: 4, height: 3, width: 60, background: '#21262D', borderRadius: 2 }}>
                        <div style={{ height: '100%', width: `${(emp.daysPresent / emp.daysInMonth) * 100}%`, background: G.blue, borderRadius: 2 }} />
                      </div>
                    </td>
                    <td style={{ color: G.muted }}>{minsToHM(emp.totalGross)}</td>
                    <td>
                      {emp.lunchDays > 0
                        ? <span style={{ fontSize: 12, color: '#79C0FF' }}>☕ {emp.lunchDays}× (−{minsToHM(lunchDeduct)})</span>
                        : <span style={{ fontSize: 12, color: G.dim }}>—</span>}
                    </td>
                    <td style={{ fontWeight: 800, color: G.yellow }}>{minsToHM(emp.totalMins)}</td>
                    <td style={{ color: isOver ? G.yellow : G.text }}>{minsToHM(emp.avgMins)}</td>
                    <td>
                      <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: isOver ? G.yellowDim : G.greenDim, color: isOver ? G.yellow : G.green, border: `1px solid ${isOver ? G.yellow : G.green}44` }}>
                        {isOver ? '⚡ Ore extra' : '✓ Normal'}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ ...S.card, overflow: 'hidden' }}>
          <table>
            <thead>
              <tr style={{ background: G.bg }}>
                <th>Data</th><th>Angajat</th><th>Departament</th>
                <th>Intrare</th><th>Ieșire</th><th>Pauză Masă</th><th>Ore Nete</th>
              </tr>
            </thead>
            <tbody>
              {detailedRecords.filter(r => r.check_in).length === 0 ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', color: G.muted, padding: 48 }}>Nicio înregistrare</td></tr>
              ) : detailedRecords.filter(r => r.check_in).map(r => {
                const lunchOn = r.lunch_break !== false && spansLunch(r.check_in, r.check_out)
                const net = netMins(r.check_in, r.check_out, r.lunch_break !== false)
                return (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 600, color: G.blue }}>{new Date(r.date).toLocaleDateString('ro-RO', { weekday: 'short', day: '2-digit', month: '2-digit' })}</td>
                    <td><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Avatar name={r.empName} size={26} /><span style={{ fontWeight: 600, fontSize: 13 }}>{r.empName}</span></div></td>
                    <td><span className="badge badge-dept">{r.empDept}</span></td>
                    <td style={{ color: G.green, fontWeight: 600 }}>⬇ {fmt(r.check_in)}</td>
                    <td style={{ color: r.check_out ? G.red : G.yellow, fontWeight: 600 }}>{r.check_out ? `⬆ ${fmt(r.check_out)}` : '— lipsă'}</td>
                    <td>
                      {lunchOn
                        ? <span style={{ fontSize: 12, color: '#79C0FF' }}>☕ 12:00–13:00</span>
                        : <span style={{ fontSize: 12, color: G.dim }}>—</span>}
                    </td>
                    <td style={{ fontWeight: 700, color: G.yellow }}>{net > 0 ? minsToHM(net) : '—'}</td>
                  </tr>
                )
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
  const [tab, setTab] = useState('managers')
  const [managers, setManagers] = useState([])
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [toast, showToast] = useToast()

  // New manager form
  const [newEmail, setNewEmail] = useState('')
  const [newName, setNewName] = useState('')
  const [newDept, setNewDept] = useState(DEPARTMENTS[0])
  const [newRole, setNewRole] = useState('manager')
  const [newPwd, setNewPwd] = useState('')
  const [creating, setCreating] = useState(false)

  // New employee form
  const [empName, setEmpName] = useState('')
  const [empDept, setEmpDept] = useState(DEPARTMENTS[0])
  const [empPos, setEmpPos] = useState('')
  const [addingEmp, setAddingEmp] = useState(false)

  // Import state
  const [importPreview, setImportPreview] = useState(null) // array of rows
  const [importErrors, setImportErrors] = useState([])
  const [importing, setImporting] = useState(false)
  const fileInputRef = useRef(null)

  useEffect(() => { loadData() }, [tab])

  const loadData = async () => {
    setLoading(true)
    if (tab === 'managers') {
      const { data } = await supabase.from('profiles').select('*').order('name')
      setManagers(data || [])
    } else {
      const { data } = await supabase.from('employees').select('*').order('name')
      setEmployees(data || [])
    }
    setLoading(false)
  }

  const createManager = async () => {
    if (!newEmail || !newPwd || !newName) { showToast('Completați toate câmpurile', 'warn'); return }
    setCreating(true)
    const { data: authData, error: authErr } = await supabase.auth.signUp({ email: newEmail, password: newPwd })
    if (authErr) { showToast(authErr.message, 'error'); setCreating(false); return }
    if (authData.user) {
      await supabase.from('profiles').upsert({ id: authData.user.id, email: newEmail, name: newName, role: newRole, department: newRole === 'admin' ? null : newDept })
      showToast(`✓ Manager creat: ${newName}`)
      setNewEmail(''); setNewName(''); setNewPwd('')
      loadData()
    }
    setCreating(false)
  }

  const addEmployee = async () => {
    if (!empName) { showToast('Introduceți numele', 'warn'); return }
    setAddingEmp(true)
    const { error } = await supabase.from('employees').insert({ name: empName, department: empDept, position: empPos, active: true })
    if (!error) { showToast(`✓ Angajat adăugat: ${empName}`); setEmpName(''); setEmpPos(''); loadData() }
    else showToast('Eroare la adăugare', 'error')
    setAddingEmp(false)
  }

  const toggleEmployeeActive = async (emp) => {
    await supabase.from('employees').update({ active: !emp.active }).eq('id', emp.id)
    setEmployees(prev => prev.map(e => e.id === emp.id ? { ...e, active: !e.active } : e))
    showToast(emp.active ? `${emp.name} dezactivat` : `${emp.name} reactivat`, emp.active ? 'warn' : 'success')
  }

  // ── Import Excel / CSV ──
  const handleFileSelect = (e) => {
    const file = e.target.files[0]
    if (!file) return
    setImportErrors([])
    setImportPreview(null)
    const ext = file.name.split('.').pop().toLowerCase()

    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        let rows = []
        if (ext === 'csv') {
          const text = ev.target.result
          const lines = text.split('\n').filter(l => l.trim())
          rows = lines.map(l => l.split(',').map(c => c.replace(/^"|"$/g, '').trim()))
        } else {
          const wb = XLSX.read(ev.target.result, { type: 'array' })
          const ws = wb.Sheets[wb.SheetNames[0]]
          rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
        }

        if (rows.length < 2) { showToast('Fișierul este gol sau are doar antet', 'warn'); return }

        // Auto-detect columns (case-insensitive)
        const header = rows[0].map(h => String(h).toLowerCase().trim())
        const colIdx = {
          name: header.findIndex(h => ['nume', 'name', 'angajat', 'prenume_nume', 'nume complet'].some(k => h.includes(k))),
          dept: header.findIndex(h => ['departament', 'department', 'dept'].some(k => h.includes(k))),
          pos:  header.findIndex(h => ['functie', 'funcție', 'position', 'post', 'rol'].some(k => h.includes(k))),
        }

        const errors = []
        if (colIdx.name === -1) errors.push('Coloana "Nume" nu a fost găsită. Asigurați-vă că există o coloană cu antetul "Nume" sau "Angajat".')
        if (colIdx.dept === -1) errors.push('Coloana "Departament" nu a fost găsită.')
        if (errors.length > 0) { setImportErrors(errors); return }

        const preview = rows.slice(1)
          .filter(row => row[colIdx.name]?.toString().trim())
          .map(row => ({
            name: row[colIdx.name]?.toString().trim(),
            department: row[colIdx.dept]?.toString().trim() || '',
            position: colIdx.pos >= 0 ? row[colIdx.pos]?.toString().trim() : '',
            valid: !!row[colIdx.name]?.toString().trim() && !!row[colIdx.dept]?.toString().trim()
          }))

        const invalid = preview.filter(r => !r.valid)
        if (invalid.length > 0) errors.push(`${invalid.length} rânduri fără departament și vor fi ignorate.`)
        setImportErrors(errors)
        setImportPreview(preview.filter(r => r.valid))
      } catch (err) {
        showToast('Eroare la citirea fișierului: ' + err.message, 'error')
      }
    }

    if (ext === 'csv') reader.readAsText(file, 'UTF-8')
    else reader.readAsArrayBuffer(file)

    // Reset input so same file can be re-selected
    e.target.value = ''
  }

  const confirmImport = async () => {
    if (!importPreview?.length) return
    setImporting(true)
    const toInsert = importPreview.map(r => ({ name: r.name, department: r.department, position: r.position || null, active: true }))

    // Insert in batches of 50
    let imported = 0
    for (let i = 0; i < toInsert.length; i += 50) {
      const batch = toInsert.slice(i, i + 50)
      const { error } = await supabase.from('employees').insert(batch)
      if (!error) imported += batch.length
    }
    showToast(`✓ ${imported} angajați importați cu succes!`)
    setImportPreview(null)
    setImportErrors([])
    loadData()
    setImporting(false)
  }

  const downloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Nume', 'Departament', 'Functie'],
      ['Ion Popescu', 'IT', 'Senior Developer'],
      ['Maria Ionescu', 'Vânzări', 'Sales Rep'],
      ['Ana Constantin', 'HR', 'HR Specialist'],
    ])
    ws['!cols'] = [{ wch: 28 }, { wch: 18 }, { wch: 22 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Angajati')
    XLSX.writeFile(wb, 'template_import_angajati.xlsx')
  }

  return (
    <Layout>
      <Toast toast={toast} />
      <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 24 }}>⚙ Administrare</div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        {[['managers', '👤 Manageri'], ['employees', '👥 Angajați']].map(([v, l]) => (
          <button key={v} onClick={() => setTab(v)} style={{ ...S.btnSecondary, background: tab === v ? '#21262D' : G.bg, color: tab === v ? G.text : G.muted }}>
            {l}
          </button>
        ))}
      </div>

      {tab === 'managers' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 20 }}>
          <div style={{ ...S.card, overflow: 'hidden' }}>
            {loading ? <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div> : (
              <table>
                <thead><tr style={{ background: G.bg }}><th>Nume</th><th>Email</th><th>Rol</th><th>Departament</th></tr></thead>
                <tbody>
                  {managers.map(m => (
                    <tr key={m.id}>
                      <td><div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><Avatar name={m.name} size={28} /><span style={{ fontWeight: 600 }}>{m.name}</span></div></td>
                      <td style={{ color: G.muted, fontSize: 13 }}>{m.email}</td>
                      <td><span className={`badge ${m.role === 'admin' ? 'badge-admin' : 'badge-manager'}`}>{m.role === 'admin' ? '⚙ Admin' : '👤 Manager'}</span></td>
                      <td>{m.department ? <span className="badge badge-dept">{m.department}</span> : <span style={{ color: G.dim, fontSize: 12 }}>Toate</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div style={{ ...S.card, padding: 24 }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 20 }}>Adaugă Manager</div>
            {[
              ['Nume complet', newName, setNewName, 'text', 'Ion Popescu'],
              ['Email', newEmail, setNewEmail, 'email', 'ion.popescu@firma.ro'],
              ['Parolă temporară', newPwd, setNewPwd, 'password', '••••••••'],
            ].map(([label, val, set, type, ph]) => (
              <div key={label} style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 11, color: G.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 6 }}>{label}</label>
                <input style={S.input} type={type} placeholder={ph} value={val} onChange={e => set(e.target.value)} />
              </div>
            ))}
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 11, color: G.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 6 }}>Rol</label>
              <select value={newRole} onChange={e => setNewRole(e.target.value)} style={{ width: '100%' }}>
                <option value="manager">👤 Manager</option>
                <option value="admin">⚙ Admin</option>
              </select>
            </div>
            {newRole === 'manager' && (
              <div style={{ marginBottom: 20 }}>
                <label style={{ fontSize: 11, color: G.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 6 }}>Departament</label>
                <select value={newDept} onChange={e => setNewDept(e.target.value)} style={{ width: '100%' }}>
                  {DEPARTMENTS.map(d => <option key={d}>{d}</option>)}
                </select>
              </div>
            )}
            <button style={{ ...S.btnPrimary, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }} onClick={createManager} disabled={creating}>
              {creating ? <><div className="spinner" />Se creează...</> : '+ Adaugă Manager'}
            </button>
          </div>
        </div>
      )}

      {tab === 'employees' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 20 }}>
          {/* Left: table + import preview */}
          <div>
            <div style={{ ...S.card, overflow: 'hidden', marginBottom: importPreview ? 16 : 0 }}>
              {loading ? <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div> : (
                <table>
                  <thead><tr style={{ background: G.bg }}><th>Nume</th><th>Departament</th><th>Funcție</th><th>Status</th><th>Acțiune</th></tr></thead>
                  <tbody>
                    {employees.map(emp => (
                      <tr key={emp.id}>
                        <td><div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><Avatar name={emp.name} id={emp.id} size={28} /><span style={{ fontWeight: 600 }}>{emp.name}</span></div></td>
                        <td><span className="badge badge-dept">{emp.department}</span></td>
                        <td style={{ color: G.muted, fontSize: 13 }}>{emp.position || '—'}</td>
                        <td>
                          <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: emp.active ? G.greenDim : G.redDim, color: emp.active ? G.green : G.red, border: `1px solid ${emp.active ? G.green : G.red}44` }}>
                            {emp.active ? '● Activ' : '○ Inactiv'}
                          </span>
                        </td>
                        <td>
                          <button onClick={() => toggleEmployeeActive(emp)} style={{ ...S.btnSecondary, padding: '5px 12px', fontSize: 12 }}>
                            {emp.active ? 'Dezactivează' : 'Activează'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Import Preview */}
            {importPreview && (
              <div style={{ ...S.card, padding: 20, border: `1px solid ${G.green}44` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: G.green }}>✓ Previzualizare import — {importPreview.length} angajați</div>
                    <div style={{ fontSize: 12, color: G.muted, marginTop: 2 }}>Verificați datele înainte de confirmare</div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => setImportPreview(null)} style={{ ...S.btnSecondary, fontSize: 12 }}>✕ Anulează</button>
                    <button onClick={confirmImport} disabled={importing} style={{ ...S.btnPrimary, fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, background: '#1A6B1A' }}>
                      {importing ? <><div className="spinner" />Se importă...</> : `⬆ Confirmă import (${importPreview.length})`}
                    </button>
                  </div>
                </div>
                {importErrors.length > 0 && (
                  <div style={{ background: G.yellowDim, border: `1px solid ${G.yellow}44`, borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 12, color: G.yellow }}>
                    {importErrors.map((e, i) => <div key={i}>⚠ {e}</div>)}
                  </div>
                )}
                <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                  <table>
                    <thead><tr style={{ background: G.bg }}><th>#</th><th>Nume</th><th>Departament</th><th>Funcție</th></tr></thead>
                    <tbody>
                      {importPreview.slice(0, 50).map((r, i) => (
                        <tr key={i}>
                          <td style={{ color: G.dim, fontSize: 12 }}>{i + 1}</td>
                          <td style={{ fontWeight: 600 }}>{r.name}</td>
                          <td><span className="badge badge-dept">{r.department}</span></td>
                          <td style={{ color: G.muted, fontSize: 13 }}>{r.position || '—'}</td>
                        </tr>
                      ))}
                      {importPreview.length > 50 && <tr><td colSpan={4} style={{ textAlign: 'center', color: G.muted, fontSize: 12 }}>... și încă {importPreview.length - 50} angajați</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Right: Add single + Import */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Import Card */}
            <div style={{ ...S.card, padding: 24, border: `1px solid #1F6FEB44` }}>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>📥 Import din Excel / CSV</div>
              <div style={{ fontSize: 12, color: G.muted, marginBottom: 16, lineHeight: 1.6 }}>
                Importă toți angajații dintr-un fișier. Fișierul trebuie să aibă coloanele: <strong>Nume</strong>, <strong>Departament</strong>, Functie (opțional).
              </div>

              {/* Template download */}
              <button onClick={downloadTemplate} style={{ ...S.btnSecondary, width: '100%', fontSize: 12, marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                ⬇ Descarcă template Excel
              </button>

              {/* File drop zone */}
              <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={handleFileSelect} />
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) { const dt = new DataTransfer(); dt.items.add(f); fileInputRef.current.files = dt.files; handleFileSelect({ target: fileInputRef.current }) } }}
                style={{ border: `2px dashed ${G.border2}`, borderRadius: 10, padding: '24px 16px', textAlign: 'center', cursor: 'pointer', transition: 'all 0.2s' }}
                onMouseEnter={e => e.currentTarget.style.borderColor = G.blue}
                onMouseLeave={e => e.currentTarget.style.borderColor = G.border2}
              >
                <div style={{ fontSize: 28, marginBottom: 8 }}>📂</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: G.text }}>Click sau drag & drop</div>
                <div style={{ fontSize: 11, color: G.muted, marginTop: 4 }}>.xlsx, .xls, .csv</div>
              </div>

              {importErrors.length > 0 && !importPreview && (
                <div style={{ background: G.redDim, border: `1px solid ${G.red}44`, borderRadius: 8, padding: '10px 14px', marginTop: 12, fontSize: 12, color: G.red }}>
                  {importErrors.map((e, i) => <div key={i}>⚠ {e}</div>)}
                </div>
              )}
            </div>

            {/* Add single employee */}
            <div style={{ ...S.card, padding: 24 }}>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>+ Adaugă Angajat Manual</div>
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 11, color: G.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 6 }}>Nume complet *</label>
                <input style={S.input} placeholder="Ana Ionescu" value={empName} onChange={e => setEmpName(e.target.value)} />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 11, color: G.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 6 }}>Departament</label>
                <select value={empDept} onChange={e => setEmpDept(e.target.value)} style={{ width: '100%' }}>
                  {DEPARTMENTS.map(d => <option key={d}>{d}</option>)}
                </select>
              </div>
              <div style={{ marginBottom: 20 }}>
                <label style={{ fontSize: 11, color: G.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 6 }}>Funcție</label>
                <input style={S.input} placeholder="Specialist, Senior, Manager..." value={empPos} onChange={e => setEmpPos(e.target.value)} />
              </div>
              <button style={{ ...S.btnPrimary, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }} onClick={addEmployee} disabled={addingEmp}>
                {addingEmp ? <><div className="spinner" />Se adaugă...</> : '+ Adaugă Angajat'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}

// ─── App Root ─────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
        <Route path="/pontaj" element={<ProtectedRoute><PontajPage /></ProtectedRoute>} />
        <Route path="/rapoarte" element={<ProtectedRoute><ReportsPage /></ProtectedRoute>} />
        <Route path="/admin" element={<ProtectedRoute adminOnly><AdminPage /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  )
}
