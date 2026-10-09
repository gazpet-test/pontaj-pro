// ════════════════════════════════════════════════════════════════
// Cladire.jsx — modulul „Clădire” (Răzvan 06.09.2026): tot ce ține de sediu ca infrastructură tehnică:
// meteo + aer la sediu, centrala Viessmann (ViCare), termostatele Salus (urmează), alertele recente.
// Datele vin din meteo_cache / iot_dispozitive / notifications; conectarea integrărilor e în /integrari.
// ════════════════════════════════════════════════════════════════
import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from './lib/supabase.js'
import { MeteoSantier } from './Meteo.jsx'

const G = { bg:'#0D1117', surface:'#161B22', card:'#1C2128', border:'#30363D', text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681', green:'#3FB950', red:'#F85149', yellow:'#E3B341', blue:'#58A6FF', orange:'#F0883E' }
const S = { card: { background:G.card, border:`1px solid ${G.border}`, borderRadius:10, padding:16 }, btnS: { padding:'7px 13px', background:G.surface, color:G.text, border:`1px solid ${G.border}`, borderRadius:7, cursor:'pointer', fontSize:12.5, textDecoration:'none' } }
const fmtDT = (d) => d ? new Date(d).toLocaleString('ro-RO', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—'
const nr = (v, dec = 1) => v == null ? '—' : Number(v).toLocaleString('ro-RO', { maximumFractionDigits: dec })

// Aceleași praguri ca iot_verifica_terra; testul de paritate citește migrarea SQL.
export const TERRA_PRAGURI = { disc_max: [45, 50], nvme_max: [65, 70], cpu: [80, 90], ambient: [35, 40] }
export const TERRA_TACERE_MS = 30 * 60e3
export const nivelTerra = (cheie, valoare) => !Number.isFinite(valoare) ? 'lipsa'
  : valoare > TERRA_PRAGURI[cheie][1] ? 'error' : valoare > TERRA_PRAGURI[cheie][0] ? 'warning' : 'ok'
export const terraFaraDate = (cititLa, acum) => !cititLa || !Number.isFinite(Date.parse(cititLa)) || acum - Date.parse(cititLa) > TERRA_TACERE_MS

// Aceleași praguri ca iot_verifica_retea: cpu_temp [70,85], hdd_max [50,60]; gpu_temp > 80 și disk_pct > 90 doar warning (20261023c).
export const RETEA_PRAGURI = { cpu_temp: [70, 85], hdd_max: [50, 60], gpu_temp: [80, Infinity], disk_pct: [90, Infinity] }
export const nivelRetea = (cheie, valoare) => !Number.isFinite(valoare) ? 'lipsa'
  : valoare > RETEA_PRAGURI[cheie][1] ? 'error' : valoare > RETEA_PRAGURI[cheie][0] ? 'warning' : 'ok'

// QNAP are card propriu (nu mai apare în lista generică „Rețea & servere").
export const QNAP_EXTERN_ID = '192.168.1.42'
export const QNAP_PRAGURI = { cpu_temp: [70, 85], hdd_max: [50, 60], disk_pct: [80, 90], ram_pct: [85, 95] }
export const nivelQnap = (cheie, valoare) => !Number.isFinite(valoare) ? 'lipsa'
  : valoare > QNAP_PRAGURI[cheie][1] ? 'error' : valoare > QNAP_PRAGURI[cheie][0] ? 'warning' : 'ok'
export const QNAP_TACERE_MS = 30 * 60e3

// Camerele QNAP (ONVIF) primesc o poză nouă la ~2 min de la Terra; 10 min tăcere = semnal real de problemă.
export const CAMERE_TACERE_MS = 10 * 60e3

// Server AI (meta.tip='server'): rând GPU sub numele serverului + istoric 24h la cerere (iot_citiri). Cheile vin prin iot-retea.
export const areGpu = (x) => x?.meta?.tip === 'server' && ['gpu_temp', 'gpu_w', 'gpu_util', 'vram_pct'].some(k => Number.isFinite(x?.ultima_citire?.[k]))
function ServerGpu({ dispozitiv }) {
  const r = dispozitiv.ultima_citire || {}
  const [deschis, setDeschis] = useState(false), [ist, setIst] = useState(null), [err, setErr] = useState('')
  const comuta = async () => {
    const nou = !deschis; setDeschis(nou)
    if (!nou || ist) return
    setErr('')
    // cele mai recente 2000 din 24h (desc + reverse), ca graficul să nu piardă capătul recent (Copilot P26-1)
    const { data, error } = await supabase.from('iot_citiri').select('la, valori').eq('dispozitiv_id', dispozitiv.id)
      .gte('la', new Date(Date.now() - 24 * 3600e3).toISOString()).order('la', { ascending: false }).limit(2000)
    if (error) { setErr(error.message); return }
    setIst((data || []).slice().reverse().map(h => ({ la: h.la, t: h.valori?.gpu_temp, u: h.valori?.gpu_util, w: h.valori?.gpu_w, v: h.valori?.vram_pct })))
  }
  const culori = { lipsa: G.dim, ok: G.green, warning: G.yellow, error: G.red }
  const val = (k, et, um, dec = 0) => Number.isFinite(r[k]) &&
    <span key={k} style={{ marginLeft:8, color: RETEA_PRAGURI[k] ? culori[nivelRetea(k, r[k])] : G.dim }}>{et} {nr(r[k], dec)}{um}</span>
  return <div style={{ fontSize:11, color:G.dim, padding:'2px 0 4px 12px' }}>
    <span onClick={comuta} style={{ cursor:'pointer' }} title="Istoric 24h">🎮 GPU{val('gpu_temp', '', '°')}{val('gpu_w', '', ' W')}{val('gpu_util', 'util', '%')}{val('vram_pct', 'VRAM', '%')}{val('disk_pct', 'disc', '%')}
      <span style={{ marginLeft:8, color:G.blue }}>{deschis ? '▲' : '▼ 24h'}</span></span>
    {deschis && (err ? <div style={{ color:G.red }}>{err}</div> : !ist ? <div>Se încarcă...</div> : <div style={{ display:'grid', gap:6, marginTop:6 }}>
      <Spark pts={ist} k="t" color={G.orange} um="°C" />
      <Spark pts={ist} k="u" color={G.blue} min={0} max={100} um="% util" />
      <Spark pts={ist} k="w" color={G.yellow} um="W" />
      <Spark pts={ist} k="v" color={G.muted} min={0} max={100} um="% VRAM" />
    </div>)}
  </div>
}

// Limite cont Antigravity (task orar pe serverul AI → metrics.json → sonda Terra → iot-retea). Procent rămas + reset (epoch s).
const AI_PROCENTE = ['ai_gemini_ramas_pct', 'ai_claude_ramas_pct', 'ai_codex_ramas_pct', 'ai_anthropic_saptamana_ramas_pct',
  'ai_anthropic_saptamana_fable_ramas_pct', 'ai_anthropic_sesiune_ramas_pct']
export const areLimiteAi = (x) => x?.meta?.tip === 'server' && AI_PROCENTE.some(k => Number.isFinite(x?.ultima_citire?.[k]))
export const textReset = (sec, acum = Date.now()) => {
  if (!Number.isFinite(sec)) return ''
  const ore = (sec * 1000 - acum) / 3600e3
  return ore <= 0 ? 'reset trecut' : ore < 24 ? `reset în ${Math.ceil(ore)} h` : `reset în ${Math.round(ore / 24)} z`
}
function LimiteAi({ r }) {
  const cul = (p) => !Number.isFinite(p) ? G.dim : p < 15 ? G.red : p < 30 ? G.yellow : G.green
  // reset: epoch secunde (Antigravity), ISO (Codex) sau text liber ora București (Anthropic) — textul se afișează ca atare
  const rst = (v) => typeof v === 'number' ? textReset(v) : typeof v === 'string' && /^\d{4}-/.test(v) ? textReset(Date.parse(v) / 1000) : typeof v === 'string' ? `reset ${v}` : ''
  const una = (k, rk, et) => Number.isFinite(r[k]) && <span key={k} style={{ marginLeft:8 }}>{et} <b style={{ color:cul(r[k]) }}>{nr(r[k], 0)}%</b>{rst(r[rk]) && <span style={{ color:G.dim }}> ({rst(r[rk])})</span>}</span>
  return <div style={{ fontSize:11, color:G.dim, padding:'0 0 4px 12px' }}>🤖 Limite AI{una('ai_gemini_ramas_pct', 'ai_gemini_reset_s', 'Gemini')}{una('ai_claude_ramas_pct', 'ai_claude_reset_s', '· Claude/GPT')}
    {una('ai_codex_ramas_pct', 'ai_codex_reset', '· Codex')}{una('ai_anthropic_saptamana_ramas_pct', 'ai_anthropic_saptamana_reset', '· Anthropic săpt.')}
    {una('ai_anthropic_saptamana_fable_ramas_pct', 'ai_anthropic_saptamana_fable_reset', '· Fable săpt.')}{una('ai_anthropic_sesiune_ramas_pct', 'ai_anthropic_sesiune_reset', '· sesiune')}</div>
}

// Mini-grafic comun pentru centrală și Terra; fiecare serie ignoră valorile lipsă.
function Spark({ pts, k, color, min, max, um }) {
  const vals = pts.map(x => x[k]).filter(Number.isFinite); if (vals.length < 2) return null
  const lo = min ?? Math.min(...vals), hi = max ?? Math.max(...vals), W = 260, H = 44
  const d = pts.filter(x => Number.isFinite(x[k])).map((x, i, arr) => `${(i / (arr.length - 1)) * W},${H - ((x[k] - lo) / ((hi - lo) || 1)) * H}`).join(' ')
  return <div style={{ fontSize:11, color:G.dim }}><svg width={W} height={H} style={{ display:'block', maxWidth:'100%' }}><polyline points={d} fill="none" stroke={color} strokeWidth="1.5" /></svg>{nr(vals[vals.length - 1])} {um} ultima citire · min {nr(Math.min(...vals))} · max {nr(Math.max(...vals))} (24h)</div>
}

export function TerraCard({ dispozitiv, istoric = [], acum, eroare, incarcare = false }) {
  const v = dispozitiv?.ultima_citire || {}, faraDate = terraFaraDate(dispozitiv?.citit_la, acum)
  const culori = { lipsa: G.dim, ok: G.green, warning: G.yellow, error: G.red }
  const discuri = Array.isArray(v.discuri) ? v.discuri : []
  const goala = Object.keys(TERRA_PRAGURI).every(k => !Number.isFinite(v[k]))
  const minute = dispozitiv?.citit_la ? Math.max(0, Math.floor((acum - Date.parse(dispozitiv.citit_la)) / 60e3)) : null
  const pts = istoric.map(h => ({ la: h.la, ambient: h.valori?.ambient, disc_max: h.valori?.disc_max }))
  const randuri = [['Ambient', 'ambient', v.ambient], ['CPU', 'cpu', v.cpu], ['NVMe max', 'nvme_max', v.nvme_max],
    ...discuri.map(d => [d.dev, 'disc_max', d.temp])]
  return <div style={{ ...S.card, borderColor: faraDate && !incarcare ? G.red : G.border }}>
    <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8, flexWrap:'wrap' }}>
      <div style={{ fontWeight:700 }}>🖥️ Server Terra</div>
      {/* Terra își trimite singură datele: citire recentă = online (verde, ca la QNAP); tăcere peste prag = roșu */}
      {!incarcare && <span style={{ fontSize:11.5, color: faraDate ? G.red : G.green }}>{faraDate ? '○ fără date' : `● online · acum ${minute} min`}</span>}
    </div>
    {incarcare ? <div style={{ color:G.dim, fontSize:12.5 }}>Se încarcă…</div> : <>
      {faraDate && <div style={{ color:G.red, fontSize:12, marginBottom:8 }}>Ultima citire: {fmtDT(dispozitiv?.citit_la)}</div>}
      {!faraDate && goala && <div style={{ color:G.yellow, fontSize:12, marginBottom:8 }}>Citire goală — temperaturile lipsesc.</div>}
      {randuri.map(([eticheta, cheie, val]) => <div key={eticheta} style={{ display:'flex', justifyContent:'space-between', gap:10, fontSize:13, padding:'4px 0', borderBottom:`1px solid ${G.border}33` }}>
        <span style={{ color:G.muted }}>{eticheta}</span><b style={{ color:faraDate ? G.red : culori[nivelTerra(cheie, val)] }}>{nr(val)} °C</b>
      </div>)}
      {!discuri.length && <div style={{ fontSize:12, color:G.dim, marginTop:6 }}>Discuri: fără temperaturi.</div>}
      <div style={{ marginTop:10, display:'grid', gap:6 }}>
        <Spark pts={pts} k="ambient" color={G.blue} um="°C ambient" />
        <Spark pts={pts} k="disc_max" color={G.orange} um="°C disc max" />
        {!['ambient', 'disc_max'].some(k => pts.filter(p => Number.isFinite(p[k])).length >= 2) && <span style={{ fontSize:11, color:G.dim }}>Istoric 24 h insuficient pentru grafic.</span>}
      </div>
    </>}
    {eroare && <div role="status" style={{ color:G.yellow, fontSize:12, marginTop:8 }}>{eroare}</div>}
  </div>
}

