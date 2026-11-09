// Execuție → proiect: butonul „👷 Oameni pe șantier → Excel” (logica și fișierul: executieOameniXlsx.js).
// Stări afișate distinct (L18): lucru / descărcat / informare (fără șantiere, nimeni) / eroare cu mesaj.
// L24: rezultatul se aplică (inclusiv descărcarea) doar dacă apăsarea e cea curentă; la schimbarea proiectului sau la demontare,
// generația se invalidează și citirea se oprește între pagini (semnal.anulat). Butonul apare doar când proiectul ÎNCĂRCAT în pagină
// e chiar proiectul curent (review Jakarinos r1 P2).
import { useEffect, useRef, useState } from 'react'
import { exportaOameniProiect, ExportAnulat } from './executieOameniXlsx.js'

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

export default function OameniSantierButon({ supabase, proiectId, proiect }) {
  const [stare, setStare] = useState(null)   // { tip: 'lucru' | 'ok' | 'info' | 'eroare', text }
  const generatie = useRef(0)
  const semnal = useRef(null)
  useEffect(() => {
    generatie.current++
    setStare(null)
    return () => { generatie.current++; if (semnal.current) semnal.current.anulat = true }
  }, [proiectId])

  const ruleaza = async () => {
    const g = ++generatie.current
    if (semnal.current) semnal.current.anulat = true
    const s = { anulat: false }
    semnal.current = s
    setStare({ tip: 'lucru', text: 'Se pregătește lista…' })
    try {
      const r = await exportaOameniProiect(supabase, proiectId, undefined, s)
      if (g !== generatie.current || s.anulat) return
      if (r.faraSantiere) { setStare({ tip: 'info', text: 'Proiectul nu are șantiere legate în ERP.' }); return }
      if (!r.nrOameni) { setStare({ tip: 'info', text: 'Niciun om activ pe șantierele proiectului (alocat sau pontat ultima dată acolo).' }); return }
      descarca(r.bytes, r.numeFisier)
      setStare({ tip: 'ok', text: `✓ ${r.nrOameni} ${r.nrOameni === 1 ? 'om' : 'oameni'}, ${r.nrFoi} ${r.nrFoi === 1 ? 'șantier' : 'șantiere'}` })
    } catch (e) {
      if (g !== generatie.current || s.anulat || e instanceof ExportAnulat) return
      setStare({ tip: 'eroare', text: 'Exportul nu s-a putut face: ' + (e?.message || String(e)) })
    }
  }

  if (!proiect || String(proiect.id) !== String(proiectId)) return null
  const lucreaza = stare?.tip === 'lucru'
  const culoare = { lucru: C.muted, ok: C.green, info: C.yellow, eroare: C.red }[stare?.tip] || C.muted
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <button onClick={ruleaza} disabled={lucreaza} data-oameni-santier-excel
        title="Oamenii activi ai proiectului: alocați pe șantierele lui sau pontați ultima dată acolo. Fără date personale."
        style={{ background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 6, color: lucreaza ? C.muted : C.blue,
          cursor: lucreaza ? 'wait' : 'pointer', fontSize: 12, padding: '4px 10px', flexShrink: 0 }}>
        👷 Oameni pe șantier → Excel
      </button>
      {stare && <span role={stare.tip === 'eroare' ? 'alert' : 'status'} style={{ fontSize: 11, color: culoare, maxWidth: 420 }}>{stare.text}</span>}
    </div>
  )
}
