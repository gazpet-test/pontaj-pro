import React, { useEffect, useRef, useState } from 'react'
import { supabase } from './lib/supabase.js'
import { normalizeazaVin, vinMascat, numar, ziBucuresti, formatData, vechimeCitire,
  kmPeIntervale, intervaleInFereastra, sumaKm, consumLa100, formatKm, formatProcent } from './bmwCardataLogica.js'

const CAMPURI = 'citit_la,vin,odometru_km,combustibil_pct,combustibil_litri,soc_pct,autonomie_totala_km,autonomie_termic_km,autonomie_electric_km,obfcm_combustibil_l,obfcm_distanta_km,sursa'
const COMPARATIE = 'zi,km_bmw_interval,km_evogps_interval,diferenta_km_interval'

// Axele sunt zile calendaristice Bucuresti, inclusiv la trecerea ora vara/iarna.
function Grafic({ citiri, intervale, acum, G }) {
  const ultimaZi = Date.parse(ziBucuresti(acum))
  const primaZi = ultimaZi - 29 * 86400000
  const x = data => 42 + (Date.parse(ziBucuresti(data)) - primaZi) / 86400000 * 17
  const vizibile = citiri.filter(c => x(c.citit_la) >= 42 && x(c.citit_la) <= 535)
  const bare = intervale.filter(i => x(i.pana_la) >= 42 && x(i.pana_la) <= 535)
  const maxim = Math.max(1, ...bare.map(i => i.km_pe_zi ?? 0))
  const linie = (camp, culoare) => {
    let precedent = null
    return vizibile.map((c, index) => {
      const v = numar(c[camp])
      if (v === null) { precedent = null; return null }
      const punct = { x: x(c.citit_la), y: 239 - v * 0.65, zi: Date.parse(ziBucuresti(c.citit_la)) }
      const anterior = precedent
      precedent = punct
      return <g key={index}>
        {anterior && punct.zi - anterior.zi <= 86400000 && <line x1={anterior.x} y1={anterior.y} x2={punct.x} y2={punct.y} stroke={culoare} strokeWidth="2" />}
        <circle cx={punct.x} cy={punct.y} r="3" fill={culoare}><title>{`${formatData(c.citit_la)}: ${formatProcent(v)}`}</title></circle>
      </g>
    })
  }
  const etichetaZi = ms => new Date(ms).toISOString().slice(5).split('-').reverse().join('.')
  return <div style={{marginTop: 14}}>
    <svg viewBox="0 0 570 270" role="img" aria-label="Ultimele 30 de zile: km pe zi, combustibil si baterie" style={{width: '100%', display: 'block'}}>
      <text x="42" y="14" fill={G.muted} fontSize="11">Km/zi intre citiri (media intervalului)</text>
      <text x="4" y="37" fill={G.muted} fontSize="10">{formatKm(maxim)}</text>
      <text x="20" y="139" fill={G.muted} fontSize="10">0</text>
      <line x1="42" y1="135" x2="550" y2="135" stroke={G.border2} />
      {bare.map((i, n) => i.km_pe_zi === null ? null : <rect key={n} x={x(i.pana_la) - 5} y={135 - i.km_pe_zi / maxim * 100}
        width="10" height={Math.max(1, i.km_pe_zi / maxim * 100)} fill={G.blue}>
        <title>{`${formatData(i.pana_la)}: ${formatKm(i.km_pe_zi)} km/zi; ${formatKm(i.km)} km in ${i.zile} zile`}</title>
      </rect>)}
      <text x="42" y="161" fill={G.orange} fontSize="11">Combustibil %</text>
      <text x="190" y="161" fill={G.green} fontSize="11">Baterie SoC %</text>
      <text x="6" y="180" fill={G.muted} fontSize="10">100</text>
      <text x="20" y="242" fill={G.muted} fontSize="10">0</text>
      <line x1="42" y1="239" x2="550" y2="239" stroke={G.border2} />
      {linie('combustibil_pct', G.orange)}
      {linie('soc_pct', G.green)}
      {[0, 7, 14, 21, 29].map(j => <text key={j} x={42 + j * 17} y="260" textAnchor="middle" fill={G.muted} fontSize="10">{etichetaZi(primaZi + j * 86400000)}</text>)}
    </svg>
    <div style={{fontSize: 11, color: G.muted}}>Zilele fara citire raman goale. Bara apare la capatul intervalului.</div>
  </div>
}

