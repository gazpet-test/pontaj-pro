import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { G, btnMic, fmtData } from './ctcUi.jsx'
import { construiesteIzometrii } from './ctcIzometrii.js'

// Izometriile generate în Execuție → Izometrie (export Centralizator Transgaz + PDF aprobat), DOAR citire.
// Generarea/ștergerea rămân la managerul de proiect, în Execuție. Fișierele se descarcă direct din
// bucket-ul executie-pachete-pdf (fără copii); se văd toate reviziile, cea mai nouă prima.
export default function CtcIzometriiProiect({ proiectId }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [eroare, setEroare] = useState('')
  const [busy, setBusy] = useState(null)
  const [toate, setToate] = useState(false)   // false = doar ultima revizie pe document
  const activ = useRef(true)

  useEffect(() => {
    let anulat = false
    activ.current = true
    ;(async () => {
      try {
        const [rP, rT] = await Promise.all([
          supabase.from('executie_pachete_lansare').select('id, tronson_id, numar_document, cod_document_full, revizie, status, aprobat_la')
            .eq('proiect_id', proiectId).order('id'),
          supabase.from('executie_tronsoane').select('id, cod, denumire').eq('proiect_id', proiectId),
        ])
        if (rP.error) throw rP.error
        const pachete = rP.data || []
        let docs = []
        if (pachete.length) {
          const { data, error } = await supabase.from('executie_pachete_documente')
            .select('id, pachet_id, tip_document, fisier_nume, fisier_path, uploadat_la')
            .in('pachet_id', pachete.map(p => p.id)).order('id', { ascending: false })
          if (error) throw error
          docs = data || []
        }
        if (!anulat) setRows(construiesteIzometrii(docs, pachete, rT.data || []))
      } catch (e) {
        if (!anulat) setEroare(e.message || 'Izometriile nu au putut fi încărcate.')
      } finally {
        if (!anulat) setLoading(false)
      }
    })()
    return () => { anulat = true; activ.current = false }
  }, [proiectId])

  const descarca = async (r) => {
    setBusy(r.id); setEroare('')
    const { data, error } = await supabase.storage.from('executie-pachete-pdf')
      .createSignedUrl(r.fisier_path, 120, { download: r.fisier_nume || true })
    if (!activ.current) return
    setBusy(null)
    if (error || !data?.signedUrl) { setEroare(`${r.fisier_nume}: ${error?.message || 'fișierul nu poate fi descărcat.'}`); return }
    window.open(data.signedUrl, '_blank', 'noopener')
  }

  const vizibile = toate ? rows : rows.filter(r => r.ultima)
  const ascunse = rows.length - rows.filter(r => r.ultima).length

  return (
    <section style={{ background: G.surface, border: `1px solid ${G.border}`, borderRadius: 12, padding: 16, marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <h3 style={{ margin: 0, color: G.ctc }}>📐 Izometrii generate</h3>
        <small style={{ color: G.muted }}>din Execuție → Izometrie · doar citire</small>
        {ascunse > 0 && (
          <button onClick={() => setToate(v => !v)} style={{ ...btnMic(G.muted), marginLeft: 'auto' }}>
            {toate ? 'Doar ultima revizie' : `Toate reviziile (+${ascunse})`}
          </button>
        )}
      </div>
      {loading && <div style={{ color: G.muted }}>Se încarcă izometriile...</div>}
      {eroare && <div role="alert" style={{ color: G.red }}>{eroare}</div>}
      {!loading && !eroare && !rows.length && <div style={{ color: G.muted }}>Nicio izometrie generată pe acest proiect.</div>}
      {vizibile.map(r => (
        <div key={r.id} style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', padding: '8px 0', borderTop: `1px solid ${G.border}`, opacity: r.ultima ? 1 : 0.7 }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <b>{r.fisier_nume}</b>
            <div>{r.cod} · rev{r.revizie} · {r.tronson}</div>
            <small style={{ color: G.muted }}>
              {fmtData(r.uploadat_la)} · {r.tip_document === 'pdf_aprobare_transgaz' ? 'PDF aprobare Transgaz' : 'Centralizator'}
              {!r.ultima && ' · revizie/variantă mai veche'}
            </small>
          </div>
          <span style={{ fontSize: 11, fontWeight: 700, borderRadius: 10, padding: '2px 9px', color: r.aprobat ? G.green : G.yellow, background: (r.aprobat ? G.green : G.yellow) + '22' }}>
            {r.aprobat ? '✅ Aprobat' : '📝 Ciornă'}
          </span>
          <button disabled={busy !== null} onClick={() => descarca(r)} style={btnMic(G.blue)}>
            {busy === r.id ? 'Se descarcă...' : '⬇ Descarcă'}
          </button>
        </div>
      ))}
    </section>
  )
}
