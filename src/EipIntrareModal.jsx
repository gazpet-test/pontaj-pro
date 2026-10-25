import { useEffect, useRef, useState } from 'react'
import { supabase } from './lib/supabase.js'
import { dataAziBucuresti } from './magazieEipLogica.js'
import { construiesteCerere, validareRepartizare } from './eipIntrareLogica.js'

const PENDING = 'eip_intrare_pending_v1'
const cheiePending = uid => `${PENDING}:${uid}`
// Receptia cu rezultat incert (cheie + payload) supravietuieste inchiderii/refresh-ului, separat pe utilizator: retry identic, fara dublare.
const citestePending = uid => {
  if (!uid) return null
  try {
    const p = JSON.parse(globalThis.localStorage?.getItem(cheiePending(uid)) || 'null')
    return p && typeof p.cheie === 'string' && p.cheie && p.cerere && Array.isArray(p.cerere.p_linii) ? p : null
  } catch { return null }
}
// Fail-closed: RPC-ul porneste doar daca receptia a fost scrisa SI recitita identic.
const salveazaPending = (uid, p) => {
  if (!uid) return false
  try {
    const text = JSON.stringify(p)
    globalThis.localStorage.setItem(cheiePending(uid), text)
    return globalThis.localStorage.getItem(cheiePending(uid)) === text
  } catch { return false }
}
const stergePending = uid => { try { if (uid) globalThis.localStorage?.removeItem(cheiePending(uid)) } catch { /* nimic de sters */ } }

const linieNoua = () => ({ articol: null, cautare: '', cantitate: '', pe_marimi: [{ marime: '', cantitate: '' }] })

// Montarea include butonul, dreptul de scriere si toast-ul; Magazie ramane minimal.
export default function EipIntrareActiune({ G, S, onSuccess }) {
  const [poateScrie, setPoateScrie] = useState(false)
  const [cheie, setCheie] = useState(null)
  const [toast, setToast] = useState('')
  const [pending, setPending] = useState(null)
  const [uid, setUid] = useState(null)
  const uidRef = useRef(null)
  const generatie = useRef(0)
  useEffect(() => {
    let activ = true
    const verifica = async () => {
      // Fiecare verificare are un token: un raspuns vechi (alt utilizator) nu mai poate scrie in stare.
      const gen = ++generatie.current
      const curenta = () => activ && gen === generatie.current
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!curenta()) return
        if (!user) { if (activ) { uidRef.current = null; setUid(null); setPending(null); setCheie(null); setPoateScrie(false) } return }
        if (curenta()) {
          // alt utilizator in acelasi browser: nu preluam receptia si nu pastram modalul celuilalt
          if (uidRef.current && uidRef.current !== user.id) setCheie(null)
          uidRef.current = user.id
          setUid(user.id)
          setPending(citestePending(user.id))
        }
        const { data: p, error } = await supabase.from('profiles')
          .select('is_owner,can_process_achizitii,can_manage_stoc,role').eq('id', user.id).maybeSingle()
        if (curenta()) setPoateScrie(!error && !!(p && (p.is_owner || p.can_process_achizitii || p.can_manage_stoc || p.role === 'admin_logistica')))
      } catch { if (curenta()) setPoateScrie(false) /* Fara profil verificat nu afisam actiunea. */ }
    }
    verifica()
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => { setTimeout(verifica, 0) })
    return () => { activ = false; subscription.unsubscribe() }
  }, [])
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(''), 6000)
    return () => clearTimeout(timer)
  }, [toast])
  return <>
    {poateScrie && <button style={S.btnP} onClick={() => { setToast(''); const p = citestePending(uid); setPending(p); setCheie(p ? p.cheie : crypto.randomUUID()) }}>{pending ? '+ Intrare EIP (una necomfirmata)' : '+ Intrare EIP'}</button>}
    {cheie && <EipIntrareModal key={cheie} cheie={cheie} uid={uid} pending={pending && pending.cheie === cheie ? pending : null} G={G} S={S} onClose={() => { setCheie(null); setPending(citestePending(uid)) }} onSuccess={() => {
      setCheie(null)
      setPending(null)
      setToast('Intrarea EIP a fost salvata.')
      onSuccess()
    }} />}
    {toast && <div role="status" style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 1100, ...S.card, padding: 16, color: G.green }}>{toast}</div>}
  </>
}

