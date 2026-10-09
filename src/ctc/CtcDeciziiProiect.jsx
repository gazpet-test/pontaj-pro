import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { G, btnMic, fmtData } from './ctcUi.jsx'

// Deciziile HR emise pe proiect (read-only) — autorul cărții tehnice ia direct PDF-ul și scanul semnat.
// Dreptul vine din fn_hr_decizii_poate (citire_doc / citire_scan, ramura CTC, migrarea 20261023a).
export default function CtcDeciziiProiect({ proiectId }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [eroare, setEroare] = useState('')
  const [busy, setBusy] = useState(null)
  const activ = useRef(false)
  const ferestre = useRef(new Set())

  useEffect(() => {
    let anulat = false
    activ.current = true
    ;(async () => {
      try {
        const rezultat = []
        // Pagini explicite: nu trunchiem tacit la limita PostgREST.
        for (let deLa = 0; ; deLa += 100) {
          const { data, error } = await supabase.from('hr_decizii')
            .select('id,serie,an,numar,numar_sufix,data_emitere,tip_cod,eticheta_functie,persoana_nume,stare,pdf_path,scan_path')
            .eq('proiect_id', proiectId).eq('nivel', 'proiect')
            .neq('stare', 'draft').neq('tip_cod', 'ALTA_DECIZIE')
            .order('id', { ascending: false }).range(deLa, deLa + 99)
          if (anulat) return
          if (error) throw error
          rezultat.push(...(data || []))
          if (!data || data.length < 100) break
        }
        if (!anulat) setRows(rezultat)
      } catch (e) {
        if (!anulat) setEroare(e.message || 'Deciziile nu au putut fi încărcate.')
      } finally {
        if (!anulat) setLoading(false)
      }
    })()
    return () => {
      anulat = true
      activ.current = false
      for (const f of ferestre.current) f.close()
      ferestre.current.clear()
    }
  }, [proiectId])

  const deschide = async (d, camp) => {
    // Deschiderea sincronă evită blocarea popup-ului după await.
    const f = window.open('about:blank', '_blank')
    if (!f) { setEroare('Permite deschiderea unei file noi pentru document.'); return }
    f.opener = null
    ferestre.current.add(f)
    setBusy(d.id + ':' + camp)
    setEroare('')
    try {
      const { data, error } = await supabase.storage.from('hr-decizii')
        .createSignedUrl(d[camp], 120)
      if (!activ.current || f.closed) return
      if (error) throw error
      if (!data?.signedUrl) throw new Error('URL-ul documentului lipsește.')
      f.location.replace(data.signedUrl)
    } catch (e) {
      f.close()
      if (activ.current) setEroare(e.message || 'Documentul nu poate fi deschis.')
    } finally {
      ferestre.current.delete(f)
      if (activ.current) setBusy(null)
    }
  }

  return (
    <section style={{ background: G.surface, border: `1px solid ${G.border}`, borderRadius: 12, padding: 16, marginBottom: 14 }}>
      <h3 style={{ margin: '0 0 12px', color: G.ctc }}>📜 Decizii pe proiect</h3>
      {loading && <div style={{ color: G.muted }}>Se încarcă deciziile...</div>}
      {eroare && <div role="alert" style={{ color: G.red }}>{eroare}</div>}
      {!loading && !eroare && !rows.length && <div style={{ color: G.muted }}>Nicio decizie emisă pe acest proiect.</div>}
      {rows.map(d => (
        <div key={d.id} style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', padding: '8px 0', borderTop: `1px solid ${G.border}` }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <b>{d.numar}{d.numar_sufix ? '-' + d.numar_sufix : ''}/{d.an} · {d.serie}</b>
            <div>{d.eticheta_functie || d.tip_cod} · {d.persoana_nume || '—'}</div>
            <small style={{ color: G.muted }}>{fmtData(d.data_emitere)} · {d.stare}</small>
          </div>
          {[['pdf_path', 'PDF'], ['scan_path', 'Scan semnat']].map(([camp, label]) => (
            <button key={camp} disabled={!d[camp] || busy !== null}
              onClick={() => deschide(d, camp)} style={btnMic(G.blue)}>
              {busy === d.id + ':' + camp ? 'Se deschide...' : label + (d[camp] ? '' : ' — lipsă')}
            </button>
          ))}
        </div>
      ))}
    </section>
  )
}
