// ═══════════════════════════════════════════════════════════════════════════
// AppMobilManageri.jsx — v1 (30.06.2026)
// Pagină mobile-first pentru managerii de proiect (rută /m, PWA add-to-home).
// Launcher cu 4 butoane mari + Raport zilnic de lucrare (hibrid):
//   - Personal: automat din pontaj (v_pontaj_personal_santier), editabil
//   - Utilaje: pre-populate din alimentări ieri+azi (v_utilaje_santier_recent), stare bifabilă
//   - Activități/probleme/plan: text (paste din WhatsApp)
//   - Poze: din galerie/cameră → bucket rapoarte-zilnice
// Acces: fiecare manager vede DOAR șantierele lui (profile_sites); owner vede tot.
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from './lib/supabase.js'

const G = {
  bg: '#0D1117', surface: '#161B22', surface2: '#1C2230', border: '#21262D', border2: '#30363D',
  text: '#E6EDF3', muted: '#8B949E', dim: '#6E7681',
  blue: '#58A6FF', green: '#3FB950', red: '#F85149', yellow: '#D29922', purple: '#BC8CFF', orange: '#F0883E',
  logistica: '#E3B341',
}
const BUCKET = 'rapoarte-zilnice'
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'
const azi = () => new Date().toISOString().slice(0, 10)

const inputStyle = { background: G.bg, border: `1px solid ${G.border2}`, color: G.text, borderRadius: 10, padding: '12px 14px', fontFamily: 'inherit', fontSize: 16, outline: 'none', width: '100%', boxSizing: 'border-box' }
const labelStyle = { fontSize: 13, color: G.muted, marginBottom: 6, display: 'block', fontWeight: 600 }

const PERSONAL_CAT = [
  { key: 'sudori', label: '🔥 Sudori' },
  { key: 'lacatusi', label: '🔧 Lăcătuși' },
  { key: 'operatori', label: '🚜 Operatori utilaje' },
  { key: 'soferi', label: '🚛 Șoferi' },
  { key: 'necalificati', label: '👷 Necalificați' },
  { key: 'tesa', label: '👔 TESA' },
  { key: 'altii', label: '👤 Alții' },
]
// Cât timp ținem un utilaj în raport fără nicio dovadă (alimentare) că mai e pe șantier
const PRAG_ATENTIE = 10   // zile → îl arătăm, dar cu semn de întrebare
const PRAG_SCOATERE = 30  // zile → nu-l mai pre-completăm deloc

const tipIcon = (tip) => /utilaj/i.test(tip || '') ? '🚜' : (tip ? '🚗' : '🔧')
const oreKm = (u) => /utilaj/i.test(u.tip || '')
  ? (u.ore != null ? `${Number(u.ore).toLocaleString('ro-RO')} ore` : '')
  : (u.km != null ? `${Number(u.km).toLocaleString('ro-RO')} km` : '')

