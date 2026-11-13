// ════════════════════════════════════════════════════════════════
// MeteoZiXweather.jsx — blocul „Vremea zilei” din raportul zilnic (telefon + pagina de rapoarte), 20261221a.
// Arată rezumatul ZILEI preluat automat de la Vaisala Xweather (v_meteo_zilnic_xweather): valorile + sursa scrisă explicit (coordonatele
// folosite, stația de observație cea mai apropiată și distanța, momentul preluării). Doar citire, nimic introdus de mână.
// Ziua în curs: rezumatul apare după miezul nopții. Eroarea de citire se arată ca eroare (L18), nu ca „fără date”.
// L24: rezultatul se aplică doar dacă e pentru șantierul și ziua afișate acum.
// ════════════════════════════════════════════════════════════════
import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase.js'
import { ziXweather, stareZi, textValori, textSursa, descriereRo, TEXT_IN_CURS, TEXT_FARA } from './meteoXweatherUtil.js'

const G = { text: '#E6EDF3', muted: '#8B949E', dim: '#6E7681', red: '#F85149', border: '#30363D', bg: '#0D1117' }

export default function MeteoZiXweather({ siteId, data, compact = false, client = supabase }) {
  const k = siteId && data ? `${siteId}|${data}` : null
  const [st, setSt] = useState({ k: null, rand: undefined, eroare: null })
  useEffect(() => {
    if (!k) return
    let viu = true
    setSt({ k, rand: undefined, eroare: null })
    ziXweather(client, siteId, data)
      .then(rand => { if (viu) setSt({ k, rand, eroare: null }) })
      .catch(e => { if (viu) setSt({ k, rand: undefined, eroare: e?.message || String(e) }) })
    return () => { viu = false }
  }, [k, client])   // eslint-disable-line react-hooks/exhaustive-deps
  if (!k) return null
  const curent = st.k === k
  const cutie = { fontSize: compact ? 12 : 13, color: G.text, lineHeight: 1.5, ...(compact ? { background: G.bg, border: `1px solid ${G.border}`, borderRadius: 10, padding: '8px 11px', marginTop: 8 } : {}) }
  const titlu = compact ? <div style={{ fontSize: 11, fontWeight: 700, color: G.muted, textTransform: 'uppercase', letterSpacing: .5, marginBottom: 3 }}>🌦 Vremea zilei</div> : null
  if (!curent || (st.rand === undefined && !st.eroare)) return <div data-meteo-zi="incarcare" style={cutie}>{titlu}<span style={{ color: G.dim }}>Se citește vremea zilei…</span></div>
  if (st.eroare) return <div data-meteo-zi="eroare" style={cutie}>{titlu}<span style={{ color: G.red }}>Vremea zilei nu se poate citi: {st.eroare}</span></div>
  const stare = stareZi(st.rand, data)
  if (stare !== 'date') return <div data-meteo-zi={stare} style={cutie}>{titlu}<span style={{ color: G.muted }}>{stare === 'in_curs' ? TEXT_IN_CURS : TEXT_FARA}</span></div>
  const r = st.rand, d = descriereRo(r.descriere)
  return (
    <div data-meteo-zi="date" style={cutie}>
      {titlu}
      {d && <div style={{ fontWeight: 700 }}>{d}</div>}
      <div>{textValori(r)}</div>
      <div style={{ fontSize: compact ? 11 : 12, color: G.dim, marginTop: 3 }}>{textSursa(r)}</div>
    </div>
  )
}
