// Registru — coloana „SMS” și filtrul SMS (20261130i). Componente pure (props → markup), testate prin randare (smsRegistruRender.test.jsx).
// sms = { harta: Map|null, eroare: string|null }: harta null fără eroare = se încarcă; eroare = afișată, NU „niciun SMS” (L18).
import React from 'react'
import { G, S, Gol } from './comune.jsx'
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

// r4 (Copilot #984 P2-02, L18): rândul de stare al tabelului Registrului — încărcare / eroare / gol sunt TREI stări distincte.
// „Nicio parcelă pentru filtrele alese.” apare DOAR după o încărcare reușită cu zero rânduri; o eroare (inclusiv RPC-ul SMS picat cu filtrul
// SMS activ) spune că lista nu s-a putut determina și oferă Reîncearcă.
export function RandStareRegistru({ loading, eroare, fSms, nrRanduri, colSpan, onReincearca }) {
  if (loading) return <tr><td colSpan={colSpan} style={{ ...S.td, color:G.muted, textAlign:'center' }}>Se încarcă…</td></tr>
  if (eroare) return (
    <tr><td colSpan={colSpan} role="alert" data-testid="registru-eroare" style={{ ...S.td, color:G.red, textAlign:'center' }}>
      ⚠ {fSms ? 'Nu s-a putut determina lista pentru filtrul SMS' : 'Nu s-a putut încărca registrul'} ({eroare}).{' '}
      <button type="button" style={S.btnX} onClick={onReincearca}>↻ Reîncearcă</button>
    </td></tr>
  )
  if (nrRanduri === 0) return <tr><td colSpan={colSpan} style={S.td}><Gol text="Nicio parcelă pentru filtrele alese." /></td></tr>
  return null
}