export default function AppMobilManageri() {
  const nav = useNavigate()
  const [view, setView] = useState('launcher')   // launcher | raport
  const [profile, setProfile] = useState(null)
  const [sites, setSites] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }
      const { data: prof } = await supabase.from('profiles').select('id, name, role, is_owner').eq('id', user.id).maybeSingle()
      setProfile(prof || null)
      let siteList = []
      if (prof?.is_owner) {
        const { data } = await supabase.from('sites').select('id, name').eq('active', true).order('name')
        siteList = data || []
      } else {
        const { data: ps } = await supabase.from('profile_sites').select('site_id, sites(id, name)').eq('profile_id', user.id)
        siteList = (ps || []).map(r => r.sites).filter(Boolean).sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      }
      setSites(siteList)
      setLoading(false)
    })()
  }, [])

  if (loading) return <Shell><div style={{ color: G.dim, textAlign: 'center', padding: 60 }}>Se încarcă…</div></Shell>

  if (view === 'raport') return <RaportZilnic profile={profile} sites={sites} onBack={() => setView('launcher')} />

  // ── Launcher ──
  const butoane = [
    { icon: '📋', label: 'Raport\nlucrare', color: G.logistica, onClick: () => setView('raport') },
    { icon: '⏱️', label: 'Pontaj\nechipă', color: G.blue, onClick: () => nav('/pontaj') },
    { icon: '🎫', label: 'Raportare\nproblemă', color: G.orange, onClick: () => nav('/tichete?action=new') },
    { icon: '🚛', label: 'Cerere\ntransport', color: G.green, onClick: () => nav('/logistica') },
  ]
  return (
    <Shell>
      <div style={{ textAlign: 'center', marginBottom: 28, marginTop: 12 }}>
        <div style={{ fontSize: 26, fontWeight: 800, color: G.text }}>Salut{profile?.name ? `, ${profile.name.split(' ')[0]}` : ''}! 👋</div>
        <div style={{ fontSize: 14, color: G.muted, marginTop: 4 }}>{fmtDate(azi())} · {sites.length} {sites.length === 1 ? 'lucrare' : 'lucrări'}</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        {butoane.map((b, i) => (
          <button key={i} onClick={b.onClick} style={{
            background: G.surface, border: `1px solid ${G.border}`, borderLeft: `4px solid ${b.color}`,
            borderRadius: 16, padding: '26px 14px', cursor: 'pointer', minHeight: 130,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12,
            color: G.text, fontFamily: 'inherit', transition: 'transform .1s',
          }}
            onTouchStart={e => e.currentTarget.style.transform = 'scale(.96)'}
            onTouchEnd={e => e.currentTarget.style.transform = 'scale(1)'}>
            <span style={{ fontSize: 42 }}>{b.icon}</span>
            <span style={{ fontSize: 15, fontWeight: 700, textAlign: 'center', whiteSpace: 'pre-line', lineHeight: 1.25 }}>{b.label}</span>
          </button>
        ))}
      </div>
      <div style={{ textAlign: 'center', marginTop: 30 }}>
        <button onClick={() => nav('/')} style={{ background: 'transparent', border: 'none', color: G.dim, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline' }}>
          ← Înapoi la aplicația completă
        </button>
      </div>
    </Shell>
  )
}

// ── Ecran Raport zilnic ──
function RaportZilnic({ profile, sites, onBack }) {
  const [siteId, setSiteId] = useState(sites.length === 1 ? sites[0].id : null)
  const [personal, setPersonal] = useState(null)
  const [utilaje, setUtilaje] = useState([])
  const [lucrari, setLucrari] = useState('')
  const [proiectId, setProiectId] = useState(null)          // proiectul legat de lucrare (sites.proiect_id)
  const [activitati, setActivitati] = useState([])          // proiect_activitati ale proiectului
  const [lucrariAct, setLucrariAct] = useState({})          // {activitate_id: cantitate azi}
  const [unitati, setUnitati] = useState([])                // proiect_unitati active (tronson/obiect/zonă)
  const [unitateId, setUnitateId] = useState(null)          // unde s-a lucrat azi
  const [masini, setMasini] = useState('')
  const [probleme, setProbleme] = useState('')
  const [subcontractori, setSubcontractori] = useState('')
  const [aprovizionare, setAprovizionare] = useState('')
  const [planMaine, setPlanMaine] = useState('')
  const [poze, setPoze] = useState([])           // File[] noi (de urcat)
  const [pozeExistente, setPozeExistente] = useState([])  // [{path, url}] din raport salvat
  const [existingId, setExistingId] = useState(null)      // id raport azi dacă există → editare
  const [loadingData, setLoadingData] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)

  const siteName = sites.find(s => s.id === siteId)?.name || ''

  const loadSiteData = useCallback(async (sid) => {
    if (!sid) return
    setLoadingData(true)
    setMsg(null)
    // ── Activitățile proiectului legat de lucrare (Faza 5 pas 3) ──
    const { data: siteRow } = await supabase.from('sites').select('proiect_id').eq('id', sid).maybeSingle()
    const pid = siteRow?.proiect_id || null
    setProiectId(pid)
    let acts = []
    if (pid) {
      const [{ data: a }, { data: u }] = await Promise.all([
        supabase.from('proiect_activitati').select('id, nume, um, ordine, tip_raportare')
          .eq('proiect_id', pid).eq('activ', true).order('ordine').order('id'),
        supabase.from('proiect_unitati').select('id, tip, cod, nume, ordine')
          .eq('proiect_id', pid).eq('activ', true).order('ordine').order('id'),
      ])
      acts = a || []
      setUnitati(u || [])
    } else setUnitati([])
    setActivitati(acts)
    setLucrariAct({})
    setUnitateId(null)
    // ── Există deja raport azi pe lucrare? → încarcă pentru editare (anti-dublură) ──
    const { data: existing } = await supabase.from('rapoarte_zilnice').select('*').eq('site_id', sid).eq('data', azi()).maybeSingle()
    if (existing) {
      if (acts.length) {
        const { data: rl } = await supabase.from('raport_lucrari').select('activitate_id, cantitate, unitate_id').eq('raport_id', existing.id)
        const m = {}
        for (const r of (rl || [])) if (r.activitate_id) m[r.activitate_id] = Number(r.cantitate) || 0
        setLucrariAct(m)
        const uid = (rl || []).find(r => r.unitate_id)?.unitate_id
        if (uid) setUnitateId(uid)
      }
      setExistingId(existing.id)
      setLucrari(existing.lucrari_efectuate || '')
      setMasini(existing.masini || '')
      setProbleme(existing.probleme || '')
      setSubcontractori(existing.subcontractori || '')
      setAprovizionare(existing.aprovizionare || '')
      setPlanMaine(existing.plan_maine || '')
      const ps = existing.personal_snapshot || {}
      setPersonal({ sudori: ps.sudori || 0, lacatusi: ps.lacatusi || 0, operatori: ps.operatori || 0, soferi: ps.soferi || 0, necalificati: ps.necalificati || 0, tesa: ps.tesa || 0, altii: ps.altii || 0 })
      setUtilaje((existing.utilaje_snapshot || []).map(u => ({ active_id: u.active_id ?? null, cod: u.cod || '', nume: u.nume || '', tip: u.tip || null, ore: u.ore ?? null, km: u.km ?? null, ultima_alimentare: null, stare: u.stare || 'functional', motiv: u.motiv || '', alimentat: !!u.alimentat, manual: !u.cod && !u.active_id })))
      const urls = []
      for (const p of (existing.poze || [])) {
        const { data: s } = await supabase.storage.from(BUCKET).createSignedUrl(p, 3600)
        if (s?.signedUrl) urls.push({ path: p, url: s.signedUrl })
      }
      setPozeExistente(urls)
      setPoze([])
      setLoadingData(false)
      return
    }
    // ── Raport nou: pre-populare din pontaj + alimentări ──
    setExistingId(null); setPozeExistente([])
    // Personal azi; fallback ieri dacă azi gol
    let { data: per } = await supabase.from('v_pontaj_personal_santier').select('*').eq('site_id', sid).eq('data', azi()).maybeSingle()
    if (!per) {
      const ieri = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
      const r = await supabase.from('v_pontaj_personal_santier').select('*').eq('site_id', sid).eq('data', ieri).maybeSingle()
      per = r.data
    }
    setPersonal(per ? { sudori: per.sudori, lacatusi: per.lacatusi, operatori: per.operatori, soferi: per.soferi, necalificati: per.necalificati, tesa: per.tesa || 0, altii: per.altii } : { sudori: 0, lacatusi: 0, operatori: 0, soferi: 0, necalificati: 0, tesa: 0, altii: 0 })

    // ── Utilaje + mașini pe șantier ──
    // Prezența se auto-întreține: pornim de la ULTIMUL raport al lucrării
    // (carry-forward — utilajul rămâne cât e pe șantier) + alimentările din
    // ultimele 14 zile (pt. utilaje/mașini nou-venite). Managerul bifează
    // funcțional + alimentat azi și scoate ce a plecat.
    const azo = azi()
    const keyOf = (u) => u.active_id ? 'a' + u.active_id : 'c' + String(u.cod || u.nume || '').toLowerCase().trim()
    const map = new Map()
    // 1) carry-forward din ultimul raport anterior
    // STAREA se moștenește: un utilaj defect ieri e defect și azi până îl trece
    // managerul înapoi pe funcțional (înainte se reseta silențios la 'functional'
    // și defectele dispăreau din raport a doua zi — sesizat Razvan 04.08.2026).
    const { data: prev } = await supabase.from('rapoarte_zilnice').select('utilaje_snapshot').eq('site_id', sid).lt('data', azo).order('data', { ascending: false }).limit(1).maybeSingle()
    ;(Array.isArray(prev?.utilaje_snapshot) ? prev.utilaje_snapshot : []).forEach(u => {
      const it = { active_id: u.active_id ?? null, cod: u.cod || '', inmatriculare: u.inmatriculare || '', nume: u.nume || u.cod || '?', tip: u.tip || null, ore: u.ore ?? null, km: u.km ?? null, ultima_alimentare: null, stare: u.stare === 'nefunctional' ? 'nefunctional' : 'functional', motiv: u.stare === 'nefunctional' ? (u.motiv || '') : '', alimentat: false, manual: !u.cod && !u.active_id, dinRaport: true }
      map.set(keyOf(it), it)
    })
    // 2) alimentări 14 zile (îmbogățesc / adaugă)
    const { data: ut } = await supabase.from('v_active_santier_recent').select('*').eq('site_id', sid)
    const dinAlimentariRecente = new Set()
    ;(ut || []).forEach(u => {
      dinAlimentariRecente.add(u.active_id)
      const it = { active_id: u.active_id, cod: u.cod_intern || '', inmatriculare: u.nr_inmatriculare || '', nume: [u.marca, u.model].filter(Boolean).join(' ') || u.cod_intern || u.nr_inmatriculare || '?', tip: u.tip_categorie || null, ore: u.ore_functionare_actuale ?? null, km: u.km_actuali ?? null, ultima_alimentare: u.ultima_alimentare, stare: 'functional', motiv: '', alimentat: u.ultima_alimentare === azo, manual: false }
      const k = keyOf(it)
      if (map.has(k)) {
        const e = map.get(k)
        e.active_id = e.active_id || it.active_id; e.tip = e.tip || it.tip
        e.inmatriculare = e.inmatriculare || it.inmatriculare
        e.ore = e.ore ?? it.ore; e.km = e.km ?? it.km
        e.ultima_alimentare = it.ultima_alimentare; if (it.alimentat) e.alimentat = true
      } else map.set(k, it)
    })
    // 3) „a mai fost văzut pe șantier?" — carry-forward-ul nu avea expirare, așa că
    // un utilaj intrat o dată în raport rămânea la infinit dacă nimeni nu-l scotea
    // (ex. compresoarele de probă: vin pentru probă, pleacă, dar rămâneau în listă).
    // Pentru cele care NU au alimentare în ultimele 14 zile căutăm ultima alimentare
    // pe ACEST șantier și marcăm/scoatem după vechime.
    const deVerificat = [...map.values()].filter(u => u.active_id && !dinAlimentariRecente.has(u.active_id))
    if (deVerificat.length) {
      const { data: vechi } = await supabase.from('logistica_alimentari')
        .select('active_id, data_alimentare').eq('site_id', sid)
        .in('active_id', deVerificat.map(u => u.active_id))
        .order('data_alimentare', { ascending: false })
      const ultima = {}
      for (const r of (vechi || [])) if (!ultima[r.active_id]) ultima[r.active_id] = r.data_alimentare
      for (const u of deVerificat) {
        const d = ultima[u.active_id]
        u.zileFaraDovada = d ? Math.round((new Date(azo) - new Date(d)) / 86400000) : null
        u.ultimaDovada = d || null
      }
    }
    // >PRAG_SCOATERE zile fără nicio dovadă → nu mai pre-completăm (se poate readăuga manual)
    const lista = [...map.values()].filter(u => !(u.dinRaport && u.zileFaraDovada != null && u.zileFaraDovada > PRAG_SCOATERE))
    // ── Logistica = sursa de adevăr pentru stare (decizie Razvan 04.08.2026) ──
    // Utilajul defect rămâne defect până când Logistica (Mitrache) îl pune înapoi
    // pe Functional — atunci reapare funcțional aici automat.
    const idsStare = lista.filter(u => u.active_id).map(u => u.active_id)
    if (idsStare.length) {
      const { data: st } = await supabase.from('logistica_active').select('id, stare').in('id', idsStare)
      const sMap = Object.fromEntries((st || []).map(x => [x.id, x.stare]))
      for (const u of lista) {
        if (!u.active_id || !sMap[u.active_id]) continue
        if (sMap[u.active_id] === 'Nefunctional') {
          u.stare = 'nefunctional'
          u.motiv = u.motiv || 'Nefuncțional în Logistica'
        } else {
          u.stare = 'functional'
          u.motiv = ''
        }
      }
    }
    setUtilaje(lista)
    setLoadingData(false)
  }, [])

  useEffect(() => { if (siteId) loadSiteData(siteId) }, [siteId, loadSiteData])

  const setPers = (k, v) => setPersonal(p => ({ ...p, [k]: Math.max(0, parseInt(v) || 0) }))
  const setUtil = (idx, patch) => setUtilaje(list => list.map((u, i) => i === idx ? { ...u, ...patch } : u))
  const adaugaUtilajManual = () => setUtilaje(list => [...list, { active_id: null, cod: '', inmatriculare: '', nume: '', tip: null, ore: null, km: null, ultima_alimentare: null, stare: 'functional', motiv: '', alimentat: false, manual: true }])
  const stergeUtilaj = (idx) => setUtilaje(list => list.filter((_, i) => i !== idx))

  // Compresie client-side: telefoanele fac poze de 5-10 MB; le aducem la ~max 1600px
  // JPEG 80% (~200-400 KB) inainte de upload — mai rapid pe semnal slab, storage mic.
  const comprimaPoza = async (file) => {
    try {
      const bmp = await createImageBitmap(file)
      const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height))
      if (scale === 1 && file.size < 500 * 1024) return file
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(bmp.width * scale)
      canvas.height = Math.round(bmp.height * scale)
      canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.8))
      if (!blob) return file
      return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' })
    } catch {
      return file // format neacceptat de canvas (ex. HEIC pe unele browsere) → urcam originalul
    }
  }

  const onPoze = async (e) => {
    const files = Array.from(e.target.files || [])
    const comprimate = await Promise.all(files.map(comprimaPoza))
    setPoze(p => [...p, ...comprimate].slice(0, Math.max(0, 12 - pozeExistente.length)))
  }
  const stergePoza = (i) => setPoze(p => p.filter((_, idx) => idx !== i))

  const trimite = async () => {
    if (!siteId) { setMsg({ ok: false, text: 'Alege lucrarea' }); return }
    setSaving(true); setMsg(null)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      // păstrează pozele deja urcate (la editare) + urcă cele noi
      const pozePaths = pozeExistente.map(p => p.path)
      for (const f of poze) {
        const ext = (f.name.split('.').pop() || 'jpg').toLowerCase()
        const path = `${siteId}/${azi()}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
        const { error } = await supabase.storage.from(BUCKET).upload(path, f, { contentType: f.type || 'image/jpeg', upsert: false })
        if (!error) pozePaths.push(path)
      }
      const totalPers = PERSONAL_CAT.reduce((s, c) => s + (personal?.[c.key] || 0), 0)
      // upsert pe (site_id, data) → 1 raport/lucrare/zi, reintrarea editează
      const { data: rz, error: insErr } = await supabase.from('rapoarte_zilnice').upsert({
        site_id: siteId, data: azi(),
        sef_santier: profile?.name || null,
        lucrari_efectuate: lucrari.trim() || null,
        utilaje_snapshot: utilaje.map(u => ({ active_id: u.active_id ?? null, cod: u.cod, inmatriculare: u.inmatriculare || null, nume: u.nume, tip: u.tip || null, ore: u.ore ?? null, km: u.km ?? null, stare: u.stare, motiv: u.motiv || null, alimentat: !!u.alimentat })),
        personal_snapshot: { ...personal, total: totalPers },
        masini: masini.trim() || null,
        probleme: probleme.trim() || null,
        subcontractori: subcontractori.trim() || null,
        aprovizionare: aprovizionare.trim() || null,
        plan_maine: planMaine.trim() || null,
        poze: pozePaths,
        created_by: user?.id || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'site_id,data' }).select('id').single()
      if (insErr) throw insErr
      // ── Lucrări pe activități (Faza 5 pas 3): rescriem setul raportului ──
      if (rz?.id && proiectId) {
        await supabase.from('raport_lucrari').delete().eq('raport_id', rz.id)
        const rows = activitati
          .filter(a => Number(lucrariAct[a.id]) > 0)
          .map(a => ({ raport_id: rz.id, proiect_id: proiectId, activitate_id: a.id, cantitate: Number(lucrariAct[a.id]), unitate_id: unitateId || null }))
        if (rows.length) {
          const { error: rlErr } = await supabase.from('raport_lucrari').insert(rows)
          if (rlErr) throw rlErr
        }
      }
      // ── Utilaje defecte → Logistica + tichet la Mitrache (decizie Razvan 04.08.2026) ──
      // Eroarea aici NU blochează raportul (deja salvat) — doar anunță.
      let tichetInfo = ''
      try {
        const defecte = utilaje.filter(u => u.active_id && u.stare === 'nefunctional')
        if (defecte.length) {
          const ids = defecte.map(u => u.active_id)
          const numeSite = sites.find(s => s.id === siteId)?.name || ''
          const ticheteNoi = {}   // activ_id → tichet_id creat acum (se leagă la problema de parc)
          await supabase.from('logistica_active').update({ stare: 'Nefunctional' }).in('id', ids)
          // dedup: nu deschidem alt tichet dacă există deja unul deschis pe activ
          const { data: deschise } = await supabase.from('tichete')
            .select('entitate_id').eq('departament', 'logistica').eq('entitate_tip', 'activ')
            .in('entitate_id', ids).in('status', ['deschis', 'in_analiza', 'atribuit', 'in_lucru'])
          const areTichet = new Set((deschise || []).map(t => t.entitate_id))
          const deDeschis = defecte.filter(u => !areTichet.has(u.active_id))
          if (deDeschis.length) {
            const { data: mit } = await supabase.from('profiles').select('id').ilike('name', '%mitrache%').limit(1).maybeSingle()
            const { data: ultim } = await supabase.from('tichete').select('numar_tichet').order('id', { ascending: false }).limit(1).maybeSingle()
            let nrCrt = parseInt(String(ultim?.numar_tichet || '').replace(/\D/g, '')) % 10000 || 0
            let create = 0
            for (const u of deDeschis) {
              nrCrt += 1
              const { data: t, error: tErr } = await supabase.from('tichete').insert({
                numar_tichet: `TKT-${new Date().getFullYear()}-${String(nrCrt).padStart(4, '0')}`,
                departament: 'logistica', subcategorie: 'avarie_utilaj',
                titlu: `Utilaj defect: ${u.cod || u.inmatriculare || u.nume}`.slice(0, 90),
                descriere: `Raportat NEFUNCȚIONAL în raportul zilnic din ${azi()}${numeSite ? ' — șantier ' + numeSite : ''}.${u.motiv ? '\n\nMotiv: ' + u.motiv : ''}\n\nUtilaj: ${[u.cod, u.inmatriculare, u.nume].filter(Boolean).join(' · ')}`,
                urgenta: 'normal',
                entitate_tip: 'activ', entitate_id: u.active_id,
                entitate_descriere: [u.cod, u.nume].filter(Boolean).join(' '),
                status: mit?.id ? 'atribuit' : 'deschis',
                deschis_de: user?.id || null, data_deschidere: new Date().toISOString(),
                persoana_responsabila: mit?.id || null,
                atribuit_de: mit?.id ? (user?.id || null) : null,
                data_atribuire: mit?.id ? new Date().toISOString() : null,
              }).select('id').single()
              if (tErr) { console.error('Tichet utilaj defect:', tErr.message) }
              else {
                create += 1
                ticheteNoi[u.active_id] = t.id
                if (mit?.id) await supabase.from('tichete_asignati').insert({ tichet_id: t.id, profile_id: mit.id }).then(({ error: aErr }) => { if (aErr) console.error('Asignare tichet:', aErr.message) })
              }
            }
            if (create) tichetInfo = ` 🎫 ${create} tichet${create > 1 ? 'e' : ''} deschis${create > 1 ? 'e' : ''} la Logistică pt. utilaje defecte.`
          }

          // ── Probleme Parc (19.08): aceleași utilaje intră și în fluxul mecanicilor ──
          // Dedup: dacă utilajul are deja o problemă nerezolvată, doar notăm în jurnal
          // (o singură dată pe zi — upsert-ul raportului poate rula de mai multe ori).
          const { data: prDeschise } = await supabase.from('logistica_probleme')
            .select('id, activ_id').in('activ_id', ids)
            .in('status', ['deschisa', 'in_lucru', 'asteapta_piese', 'asteapta_service'])
          const prMap = Object.fromEntries((prDeschise || []).map(p => [p.activ_id, p.id]))
          let prNoi = 0
          for (const u of defecte) {
            const motiv = (u.motiv || '').trim()
            if (prMap[u.active_id]) {
              const { data: dejaAzi } = await supabase.from('logistica_probleme_jurnal')
                .select('id').eq('problema_id', prMap[u.active_id]).eq('data', azi())
                .like('text', 'Semnalat din raportul zilnic%').limit(1)
              if (!dejaAzi?.length) {
                await supabase.from('logistica_probleme_jurnal').insert({
                  problema_id: prMap[u.active_id], data: azi(),
                  text: `Semnalat din raportul zilnic${numeSite ? ' — ' + numeSite : ''}${motiv ? ': ' + motiv : ''}`,
                  created_by: user?.id || null,
                })
              }
            } else {
              const { error: prErr } = await supabase.from('logistica_probleme').insert({
                activ_id: u.active_id,
                titlu: (motiv || `Defect raportat din șantier — ${u.cod || u.nume}`).slice(0, 120),
                descriere: `Raportat NEFUNCȚIONAL în raportul zilnic din ${azi()}${numeSite ? ' — șantier ' + numeSite : ''}.${motiv ? '\nMotiv: ' + motiv : ''}\nUtilaj: ${[u.cod, u.inmatriculare, u.nume].filter(Boolean).join(' · ')}`,
                status: 'deschisa', severitate: 'major',
                locatie: numeSite || null, sursa: 'raport',
                tichet_id: ticheteNoi[u.active_id] || null,
                data_deschidere: azi(), created_by: user?.id || null,
              })
              if (prErr) console.error('Problema parc:', prErr.message)
              else prNoi += 1
            }
          }
          if (prNoi) tichetInfo += ` 🔧 ${prNoi} ${prNoi > 1 ? 'probleme noi' : 'problemă nouă'} în Probleme Parc.`
        }
      } catch (e) { console.error('Sync utilaje defecte:', e?.message || e) }
      // ── Aprovizionare materiale → tichet la Kostas, Comercial (todo #982) ──
      // Un singur tichet per raport/zi: la re-editare se actualizează descrierea.
      try {
        const aprov = aprovizionare.trim()
        if (aprov && rz?.id) {
          const numeSite = sites.find(s => s.id === siteId)?.name || ''
          const descr = `Cerere de aprovizionare din raportul zilnic ${azi()}${numeSite ? ' — șantier ' + numeSite : ''} (${profile?.name || '?'}):\n\n${aprov}`
          const { data: tExist } = await supabase.from('tichete')
            .select('id, status').eq('entitate_tip', 'raport_aprovizionare').eq('entitate_id', rz.id)
            .limit(1).maybeSingle()
          if (tExist && !['rezolvat', 'confirmat', 'inchis', 'respins'].includes(tExist.status)) {
            await supabase.from('tichete').update({ descriere: descr }).eq('id', tExist.id)
            tichetInfo += ' 🛒 Cererea de aprovizionare a fost actualizată la Kostas.'
          } else if (!tExist) {
            const { data: kos } = await supabase.from('profiles').select('id').ilike('name', '%kostas%').limit(1).maybeSingle()
            const { data: ultim } = await supabase.from('tichete').select('numar_tichet').order('id', { ascending: false }).limit(1).maybeSingle()
            const nrCrt = (parseInt(String(ultim?.numar_tichet || '').replace(/\D/g, '')) % 10000 || 0) + 1
            const { data: t, error: tErr } = await supabase.from('tichete').insert({
              numar_tichet: `TKT-${new Date().getFullYear()}-${String(nrCrt).padStart(4, '0')}`,
              departament: 'comercial', subcategorie: 'aprovizionare_santier',
              titlu: `Aprovizionare materiale${numeSite ? ' — ' + numeSite : ''} (${azi()})`.slice(0, 90),
              descriere: descr, urgenta: 'normal',
              entitate_tip: 'raport_aprovizionare', entitate_id: rz.id,
              entitate_descriere: numeSite || null,
              status: kos?.id ? 'atribuit' : 'deschis',
              deschis_de: user?.id || null, data_deschidere: new Date().toISOString(),
              persoana_responsabila: kos?.id || null,
              atribuit_de: kos?.id ? (user?.id || null) : null,
              data_atribuire: kos?.id ? new Date().toISOString() : null,
            }).select('id').single()
            if (tErr) console.error('Tichet aprovizionare:', tErr.message)
            else {
              if (kos?.id) await supabase.from('tichete_asignati').insert({ tichet_id: t.id, profile_id: kos.id }).then(({ error: aErr }) => { if (aErr) console.error('Asignare tichet aprovizionare:', aErr.message) })
              tichetInfo += ' 🛒 Cererea de aprovizionare a plecat la Kostas (Achiziții).'
            }
          }
        }
      } catch (e) { console.error('Tichet aprovizionare:', e?.message || e) }
      setMsg({ ok: true, text: (existingId ? '✅ Raport actualizat!' : '✅ Raport trimis cu succes!') + tichetInfo })
      setTimeout(onBack, 1200)
    } catch (e) {
      setMsg({ ok: false, text: 'Eroare: ' + (e.message || e) })
    } finally { setSaving(false) }
  }

  return (
    <Shell>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button onClick={onBack} style={{ background: G.surface, border: `1px solid ${G.border}`, color: G.text, borderRadius: 10, width: 40, height: 40, fontSize: 18, cursor: 'pointer' }}>←</button>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: G.text }}>📋 Raport zilnic</div>
          <div style={{ fontSize: 13, color: G.muted }}>{fmtDate(azi())}</div>
        </div>
      </div>

      {/* Alege lucrarea */}
      <div style={{ marginBottom: 18 }}>
        <label style={labelStyle}>Lucrarea</label>
        <select value={siteId || ''} onChange={e => setSiteId(Number(e.target.value) || null)} style={{ ...inputStyle, appearance: 'none' }}>
          <option value="">— alege lucrarea —</option>
          {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      {siteId && (loadingData ? (
        <div style={{ color: G.dim, textAlign: 'center', padding: 30 }}>Se încarcă datele lucrării…</div>
      ) : (
        <>
          {existingId && (
            <div style={{ padding: '10px 14px', borderRadius: 10, marginBottom: 16, background: G.yellow + '22', color: G.yellow, fontSize: 13, fontWeight: 600, textAlign: 'center' }}>
              ✏️ Ai trimis deja raport azi pentru această lucrare — îl editezi (nu se creează duplicat).
            </div>
          )}
          {/* Personal auto din pontaj */}
          <Section title="👷 Personal (din pontaj)" hint="completat automat — ajustează dacă e cazul">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {PERSONAL_CAT.map(c => (
                <div key={c.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, background: G.bg, border: `1px solid ${G.border2}`, borderRadius: 10, padding: '8px 12px' }}>
                  <span style={{ fontSize: 13, color: G.text }}>{c.label}</span>
                  <input type="number" min="0" value={personal?.[c.key] ?? 0} onChange={e => setPers(c.key, e.target.value)}
                    style={{ width: 48, textAlign: 'center', background: G.surface2, border: `1px solid ${G.border2}`, color: G.text, borderRadius: 8, padding: '6px', fontSize: 16, fontWeight: 700 }} />
                </div>
              ))}
            </div>
            <div style={{ textAlign: 'right', marginTop: 8, fontSize: 13, color: G.muted }}>
              Total: <strong style={{ color: G.green }}>{PERSONAL_CAT.reduce((s, c) => s + (personal?.[c.key] || 0), 0)}</strong> persoane
            </div>
          </Section>

          {/* Utilaje + mașini pe șantier (prezență cu carry-forward) */}
          <Section title="🚜 Utilaje și mașini pe șantier" hint="rămân pe șantier zi de zi — scoate ce a plecat">
            {utilaje.length === 0 ? (
              <div style={{ color: G.dim, fontSize: 13, fontStyle: 'italic', padding: '6px 0' }}>Niciun utilaj/mașină pe lucrare. Adaugă manual ↓</div>
            ) : utilaje.map((u, i) => {
              const ctx = oreKm(u)
              const suspect = u.dinRaport && u.zileFaraDovada != null && u.zileFaraDovada >= PRAG_ATENTIE
              return (
              <div key={i} style={{ background: G.bg, border: `1px solid ${suspect ? G.yellow + '77' : G.border2}`, borderRadius: 10, padding: 10, marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {u.manual ? (
                      <input placeholder="Nume utilaj / mașină" value={u.nume} onChange={e => setUtil(i, { nume: e.target.value })} style={{ ...inputStyle, padding: '6px 10px', fontSize: 14 }} />
                    ) : (
                      <>
                        <div style={{ fontSize: 14, fontWeight: 700, color: G.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tipIcon(u.tip)} {u.nume}</div>
                        <div style={{ fontSize: 11, color: G.dim }}>{[u.cod, u.inmatriculare, ctx, u.ultima_alimentare ? `alim. ${fmtDate(u.ultima_alimentare)}` : (u.dinRaport ? 'din raport anterior' : '')].filter(Boolean).join(' · ')}</div>
                      </>
                    )}
                  </div>
                  <button onClick={() => stergeUtilaj(i)} title="Scoate de pe șantier" style={{ background: 'transparent', border: 'none', color: G.dim, fontSize: 18, cursor: 'pointer', lineHeight: 1, padding: '2px 4px' }}>×</button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 8, alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ fontSize: 11, color: G.muted }}>Funcțional:</span>
                    <button onClick={() => setUtil(i, { stare: 'functional', motiv: '' })} style={stareBtn(u.stare === 'functional', G.green)}>✓</button>
                    <button onClick={() => setUtil(i, { stare: 'nefunctional' })} style={stareBtn(u.stare === 'nefunctional', G.red)}>✕</button>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ fontSize: 11, color: G.muted }}>Alimentat azi:</span>
                    <button onClick={() => setUtil(i, { alimentat: true })} style={stareBtn(u.alimentat === true, G.blue)}>DA</button>
                    <button onClick={() => setUtil(i, { alimentat: false })} style={stareBtn(u.alimentat === false, G.dim)}>NU</button>
                  </div>
                </div>
                {suspect && (
                  <div style={{ marginTop: 8, padding: '7px 10px', background: G.yellow + '18', borderRadius: 8, fontSize: 12, color: G.yellow, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span>⚠️ Fără alimentare de {u.zileFaraDovada} zile — mai e pe șantier?</span>
                    <button onClick={() => stergeUtilaj(i)} style={{ background: G.yellow + '28', border: `1px solid ${G.yellow}55`, color: G.yellow, borderRadius: 7, padding: '4px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit' }}>Scoate</button>
                  </div>
                )}
                {u.stare === 'nefunctional' && (
                  <input placeholder="Ce problemă are?" value={u.motiv} onChange={e => setUtil(i, { motiv: e.target.value })}
                    style={{ ...inputStyle, padding: '8px 10px', fontSize: 14, marginTop: 8 }} />
                )}
              </div>
            )})}
            <button onClick={adaugaUtilajManual} style={{ background: 'transparent', border: `1px dashed ${G.border2}`, color: G.muted, borderRadius: 10, padding: '10px', width: '100%', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', marginTop: 4 }}>
              + Adaugă utilaj / mașină manual
            </button>
          </Section>

          {/* Lucrări pe activitățile proiectului (Faza 5 pas 3) */}
          {activitati.length > 0 && (
            <Section title="📏 Cantități pe activități" hint="doar ce s-a lucrat azi — restul lasă gol">
              {unitati.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <label style={{ ...labelStyle, marginBottom: 4 }}>Unde s-a lucrat azi</label>
                  <select value={unitateId || ''} onChange={e => setUnitateId(Number(e.target.value) || null)} style={{ ...inputStyle, appearance: 'none' }}>
                    <option value="">— toată lucrarea / nespecificat —</option>
                    {unitati.map(u => (
                      <option key={u.id} value={u.id}>{u.cod ? `${u.cod} · ` : ''}{u.nume}</option>
                    ))}
                  </select>
                  <div style={{ fontSize: 11, color: G.dim, marginTop: 4 }}>Se aplică tuturor cantităților de mai jos.</div>
                </div>
              )}
              {activitati.map(a => {
                const bifa = (a.tip_raportare || 'cantitate') === 'bifa'
                const bifat = Number(lucrariAct[a.id]) > 0
                return (
                <div key={a.id} onClick={bifa ? () => setLucrariAct(m => ({ ...m, [a.id]: bifat ? '' : 1 })) : undefined}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, background: bifa && bifat ? G.green + '18' : G.bg, border: `1px solid ${bifa && bifat ? G.green + '66' : G.border2}`, borderRadius: 10, padding: '8px 12px', marginBottom: 6, cursor: bifa ? 'pointer' : 'default', userSelect: 'none' }}>
                  <span style={{ fontSize: 14, color: G.text, flex: 1, minWidth: 0 }}>{a.nume}</span>
                  {bifa ? (
                    <span style={{ width: 38, height: 38, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 800, flexShrink: 0,
                      background: bifat ? G.green : 'transparent', color: bifat ? '#0D1117' : G.dim, border: `1px solid ${bifat ? G.green : G.border2}` }}>
                      {bifat ? '✓' : ''}
                    </span>
                  ) : (
                    <>
                      <input type="number" min="0" step="any" inputMode="decimal" placeholder="0"
                        value={lucrariAct[a.id] ?? ''}
                        onChange={e => setLucrariAct(m => ({ ...m, [a.id]: e.target.value === '' ? '' : Math.max(0, Number(e.target.value)) }))}
                        style={{ width: 76, textAlign: 'center', background: G.surface2, border: `1px solid ${G.border2}`, color: G.text, borderRadius: 8, padding: '8px 6px', fontSize: 16, fontWeight: 700 }} />
                      <span style={{ fontSize: 12, color: G.muted, width: 32 }}>{a.um || ''}</span>
                    </>
                  )}
                </div>
              )})}
            </Section>
          )}

          {/* Activități + text */}
          <Section title="🔧 Lucrări efectuate" hint={activitati.length ? 'detalii libere (opțional)' : 'scrie sau lipește din WhatsApp'}>
            <textarea value={lucrari} onChange={e => setLucrari(e.target.value)} rows={5} placeholder="Ce s-a lucrat azi…" style={{ ...inputStyle, resize: 'vertical', fontSize: 15 }} />
          </Section>

          <Section title="🤝 Subcontractori" hint="ce au lucrat azi subcontractorii (opțional)">
            <textarea value={subcontractori} onChange={e => setSubcontractori(e.target.value)} rows={3} placeholder="ex: Rominsta — Sudură obiecte speciale TR10 – 2 buc; Lansat TR10 – 147 m" style={{ ...inputStyle, resize: 'vertical', fontSize: 15 }} />
          </Section>

          <Section title="🛒 Aprovizionare materiale" hint="ce trebuie comandat — ajunge automat la Kostas (Achiziții)">
            <textarea value={aprovizionare} onChange={e => setAprovizionare(e.target.value)} rows={3} placeholder="ex: electrozi E7018 – 50 kg; discuri polizat 125mm – 30 buc; geotextil – 200 mp" style={{ ...inputStyle, resize: 'vertical', fontSize: 15 }} />
          </Section>

          <Section title="🚗 Mașini (probleme)">
            <textarea value={masini} onChange={e => setMasini(e.target.value)} rows={2} placeholder="Probleme la mașini (opțional)…" style={{ ...inputStyle, resize: 'vertical', fontSize: 15 }} />
          </Section>

          <Section title="⚠️ Probleme / Observații">
            <textarea value={probleme} onChange={e => setProbleme(e.target.value)} rows={3} placeholder="Probleme întâmpinate (opțional)…" style={{ ...inputStyle, resize: 'vertical', fontSize: 15 }} />
          </Section>

          <Section title="📅 Plan pentru mâine">
            <textarea value={planMaine} onChange={e => setPlanMaine(e.target.value)} rows={3} placeholder="Ce se face mâine…" style={{ ...inputStyle, resize: 'vertical', fontSize: 15 }} />
          </Section>

          {/* Poze */}
          <Section title="📷 Poze" hint={`${pozeExistente.length + poze.length}/12`}>
            {pozeExistente.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 10 }}>
                {pozeExistente.map((p, i) => (
                  <div key={p.path} style={{ position: 'relative', aspectRatio: '1', borderRadius: 10, overflow: 'hidden', border: `1px solid ${G.border2}` }}>
                    <img src={p.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    <button onClick={() => setPozeExistente(list => list.filter((_, idx) => idx !== i))} style={{ position: 'absolute', top: 4, right: 4, background: 'rgba(0,0,0,.7)', color: 'white', border: 'none', borderRadius: '50%', width: 24, height: 24, fontSize: 14, cursor: 'pointer', lineHeight: 1 }}>×</button>
                  </div>
                ))}
              </div>
            )}
            {/* Două intrări separate: cu capture = deschide camera; fără = lasă galeria */}
            <div style={{ display: 'flex', gap: 8 }}>
              <label style={{ flex: 1, background: G.surface2, border: `1px dashed ${G.border2}`, borderRadius: 12, padding: '18px 8px', textAlign: 'center', cursor: 'pointer', color: G.muted, fontSize: 14 }}>
                📷 Fă poză
                <input type="file" accept="image/*" capture="environment" onChange={onPoze} style={{ display: 'none' }} />
              </label>
              <label style={{ flex: 1, background: G.surface2, border: `1px dashed ${G.border2}`, borderRadius: 12, padding: '18px 8px', textAlign: 'center', cursor: 'pointer', color: G.muted, fontSize: 14 }}>
                🖼 Din galerie
                <input type="file" accept="image/*" multiple onChange={onPoze} style={{ display: 'none' }} />
              </label>
            </div>
            {poze.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 10 }}>
                {poze.map((f, i) => (
                  <div key={i} style={{ position: 'relative', aspectRatio: '1', borderRadius: 10, overflow: 'hidden', border: `1px solid ${G.border2}` }}>
                    <img src={URL.createObjectURL(f)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    <button onClick={() => stergePoza(i)} style={{ position: 'absolute', top: 4, right: 4, background: 'rgba(0,0,0,.7)', color: 'white', border: 'none', borderRadius: '50%', width: 24, height: 24, fontSize: 14, cursor: 'pointer', lineHeight: 1 }}>×</button>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {msg && <div style={{ padding: '12px 14px', borderRadius: 10, marginBottom: 12, background: (msg.ok ? G.green : G.red) + '22', color: msg.ok ? G.green : G.red, fontSize: 14, fontWeight: 600, textAlign: 'center' }}>{msg.text}</div>}

          <button onClick={trimite} disabled={saving} style={{
            background: G.green, color: '#0D1117', border: 'none', borderRadius: 14, padding: '16px', width: '100%',
            fontSize: 17, fontWeight: 800, cursor: saving ? 'wait' : 'pointer', fontFamily: 'inherit', marginBottom: 30, opacity: saving ? .6 : 1,
          }}>
            {saving ? 'Se trimite…' : (existingId ? '✓ Actualizează raportul' : '✓ Trimite raportul')}
          </button>
        </>
      ))}
    </Shell>
  )
}

// ── Helpers UI ──
function Shell({ children }) {
  return (
    <div style={{ minHeight: '100vh', background: G.bg, padding: '20px 16px', maxWidth: 520, margin: '0 auto', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      {children}
    </div>
  )
}
function Section({ title, hint, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: G.text }}>{title}</span>
        {hint && <span style={{ fontSize: 11, color: G.dim }}>{hint}</span>}
      </div>
      {children}
    </div>
  )
}
function stareBtn(active, color) {
  return {
    width: 38, height: 38, borderRadius: 9, fontSize: 16, cursor: 'pointer', fontWeight: 800,
    background: active ? color : 'transparent', color: active ? '#0D1117' : G.dim,
    border: `1px solid ${active ? color : G.border2}`,
  }
}
