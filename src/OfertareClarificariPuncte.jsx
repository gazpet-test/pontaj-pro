// ════════════════════════════════════════════════════════════════
// OfertareClarificariPuncte.jsx — Audit Ofertare R05 (28.09.2026)
//
// O clarificare are PUNCTE. Fiecare punct: cerința atinsă (relație explicită), răspunsul
// autorității și REZOLUȚIA, separată de „am primit răspuns" (deschis / rezolvat / parțial /
// nerezolvat), cu documentul care a rezolvat efectiv problema. Scenariul auditului: autoritatea
// răspunde la 2 din 3 puncte sau trimite ulterior o planșă — acum se vede exact ce rămâne deschis.
// Tabel: ofertare_clarificari_puncte (RLS: citire autentificați, scriere cu modulul Ofertare).
// ════════════════════════════════════════════════════════════════
import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase.js'

const G = { bg:'#0D1117', surface:'#161B22', border2:'#21262D', text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  green:'#3FB950', orange:'#F0883E', yellow:'#E3B341', red:'#F85149', blue:'#58A6FF' }
const inp = { background:G.bg, border:`1px solid ${G.border2}`, borderRadius:6, padding:'4px 8px', color:G.text, fontSize:11.5, outline:'none' }
const btn = { padding:'3px 10px', background:G.surface, color:G.text, border:`1px solid ${G.border2}`, borderRadius:6, cursor:'pointer', fontSize:11.5 }
export const REZOLUTII = { deschis: ['● deschis', G.yellow], partial: ['◐ parțial', G.orange], rezolvat: ['✔ rezolvat', G.green], nerezolvat: ['✖ nerezolvat', G.red] }

/** Rezumatul rezoluției unei clarificări: câte puncte, câte închise, dacă mai e ceva deschis. Pur, testabil. */
export function rezumatPuncte(puncte = []) {
  const n = puncte.length
  const rez = puncte.filter(p => p.rezolutie === 'rezolvat').length
  const deschise = puncte.filter(p => p.rezolutie === 'deschis' || p.rezolutie === 'partial').length
  const nerez = puncte.filter(p => p.rezolutie === 'nerezolvat').length
  return { n, rezolvate: rez, deschise, nerezolvate: nerez, inchisa: n > 0 && deschise === 0 }
}

export default function PuncteClarificare({ clarificareId, documente = [], showToast }) {
  const [puncte, setPuncte] = useState([])
  const [nou, setNou] = useState('')
  const [busy, setBusy] = useState(false)
  const load = async () => {
    const { data, error } = await supabase.from('ofertare_clarificari_puncte').select('*').eq('clarificare_id', clarificareId).order('nr')
    if (error) { showToast?.('Punctele nu s-au putut citi: ' + error.message, 'err'); return }
    setPuncte(data || [])
  }
  useEffect(() => { load() }, [clarificareId])

  const adauga = async () => {
    const t = nou.trim(); if (!t) return
    setBusy(true)
    const nr = (puncte.reduce((m, p) => Math.max(m, p.nr), 0) || 0) + 1
    const { error } = await supabase.from('ofertare_clarificari_puncte').insert({ clarificare_id: clarificareId, nr, text: t })
    setBusy(false)
    if (error) { showToast?.('Punctul nu s-a salvat: ' + error.message, 'err'); return }
    setNou(''); load()
  }
  const salveaza = async (p, patch) => {
    setBusy(true)
    const { error } = await supabase.from('ofertare_clarificari_puncte').update(patch).eq('id', p.id)
    setBusy(false)
    if (error) { showToast?.('Nu s-a salvat: ' + error.message, 'err'); return }
    load()
  }

  const r = rezumatPuncte(puncte)
  return (
    <div style={{ marginTop:6, padding:'6px 8px', borderRadius:6, border:`1px dashed ${G.border2}` }}>
      <div style={{ fontSize:11, color:G.muted, marginBottom:4 }}>
        Puncte ({r.n}) · rezoluție: <b style={{ color: r.inchisa ? G.green : r.n ? G.orange : G.dim }}>
          {r.n ? `${r.rezolvate} rezolvate · ${r.deschise} deschise${r.nerezolvate ? ` · ${r.nerezolvate} nerezolvate` : ''}` : 'fără puncte — răspunsul nu spune ce s-a rezolvat'}</b>
      </div>
      {puncte.map(p => (
        <div key={p.id} style={{ display:'flex', gap:6, alignItems:'center', flexWrap:'wrap', fontSize:11.5, padding:'3px 0', borderTop:`1px solid ${G.border2}` }}>
          <b style={{ color:G.dim }}>{p.nr}.</b>
          <span style={{ color:G.text, flex:'1 1 220px' }}>{p.text}</span>
          <input style={{ ...inp, width:80 }} placeholder="cerința #" defaultValue={p.cerinta_id || ''}
            onBlur={e => { const v = e.target.value ? Number(e.target.value) : null; if (v !== p.cerinta_id) salveaza(p, { cerinta_id: v }) }} />
          <select style={inp} value={p.rezolutie} disabled={busy} onChange={e => salveaza(p, { rezolutie: e.target.value })}>
            {Object.entries(REZOLUTII).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <select style={{ ...inp, maxWidth:220 }} value={p.document_rezolutie_id || ''} disabled={busy}
            title="Documentul care a rezolvat efectiv punctul (poate fi altul decât răspunsul la clarificare)"
            onChange={e => salveaza(p, { document_rezolutie_id: e.target.value ? Number(e.target.value) : null })}>
            <option value="">— document rezolvare —</option>
            {documente.map(d => <option key={d.id} value={d.id}>{d.nume_original}</option>)}
          </select>
          <span style={{ color: REZOLUTII[p.rezolutie]?.[1] || G.dim }}>{p.rezolvat_la ? new Date(p.rezolvat_la).toLocaleDateString('ro-RO') : ''}</span>
        </div>
      ))}
      <div style={{ display:'flex', gap:6, marginTop:4 }}>
        <input style={{ ...inp, flex:1 }} value={nou} placeholder="Adaugă un punct al întrebării…" onChange={e => setNou(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') adauga() }} />
        <button style={btn} disabled={busy || !nou.trim()} onClick={adauga}>+ punct</button>
      </div>
    </div>
  )
}
