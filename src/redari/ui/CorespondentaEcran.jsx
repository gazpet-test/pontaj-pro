/* CorespondentaEcran.jsx — Redări: „Corespondență de trimis” (cerere Răzvan 03.11.2026): ce mailuri / adrese pleacă, în ce ordine, de la cine,
   în ce stare sunt. EVIDENȚĂ — ERP-ul nu trimite nimic. „Aprobat” îl pune doar Răzvan (owner); „Trimis” doar după aprobare (garda e în BD).
   Scriu admin/editor (RLS); viewer vede doar. Salvările folosesc versiunea citită (CAS): dacă altcineva a modificat rândul între timp, nu se suprascrie.
   Fișiere (20261130e, decizia Răzvan 04.11): „📎 n” pe fiecare rând — descarcă oricine are acces la Redări, urcă admin/editor; fișierele sunt imutabile.
   Aprobarea se leagă de ultimul fișier „de trimis” (BD: aprobat_fisier_id + aprobat_sha256); un „de trimis” nou după aprobare o face să cadă. */
import React, { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase.js'
import { G, S, Modal, Camp, Gol, fmtDate, fmtDateTime } from './comune.jsx'
import { etichetaRolFisier, ACCEPT_FISIER_CORESP, roluriPermise, valideazaFisierCoresp, mimeFisier, caleFisierCoresp, folderCoresp, sha8, sha256Hex,
  fisierDeAprobat, fisiereRand, fmtMarime, citesteFisiereProiect, listeazaFolder, orfani, numeDinCale } from '../corespondentaFisiere.js'
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
  const [seIncarca, setSeIncarca] = useState(true)    // Jakarinos r1 J-P1-1: cât timp citirea e în curs, aprobarea e blocată
  const [orfaneRand, setOrfaneRand] = useState(null)  // { randId, lista|null, eroare } — obiecte urcate dar neînregistrate (doar admin/editor)
  const generatie = useRef(0)
  // Jakarinos r2/r3 P2-01: proiectul curent + un token de SESIUNE a ecranului, invalidat la orice schimbare de proiect (inclusiv A→B→A) și la demontare.
  // O operație veche (salvare / aprobare) verifică tokenul după fiecare await, în catch și în finally: nu mai închide formulare noi, nu mai deblochează
  // alte operații, nu mai anunță și nu mai reîncarcă. Separat de `generatie` (citirile), care crește la fiecare incarca().
  const proiectCurent = useRef(proiect.id)
  const sesiune = useRef(null)
  if (!sesiune.current) sesiune.current = sesiuneEcran()

  const incarca = async () => {
    const token = ++generatie.current, curent = () => token === generatie.current
    setEroare(''); setSeIncarca(true)
    try {
      // o listă scurtă (zeci de rânduri): o singură citire, sortată după ordine; limita evită o listă tăiată în tăcere
      const pid = proiectCurent.current
      const { data, error } = await supabase.from('red_corespondenta').select(COL_CORESPONDENTA).eq('proiect_id', pid).order('ordine').order('cod').limit(501)
      if (error) throw error
      if (data.length > 500) throw new Error('Prea multe rânduri de corespondență pentru afișare (peste 500).')
      // fișierele proiectului (keyset, created_at desc, id desc — ordinea din BD). Jakarinos r1 J-P1-1: rândurile și fișierele se publică ÎMPREUNĂ,
      // din aceeași încărcare, ca o versiune nouă a rândului să nu fie combinată cu o listă veche de fișiere. O eroare la fișiere nu ascunde lista,
      // dar fără fișiere „Aprob” rămâne dezactivat.
      let fis = [], eFis = ''
      try { fis = await citesteFisiereProiect(supabase, pid, { esteCurent: curent }) }
      catch (e) { fis = []; eFis = 'Fișierele corespondenței nu s-au putut citi: ' + mesajEroareCoresp(e) }
      if (!curent() || fis === null) return
      setRanduri(data); setFisiere(fis); setEroareFis(eFis)
    } catch (e) { if (curent()) { setRanduri([]); setFisiere([]); setEroare(mesajEroareCoresp(e)) } }
    finally { if (curent()) setSeIncarca(false) }
  }
  useEffect(() => { proiectCurent.current = proiect.id; sesiune.current.noua(); setRanduri(null); setFisiere([]); setFisPentru(null); setOrfaneRand(null); setEditat(null); setLucru(false); incarca(); return () => { generatie.current++; sesiune.current.noua() } }, [proiect.id])

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
    if (lucru || seIncarca || !poateAproba(rand, esteOwner)) return
    // 20261130e + Jakarinos r1 J-P1-1: aprobarea trimite id-ul fișierului ARĂTAT owner-ului; BD-ul îl acceptă doar dacă e ultimul „de trimis”
    // citit sub blocarea rândului (altfel 23514 „între timp s-a urcat alt fișier”). În plus, CAS pe versiune (un „de trimis” nou o crește).
    const deAprobat = fisierDeAprobat(fisiereRand(fisiere, rand.id))
    if (!deAprobat) { show('Urcă întâi fișierul „de trimis” (📎), apoi aprobă.', 'error'); return }
    if (!window.confirm(`Aprobi trimiterea ${rand.cod} — ${rand.subiect}\nCătre: ${rand.destinatar}\nDe la: ${rand.expeditor || '-'}?\n\nFișierul aprobat: ${numeFisier(deAprobat)} (SHA-256 declarat ${sha8(deAprobat.sha256)})\n\nAprobarea doar înregistrează „da”-ul tău; ERP-ul nu trimite nimic.`)) return
    const expirat = sesiune.current.captureaza()
    setLucru(true)
    try {
      const { data, error } = await supabase.from('red_corespondenta').update({ stare: 'aprobat', aprobat_fisier_id: deAprobat.id }).eq('id', rand.id).eq('versiune', rand.versiune).select('id')
      if (error) throw error
      if (expirat()) return
      if (!data?.length) show('Rândul a fost modificat între timp — reîncarc.', 'error')
      else show(`${rand.cod} aprobat.`, 'success')
      await incarca()
    } catch (e) { if (!expirat()) { show(mesajEroareCoresp(e), 'error'); await incarca() } } finally { if (!expirat()) setLucru(false) }
  }

  // Obiectele din folderul rândului fără rând în tabel (urcate, dar înregistrarea a eșuat / nu s-a confirmat). Doar admin / editor (listarea cere red_storage_sel).
  const incarcaOrfane = async rand => {
    if (!poateScrie || !rand) return
    const expirat = sesiune.current.captureaza()
    setOrfaneRand({ randId: rand.id, lista: null, eroare: '' })
    try {
      const obiecte = await listeazaFolder(supabase, folderCoresp(proiect.cod, rand.cod))
      const { data, error } = await supabase.from('red_corespondenta_fisiere').select('path').eq('corespondenta_id', rand.id).limit(10000)
      if (error) throw error
      if (expirat()) return
      setOrfaneRand(x => x?.randId === rand.id ? { randId: rand.id, lista: orfani(obiecte, data), eroare: '' } : x)
    } catch (e) { if (!expirat()) setOrfaneRand(x => x?.randId === rand.id ? { randId: rand.id, lista: [], eroare: mesajEroareCoresp(e) } : x) }
  }
  useEffect(() => { const r = fisPentru ? (randuri || []).find(x => x.id === fisPentru) : null; if (r) incarcaOrfane(r); else setOrfaneRand(null) }, [fisPentru])

  // INSERT-ul rândului de fișier; la eroare / rezultat necunoscut (Jakarinos r1 J-P2-3) citește înapoi după `path`: dacă rândul există, e succes.
  // Întoarce 'ok' | 'neconfirmat' (aruncă eroarea BD-ului dacă rândul sigur nu există și BD-ul a spus de ce).
  const inregistreaza = async (rand, { path, rol, nume, mime, marime, sha, observatii }) => {
    let eIns = null
    try {
      const { error } = await supabase.from('red_corespondenta_fisiere').insert({ corespondenta_id: rand.id, rol, path, nume_original: String(nume || '').slice(0, 255),
        mime, marime, sha256: sha, observatii: String(observatii || '').trim() || null }).select('id')
      if (!error) return 'ok'
      eIns = error
    } catch (e) { eIns = e }
    try {
      const { data, error } = await supabase.from('red_corespondenta_fisiere').select('id').eq('path', path).limit(1)
      if (!error && data?.length) return 'ok'
      if (!error && eIns?.code) throw eIns   // BD-ul a răspuns clar (trigger / RLS) și rândul nu există
    } catch (e) { if (e === eIns) throw e }
    return 'neconfirmat'
  }

  // Urcarea unui fișier: sha256 în browser → upload (upsert:false, cale nouă, sufix aleator) → INSERT (cu citire înapoi). Legarea e pe rand.id (nu pe
  // proiectul curent): dacă între timp s-a schimbat proiectul, INSERT-ul se face tot pentru rândul ales (altfel fișierul ar rămâne orfan), dar UI-ul vechi nu mai anunță.
  const urca = async (rand, form) => {
    if (lucru) return false
    const erori = valideazaFisierCoresp(form.fisier)
    if (!roluriPermise(rand).includes(form.rol)) erori.push('După trimitere / anulare nu se mai urcă „de trimis”.')
    if (String(form.observatii || '').length > 1000) erori.push('Observațiile au cel mult 1000 de caractere.')
    if (erori.length) { show(erori.join(' '), 'error'); return false }
    const expirat = sesiune.current.captureaza(), proiectCod = proiect.cod
    let urcat = null
    setLucru(true)
    try {
      const sha = await sha256Hex(form.fisier)
      const path = caleFisierCoresp({ proiectCod, corespCod: rand.cod, sha256: sha, nume: form.fisier.name })
      const { error: eUp } = await supabase.storage.from('redari').upload(path, form.fisier, { upsert: false, contentType: mimeFisier(form.fisier) })
      if (eUp) throw eUp
      urcat = path
      const rez = await inregistreaza(rand, { path, rol: form.rol, nume: form.fisier.name, mime: mimeFisier(form.fisier), marime: form.fisier.size, sha, observatii: form.observatii })
      if (expirat()) return rez === 'ok'
      if (rez === 'neconfirmat') {
        show(`Fișierul e în Storage (${path}), dar înregistrarea nu s-a confirmat. NU îl urca din nou: reîncarcă și folosește „Înregistrează” la „Fișiere urcate dar neînregistrate”.`, 'error')
        await incarca(); await incarcaOrfane(rand); return false
      }
      show(form.rol === 'de_trimis' && rand.stare === 'aprobat' ? 'Fișierul a fost urcat. Aprobarea a căzut: rândul a revenit în Draft și cere din nou „da”-ul lui Răzvan.' : 'Fișierul a fost urcat.', 'success')
      await incarca(); await incarcaOrfane(rand)
      return true
    } catch (e) {
      if (!expirat()) {
        show(urcat ? `Fișierul e în Storage (${urcat}), dar înregistrarea lui a fost refuzată: ${mesajEroareCoresp(e)} Fișierul rămâne în bucket (nu se șterge din aplicație) și apare la „Fișiere urcate dar neînregistrate”.` : mesajEroareCoresp(e), 'error')
        if (urcat) await incarcaOrfane(rand)
      }
      return false
    } finally { if (!expirat()) setLucru(false) }
  }

  // Copilot r1 C-P2-01: înregistrarea unui obiect deja urcat (orfan): descarcă obiectul, recalculează sha256 în browser, INSERT cu rolul ales. Fără reupload.
  const inregistreazaOrfan = async (rand, obiect, rol, observatii) => {
    if (lucru) return false
    if (!roluriPermise(rand).includes(rol)) { show('După trimitere / anulare nu se mai înregistrează „de trimis”.', 'error'); return false }
    const expirat = sesiune.current.captureaza()
    setLucru(true)
    try {
      const { data: blob, error: eDl } = await supabase.storage.from('redari').download(obiect.path)
      if (eDl) throw eDl
      const nume = numeDinCale(obiect.path)
      const erori = valideazaFisierCoresp({ name: nume, size: blob.size })
      if (erori.length) throw new Error(erori.join(' '))
      const sha = await sha256Hex(blob)
      const rez = await inregistreaza(rand, { path: obiect.path, rol, nume, mime: mimeFisier({ name: nume, type: blob.type }), marime: blob.size, sha, observatii })
      if (expirat()) return rez === 'ok'
      if (rez === 'neconfirmat') { show('Înregistrarea nu s-a confirmat; reîncarcă și verifică lista.', 'error'); return false }
      show('Fișierul a fost înregistrat.', 'success')
      await incarca(); await incarcaOrfane(rand)
      return true
    } catch (e) { if (!expirat()) show(mesajEroareCoresp(e), 'error'); return false } finally { if (!expirat()) setLucru(false) }
  }

  // link semnat 10 min, deschis printr-un <a target=_blank> (ca în Fișa parcelei). Copilot C-P3-01 / L24: tokenul de sesiune verificat după await.
  const descarca = async f => {
    const expirat = sesiune.current.captureaza()
    try {
      const { data, error } = await supabase.storage.from('redari').createSignedUrl(f.path, 600)
      if (error) throw error
      if (expirat()) return
      const a = document.createElement('a')
      a.href = data.signedUrl; a.target = '_blank'; a.rel = 'noopener noreferrer'
      document.body.appendChild(a); a.click(); a.remove()
    } catch (e) { if (!expirat()) show('Descărcare: ' + mesajEroareCoresp(e), 'error') }
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
                  {poateAproba(r, esteOwner) && <BtnAproba fa={fisierDeAprobat(fisiereRand(fisiere, r.id))} lucru={lucru || seIncarca} onClick={() => aproba(r)} />}
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
        orfane={orfaneRand?.randId === randFis.id ? orfaneRand : null} onClose={() => !lucru && setFisPentru(null)} onUrca={form => urca(randFis, form)}
        onInregistreaza={(o, rol, obs) => inregistreazaOrfan(randFis, o, rol, obs)} onDescarca={descarca} />}
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

