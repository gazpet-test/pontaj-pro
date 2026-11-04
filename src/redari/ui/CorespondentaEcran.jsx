/* CorespondentaEcran.jsx — Redări: „Corespondență de trimis” (cerere Răzvan 03.11.2026): ce mailuri / adrese pleacă, în ce ordine, de la cine,
   în ce stare sunt. EVIDENȚĂ — ERP-ul nu trimite nimic. „Aprobat” îl pune doar Răzvan (owner); „Trimis” doar după aprobare (garda e în BD).
   Scriu admin/editor (RLS); viewer vede doar. Salvările folosesc versiunea citită (CAS): dacă altcineva a modificat rândul între timp, nu se suprascrie.
   Fișiere (20261130e, decizia Răzvan 04.11): „📎 n” pe fiecare rând — descarcă oricine are acces la Redări, urcă admin/editor; fișierele sunt imutabile.
   Aprobarea se leagă de ultimul fișier „de trimis” (BD: aprobat_fisier_id + aprobat_sha256); un „de trimis” nou după aprobare o face să cadă. */
import React, { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase.js'
import { G, S, Modal, Camp, Gol, fmtDate, fmtDateTime, citesteIn } from './comune.jsx'
import { etichetaRolFisier, COL_FISIER_CORESP, ACCEPT_FISIER_CORESP, roluriPermise, valideazaFisierCoresp, mimeFisier,
  caleFisierCoresp, sha8, sha256Hex, fisierDeAprobat, fisiereRand, fmtMarime } from '../corespondentaFisiere.js'
import { STARI_CORESPONDENTA, etichetaStareCoresp, culoareStareCoresp, COL_CORESPONDENTA, stariPermise, poateAproba, urmatorul,
  valideazaCorespondenta, mesajEroareCoresp, sesiuneEcran, stariInFormular, stareEfectiva } from '../corespondenta.js'

const GOL = { cod: '', ordine: '', destinatar: '', subiect: '', expeditor: '', documente: '', depinde_de: '', stare: 'draft', trimis_la: '', nr_inregistrare: '', observatii: '' }

export default function CorespondentaEcran({ proiect, nivel, profile, show }) {
  const poateScrie = nivel === 'admin' || nivel === 'editor'
  const esteOwner = !!profile?.is_owner
  const [randuri, setRanduri] = useState(null)
  const [eroare, setEroare] = useState('')
  const [editat, setEditat] = useState(null)   // { rand|null, f }
  const [lucru, setLucru] = useState(false)
  const [fisiere, setFisiere] = useState([])          // toate fișierele rândurilor proiectului curent
  const [eroareFis, setEroareFis] = useState('')
  const [fisPentru, setFisPentru] = useState(null)    // id-ul rândului cu modalul de fișiere deschis
  const generatie = useRef(0)
  // Jakarinos r2/r3 P2-01: proiectul curent + un token de SESIUNE a ecranului, invalidat la orice schimbare de proiect (inclusiv A→B→A) și la demontare.
  // O operație veche (salvare / aprobare) verifică tokenul după fiecare await, în catch și în finally: nu mai închide formulare noi, nu mai deblochează
  // alte operații, nu mai anunță și nu mai reîncarcă. Separat de `generatie` (citirile), care crește la fiecare incarca().
  const proiectCurent = useRef(proiect.id)
  const sesiune = useRef(null)
  if (!sesiune.current) sesiune.current = sesiuneEcran()

  const incarca = async () => {
    const token = ++generatie.current, curent = () => token === generatie.current
    setEroare('')
    try {
      // o listă scurtă (zeci de rânduri): o singură citire, sortată după ordine; limita evită o listă tăiată în tăcere
      const pid = proiectCurent.current
      const { data, error } = await supabase.from('red_corespondenta').select(COL_CORESPONDENTA).eq('proiect_id', pid).order('ordine').order('cod').limit(501)
      if (error) throw error
      if (data.length > 500) throw new Error('Prea multe rânduri de corespondență pentru afișare (peste 500).')
      if (curent()) setRanduri(data)
      // fișierele rândurilor (paginat, în loturi de id-uri); o eroare aici nu ascunde lista
      try {
        const fis = await citesteIn(() => supabase.from('red_corespondenta_fisiere').select(COL_FISIER_CORESP).order('created_at').order('id'), 'corespondenta_id', data.map(r => r.id))
        if (curent()) { setFisiere(fis); setEroareFis('') }
      } catch (e) { if (curent()) { setFisiere([]); setEroareFis('Fișierele corespondenței nu s-au putut citi: ' + mesajEroareCoresp(e)) } }
    } catch (e) { if (curent()) { setRanduri([]); setEroare(mesajEroareCoresp(e)) } }
  }
  useEffect(() => { proiectCurent.current = proiect.id; sesiune.current.noua(); setRanduri(null); setFisiere([]); setFisPentru(null); setEditat(null); setLucru(false); incarca(); return () => { generatie.current++; sesiune.current.noua() } }, [proiect.id])

  const deschide = rand => setEditat({ rand, f: rand ? { ...GOL, ...Object.fromEntries(Object.entries(rand).map(([k, v]) => [k, v ?? ''])) } : { ...GOL } })

  const salveaza = async () => {
    if (lucru || !editat) return
    const nou = !editat.rand
    const { erori, valori } = valideazaCorespondenta({ ...editat.f, stare: stareEfectiva(editat.rand, editat.f) }, { nou })
    if (erori.length) { show(erori.join(' '), 'error'); return }
    const pid = proiect.id, expirat = sesiune.current.captureaza()
    setLucru(true)
    try {
      if (nou) {
        const { error } = await supabase.from('red_corespondenta').insert({ ...valori, proiect_id: pid }).select('id')
        if (error) throw error
      } else {
        const { data, error } = await supabase.from('red_corespondenta').update(valori).eq('id', editat.rand.id).eq('versiune', editat.rand.versiune).select('id')
        if (error) throw error
        if (expirat()) return
        if (!data?.length) { show('Rândul a fost modificat între timp de altcineva — l-am reîncărcat, verifică și salvează din nou.', 'error'); setEditat(null); await incarca(); return }
      }
      if (expirat()) return
      show(nou ? 'Corespondența a fost adăugată.' : 'Corespondența a fost salvată.', 'success'); setEditat(null); await incarca()
    } catch (e) { if (!expirat()) show(mesajEroareCoresp(e), 'error') } finally { if (!expirat()) setLucru(false) }
  }

  const aproba = async rand => {
    if (lucru || !poateAproba(rand, esteOwner)) return
    // 20261130e: aprobarea se leagă de ultimul „de trimis”; BD-ul îl alege pe același (created_at desc, id desc). Orice „de trimis” nou
    // crește versiunea rândului, deci dacă între timp s-a urcat altul, CAS-ul de mai jos refuză aprobarea (nu aprobi ce n-ai văzut).
    const deAprobat = fisierDeAprobat(fisiereRand(fisiere, rand.id))
    if (!deAprobat) { show('Urcă întâi fișierul „de trimis” (📎), apoi aprobă.', 'error'); return }
    if (!window.confirm(`Aprobi trimiterea ${rand.cod} — ${rand.subiect}\nCătre: ${rand.destinatar}\nDe la: ${rand.expeditor || '-'}?\n\nFișierul aprobat: ${numeFisier(deAprobat)} (${sha8(deAprobat.sha256)})\n\nAprobarea doar înregistrează „da”-ul tău; ERP-ul nu trimite nimic.`)) return
    const pid = proiect.id, expirat = sesiune.current.captureaza()
    setLucru(true)
    try {
      const { data, error } = await supabase.from('red_corespondenta').update({ stare: 'aprobat' }).eq('id', rand.id).eq('versiune', rand.versiune).select('id')
      if (error) throw error
      if (expirat()) return
      if (!data?.length) show('Rândul a fost modificat între timp — reîncarc.', 'error')
      else show(`${rand.cod} aprobat.`, 'success')
      await incarca()
    } catch (e) { if (!expirat()) show(mesajEroareCoresp(e), 'error') } finally { if (!expirat()) setLucru(false) }
  }

  // Urcarea unui fișier: sha256 în browser → upload (upsert:false, cale nouă) → INSERT rând. Legarea e pe rand.id (nu pe proiectul curent): dacă
  // între timp s-a schimbat proiectul, INSERT-ul se face tot pentru rândul ales (altfel fișierul ar rămâne orfan), dar UI-ul vechi nu mai anunță nimic.
  const urca = async (rand, form) => {
    if (lucru) return false
    const erori = valideazaFisierCoresp(form.fisier)
    if (!roluriPermise(rand).includes(form.rol)) erori.push('După trimitere / anulare nu se mai urcă „de trimis”.')
    if (String(form.observatii || '').length > 1000) erori.push('Observațiile au cel mult 1000 de caractere.')
    if (erori.length) { show(erori.join(' '), 'error'); return false }
    const expirat = sesiune.current.captureaza(), proiectCod = proiect.cod
    let orfan = null
    setLucru(true)
    try {
      const sha = await sha256Hex(form.fisier)
      const path = caleFisierCoresp({ proiectCod, corespCod: rand.cod, sha256: sha, nume: form.fisier.name })
      const { error: eUp } = await supabase.storage.from('redari').upload(path, form.fisier, { upsert: false, contentType: mimeFisier(form.fisier) })
      if (eUp) throw eUp
      orfan = path
      const { error } = await supabase.from('red_corespondenta_fisiere').insert({ corespondenta_id: rand.id, rol: form.rol, path,
        nume_original: String(form.fisier.name || '').slice(0, 255), mime: mimeFisier(form.fisier), marime: form.fisier.size, sha256: sha,
        observatii: String(form.observatii || '').trim() || null }).select('id')
      if (error) throw error
      orfan = null
      if (expirat()) return false
      show(form.rol === 'de_trimis' && rand.stare === 'aprobat' ? 'Fișierul a fost urcat. Aprobarea a căzut: rândul a revenit în Draft și cere din nou „da”-ul lui Răzvan.' : 'Fișierul a fost urcat.', 'success')
      await incarca()
      return true
    } catch (e) {
      if (!expirat()) show(orfan ? `Fișierul e în Storage (${orfan}), dar înregistrarea lui a eșuat: ${mesajEroareCoresp(e)} Fișierul rămâne orfan în bucket (nu se șterge din aplicație și nu apare în listă); reîncearcă urcarea.` : mesajEroareCoresp(e), 'error')
      return false
    } finally { if (!expirat()) setLucru(false) }
  }

  // link semnat 10 min, deschis printr-un <a target=_blank> (ca în Fișa parcelei)
  const descarca = async f => {
    try {
      const { data, error } = await supabase.storage.from('redari').createSignedUrl(f.path, 600)
      if (error) throw error
      const a = document.createElement('a')
      a.href = data.signedUrl; a.target = '_blank'; a.rel = 'noopener noreferrer'
      document.body.appendChild(a); a.click(); a.remove()
    } catch (e) { show('Descărcare: ' + mesajEroareCoresp(e), 'error') }
  }

  const urm = urmatorul(randuri)
  const randFis = fisPentru ? (randuri || []).find(r => r.id === fisPentru) : null
  const f = editat?.f, set = (k, v) => setEditat(x => ({ ...x, f: { ...x.f, [k]: v } }))
  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap', marginBottom:10 }}>
        <div style={{ fontSize:13, color:G.muted, flex:1, minWidth:260 }}>
          Ce pleacă, în ce ordine și în ce stare. <b>Evidență</b> — ERP-ul nu trimite nimic. „Aprobat” îl pune doar Răzvan; „Trimis” se poate marca doar după aprobare.
          Ordinea comunicărilor: Planul de verificare, cap. 6 „Succesiunea comunicărilor”. Evidența se ține numai aici (decizia Răzvan 03.11).
        </div>
        <button style={S.btnS} onClick={incarca} disabled={lucru}>↻ Reîncarcă</button>
        {poateScrie && <button style={S.btnP} onClick={() => deschide(null)} disabled={lucru}>＋ Adaugă</button>}
      </div>
      {eroare && <div role="alert" style={{ color:G.red, marginBottom:8 }}>{eroare}</div>}
      {eroareFis && <div role="alert" style={{ color:G.yellow, marginBottom:8 }}>{eroareFis}</div>}
      {urm && <div style={{ ...S.card, borderColor: urm.stare === 'aprobat' ? G.green : G.yellow, marginBottom:10, fontSize:13 }}>
        ▶ Următorul pas: <b>{urm.cod}</b> — {urm.subiect} → {urm.destinatar} <span style={{ color:culoareStareCoresp(urm.stare) }}>({etichetaStareCoresp(urm.stare)})</span>
        {urm.depinde_de ? <span style={{ color:G.muted }}> · depinde de: {urm.depinde_de}</span> : null}
      </div>}
      {randuri === null ? <Gol text="Se încarcă…" /> : randuri.length === 0 ? <Gol text="Nicio corespondență în evidență." /> : (
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead><tr>{['#', 'Cod', 'Destinatar', 'Ce se trimite', 'Expeditor', 'Documente', 'Depinde de', 'Stare', 'Trimis', ''].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>{randuri.map(r => (
              <tr key={r.id} style={{ opacity: r.stare === 'anulat' ? .5 : 1, background: urm?.id === r.id ? G.surface : 'transparent' }}>
                <td style={S.td}>{r.ordine}</td>
                <td style={{ ...S.td, fontWeight:700 }}>{r.cod}</td>
                <td style={S.td}>{r.destinatar}</td>
                <td style={S.td}>{r.subiect}{r.observatii ? <div style={{ fontSize:11.5, color:G.muted, marginTop:3 }}>{r.observatii}</div> : null}</td>
                <td style={S.td}>{r.expeditor || '-'}</td>
                <td style={{ ...S.td, fontSize:12, color:G.muted }}>{r.documente || '-'}</td>
                <td style={{ ...S.td, fontSize:12, color:G.muted }}>{r.depinde_de || '-'}</td>
                <td style={S.td}><span style={{ color:culoareStareCoresp(r.stare), fontWeight:700, whiteSpace:'nowrap' }}>{etichetaStareCoresp(r.stare)}</span>
                  {r.aprobat_la ? <div style={{ fontSize:11, color:G.muted }}>aprobat {fmtDate(r.aprobat_la)}</div> : null}
                  {r.aprobat_la && r.aprobat_sha256 ? <div style={{ fontSize:11, color:G.blue }} title={r.aprobat_sha256}>📄 {numeFisier(fisiere.find(x => x.id === r.aprobat_fisier_id)) || 'fișier'} ({sha8(r.aprobat_sha256)})</div> : null}</td>
                <td style={{ ...S.td, whiteSpace:'nowrap' }}>{r.trimis_la ? fmtDate(r.trimis_la) : '-'}{r.nr_inregistrare ? <div style={{ fontSize:11, color:G.muted }}>nr. {r.nr_inregistrare}</div> : null}</td>
                <td style={{ ...S.td, whiteSpace:'nowrap' }}>
                  <button style={{ ...S.btnS, marginRight:6 }} onClick={() => setFisPentru(r.id)} title="Fișierele corespondenței">📎 {fisiereRand(fisiere, r.id).length}</button>
                  {poateAproba(r, esteOwner) && <BtnAproba fa={fisierDeAprobat(fisiereRand(fisiere, r.id))} lucru={lucru} onClick={() => aproba(r)} />}
                  {poateScrie && <button style={S.btnS} onClick={() => deschide(r)} disabled={lucru}>Editează</button>}
                </td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
      {editat && (
        <Modal titlu={editat.rand ? `Corespondența ${editat.rand.cod}` : 'Corespondență nouă'} onClose={() => !lucru && setEditat(null)}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
            {!editat.rand && <Camp eticheta="Cod (ex. B4)"><input style={S.input} value={f.cod} onChange={e => set('cod', e.target.value)} maxLength={3} /></Camp>}
            <Camp eticheta="Ordine"><input style={S.input} type="number" min="1" max="999" value={f.ordine} onChange={e => set('ordine', e.target.value)} /></Camp>
            <Camp eticheta="Destinatar" span={2}><input style={S.input} value={f.destinatar} onChange={e => set('destinatar', e.target.value)} maxLength={300} /></Camp>
            <Camp eticheta="Ce se trimite" span={2}><input style={S.input} value={f.subiect} onChange={e => set('subiect', e.target.value)} maxLength={500} /></Camp>
            <Camp eticheta="Expeditor"><input style={S.input} value={f.expeditor} onChange={e => set('expeditor', e.target.value)} maxLength={200} /></Camp>
            <Camp eticheta="Stare"><select style={{ ...S.select, width:'100%' }} value={stareEfectiva(editat.rand, f)} onChange={e => set('stare', e.target.value)}>
              {stariInFormular(editat.rand, f).map(c => <option key={c} value={c}>{etichetaStareCoresp(c)}</option>)}
            </select></Camp>
            <Camp eticheta="Documente (fișiere / unde se generează)" span={2}><input style={S.input} value={f.documente} onChange={e => set('documente', e.target.value)} maxLength={2000} /></Camp>
            <Camp eticheta="Depinde de" span={2}><input style={S.input} value={f.depinde_de} onChange={e => set('depinde_de', e.target.value)} maxLength={1000} /></Camp>
            <Camp eticheta="Data trimiterii"><input style={S.input} type="date" value={f.trimis_la} onChange={e => set('trimis_la', e.target.value)} /></Camp>
            <Camp eticheta="Nr. de înregistrare"><input style={S.input} value={f.nr_inregistrare} onChange={e => set('nr_inregistrare', e.target.value)} maxLength={100} /></Camp>
            <Camp eticheta="Observații" span={2}><textarea style={{ ...S.input, minHeight:60 }} value={f.observatii} onChange={e => set('observatii', e.target.value)} maxLength={4000} /></Camp>
          </div>
          {editat.rand && ['draft', 'la_avocat'].includes(stareEfectiva(editat.rand, f)) && editat.rand.aprobat_la && <div style={{ color:G.yellow, fontSize:12.5, marginTop:8 }}>⚠ Revenirea la {etichetaStareCoresp(stareEfectiva(editat.rand, f))} anulează aprobarea lui Răzvan (textul se schimbă → alt „da”).</div>}
          <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:14 }}>
            <button style={S.btnS} onClick={() => setEditat(null)} disabled={lucru}>Renunță</button>
            <button style={S.btnP} onClick={salveaza} disabled={lucru}>Salvează</button>
          </div>
        </Modal>
      )}
      {randFis && <ModalFisiere rand={randFis} fisiere={fisiereRand(fisiere, randFis.id)} poateScrie={poateScrie} lucru={lucru}
        onClose={() => !lucru && setFisPentru(null)} onUrca={form => urca(randFis, form)} onDescarca={descarca} />}
      <div style={{ fontSize:11.5, color:G.dim, marginTop:10 }}>Stări: {STARI_CORESPONDENTA.map(s => s.eticheta).join(' → ')}. Ce se trimite efectiv (mail / poștă) rămâne la expeditor.</div>
    </div>
  )
}

const numeFisier = f => f ? (f.nume_original || String(f.path || '').split('/').pop()) : ''

// „Aprob” dezactivat până există un fișier „de trimis” (BD refuză oricum: 23514).
export function BtnAproba({ fa, lucru, onClick }) {
  return <button style={{ ...S.btnS, borderColor:G.green, color:G.green, marginRight:6, opacity: fa ? 1 : .45, cursor: fa ? 'pointer' : 'not-allowed' }} onClick={onClick}
    disabled={lucru || !fa} title={fa ? `Aprobi fișierul ${numeFisier(fa)} (${sha8(fa.sha256)})` : 'urcă întâi fișierul de trimis'}>✅ Aprob</button>
}

// Modalul de fișiere al unui rând: listă + descărcare (toți) și urcare (admin / editor). Fără ștergere / înlocuire: fișierele sunt imutabile.
export function ModalFisiere({ rand, fisiere, poateScrie, lucru, onClose, onUrca, onDescarca }) {
  const roluri = roluriPermise(rand)
  const [form, setForm] = useState({ rol: roluri[0], fisier: null, observatii: '' })
  const [cheieInput, setCheieInput] = useState(0)   // resetarea <input type=file> după urcare
  const deAprobat = fisierDeAprobat(fisiere)
  const rol = roluri.includes(form.rol) ? form.rol : roluri[0]
  const trimite = async () => {
    if (await onUrca({ ...form, rol })) { setForm({ rol: roluri[0], fisier: null, observatii: '' }); setCheieInput(k => k + 1) }
  }
  return (
    <Modal titlu={`Fișierele corespondenței ${rand.cod}`} onClose={onClose} latime={760}>
      <div style={{ fontSize:12.5, color:G.muted, marginBottom:10 }}>{rand.subiect} → {rand.destinatar}</div>
      {fisiere.length === 0 ? <Gol text="Niciun fișier urcat." /> : (
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead><tr>{['Rol', 'Fișier', 'Urcat', 'Mărime', 'SHA-256', ''].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>{fisiere.map(f => (
              <tr key={f.id}>
                <td style={{ ...S.td, whiteSpace:'nowrap' }}>{etichetaRolFisier(f.rol)}
                  {f.id === rand.aprobat_fisier_id && rand.aprobat_la ? <div style={{ fontSize:11, color:G.green, fontWeight:700 }}>✓ aprobat</div> : null}
                  {f.id === deAprobat?.id && !rand.aprobat_la ? <div style={{ fontSize:11, color:G.muted }}>se aprobă acesta</div> : null}</td>
                <td style={S.td}>{numeFisier(f)}{f.observatii ? <div style={{ fontSize:11.5, color:G.muted }}>{f.observatii}</div> : null}</td>
                <td style={{ ...S.td, whiteSpace:'nowrap' }}>{fmtDateTime(f.created_at)}</td>
                <td style={{ ...S.td, whiteSpace:'nowrap' }}>{fmtMarime(f.marime)}</td>
                <td style={{ ...S.td, ...S.mono }} title={f.sha256}>{sha8(f.sha256)}</td>
                <td style={S.td}><button style={S.btnX} onClick={() => onDescarca(f)}>⬇ Descarcă</button></td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
      {poateScrie && (
        <div style={{ borderTop:`1px solid ${G.border}`, marginTop:12, paddingTop:12 }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
            <Camp eticheta="Rol"><select style={{ ...S.select, width:'100%' }} value={rol} onChange={e => setForm(x => ({ ...x, rol: e.target.value }))}>
              {roluri.map(c => <option key={c} value={c}>{etichetaRolFisier(c)}</option>)}
            </select></Camp>
            <Camp eticheta="Fișier (PDF, DOCX, JPG, PNG; max. 25 MB)"><input key={cheieInput} type="file" accept={ACCEPT_FISIER_CORESP} style={S.input}
              onChange={e => { const fisier = e.target.files?.[0] || null; setForm(x => ({ ...x, fisier })) }} /></Camp>
            <Camp eticheta="Observații" span={2}><input style={S.input} value={form.observatii} maxLength={1000} onChange={e => setForm(x => ({ ...x, observatii: e.target.value }))} /></Camp>
          </div>
          {rol === 'de_trimis' && rand.stare === 'aprobat' && <div style={{ color:G.yellow, fontSize:12.5, marginTop:8 }}>⚠ Un fișier „de trimis” nou anulează aprobarea lui Răzvan (rândul revine în Draft).</div>}
          {!roluri.includes('de_trimis') && <div style={{ color:G.muted, fontSize:12, marginTop:8 }}>Rândul e {rand.stare === 'anulat' ? 'anulat' : 'trimis'}: se pot urca doar dovada trimiterii, răspunsul sau alte fișiere.</div>}
          <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:10 }}>
            <button style={S.btnP} onClick={trimite} disabled={lucru || !form.fisier}>⬆ Urcă</button>
          </div>
          <div style={{ fontSize:11, color:G.dim, marginTop:6 }}>Fișierele urcate nu se mai modifică și nu se șterg; o variantă nouă se urcă separat.</div>
        </div>
      )}
    </Modal>
  )
}