function TerraMonitor() {
  const [dispozitiv, setDispozitiv] = useState(null), [istoric, setIstoric] = useState([])
  const [acum, setAcum] = useState(Date.now), [eroare, setEroare] = useState(null), [incarcare, setIncarcare] = useState(true)
  useEffect(() => {
    let oprit = false, inCurs = false
    const load = async () => {
      setAcum(Date.now())
      if (inCurs) return
      inCurs = true
      try {
        const { data: d, error } = await supabase.from('iot_dispozitive').select('id, ultima_citire, citit_la')
          .eq('sursa', 'terra').eq('extern_id', 'terra').eq('activ', true).maybeSingle()
        if (oprit) return
        if (error) { setEroare('Nu pot actualiza datele Terra.'); return }
        setDispozitiv(d)
        if (!d) { setIstoric([]); setEroare(null); return }
        const { data: h, error: eh } = await supabase.from('iot_citiri').select('la, valori').eq('dispozitiv_id', d.id)
          .gte('la', new Date(Date.now() - 24 * 3600e3).toISOString()).order('la')
        if (oprit) return
        setIstoric(eh ? [] : h || []); setEroare(eh ? 'Istoricul Terra nu este disponibil.' : null)
      } catch {
        if (!oprit) setEroare('Nu pot actualiza datele Terra.')
      } finally { inCurs = false; if (!oprit) setIncarcare(false) }
    }
    load()
    const timer = setInterval(load, 60e3)
    return () => { oprit = true; clearInterval(timer) }
  }, [])
  return <TerraCard dispozitiv={dispozitiv} istoric={istoric} acum={acum} eroare={eroare} incarcare={incarcare} />
}

