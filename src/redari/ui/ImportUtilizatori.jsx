// Redări PR4b — ecranul importului de utilizatori / arendași (fișierul beneficiarului „Date de contact utilizatori”, coloanele 24–26).
// Pași: fișier → citire + plan (parseazaUtilizatori → citesteDatePlan → planUtilizatori, nimic scris) → previzualizare cu totaluri, tabel pe UAT
// și liste pe categorii → raport CSV → versiunea listei (obligatorie) → confirmare dublă → scrieUtilizatori → rezultat reconstituit din BD.
// Dreptul: același ca importul listei (ImportTgz): admin / editor în interfață; în BD politicile red_detinatori_ins / red_contact_ins /
// red_import_loturi_ins|upd cer fn_red_nivel() IN ('admin','editor'). Nu trimite nimic; convocarea utilizatorilor rămâne după poarta owner-ului (PR3a).
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase.js'
import { parseazaUtilizatori, citesteDatePlan, planUtilizatori, scrieUtilizatori, SURSA_UTILIZATORI } from '../importUtilizatori.js'
import { CATEGORII, totaluriImport, totaluriPeUat, randuriRaport, stareDupaScriere, csvRaportUtilizatori } from '../importUtilizatoriRaport.js'
import { G, S, fmtNum, msgEroare, Camp, Gol } from './comune.jsx'

const MAX_LISTA = 100
const EXPLICATII = {
  nou: 'Se adaugă ca deținător cu calitatea „utilizator” pe parcela existentă, cu adresa din fișier. Cele marcate „poziție HG” au fost potrivite după poziția HG unică în UAT (cheia exactă diferă): verificați-le înainte de import.',
  deja: 'Persoana este deja deținător activ pe aceeași parcelă (proprietar sau utilizator dintr-un import anterior): nu se adaugă a doua oară.',
  negasita: 'Parcela din fișier nu există în proiect (nici după cheie, nici după o poziție HG unică): nu se creează parcele, rândul nu se importă.',
  coliziune: 'Același om pe aceeași parcelă din alt rând al fișierului. Cu adrese diferite, persoana NU se importă (nu se alege automat o adresă).',
  exclus: 'Primul rând al unei coliziuni cu adrese diferite: exclus din import, de verificat împreună cu rândul care îl contrazice.',
  dublura: 'Rând identic (persoană, parcelă, contact) cu un rând anterior din fișier: se numără o singură dată.',
  fara_cheie: 'Fără poziție HG și fără număr cadastral: parcela nu se poate identifica, rândul nu se importă.',
}

