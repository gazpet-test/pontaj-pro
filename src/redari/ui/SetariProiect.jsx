/* SetariProiect.jsx — Redări faza 2, felia 1: datele proiectului care intră în convocator / adresa UAT / PV (contract, împuternicire,
   reprezentanți, contact, texte GDPR + declarație). Scrie doar admin (RLS red_proiecte_upd = admin); ceilalți văd în citire.
   Textele GDPR / declarație sunt confirmate de Proiectul Juridic (01.11.2026) — schimbarea lor cere confirmare explicită. */
import React, { useState } from 'react'
import { supabase } from '../../lib/supabase.js'
import { G, S, msgEroare, motivBlocareConvocator } from './comune.jsx'
import { CAMPURI_PROIECT, COL_PROIECT, normalizeaza, cheiSchimbate, valideazaProiect, conflicteConcurente } from '../setari.js'
import FormularCampuri from './FormularCampuri.jsx'

export default function SetariProiect({ proiect, nivel, show, onSchimbat }) {
  const esteAdmin = nivel === 'admin'
  // Jakarinos f2 r1 P2: modificările se calculează față de BAZA formularului (rândul la deschidere / după propria salvare), nu față de
  // `proiect` reîncărcat — altfel o schimbare făcută între timp de alt admin ar apărea ca „modificare” și ar fi rescrisă cu valoarea veche.
  const [baza, setBaza] = useState(() => ({ ...proiect }))
  const [form, setForm] = useState(() => ({ ...proiect }))
  const [lucru, setLucru] = useState(false)
  const [erori, setErori] = useState([])
  const schimbate = cheiSchimbate(baza, form, CAMPURI_PROIECT)
  // alt admin a salvat între timp: versiunea din părinte e mai nouă decât baza (propria salvare crește baza imediat — Copilot f2 r2 P3)
  const altaVersiune = (proiect.versiune ?? 0) > (baza.versiune ?? 0)
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
      // Copilot f2 r2 P2: citesc rândul de acum; dacă altcineva a schimbat ACELEAȘI câmpuri, întreb; scriu doar pe versiunea verificată
      const { data: acum, error: ea } = await supabase.from('red_proiecte').select(COL_PROIECT).eq('id', proiect.id).maybeSingle()
      if (ea) throw ea
      if (!acum) throw new Error('Proiectul nu mai e vizibil (fără drept pe modul?)')
      if (acum.versiune !== baza.versiune) {
        const conf = conflicteConcurente(baza, acum, schimbate)
        const etichete = conf.map(k => CAMPURI_PROIECT.find(c => c.cheie === k)?.eticheta || k)
        if (conf.length && !window.confirm(`Alt administrator a schimbat între timp: ${etichete.join(', ')}.\nSuprascrii cu valorile tale?`)) return
      }
      const { data, error } = await supabase.from('red_proiecte').update(patch).eq('id', proiect.id).eq('versiune', acum.versiune).select(COL_PROIECT)
      if (error) throw error
      if (!data?.length) throw new Error('Nu s-a salvat: proiectul a fost modificat chiar acum de altcineva sau nu ai drept de administrator. Reîncarcă și reîncearcă.')
      setBaza({ ...data[0] }); setForm({ ...data[0] })
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
      {esteAdmin && altaVersiune && (
        <div style={{ fontSize: 12.5, color: G.yellow, marginBottom: 10 }}>
          Proiectul a fost modificat între timp de altcineva. Salvarea ta scrie doar câmpurile pe care le-ai schimbat tu.{' '}
          <button disabled={lucru} onClick={() => { setBaza({ ...proiect }); setForm(f => ({ ...proiect, ...Object.fromEntries(schimbate.map(k => [k, f[k]])) })) }} style={S.btnX}>Preia versiunea nouă</button>
        </div>
      )}
      <div style={S.card}>
        <FormularCampuri campuri={CAMPURI_PROIECT} form={form} doarCitire={!esteAdmin} blocat={lucru} schimbate={schimbate}
          onChange={(k, v) => { if (!lucru) setForm(f => ({ ...f, [k]: v })) }} />
        {erori.length > 0 && (
          <div style={{ marginTop: 12, padding: 10, borderRadius: 7, background: G.redDim, color: G.red, fontSize: 12.5 }}>
            {erori.map(e => <div key={e}>• {e}</div>)}
          </div>
        )}
        {esteAdmin && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
            <button onClick={() => { setForm({ ...baza }); setErori([]) }} disabled={!schimbate.length || lucru} style={S.btnS}>Anulează modificările</button>
            <button onClick={salveaza} disabled={lucru || !schimbate.length} style={{ ...S.btnP, opacity: lucru || !schimbate.length ? 0.6 : 1 }}>
              {lucru ? 'Se salvează…' : `Salvează${schimbate.length ? ` (${schimbate.length})` : ''}`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