// ── Server QNAP: card propriu (ca Terra), cu tot ce oferă sonda (temperaturi, disc %, RAM %, RAID).
export function QnapCard({ dispozitiv, acum, eroare, incarcare = false }) {
  const v = dispozitiv?.ultima_citire || {}
  const faraDate = !dispozitiv?.citit_la || acum - Date.parse(dispozitiv.citit_la) > QNAP_TACERE_MS
  const culori = { lipsa: G.dim, ok: G.green, warning: G.yellow, error: G.red }
  const minute = dispozitiv?.citit_la ? Math.max(0, Math.floor((acum - Date.parse(dispozitiv.citit_la)) / 60e3)) : null
  const randuriTemp = [['Temperatură CPU', 'cpu_temp', v.cpu_temp, '°C'], ['Temperatură disc (max)', 'hdd_max', v.hdd_max, '°C'],
    ['Disc ocupat', 'disk_pct', v.disk_pct, '%'], ['RAM ocupat', 'ram_pct', v.ram_pct, '%']]
  return <div style={{ ...S.card, borderColor: faraDate && !incarcare ? G.red : G.border }}>
    <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8, flexWrap:'wrap' }}>
      <div style={{ fontWeight:700 }}>🗄️ Server QNAP</div>
      {!incarcare && <span style={{ fontSize:11.5, color: faraDate ? G.red : (v.online ? G.green : G.red) }}>
        {faraDate ? 'fără date' : v.online ? `● online · acum ${minute} min` : '○ offline'}</span>}
    </div>
    {incarcare ? <div style={{ color:G.dim, fontSize:12.5 }}>Se încarcă…</div> : <>
      {faraDate && <div style={{ color:G.red, fontSize:12, marginBottom:8 }}>Ultima citire: {fmtDT(dispozitiv?.citit_la)}</div>}
      {randuriTemp.map(([eticheta, cheie, val, um]) => <div key={cheie} style={{ display:'flex', justifyContent:'space-between', gap:10, fontSize:13, padding:'4px 0', borderBottom:`1px solid ${G.border}33` }}>
        <span style={{ color:G.muted }}>{eticheta}</span><b style={{ color:faraDate ? G.red : culori[nivelQnap(cheie, val)] }}>{Number.isFinite(val) ? `${nr(val, 0)} ${um}` : '—'}</b>
      </div>)}
      <div style={{ display:'flex', justifyContent:'space-between', gap:10, fontSize:13, padding:'4px 0' }}>
        <span style={{ color:G.muted }}>RAID</span>
        <b style={{ color: v.raid_ok == null ? G.dim : v.raid_ok ? G.green : G.red }}>{v.raid_ok == null ? '—' : v.raid_ok ? 'OK' : '⚠ degradat'}</b>
      </div>
    </>}
    {eroare && <div role="status" style={{ color:G.yellow, fontSize:12, marginTop:8 }}>{eroare}</div>}
  </div>
}

