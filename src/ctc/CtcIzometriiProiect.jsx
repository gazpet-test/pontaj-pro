import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { G, btnMic, fmtData } from './ctcUi.jsx'
import { construiesteIzometrii, descarcaIzometrie } from './ctcIzometrii.js'

// Izometriile generate în Execuție → Izometrie (export Centralizator Transgaz + PDF aprobat), DOAR citire.
// Generarea/ștergerea rămân la managerul de proiect, în Execuție. Fișierele se descarcă direct din
// bucket-ul executie-pachete-pdf (fără copii); se văd toate reviziile, cea mai nouă prima.
// Exportul IZO livrat în fișiere separate (> 50 MB) se descarcă întreg, ca în istoricul din Izometrie: ZIP făcut pe calculator.
export default function CtcIzometriiProiect({ proiectId }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [eroare, setEroare] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(null)
  const [toate, setToate] = useState(false)   // false = doar ultima revizie pe document
  const gen = useRef(0)   // generația: alt proiect / demontarea invalidează o descărcare în curs (L24)
  const oprire = useRef(null)   // AbortController-ul descărcării în curs: oprit la demontare / alt proiect (nu mai transferă)

  useEffect(() => {
    let anulat = false
    const g = ++gen.current
    setBusy(null); setInfo('')
    ;(async () => {
      try {
        const [rP, rT] = await Promise.all([
          supabase.from('executie_pachete_lansare').select('id, tronson_id, numar_document, cod_document_full, revizie, status, aprobat_la')
            .eq('proiect_id', proiectId).order('id'),
          supabase.from('executie_tronsoane').select('id, cod, denumire').eq('proiect_id', proiectId),
        ])
        if (rP.error) throw rP.error
        if (rT.error) throw rT.error
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
    return () => {
      anulat = true
      if (gen.current === g) gen.current++
      oprire.current?.abort(); oprire.current = null
    }
  }, [proiectId])

  const descarca = async (r) => {
    const g = gen.current
    const c = new AbortController()
    oprire.current?.abort(); oprire.current = c
    setBusy(r.id); setEroare(''); setInfo('')
    const res = await descarcaIzometrie(supabase, r, proiectId, undefined, c.signal)
    if (g !== gen.current || c.signal.aborted) return
    oprire.current = null
    setBusy(null)
    if (!res.ok) { setEroare(`${r.fisier_nume}: ${res.eroare}`); return }
    if (res.url) { window.open(res.url, '_blank', 'noopener'); return }
    // livrare separată: toate fișierele exportului, puse în ZIP pe calculator
    const url = URL.createObjectURL(new Blob([res.bytes], { type: 'application/zip' }))
    const a = document.createElement('a')
    a.href = url
    a.download = res.nume
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    setInfo(`✓ ${res.nume} (${res.numar} fișiere de pe server, puse într-o arhivă)`)
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
      {info && <div role="status" style={{ color: G.green }}>{info}</div>}
      {!loading && !eroare && !rows.length && <div style={{ color: G.muted }}>Nicio izometrie generată pe acest proiect.</div>}
      {vizibile.map(r => (
        <div key={r.id} style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', padding: '8px 0', borderTop: `1px solid ${G.border}`, opacity: r.ultima ? 1 : 0.7 }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <b>{r.fisier_nume}</b>
            <div>{r.cod} · rev{r.revizie} · {r.tronson}</div>
            <small style={{ color: G.muted }}>
              {fmtData(r.uploadat_la)} · {r.tip_document === 'pdf_aprobare_transgaz' ? 'PDF aprobare Transgaz' : 'Centralizator'}
              {r.separat && ' · + PDF-urile în fișiere separate (Descarcă le pune într-o arhivă)'}
              {!r.ultima && ' · revizie/variantă mai veche'}
            </small>
          </div>
          <span style={{ fontSize: 11, fontWeight: 700, borderRadius: 10, padding: '2px 9px', color: r.aprobat ? G.green : G.yellow, background: (r.aprobat ? G.green : G.yellow) + '22' }}>
            {r.aprobat ? '✅ Aprobat' : '📝 Ciornă'}
          </span>
          <button disabled={busy !== null} onClick={() => descarca(r)} style={btnMic(G.blue)}>
            {busy === r.id ? 'Se descarcă...' : r.separat ? '⬇ Descarcă (ZIP)' : '⬇ Descarcă'}
          </button>
        </div>
      ))}
    </section>
  )
}
