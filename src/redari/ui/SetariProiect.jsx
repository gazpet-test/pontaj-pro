/* SetariProiect.jsx — Redări faza 2, felia 1: datele proiectului care intră în convocator / adresa UAT / PV (contract, împuternicire,
   reprezentanți, contact, texte GDPR + declarație). Scrie doar admin (RLS red_proiecte_upd = admin); ceilalți văd în citire.
   Textele GDPR / declarație sunt confirmate de Proiectul Juridic (01.11.2026) — schimbarea lor cere confirmare explicită. */
import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase.js'
import { G, S, msgEroare, motivBlocareConvocator, citestePaginat } from './comune.jsx'
import { CAMPURI_PROIECT, COL_PROIECT, normalizeaza, cheiSchimbate, valideazaProiect, conflicteConcurente, contractDinExecutie } from '../setari.js'
import FormularCampuri from './FormularCampuri.jsx'
import AutorizareTgz from './AutorizareTgz.jsx'
import { verificaDateCerereImputernicire, genereazaCerereImputernicire, descarcaBlob } from '../docx.js'

export default function SetariProiect({ proiect, uats = [], nivel, esteOwner = false, show, onSchimbat }) {
  const esteAdmin = nivel === 'admin'
  // Jakarinos f2 r1 P2: modificările se calculează față de BAZA formularului (rândul la deschidere / după propria salvare), nu față de
  // `proiect` reîncărcat — altfel o schimbare făcută între timp de alt admin ar apărea ca „modificare” și ar fi rescrisă cu valoarea veche.
  const [baza, setBaza] = useState(() => ({ ...proiect }))
  const [form, setForm] = useState(() => ({ ...proiect }))
  const [lucru, setLucru] = useState(false)
  const [erori, setErori] = useState([])
  const [montaj, setMontaj] = useState(null)
  const [eroareMontaj, setEroareMontaj] = useState('')
  const generatie = useRef(0)
  const ocupat = useRef(false)
  const [nrDocument, setNrDocument] = useState('')
  const proiectCurent = useRef(proiect.id)
  proiectCurent.current = proiect.id
  useEffect(() => {
    const token = ++generatie.current
    ocupat.current = false; setLucru(false); setNrDocument('')
    setBaza({ ...proiect }); setForm({ ...proiect }); setErori([])
    setMontaj(null); setEroareMontaj('')
    const curent = () => generatie.current === token
    citestePaginat(() => supabase.from('executie_proiecte').select('id, nume, cod_intern').eq('activ', true), { cheie: 'id', esteCurent: curent })
      .then(data => { if (curent()) setMontaj(data) })
      .catch(e => { if (curent()) setEroareMontaj(e?.code === '42501' ? 'fără acces la Execuție' : 'Lista Execuție nu poate fi citită: ' + msgEroare(e)) })
    return () => { generatie.current++ }
  }, [proiect.id])
  const preiaContract = async () => {
    if (!esteAdmin || lucru || ocupat.current || !form.executie_proiect_id) return
    ocupat.current = true
    setLucru(true)
    const token = generatie.current
    const legatura = form.executie_proiect_id
    const curent = () => generatie.current === token
    try {
      const { data, error } = await supabase.from('executie_proiecte').select('nr_contract, data_contract, coordonator_transgaz').eq('id', legatura).maybeSingle()
      if (!curent()) return
      if (error) throw error
      if (!data) throw new Error('Proiectul de montaj nu este vizibil: fără acces la Execuție')
      // Copilot f2b r1 P2-2: data din sufixul „nr/zz.ll.aaaa” nu se pierde; data din Execuție are prioritate; nepotrivirea se spune; null nu șterge ce există
      const c = contractDinExecutie(data)
      setForm(f => f && ({ ...f, contract_nr: c.contract_nr ?? f.contract_nr, contract_data: c.contract_data ?? f.contract_data, reprezentant_tgz_nume: c.reprezentant_tgz_nume ?? f.reprezentant_tgz_nume }))
      if (c.avertisment) show('Atenție: ' + c.avertisment + '. Am preluat data din Execuție; verifică înainte să salvezi.', 'error')
      else show('Contract preluat în formular. Salvează explicit modificările.', 'info')
    } catch (e) { if (curent()) show('Preluare contract: ' + msgEroare(e), 'error') }
    finally { if (curent()) { ocupat.current = false; setLucru(false) } }
  }
  const schimbate = cheiSchimbate(baza, form, CAMPURI_PROIECT)
  const lipsuriCerere = verificaDateCerereImputernicire({ proiect, uats })
  const genereazaCererea = async () => {
    if (!esteAdmin || lucru || ocupat.current || schimbate.length) return   // lipsurile se verifică pe datele PROASPETE, mai jos (Copilot f3a r2 P3-01)
    ocupat.current = true
    setLucru(true)
    const token = generatie.current, id = proiect.id
    const curent = () => generatie.current === token && proiectCurent.current === id
    try {
      // Copilot f3a r1 P2-01/P2-02 + Gemini P2: documentul se face din rândul PROASPĂT al proiectului și din lista ACTUALĂ a UAT-urilor
      // (nu din props, care pot fi în urmă față de alt admin); la altă versiune a proiectului se cere confirmare, ca la adresa UAT.
      const [{ data: proiectProaspat, error: ep }, uatsProaspete] = await Promise.all([
        supabase.from('red_proiecte').select(COL_PROIECT).eq('id', id).maybeSingle(),
        citestePaginat(() => supabase.from('red_uat').select('id, nume').eq('proiect_id', id), { cheie: 'id', esteCurent: curent }),
      ])
      if (!curent()) return
      if (ep) throw ep
      if (!proiectProaspat) throw new Error('Proiectul nu mai e vizibil (fără drept pe modul?)')
      // Gemini f3a r2 P3: referința e versiunea formularului (baza), nu props-ul care poate fi deja reîncărcat
      if (proiectProaspat.versiune !== baza.versiune && !window.confirm(
        `Proiectul a fost modificat între timp de altcineva (versiunea ${proiectProaspat.versiune}, tu vezi versiunea ${baza.versiune}).\nGenerez cererea cu datele ACTUALE din bază?`)) return
      const lipsuri = verificaDateCerereImputernicire({ proiect: proiectProaspat, uats: uatsProaspete })
      if (lipsuri.length) throw new Error('Datele actuale nu permit generarea: ' + lipsuri.join('; '))
      const raspuns = await fetch('/redari/sabloane/cerere_imputernicire.docx')
      if (!curent()) return
      if (!raspuns.ok) throw new Error('Șablonul cererii nu poate fi descărcat')
      const templateArrayBuffer = await raspuns.arrayBuffer()
      if (!curent()) return
      const { blob } = await genereazaCerereImputernicire({ proiect: proiectProaspat, uats: uatsProaspete, nrDocument, templateArrayBuffer })
      if (!curent()) return
      // Copilot f3a r1 P3-01: recitire finală — un singur mesaj: succes SAU „generat, dar datele s-au schimbat între timp”
      // Copilot f3a r2 P2-01: se recitesc ACELEAȘI rânduri red_uat (id, nume) și se compară lista normalizată cu cea folosită la generare
      const semnaturaUat = lista => lista.map(u => `${u.id}|${String(u.nume ?? '').trim()}`).sort().join('\n')
      let prDupa = null, uatsDupa = null, eroareFinala = null
      try {
        const rez = await Promise.all([
          supabase.from('red_proiecte').select('versiune').eq('id', id).maybeSingle(),
          citestePaginat(() => supabase.from('red_uat').select('id, nume').eq('proiect_id', id), { cheie: 'id', esteCurent: curent }),
        ])
        if (rez[0].error) throw rez[0].error
        prDupa = rez[0].data; uatsDupa = rez[1]
      } catch (e) { eroareFinala = e }
      if (!curent()) return
      descarcaBlob(blob, `Cerere_imputernicire_${proiectProaspat.cod}.docx`)
      const neverificat = !!eroareFinala || !prDupa || !Array.isArray(uatsDupa)
      const schimbat = !neverificat && (prDupa.versiune !== proiectProaspat.versiune || semnaturaUat(uatsDupa) !== semnaturaUat(uatsProaspete))
      if (neverificat) show('Document generat, dar NU am putut verifica dacă proiectul s-a schimbat între timp. Reîncarcă și generează din nou înainte de a-l folosi. Nu pleacă nicăieri automat.', 'error')
      else if (schimbat) show('Atenție: proiectul sau UAT-urile s-au schimbat în timpul generării. Documentul poate avea date vechi — generează din nou. Nu pleacă nicăieri automat.', 'error')
      else show('Document generat pentru verificare. Nu pleacă nicăieri automat.', 'success')
    } catch (e) { if (curent()) show('Generare cerere: ' + msgEroare(e), 'error') }
    finally { if (curent()) { ocupat.current = false; setLucru(false) } }
  }
  // alt admin a salvat între timp: versiunea din părinte e mai nouă decât baza (propria salvare crește baza imediat — Copilot f2 r2 P3)
  const altaVersiune = (proiect.versiune ?? 0) > (baza.versiune ?? 0)
  // ce lipsește la nivel de proiect pentru convocator (UAT-ul fictiv „complet” izolează doar cerințele proiectului)
  const lipsaProiect = motivBlocareConvocator(proiect, { sesiune_zi1: 'x', program_zi1: 'x' }, null)

  const salveaza = async () => {
    const e = valideazaProiect(form)
    setErori(e)
    if (e.length) return
    if (!schimbate.length) { show('Nimic de salvat.', 'info'); return }
    if (lucru) return
    const sensibile = CAMPURI_PROIECT.filter(c => c.sensibil && schimbate.includes(c.cheie)).map(c => c.eticheta)
    if (sensibile.length && !window.confirm(
      `Schimbi ${sensibile.join(' și ')}.\nTextele actuale sunt cele confirmate de Juridic și apar în convocatoare și în formularul public.\n\nContinui?`)) return
    const tot = normalizeaza(form, CAMPURI_PROIECT)
    const patch = Object.fromEntries(schimbate.map(k => [k, tot[k]]))
    if (ocupat.current) return
    ocupat.current = true
    const token = generatie.current
    const curent = () => generatie.current === token
    setLucru(true)
    try {
      // Copilot f2 r2 P2: citesc rândul de acum; dacă altcineva a schimbat ACELEAȘI câmpuri, întreb; scriu doar pe versiunea verificată
      const { data: acum, error: ea } = await supabase.from('red_proiecte').select(COL_PROIECT).eq('id', proiect.id).maybeSingle()
      if (!curent()) return
      if (ea) throw ea
      if (!acum) throw new Error('Proiectul nu mai e vizibil (fără drept pe modul?)')
      if (acum.versiune !== baza.versiune) {
        const conf = conflicteConcurente(baza, acum, schimbate)
        const etichete = conf.map(k => CAMPURI_PROIECT.find(c => c.cheie === k)?.eticheta || k)
        if (conf.length && !window.confirm(`Alt administrator a schimbat între timp: ${etichete.join(', ')}.\nSuprascrii cu valorile tale?`)) return
      }
      const { data, error } = await supabase.from('red_proiecte').update(patch).eq('id', proiect.id).eq('versiune', acum.versiune).select(COL_PROIECT)
      if (!curent()) return
      if (error) throw error
      if (!data?.length) throw new Error('Nu s-a salvat: proiectul a fost modificat chiar acum de altcineva sau nu ai drept de administrator. Reîncarcă și reîncearcă.')
      setBaza({ ...data[0] }); setForm({ ...data[0] })
      show('Setările proiectului au fost salvate.', 'success')
      onSchimbat()
    } catch (err) { if (curent()) show('Salvare proiect: ' + msgEroare(err), 'error') }
    finally { if (curent()) { ocupat.current = false; setLucru(false) } }
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
        <div style={{ marginBottom: 14 }}>
          <div style={{ color: G.muted, marginBottom: 8 }}>Proiect de montaj (Execuție)</div>
          {esteAdmin && montaj && montaj.length > 0 && !eroareMontaj ? <select style={{ ...S.select, width:'100%', maxWidth:'100%', boxSizing:'border-box', textOverflow:'ellipsis' }} disabled={lucru}
            value={form.executie_proiect_id ?? ''} onChange={e => { if (!lucru) setForm(f => ({ ...f, executie_proiect_id: e.target.value ? Number(e.target.value) : null })) }}>
            <option value="">Fără legătură</option>
            {form.executie_proiect_id && !montaj.some(p => p.id === Number(form.executie_proiect_id)) && <option value={form.executie_proiect_id}>Proiect legat #{form.executie_proiect_id} (inactiv sau fără acces)</option>}
            {montaj.map(p => <option key={p.id} value={p.id}>{p.cod_intern} — {p.nume}</option>)}
          </select> : <div>{eroareMontaj || (montaj ? 'fără acces la Execuție sau niciun proiect activ vizibil' : 'Se încarcă Execuție…')} · {form.executie_proiect_id ?? 'fără legătură'}</div>}
          {esteAdmin && <button style={{ ...S.btnS, marginLeft: 8 }} disabled={lucru || !form.executie_proiect_id || !!eroareMontaj || !montaj?.length} onClick={preiaContract}>Preia contractul din Execuție</button>}
        </div>
        <FormularCampuri campuri={CAMPURI_PROIECT.filter(c => c.cheie !== 'executie_proiect_id')} form={form} doarCitire={!esteAdmin} blocat={lucru} schimbate={schimbate}
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
      <AutorizareTgz proiect={proiect} esteOwner={esteOwner} show={show} onSchimbat={onSchimbat} />
      {esteAdmin && <div style={{ ...S.card, marginTop: 12 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 4px' }}>Cerere de împuternicire către Beneficiar (anexă la scrisoarea către TGZ)</h3>
        <p style={{ color: G.muted }}>DRAFT Juridic, de validat de avocat. Documentul se descarcă pentru verificare.</p>
        <label>Nr. înregistrare (opțional){' '}
          <input style={S.input} value={nrDocument} disabled={lucru} onChange={e => { if (!lucru) setNrDocument(e.target.value) }} />
        </label>
        {lipsuriCerere.length > 0 && <div style={{ color: G.yellow, marginTop: 10 }}>
          <div style={{ fontSize: 12 }}>Pe datele afișate lipsesc (la generare se verifică datele actuale din bază):</div>
          {lipsuriCerere.map(l => <div key={l}>{l}</div>)}
        </div>}
        {schimbate.length > 0 && <p style={{ color: G.yellow }}>Salvează modificările înainte de generare.</p>}
        <button style={{ ...S.btnS, marginTop: 10 }} disabled={lucru || schimbate.length > 0}
          onClick={genereazaCererea}>📄 Generează cererea (DOCX)</button>
      </div>}
    </div>
  )
}