function QnapMonitor() {
  const [dispozitiv, setDispozitiv] = useState(null)
  const [acum, setAcum] = useState(Date.now), [eroare, setEroare] = useState(null), [incarcare, setIncarcare] = useState(true)
  useEffect(() => {
    let oprit = false, inCurs = false
    const load = async () => {
      setAcum(Date.now())
      if (inCurs) return
      inCurs = true
      try {
        const { data: d, error } = await supabase.from('iot_dispozitive').select('id, ultima_citire, citit_la')
          .eq('sursa', 'retea').eq('extern_id', QNAP_EXTERN_ID).eq('activ', true).maybeSingle()
        if (oprit) return
        if (error) { setEroare('Nu pot actualiza datele QNAP.'); return }
        setDispozitiv(d); setEroare(null)
      } catch {
        if (!oprit) setEroare('Nu pot actualiza datele QNAP.')
      } finally { inCurs = false; if (!oprit) setIncarcare(false) }
    }
    load()
    const timer = setInterval(load, 60e3)
    return () => { oprit = true; clearInterval(timer) }
  }, [])
  if (!incarcare && !dispozitiv) return null
  return <QnapCard dispozitiv={dispozitiv} acum={acum} eroare={eroare} incarcare={incarcare} />
}

// ── Camere QNAP (ONVIF): instantaneu la ~2 min prin Terra → iot-camera, NU live. URL semnat (5 min), reluat doar când
// apare o citire nouă (citit_la se schimbă) — nu la fiecare poll, ca să nu reîncarce aceeași imagine degeaba.
function CameraQnapItem({ dispozitiv, acum }) {
  const [url, setUrl] = useState(null), [eroare, setEroare] = useState(null)
  useEffect(() => {
    let oprit = false
    ;(async () => {
      const { data, error } = await supabase.functions.invoke('iot-camera', { body: { actiune: 'poza', extern_id: dispozitiv.extern_id } })
      if (oprit) return
      if (error || data?.error) { setEroare(data?.error || error?.message || 'eroare la încărcare'); return }
      setUrl(data.url); setEroare(null)
    })()
    return () => { oprit = true }
  }, [dispozitiv.extern_id, dispozitiv.citit_la])
  const faraDate = !dispozitiv.citit_la || acum - Date.parse(dispozitiv.citit_la) > CAMERE_TACERE_MS
  const minute = dispozitiv.citit_la ? Math.max(0, Math.floor((acum - Date.parse(dispozitiv.citit_la)) / 60e3)) : null
  return (
    <div style={{ borderRadius:8, overflow:'hidden', border:`1px solid ${faraDate ? G.red + '88' : G.border}`, background:G.surface }}>
      <div style={{ aspectRatio:'16/9', background:'#000', display:'flex', alignItems:'center', justifyContent:'center' }}>
        {url ? <img src={url} alt={dispozitiv.nume} style={{ width:'100%', height:'100%', objectFit:'cover' }} />
          : <span style={{ color:G.dim, fontSize:11.5, padding:8, textAlign:'center' }}>{eroare || 'Se încarcă…'}</span>}
      </div>
      <div style={{ display:'flex', justifyContent:'space-between', gap:8, padding:'6px 10px', fontSize:12 }}>
        <span>{dispozitiv.nume}</span>
        <span style={{ color: faraDate ? G.red : G.dim }}>{faraDate ? 'fără date' : `acum ${minute} min`}</span>
      </div>
    </div>
  )
}

function CamereQnap() {
  const [dispozitive, setDispozitive] = useState([])
  const [acum, setAcum] = useState(Date.now), [eroare, setEroare] = useState(null), [incarcare, setIncarcare] = useState(true)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let oprit = false, inCurs = false
    const load = async () => {
      setAcum(Date.now())
      if (inCurs) return
      inCurs = true
      try {
        const { data, error } = await supabase.from('iot_dispozitive').select('id, extern_id, nume, citit_la')
          .eq('sursa', 'qnap_cam').eq('activ', true).order('extern_id')
        if (oprit) return
        if (error) { setEroare('Nu pot actualiza camerele.'); return }
        setDispozitive(data || []); setEroare(null)
      } catch {
        if (!oprit) setEroare('Nu pot actualiza camerele.')
      } finally { inCurs = false; if (!oprit) setIncarcare(false) }
    }
    load()
    const timer = setInterval(load, 60e3)
    return () => { oprit = true; clearInterval(timer) }
  }, [tick])
  if (!incarcare && !dispozitive.length) return null
  return (
    <div style={S.card}>
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8, flexWrap:'wrap' }}>
        <div style={{ fontWeight:700 }}>📷 Camere QNAP</div>
        <span style={{ fontSize:11, color:G.dim }}>instantaneu la ~2 min · nu e live</span>
        <button style={{ ...S.btnS, marginLeft:'auto', padding:'3px 9px' }} title="Reîmprospătează (nu declanșează o poză nouă pe cameră — aia vine de la Terra la ~2 min)" onClick={() => setTick(t => t + 1)}>🔄</button>
      </div>
      {incarcare ? <div style={{ color:G.dim, fontSize:12.5 }}>Se încarcă…</div>
        : eroare ? <div style={{ color:G.yellow, fontSize:12.5 }}>{eroare}</div>
        : <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(200px, 1fr))', gap:10 }}>
            {dispozitive.map(d => <CameraQnapItem key={d.id} dispozitiv={d} acum={acum} />)}
          </div>}
    </div>
  )
}

