import { useEffect, useRef, useState } from 'react'
import { supabase } from './lib/supabase.js'
import { creeazaCoada, stocareBrowser, uuid } from './lib/izoCoada.js'
import { ziBucuresti, toateOperatiile, sesiuneLocala, randuriSesiune, codSudura, construiesteDeclaratii, capeteLocale, copiiLocali, propunereSudura } from './lib/izoTeren.js'

const G = { bg: '#F4F6F8', card: '#FFFFFF', text: '#152536', muted: '#4A5969', border: '#9BA9B6', blue: '#1259A7', red: '#9C2121', yellow: '#FFF0BA' }
const S = {
  page: { background: G.bg, color: G.text, padding: 16, borderRadius: 12, fontSize: 18 },
  card: { background: G.card, border: `1px solid ${G.border}`, borderRadius: 10, padding: 16, marginBottom: 16 },
  input: { minHeight: 52, padding: 12, fontSize: 18, width: '100%', boxSizing: 'border-box', background: G.card, color: G.text, border: `1px solid ${G.border}`, borderRadius: 8 },
  btn: { minHeight: 56, padding: '12px 20px', borderRadius: 8, border: `1px solid ${G.border}`, background: G.blue, color: 'white', fontSize: 18, cursor: 'pointer' },
  row: { display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'end' },
}
const caches = new Map()
const gps = () => new Promise(resolve => {
  if (!navigator.geolocation) return resolve(null)
  navigator.geolocation.getCurrentPosition(p => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, precizie_m: p.coords.accuracy, la: new Date(p.timestamp).toISOString() }), () => resolve(null), { timeout: 2500, maximumAge: 0 })
})
const field = (label, child) => <label style={{ display: 'grid', gap: 6, flex: '1 1 220px' }}>{label}{child}</label>

