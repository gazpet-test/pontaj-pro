// Registru — coloana „SMS” și filtrul SMS (20261130i). Componente pure (props → markup), testate prin randare (smsRegistruRender.test.jsx).
// sms = { harta: Map|null, eroare: string|null }: harta null fără eroare = se încarcă; eroare = afișată, NU „niciun SMS” (L18).
import React from 'react'
import { G, S } from './comune.jsx'
import { stareSmsPentru, textBadge, rezumatSms, FILTRE_SMS, STARI_SMS } from '../smsStare.js'

// „—” fără SMS; badge cu ultima stare + ×N + data ultimei trimiteri; tooltip cu cifrele
export function CelulaSms({ sms, detinatorId }) {
  if (!sms || sms.eroare) return <span data-sms="eroare" title={`Starea SMS nu s-a putut citi${sms?.eroare ? `: ${sms.eroare}` : ''}`} style={{ color:G.red }}>⚠ eroare</span>
  if (!sms.harta) return <span data-sms="incarcare" style={{ color:G.dim }}>…</span>
  const s = stareSmsPentru(sms.harta, detinatorId)
  if (!s) return <span data-sms="fara" style={{ color:G.dim }} title="niciun SMS">—</span>
  const st = STARI_SMS[s.ultima_stare]
  return <span data-sms={s.ultima_stare} title={rezumatSms(s)} style={{ ...S.tag, background:'transparent', border:`1px solid ${st.culoare}`, color:st.culoare }}>{textBadge(s)}</span>
}

// Filtrul din bara Registrului: dezactivat cât starea SMS nu e citită (ca să nu filtreze pe o hartă lipsă); rămâne activ dacă e deja ales (se poate reseta)
export function FiltruSms({ valoare, onChange, sms }) {
  const gata = !!sms?.harta && !sms?.eroare
  return (
    <select value={valoare} onChange={e => onChange(e.target.value)} style={S.select} disabled={!gata && !valoare} aria-label="Filtru SMS"
      title={sms?.eroare ? `Starea SMS nu s-a putut citi: ${sms.eroare}` : 'Filtru după starea SMS a deținătorului'}>
      {FILTRE_SMS.map(f => <option key={f.cod} value={f.cod}>{f.eticheta}</option>)}
    </select>
  )
}