// ── Live stream cameră Tuya (HLS). hls.js se încarcă la cerere de pe cdnjs (Safari/iOS redă HLS nativ, fără librărie).
let _hlsP = null
const loadHls = () => _hlsP || (_hlsP = new Promise((res, rej) => {
  if (window.Hls) return res(window.Hls)
  const sc = document.createElement('script'); sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.15/hls.min.js'
  sc.onload = () => res(window.Hls); sc.onerror = () => { _hlsP = null; rej(new Error('hls.js nu s-a încărcat')) }; document.head.appendChild(sc)
}))

function CameraLive({ cam, onClose }) {
  const [stare, setStare] = useState('Se alocă stream-ul de la Tuya…')
  const [url, setUrl] = useState(null)
  const [tick, setTick] = useState(0)     // TKT-2026-0188: 🔄 reconectare doar a stream-ului, fără F5 pe toată pagina
  useEffect(() => {
    setStare('Se alocă stream-ul de la Tuya…'); setUrl(null)
    let hls = null, video = null, oprit = false
    ;(async () => {
      const { data, error } = await supabase.functions.invoke('tuya', { body: { actiune: 'stream', device_id: cam.extern_id, tip: 'hls' } })
      if (oprit) return
      if (error || !data?.url) { setStare('Nu am primit stream: ' + (data?.error || error?.message || 'fără URL')); return }
      setUrl(data.url); video = document.getElementById('cam-live-video'); if (!video) return
      if (video.canPlayType('application/vnd.apple.mpegurl')) { video.src = data.url; video.play().catch(() => {}); setStare(null); return }
      try { const Hls = await loadHls(); if (oprit) return
        hls = new Hls({ lowLatencyMode: true }); hls.loadSource(data.url); hls.attachMedia(video)
        hls.on(Hls.Events.MANIFEST_PARSED, () => { video.play().catch(() => {}); setStare(null) })
        hls.on(Hls.Events.ERROR, (_, d) => { if (d.fatal) setStare('Eroare stream: ' + d.details) })
      } catch (e) { setStare(e.message) }
    })()
    return () => { oprit = true; try { hls?.destroy() } catch { /* ignore */ } }
  }, [cam.extern_id, tick])
  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, background:'#000a', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
      <div onClick={e => e.stopPropagation()} style={{ ...S.card, width:'min(960px, 100%)', padding:12 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8 }}><b>📷 {cam.nume}</b><span style={{ fontSize:11, color:G.dim }}>live · link valabil câteva minute</span>
          <button style={{ ...S.btnS, marginLeft:'auto', padding:'3px 9px' }} title="Cere un link nou de stream de la Tuya (fără să reîncarci pagina)" onClick={() => setTick(t => t + 1)}>🔄 Reconectează</button>
          <button style={{ ...S.btnS, padding:'3px 9px' }} onClick={onClose}>✕ Închide</button></div>
        <video id="cam-live-video" controls muted playsInline style={{ width:'100%', maxHeight:'70vh', background:'#000', borderRadius:8 }} />
        {stare && <div style={{ color: stare.startsWith('Se ') ? G.muted : G.red, fontSize:12.5, marginTop:8 }}>{stare}</div>}
        {url && !stare && <div style={{ color:G.dim, fontSize:11, marginTop:6 }}>Dacă se oprește, apasă 🔄 Reconectează — Tuya alocă un link nou. Pe telefon, dacă imaginea nu pornește singură, atinge butonul ▶ din centru.</div>}
      </div>
    </div>
  )
}

