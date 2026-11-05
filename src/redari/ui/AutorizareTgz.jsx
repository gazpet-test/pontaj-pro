/* AutorizareTgz.jsx — Redări #939: autorizarea scrisă Transgaz (art. 28 alin. (2) GDPR) pe proiect.
   Decizia Răzvan 05.11.2026: nr. + dată + PDF încărcate de OWNER deblochează automat informarea GDPR (pagina publică a informării
   + versoul convocatorului). Fără document nu există deblocare manuală. BD-ul impune același lucru (20261130m, trg_red_autorizare_tgz):
   doar owner-ul schimbă câmpurile, iar PDF-ul trebuie să existe în bucket-ul `redari`, sub codul proiectului. Ceilalți văd doar starea. */
import React, { useState, useRef } from 'react'
import { supabase } from '../../lib/supabase.js'
import { G, S, msgEroare } from './comune.jsx'
import { autorizareTgzCompleta } from '../informareGdpr.js'

const COL = 'id, cod, versiune, autorizare_tgz_nr, autorizare_tgz_data, autorizare_tgz_fisier, autorizare_tgz_la'
const MAX_PDF = 15 * 1024 * 1024
// numele fișierului în storage: doar [A-Za-z0-9_.-], ca CHECK-ul din 20261130m
export const caleAutorizare = (cod, numeFisier, acum = Date.now()) => {
  const baza = String(numeFisier || 'autorizare').replace(/\.pdf$/i, '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'autorizare'
  return `${cod}/autorizare_tgz/${acum}_${baza}.pdf`
}

export default function AutorizareTgz({ proiect, esteOwner, show, onSchimbat }) {
  const [nr, setNr] = useState(proiect.autorizare_tgz_nr || '')
  const [data, setData] = useState(proiect.autorizare_tgz_data || '')
  const [fisier, setFisier] = useState(null)
  const [lucru, setLucru] = useState(false)
  const ocupat = useRef(false)
  const completa = autorizareTgzCompleta(proiect)
  const areColoane = 'autorizare_tgz_fisier' in proiect

  const deschide = async () => {
    const { data: u, error } = await supabase.storage.from('redari').createSignedUrl(proiect.autorizare_tgz_fisier, 120)
    if (error) { show('PDF-ul autorizării: ' + msgEroare(error), 'error'); return }
    window.open(u.signedUrl, '_blank', 'noopener')
  }

  const salveaza = async () => {
    if (!esteOwner || ocupat.current) return
    const nrT = nr.trim()
    if (!nrT || !data) { show('Completează numărul și data autorizării.', 'error'); return }
    if (!fisier && !proiect.autorizare_tgz_fisier) { show('Încarcă PDF-ul autorizării.', 'error'); return }
    if (fisier && (fisier.type !== 'application/pdf' && !/\.pdf$/i.test(fisier.name))) { show('Autorizarea se încarcă doar ca PDF.', 'error'); return }
    if (fisier && fisier.size > MAX_PDF) { show('PDF-ul are peste 15 MB.', 'error'); return }
    if (!window.confirm(`Salvezi autorizarea Transgaz nr. ${nrT} din ${data}?\n\nCu nr. + dată + PDF, informarea GDPR a proiectului ${proiect.cod} devine PUBLICATĂ: pagina publică pierde banda „PROIECT”, iar convocatoarele se pot genera pentru expediere.`)) return
    ocupat.current = true; setLucru(true)
    try {
      let cale = proiect.autorizare_tgz_fisier
      if (fisier) {
        cale = caleAutorizare(proiect.cod, fisier.name)
        const { error: eu } = await supabase.storage.from('redari').upload(cale, fisier, { upsert: false, contentType: 'application/pdf' })
        if (eu) throw eu
      }
      const { data: acum, error: ea } = await supabase.from('red_proiecte').select(COL).eq('id', proiect.id).maybeSingle()
      if (ea) throw ea
      if (!acum) throw new Error('Proiectul nu mai e vizibil')
      const { data: rez, error } = await supabase.from('red_proiecte')
        .update({ autorizare_tgz_nr: nrT, autorizare_tgz_data: data, autorizare_tgz_fisier: cale })
        .eq('id', proiect.id).eq('versiune', acum.versiune).select(COL)
      if (error) throw error
      if (!rez?.length) throw new Error('Proiectul a fost modificat între timp; reîncarcă pagina și reîncearcă')
      setFisier(null)
      show('Autorizarea Transgaz e salvată. Informarea GDPR e publicată.', 'success')
      onSchimbat?.()
    } catch (e) { show('Autorizarea Transgaz: ' + msgEroare(e), 'error') }
    finally { ocupat.current = false; setLucru(false) }
  }

  return (
    <div style={{ ...S.card, marginTop: 12 }}>
      <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 4px' }}>Autorizare Transgaz (art. 28 GDPR)</h3>
      <p style={{ color: G.muted, margin: '0 0 10px', fontSize: 12.5 }}>
        Acordul scris al Transgaz pentru furnizorii care primesc datele (SMSLink, curier, găzduirea aplicației). Cu nr. + dată + PDF,
        informarea GDPR se publică automat (pagina publică și versoul convocatorului). Doar owner-ul o completează.
      </p>
      {!areColoane && <div style={{ color: G.yellow, fontSize: 12.5, marginBottom: 8 }}>Câmpurile autorizării nu există încă în baza de date (migrarea 20261130m neaplicată).</div>}
      <div style={{ fontSize: 13, marginBottom: 10, color: completa ? G.green : G.yellow }}>
        {completa ? `✓ Informarea GDPR e publicată — autorizarea nr. ${proiect.autorizare_tgz_nr} din ${proiect.autorizare_tgz_data}` : '⏳ Informarea GDPR NU e publicată: lipsește autorizarea Transgaz (nr. + dată + PDF)'}
        {completa && <button style={{ ...S.btnS, marginLeft: 8 }} onClick={deschide}>📄 Deschide PDF</button>}
      </div>
      {esteOwner && areColoane && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ fontSize: 12.5 }}>Nr. autorizare<br /><input style={S.input} value={nr} disabled={lucru} maxLength={100} onChange={e => setNr(e.target.value)} /></label>
          <label style={{ fontSize: 12.5 }}>Data<br /><input type="date" style={S.input} value={data || ''} disabled={lucru} onChange={e => setData(e.target.value)} /></label>
          <label style={{ fontSize: 12.5 }}>PDF{proiect.autorizare_tgz_fisier ? ' (înlocuiește)' : ''}<br />
            <input type="file" accept="application/pdf,.pdf" disabled={lucru} onChange={e => setFisier(e.target.files?.[0] || null)} style={{ ...S.input, padding: 5 }} /></label>
          <button style={S.btnP} disabled={lucru} onClick={salveaza}>{lucru ? 'Se salvează…' : 'Salvează autorizarea'}</button>
        </div>
      )}
    </div>
  )
}