// Modalul de fișiere al unui rând: listă + descărcare (toți) și urcare / înregistrarea fișierelor neînregistrate (admin / editor).
// Fără ștergere / înlocuire: fișierele sunt imutabile.
export function ModalFisiere({ rand, fisiere, poateScrie, lucru, orfane, onClose, onUrca, onInregistreaza, onDescarca }) {
  const roluri = roluriPermise(rand)
  const [form, setForm] = useState({ rol: roluri[0], fisier: null, observatii: '' })
  const [rolOrfan, setRolOrfan] = useState(roluri[0])
  const [cheieInput, setCheieInput] = useState(0)   // resetarea <input type=file> după urcare
  const deAprobat = fisierDeAprobat(fisiere)
  const rol = roluri.includes(form.rol) ? form.rol : roluri[0]
  const rolO = roluri.includes(rolOrfan) ? rolOrfan : roluri[0]
  const trimite = async () => {
    if (await onUrca({ ...form, rol })) { setForm({ rol: roluri[0], fisier: null, observatii: '' }); setCheieInput(k => k + 1) }
  }
  return (
    <Modal titlu={`Fișierele corespondenței ${rand.cod}`} onClose={onClose} latime={780}>
      <div style={{ fontSize:12.5, color:G.muted, marginBottom:10 }}>{rand.subiect} → {rand.destinatar}</div>
      {fisiere.length === 0 ? <Gol text="Niciun fișier urcat." /> : (
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead><tr>{['Rol', 'Fișier', 'Urcat', 'Mărime', 'SHA-256 declarat', ''].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>{fisiere.map(f => (
              <tr key={f.id}>
                <td style={{ ...S.td, whiteSpace:'nowrap' }}>{etichetaRolFisier(f.rol)}
                  {f.id === rand.aprobat_fisier_id && rand.aprobat_la ? <div style={{ fontSize:11, color:G.green, fontWeight:700 }}>✓ aprobat</div> : null}
                  {f.id === deAprobat?.id && !rand.aprobat_la ? <div style={{ fontSize:11, color:G.muted }}>se aprobă acesta</div> : null}</td>
                <td style={S.td}>{numeFisier(f)}{f.observatii ? <div style={{ fontSize:11.5, color:G.muted }}>{f.observatii}</div> : null}</td>
                <td style={{ ...S.td, whiteSpace:'nowrap' }}>{fmtDateTime(f.created_at)}</td>
                <td style={{ ...S.td, whiteSpace:'nowrap' }}>{fmtMarime(f.marime)}</td>
                <td style={{ ...S.td, ...S.mono }} title={`SHA-256 declarat de cel care a urcat: ${f.sha256}\neTag Storage (amprenta serverului): ${f.storage_etag || '-'}`}>{sha8(f.sha256)}</td>
                <td style={S.td}><button style={S.btnX} onClick={() => onDescarca(f)}>⬇ Descarcă</button></td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
      {poateScrie && orfane && (orfane.lista === null || orfane.lista.length > 0 || orfane.eroare) && (
        <div style={{ border:`1px solid ${G.yellow}`, borderRadius:8, marginTop:12, padding:10 }}>
          <div style={{ fontSize:12.5, fontWeight:700, color:G.yellow, marginBottom:6 }}>Fișiere urcate dar neînregistrate</div>
          {orfane.lista === null ? <div style={{ fontSize:12, color:G.muted }}>Se verifică folderul…</div> : orfane.eroare ? <div style={{ fontSize:12, color:G.red }}>{orfane.eroare}</div> : <>
            <div style={{ fontSize:11.5, color:G.muted, marginBottom:6 }}>Sunt în Storage, dar fără rând în evidență (înregistrarea a eșuat sau nu s-a confirmat). Nu le urca din nou: înregistrează-le.
              Din aplicație nu se șterg (vezi README Redări).</div>
            <Camp eticheta="Rol la înregistrare"><select style={{ ...S.select, width:'100%' }} value={rolO} onChange={e => setRolOrfan(e.target.value)}>
              {roluri.map(c => <option key={c} value={c}>{etichetaRolFisier(c)}</option>)}
            </select></Camp>
            {orfane.lista.map(o => (
              <div key={o.path} style={{ display:'flex', alignItems:'center', gap:8, marginTop:6, fontSize:12.5 }}>
                <span style={{ ...S.mono, flex:1, wordBreak:'break-all' }}>{o.nume}</span>
                <span style={{ color:G.muted }}>{fmtMarime(o.marime)}</span>
                <button style={S.btnX} onClick={() => onInregistreaza(o, rolO, '')} disabled={lucru}>Înregistrează</button>
              </div>))}
          </>}
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
          <div style={{ fontSize:11, color:G.dim, marginTop:6 }}>Fișierele urcate nu se mai modifică și nu se șterg; o variantă nouă se urcă separat. SHA-256 e cel calculat în browserul celui care a urcat.</div>
        </div>
      )}
    </Modal>
  )
}