export default function Cladire() {
  const [camLive, setCamLive] = useState(null)
  const [sediu, setSediu] = useState(null)
  const [disp, setDisp] = useState([])
  const [alerte, setAlerte] = useState([])
  const [istoric, setIstoric] = useState([])
  const [busy, setBusy] = useState(null)
  const [privatOk, setPrivatOk] = useState(false)     // userul e în iot_privat_acces
  const [isOwner, setIsOwner] = useState(false)       // ✏️ redenumire dispozitive de rețea (cerere Răzvan 09.10)
  const [pinHash, setPinHash] = useState(null)
  const [deblocat, setDeblocat] = useState(() => { try { return sessionStorage.getItem('cladire_privat') === '1' } catch { return false } })

  const load = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    const [{ data: s }, { data: d }, { data: a }, { data: pa }, { data: po }, { data: ig }] = await Promise.all([
      supabase.from('sites').select('id, name, adresa').eq('tip_locatie', 'sediu').eq('active', true).order('id').limit(1).maybeSingle(),
      supabase.from('iot_dispozitive').select('*').eq('activ', true).order('sursa').order('id'),
      // alerte recente: doar ultimele 24 h (cerere Răzvan 08.10), dedup pe titlu mai jos (iot_alerta scrie câte un rând per owner)
      supabase.from('notifications').select('id, title, message, created_at, read_at').eq('modul', 'Clădire').gte('created_at', new Date(Date.now() - 24 * 3600e3).toISOString()).order('created_at', { ascending: false }).limit(40),
      user ? supabase.from('iot_privat_acces').select('profile_id').eq('profile_id', user.id).maybeSingle() : { data: null },
      user ? supabase.from('profiles').select('is_owner').eq('id', user.id).maybeSingle() : { data: null },
      supabase.from('iot_integrari').select('config').eq('cheie', 'salus').maybeSingle(),
    ])
    setSediu(s); setDisp(d || []); setAlerte((a || []).filter((x, i, arr) => arr.findIndex(y => y.title === x.title) === i).slice(0, 10)); setPrivatOk(!!pa); setIsOwner(!!po?.is_owner); setPinHash(ig?.config?.pin_hash || null)
    const c = (d || []).find(x => x.sursa === 'vicare')
    if (c) { const { data: h } = await supabase.from('iot_citiri').select('la, valori').eq('dispozitiv_id', c.id).gte('la', new Date(Date.now() - 24 * 3600e3).toISOString()).order('la'); setIstoric(h || []) }
  }
  useEffect(() => { load() }, [])
  // ✏️ redenumire (doar owner, doar dispozitive din rețea — numele Tuya vin din aplicație la fiecare sync)
  const redenumeste = async (x) => {
    const nou = window.prompt('Nume nou pentru dispozitiv:', x.nume); if (!nou || nou.trim() === x.nume) return
    const { error } = await supabase.from('iot_dispozitive').update({ nume: nou.trim() }).eq('id', x.id)
    if (error) alert('Nu am putut salva: ' + error.message); else await load()
  }
  const Edit = ({ x }) => isOwner && x.sursa === 'retea' ? <span onClick={e => { e.stopPropagation(); redenumeste(x) }} title="Redenumește" style={{ cursor:'pointer', fontSize:11, color:G.dim, marginLeft:6 }}>✏️</span> : null
  const citeste = async () => {
    setBusy('Citesc centrala...')
    const { data, error } = await supabase.functions.invoke('vicare', { body: { actiune: 'sync' } })
    setBusy(null); if (error || data?.error) alert('Eroare: ' + (error?.message || data?.error)); await load()
  }

  const centrala = disp.find(x => x.sursa === 'vicare'), v = centrala?.ultima_citire || {}
  const termostate = disp.filter(x => x.sursa === 'salus' && !x.privat)
  const acasa = disp.filter(x => x.privat)
  // camerele din retea (Xiaomi/Imilab, doar cloud Mi Home — fara live) stau la „Camere”, nu la „Retea”
  const retea = disp.filter(x => x.sursa === 'retea' && !x.privat && x.extern_id !== QNAP_EXTERN_ID && x.meta?.tip !== 'camera')
  const tuya = disp.filter(x => x.sursa === 'tuya' && !x.privat)
  const camereRetea = disp.filter(x => x.sursa === 'retea' && !x.privat && x.meta?.tip === 'camera')
  const camere = [...tuya.filter(x => x.meta?.tip === 'camera'), ...camereRetea], tuyaAlte = tuya.filter(x => x.meta?.tip !== 'camera')
  // PIN pentru secțiunea privată: se compară SHA-256 în browser cu hash-ul din config; nu pleacă nicăieri
  const verificaPin = async () => {
    const pin = window.prompt('PIN pentru secțiunea privată:'); if (!pin) return
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pin))
    const hex = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
    if (hex === pinHash) { setDeblocat(true); try { sessionStorage.setItem('cladire_privat', '1') } catch { /* ignore */ } } else alert('PIN greșit.')
  }
  const err = Array.isArray(v.erori) ? v.erori : []
  const stareC = v.blocat === true ? { t: 'BLOCATĂ', c: G.red } : err.length ? { t: 'cu erori', c: G.orange } : v.arzator_activ ? { t: 'arde', c: G.green } : { t: 'în așteptare', c: G.muted }
  // mini-grafic 24h: presiune + tur
  const pts = istoric.map(h => ({ la: h.la, p: h.valori?.presiune_bar, t: h.valori?.temp_tur, a: h.valori?.arzator_activ }))
  const Row = ({ k, v: val, um }) => val == null ? null : <div style={{ display:'flex', justifyContent:'space-between', gap:10, fontSize:13, padding:'4px 0', borderBottom:`1px solid ${G.border}33` }}><span style={{ color:G.muted }}>{k}</span><b>{typeof val === 'number' ? nr(val) : String(val)}{um ? ' ' + um : ''}</b></div>

  return (
    <div style={{ background:G.bg, minHeight:'100vh', color:G.text, padding:'20px 24px', fontFamily:'system-ui, sans-serif' }}>
      <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:6, flexWrap:'wrap' }}>
        <Link to="/" style={{ color:G.muted, textDecoration:'none', fontSize:13 }}>← înapoi</Link>
        <div style={{ fontSize:19, fontWeight:800 }}>🏢 Clădire</div>
        <span style={{ fontSize:12.5, color:G.muted }}>{sediu?.name || 'Sediu'}{sediu?.adresa ? ' · ' + sediu.adresa : ''}</span>
        <div style={{ marginLeft:'auto', display:'flex', gap:8, alignItems:'center' }}>
          {busy && <span style={{ fontSize:12.5, color:G.blue, fontWeight:700 }}>{busy}</span>}
          <Link to="/integrari/vicare" style={S.btnS}>🔌 Integrări</Link>
        </div>
      </div>

      {v.blocat === true && <div style={{ padding:'12px 16px', borderRadius:9, margin:'10px 0', background:G.red + '22', border:`1px solid ${G.red}88`, color:G.red, fontWeight:800, fontSize:14 }}>🔒 Centrala este BLOCATĂ de o defecțiune (System locked). Necesită intervenție service.{err.length ? ` Coduri: ${err.map(e => e.cod).join(', ')}` : ''}</div>}

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(340px, 1fr))', gap:14, marginTop:12 }}>
        {/* Meteo sediu */}
        <div style={S.card}>
          <div style={{ fontWeight:700, marginBottom:10 }}>🌤 Vremea la sediu</div>
          {sediu ? <MeteoSantier siteId={sediu.id} /> : <div style={{ color:G.dim, fontSize:12.5 }}>Nu există locație de tip sediu.</div>}
        </div>

        {/* Centrala */}
        <div style={{ ...S.card, borderColor: v.blocat ? G.red + '88' : G.border }}>
          <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8, flexWrap:'wrap' }}>
            <div style={{ fontWeight:700 }}>🔥 Centrală Viessmann</div>
            {centrala && <span style={{ padding:'2px 9px', borderRadius:12, background:stareC.c + '22', color:stareC.c, fontWeight:700, fontSize:11.5 }}>{stareC.t}</span>}
            <span style={{ fontSize:11.5, color:G.dim }}>{centrala ? `citit ${fmtDT(centrala.citit_la)}` : ''}</span>
            {centrala && <button style={{ ...S.btnS, marginLeft:'auto' }} disabled={!!busy} onClick={citeste}>🔄</button>}
          </div>
          {!centrala ? <div style={{ color:G.dim, fontSize:12.5 }}>Neconectată. <Link to="/integrari/vicare" style={{ color:G.blue }}>Conectează ViCare</Link>.</div> : (
            <>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:8, marginBottom:10 }}>
                {[['Presiune', nr(v.presiune_bar), 'bar', v.presiune_bar != null && (v.presiune_bar < 1 || v.presiune_bar > 2.8) ? G.red : G.text], ['Tur', nr(v.temp_tur ?? v.temp_tur_circuit0, 0), '°C', G.text], ['Apă caldă', nr(v.temp_acm, 0), '°C', G.text]].map(([l, x, um, c]) => (
                  <div key={l} style={{ background:G.surface, border:`1px solid ${G.border}`, borderRadius:8, padding:'8px 10px', textAlign:'center' }}><div style={{ fontSize:10.5, color:G.dim }}>{l}</div><div style={{ fontSize:18, fontWeight:800, color:c }}>{x}<span style={{ fontSize:11, color:G.muted }}> {um}</span></div></div>
                ))}
              </div>
              <Row k="Arzător" v={v.arzator_activ == null ? null : (v.arzator_activ ? `pornit · ${nr(v.modulatie_pct, 0)}%` : 'oprit')} />
              <Row k="Regim / program" v={v.regim ? `${v.regim}${v.program ? ' · ' + v.program : ''}` : null} />
              <Row k="Gaz azi (încălzire / apă caldă)" v={v.gaz_incalzire ? `${nr(v.gaz_incalzire.azi)} / ${nr(v.gaz_acm?.azi)} m³` : null} />
              <Row k="Gaz luna asta" v={v.gaz_incalzire ? `${nr(v.gaz_incalzire.luna)} / ${nr(v.gaz_acm?.luna)} m³` : null} />
              <Row k="Gaz anul ăsta" v={v.gaz_incalzire ? `${nr((v.gaz_incalzire.an || 0) + (v.gaz_acm?.an || 0), 0)} m³` : null} />
              <Row k="Ore / porniri arzător" v={v.arzator_stat ? `${nr(v.arzator_stat.ore, 0)} h / ${nr(v.arzator_stat.porniri, 0)}` : null} />
              {err.length > 0 && <div style={{ color:G.red, fontSize:12.5, fontWeight:700, marginTop:8 }}>⚠ Erori active: {err.map(e => `${e.cod} (${fmtDT(e.la)})`).join(', ')}</div>}
              {Array.isArray(v.mesaje) && v.mesaje.length > 0 && <div style={{ fontSize:11.5, color:G.dim, marginTop:6 }}>Ultimele mesaje: {v.mesaje.slice(0, 4).map(m => `${m.cod} · ${fmtDT(m.la)}`).join(' | ')}</div>}
              <div style={{ marginTop:10, display:'grid', gap:6 }}><Spark pts={pts} k="p" color={G.blue} min={0} max={3} um="bar" /><Spark pts={pts} k="t" color={G.orange} um="°C tur" /></div>
            </>
          )}
        </div>

        <TerraMonitor />
        <QnapMonitor />

        {/* Rețea & servere: ping (online/offline) + temperaturi QNAP; datele vin de la workerul retea-mon (Terra) prin iot-retea */}
        {retea.length > 0 && (
          <div style={S.card}>
            <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8 }}>
              <div style={{ fontWeight:700 }}>🌐 Rețea &amp; servere</div>
              <span style={{ fontSize:11.5, color:G.dim }}>{retea.filter(x => x.ultima_citire?.online).length}/{retea.filter(x => x.meta?.asteptat_online !== false).length} online</span>
            </div>
            {retea.map(x => {
              const r = x.ultima_citire || {}
              const asteptat = x.meta?.asteptat_online !== false
              const on = r.online === true
              const culori = { lipsa: G.dim, ok: G.green, warning: G.yellow, error: G.red }
              const temp = (cheie, et) => Number.isFinite(r[cheie]) &&
                <span key={cheie} style={{ fontSize:11, color:culori[nivelRetea(cheie, r[cheie])], marginLeft:8 }}>{et} {nr(r[cheie])}°</span>
              const load = Number.isFinite(r.cpu_load) &&
                <span style={{ fontSize:11, color:G.dim, marginLeft:8 }}>load {nr(r.cpu_load, 0)}%</span>
              let stare
              if (!asteptat && !on) stare = <b style={{ color:G.dim }}>neconfigurat</b>
              else if (on) stare = <b style={{ color:G.green }}>● online{Number.isFinite(r.latency_ms) ? ` · ${nr(r.latency_ms)} ms` : ''}</b>
              else stare = <b style={{ color:G.red }}>○ offline</b>
              return <div key={x.id} style={{ borderBottom:`1px solid ${G.border}33` }}>
                <div style={{ display:'flex', justifyContent:'space-between', gap:10, alignItems:'center', fontSize:13, padding:'4px 0' }}>
                  <span style={{ color: on ? G.text : G.muted }}>{x.nume}<Edit x={x} />{temp('cpu_temp', 'sys')}{temp('hdd_max', 'disc')}{load}</span>
                  {stare}
                </div>
                {areGpu(x) && <ServerGpu dispozitiv={x} />}
                {areLimiteAi(x) && <LimiteAi r={x.ultima_citire} />}
              </div>
            })}
          </div>
        )}

        {/* Termostate */}
        <div style={S.card}>
          <div style={{ fontWeight:700, marginBottom:8 }}>🌡 Termostate SALUS iT600</div>
          {!termostate.length ? <div style={{ color:G.dim, fontSize:12.5 }}>Neconectate încă. Se leagă prin cloud-ul SALUS Sense din <Link to="/integrari/vicare" style={{ color:G.blue }}>Integrări</Link>.</div>
            : termostate.map(t => { const r = t.ultima_citire || {}; return <Row key={t.id} k={t.nume} v={r.temp != null ? `${nr(r.temp)}° (setat ${nr(r.setat)}°)${r.incalzeste ? ' 🔥' : ''}` : '—'} /> })}
        </div>

        {/* Camere Tuya (șantiere + curte) — doar stare online/offline până activăm Video Live Stream */}
        {tuya.length > 0 && (
          <div style={S.card}>
            <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8 }}><div style={{ fontWeight:700 }}>📷 Camere & prize Tuya</div><span style={{ fontSize:11.5, color:G.dim }}>{camere.filter(c => c.ultima_citire?.online).length}/{camere.length} camere online</span></div>
            {camere.map(c => { const on = !!c.ultima_citire?.online, live = on && c.sursa === 'tuya'; return <div key={c.id} onClick={() => live && setCamLive(c)} title={live ? 'Vezi live' : (c.sursa === 'retea' ? 'doar în aplicația Mi Home' : '')} style={{ display:'flex', justifyContent:'space-between', gap:10, fontSize:13, padding:'4px 0', borderBottom:`1px solid ${G.border}33`, cursor: live ? 'pointer' : 'default' }}>
              <span style={{ color: on ? G.text : G.muted }}>{c.nume}<Edit x={c} />{live && <span style={{ fontSize:11, color:G.blue, marginLeft:6 }}>▶ live</span>}{c.sursa === 'retea' && <span style={{ fontSize:10.5, color:G.dim, marginLeft:6 }}>Mi Home</span>}</span><b style={{ color: on ? G.green : G.red }}>{on ? '● online' : '○ offline'}</b></div> })}
            {tuyaAlte.map(c => { const r = c.ultima_citire || {}; const val = r.putere_w != null ? `${nr(r.putere_w)} W` : r.temp != null ? `${nr(r.temp)}°` : r.pornit != null ? (r.pornit ? 'pornit' : 'oprit') : ''
              return <div key={c.id} style={{ display:'flex', justifyContent:'space-between', gap:10, fontSize:13, padding:'4px 0', borderBottom:`1px solid ${G.border}33` }}>
                <span style={{ color:G.muted }}>{c.nume} <span style={{ fontSize:10.5, color:G.dim }}>{c.meta?.model || ''}</span></span><b style={{ color: r.online ? G.text : G.dim }}>{r.online ? (val || 'online') : 'offline'}</b></div> })}
          </div>
        )}

        <CamereQnap />

        {/* Acasă — privat (doar iot_privat_acces + PIN) */}
        {privatOk && acasa.length > 0 && (
          <div style={{ ...S.card, borderColor:G.blue + '55' }}>
            <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8 }}><div style={{ fontWeight:700 }}>🏠 Acasă</div><span style={{ fontSize:11, color:G.dim }}>privat · doar tu și Mari</span>
              {deblocat && <button style={{ ...S.btnS, marginLeft:'auto', padding:'3px 9px' }} onClick={() => { setDeblocat(false); try { sessionStorage.removeItem('cladire_privat') } catch { /* ignore */ } }}>🔒 Blochează</button>}</div>
            {!deblocat ? <button style={S.btnS} onClick={verificaPin}>🔐 Deblochează cu PIN</button>
              : acasa.map(t => { const r = t.ultima_citire || {}; return <Row key={t.id} k={t.nume} v={r.temp != null ? `${nr(r.temp)}°${r.setat != null ? ` (setat ${nr(r.setat)}°)` : ''}${r.incalzeste ? ' 🔥' : ''}` : (r.online != null ? (r.online ? (r.pornit ? 'pornit' : 'online') : 'offline') : '—')} /> })}
          </div>
        )}

        {camLive && <CameraLive cam={camLive} onClose={() => setCamLive(null)} />}

        {/* Alerte */}
        <div style={S.card}>
          <div style={{ fontWeight:700, marginBottom:8 }}>🔔 Alerte recente</div>
          {!alerte.length ? <div style={{ color:G.dim, fontSize:12.5 }}>Nicio alertă. Se generează automat: centrală blocată, presiune sub 1 bar sau peste 2,8 bar, coduri de eroare.</div>
            : alerte.map(a => <div key={a.id} style={{ fontSize:12.5, padding:'6px 0', borderBottom:`1px solid ${G.border}33`, opacity: a.read_at ? .6 : 1 }}><b>{a.title}</b><div style={{ color:G.muted, fontSize:11.5 }}>{fmtDT(a.created_at)} · {a.message}</div></div>)}
        </div>
      </div>
    </div>
  )
}
