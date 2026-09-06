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

export default function Cladire() {
  const [sediu, setSediu] = useState(null)
  const [disp, setDisp] = useState([])
  const [alerte, setAlerte] = useState([])
  const [istoric, setIstoric] = useState([])
  const [busy, setBusy] = useState(null)
  const [privatOk, setPrivatOk] = useState(false)     // userul e în iot_privat_acces
  const [pinHash, setPinHash] = useState(null)
  const [deblocat, setDeblocat] = useState(() => { try { return sessionStorage.getItem('cladire_privat') === '1' } catch { return false } })

  const load = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    const [{ data: s }, { data: d }, { data: a }, { data: pa }, { data: ig }] = await Promise.all([
      supabase.from('sites').select('id, name, adresa').eq('tip_locatie', 'sediu').eq('active', true).order('id').limit(1).maybeSingle(),
      supabase.from('iot_dispozitive').select('*').eq('activ', true).order('sursa').order('id'),
      supabase.from('notifications').select('id, title, message, created_at, read_at').eq('modul', 'cladire').order('created_at', { ascending: false }).limit(10),
      user ? supabase.from('iot_privat_acces').select('profile_id').eq('profile_id', user.id).maybeSingle() : { data: null },
      supabase.from('iot_integrari').select('config').eq('cheie', 'salus').maybeSingle(),
    ])
    setSediu(s); setDisp(d || []); setAlerte(a || []); setPrivatOk(!!pa); setPinHash(ig?.config?.pin_hash || null)
    const c = (d || []).find(x => x.sursa === 'vicare')
    if (c) { const { data: h } = await supabase.from('iot_citiri').select('la, valori').eq('dispozitiv_id', c.id).gte('la', new Date(Date.now() - 24 * 3600e3).toISOString()).order('la'); setIstoric(h || []) }
  }
  useEffect(() => { load() }, [])
  const citeste = async () => {
    setBusy('Citesc centrala...')
    const { data, error } = await supabase.functions.invoke('vicare', { body: { actiune: 'sync' } })
    setBusy(null); if (error || data?.error) alert('Eroare: ' + (error?.message || data?.error)); await load()
  }

  const centrala = disp.find(x => x.sursa === 'vicare'), v = centrala?.ultima_citire || {}
  const termostate = disp.filter(x => x.sursa === 'salus' && !x.privat)
  const acasa = disp.filter(x => x.privat)
  const tuya = disp.filter(x => x.sursa === 'tuya' && !x.privat)
  const camere = tuya.filter(x => x.meta?.tip === 'camera'), tuyaAlte = tuya.filter(x => x.meta?.tip !== 'camera')
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
  const Spark = ({ k, color, min, max, um }) => {
    const vals = pts.map(x => x[k]).filter(x => typeof x === 'number'); if (vals.length < 2) return null
    const lo = min ?? Math.min(...vals), hi = max ?? Math.max(...vals), W = 260, H = 44
    const d = pts.filter(x => typeof x[k] === 'number').map((x, i, arr) => `${(i / (arr.length - 1)) * W},${H - ((x[k] - lo) / ((hi - lo) || 1)) * H}`).join(' ')
    return <div style={{ fontSize:11, color:G.dim }}><svg width={W} height={H} style={{ display:'block' }}><polyline points={d} fill="none" stroke={color} strokeWidth="1.5" /></svg>{nr(vals[vals.length - 1])} {um} acum · min {nr(Math.min(...vals))} · max {nr(Math.max(...vals))} (24h)</div>
  }
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
              <div style={{ marginTop:10, display:'grid', gap:6 }}><Spark k="p" color={G.blue} min={0} max={3} um="bar" /><Spark k="t" color={G.orange} um="°C tur" /></div>
            </>
          )}
        </div>

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
            {camere.map(c => <div key={c.id} style={{ display:'flex', justifyContent:'space-between', gap:10, fontSize:13, padding:'4px 0', borderBottom:`1px solid ${G.border}33` }}>
              <span style={{ color:G.muted }}>{c.nume}</span><b style={{ color: c.ultima_citire?.online ? G.green : G.red }}>{c.ultima_citire?.online ? '● online' : '○ offline'}</b></div>)}
            {tuyaAlte.map(c => { const r = c.ultima_citire || {}; const val = r.putere_w != null ? `${nr(r.putere_w)} W` : r.temp != null ? `${nr(r.temp)}°` : r.pornit != null ? (r.pornit ? 'pornit' : 'oprit') : ''
              return <div key={c.id} style={{ display:'flex', justifyContent:'space-between', gap:10, fontSize:13, padding:'4px 0', borderBottom:`1px solid ${G.border}33` }}>
                <span style={{ color:G.muted }}>{c.nume} <span style={{ fontSize:10.5, color:G.dim }}>{c.meta?.model || ''}</span></span><b style={{ color: r.online ? G.text : G.dim }}>{r.online ? (val || 'online') : 'offline'}</b></div> })}
          </div>
        )}

        {/* Acasă — privat (doar iot_privat_acces + PIN) */}
        {privatOk && acasa.length > 0 && (
          <div style={{ ...S.card, borderColor:G.blue + '55' }}>
            <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8 }}><div style={{ fontWeight:700 }}>🏠 Acasă</div><span style={{ fontSize:11, color:G.dim }}>privat · doar tu și Mari</span>
              {deblocat && <button style={{ ...S.btnS, marginLeft:'auto', padding:'3px 9px' }} onClick={() => { setDeblocat(false); try { sessionStorage.removeItem('cladire_privat') } catch { /* ignore */ } }}>🔒 Blochează</button>}</div>
            {!deblocat ? <button style={S.btnS} onClick={verificaPin}>🔐 Deblochează cu PIN</button>
              : acasa.map(t => { const r = t.ultima_citire || {}; return <Row key={t.id} k={t.nume} v={r.temp != null ? `${nr(r.temp)}°${r.setat != null ? ` (setat ${nr(r.setat)}°)` : ''}${r.incalzeste ? ' 🔥' : ''}` : (r.online != null ? (r.online ? (r.pornit ? 'pornit' : 'online') : 'offline') : '—')} /> })}
          </div>
        )}

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
