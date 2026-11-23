/* FanContradictii.jsx — lista de AUDIT a contradicțiilor FAN ale unui lot (runda 2 #1155, decizia owner-ului 21.11.2026: „la 2000 de oameni
   mergem pe ce livrează API-ul”). Faptele raportate de curier se înregistrează automat după regula fan-contradictii-v1; contradicțiile NU
   blochează plicul și NU cer omul: rămân aici, durabil (red_fan_contradictii, migrarea 20270102a), cu valorile contradictorii, valoarea aleasă și
   regula aplicată, ca să poată fi consultate când e nevoie. Citire cu JWT-ul omului (RLS: admin / editor Redări), la cerere (butonul), keyset pe id
   (L23), cu filtrul pe tip. Nimic nu se scrie de aici; un plic anume îl corectează omul pe calea lui obișnuită. */
import React, { useEffect, useRef, useState } from 'react'
import { G, S, msgEroare, citestePaginat } from './comune.jsx'
import { COL_CONTRADICTII, ETICHETE_CONTRADICTIE, textContradictie, lipsaTabelContradictii } from '../fanLot.js'

const momentRo = v => { const ms = Date.parse(v); if (!Number.isFinite(ms)) return ''
  return new Intl.DateTimeFormat('ro-RO', { timeZone: 'Europe/Bucharest', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(ms)) }

export default function FanContradictii({ client, lotId, awb = [], activ = false, reload = 0 }) {
  const [lista, setLista] = useState(null), [eroare, setEroare] = useState(''), [lipsa, setLipsa] = useState(false), [tip, setTip] = useState(''), [citeste, setCiteste] = useState(false)
  const gen = useRef(0)
  // L24: schimbarea lotului / reîncărcarea evidenței invalidează citirea în curs și golește lista (se recitește la cerere)
  useEffect(() => { gen.current++; setLista(null); setEroare(''); setLipsa(false); setCiteste(false); return () => { gen.current++ } }, [lotId, reload])
  const incarca = async () => {
    const token = ++gen.current, curent = () => gen.current === token
    setEroare(''); setLipsa(false); setCiteste(true)
    try {
      const r = await citestePaginat(() => client.from('red_fan_contradictii').select(COL_CONTRADICTII).eq('lot_id', lotId), { cheie: 'id', esteCurent: curent })
      if (curent()) setLista(r)
    } catch (e) {
      if (!curent()) return
      if (lipsaTabelContradictii(e)) setLipsa(true)
      else setEroare(msgEroare(e))   // L18: eroarea de citire ≠ „nicio contradicție”
    } finally { if (curent()) setCiteste(false) }
  }
  if (!activ) return null
  const nrPlic = new Map((awb || []).map(r => [r.id, r.nr_plic]))
  const vazute = (lista || []).filter(c => !tip || c.tip === tip).sort((a, b) => (a.prima_la < b.prima_la ? 1 : a.prima_la > b.prima_la ? -1 : 0))
  return <details style={{ ...S.card, marginBottom: 8 }}>
    <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Contradicții FAN (audit){lista ? ` — ${lista.length}` : ''}</summary>
    <p style={{ fontSize: 12, color: G.muted, margin: '6px 0' }}>
      Răspunsurile curierului care s-au contrazis (două zile de ridicare, două ore de livrare, livrare și retur). Faptul a fost înregistrat automat după
      regulă — prima zi de ridicare, ultima oră de livrare, evenimentul final ulterior (la egalitate: retur) — iar contradicția rămâne aici, pentru
      verificare când e nevoie. Nu e nimic de făcut pe fiecare plic; un plic anume se poate corecta manual.</p>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 6 }}>
      <button style={S.btnX} disabled={citeste} onClick={incarca}>{lista ? 'Reîncarcă' : 'Arată contradicțiile lotului'}</button>
      <select style={S.input} value={tip} onChange={e => setTip(e.target.value)} aria-label="Filtrează contradicțiile după tip">
        <option value="">toate tipurile</option>
        {Object.entries(ETICHETE_CONTRADICTIE).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
      </select>
    </div>
    {citeste && <div>Se citesc contradicțiile…</div>}
    {lipsa && <div role="status" style={{ color: G.yellow }}>Lista contradicțiilor apare după instalarea urmăririi automate (migrarea încă neaplicată).</div>}
    {eroare && <div role="alert" style={{ color: G.red }}>Nu am putut citi contradicțiile: {eroare}</div>}
    {lista && !vazute.length && <div style={{ color: G.muted }}>{lista.length ? 'Niciuna de acest tip.' : 'Nicio contradicție pe acest lot.'}</div>}
    {vazute.map(c => <div key={c.id} style={{ fontSize: 12.5, padding: '2px 0' }}>
      <b>{nrPlic.get(c.fan_awb_id) || '-'}</b> · AWB {c.awb} · {textContradictie(c)} · {momentRo(c.prima_la)}{c.rulare_id ? ' · rularea automată' : ' · butonul „Urmărire”'}
    </div>)}
  </details>
}