export function EipIntrareModal({ cheie, uid, pending = null, G, S, onClose, onSuccess }) {
  const [formular, setFormular] = useState(() => ({ furnizor_cui: '', furnizor_nume: '', factura_nr: '', factura_data: dataAziBucuresti(new Date()), observatii: '', linii: [linieNoua()] }))
  const [catalog, setCatalog] = useState([])
  const [incarca, setIncarca] = useState(true)
  const [eroareCatalog, setEroareCatalog] = useState('')
  const [incercare, setIncercare] = useState(0)
  const [eroare, setEroare] = useState('')
  const [busy, setBusy] = useState(false)
  const [blocat, setBlocat] = useState(() => !!pending)
  const inCurs = useRef(false)
  const cerereTrimisa = useRef(pending?.cerere ?? null)
  useEffect(() => {
    let activ = true
    setIncarca(true)
    setEroareCatalog('')
    const incarcaCatalog = async () => {
      try {
        const { data, error } = await supabase.from('eip_articole').select('id,denumire,tip_marime,um,activ').eq('activ', true).order('denumire')
        if (error) throw error
        if (activ) setCatalog(data || [])
      } catch { if (activ) setEroareCatalog('Catalogul EIP nu a putut fi incarcat. Reincearca.') }
      finally { if (activ) setIncarca(false) }
    }
    incarcaCatalog()
    return () => { activ = false }
  }, [incercare])
  const schimba = (camp, valoare) => setFormular(f => ({ ...f, [camp]: valoare }))
  const schimbaLinie = (index, valori) => setFormular(f => ({ ...f, linii: f.linii.map((l, i) => i === index ? { ...l, ...valori } : l) }))
  let cerere, validare = ''
  try { cerere = construiesteCerere(formular, cheie) } catch (e) { validare = e.message }
  const salveaza = async e => {
    e.preventDefault()
    if (inCurs.current || (!pending && (!cerere || incarca || eroareCatalog))) return
    inCurs.current = true
    setBusy(true)
    setEroare('')
    const elibereaza = mesaj => { inCurs.current = false; setBusy(false); setEroare(mesaj) }
    // Identitatea se reverifica chiar inainte de trimitere: payload-ul unui utilizator nu pleaca sub sesiunea altuia.
    let curent = null
    try { const { data } = await supabase.auth.getUser(); curent = data?.user?.id ?? null } catch { curent = null }
    if (!uid || curent !== uid) return elibereaza('Sesiunea s-a schimbat sau nu poate fi verificata, deci nu trimit receptia. Datele au fost pastrate; autentifica-te cu utilizatorul care a inceput receptia.')
    // Pastram si payload-ul dupa rezultat incert, nu doar cheia: retry identic.
    cerereTrimisa.current ||= cerere
    if (!pending && !salveazaPending(uid, { cheie, cerere: cerereTrimisa.current })) {
      // Fara retry durabil nu trimitem: un raspuns pierdut ar putea dubla receptia.
      cerereTrimisa.current = null
      return elibereaza('Nu pot pastra receptia in acest browser (stocare locala indisponibila sau utilizator neidentificat), deci nu o trimit. Datele au fost pastrate; deblocheaza stocarea locala si reincearca.')
    }
    setBlocat(true)
    try {
      const { error } = await supabase.rpc('fn_eip_intrare_factura', cerereTrimisa.current)
      if (error) throw error
      stergePending(uid)
    } catch (e) {
      const mesaj = e.message || ''
      const drept = e.code === '42501' || mesaj.includes('eip_fara_drept')
      const respins = e.code === 'P0001' || e.code === '42501' || e.code?.startsWith('22')
      const explicatii = {
        eip_articol_invalid: 'Articolul nu mai este activ. Verifica articolul ales.',
        eip_marime_obligatorie: 'Completeaza marimea sau foloseste nespecificat.',
        eip_linie_invalida: 'Verifica marimile si cantitatile introduse.',
        eip_antet_linii_invalide: 'Completeaza furnizorul, documentul, data si articolele.',
        eip_jurnal_divergent: 'Stocul articolului necesita verificarea responsabilului de magazie.',
        eip_cheie_reutilizata: 'Cheia receptiei are deja alt continut salvat. Verifica receptia existenta cu responsabilul de magazie.',
      }
      const explicatie = Object.entries(explicatii).find(([cod]) => mesaj.includes(cod))?.[1] || 'Verifica datele documentului si repartizarea pe marimi.'
      if (respins && !mesaj.includes('eip_cheie_reutilizata')) {
        cerereTrimisa.current = null
        stergePending(uid)
        setBlocat(false)
      }
      setEroare(drept ? 'Nu ai drept de inregistrare EIP. Datele introduse au fost pastrate.' : respins ? `Receptie respinsa. ${explicatie} Datele au fost pastrate.` : 'Rezultatul salvarii este incert. Apasa Salveaza pentru a retrimite exact aceeasi receptie, fara dublare. Nu incepe o receptie noua pentru acelasi document.')
      return
    } finally {
      inCurs.current = false
      setBusy(false)
    }
    onSuccess()
  }
  const camp = (titlu, nume, tip = 'text') => <label style={{ display: 'grid', gap: 5 }}>{titlu}<input required type={tip} style={S.input} value={formular[nume]} onChange={e => schimba(nume, e.target.value)} /></label>
  return <div style={{ position: 'fixed', inset: 0, background: '#000A', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
    <form onSubmit={salveaza} role="dialog" aria-modal="true" aria-labelledby="eip-intrare-titlu" style={{ ...S.card, padding: 24, width: 850, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', color: G.text }}>
      <h2 id="eip-intrare-titlu" style={{ marginTop: 0 }}>Intrare EIP - receptie manuala</h2>
      {incarca && <p role="status">Se incarca catalogul...</p>}
      {eroareCatalog && <p role="alert">{eroareCatalog} <button type="button" style={S.btnS} onClick={() => setIncercare(n => n + 1)}>Reincearca</button></p>}
      {!incarca && !eroareCatalog && !catalog.length && <p>Catalogul nu contine articole active.</p>}
      {pending && <div style={{ border: `1px solid ${G.yellow}`, borderRadius: 8, padding: 12, marginBottom: 12 }}>
        <b>Receptie cu rezultat necunoscut, pastrata pentru retrimitere.</b>
        <p style={{ margin: '6px 0 0' }}>{pending.cerere.p_antet?.furnizor_nume} - document {pending.cerere.p_antet?.factura_nr} ({pending.cerere.p_linii.length} linii). Apasa Retrimite: aceeasi receptie nu se dubleaza. Abandonezi doar dupa ce ai verificat in Magazie ca nu a fost salvata.</p>
      </div>}
      <fieldset hidden={!!pending} disabled={busy || blocat} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          {camp('CUI furnizor', 'furnizor_cui')}{camp('Denumire furnizor', 'furnizor_nume')}
          {camp('Numar document', 'factura_nr')}{camp('Data document', 'factura_data', 'date')}
        </div>
        {formular.linii.map((linie, index) => {
          const v = validareRepartizare(linie.cantitate, linie.pe_marimi)
          return <section key={index} style={{ border: `1px solid ${G.border2}`, borderRadius: 8, padding: 12, marginTop: 16 }}>
            <label>Articol - cautare in catalog<input style={S.input} value={linie.cautare} placeholder="Cauta denumirea..." onChange={e => schimbaLinie(index, { cautare: e.target.value, articol: null, pe_marimi: [{ marime: '', cantitate: '' }] })} /></label>
            <select aria-label={`Articol linia ${index + 1}`} required style={{ ...S.input, marginTop: 8 }} value={linie.articol?.id || ''} onChange={e => {
              const articol = catalog.find(a => String(a.id) === e.target.value) || null
              schimbaLinie(index, { articol, pe_marimi: [{ marime: articol?.tip_marime === 'unica' ? null : '', cantitate: '' }] })
            }}>
              <option value="">Alege articolul</option>
              {catalog.filter(a => a.denumire.toLowerCase().includes(linie.cautare.toLowerCase())).map(a => <option key={a.id} value={a.id}>{a.denumire} ({a.um === 'buc' ? 'bucata' : 'pereche'})</option>)}
            </select>
            <label style={{ display: 'block', marginTop: 8 }}>Cantitate ({linie.articol?.um === 'pereche' ? 'pereche' : 'bucata'})<input required inputMode="decimal" style={S.input} value={linie.cantitate} onChange={e => schimbaLinie(index, { cantitate: e.target.value })} /></label>
            {linie.articol && <>
              <p style={{ fontSize: 12, color: G.muted }}>Marime: {linie.articol.tip_marime === 'numar' ? 'numar pozitiv (ex. 42)' : linie.articol.tip_marime === 'litera' ? 'litera (XS, S, M, L, XL, XXL etc.)' : 'unica'}. Daca nu o cunosti, foloseste nespecificat.</p>
              {linie.pe_marimi.map((r, ri) => <div key={ri} style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                {linie.articol.tip_marime === 'unica' ? <span>Unica</span> : <input aria-label={`Marime ${index + 1}.${ri + 1}`} required style={{ ...S.input, width: 140 }} placeholder="Marime / nespecificat" value={r.marime} onChange={e => schimbaLinie(index, { pe_marimi: linie.pe_marimi.map((x, i) => i === ri ? { ...x, marime: e.target.value } : x) })} />}
                <input aria-label={`Cantitate marime ${index + 1}.${ri + 1}`} required inputMode="decimal" style={{ ...S.input, width: 140 }} placeholder="Cantitate" value={r.cantitate} onChange={e => schimbaLinie(index, { pe_marimi: linie.pe_marimi.map((x, i) => i === ri ? { ...x, cantitate: e.target.value } : x) })} />
                {linie.articol.tip_marime !== 'unica' && <button type="button" style={S.btnS} onClick={() => schimbaLinie(index, { pe_marimi: linie.pe_marimi.filter((_, i) => i !== ri) })}>Elimina marimea</button>}
              </div>)}
              {linie.articol.tip_marime !== 'unica' && <button type="button" style={S.btnS} onClick={() => schimbaLinie(index, { pe_marimi: [...linie.pe_marimi, { marime: '', cantitate: '' }] })}>+ Marime</button>}
            </>}
            <p aria-live="polite" style={{ color: v.valid ? G.green : G.yellow }}>Repartizat: {v.suma} / {linie.cantitate || '0'}. {v.eroare}</p>
            <button type="button" style={S.btnS} onClick={() => schimba('linii', formular.linii.filter((_, i) => i !== index))}>Elimina articolul</button>
          </section>
        })}
        <button type="button" style={{ ...S.btnS, marginTop: 12 }} onClick={() => schimba('linii', [...formular.linii, linieNoua()])}>+ Articol</button>
        <label style={{ display: 'block', marginTop: 16 }}>Observatii<textarea disabled style={S.input} value="" readOnly /></label>
        <p style={{ fontSize: 12, color: G.muted }}>Observatiile nu sunt disponibile: RPC-ul B1 nu are camp pentru salvarea lor.</p>
      </fieldset>
      {validare && !pending && <p style={{ color: G.yellow }}>{validare}</p>}
      {eroare && <p role="alert" style={{ color: G.red }}>{eroare}</p>}
      {blocat && !busy && <p>Formularul este blocat pentru retrimiterea aceleiasi receptii.</p>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
        <button type="button" disabled={busy} style={S.btnS} onClick={onClose}>Inchide</button>
        {blocat && !busy && <button type="button" style={S.btnS} onClick={async () => {
          if (!window.confirm('Ai verificat in Magazie ca receptia NU a fost salvata? Abandonarea o sterge definitiv din acest browser.')) return
          // Identitatea se reverifica si la abandon: la eroare/null/alt utilizator nu se sterge nimic.
          let curent = null
          try { const { data } = await supabase.auth.getUser(); curent = data?.user?.id ?? null } catch { curent = null }
          if (!uid || curent !== uid) { setEroare('Sesiunea s-a schimbat sau nu poate fi verificata, deci nu sterg receptia pastrata.'); return }
          stergePending(uid)
          onClose()
        }}>Abandoneaza receptia</button>}
        <button type="submit" disabled={pending ? busy : (!cerere || busy || incarca || !!eroareCatalog || !catalog.length)} style={{ ...S.btnP, opacity: (pending ? busy : (!cerere || busy || incarca || eroareCatalog || !catalog.length)) ? 0.5 : 1 }}>{busy ? 'Se salveaza...' : blocat ? 'Retrimite' : 'Salveaza'}</button>
      </div>
    </form>
  </div>
}
