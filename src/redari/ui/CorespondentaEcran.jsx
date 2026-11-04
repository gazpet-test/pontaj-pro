/* CorespondentaEcran.jsx — Redări: „Corespondență de trimis” (cerere Răzvan 03.11.2026): ce mailuri / adrese pleacă, în ce ordine, de la cine,
   în ce stare sunt. EVIDENȚĂ — ERP-ul nu trimite nimic. „Aprobat” îl pune doar Răzvan (owner); „Trimis” doar după aprobare (garda e în BD).
   Scriu admin/editor (RLS); viewer vede doar. Salvările folosesc versiunea citită (CAS): dacă altcineva a modificat rândul între timp, nu se suprascrie.
   Fișiere (20261130e, decizia Răzvan 04.11): „📎 n” pe fiecare rând — descarcă oricine are acces la Redări, urcă admin/editor; fișierele sunt imutabile.
   Aprobarea se leagă de ultimul fișier „de trimis” (BD: aprobat_fisier_id + aprobat_sha256); un „de trimis” nou după aprobare o face să cadă. */
import React, { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase.js'
import { G, S, Modal, Camp, Gol, fmtDate, fmtDateTime } from './comune.jsx'
import { etichetaRolFisier, ACCEPT_FISIER_CORESP, roluriPermise, valideazaFisierCoresp, mimeFisier, caleFisierCoresp, folderCoresp, sha8, sha256Hex,
  fisierDeAprobat, fisiereRand, fmtMarime, citesteFisiereProiect, gasesteOrfani, numeDinCale, asiguraObiect, reconciliazaInregistrare, registruIncercari } from '../corespondentaFisiere.js'
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
  const genOrfane = useRef(0)          // Jakarinos r2 J-P3-4 / Copilot C-P3-01: generație separată pentru citirea orfanilor
  const fisPentruRef = useRef(null)    // rândul cu modalul deschis, pentru verificarea rezultatelor vechi
  // Jakarinos r2 J-P2-2: încercarea activă { id, randId, fisier, path, sha, rol, observatii, stare } — calea păstrată ÎNAINTE de upload.
  // r3 J-P2-1 / C-P2-03: modificată DOAR prin id-ul propriu al încercării (registruIncercari) și doar cât sesiunea ecranului e curentă.
  const [incercare, setIncercareSt] = useState(null)
  const incercari = useRef(null)
  if (!incercari.current) incercari.current = registruIncercari(setIncercareSt)
  // Jakarinos r2/r3 P2-01: proiectul curent + un token de SESIUNE a ecranului, invalidat la orice schimbare de proiect (inclusiv A→B→A) și la demontare.
  // O operație veche (salvare / aprobare) verifică tokenul după fiecare await, în catch și în finally: nu mai închide formulare noi, nu mai deblochează
  // alte operații, nu mai anunță și nu mai reîncarcă. Separat de `generatie` (citirile), care crește la fiecare incarca().
  const proiectCurent = useRef(proiect.id)
  const sesiune = useRef(null)
  if (!sesiune.current) sesiune.current = sesiuneEcran()

  const incarca = async () => {
    const token = ++generatie.current, curent = () => token === generatie.current
    genOrfane.current++   // o citire nouă invalidează orice citire de orfani în curs
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
  useEffect(() => { proiectCurent.current = proiect.id; sesiune.current.noua(); setRanduri(null); setFisiere([]); setFisPentru(null); setOrfaneRand(null); incercari.current.reseteaza(); genOrfane.current++; setEditat(null); setLucru(false); incarca(); return () => { generatie.current++; sesiune.current.noua() } }, [proiect.id])

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
    if (!window.confirm(`Aprobi trimiterea ${rand.cod} — ${rand.subiect}\nCătre: ${rand.destinatar}\nDe la: ${rand.expeditor || '-'}?\n\nFișierul aprobat: ${numeFisier(deAprobat)}\nAmprenta serverului (eTag Storage): ${deAprobat.storage_etag || '-'}\n(informativ: SHA-256 declarat la urcare ${sha8(deAprobat.sha256)})\n\nAprobarea doar înregistrează „da”-ul tău; ERP-ul nu trimite nimic.`)) return
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

  // Orfanii rândului (obiecte urcate dar neînregistrate). Doar admin / editor (listarea cere red_storage_sel). Rezultatul se acceptă doar dacă generația,
  // proiectul și rândul deschis sunt încă cele curente (r2 J-P3-4 / C-P3-01).
  const incarcaOrfane = async rand => {
    if (!poateScrie || !rand) return
    const g = ++genOrfane.current, pid = proiectCurent.current
    const curent = () => g === genOrfane.current && pid === proiectCurent.current && fisPentruRef.current === rand.id
    setOrfaneRand({ randId: rand.id, lista: null, eroare: '', incompleta: false })
    try {
      const rez = await gasesteOrfani(supabase, { folder: folderCoresp(proiect.cod, rand.cod), randId: rand.id, esteCurent: curent })
      if (rez === null || !curent()) return
      setOrfaneRand({ randId: rand.id, lista: rez.lista, eroare: '', incompleta: rez.incompleta })
    } catch (e) { if (curent()) setOrfaneRand({ randId: rand.id, lista: [], eroare: mesajEroareCoresp(e), incompleta: true }) }
  }
  useEffect(() => {
    fisPentruRef.current = fisPentru; genOrfane.current++   // schimbare de rând / închiderea modalului invalidează citirea orfanilor
    const r = fisPentru ? (randuri || []).find(x => x.id === fisPentru) : null
    if (r) incarcaOrfane(r); else setOrfaneRand(null)
  }, [fisPentru])

  // Înregistrarea rândului (INSERT + reconciliere pe payload-ul semantic). 'ok' | 'conflict' | 'neconfirmat'; aruncă la refuz clar al BD-ului.
  const inregistreaza = async (rand, { path, rol, nume, mime, marime, sha, observatii }) => {
    const { rez } = await reconciliazaInregistrare(supabase, { corespondenta_id: rand.id, rol, path, nume_original: String(nume || '').slice(0, 255),
      mime, marime, sha256: sha, observatii: String(observatii || '').trim() || null })
    return rez
  }
  const MESAJ_CONFLICT = 'La aceeași cale există deja un fișier înregistrat cu alt rol / altă amprentă declarată. Nu s-a înregistrat nimic nou; verifică lista.'

  // Urcarea: sha256 în browser → calea se PĂSTREAZĂ (state + ref) înainte de upload → upload fără suprascriere → INSERT reconciliat.
  // r2 J-P2-2 / C-P2-01: pentru același fișier ales se refolosește aceeași cale (o reîncercare nu creează alt obiect); o cale nouă doar pentru un fișier nou.
  // Legarea e pe rand.id (nu pe proiectul curent): dacă între timp s-a schimbat proiectul, înregistrarea se face tot pentru rândul ales; UI-ul vechi nu mai anunță.
  const urca = async (rand, form) => {
    if (lucru) return false
    const erori = valideazaFisierCoresp(form.fisier)
    if (!roluriPermise(rand).includes(form.rol)) erori.push('După trimitere / anulare nu se mai urcă „de trimis”.')
    if (String(form.observatii || '').length > 1000) erori.push('Observațiile au cel mult 1000 de caractere.')
    if (erori.length) { show(erori.join(' '), 'error'); return false }
    const expirat = sesiune.current.captureaza(), proiectCod = proiect.cod, reg = incercari.current
    let idInc = null
    // orice schimbare a încercării după un await: doar pentru încercarea PROPRIE și doar dacă sesiunea e curentă
    const marcheaza = patch => { if (idInc !== null && !expirat()) reg.actualizeaza(idInc, patch) }
    setLucru(true)
    try {
      let inc = reg.curenta()
      if (inc && inc.randId === rand.id && inc.fisier === form.fisier && inc.stare !== 'in_curs') {
        reg.actualizeaza(inc.id, { stare: 'in_curs' })   // reluare: aceeași cale, același payload (rol / observații din prima încercare)
      } else {
        const sha = await sha256Hex(form.fisier)
        if (expirat()) return false
        inc = reg.porneste({ randId: rand.id, fisier: form.fisier, sha, rol: form.rol, observatii: String(form.observatii || '').trim() || null, stare: 'in_curs',
          path: caleFisierCoresp({ proiectCod, corespCod: rand.cod, sha256: sha, nume: form.fisier.name }) })
      }
      idInc = inc.id
      const ob = await asiguraObiect(supabase, inc.path, inc.fisier, mimeFisier(inc.fisier))
      if (ob === 'neconfirmat') {
        marcheaza({ stare: 'neconfirmat' })
        if (!expirat()) show(`Urcarea nu s-a confirmat (${inc.path}). Apasă „Reia pe aceeași cale” — nu se creează alt obiect.`, 'error')
        return false
      }
      const rez = await inregistreaza(rand, { path: inc.path, rol: inc.rol, nume: inc.fisier.name, mime: mimeFisier(inc.fisier), marime: inc.fisier.size, sha: inc.sha, observatii: inc.observatii })
      if (rez === 'neconfirmat') {
        marcheaza({ stare: 'neconfirmat' })
        if (!expirat()) { show(`Fișierul e în Storage (${inc.path}), dar înregistrarea nu s-a confirmat. NU îl urca din nou: apasă „Reia pe aceeași cale”.`, 'error'); await incarca(); await incarcaOrfane(rand) }
        return false
      }
      if (rez === 'conflict') {
        marcheaza({ stare: 'refuzat' })
        if (!expirat()) { show(MESAJ_CONFLICT, 'error'); await incarca(); await incarcaOrfane(rand) }
        return false
      }
      marcheaza(null)
      if (expirat()) return true
      show(inc.rol === 'de_trimis' && rand.stare === 'aprobat' ? 'Fișierul a fost urcat. Aprobarea a căzut: rândul a revenit în Draft și cere din nou „da”-ul lui Răzvan.' : 'Fișierul a fost urcat.', 'success')
      await incarca(); await incarcaOrfane(rand)
      return true
    } catch (e) {
      marcheaza({ stare: 'refuzat' })
      if (!expirat()) {
        const inc = idInc !== null ? reg.curenta() : null
        show(inc?.id === idInc ? `Urcarea / înregistrarea a fost refuzată: ${mesajEroareCoresp(e)} (calea ${inc.path}; dacă obiectul a ajuns în Storage, apare la „Fișiere urcate dar neînregistrate”).` : mesajEroareCoresp(e), 'error')
        await incarcaOrfane(rand)
      }
      return false
    } finally { if (!expirat()) setLucru(false) }
  }

  // Copilot r1 C-P2-01: înregistrarea unui obiect deja urcat (orfan): descarcă obiectul, recalculează sha256 în browser, INSERT reconciliat. Fără reupload.
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
      if (rez === 'neconfirmat') show('Înregistrarea nu s-a confirmat; reîncarcă și verifică lista.', 'error')
      else if (rez === 'conflict') show(MESAJ_CONFLICT, 'error')
      else show('Fișierul a fost înregistrat.', 'success')
      const inc = incercari.current.curenta()
      if (rez === 'ok' && inc?.path === obiect.path && inc.stare !== 'in_curs') incercari.current.actualizeaza(inc.id, null)
      await incarca(); await incarcaOrfane(rand)
      return rez === 'ok'
    } catch (e) { if (!expirat()) { show(mesajEroareCoresp(e), 'error'); await incarcaOrfane(rand) } return false } finally { if (!expirat()) setLucru(false) }
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
                  {r.aprobat_la && r.aprobat_fisier_id ? <div style={{ fontSize:11, color:G.blue }} title={`Amprenta serverului (eTag Storage): ${r.aprobat_storage_etag || '-'}\nSHA-256 declarat (informativ): ${r.aprobat_sha256 || '-'}`}>📄 {numeFisier(fisiere.find(x => x.id === r.aprobat_fisier_id)) || 'fișier'} (eTag {r.aprobat_storage_etag || '-'})</div> : null}</td>
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
        incercare={incercare?.randId === randFis.id && ['neconfirmat', 'refuzat'].includes(incercare.stare) ? incercare : null}
        onReia={() => { const i = incercari.current.curenta(); if (i && i.randId === randFis.id) urca(randFis, { fisier: i.fisier, rol: i.rol, observatii: i.observatii }) }}
        onFisierNou={() => { const i = incercari.current.curenta(); if (i?.randId === randFis.id && i.stare !== 'in_curs') incercari.current.actualizeaza(i.id, null) }}
        onReincarcaOrfane={() => incarcaOrfane(randFis)}
        onInregistreaza={(o, rol, obs) => inregistreazaOrfan(randFis, o, rol, obs)} onDescarca={descarca} />}
      <div style={{ fontSize:11.5, color:G.dim, marginTop:10 }}>Stări: {STARI_CORESPONDENTA.map(s => s.eticheta).join(' → ')}. Ce se trimite efectiv (mail / poștă) rămâne la expeditor.</div>
    </div>
  )
}

