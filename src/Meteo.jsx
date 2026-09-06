// ════════════════════════════════════════════════════════════════
// Meteo.jsx — vremea la sediu + pe fiecare șantier (Răzvan 06.09.2026, sursă Xweather)
// Datele vin din meteo_cache (umplut de edge fn meteo-sync la fiecare oră, cron meteo_sync_orar).
// UI-ul NU bate API-ul Xweather direct — citește doar cache-ul.
//  - <MeteoStrip/>  : bandă compactă pe HomeDashboard (sediu + șantiere active cu raport)
//  - <MeteoBadge siteId/> : badge mic pentru o lucrare (raport mobil, pagini șantier)
//  - iconMeteo(icon) : emoji din numele iconului Xweather
// ════════════════════════════════════════════════════════════════
import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase.js'

const G = { surface:'#161B22', card:'#1C2128', border:'#30363D', text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681', blue:'#58A6FF', red:'#F85149', yellow:'#E3B341' }

export const iconMeteo = (icon = '') => {
  const i = String(icon).toLowerCase()
  if (i.includes('tstorm')) return '⛈️'
  if (i.includes('snow') || i.includes('sleet') || i.includes('flurr')) return '🌨️'
  if (i.includes('rain') || i.includes('shower') || i.includes('drizzle') || /r\.png$/.test(i)) return '🌧️'
  if (i.includes('fog') || i.includes('haz')) return '🌫️'
  if (i.includes('wind')) return '💨'
  if (i.startsWith('sunny') || i.startsWith('clear')) return i.includes('n') && !i.startsWith('sunny') ? '🌙' : '☀️'
  if (i.startsWith('fair') || i.startsWith('pcloudy')) return '🌤️'
  if (i.startsWith('mcloudy')) return '⛅'
  if (i.includes('cloudy')) return '☁️'
  return '🌡️'
}
const RO = { 'Sunny':'Însorit', 'Clear':'Senin', 'Mostly Sunny':'Mai mult soare', 'Partly Cloudy':'Parțial noros', 'Mostly Cloudy':'Mai mult noros', 'Cloudy':'Înnorat', 'Showers':'Averse', 'Rain':'Ploaie', 'Light Rain':'Ploaie slabă', 'Thunderstorms':'Furtuni', 'Snow':'Ninsoare', 'Fog':'Ceață', 'Drizzle':'Burniță', 'Windy':'Vânt' }
export const vremeRo = (s = '') => RO[s] || s
const vechi = (t) => t && (Date.now() - new Date(t).getTime()) > 3 * 3600e3

export function useMeteo(siteIds) {
  const [m, setM] = useState({})
  useEffect(() => {
    let q = supabase.from('meteo_cache').select('*')
    if (siteIds?.length) q = q.in('site_id', siteIds)
    q.then(({ data }) => { const o = {}; (data || []).forEach(r => { o[r.site_id] = r }); setM(o) })
  }, [JSON.stringify(siteIds || [])])
  return m
}

export function MeteoBadge({ siteId, style }) {
  const m = useMeteo(siteId ? [siteId] : [])
  const r = m[siteId]
  if (!r?.curent) return null
  const c = r.curent, al = (r.alerte || []).length
  return (
    <span title={`${vremeRo(c.vreme)} · vânt ${Math.round(c.vant_kph)} km/h (rafale ${Math.round(c.rafale_kph)}) · umiditate ${c.umiditate}%${al ? ' · ALERTĂ: ' + r.alerte.map(a => a.titlu).join(', ') : ''} · actualizat ${new Date(r.actualizat_la).toLocaleTimeString('ro-RO', { hour:'2-digit', minute:'2-digit' })}`}
      style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'4px 10px', borderRadius:20, background:G.surface, border:`1px solid ${al ? G.yellow + '88' : G.border}`, fontSize:12.5, color:G.text, opacity: vechi(r.actualizat_la) ? .6 : 1, ...style }}>
      <span style={{ fontSize:15 }}>{iconMeteo(c.icon)}</span><b>{Math.round(c.temp)}°</b><span style={{ color:G.muted }}>{vremeRo(c.vreme)}</span>
      {c.rafale_kph >= 50 && <span style={{ color:G.yellow }}>💨{Math.round(c.rafale_kph)}</span>}
      {c.prob >= 50 && <span style={{ color:G.blue }}>🌧{c.prob}%</span>}
      {al > 0 && <span style={{ color:G.yellow }}>⚠</span>}
    </span>
  )
}

// Banda de pe Home: sediu + șantiere cu raport zilnic, cu prognoza pe mâine în tooltip
export function MeteoStrip() {
  const [sites, setSites] = useState([])
  useEffect(() => { supabase.from('sites').select('id, name, tip_locatie, raport_zilnic_necesar').eq('active', true).then(({ data }) => setSites(data || [])) }, [])
  const m = useMeteo(sites.map(s => s.id))
  const lista = sites.filter(s => m[s.id]?.curent && (s.tip_locatie === 'sediu' || s.raport_zilnic_necesar)).sort((a, b) => (a.tip_locatie === 'sediu' ? 0 : 1) - (b.tip_locatie === 'sediu' ? 0 : 1))
  if (!lista.length) return null
  const scurt = (n) => n.replace(/^Gazpet\s*-?\s*/i, '').replace(/\s*-\s*(Transgaz|Depogaz)\s*$/i, '').replace(/^Sediu\s*-\s*Gazpet Instal$/i, 'Sediu Ploiești').slice(0, 26)
  return (
    <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center', padding:'8px 32px', background:G.surface, borderBottom:`1px solid ${G.border}` }}>
      <span style={{ fontSize:11, color:G.dim, marginRight:4 }}>METEO</span>
      {lista.map(s => {
        const r = m[s.id], c = r.curent, maine = (r.prognoza || [])[1] || (r.prognoza || [])[0]
        const al = (r.alerte || []).length
        return (
          <span key={s.id} title={`${s.name}\n${vremeRo(c.vreme)}, ${Math.round(c.temp)}°, vânt ${Math.round(c.vant_kph)} km/h, rafale ${Math.round(c.rafale_kph)}${maine ? `\nMâine: ${vremeRo(maine.vreme)} ${Math.round(maine.min)}…${Math.round(maine.max)}°, ploaie ${maine.prob}% (${maine.precip_mm} mm)` : ''}${al ? '\nALERTĂ: ' + r.alerte.map(a => a.titlu).join(', ') : ''}`}
            style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'3px 9px', borderRadius:16, background:G.card, border:`1px solid ${al ? G.yellow + '88' : G.border}`, fontSize:12, color:G.text, opacity: vechi(r.actualizat_la) ? .6 : 1, cursor:'default' }}>
            <span style={{ color:G.muted }}>{scurt(s.name)}</span>
            <span>{iconMeteo(c.icon)}</span><b>{Math.round(c.temp)}°</b>
            {maine && maine.prob >= 50 && <span style={{ color:G.blue, fontSize:11 }}>mâine 🌧{maine.prob}%</span>}
            {al > 0 && <span style={{ color:G.yellow }}>⚠</span>}
          </span>
        )
      })}
    </div>
  )
}