export default function BmwCardataCard({ serieSasiu, G, S }) {
  const vin = normalizeazaVin(serieSasiu)
  const [deschis, setDeschis] = useState(() => typeof window === 'undefined' || window.innerWidth >= 700)
  const [stare, setStare] = useState({ vin: '', citiri: [], comparatie: [], eroare: false, incarcare: false })
  const [reincarcare, setReincarcare] = useState(0)
  const blocat = useRef(false)
  useEffect(() => {
    if (!vin) return
    let activ = true
    blocat.current = true
    setStare({ vin, citiri: [], comparatie: [], eroare: false, incarcare: true })
    const incarca = async () => {
      const rezultate = await Promise.allSettled([
        supabase.from('bmw_cardata_citiri').select(CAMPURI).eq('vin', vin).order('citit_la', { ascending: false }).limit(60),
        supabase.from('v_bmw_cardata_vs_evogps').select(COMPARATIE).eq('vin', vin).order('zi', { ascending: false }).limit(60),
      ])
      const date = rezultate.map((r, i) => {
        const eroare = r.status === 'rejected' ? r.reason : r.value.error
        if (eroare) {
          // Nu logam payload, VIN sau alte date ale vehiculului.
          console.warn(`BMW CarData: ${i === 0 ? 'citiri' : 'comparatie'} indisponibile`)
          return { eroare: true, randuri: [] }
        }
        return { eroare: false, randuri: r.value.data ?? [] }
      })
      if (activ) {
        blocat.current = false
        setStare({ vin, citiri: date[0].randuri, comparatie: date[1].randuri,
          eroare: date.some(d => d.eroare), incarcare: false })
      }
    }
    incarca()
    return () => { activ = false }
  }, [vin, reincarcare])

  if (!vin || stare.vin !== vin) return null
  const reincarca = () => {
    if (blocat.current) return
    blocat.current = true
    setReincarcare(n => n + 1)
  }
  if (!stare.citiri.length) return stare.eroare
    ? <div style={{fontSize: 11, color: G.muted, marginBottom: 14}}>Date BMW indisponibile acum <button type="button" style={{...S.btnS, fontSize: 11}} onClick={reincarca}>Reincarca</button></div>
    : null
  const acum = new Date()
  const ultima = stare.citiri[0]
  const vechime = vechimeCitire(ultima.citit_la, acum)
  const intervale = kmPeIntervale(stare.citiri)
  // Pentru grafic pastram ultima citire din fiecare zi; totalurile folosesc toate intervalele.
  const peZi = new Map()
  for (const c of [...stare.citiri].reverse()) peZi.set(ziBucuresti(c.citit_la), c)
  const zilnice = [...peZi.values()]
  const consum = consumLa100(intervaleInFereastra(intervale, 30, acum))
  const comparatie = stare.comparatie.filter(c => numar(c.km_evogps_interval) !== null)
  const valori = [
    ['Kilometraj', ultima.odometru_km, 'km'],
    ['Combustibil', ultima.combustibil_pct, '%'], ['Combustibil', ultima.combustibil_litri, 'l'],
    ['Baterie SoC', ultima.soc_pct, '%'], ['Autonomie totala', ultima.autonomie_totala_km, 'km'],
    ['Autonomie termica', ultima.autonomie_termic_km, 'km'], ['Autonomie electrica', ultima.autonomie_electric_km, 'km'],
  ].filter(([, v]) => numar(v) !== null)
  return <section style={{...S.card, padding: 14, marginBottom: 14}}>
    <div style={{display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap'}}>
      <button type="button" aria-expanded={deschis} onClick={() => setDeschis(v => !v)} style={{...S.btnS, color: G.blue}}>{deschis ? '-' : '+'} BMW CarData</button>
      <span style={{fontSize: 11, color: G.muted}}>{ultima.sursa || 'BMW'} / VIN {vinMascat(vin)}</span>
      <button type="button" onClick={reincarca} disabled={stare.incarcare} style={{...S.btnS, fontSize: 11, marginLeft: 'auto'}}>Reincarca</button>
    </div>
    <div style={{fontSize: 12, color: G.muted, marginTop: 8}}>Ultima citire: {formatData(ultima.citit_la)} (Europe/Bucharest), {vechime.text}</div>
    {vechime.eVeche && <div style={{background: G.yellowDim, color: G.yellow, borderRadius: 8, padding: 10, marginTop: 8, fontSize: 12}}>Ultima citire BMW e veche: serverul BMW poate fi indisponibil</div>}
    {stare.eroare && <div style={{fontSize: 11, color: G.muted, marginTop: 8}}>Date BMW indisponibile acum</div>}
    {deschis && <>
      <div style={{display: 'flex', flexWrap: 'wrap', gap: 18, marginTop: 14}}>
        {valori.map(([label, v, unitate], i) => <div key={i}><div style={{fontSize: 11, color: G.muted}}>{label}</div><strong>{unitate === '%' ? formatProcent(v) : `${formatKm(v)} ${unitate}`}</strong></div>)}
      </div>
      <Grafic citiri={zilnice} intervale={kmPeIntervale(zilnice)} acum={acum} G={G} />
      {intervale.some(i => i.anomalie) && <div style={{fontSize: 11, color: G.yellow}}>Kilometraj descrescator detectat; intervalele respective sunt excluse.</div>}
      <div style={{display: 'flex', flexWrap: 'wrap', gap: 18, marginTop: 14, fontSize: 13}}>
        <span>km in ultimele 7 zile: <strong>{formatKm(sumaKm(intervale, 7, acum))}</strong></span>
        <span>km in ultimele 30 de zile: <strong>{formatKm(sumaKm(intervale, 30, acum))}</strong></span>
        {consum !== null && <span>Consum mediu OBFCM (intervale disponibile, 30 zile): <strong>{formatKm(consum)} l/100 km</strong></span>}
      </div>
      <div style={{fontSize: 11, color: G.muted, marginTop: 6}}>Totaluri doar pe intervalele cu citire la ambele capete in fereastra.</div>
      {comparatie.length > 0 && <div style={{marginTop: 16, overflowX: 'auto'}}>
        <strong style={{fontSize: 13}}>Comparatie cu EvoGPS</strong>
        <table style={{width: '100%', fontSize: 12, borderCollapse: 'collapse', marginTop: 8}}>
          <thead><tr>{['Zi', 'BMW km/interval', 'EvoGPS km/interval', 'Diferenta km'].map(t => <th key={t} style={{textAlign: 'left', color: G.muted, padding: 5}}>{t}</th>)}</tr></thead>
          <tbody>{comparatie.map((c, i) => <tr key={i}>{[c.zi, formatKm(c.km_bmw_interval), formatKm(c.km_evogps_interval), formatKm(c.diferenta_km_interval)].map((v, j) => <td key={j} style={{padding: 5, borderTop: `1px solid ${G.border}`}}>{v || '-'}</td>)}</tr>)}</tbody>
        </table>
      </div>}
      <div style={{fontSize: 11, color: G.muted, marginTop: 14}}>Date doar pentru citire, actualizate zilnic. Locatia nu se afiseaza.</div>
    </>}
  </section>
}