const numeFisier = f => f ? (f.nume_original || String(f.path || '').split('/').pop()) : ''

// „Aprob” dezactivat până există un fișier „de trimis” (BD refuză oricum: 23514).
export function BtnAproba({ fa, lucru, onClick }) {
  return <button style={{ ...S.btnS, borderColor:G.green, color:G.green, marginRight:6, opacity: fa ? 1 : .45, cursor: fa ? 'pointer' : 'not-allowed' }} onClick={onClick}
    disabled={lucru || !fa} title={fa ? `Aprobi fișierul ${numeFisier(fa)} (eTag ${fa.storage_etag || '-'})` : 'urcă întâi fișierul de trimis'}>✅ Aprob</button>
}

// Modalul de fișiere al unui rând: listă + descărcare (toți) și urcare / înregistrarea fișierelor neînregistrate (admin / editor).
// Fără ștergere / înlocuire: fișierele sunt imutabile.
export function ModalFisiere({ rand, fisiere, poateScrie, lucru, orfane, incercare, onClose, onUrca, onReia, onFisierNou, onReincarcaOrfane, onInregistreaza, onDescarca }) {
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
            <thead><tr>{['Rol', 'Fișier', 'Urcat', 'Mărime', 'eTag (server)', 'SHA-256 declarat', ''].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>{fisiere.map(f => (
              <tr key={f.id}>
                <td style={{ ...S.td, whiteSpace:'nowrap' }}>{etichetaRolFisier(f.rol)}
                  {f.id === rand.aprobat_fisier_id && rand.aprobat_la ? <div style={{ fontSize:11, color:G.green, fontWeight:700 }}>✓ aprobat</div> : null}
                  {f.id === deAprobat?.id && !rand.aprobat_la ? <div style={{ fontSize:11, color:G.muted }}>se aprobă acesta</div> : null}</td>
                <td style={S.td}>{numeFisier(f)}{f.observatii ? <div style={{ fontSize:11.5, color:G.muted }}>{f.observatii}</div> : null}</td>
                <td style={{ ...S.td, whiteSpace:'nowrap' }}>{fmtDateTime(f.created_at)}</td>
                <td style={{ ...S.td, whiteSpace:'nowrap' }}>{fmtMarime(f.marime)}</td>
                <td style={{ ...S.td, ...S.mono, fontSize:11.5, wordBreak:'break-all' }} title="Amprenta serverului: eTag-ul obiectului din Storage la înregistrare">{f.storage_etag || '-'}</td>
                <td style={{ ...S.td, ...S.mono, color:G.muted }} title={`SHA-256 declarat de cel care a urcat (informativ): ${f.sha256}`}>{sha8(f.sha256)}</td>
                <td style={S.td}><button style={S.btnX} onClick={() => onDescarca(f)}>⬇ Descarcă</button></td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
      {poateScrie && incercare && (
        <div style={{ border:`1px solid ${G.red}`, borderRadius:8, marginTop:12, padding:10, fontSize:12.5 }}>
          <div style={{ fontWeight:700, color:G.red, marginBottom:4 }}>{incercare.stare === 'neconfirmat' ? 'Urcare neconfirmată' : 'Urcare refuzată'}</div>
          <div style={{ ...S.mono, wordBreak:'break-all', color:G.muted }}>{incercare.path}</div>
          <div style={{ color:G.muted, marginTop:4 }}>Reia pe aceeași cale: dacă obiectul a ajuns deja în Storage, doar se înregistrează; altfel se urcă o singură dată, fără suprascriere.</div>
          <div style={{ display:'flex', justifyContent:'flex-end', marginTop:6 }}><button style={S.btnS} onClick={onReia} disabled={lucru}>↻ Reia pe aceeași cale</button></div>
        </div>
      )}
      {poateScrie && orfane && (orfane.lista === null || orfane.lista.length > 0 || orfane.eroare || orfane.incompleta) && (
        <div style={{ border:`1px solid ${G.yellow}`, borderRadius:8, marginTop:12, padding:10 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
            <div style={{ fontSize:12.5, fontWeight:700, color:G.yellow, flex:1 }}>Fișiere urcate dar neînregistrate</div>
            <button style={S.btnX} onClick={onReincarcaOrfane} disabled={lucru}>↻</button>
          </div>
          {orfane.incompleta ? <div style={{ fontSize:11.5, color:G.yellow, marginBottom:4 }}>Listă posibil incompletă (listarea Storage nu a fost sigură); reîmprospătează.</div> : null}
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
              onChange={e => { const fisier = e.target.files?.[0] || null; setForm(x => ({ ...x, fisier })); onFisierNou?.() }} /></Camp>
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
