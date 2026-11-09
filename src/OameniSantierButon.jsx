// Execuție → proiect: butonul „👷 Oameni pe șantier → Excel” (logica și fișierul: executieOameniXlsx.js).
// Stări afișate distinct (L18): lucru / descărcat / informare (fără șantiere, nimeni) / eroare cu mesaj. Rezultatul se aplică doar
// dacă apăsarea e cea curentă și proiectul nu s-a schimbat între timp (L24).
import { useEffect, useRef, useState } from 'react'
import { exportaOameniProiect, FEREASTRA_ZILE } from './executieOameniXlsx.js'

const C = { text: '#E6EDF3', muted: '#8B949E', border: '#30363D', blue: '#58A6FF', green: '#2EA043', yellow: '#D29922', red: '#F85149' }

function descarca(bytes, nume) {
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nume
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}

export default function OameniSantierButon({ supabase, proiectId }) {
  const [stare, setStare] = useState(null)   // { tip: 'lucru' | 'ok' | 'info' | 'eroare', text }
  const generatie = useRef(0)
  useEffect(() => { generatie.current++; setStare(null) }, [proiectId])

  const ruleaza = async () => {
    const g = ++generatie.current
    setStare({ tip: 'lucru', text: 'Se pregătește lista…' })
    try {
      const r = await exportaOameniProiect(supabase, proiectId)
      if (g !== generatie.current) return
      if (r.faraSantiere) { setStare({ tip: 'info', text: 'Proiectul nu are șantiere legate în ERP.' }); return }
      if (!r.nrOameni) { setStare({ tip: 'info', text: `Niciun om activ pe șantierele proiectului (alocat sau pontat în ultimele ${r.fereastra} de zile).` }); return }
      descarca(r.bytes, r.numeFisier)
      setStare({ tip: 'ok', text: `✓ ${r.nrOameni} ${r.nrOameni === 1 ? 'om' : 'oameni'}, ${r.nrFoi} ${r.nrFoi === 1 ? 'șantier' : 'șantiere'}` })
    } catch (e) {
      if (g !== generatie.current) return
      setStare({ tip: 'eroare', text: 'Exportul nu s-a putut face: ' + (e?.message || String(e)) })
    }
  }

  const lucreaza = stare?.tip === 'lucru'
  const culoare = { lucru: C.muted, ok: C.green, info: C.yellow, eroare: C.red }[stare?.tip] || C.muted
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <button onClick={ruleaza} disabled={lucreaza} data-oameni-santier-excel
        title={`Oamenii activi ai proiectului: alocați pe șantierele lui sau pontați ultima dată acolo (ultimele zile pontate până azi, fereastră de ${FEREASTRA_ZILE} de zile). Fără date personale.`}
        style={{ background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 6, color: lucreaza ? C.muted : C.blue,
          cursor: lucreaza ? 'wait' : 'pointer', fontSize: 12, padding: '4px 10px', flexShrink: 0 }}>
        👷 Oameni pe șantier → Excel
      </button>
      {stare && <span role={stare.tip === 'eroare' ? 'alert' : 'status'} style={{ fontSize: 11, color: culoare, maxWidth: 420 }}>{stare.text}</span>}
    </div>
  )
}
