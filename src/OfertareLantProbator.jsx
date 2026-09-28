import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase.js'
import { compuneLant, LIPSA } from './ofertareLantProbator.js'
import { incarcaLantProbator } from './ofertareLantProbatorDate.js'

const text = v => v == null || v === '' ? LIPSA : String(v)
const daNu = v => v === true ? 'da' : v === false ? 'nu' : LIPSA
const dataOra = v => v ? new Date(v).toLocaleString('ro-RO') : LIPSA

export default function LantProbator({ licId, cerintaId, actualizare, profiluri, G, S }) {
  const [rezultat, setRezultat] = useState(null)
  const [incarcare, setIncarcare] = useState(true)
  const [reluare, setReluare] = useState(0)
  useEffect(() => {
    let activ = true
    setIncarcare(true)
    setRezultat(null)
    incarcaLantProbator(supabase, licId, cerintaId).then(r => {
      if (activ) { setRezultat(r); setIncarcare(false) }
    }).catch(e => {
      if (activ) { setRezultat({ erori: { general: e.message || String(e) } }); setIncarcare(false) }
    })
    return () => { activ = false }
  }, [licId, cerintaId, actualizare, reluare])

  const nume = id => profiluri?.get(id) || text(id)
  const camp = (titlu, valoare) => <div><span style={{ color:G.muted }}>{titlu}: </span>{text(valoare)}</div>
  const card = { padding:10, marginTop:8, border:`1px solid ${G.border2}`, borderRadius:6, overflowWrap:'anywhere' }
  const randAcoperire = a => <div key={a.id} style={{ ...card, borderColor:a.reverificare_ceruta ? G.red : G.border2 }}>
    <div style={{ color:a.dovada ? G.green : a.reverificare_ceruta ? G.red : G.yellow, fontWeight:700 }}>{a.verificare}</div>
    {camp('Mod / status', `${text(a.mod)} / ${text(a.status)}`)}
    {camp('Candidat ales', `${daNu(a.ales)} · ales de: ${nume(a.ales_de)}`)}
    {a.candidati.length ? a.candidati.map((c, i) => <div key={i}>{c.tip} #{text(c.id)} · {c.descriere}</div>) : camp('Candidat', LIPSA)}
    {camp('Referință', a.referinta_text)}
    {camp('Verificat pe scan', `${daNu(a.verificat_pe_scan)} · de: ${nume(a.verificat_de)} · când: ${dataOra(a.verificat_la)}`)}
    {camp('Reverificare cerută', daNu(a.reverificare_ceruta))}
    {camp('Motiv reverificare', a.reverificare_motiv)}
    <div style={{ color:a.valabil_la_depunere === false ? G.red : G.text }}>{camp('Valabil la depunere', daNu(a.valabil_la_depunere))}</div>
  </div>
  const erori = rezultat?.erori || {}
  const lant = compuneLant(rezultat || {})
  const c = lant.cerinta.rand
  const sectiune = (titlu, chei, continut) => {
    const probleme = ['general', 'cerinta', ...chei].filter((k, i, arr) => arr.indexOf(k) === i && erori[k])
    return <section style={{ marginTop:14, paddingTop:10, borderTop:`1px solid ${G.border2}` }}>
      <h4 style={{ margin:'0 0 6px', fontSize:13 }}>{titlu}</h4>
      {probleme.length ? <div role="alert" style={{ color:G.red }}>Nu s-a putut citi: {probleme.map(k => `${k}: ${erori[k]}`).join(' · ')}</div> : continut}
    </section>
  }

  return <aside aria-label="Lanțul dovezii" style={{ ...S.card, padding:14, marginBottom:12, color:G.text, fontSize:12, lineHeight:1.6 }}>
    <div style={{ display:'flex', gap:12, alignItems:'center', justifyContent:'space-between' }}>
      <h3 style={{ margin:0, fontSize:15 }}>🔗 Lanțul dovezii · cerința #{cerintaId}</h3>
      <button type="button" style={S.btn} disabled={incarcare} onClick={() => setReluare(n => n + 1)}>Reîncarcă</button>
    </div>
    {incarcare ? <div role="status" style={{ color:G.muted }}>Se încarcă dovezile…</div> : <>
      {sectiune('1. Cerința', [], c ? <>
        <div style={{ whiteSpace:'pre-wrap' }}>{text(c.text_cerinta)}</div>
        {camp('Versiune', c.versiune)}
        {erori.documente && <div role="alert" style={{ color:G.red }}>Documente indisponibile: {erori.documente}</div>}
        {camp('Document sursă', lant.cerinta.document?.nume_original || (c.sursa_document_id ? `#${c.sursa_document_id} · ${LIPSA}` : LIPSA))}
        {camp('Secțiune / pagină', `${text(c.sursa_sectiune)} / ${text(c.sursa_pagina)}`)}
        {camp('Pasaj', c.sursa_pasaj)}
        {camp('Pasaj verificat', daNu(c.pasaj_verificat))}
        {camp('Înlocuită de', c.inlocuita_de == null ? 'nicio versiune ulterioară înregistrată' : `#${c.inlocuita_de}`)}
        {erori.raspunsSet ? <div role="alert" style={{ color:G.red }}>Set de răspuns indisponibil: {erori.raspunsSet}</div>
          : camp('Setul de răspuns', c.raspuns_set_id ? `#${c.raspuns_set_id} · ${text(lant.cerinta.raspunsSet?.titlu)} · ${text(lant.cerinta.raspunsSet?.data_raspuns)}` : LIPSA)}
        {erori.istoric ? <div role="alert" style={{ color:G.red }}>Istoric indisponibil: {erori.istoric}</div>
          : lant.cerinta.anterioare.randuri.length ? lant.cerinta.anterioare.randuri.map(v => <details key={v.id} style={card}>
            <summary style={{ cursor:'pointer' }}>Versiunea anterioară v{text(v.versiune)} · cerința #{v.id}</summary>
            <div style={{ whiteSpace:'pre-wrap' }}>{text(v.text_cerinta)}</div>
            {camp('Document / pagină', `${v.document?.nume_original || text(v.sursa_document_id)} / ${text(v.sursa_pagina)}`)}
            {camp('Pasaj', v.sursa_pasaj)}
            {camp('Pasaj verificat', daNu(v.pasaj_verificat))}
            {camp('Înlocuită de', `#${v.inlocuita_de}`)}
            {camp('Snapshot acoperire', v.acoperire_snapshot ? `${dataOra(v.acoperire_snapshot.la)} · set #${text(v.acoperire_snapshot.set_id)} · ${text(v.acoperire_snapshot.set_titlu)}` : LIPSA)}
            <div style={{ color:G.muted }}>Acoperiri istorice, păstrate înainte de înlocuirea cerinței:</div>
            {v.acopeririIstorice.length ? v.acopeririIstorice.map(randAcoperire) : LIPSA}
          </details>) : camp('Versiune anterioară', lant.cerinta.anterioare.lipsa)}
      </> : lant.cerinta.lipsa)}
      {sectiune('2. Acoperirea', ['acoperire'], lant.acoperire.randuri.length ? lant.acoperire.randuri.map(randAcoperire) : lant.acoperire.lipsa)}
      {sectiune('3. Dovezile PT', ['legaturi', 'dovezi', 'documente'], lant.dovezi.randuri.length ? lant.dovezi.randuri.map(d => <div key={d.id} style={card}>
        {camp('Tip / legătură', `${text(d.tip_dovada)} / #${d.legatura_id}`)}
        {camp('Document', d.document?.nume_original || (d.document_id ? `#${d.document_id}` : null))}
        {camp('Autorizație / document firmă', `${text(d.autorizatie_id)} / ${text(d.doc_firma_id)}`)}
        {camp('Fișier', d.fisier_path)}
        {camp('Revizie document', d.document_revizie)}
        {camp('Locator local', d.locator_local)}
        {camp('Pagină locală / globală', `${text(d.pagina_locala)} / ${text(d.pagina_globala)}`)}
        {camp('Notă', d.nota)}
        {camp('Adăugată de / când', `${nume(d.creat_de)} / ${dataOra(d.created_at)}`)}
      </div>) : lant.dovezi.lipsa)}
      {sectiune('4. Legăturile cu capitole', ['legaturi', 'capitole'], lant.legaturi.randuri.length ? lant.legaturi.randuri.map(l => <div key={l.id}
        style={{ ...card, borderColor:l.stare === 'blocata' ? G.red : l.versiuneVeche ? G.orange : G.border2 }}>
        <div style={{ color:l.stare === 'blocata' ? G.red : G.text, fontWeight:700 }}>{l.stare === 'blocata' ? '⛔ Blocată' : text(l.stare)} · {text(l.fel)}</div>
        {camp('Capitol', l.capitol ? `${l.capitol.eticheta || l.capitol.nr}. ${l.capitol.titlu}` : LIPSA)}
        {camp('Versiune verificată / curentă', `${text(l.verificat_la_versiunea)} / ${text(l.capitol?.versiune)}`)}
        {l.versiuneVeche && <div style={{ color:G.orange, fontWeight:700 }}>⚠ Verificare pe versiune veche — necesită reverificare</div>}
        {camp('Verificat de / când', `${nume(l.confirmat_de)} / ${dataOra(l.confirmat_la)}`)}
        {camp('Constatare', l.constatare)}
        {camp('Locator răspuns', l.locator_raspuns)}
        {camp('Motiv excepție', l.motiv)}
      </div>) : lant.legaturi.lipsa)}
      {sectiune('5. Clarificări care o ating', ['clarificari'], lant.clarificari.randuri.length ? lant.clarificari.randuri.map(q => <div key={q.id} style={card}>
        <b>#{q.nr ?? q.id} · {text(q.status)}</b>
        {camp('Legătura înregistrată', q.sursa)}
        {camp('Întrebare', q.intrebare)}
        {camp('Răspuns', q.raspuns)}
      </div>) : lant.clarificari.mesajLipsa)}
      {sectiune('6. Fișierul final', ['pachet', 'fisiere', 'legaturi', 'capitole'], <>
        {camp('Ultimul pachet', lant.fisierFinal.pachet ? `v${lant.fisierFinal.pachet.versiune} · ${lant.fisierFinal.pachet.stare}` : LIPSA)}
        {lant.fisierFinal.randuri.length ? lant.fisierFinal.randuri.map(f => <div key={f.id} style={card}>
          {camp('Nume', f.nume)}
          <div title={f.sha256}>{camp('SHA-256', f.sha256 ? `${f.sha256.slice(0, 16)}…` : LIPSA)}</div>
          {camp('Versiunea sursei', f.sursa_versiune)}
          {f.capitole.map(k => <div key={k.id} style={{ color:k.depasit ? G.orange : G.text }}>
            Capitol #{k.id} · {k.titlu} · sursa v{k.versiuneSursa} / curentă v{text(k.versiuneCurenta)}
            {k.depasit && ' · ⚠ fișierul folosește o versiune veche'}
          </div>)}
        </div>) : <div>{LIPSA} · niciun fișier de propunere cu capitolul identificat în manifestul ultimului pachet</div>}
        {lant.fisierFinal.capitoleFaraFisier.map(k => <div key={k.id} style={{ color:G.orange }}>
          Capitol #{k.id} · {k.titlu}: {LIPSA} în fișierele de propunere ale ultimului pachet
        </div>)}
      </>)}
    </>}
  </aside>
}
