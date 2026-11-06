import React, { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase.js'
import { agregaCentralizator, agregaTronsoane } from '../sesiune.js'
import { STARI } from '../stare.js'
import { G, S, msgEroare } from './comune.jsx'
import ExportEcran from './ExportEcran.jsx'

// Cursor lexicografic: (uat_id, stare) este unic in vederea centralizatorului.
async function pagini(fabrica, chei, curent) {
  const tot = []
  let ultim
  while (curent()) {
    let q = fabrica()
    for (const k of chei) q = q.order(k)
    if (ultim) {
      const filtre = chei.map((k, i) => {
        const parti = chei.slice(0, i).map(c => `${c}.eq.${JSON.stringify(ultim[c])}`)
        parti.push(`${k}.gt.${JSON.stringify(ultim[k])}`)
        return parti.length === 1 ? parti[0] : `and(${parti.join(',')})`
      })
      q = q.or(filtre.join(','))
    }
    const { data, error } = await q.range(0, 499)
    if (error) throw error
    if (!curent()) return null
    if (!Array.isArray(data)) throw new Error('Citire incompleta: lipseste lista.')
    if (!data.length) return tot
    const nou = data.at(-1)
    if (chei.some(k => nou[k] == null) || (ultim && chei.every(k => nou[k] === ultim[k]))) throw new Error('Paginarea nu a avansat.')
    tot.push(...data); ultim = nou
  }
  return null
}

export default function DashboardEcran({ proiect }) {
  const [date, setDate] = useState(null), [mesaj, setMesaj] = useState(''), [reload, setReload] = useState(0)
  const generatie = useRef(0)
  useEffect(() => {
    const token = ++generatie.current, curent = () => token === generatie.current
    setDate(null); setMesaj('')
    Promise.all([
      pagini(() => supabase.from('red_v_centralizator_uat').select('uat_id,uat3,uat_nume,stare,numar,total_uat,procent_inchise').not('stare','is',null)
        .eq('proiect_id', proiect.id), ['uat_id', 'stare'], curent),
      pagini(() => supabase.from('red_v_tronson').select('parcela_id,tronson,tip_pv,obiectii_deschise')
        .eq('proiect_id', proiect.id), ['parcela_id'], curent),
    ]).then(([uats, tronsoane]) => {
      if (curent()) setDate({ uats: agregaCentralizator(uats), tronsoane: agregaTronsoane(tronsoane) })
    }).catch(e => { if (curent()) setMesaj(msgEroare(e)) })
    return () => { generatie.current++ }
  }, [proiect.id, reload])
  const coloane = [['parcele', 'Parcele'], ['pv_a_semnat', 'Cu PV A semnat'], ['pv_b', 'Cu PV B'], ['fara_pv', 'Fără PV'], ['obiectii_deschise', 'Obiecții deschise']]
  return <div style={S.card}>
    <button style={S.btnS} disabled={!date && !mesaj} onClick={() => setReload(n => n + 1)}>↻ Reîncarcă</button>
    {mesaj && <p role="alert">{mesaj}</p>}
    {!date && !mesaj && <p style={{ fontSize:12.5, color:G.muted, margin:'0 0 8px' }}>Se încarcă...</p>}
    {date && <>
      <h3 style={{ fontSize:15, fontWeight:700, margin:'16px 0 4px' }}>Centralizator pe UAT</h3>
      <p style={{ fontSize:12.5, color:G.muted, margin:'0 0 8px' }}>Număr de parcele distincte. Fiecare parcelă contează o singură dată, inclusiv cele cu utilizatori / arendași.</p>
      <div style={{ overflowX: 'auto' }}><table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead><tr>{['UAT', 'Total', 'Închise', '% închise', ...STARI.map(s => s.eticheta)].map(c => <th key={c} style={S.th}>{c}</th>)}</tr></thead>
        <tbody>{date.uats.map((u, i) => <tr key={i} style={{ fontWeight: u.uat3 === 'TOTAL' ? 700 : 400 }}>
          <td style={S.td}>{u.uat_nume} {u.uat3 !== 'TOTAL' && `(${u.uat3})`}</td>
          {[u.total, u.inchise, `${u.procent.toFixed(1)}%`, ...STARI.map(s => u.pe_stare[s.cod] || 0)].map((v, j) => <td key={j} style={S.td}>{v}</td>)}
        </tr>)}</tbody>
      </table></div>
      <h3 style={{ fontSize:15, fontWeight:700, margin:'16px 0 4px' }}>Centralizator pe tronson</h3>
      {!date.tronsoane.length && <p style={{ fontSize:12.5, color:G.muted, margin:'0 0 8px' }}>Nicio parcelă activă.</p>}
      <div style={{ overflowX: 'auto' }}><table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead><tr><th style={S.th}>Tronson</th>{coloane.map(([k, text]) => <th key={k} style={S.th}>{text}</th>)}</tr></thead>
        <tbody>{date.tronsoane.map(t => <tr key={t.tronson}><td style={S.td}>{t.tronson ?? 'Fără tronson'}</td>
          {coloane.map(([k]) => <td key={k} style={S.td}>{t[k]}</td>)}
        </tr>)}</tbody>
      </table></div>
    </>}
    <ExportEcran key={proiect.id} proiect={proiect} />
  </div>
}
