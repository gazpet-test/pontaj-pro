/* FormularCampuri.jsx — formular pe grupuri, din definițiile din redari/setari.js (UAT + Setări proiect). Doar afișare + onChange. */
import React from 'react'
import { G, S, Camp, fmtDate } from './comune.jsx'

const TIP_INPUT = { date: 'date', email: 'email', tel: 'tel', ora: 'text', text: 'text' }

export default function FormularCampuri({ campuri, form, onChange, doarCitire, schimbate = [] }) {
  const grupuri = []
  for (const c of campuri) {
    let g = grupuri.find(x => x.nume === c.grup)
    if (!g) { g = { nume: c.grup, campuri: [] }; grupuri.push(g) }
    g.campuri.push(c)
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {grupuri.map(g => (
        <div key={g.nume}>
          <div style={{ fontSize: 12, fontWeight: 700, color: G.muted, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 8 }}>{g.nume}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
            {g.campuri.map(c => {
              const v = form?.[c.cheie] ?? ''
              const marcat = schimbate.includes(c.cheie)
              const stil = { ...S.input, ...(marcat ? { borderColor: G.yellow } : null) }
              const eticheta = c.eticheta + (c.obligatoriu ? ' *' : '')
              if (doarCitire) {
                const afis = c.tip === 'date' ? fmtDate(v || null) : (String(v).trim() || '-')
                return (
                  <Camp key={c.cheie} eticheta={eticheta} span={c.span}>
                    <div style={{ fontSize: 13, whiteSpace: c.tip === 'textarea' ? 'pre-wrap' : 'normal', color: String(v).trim() ? G.text : G.dim }}>{afis}</div>
                  </Camp>
                )
              }
              return (
                <Camp key={c.cheie} eticheta={eticheta} span={c.span}>
                  {c.tip === 'textarea'
                    ? <textarea value={v} onChange={e => onChange(c.cheie, e.target.value)} rows={5} style={{ ...stil, resize: 'vertical' }} />
                    : <input type={TIP_INPUT[c.tip] || 'text'} value={v} placeholder={c.exemplu || (c.tip === 'ora' ? 'HH:MM' : '')}
                        onChange={e => onChange(c.cheie, e.target.value)} style={stil} />}
                </Camp>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
