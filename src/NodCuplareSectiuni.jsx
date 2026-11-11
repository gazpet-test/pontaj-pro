// ═══════════════════════════════════════════════════════════════════════════
// NodCuplareSectiuni.jsx — tab-ul „🔩 Nod cuplare” din Execuție: comutatorul între sudurile nodului (NodCuplareSchema, 20261201a)
// și elementele lui de construcții (NodConstructii, 20261207a). Legătura directă de pe telefon:
//   /executie?proiect=1&tab=nod&sectiune=constructii
// Aici nu se citește și nu se scrie nimic în BD.
// ═══════════════════════════════════════════════════════════════════════════

import { useState } from 'react'
import NodCuplareSchema from './NodCuplareSchema.jsx'
import NodConstructii from './NodConstructii.jsx'
import { G } from './NodCuplareVizualizare.jsx'

const SECTIUNI = [
  { key: 'suduri', label: '🔩 Suduri' },
  { key: 'constructii', label: '🏗️ Construcții' },
]
const dinUrl = () => {
  try { return new URLSearchParams(window.location.search).get('sectiune') === 'constructii' ? 'constructii' : 'suduri' } catch { return 'suduri' }
}

export default function NodCuplareSectiuni({ proiectId }) {
  const [sectiune, setSectiune] = useState(dinUrl)
  return (
    <div>
      <div style={{ display: 'flex', gap: 6, padding: '10px 12px 0', maxWidth: 1200, margin: '0 auto' }}>
        {SECTIUNI.map(s => {
          const activ = s.key === sectiune
          return (
            <button key={s.key} onClick={() => setSectiune(s.key)} aria-pressed={activ}
              style={{ flex: 1, minHeight: 44, borderRadius: 10, border: `1px solid ${activ ? G.blue : G.border}`, background: activ ? G.blue + '26' : G.surface,
                color: activ ? G.text : G.muted, fontSize: 14, fontWeight: activ ? 800 : 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              {s.label}
            </button>
          )
        })}
      </div>
      {sectiune === 'suduri' ? <NodCuplareSchema proiectId={proiectId} /> : <NodConstructii proiectId={proiectId} />}
    </div>
  )
}
