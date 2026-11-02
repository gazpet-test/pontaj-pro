/* SetariProiect.jsx — Redări faza 2, felia 1: datele proiectului care intră în convocator / adresa UAT / PV (contract, împuternicire,
   reprezentanți, contact, texte GDPR + declarație). Scrie doar admin (RLS red_proiecte_upd = admin); ceilalți văd în citire.
   Textele GDPR / declarație sunt confirmate de Proiectul Juridic (01.11.2026) — schimbarea lor cere confirmare explicită. */
import React, { useState } from 'react'
import { supabase } from '../../lib/supabase.js'
import { G, S, msgEroare, motivBlocareConvocator } from './comune.jsx'
import { CAMPURI_PROIECT, COL_PROIECT, normalizeaza, cheiSchimbate, valideazaProiect } from '../setari.js'
import FormularCampuri from './FormularCampuri.jsx'

export default function SetariProiect({ proiect, nivel, show, onSchimbat }) {
  const esteAdmin = nivel === 'admin'
  const [form, setForm] = useState(() => ({ ...proiect }))
  const [lucru, setLucru] = useState(false)
  const [erori, setErori] = useState([])
  const schimbate = cheiSchimbate(proiect, form, CAMPURI_PROIECT)
  // ce lipsește la nivel de proiect pentru convocator (UAT-ul fictiv „complet” izolează doar cerințele proiectului)
  const lipsaProiect = motivBlocareConvocator(proiect, { sesiune_zi1: 'x', program_zi1: 'x' }, null)

  const salveaza = async () => {
    const e = valideazaProiect(form)
    setErori(e)
    if (e.length) return
    if (!schimbate.length) { show('Nimic de salvat.', 'info'); return }
    const sensibile = CAMPURI_PROIECT.filter(c => c.sensibil && schimbate.includes(c.cheie)).map(c => c.eticheta)
    if (sensibile.length && !window.confirm(
      `Schimbi ${sensibile.join(' și ')}.\nTextele actuale sunt cele confirmate de Juridic și apar în convocatoare și în formularul public.\n\nContinui?`)) return
    const tot = normalizeaza(form, CAMPURI_PROIECT)
    const patch = Object.fromEntries(schimbate.map(k => [k, tot[k]]))
    setLucru(true)
    try {
      const { data, error } = await supabase.from('red_proiecte').update(patch).eq('id', proiect.id).select(COL_PROIECT)
      if (error) throw error
      if (!data?.length) throw new Error('Modificarea nu s-a salvat (fără drept de administrator pe modul?)')
      show('Setările proiectului au fost salvate.', 'success')
      onSchimbat()
    } catch (err) { show('Salvare proiect: ' + msgEroare(err), 'error') }
    finally { setLucru(false) }
  }

  return (
    <div style={{ maxWidth: 980 }}>
      <div style={{ ...S.card, marginBottom: 12, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div><span style={{ color: G.muted, fontSize: 12 }}>Cod proiect</span><div style={{ ...S.mono }}>{proiect.cod}</div></div>
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 12.5, color: lipsaProiect ? G.yellow : G.green }}>
          {lipsaProiect ? `Pentru convocări lipsește: ${lipsaProiect}` : '✓ Proiectul are tot ce cere convocatorul'}
        </div>
      </div>
      {!esteAdmin && <div style={{ fontSize: 12.5, color: G.muted, marginBottom: 10 }}>Doar administratorul modifică setările proiectului.</div>}
      <div style={S.card}>
        <FormularCampuri campuri={CAMPURI_PROIECT} form={form} doarCitire={!esteAdmin} schimbate={schimbate}
          onChange={(k, v) => setForm(f => ({ ...f, [k]: v }))} />
        {erori.length > 0 && (
          <div style={{ marginTop: 12, padding: 10, borderRadius: 7, background: G.redDim, color: G.red, fontSize: 12.5 }}>
            {erori.map(e => <div key={e}>• {e}</div>)}
          </div>
        )}
        {esteAdmin && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
            <button onClick={() => { setForm({ ...proiect }); setErori([]) }} disabled={!schimbate.length || lucru} style={S.btnS}>Anulează modificările</button>
            <button onClick={salveaza} disabled={lucru || !schimbate.length} style={{ ...S.btnP, opacity: lucru || !schimbate.length ? 0.6 : 1 }}>
              {lucru ? 'Se salvează…' : `Salvează${schimbate.length ? ` (${schimbate.length})` : ''}`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
