// ════════════════════════════════════════════════════════════════
// MeteoZiXweather.jsx — blocul „Vremea zilei” din raportul zilnic (telefon + pagina de rapoarte), 20261221a.
// Arată rezumatul ZILEI preluat automat de la Vaisala Xweather (v_meteo_zilnic_xweather): valorile + sursa scrisă explicit (coordonatele
// folosite, stația de observație cea mai apropiată și distanța, momentul preluării). Doar citire, nimic introdus de mână.
// Ordinea (r2): întâi se verifică dacă vederea / rândul există, abia apoi se alege mesajul. Vederea încă inexistentă (migrarea 20261221a
// neaplicată) = funcția nu e activă: blocul NU apare deloc (nici eroare, nici promisiunea „după miezul nopții”), în orice zi. Rândul lipsă:
// ziua în curs → „apare după miezul nopții”, zi trecută → „fără rezumat”. Altă eroare de citire se arată ca eroare (L18), nu ca „fără date”.
// Instantaneul meteo_cache de la trimiterea raportului (MeteoRaportText) nu e atins. L24: rezultatul se aplică doar pentru șantierul și ziua
// afișate acum.
// ════════════════════════════════════════════════════════════════
import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase.js'
import { ziXweather, stareZi, textValori, textSursa, descriereRo, TEXT_IN_CURS, TEXT_FARA } from './meteoXweatherUtil.js'

const G = { text: '#E6EDF3', muted: '#8B949E', dim: '#6E7681', red: '#F85149', border: '#30363D', bg: '#0D1117' }

// cadru (opțional): învelișul blocului (ex. titlul secțiunii din pagina de rapoarte) — nu apare nici el când funcția nu e activă
export default function MeteoZiXweather({ siteId, data, compact = false, client = supabase, cadru = (c) => c }) {
  const k = siteId && data ? `${siteId}|${data}` : null
  const [st, setSt] = useState({ k: null, rand: undefined, eroare: null, inactiv: false })
  useEffect(() => {
    if (!k) return
    let viu = true
    setSt({ k, rand: undefined, eroare: null, inactiv: false })
    ziXweather(client, siteId, data)
      .then(rand => { if (viu) setSt({ k, rand, eroare: null, inactiv: false }) })
      .catch(e => { if (viu) setSt(e?.vedereLipsa ? { k, rand: undefined, eroare: null, inactiv: true } : { k, rand: undefined, eroare: e?.message || String(e), inactiv: false }) })
    return () => { viu = false }
  }, [k, client])   // eslint-disable-line react-hooks/exhaustive-deps
  if (!k) return null
  const curent = st.k === k
  // vederea nu există încă: funcția nu e activă → nimic afișat
  if (curent && st.inactiv) return null
  const cutie = { fontSize: compact ? 12 : 13, color: G.text, lineHeight: 1.5, ...(compact ? { background: G.bg, border: `1px solid ${G.border}`, borderRadius: 10, padding: '8px 11px', marginTop: 8 } : {}) }
  const titlu = compact ? <div style={{ fontSize: 11, fontWeight: 700, color: G.muted, textTransform: 'uppercase', letterSpacing: .5, marginBottom: 3 }}>🌦 Vremea zilei</div> : null
  if (!curent || (st.rand === undefined && !st.eroare)) return cadru(<div data-meteo-zi="incarcare" style={cutie}>{titlu}<span style={{ color: G.dim }}>Se citește vremea zilei…</span></div>)
  if (st.eroare) return cadru(<div data-meteo-zi="eroare" style={cutie}>{titlu}<span style={{ color: G.red }}>⚠ {st.eroare}</span></div>)
  const stare = stareZi(st.rand, data)
  if (stare !== 'date') return cadru(<div data-meteo-zi={stare} style={cutie}>{titlu}<span style={{ color: G.muted }}>{stare === 'in_curs' ? TEXT_IN_CURS : TEXT_FARA}</span></div>)
  const r = st.rand, d = descriereRo(r.descriere)
  return cadru(
    <div data-meteo-zi="date" style={cutie}>
      {titlu}
      {d && <div style={{ fontWeight: 700 }}>{d}</div>}
      <div>{textValori(r)}</div>
      <div style={{ fontSize: compact ? 11 : 12, color: G.dim, marginTop: 3 }}>{textSursa(r)}</div>
    </div>
  )
}
