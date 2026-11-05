/* AutorizareTgz.jsx — Redări #939: autorizarea scrisă Transgaz (art. 28 alin. (2) GDPR) pe proiect.
   Decizia Răzvan 05.11.2026: nr. + dată + PDF încărcate de OWNER deblochează automat informarea GDPR (pagina publică a informării
   + versoul convocatorului). Fără document nu există deblocare manuală. BD-ul impune același lucru (20261130m, trg_red_autorizare_tgz):
   doar owner-ul schimbă câmpurile, iar PDF-ul trebuie urcat de el, în bucket-ul `redari`, sub codul proiectului (legat prin id).
   Starea „publicată” o dă serverul (fn_red_informare_publicata). Ceilalți văd doar starea. */
import React, { useState, useRef, useEffect } from 'react'
import { supabase } from '../../lib/supabase.js'
import { G, S, msgEroare } from './comune.jsx'
import { informarePublicataServer } from '../informareGdpr.js'

const COL = 'id, cod, versiune, autorizare_tgz_nr, autorizare_tgz_data, autorizare_tgz_fisier, autorizare_tgz_la'
const CAMPURI = ['autorizare_tgz_nr', 'autorizare_tgz_data', 'autorizare_tgz_fisier']
const MAX_PDF = 15 * 1024 * 1024
// numele fișierului în storage: doar [A-Za-z0-9_.-], ca CHECK-ul din 20261130m
export const caleAutorizare = (cod, numeFisier, acum = Date.now()) => {
  const baza = String(numeFisier || 'autorizare').replace(/\.pdf$/i, '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'autorizare'
  return `${cod}/autorizare_tgz/${acum}_${baza}.pdf`
}
// r2 (Jakarinos P2-4 / Copilot P2-03): rândul din BD trebuie să fie exact cel pe care l-a văzut formularul (versiune + cele trei câmpuri)
export const autorizareSchimbata = (baza, acum) => !acum || acum.versiune !== baza.versiune || CAMPURI.some(k => (acum[k] ?? null) !== (baza[k] ?? null))

export default function AutorizareTgz({ proiect, esteOwner, show, onSchimbat }) {
  const [nr, setNr] = useState(proiect.autorizare_tgz_nr || '')
  const [data, setData] = useState(proiect.autorizare_tgz_data || '')
  const [fisier, setFisier] = useState(null)
  const [lucru, setLucru] = useState(false)
  const [publicata, setPublicata] = useState(undefined)   // undefined = se verifică; null = verificarea a eșuat
  const ocupat = useRef(false)
  const baza = useRef({ versiune: proiect.versiune, ...Object.fromEntries(CAMPURI.map(k => [k, proiect[k] ?? null])) })
  const areColoane = 'autorizare_tgz_fisier' in proiect

  // la reîncărcarea proiectului: formularul și baza CAS se resincronizează; starea „publicată” se cere din nou serverului
  useEffect(() => {
    baza.current = { versiune: proiect.versiune, ...Object.fromEntries(CAMPURI.map(k => [k, proiect[k] ?? null])) }
    setNr(proiect.autorizare_tgz_nr || ''); setData(proiect.autorizare_tgz_data || ''); setFisier(null)
    let viu = true
    setPublicata(undefined)
    informarePublicataServer(supabase, proiect.cod).then(v => { if (viu) setPublicata(v) })
    return () => { viu = false }
  }, [proiect.id, proiect.cod, proiect.versiune, proiect.autorizare_tgz_nr, proiect.autorizare_tgz_data, proiect.autorizare_tgz_fisier])

  const deschide = async () => {
    if (!esteOwner) return
    const { data: u, error } = await supabase.storage.from('redari').createSignedUrl(proiect.autorizare_tgz_fisier, 120)
    if (error) { show('PDF-ul autorizării: ' + msgEroare(error), 'error'); return }
    window.open(u.signedUrl, '_blank', 'noopener')
  }

  const salveaza = async () => {
    if (!esteOwner || ocupat.current) return
    // r3 (Jakarinos r2 P2-1): baza CAS se fixează la începutul salvării; dacă proiectul se reîncarcă între timp (baza.current e alt obiect),
    // salvarea se oprește — numărul, data și fișierul aparțin intenției de la început
    const b = baza.current
    const contextSchimbat = () => baza.current !== b
    const nrT = nr.trim()
    if (!nrT || !data) { show('Completează numărul și data autorizării.', 'error'); return }
    if (!fisier && !b.autorizare_tgz_fisier) { show('Încarcă PDF-ul autorizării.', 'error'); return }
    if (fisier && (fisier.type !== 'application/pdf' && !/\.pdf$/i.test(fisier.name))) { show('Autorizarea se încarcă doar ca PDF.', 'error'); return }
    if (fisier && fisier.size > MAX_PDF) { show('PDF-ul are peste 15 MB.', 'error'); return }
    if (!window.confirm(`Salvezi autorizarea Transgaz nr. ${nrT} din ${data}?\n\nCu nr. + dată + PDF, informarea GDPR a proiectului ${proiect.cod} devine PUBLICATĂ: pagina publică arată informarea, iar convocatoarele se pot genera pentru expediere.`)) return
    ocupat.current = true; setLucru(true)
    try {
      const { data: acum, error: ea } = await supabase.from('red_proiecte').select(COL).eq('id', proiect.id).maybeSingle()
      if (ea) throw ea
      if (contextSchimbat() || autorizareSchimbata(b, acum)) throw new Error('Proiectul sau autorizarea s-au schimbat între timp; reîncarcă pagina și verifică înainte de a salva')
      let cale = b.autorizare_tgz_fisier
      if (fisier) {
        cale = caleAutorizare(proiect.cod, fisier.name)
        const { error: eu } = await supabase.storage.from('redari').upload(cale, fisier, { upsert: false, contentType: 'application/pdf' })
        if (eu) throw eu
        if (contextSchimbat()) throw new Error('Proiectul s-a reîncărcat în timpul salvării; PDF-ul e urcat, dar autorizarea nu e salvată — verifică și salvează din nou')
      }
      // CAS pe versiunea pe care a văzut-o formularul (nu pe una recitită acum)
      const { data: rez, error } = await supabase.from('red_proiecte')
        .update({ autorizare_tgz_nr: nrT, autorizare_tgz_data: data, autorizare_tgz_fisier: cale })
        .eq('id', proiect.id).eq('versiune', b.versiune).select(COL)
      if (error) throw error
      if (!rez?.length) throw new Error('Proiectul a fost modificat între timp; reîncarcă pagina și reîncearcă')
      setFisier(null)
      const pub = await informarePublicataServer(supabase, proiect.cod)
      show(pub === true ? 'Autorizarea Transgaz e salvată. Informarea GDPR e publicată.' : pub === null ? 'Autorizarea e salvată, dar nu am putut verifica publicarea — reîncarcă pagina.' : 'Autorizarea e salvată, dar serverul nu o consideră încă publicată — verifică PDF-ul.', pub === true ? 'success' : 'error')
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
      <div style={{ fontSize: 13, marginBottom: 10, color: publicata ? G.green : G.yellow }}>
        {publicata === undefined ? 'Verific starea informării…'
          : publicata === null ? '⚠️ Nu am putut verifica starea informării pe server (rețea / server) — reîncarcă pagina'
          : publicata ? `✓ Informarea GDPR e publicată — autorizarea nr. ${proiect.autorizare_tgz_nr} din ${proiect.autorizare_tgz_data}`
          : '⏳ Informarea GDPR NU e publicată: lipsește autorizarea Transgaz (nr. + dată + PDF urcat de owner)'}
        {esteOwner && proiect.autorizare_tgz_fisier && <button style={{ ...S.btnS, marginLeft: 8 }} onClick={deschide}>📄 Deschide PDF</button>}
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