const descarcaCsv = (text, nume) => {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a'); a.href = url; a.download = nume; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
const numeFisierCsv = (cod, versiune, eticheta) => `utilizatori-${String(cod || 'proiect')}-${String(versiune || 'fara-versiune').trim()}-${eticheta}.csv`.replace(/[^\w.-]+/g, '_')

export default function ImportUtilizatori({ proiect, uats = [], nivel, show, onImportat }) {
  const poateScrie = nivel === 'admin' || nivel === 'editor'
  const [deschis, setDeschis] = useState(false)
  const [fisier, setFisier] = useState(null)
  const [versiune, setVersiune] = useState('')
  const [preview, setPreview] = useState(null)       // { proiectId, fisier, fisierNume, parsat, plan }
  const [lucru, setLucru] = useState(null)           // null | 'citire' | 'scriere'
  const [eroare, setEroare] = useState(null)         // eroarea citirii / planului (L18: afișată, nu „nimic de importat”)
  const [rezultat, setRezultat] = useState(null)
  const [subTab, setSubTab] = useState('nou')
  const [loturi, setLoturi] = useState(null)
  const [loturiStare, setLoturiStare] = useState({ lucru: false, eroare: null })
  // L24: generații separate pentru citire, scriere și istoric; rezultatele se aplică doar pe ecranul montat, același proiect, același fișier
  const montat = useRef(true)
  const proiectRef = useRef(proiect?.id); proiectRef.current = proiect?.id
  const fisierRef = useRef(null)
  const genPreview = useRef(0), genScriere = useRef(0), genLoturi = useRef(0)
  const ocupat = useRef(false)                       // L05: zăvor sincron, pus înaintea primului await al scrierii
  useEffect(() => { montat.current = true; return () => { montat.current = false; genPreview.current++; genScriere.current++; genLoturi.current++ } }, [])
  useEffect(() => {
    // proiect nou: tot ce ține de proiectul vechi dispare, iar citirile / scrierile în zbor nu se mai aplică aici
    genPreview.current++; genScriere.current++; genLoturi.current++
    fisierRef.current = null
    setFisier(null); setPreview(null); setLucru(null); setEroare(null); setRezultat(null); setLoturi(null); setLoturiStare({ lucru: false, eroare: null })
  }, [proiect?.id])

  const alegeFisier = (f) => {
    // fișier nou: citirea în zbor (dacă e) se abandonează, previzualizarea veche nu mai e a acestui fișier
    genPreview.current++
    fisierRef.current = f || null
    setFisier(f || null); setPreview(null); setEroare(null); setRezultat(null)
    if (lucru === 'citire') setLucru(null)
  }

  const previzualizeaza = async () => {
    if (!fisier) { show('Alege fișierul Excel (.xlsx) cu datele de contact ale utilizatorilor.', 'error'); return }
    if (!uats.length) { show('Proiectul nu are UAT-uri (sau nu s-au încărcat încă).', 'error'); return }
    if (ocupat.current || lucru === 'scriere') { show('O scriere e în curs; așteaptă rezultatul.', 'error'); return }
    const gen = ++genPreview.current; const proiectStart = proiect.id; const f = fisier
    const curent = () => montat.current && gen === genPreview.current && proiectRef.current === proiectStart && fisierRef.current === f
    setLucru('citire'); setPreview(null); setEroare(null); setRezultat(null)
    try {
      if (!/\.xlsx$/i.test(f.name || '')) throw new Error('Fișierul trebuie să fie Excel .xlsx (fișierul beneficiarului „Date de contact utilizatori”).')
      const ab = await f.arrayBuffer()
      if (!curent()) return
      let parsat
      try { parsat = parseazaUtilizatori(ab, { uats: uats.map(u => ({ nume: u.nume, uat3: u.uat3 })) }) }
      catch (e) { throw new Error(`Fișierul nu se poate citi: ${msgEroare(e)}`) }
      if (!parsat?.statistici?.randuri) throw new Error('Fișierul nu are rânduri de date în formatul așteptat (foaia 1, antet pe 3 rânduri, UAT-ul în coloana A). Este fișierul „Date de contact utilizatori”?')
      const date = await citesteDatePlan(supabase, proiectStart)
      if (!curent()) return
      const plan = planUtilizatori(parsat.candidati, date)   // aruncă la „două parcele active cu aceeași cheie” — nimic nu se importă
      setPreview({ proiectId: proiectStart, fisier: f, fisierNume: f.name || null, parsat, plan })
      setSubTab('nou')
      const t = totaluriImport(parsat, plan)
      show(`Previzualizare: ${t.noi} utilizatori noi pe ${t.parcele_noi} parcele (${t.persoane_noi} persoane); nimic nu s-a scris.`, t.noi ? 'success' : 'info')
    } catch (e) {
      if (curent()) setEroare(msgEroare(e))
    } finally { if (curent()) setLucru(null) }
  }

  const t = useMemo(() => (preview ? totaluriImport(preview.parsat, preview.plan) : null), [preview])
  const peUat = useMemo(() => (preview ? totaluriPeUat(preview.parsat, preview.plan, uats) : []), [preview, uats])
  const raport = useMemo(() => (preview ? randuriRaport(preview.parsat, preview.plan) : []), [preview])
  const previewValid = !!preview && preview.proiectId === proiect?.id && preview.fisier === fisier
  const versiuneOk = versiune.trim().length > 0
  const poateImporta = poateScrie && previewValid && versiuneOk && lucru === null && !!t && t.noi > 0
  const poateContacte = poateScrie && previewValid && versiuneOk && lucru === null && !!t && t.noi === 0 && (preview.plan.deja_detinatori || []).some(d => d.contact)

  const incarcaLoturi = async () => {
    const gen = ++genLoturi.current; const proiectId = proiectRef.current
    setLoturiStare({ lucru: true, eroare: null })
    const { data, error } = await supabase.from('red_import_loturi').select('id, created_at, stare, eroare, versiune_lista_tgz, fisier_nume, randuri_total, detinatori_noi, diferente')
      .eq('proiect_id', proiectId).eq('sursa', SURSA_UTILIZATORI).order('created_at', { ascending: false }).limit(20)
    if (!montat.current || gen !== genLoturi.current || proiectId !== proiectRef.current) return
    if (error) { setLoturi(null); setLoturiStare({ lucru: false, eroare: msgEroare(error) }); return }   // L18: eroare ≠ listă goală
    setLoturi(data || []); setLoturiStare({ lucru: false, eroare: null })
  }

  const scrie = async ({ doarContacte = false } = {}) => {
    if (ocupat.current) { show('Importul pornit anterior încă rulează; așteaptă rezultatul.', 'error'); return }   // L05: dublu-click = o singură scriere
    if (!(doarContacte ? poateContacte : poateImporta)) return
    const p = preview, ver = versiune.trim(), proiectStart = proiect.id, cod = proiect.cod
    const intrebare = doarContacte
      ? `Reiei importul utilizatorilor în ${cod} (lista „${ver}”) doar pentru completarea contactelor lipsă?\nNu se adaugă niciun deținător nou; se creează un lot nou în istoricul importurilor.`
      : `Confirmi importul în ${cod}?\n\n${t.noi} utilizatori (${t.persoane_noi} persoane) pe ${t.parcele_noi} parcele, lista „${ver}”.\n${t.potrivire_hg} potriviți după poziția HG (cheia exactă diferă).\n${t.deja_detinatori} deja deținători, ${t.parcela_negasita} cu parcela negăsită și ${t.coliziuni + t.exclusi} în coliziune NU se importă.\n\nNu se creează parcele, nu se schimbă proprietarii și nu se trimite nimic. Utilizatorii nu primesc convocator până când owner-ul aprobă convocarea utilizatorilor în Setări proiect.`
    if (!window.confirm(intrebare)) return
    ocupat.current = true
    const gen = ++genScriere.current
    const curent = () => montat.current && gen === genScriere.current && proiectRef.current === proiectStart
    setLucru('scriere'); setEroare(null); setRezultat(null)
    try {
      let rez = null, eroareScriere = null
      try { rez = await scrieUtilizatori(supabase, p.plan, { proiectId: proiectStart, versiune: ver, fisierNume: p.fisierNume }) }
      catch (e) { eroareScriere = e }
      // starea reală din BD, indiferent de rezultat (L05: după o eroare nu presupunem nici „nimic scris”, nici „tot scris”)
      const lotId = rez?.lotId ?? eroareScriere?.lotId ?? null
      let lot = null, planDupa = null, eroareRecitire = null
      try {
        if (lotId) {
          const { data, error } = await supabase.from('red_import_loturi').select('id, stare, eroare, detinatori_noi, diferente, created_at').eq('id', lotId).maybeSingle()
          if (error) throw error
          lot = data || null
        }
        planDupa = planUtilizatori(p.parsat.candidati, await citesteDatePlan(supabase, proiectStart))
      } catch (e) { eroareRecitire = msgEroare(e) }
      const scrisPosibil = !!rez || (lot?.detinatori_noi ?? 0) > 0 || (!lot && !!eroareScriere?.lotId)
      if (!curent()) {
        show(eroareScriere ? `Importul utilizatorilor în ${cod} a eșuat: ${msgEroare(eroareScriere)}` : `Importul utilizatorilor în ${cod} s-a terminat; rezultatul e în istoricul loturilor acelui proiect.`, eroareScriere ? 'error' : 'info')
        return
      }
      const dupa = stareDupaScriere(p.plan, planDupa, lot)
      setRezultat({ ok: !eroareScriere, rez, eroare: eroareScriere ? msgEroare(eroareScriere) : null, lotNeinchis: eroareScriere?.lotNeinchis || null,
        lotId, lot, planDupa, eroareRecitire, inainte: p, versiune: ver, cod, dupa, doarContacte })
      setPreview(null)   // planul confirmat nu mai e valid după o scriere (reușită sau nu): următorul pas pornește de la o previzualizare nouă
      if (eroareScriere) show('Importul utilizatorilor a eșuat: ' + msgEroare(eroareScriere), 'error')
      else show(`Import terminat: ${rez.detinatoriNoi} utilizatori și ${rez.contacteNoi} contacte noi${rez.sarite || rez.schimbate ? `; ${rez.sarite + rez.schimbate} sărite` : ''}.`, 'success')
      if (scrisPosibil) onImportat?.()
      if (loturi) incarcaLoturi()
    } finally {
      ocupat.current = false
      if (curent()) setLucru(null)
    }
  }

  const statCard = (et, val, culoare = G.text) => <div style={{ ...S.card, padding:'8px 12px', minWidth:110 }}><div style={{ fontSize:11.5, color:G.muted }}>{et}</div><div style={{ fontSize:18, fontWeight:700, color: culoare }}>{val ?? '-'}</div></div>
  const aprobata = proiect?.convocare_utilizatori_aprobata === true

  const listaCategorie = (cod) => {
    const randuri = raport.filter(r => r.categorie === cod)
    if (!randuri.length) return <Gol text="Nimic în această categorie." />
    return (
      <div style={{ overflow:'auto', maxHeight:380 }}>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead><tr>{['Rând', 'UAT', 'Parcelă', 'Nume', 'Adresă', 'Telefon', 'Motiv'].map(k => <th key={k} style={S.th}>{k}</th>)}</tr></thead>
          <tbody>{randuri.slice(0, MAX_LISTA).map((r, i) => (
            <tr key={i}>
              <td style={S.td}>{r.rand ?? '-'}</td><td style={S.td}>{r.uat}</td>
              <td style={{ ...S.td, ...S.mono }}>{r.id_parcela || '-'}{r.potrivire === 'hg' && <span data-marcaj="hg" style={{ ...S.tag, background:G.yellowDim, color:G.yellow, marginLeft:6 }}>poziție HG</span>}</td>
              <td style={S.td}>{r.nume || '-'}</td><td style={S.td}>{r.cu_adresa || '-'}</td><td style={S.td}>{r.cu_telefon || '-'}</td>
              <td style={{ ...S.td, fontSize:12, color:G.muted }}>{r.motiv}</td>
            </tr>))}
          </tbody>
        </table>
        {randuri.length > MAX_LISTA && <div style={{ fontSize:12, color:G.muted, padding:8 }}>… încă {randuri.length - MAX_LISTA} rânduri (toate sunt în raportul CSV).</div>}
      </div>
    )
  }

  return (
    <div style={{ ...S.card, marginTop:12 }} data-sectiune="import-utilizatori">
      <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
        <div style={{ fontWeight:700 }}>Import utilizatori / arendași (date de contact ale utilizatorilor)</div>
        <span style={{ ...S.tag, background: aprobata ? G.greenDim : G.yellowDim, color: aprobata ? G.green : G.yellow }}>convocarea utilizatorilor: {aprobata ? 'aprobată' : 'neaprobată'}</span>
        <div style={{ flex:1 }} />
        <button style={S.btnS} onClick={() => setDeschis(v => !v)}>{deschis ? 'Ascunde' : 'Deschide importul utilizatorilor'}</button>
      </div>
      {deschis && (<>
        <div style={{ fontSize:12.5, color:G.muted, margin:'8px 0 12px' }}>
          Adaugă pe parcelele EXISTENTE ale proiectului persoanele care folosesc terenul (altele decât proprietarul), cu calitatea „utilizator” și adresa din fișier.
          Nu creează parcele, nu schimbă proprietarii și nu trimite nimic. Până când owner-ul aprobă convocarea utilizatorilor (Setări proiect), ei nu primesc convocator.
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:10, alignItems:'end' }}>
          <Camp eticheta="1. Fișierul beneficiarului (.xlsx) — foaia 1, antet pe 3 rânduri">
            <input type="file" accept=".xlsx" onChange={e => alegeFisier(e.target.files?.[0] || null)} style={{ ...S.input, padding:5 }} disabled={lucru === 'scriere'} />
          </Camp>
          <Camp eticheta="Versiunea listei (obligatoriu, fără valoare implicită)">
            <input value={versiune} onChange={e => setVersiune(e.target.value)} style={S.input} placeholder="ex. TGZ 13.07.2026 utilizatori" disabled={lucru === 'scriere'} />
          </Camp>
        </div>
        <div style={{ fontSize:12, color:G.muted, marginTop:4 }}>Versiunea se scrie pe fiecare utilizator importat și pe lot. Formatul folosit la celelalte loturi: „TGZ ZZ.LL.AAAA” (data listei primite), aici urmat de „utilizatori”.</div>
        <div style={{ display:'flex', justifyContent:'flex-end', marginTop:10 }}>
          <button style={S.btnS} onClick={previzualizeaza} disabled={!!lucru || !fisier}>{lucru === 'citire' ? 'Citesc fișierul și parcelele…' : '🔍 2. Citește și previzualizează'}</button>
        </div>
        {eroare && <div data-eroare="citire" style={{ ...S.card, borderColor:G.red, color:G.red, fontSize:13, marginTop:10 }}>Nu am putut pregăti importul: {eroare}<div style={{ color:G.muted, fontSize:12, marginTop:4 }}>Nimic nu s-a scris.</div></div>}

        {preview && t && (
          <div style={{ marginTop:12 }}>
            <div style={{ fontWeight:700, marginBottom:8 }}>3. Previzualizare — nimic nu s-a scris încă</div>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:10 }}>
              {statCard('Rânduri în fișier', fmtNum(t.randuri))}
              {statCard('Cu utilizator', fmtNum(t.cu_utilizator))}
              {statCard('În afara proiectului', fmtNum(t.in_afara_proiectului), G.muted)}
              {statCard('Fără cheie', fmtNum(t.fara_cheie), t.fara_cheie ? G.orange : G.text)}
              {statCard('Dubluri în fișier', fmtNum(t.dubluri_fisier))}
              {statCard('Candidați', fmtNum(t.candidati))}
              {statCard('Noi (rânduri)', fmtNum(t.noi), G.green)}
              {statCard('Persoane noi', fmtNum(t.persoane_noi), G.green)}
              {statCard('Parcele cu utilizatori noi', fmtNum(t.parcele_noi), G.green)}
              {statCard('Deja deținători', fmtNum(t.deja_detinatori), G.blue)}
              {statCard('Parcelă negăsită', fmtNum(t.parcela_negasita), t.parcela_negasita ? G.orange : G.text)}
              {statCard('Coliziuni', fmtNum(t.coliziuni + t.exclusi), (t.coliziuni + t.exclusi) ? G.red : G.text)}
              {statCard('Potrivite după poziția HG', fmtNum(t.potrivire_hg), t.potrivire_hg ? G.yellow : G.text)}
              {statCard('Noi cu adresă', fmtNum(t.cu_adresa))}
              {statCard('Noi cu telefon', fmtNum(t.cu_telefon))}
            </div>
            {t.cu_utilizator === 0 && <div style={{ fontSize:12.5, color:G.yellow, marginBottom:8 }}>⚠ Niciun rând nu are completat utilizatorul (coloana „Prenume și nume”). Verificați că este fișierul corect.</div>}

            <div style={{ overflow:'auto', marginBottom:10 }}>
              <table style={{ borderCollapse:'collapse' }}>
                <thead><tr>{['UAT', 'Candidați', 'Noi', 'Persoane noi', 'Poziție HG', 'Deja deținători', 'Negăsite', 'Coliziuni', 'Fără cheie', 'Dubluri'].map(k => <th key={k} style={S.th}>{k}</th>)}</tr></thead>
                <tbody>{peUat.map(u => (
                  <tr key={u.uat3}><td style={S.td}>{u.nume} <span style={{ color:G.muted }}>({u.uat3})</span></td>
                    {[u.candidati, u.noi, u.persoane, u.potrivire_hg, u.deja, u.negasite, u.coliziuni, u.fara_cheie, u.dubluri].map((v, i) => <td key={i} style={{ ...S.td, textAlign:'right' }}>{fmtNum(v)}</td>)}</tr>))}
                </tbody>
              </table>
            </div>

            <div style={{ display:'flex', gap:4, borderBottom:`1px solid ${G.border2}`, marginBottom:8, flexWrap:'wrap' }}>
              {CATEGORII.filter(c => c.cod !== 'in_afara').map(c => (
                <button key={c.cod} onClick={() => setSubTab(c.cod)} style={{ padding:'6px 10px', background:'transparent', border:'none', borderBottom: subTab === c.cod ? `2px solid ${G.green}` : '2px solid transparent', color: subTab === c.cod ? G.text : G.muted, cursor:'pointer', fontSize:12.5, fontWeight:600 }}>
                  {c.eticheta} ({raport.filter(r => r.categorie === c.cod).length})
                </button>
              ))}
            </div>
            {EXPLICATII[subTab] && <div style={{ fontSize:12, color:G.muted, marginBottom:6 }}>{EXPLICATII[subTab]}</div>}
            {listaCategorie(subTab)}
            <div style={{ fontSize:12, color:G.muted, marginTop:6 }}>Rândurile din UAT-uri din afara proiectului ({fmtNum(t.in_afara_proiectului)}) se numără, nu se importă; sunt în raportul CSV.</div>

            <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', marginTop:12 }}>
              <button style={S.btnS} onClick={() => descarcaCsv(csvRaportUtilizatori(raport), numeFisierCsv(proiect.cod, versiune, 'previzualizare'))}>⬇ 4. Raportul previzualizării (CSV, {raport.length} rânduri)</button>
              <span style={{ fontSize:12, color:G.muted }}>Conține numele utilizatorilor (fără adrese / telefoane): nu se trimite mai departe.</span>
              <div style={{ flex:1 }} />
              {!poateScrie && <span style={{ fontSize:12.5, color:G.muted }}>Doar admin / editor pot importa.</span>}
              {poateScrie && !versiuneOk && <span style={{ fontSize:12.5, color:G.yellow }}>Completează versiunea listei.</span>}
              {poateScrie && t.noi > 0 && <button style={S.btnP} onClick={() => scrie()} disabled={!poateImporta}>{lucru === 'scriere' ? 'Import în curs…' : `📥 Importă ${t.noi} utilizatori pe ${t.parcele_noi} parcele`}</button>}
              {poateScrie && t.noi === 0 && <span style={{ fontSize:12.5, color:G.muted }}>Nimic nou de importat.</span>}
              {poateContacte && <button style={S.btnS} onClick={() => scrie({ doarContacte: true })} title="Doar după un import întrerupt: completează adresa utilizatorilor scriși atunci fără contact; nu adaugă deținători.">Reia doar completarea contactelor lipsă (după un import întrerupt)</button>}
            </div>
          </div>
        )}

        {rezultat && (
          <div data-rezultat={rezultat.ok ? 'ok' : 'esuat'} style={{ ...S.card, borderColor: rezultat.ok ? G.green : G.red, marginTop:12 }}>
            <div style={{ fontWeight:700, marginBottom:8, color: rezultat.ok ? G.text : G.red }}>5. {rezultat.ok ? 'Rezultatul importului' : 'Import eșuat'}
              <span style={{ ...S.tag, marginLeft:8, background: rezultat.lot?.stare === 'finalizat' ? G.greenDim : G.redDim, color: rezultat.lot?.stare === 'finalizat' ? G.green : G.red }}>lot {rezultat.lot?.stare || (rezultat.lotId ? 'stare necitită' : 'necreat')}</span></div>
            {!rezultat.ok && <div style={{ fontSize:13, marginBottom:6 }}>{rezultat.eroare}</div>}
            {rezultat.lotNeinchis && <div style={{ fontSize:12.5, color:G.red, marginBottom:6 }}>Lotul nu a putut fi marcat „eșuat” ({rezultat.lotNeinchis}); a rămas „în curs” în istoric.</div>}
            {rezultat.ok && (
              <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                {statCard('Utilizatori scriși', fmtNum(rezultat.rez.detinatoriNoi), G.green)}
                {statCard('Contacte noi', fmtNum(rezultat.rez.contacteNoi), G.blue)}
                {statCard('Sărite: apărute între timp', fmtNum(rezultat.rez.sarite), rezultat.rez.sarite ? G.orange : G.text)}
                {statCard('Sărite: parcela s-a schimbat', fmtNum(rezultat.rez.schimbate), rezultat.rez.schimbate ? G.orange : G.text)}
              </div>
            )}
            {!rezultat.ok && rezultat.lot && <div style={{ fontSize:12.5, color:G.muted }}>Scriși până la eroare (din lot): {fmtNum(rezultat.lot.detinatori_noi)} utilizatori.</div>}
            <div style={{ fontSize:12, color:G.muted, marginTop:8 }}>Lot: <span style={S.mono}>{rezultat.lotId || '-'}</span> · lista „{rezultat.versiune}” · sursa {SURSA_UTILIZATORI}{rezultat.doarContacte ? ' · doar contacte' : ''}</div>
            {rezultat.eroareRecitire
              ? <div data-eroare="recitire" style={{ fontSize:12.5, color:G.red, marginTop:6 }}>Starea după scriere NU s-a putut reciti din BD ({rezultat.eroareRecitire}): raportul de mai jos o arată „necunoscută”. Refaceți previzualizarea.</div>
              : <div style={{ fontSize:12.5, color:G.muted, marginTop:6 }}>Recitit din BD: {fmtNum((rezultat.inainte.plan.noi || []).filter(n => String(rezultat.dupa.get(n.rand) || '').startsWith('în BD')).length)} din {fmtNum(rezultat.inainte.plan.noi.length)} rânduri noi sunt acum utilizatori activi pe parcelă.</div>}
            {!rezultat.ok && <div style={{ fontSize:12.5, color:G.yellow, marginTop:8 }}>Ce s-a scris rămâne (nu se șterge automat). Refaceți previzualizarea cu același fișier: rândurile deja scrise apar „deja deținători”, iar restul se pot importa din nou.</div>}
            <button style={{ ...S.btnS, marginTop:8 }} onClick={() => descarcaCsv(csvRaportUtilizatori(randuriRaport(rezultat.inainte.parsat, rezultat.inainte.plan, rezultat.dupa), { dupa: true }), numeFisierCsv(rezultat.cod, rezultat.versiune, 'dupa-scriere'))}>⬇ Raportul după scriere (CSV)</button>
          </div>
        )}

        <div style={{ marginTop:12, borderTop:`1px solid ${G.border}`, paddingTop:10 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
            <div style={{ fontWeight:600, fontSize:13 }}>Loturile de import ale utilizatorilor</div>
            <button style={S.btnS} onClick={incarcaLoturi} disabled={loturiStare.lucru}>{loturiStare.lucru ? 'Încarc…' : (loturi ? '↻ Reîncarcă' : 'Arată loturile')}</button>
          </div>
          {loturiStare.eroare && <div style={{ fontSize:12.5, color:G.red, marginTop:6 }}>Nu am putut citi loturile: {loturiStare.eroare}</div>}
          {loturi && (loturi.length === 0 ? <Gol text="Niciun import de utilizatori pe acest proiect." /> : (
            <div style={{ marginTop:6 }}>
              {loturi.map(l => (
                <div key={l.id} style={{ display:'flex', gap:10, padding:'5px 0', borderTop:`1px solid ${G.border}`, fontSize:12.5, flexWrap:'wrap' }}>
                  <span style={S.mono}>{String(l.created_at || '').slice(0, 16).replace('T', ' ')}</span>
                  <span>„{l.versiune_lista_tgz || '-'}” · stare <b>{l.stare}</b> · {fmtNum(l.detinatori_noi)} utilizatori · {fmtNum(l.diferente?.contacte_noi)} contacte</span>
                  <span style={{ color:G.muted }}>{fmtNum(l.diferente?.deja_detinatori?.length ?? 0)} deja · {fmtNum(l.diferente?.parcela_negasita?.length ?? 0)} negăsite · {fmtNum(l.diferente?.coliziuni?.length ?? 0)} coliziuni · {fmtNum(l.diferente?.schimbate_la_scriere?.length ?? 0)} schimbate la scriere</span>
                  {l.eroare && <span style={{ color:G.red }}>{l.eroare}</span>}
                </div>
              ))}
              <div style={{ fontSize:12, color:G.muted, marginTop:4 }}>Ultimele 20 de loturi cu sursa {SURSA_UTILIZATORI} (toate stările). Loturile finalizate apar și în lista generală de mai sus.</div>
            </div>
          ))}
        </div>
      </>)}
    </div>
  )
}