export default function IzometrieTeren({ proiectId, proiecte, onProiect, tronsoane, initialTronsonId, lockedMode }) {
  const [profile, setProfile] = useState(null)
  const [q, setQ] = useState(null)
  const [stare, setStare] = useState(null)
  const [tronsonId, setTronson] = useState(initialTronsonId || null)
  const [online, setOnline] = useState(navigator.onLine)
  const [busy, setBusy] = useState(false)
  const [mesaj, setMesaj] = useState('')
  const [persistenta, setPersistenta] = useState(false)
  const [writer, setWriter] = useState(false)
  const [tip, setTip] = useState('montaj')
  const [piesaId, setPiesa] = useState('')
  const [amonteId, setAmonte] = useState('')
  const [amonteCapat, setAmonteCapat] = useState('B')
  const [capat, setCapat] = useState('A')
  const [cm, setCm] = useState('')
  const [confirmata, setConfirmata] = useState(false)
  const [taiere, setTaiere] = useState('')
  const [ramane, setRamane] = useState('stanga')
  const [cod, setCod] = useState('')
  const [zi, setZi] = useState(ziBucuresti())
  const [serie, setSerie] = useState('')
  const generatie = useRef(0)
  const activ = useRef(false)
  const retryDelai = useRef(1500)
  const [catalog, setCatalog] = useState([])

  useEffect(() => {
    let mounted = true
    supabase.auth.getSession().then(({ data }) => { if (mounted) setProfile(data.session?.user.id || null) })
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setProfile(session?.user.id || null))
    return () => { mounted = false; data.subscription.unsubscribe() }
  }, [])

  useEffect(() => {
    const generation = ++generatie.current
    setQ(null); setStare(null); setMesaj(''); setCatalog([]); setTronson(null)
    setPiesa(''); setAmonte(''); setConfirmata(false); setCm(''); setCod('')
    if (!profile || !proiectId) return
    const name = `izo-e4-${profile}-${proiectId}`
    if (!caches.has(name)) caches.set(name, (async () => {
      const storage = await stocareBrowser(name)
      return creeazaCoada({ storage, rpc: async (n, a) => {
        const { data } = await supabase.auth.getSession()
        if (data.session?.user.id !== profile) throw Error('Profil schimbat; sincronizarea a fost oprită')
        return supabase.rpc(n, a)
      }, refresh: async () => {
        const { data: current } = await supabase.auth.getSession()
        if (current.session?.user.id !== profile) throw Error('Profil schimbat; coada rămâne la autorul ei')
        const { data, error } = await supabase.auth.refreshSession()
        if (error || data.session?.user.id !== profile) throw Error('Sesiune expirată; reconectează-te')
      }, lock: f => {
        if (!navigator.locks) return f() // UI rămâne doar citire; permite exportul datelor existente.
        return navigator.locks.request(name, f)
      } })
    })())
    caches.get(name).then(async queue => {
      const s = await queue.citeste()
      if (generation !== generatie.current) return
      setQ(queue); setStare(s)
      setCatalog(s.local.tronsoane || [])
      setTronson(s.local.tronsonId || (tronsoane?.some(t => t.id === initialTronsonId && t.proiect_id === proiectId) ? initialTronsonId : null))
    }).catch(e => { if (generation === generatie.current) setMesaj(e.message) })
    navigator.storage?.persist?.().then(setPersistenta).catch(() => setPersistenta(false))
    return () => { generatie.current++ }
  }, [profile, proiectId])

  useEffect(() => {
    if (!q || !tronsoane?.length || !tronsoane.every(t => t.proiect_id === proiectId)) return
    let mounted = true
    q.local('tronsoane', tronsoane).then(() => { if (mounted) setCatalog(tronsoane) }).catch(e => { if (mounted) setMesaj(e.message) })
    return () => { mounted = false }
  }, [q, tronsoane, proiectId])

  useEffect(() => {
    setWriter(false)
    if (!q || !navigator.locks) return
    let mounted = true, release
    const held = new Promise(resolve => { release = resolve })
    navigator.locks.request(`izo-e4-${profile}-${proiectId}-writer`, { ifAvailable: true }, async lock => {
      if (!mounted) return
      setWriter(Boolean(lock))
      if (lock) await held
    }).catch(e => { if (mounted) setMesaj(e.message) })
    return () => { mounted = false; release() }
  }, [q, profile, proiectId])

  async function action(fn) {
    if (activ.current || !q) return
    if (!writer) { setMesaj('Alt tab este editor. Închide-l și redeschide ecranul de teren aici.'); return }
    activ.current = true; setBusy(true)
    const generation = generatie.current
    try {
      const s = await fn()
      if (generation === generatie.current && s) setStare(s)
    } catch (e) {
      if (generation === generatie.current) {
        setMesaj(e.message)
        try { const s = await q.citeste(); if (generation === generatie.current) setStare(s) } catch { /* Nu mascăm eroarea inițială de stocare. */ }
      }
    }
    finally { activ.current = false; setBusy(false) }
  }

  async function synchronise() {
    if (!writer || !online || !q || stare?.pauza || !stare?.ops.length) return
    await action(async () => {
      let s
      try { s = await q.sync(); retryDelai.current = 1500 }
      catch (e) { retryDelai.current = Math.min(60000, Math.max(15000, retryDelai.current * 2)); throw e }
      setMesaj(s.pauza ? `Sincronizare oprită: ${s.pauza}. Reia cu Pregătește.` : 'Răspunsul serverului a fost salvat.')
      return s
    })
  }

  useEffect(() => {
    const on = () => { retryDelai.current = 1500; setOnline(true) }, off = () => setOnline(false)
    window.addEventListener('online', on); window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
  useEffect(() => {
    if (!writer || !online || busy || !q || !stare?.ops.length || stare.pauza) return
    // Backoff pentru refuzuri nefinale; fără buclă rapidă peste limita serverului.
    const delay = Math.max(retryDelai.current, stare.ops.some(o => o.stare === 'trimisa') ? 15000 : 1500)
    const timer = setTimeout(synchronise, delay)
    return () => clearTimeout(timer)
  }, [online, busy, q, stare, writer])
  useEffect(() => {
    const protect = e => { if (stare?.ops.length || (!q?.durabil && stare?.arhiva.length)) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', protect)
    return () => window.removeEventListener('beforeunload', protect)
  }, [stare, q])

  const snapshot = stare?.snapshots[tronsonId]
  const sesiune = sesiuneLocala(stare, tronsonId)
  const tronson = catalog.find(t => t.id === tronsonId)
  const log = toateOperatiile(stare).filter(o => o.cerere.payload.tronson_id === tronsonId)
  const folosite = new Set(log.filter(o => o.cerere.tip_op === 'decl_salveaza' && (o.stare !== 'confirmata' || o.rezultat?.cod === 'acceptat')).map(o => o.cerere.payload.bucata?.bucata_id || o.cerere.payload.sursa?.bucata_id))
  const taiate = new Set(log.filter(o => o.cerere.payload.tip === 'taiere' && (o.stare !== 'confirmata' || o.rezultat?.cod === 'acceptat')).map(o => o.cerere.payload.sursa?.bucata_id))
  const endpoints = capeteLocale(stare, snapshot, sesiune)
  const piese = (snapshot?.frunze || []).filter(b => (tip === 'taiere_libera' ? b.stare === 'montata' && b.tronson_id === tronsonId && !taiate.has(b.id) : b.disponibila && !folosite.has(b.id)))
  const piesa = piese.find(b => String(b.id) === piesaId)
  const endpoint2 = endpoints.find(e => e.key === piesaId)
  const labelPiesa = b => `${b.serie} · ${b.sarja || 'fără șarjă'} · ${b.lungime_mm} mm · perete ${b.perete_mm} mm`
  const propunere = propunereSudura(stare, snapshot, tronson?.cod)
  const disparute = new Set((snapshot?.tombstone || []).map(b => b.id))
  const invalidate = (stare?.ops || []).filter(o => o.cerere.payload.tronson_id === tronsonId && [o.cerere.payload.bucata?.bucata_id, o.cerere.payload.sursa?.bucata_id, o.cerere.payload.amonte?.bucata_id, o.cerere.payload.capat1?.bucata_id, o.cerere.payload.capat2?.bucata_id].some(id => disparute.has(id)))

  async function salveaza() {
    await action(async () => {
      if (!sesiune || sesiune.trimisa) throw Error('Deschide o sesiune')
      if (!snapshot) throw Error('Pregătește tronsonul cu semnal înainte de lucru')
      if (tip !== 'cuplare' && !piesa) throw Error('Alege o bucată disponibilă')
      const endpoint1 = endpoints.find(e => e.key === amonteId)
      const amonte = endpoint1 ? { ...endpoint1.ref, capat: amonteCapat, ...(tip !== 'cuplare' ? { tip: 'bucata' } : {}) } : null
      if (tip === 'cuplare' && endpoint1?.dependenta?.depinde_de_uid && endpoint2?.dependenta?.depinde_de_uid && endpoint1.dependenta.depinde_de_uid !== endpoint2.dependenta.depinde_de_uid) throw Error('Așteaptă aprobarea MP pentru cuplare între copii din tăieri diferite')
      if (!/^[A-Z]$/.test(capat) || (amonte && !/^[A-Z]$/.test(amonteCapat))) throw Error('Capătul este o literă A–Z')
      const sudura = tip === 'cuplare' || amonte ? codSudura(cod, tronson?.cod, snapshot) : null
      if (sudura && ((snapshot.suduri || []).some(w => w.stare !== 'anulata' && w.nr === sudura.nr && w.sufix === sudura.sufix) || log.some(o => (o.stare !== 'confirmata' || o.rezultat?.cod === 'acceptat') && o.cerere.payload.sudura?.nr === sudura.nr && o.cerere.payload.sudura?.sufix === sudura.sufix))) throw Error('Cod sudură deja folosit')
      const cereri = construiesteDeclaratii({ baza: { proiect_id: proiectId, tronson_id: tronsonId, preverificare_uid: sesiune.uid, data_montaj: sesiune.zi }, tip, piesa: tip === 'cuplare' ? (endpoint2 && { ...endpoint2.ref, capat }) : piesa, confirmata, cm, taiereMm: taiere, ramane, sudura, amonte, capat, dependenta: endpoint1?.dependenta?.depinde_de_uid ? endpoint1.dependenta : endpoint2?.dependenta || {}, snapshot, localCopii: copiiLocali(stare, snapshot) })
      const coord = await gps()
      if (coord) for (const c of cereri) c.payload.gps = coord
      // Tăierea și montajul copilului se salvează atomic în aceeași tranzacție locală.
      const s = await q.adauga(cereri)
      setMesaj(`Salvat pe tabletă${coord ? ', cu GPS' : ', GPS indisponibil'}. Necesită aprobarea MP.`)
      setPiesa(''); setConfirmata(false); setCm(''); setTaiere(''); setCod('')
      return s
    })
  }

  function exporta() {
    const blob = new Blob([JSON.stringify({ profil: profile, proiect: proiectId, durabil: q?.durabil, ...stare }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob), a = document.createElement('a')
    a.href = url; a.download = `izo-coada-${proiectId}-${ziBucuresti()}.json`; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return <div style={S.page}>
    <h2 style={{ marginTop: 0 }}>Teren · {online ? 'Cu semnal' : 'Offline'}</h2>
    {q && !writer && <p role="status" style={{ ...S.card, background: G.yellow }}>Doar citire: alt tab este editor sau browserul nu permite Web Locks. Exportul este disponibil.</p>}
    {(!q?.durabil || !persistenta) && <p role="status" style={{ ...S.card, background: G.yellow }}>Stocarea {q?.durabil ? 'persistentă nu este garantată' : 'este doar în memorie; datele se pierd la închidere'}. Exportă coada de siguranță.</p>}
    <p style={{ color: G.muted }}>Pregătește cu semnal. Poți continua când cade rețeaua, cât aplicația este deschisă. Repornirea fără rețea vine în E6.</p>
    {mesaj && <p role="status" style={S.card}>{mesaj}</p>}
    {stare?.pauza && <p role="alert" style={{ color: G.red }}>{stare.pauza === 'alt_dispozitiv' ? 'Tronsonul este luat de altă tabletă — decide MP-ul.' : `Sincronizare oprită: ${stare.pauza}`}</p>}
    <fieldset disabled={busy || !writer} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
    <div style={{ ...S.card, ...S.row }}>
      {field('Proiect', <select style={S.input} value={proiectId || ''} disabled={lockedMode || busy} onChange={e => onProiect(Number(e.target.value))}>{proiecte.map(p => <option key={p.id} value={p.id}>{p.nume}</option>)}</select>)}
      {field('Tronson', <select style={S.input} value={tronsonId || ''} disabled={busy} onChange={e => { const id = Number(e.target.value); setTronson(id); setPiesa(''); setAmonte(''); setConfirmata(false); setCm(''); setCod(''); q?.local('tronsonId', id).catch(e => setMesaj(e.message)) }}><option value="">Alege tronsonul</option>{catalog.map(t => <option key={t.id} value={t.id}>{t.cod}</option>)}</select>)}
      <button style={S.btn} disabled={busy || !q || !online || !tronsonId} onClick={() => action(async () => { const s = await q.snapshot(proiectId, tronsonId, true); setMesaj('Front pregătit; instantaneu salvat.'); return s })}>Pregătește</button>
      <button style={S.btn} disabled={busy || !q || !online || !tronsonId} onClick={() => action(() => q.snapshot(proiectId, tronsonId))}>Actualizează</button>
    </div>
    {snapshot && <p>Instantaneu: {new Date(snapshot.salvat_la).toLocaleString('ro-RO')} · versiune {snapshot.server_ver_max}. Sudura propusă: {propunere || 'de confirmat'}.</p>}
    {invalidate.length > 0 && <p role="alert" style={{ color: G.red }}>{invalidate.length} operații locale folosesc bucăți consumate sau anulate în noul instantaneu. Necesită verificare.</p>}
    <div style={{ ...S.card, ...S.row }}>
      {field('Ziua sesiunii', <input style={S.input} type="date" value={zi} disabled={Boolean(sesiune && !sesiune.trimisa)} onChange={e => setZi(e.target.value)} />)}
      <button style={S.btn} disabled={busy || !q || !snapshot || Boolean(sesiune && !sesiune.confirmata)} onClick={() => action(() => {
        if (zi !== ziBucuresti()) throw Error('Sesiunea nouă trebuie deschisă în ziua curentă din București')
        return q.adauga([{ tip_op: 'sesiune_deschide', payload: { proiect_id: proiectId, tronson_id: tronsonId, uid: uuid(), zi } }])
      })}>Deschide sesiune</button>
      <span>{sesiune ? `${sesiune.zi} · ${sesiune.trimisa ? 'trimitere înregistrată' : 'deschisă'}` : 'Nicio sesiune locală'}</span>
    </div>
    {sesiune && !sesiune.trimisa && snapshot && <div style={S.card}>
      <div style={S.row}>
        {field('Operație', <select style={S.input} value={tip} onChange={e => { setTip(e.target.value); setPiesa(''); setAmonte(''); setCm(''); setConfirmata(false) }}><option value="montaj">Montaj întreg</option><option value="taiere">Țeavă tăiată + montaj</option><option value="taiere_libera">Tăiere pe montată · capăt liber</option><option value="cuplare">Sudură de cuplare</option></select>)}
        {field('Caută seria', <input style={S.input} value={serie} onChange={e => setSerie(e.target.value)} />)}
        {field(tip === 'cuplare' ? 'Bucata 2' : 'Bucată', <select style={S.input} value={piesaId} onChange={e => { setPiesa(e.target.value); setCm(''); setConfirmata(false) }}><option value="">Alege seria și șarja</option>{tip === 'cuplare' ? endpoints.map(e => <option key={e.key} value={e.key}>{e.label}</option>) : piese.filter(b => String(b.serie).toUpperCase().includes(serie.toUpperCase())).map(b => <option key={b.id} value={b.id}>{labelPiesa(b)}</option>)}</select>)}
      </div>
      {piesa && <p style={{ fontSize: 26, fontWeight: 700 }}>{labelPiesa(piesa)}</p>}
      {tip !== 'cuplare' && <div style={S.row}>
        {field('Ultimele două cifre de cm de pe marcaj', <input inputMode="numeric" style={S.input} value={cm} onChange={e => { setCm(e.target.value); setConfirmata(false) }} />)}
        <button style={S.btn} disabled={!piesa || cm.trim() === ''} onClick={() => { const ok = /^\d{1,2}$/.test(cm) && Number(cm) === Math.round(piesa.lungime_mm / 10) % 100; setConfirmata(ok); setMesaj(ok ? 'Lungime confirmată separat.' : 'Marcajul diferă: remăsoară; corecția necesită verificare.') }}>{confirmata ? '✓ Lungime confirmată' : 'Confirmă lungimea'}</button>
        {tip.startsWith('taiere') && field('Punctul de tăiere, de la capătul inițial (mm)', <input inputMode="numeric" style={S.input} value={taiere} onChange={e => setTaiere(e.target.value)} />)}
        {tip === 'taiere_libera' && field('Partea care rămâne montată', <select style={S.input} value={ramane} onChange={e => setRamane(e.target.value)}><option value="stanga">Înaintea tăierii</option><option value="dreapta">După tăiere</option></select>)}
      </div>}
      {tip !== 'taiere_libera' && <div style={{ ...S.row, marginTop: 12 }}>
        {field(tip === 'cuplare' ? 'Bucata 1' : 'Amont / început de lanț', <select style={S.input} value={amonteId} onChange={e => setAmonte(e.target.value)}><option value="">{tip === 'cuplare' ? 'Alege bucata 1' : 'Început de lanț (fără sudură)'}</option>{endpoints.map(e => <option key={e.key} value={e.key}>{e.label}</option>)}</select>)}
        {field('Capăt amont / bucata 1', <input style={S.input} maxLength={1} value={amonteCapat} onChange={e => setAmonteCapat(e.target.value.toUpperCase())} />)}
        {field('Capăt piesă / bucata 2', <input style={S.input} maxLength={1} value={capat} onChange={e => setCapat(e.target.value.toUpperCase())} />)}
        {(amonteId || tip === 'cuplare') && field('Cod sudură', <input style={S.input} placeholder={propunere || 'Cod de confirmat'} value={cod} onChange={e => setCod(e.target.value)} />)}
      </div>}
      {tip === 'taiere' && piesa && <p>Rest → depozit: {piesa.lungime_mm - Number(taiere || 0)} mm. Literele copiilor sunt rezervate de server.</p>}
      <p>Verifică literele capetelor pe piesă. Sudurile se declară cu două capete; MP-ul verifică și aprobă.</p>
      <button style={S.btn} disabled={busy || !q} onClick={salveaza}>Salvează pe tabletă</button>
    </div>}
    </fieldset>
    <div style={S.card}>
      <div style={S.row}>
        <button style={S.btn} disabled={busy || !writer || !online || !q || !stare?.ops.length || Boolean(stare?.pauza)} onClick={synchronise}>Sincronizează ({stare?.ops.length || 0})</button>
        <button style={S.btn} disabled={!stare || busy} onClick={exporta}>Exportă coada JSON</button>
        <button style={S.btn} disabled={busy || !writer || !sesiune || sesiune.trimisa || !q} onClick={() => action(async () => {
          const current = await q.citeste()
          const rows = randuriSesiune(current, sesiune, current.snapshots[tronsonId])
          if (!rows.length) throw Error('Sesiunea nu conține declarații')
          return q.adauga([{ tip_op: 'sesiune_trimite', payload: { proiect_id: proiectId, tronson_id: tronsonId, preverificare_uid: sesiune.uid, randuri: rows } }])
        })}>Trimite sesiunea la MP</button>
      </div>
      <p>Trimiterea intră în coadă după declarații. Confirmarea sincronizării nu înseamnă aprobarea montajului.</p>
      <ul style={{ paddingLeft: 22 }}>{log.map(o => <li key={o.cerere.op_id} style={{ margin: '14px 0', overflowWrap: 'anywhere', color: o.de_verificat ? G.red : G.text }}>
        #{o.cerere.seq} · {o.cerere.payload.tip || o.cerere.tip_op} · {o.stare} · {o.rezultat?.cod || 'așteaptă'} {o.rezultat?.stare || ''} {o.rezultat?.motiv || o.rezultat?.conflict_cod || ''}
        {o.de_verificat && ' · DE VERIFICAT'}
        {o.cerere.tip_op === 'sesiune_trimite' && o.stare === 'pe_tableta' && <button style={{ ...S.btn, marginLeft: 12 }} disabled={busy} onClick={() => action(() => q.retrage(o.cerere.op_id))}>Retrage trimiterea</button>}
      </li>)}</ul>
    </div>
  </div>
}
