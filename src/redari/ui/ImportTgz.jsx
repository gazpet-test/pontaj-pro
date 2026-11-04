// Import Excel TGZ: fișier → parseazaTgz (client-side) → previzualizare + statistici → scrieImport cu progres → raport.
// Contract: docs/redari/CONTRACT_SCHEMA.md §7. Tronsonul este optional. UI-ul NU calculează numerele parcelelor (P2-6/P1-1):
// previzualizarea arată id-uri provizorii (HUS-????), iar scrieImport le rezervă server-side (fn_red_rezerva_numere_parcele).
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase.js'
import { parseazaTgz, scrieImport, randuriDeTratat, csvRanduriDeTratat, numarRanduriPuseDeoparte } from '../importTgz.js'
import { parseazaAnexa7 } from '../importAnexa7.js'
import { G, S, fmtNum, msgEroare, Camp, Gol } from './comune.jsx'

const TRONSOANE = Array.from({ length: 11 }, (_, i) => i + 1)
const MAX_PREVIEW = 50
// Cifrele „de importat” (Jakarinos r5 P2-1): din statistici.*_de_importat când le dă parseazaTgz; altfel calcul echivalent, fără scăderi —
// deținătorii DEDUPLICAȚI (parcelă + nume normalizat) ai parcelelor eligibile și contactele lor.
const cifreDeImportat = (pv) => {
  const st = pv?.statistici || {}
  const eligibile = new Set((pv?.parcele || []).filter(p => p.cheie_sursa && !p.ambigua).map(p => p.cheie))
  const detEligibili = (pv?.detinatori || []).filter(d => eligibile.has(d.cheie_parcela))
  const cheiDet = new Set(detEligibili.map(d => d.cheie ?? d.cheie_detinator ?? `${d.cheie_parcela}|${d.nume_normalizat ?? d.nume}`))
  const detDedup = new Set(detEligibili.map(d => `${d.cheie_parcela}|${d.nume_normalizat ?? d.nume}`))
  const contEligibile = (pv?.contacte || []).filter(c => cheiDet.has(c.cheie_detinator))
  return {
    parcele: st.parcele_de_importat ?? eligibile.size,
    detinatori: st.detinatori_de_importat ?? detDedup.size,
    contacte: st.contacte_de_importat ?? contEligibile.length,
  }
}
const EXPLICATII = {
  nr_crt_incompatibil: 'Identitatea (HG / cadastru) există deja în BD pe o parcelă cu alt grup Nr.Crt.: de ex. „166.1/1” sau „7.2” peste o parcelă importată ca „166” / „7” (regula veche citea „7.2” ca 7/2), ori „166” peste o parcelă „166.1”. NU s-a importat și NU s-a refolosit — verificați cu TGZ care e parcela corectă.',
  fara_cheie: 'Rânduri la care lipsesc ȘI poziția HG, ȘI un nr. cadastral real (un cadastru doar cu „#”, ex. „##”, e gol; tarla singură nu ajunge): nu au o identitate stabilă în Excel, iar un reimport le-ar dubla. NU se importă — necesită completarea poziției HG / nr. cadastral în Excel și reimport.',
  ambigue: 'Rânduri cu aceeași identitate (poziție HG / nr. cadastral) pe Nr.Crt. DIFERITE, sau cu identități CONTRADICTORII sub același Nr.Crt.: nu se poate ști care e parcela (vezi coloanele „motiv” și „detaliu” din acest tab). NU se importă — se lămuresc cu TGZ (poziție HG / nr. cadastral corectate în Excel) și se reimportă.',
}
// CSV-ul „rânduri de tratat” (fără nume) — același pentru un preview și pentru `diferente` dintr-un lot finalizat
const descarcaCsvDeTratat = (randuri, eticheta) => {
  const url = URL.createObjectURL(new Blob([csvRanduriDeTratat(randuri)], { type:'text/csv;charset=utf-8' }))
  const a = document.createElement('a'); a.href = url; a.download = `randuri-de-tratat-${String(eticheta || 'tgz').trim().replace(/[^\w.-]+/g, '_')}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
const SUGESTIE_SARITE = 'necesită completarea poziției HG / nr. cadastral în Excel și reimport (reimportul aceluiași fișier completează doar ce lipsește).'

export default function ImportTgz({ proiect, uats, nivel, show, onImportat }) {
  const poateScrie = nivel === 'admin' || nivel === 'editor'
  const [fisier, setFisier] = useState(null)
  const [versiune, setVersiune] = useState('')
  const [sursa, setSursa] = useState('TGZ')
  const [tronsonPeUat, setTronsonPeUat] = useState({})
  const [preview, setPreview] = useState(null)
  const [nota, setNota] = useState('')            // P2-7: de ce s-a golit previzualizarea
  const [lucru, setLucru] = useState(false)
  const [progres, setProgres] = useState(null)   // { facut, total, etapa }
  const [raport, setRaport] = useState(null)
  const [subTab, setSubTab] = useState('parcele')
  const [loturi, setLoturi] = useState(null)       // loturile anterioare ale proiectului (pentru CSV-ul de tratat), încărcate la cerere
  const [loturiStare, setLoturiStare] = useState({ lucru: false, eroare: null })
  const genLoturi = useRef(0)                       // L24: rezultatul se aplică doar dacă e al ultimei cereri și al proiectului curent
  const proiectRef = useRef(proiect?.id)            // r3 (C-P2-02): proiectul CURENT, citit la aplicarea rezultatelor (nu din închiderea veche)
  proiectRef.current = proiect?.id
  const montat = useRef(true)                        // r4 (C-P2-03): după unmount, finalizarea unui import nu mai atinge starea ecranului
  const genPreview = useRef(0)                       // r5: generația previzualizării (parsarea e async)
  const genImport = useRef(0)                        // r4 (Jakarinos r3 L24): generația ciclului de import (crește la start, la schimbarea proiectului, la unmount)
  useEffect(() => { montat.current = true; return () => { montat.current = false; genImport.current++ } }, [])
  // L24: la schimbarea proiectului și la unmount, cererea în zbor se invalidează (Copilot r1 P3-02)
  // r5 (Copilot r4 P1-03 / P2-03): la schimbarea proiectului se golește TOT ce depinde de proiect (fișier, previzualizare, raport, progres, tronsoane),
  // iar generațiile cresc — un import / o previzualizare / un istoric vechi nu se mai aplică peste proiectul nou
  useEffect(() => {
    genLoturi.current++; genImport.current++; genPreview.current++
    setLoturi(null); setLoturiStare({ lucru: false, eroare: null })
    setPreview(null); setFisier(null); setRaport(null); setProgres(null); setLucru(false); setNota(''); setTronsonPeUat({})
    return () => { genLoturi.current++ }
  }, [proiect?.id])

  const incarcaLoturi = async () => {
    const gen = ++genLoturi.current; const proiectId = proiectRef.current
    setLoturiStare({ lucru: true, eroare: null })
    const { data, error } = await supabase.from('red_import_loturi').select('id, created_at, stare, versiune_lista_tgz, sursa, randuri_total, diferente')
      .eq('proiect_id', proiectId).eq('stare', 'finalizat').order('created_at', { ascending: false }).limit(20)   // J-P2-5 / C-P2-06: filtrul ÎNAINTE de limită
    if (gen !== genLoturi.current || proiectId !== proiectRef.current) return
    if (error) { setLoturi(null); setLoturiStare({ lucru: false, eroare: msgEroare(error) }); return }   // L18: eroare ≠ listă goală
    setLoturi((data || []).map(l => { const r = randuriDeTratat(l.diferente || {}); return { ...l, diferente: undefined, randuri: r, puseDeoparte: numarRanduriPuseDeoparte(r) } }))
    setLoturiStare({ lucru: false, eroare: null })
  }

  // uats pot veni după primul render — nu atribuie implicit tronsonul
  const tronsoane = useMemo(() => ({ ...tronsonPeUat }), [tronsonPeUat])

  // P2-7: orice schimbare a intrărilor (fișier, versiune, sursă, tronson) golește previzualizarea — altfel s-ar importa altceva decât s-a văzut
  const invalideaza = (motiv) => { if (preview) { setPreview(null); setNota(`Previzualizarea a fost golită (${motiv}). Apasă din nou „Previzualizează”.`) } }

  const previzualizeaza = async () => {
    if (!fisier) { show('Alege un fișier Excel (.xlsx).', 'error'); return }
    if (!versiune.trim()) { show('Versiunea listei e obligatorie (ex. „TGZ 13.07.2026”).', 'error'); return }
    if (!uats.length) { show('Proiectul nu are UAT-uri.', 'error'); return }
    const gen = ++genPreview.current; const proiectStart = proiectRef.current
    setLucru(true); setRaport(null); setPreview(null); setNota('')
    try {
      const ab = await fisier.arrayBuffer()
      // fără idStart: numerele finale se rezervă server-side la import; previzualizarea arată id-uri provizorii
      const parser = sursa === 'ANEXA7' ? parseazaAnexa7 : parseazaTgz
      const rez = parser(ab, { uats: uats.map(u => ({ id: u.id, nume: u.nume, uat3: u.uat3, judet: u.judet })), tronsonPeUat: tronsoane, versiune: versiune.trim(), sursa })
      if (gen !== genPreview.current || proiectStart !== proiectRef.current) return   // proiectul s-a schimbat în timpul citirii: rezultatul nu se aplică
      rez.proiect_id_previzualizare = proiectStart   // r5 (C-P1-03): previzualizarea e LEGATĂ de proiectul pentru care s-a calculat (verificat și în scrieImport)
      setPreview(rez)
      const sarite = (rez.fara_cheie?.length || 0) + (rez.ambigue?.length || 0)
      if (rez.erori?.length) show(`${rez.erori.length} rânduri cu erori — vezi tab-ul „Erori”.`, 'error')
      else { const c = cifreDeImportat(rez); show(`Previzualizare gata: ${c.parcele} parcele și ${c.detinatori} deținători de importat${sarite ? `; ${sarite} rânduri NU se importă (fără cheie / ambigue)` : ''}.`, sarite ? 'info' : 'success') }
    } catch (e) { if (gen === genPreview.current) show('Citire fișier: ' + msgEroare(e), 'error') }
    finally { if (montat.current && gen === genPreview.current) setLucru(false) }
  }

  const importa = async () => {
    if (!poateScrie || !preview) return
    if (!previewAlProiectului) { show('Previzualizarea e pentru alt proiect; refă previzualizarea.', 'error'); setPreview(null); return }
    const cifre = cifreDeImportat(preview)
    const nParc = cifre.parcele
    if (!nParc) { show('Nu e nimic de importat (toate rândurile sunt fără cheie / ambigue sau cu erori).', 'error'); return }
    const sarite = (preview.fara_cheie?.length || 0) + (preview.ambigue?.length || 0)
    if (!window.confirm(`Import ${nParc} parcele, ${cifre.detinatori} deținători și ${cifre.contacte} contacte în ${proiect.cod} (lista „${versiune.trim()}”)${sarite ? `.\n${sarite} rânduri NU se importă (fără cheie / ambigue) — ${SUGESTIE_SARITE}` : '?'}`)) return
    const judetDiferit = preview.statistici?.judet_diferit || 0
    const proiectImport = proiect.id; const codImport = proiect.cod
    const gen = ++genImport.current
    // r3/r4 (C-P2-02 / C-P2-03): rezultatul se aplică doar pe ACELAȘI ecran montat, aceeași generație, același proiect
    const altProiect = () => !montat.current || gen !== genImport.current || proiectRef.current !== proiectImport
    setLucru(true); setProgres({ facut: 0, total: nParc, etapa: 'pornire' })
    // starea lotului (in_curs / finalizat / esuat + eroare) se citește din BD, nu se presupune
    const citesteLot = async (lotId) => {
      if (!lotId) return null
      const { data } = await supabase.from('red_import_loturi').select('id, stare, eroare, parcele_noi, detinatori_noi, created_at').eq('id', lotId).maybeSingle()
      return data || null
    }
    try {
      const rez = await scrieImport(supabase, preview, { proiectId: proiect.id, versiune: versiune.trim(), sursa, fisierNume: fisier?.name || null,
        onProgress: ({ etapa, facut, total } = {}) => { if (!altProiect()) setProgres({ etapa: etapa || '', facut: facut ?? 0, total: total ?? nParc }) } })
      const lot = await citesteLot(rez.lotId)
      if (altProiect()) { show(`Importul în ${codImport} s-a terminat (lot ${lot?.stare || '?'}); raportul e în istoricul loturilor acelui proiect.`, 'info'); return }
      setRaport({ ...rez, lot, esuat: lot?.stare === 'esuat', judetDiferit }); setPreview(null); setFisier(null)
      show(`Import terminat: ${rez.parceleNoi ?? 0} parcele noi, ${rez.detinatoriNoi ?? 0} deținători${(rez.parceleRefolosite ?? (Array.isArray(rez.existente) ? rez.existente.length : 0)) ? `, ${rez.parceleRefolosite ?? rez.existente.length} parcele existente refolosite` : ''}.`, 'success')
      onImportat?.()
      if (loturi) incarcaLoturi()   // L24: lista istorică se reîncarcă explicit după import (incarcaLoturi citește proiectRef)
    } catch (e) {
      // lotul rămâne în BD cu stare 'esuat' + eroare; previzualizarea și fișierul rămân ca să se poată relua (completează doar ce lipsește)
      const lot = await citesteLot(e?.lotId)
      if (altProiect()) { show(`Importul în ${codImport} a eșuat: ${msgEroare(e)}`, 'error'); return }
      setRaport({ esuat: true, lotId: e?.lotId || null, lot, mesaj: msgEroare(e) })
      show('Import eșuat: ' + msgEroare(e), 'error')
    }
    finally { if (!altProiect()) { setLucru(false); setProgres(null) } }   // r5 (C-P2-03): doar pe ecranul / proiectul / generația care l-a pornit
  }

  const st = preview?.statistici || {}
  // r5 (C-P1-03): butonul de import cere ca previzualizarea să fie a proiectului CURENT
  const previewAlProiectului = !!preview && preview.proiect_id_previzualizare === proiect?.id
  const deTratat = useMemo(() => (preview ? randuriDeTratat(preview) : []), [preview])   // Copilot r1 P3-04: o singură dată per preview
  const nrPuseDeoparte = useMemo(() => numarRanduriPuseDeoparte(deTratat), [deTratat])
  const nrCoproprietari = useMemo(() => (preview?.detinatori || []).filter(d => d.calitate === 'coproprietar').length, [preview])
  const statCard = (et, val, culoare = G.text) => <div style={{ ...S.card, padding:'10px 14px', minWidth:120 }}><div style={{ fontSize:11.5, color:G.muted }}>{et}</div><div style={{ fontSize:20, fontWeight:700, color: culoare }}>{val ?? '-'}</div></div>
  const celule = (obj) => Object.entries(obj || {}).filter(([k]) => !['id', 'proiect_id', 'uat_id', 'parcela_id', 'detinator_id'].includes(k) && typeof obj[k] !== 'object')

  function TabelPreview({ randuri, gol }) {
    const lista = (randuri || []).slice(0, MAX_PREVIEW)
    if (!lista.length) return <Gol text={gol} />
    // r3 (J-P2-2): coloanele = reuniunea câmpurilor TUTUROR rândurilor afișate (un „detaliu” de pe rândul 30 nu dispare dacă rândul 1 n-are)
    const chei = [...new Set(lista.flatMap(r => celule(r).map(([k]) => k)))]
    return (
      <div style={{ overflow:'auto', maxHeight:420 }}>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead><tr>{chei.map(k => <th key={k} style={S.th}>{k}</th>)}</tr></thead>
          <tbody>{lista.map((r, i) => <tr key={i}>{chei.map(k => <td key={k} style={{ ...S.td, fontSize:12.5 }}>{r[k] === null || r[k] === undefined ? '' : String(r[k])}</td>)}</tr>)}</tbody>
        </table>
        {(randuri || []).length > MAX_PREVIEW && <div style={{ fontSize:12, color:G.muted, padding:8 }}>… încă {(randuri.length - MAX_PREVIEW)} rânduri (se afișează primele {MAX_PREVIEW}).</div>}
      </div>
    )
  }

  return (
    <div>
      <div style={{ ...S.card, marginBottom:12 }}>
        <div style={{ fontWeight:700, marginBottom:10 }}>1. Fișierul și versiunea listei</div>
        <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr 1fr', gap:10, alignItems:'end' }}>
          <Camp eticheta={sursa === 'ANEXA7' ? 'Excel Anexa 7 (.xlsx)' : 'Excel TGZ (.xlsx) — antet pe rândul 3'}>
            <input type="file" accept=".xlsx,.xls" onChange={e => { setFisier(e.target.files?.[0] || null); setRaport(null); invalideaza('alt fișier') }} style={{ ...S.input, padding:5 }} disabled={lucru} />
          </Camp>
          <Camp eticheta="Versiunea listei (obligatoriu)"><input value={versiune} onChange={e => { setVersiune(e.target.value); invalideaza('versiunea s-a schimbat') }} style={S.input} placeholder="ex. TGZ 13.07.2026" disabled={lucru} /></Camp>
          <Camp eticheta="Sursa"><select value={sursa} onChange={e => { setSursa(e.target.value); invalideaza('sursa s-a schimbat') }} style={{ ...S.select, width:'100%' }} disabled={lucru}><option value="TGZ">TGZ</option><option value="ANEXA7">Anexa 7 - tipizat Beneficiar</option></select><div style={{ fontSize:12, color:G.muted, marginTop:4 }}>{sursa === 'ANEXA7' ? 'Model 7: 30 de coloane, antet pe randul 5; adresa pe coloane separate.' : 'Format TGZ vechi: Nr.Crt., Nume Detinator si adresa intr-o singura coloana.'}</div></Camp>
        </div>
        <div style={{ fontWeight:700, margin:'14px 0 8px' }}>2. Tronson optional - se poate atribui ulterior din Tronsoane</div><p>Tronsonul se atribuie dupa import pe intervale de pozitie HG.</p>
        {uats.length === 0 ? <Gol text="Proiectul nu are UAT-uri." /> : (
          <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
            {uats.map(u => (
              <div key={u.id} style={{ display:'flex', alignItems:'center', gap:6, fontSize:13 }}>
                <span style={{ color:G.muted }}>{u.uat3}</span>
                <select value={tronsoane[u.uat3] ?? ''} onChange={e => { const t = e.target.value === '' ? null : Number(e.target.value); setTronsonPeUat(x => ({ ...x, [u.uat3]: t })); invalideaza(`tronsonul ${u.uat3} s-a schimbat`) }} style={S.select} disabled={lucru}>
                  <option value="">Neatribuit</option>{TRONSOANE.map(t => <option key={t} value={t}>T{t}</option>)}
                </select>
              </div>
            ))}
          </div>
        )}
        <div style={{ display:'flex', justifyContent:'flex-end', alignItems:'center', gap:10, marginTop:12 }}>
          {nota && <span style={{ fontSize:12.5, color:G.yellow }}>⚠ {nota}</span>}
          <button style={S.btnS} onClick={previzualizeaza} disabled={lucru || !fisier}>{lucru && !progres ? 'Citesc…' : '🔍 Previzualizează'}</button>
        </div>
      </div>

      {preview && (
        <div style={{ ...S.card, marginBottom:12 }}>
          <div style={{ fontWeight:700, marginBottom:10 }}>3. Previzualizare</div>
          <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginBottom:12 }}>
            {statCard('Rânduri citite', fmtNum(st.randuri_total))}
            {statCard('Parcele de importat', fmtNum(cifreDeImportat(preview).parcele), G.green)}
            {statCard('Deținători de importat', fmtNum(cifreDeImportat(preview).detinatori), G.blue)}
            {statCard('Contacte de importat', fmtNum(cifreDeImportat(preview).contacte), G.blue)}
            {statCard('Deținători citiți', fmtNum(st.detinatori ?? preview.detinatori?.length))}
            {statCard('Coproprietari', fmtNum(nrCoproprietari))}
            {statCard('Neidentificați', fmtNum(st.neidentificati ?? preview.neidentificati?.length), G.yellow)}
            {statCard('Dubluri', fmtNum(st.dubluri ?? preview.dubluri?.length), G.orange)}
            {statCard('Fără cheie (nu se importă)', fmtNum(st.fara_cheie ?? preview.fara_cheie?.length), (st.fara_cheie || preview.fara_cheie?.length) ? G.orange : G.text)}
            {statCard('Ambigue (nu se importă)', fmtNum(st.ambigue ?? preview.ambigue?.length), (st.ambigue || preview.ambigue?.length) ? G.red : G.text)}
            {statCard('Județ adresă ≠ teren', fmtNum(st.judet_diferit || 0), st.judet_diferit ? G.yellow : G.text)}
            {statCard('Erori', fmtNum(preview.erori?.length || 0), preview.erori?.length ? G.red : G.text)}
            {statCard('Rânduri puse deoparte (distincte, înainte de verificarea în BD)', fmtNum(nrPuseDeoparte), nrPuseDeoparte ? G.orange : G.text)}
            {statCard('Cadastru suspect (doar marcaj)', fmtNum(preview.cadastru_suspect?.length || 0), preview.cadastru_suspect?.length ? G.yellow : G.text)}
          </div>
          <div style={{ display:'flex', gap:4, borderBottom:`1px solid ${G.border2}`, marginBottom:8, flexWrap:'wrap' }}>
            {[['parcele', 'Parcele'], ['detinatori', 'Deținători'], ['contacte', 'Contacte'], ['dubluri', 'Dubluri'], ['neidentificati', 'Neidentificați'],
              ['fara_cheie', 'Fără cheie — nu se importă'], ['ambigue', 'Ambigue — nu se importă'], ['cadastru_suspect', 'Cadastru suspect'], ['erori', 'Erori']].map(([k, et]) => (
              <button key={k} onClick={() => setSubTab(k)} style={{ padding:'6px 12px', background:'transparent', border:'none', borderBottom: subTab === k ? `2px solid ${G.green}` : '2px solid transparent', color: subTab === k ? G.text : G.muted, cursor:'pointer', fontSize:12.5, fontWeight:600 }}>
                {et} ({Array.isArray(preview[k]) ? preview[k].length : 0})
              </button>
            ))}
          </div>
          {subTab === 'erori' ? (
            (preview.erori || []).length === 0 ? <Gol text="Nicio eroare." /> : (
              <div style={{ maxHeight:360, overflow:'auto' }}>
                {preview.erori.map((e, i) => <div key={i} style={{ padding:'5px 0', borderTop:`1px solid ${G.border}`, fontSize:12.5, color:G.red }}>{e.rand ? `Rând ${e.rand}: ` : ''}{e.motiv}{e.uat ? <span style={{ color:G.muted }}> · UAT „{e.uat}”</span> : null}{e.detaliu ? <div style={{ color:G.muted, fontSize:12, paddingLeft:12 }}>{e.detaliu}</div> : null}</div>)}
              </div>
            )
          ) : (<>
            {subTab === 'parcele' && <div style={{ fontSize:12, color:G.muted, marginBottom:6 }}>ID-urile parcelelor sunt <b>provizorii</b> (numărul apare ca ????) — numerele finale se rezervă în BD la import și apar în raport. Parcelele marcate <span style={S.mono}>ambigua</span> sau fără <span style={S.mono}>cheie_sursa</span> NU se importă (vezi tab-urile dedicate).</div>}
            {EXPLICATII[subTab] && <div style={{ ...S.card, borderColor: subTab === 'ambigue' ? G.red : G.orange, fontSize:12.5, color:G.text, marginBottom:8 }}>⚠ {EXPLICATII[subTab]}</div>}
            <TabelPreview randuri={Array.isArray(preview[subTab]) ? preview[subTab] : []} gol="Nimic în această categorie." />
          </>)}

          <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:12, alignItems:'center' }}>
            {progres && <span style={{ fontSize:12.5, color:G.muted }}>{progres.etapa ? progres.etapa + ' · ' : ''}{progres.facut} / {progres.total}</span>}
            {progres && <div style={{ width:160, height:6, background:G.border2, borderRadius:3, overflow:'hidden' }}><div style={{ width:`${progres.total ? Math.min(100, Math.round(progres.facut / progres.total * 100)) : 0}%`, height:'100%', background:G.green }} /></div>}
            {!poateScrie && <span style={{ fontSize:12.5, color:G.muted }}>Doar admin/editor pot importa.</span>}
            {poateScrie && <button style={S.btnP} onClick={importa} disabled={lucru || !previewAlProiectului || !cifreDeImportat(preview).parcele}>{lucru ? 'Import în curs…' : `📥 Importă ${cifreDeImportat(preview).parcele} parcele / ${cifreDeImportat(preview).detinatori} deținători`}</button>}
          </div>
          {preview.erori?.length > 0 && <div style={{ fontSize:12, color:G.yellow, marginTop:6 }}>⚠ Rândurile cu erori nu intră în import; corectează fișierul sau continuă fără ele.</div>}
          {/* fără nume / adrese / contacte — doar rândul din Excel, UAT, Nr.Crt., cheia parcelei și motivul (pentru corectarea fișierului) */}
          {deTratat.length > 0 && <button style={{ ...S.btnS, marginTop:8 }} onClick={() => descarcaCsvDeTratat(deTratat, versiune || 'tgz')}>⬇ Descarcă rândurile de tratat ({nrPuseDeoparte} rânduri{preview.cadastru_suspect?.length ? ` + ${preview.cadastru_suspect.length} cadastru suspect` : ''}, fără nume)</button>}
          {((preview.fara_cheie?.length || 0) + (preview.ambigue?.length || 0)) > 0 && <div style={{ fontSize:12, color:G.yellow, marginTop:6 }}>⚠ {preview.fara_cheie?.length || 0} rânduri fără cheie și {preview.ambigue?.length || 0} ambigue NU se importă — {SUGESTIE_SARITE}</div>}
        </div>
      )}

      {raport?.esuat && (
        <div style={{ ...S.card, borderColor:G.red, marginBottom:12 }}>
          <div style={{ fontWeight:700, marginBottom:6, color:G.red }}>4. Import eșuat</div>
          <div style={{ fontSize:13 }}>{raport.lot?.eroare || raport.mesaj}</div>
          <div style={{ fontSize:12, color:G.muted, marginTop:6 }}>Lot: <span style={S.mono}>{raport.lotId || '-'}</span> · stare <b>{raport.lot?.stare || 'esuat'}</b>{raport.lot ? ` · ${fmtNum(raport.lot.parcele_noi)} parcele / ${fmtNum(raport.lot.detinatori_noi)} deținători scrise până la eroare` : ''}</div>
          <div style={{ fontSize:12.5, color:G.yellow, marginTop:8 }}>Sugestie: reia importul cu același fișier și aceeași versiune — se completează doar ce lipsește (parcelele deja scrise se refolosesc).</div>
        </div>
      )}
      {raport && !raport.esuat && (
        <div style={{ ...S.card, borderColor:G.green }}>
          <div style={{ fontWeight:700, marginBottom:8 }}>4. Raport import <span style={{ ...S.tag, background:G.greenDim, color:G.green, marginLeft:8 }}>lot {raport.lot?.stare || 'finalizat'}</span></div>
          <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
            {statCard('Parcele noi', fmtNum(raport.parceleNoi), G.green)}
            {statCard('Deținători noi', fmtNum(raport.detinatoriNoi), G.blue)}
            {statCard('Contacte', fmtNum(raport.contacteNoi))}
            {statCard('Parcele existente (refolosite)', fmtNum(raport.parceleRefolosite ?? (Array.isArray(raport.existente) ? raport.existente.length : 0)), (raport.parceleRefolosite || raport.existente?.length) ? G.orange : G.text)}
          </div>
          <div style={{ fontSize:12, color:G.muted, marginTop:8 }}>Lot import: <span style={S.mono}>{raport.lotId || '-'}</span> · lista „{versiune}” · {sursa}</div>
          {/* r3 (C-P2-03): CSV-ul rezultatului EFECTIV (după verificarea în BD, cu Nr.Crt. incompatibile și stările reconciliate) */}
          {raport.diferente && randuriDeTratat(raport.diferente).length > 0 && <button style={{ ...S.btnS, marginTop:8 }} onClick={() => descarcaCsvDeTratat(randuriDeTratat(raport.diferente), `${versiune || 'tgz'}-rezultat`)}>⬇ Rândurile de tratat după import ({numarRanduriPuseDeoparte(randuriDeTratat(raport.diferente))} rânduri, fără nume)</button>}
          {Array.isArray(raport.refolosite_fara_nr_crt) && raport.refolosite_fara_nr_crt.length > 0 && <div style={{ fontSize:12.5, color:G.yellow, marginTop:8 }}>ℹ {raport.refolosite_fara_nr_crt.length} parcele existente cu subnumăr Nr.Crt. au fost completate dintr-o sursă fără Nr.Crt. (Anexa 7), pe aceeași cheie: {raport.refolosite_fara_nr_crt.map(x => `${x.id_parcela} (${x.nr_crt_grup})`).join(', ')}.</div>}
          {raport.judetDiferit > 0 && <div style={{ fontSize:12.5, color:G.yellow, marginTop:8 }}>ℹ La {raport.judetDiferit} rânduri județul din adresă diferă de județul terenului — s-a păstrat județul din adresă la contact și s-a notat în observațiile parcelei.</div>}
          {[['fara_cheie', 'Rânduri fără cheie — NU au fost importate', G.orange], ['ambigue', 'Rânduri ambigue — NU au fost importate', G.red], ['nr_crt_incompatibil', 'Nr.Crt. incompatibil cu parcela existentă — NU au fost importate', G.red]].map(([k, titlu, culoare]) => Array.isArray(raport[k]) && raport[k].length > 0 && (
            <div key={k} style={{ marginTop:10 }}>
              <div style={{ fontSize:12.5, fontWeight:600, marginBottom:4, color: culoare }}>{titlu} ({raport[k].length})</div>
              <div style={{ maxHeight:220, overflow:'auto', border:`1px solid ${G.border}`, borderRadius:7 }}>
                <table style={{ width:'100%', borderCollapse:'collapse' }}>
                  <thead><tr><th style={S.th}>Rând</th><th style={S.th}>Nr.Crt.</th><th style={S.th}>Nume</th>{k === 'ambigue' && <th style={S.th}>Cheie sursă</th>}</tr></thead>
                  <tbody>{raport[k].map((x, i) => <tr key={i}><td style={S.td}>{x.rand ?? '-'}</td><td style={S.td}>{x.nr_crt ?? '-'}</td><td style={S.td}>{x.nume}</td>{k === 'ambigue' && <td style={{ ...S.td, ...S.mono, fontSize:11.5 }}>{x.cheie_sursa || '-'}</td>}</tr>)}</tbody>
                </table>
              </div>
              <div style={{ fontSize:12, color:G.muted, marginTop:4 }}>{EXPLICATII[k]} Sugestie: {SUGESTIE_SARITE}</div>
            </div>
          ))}
          {Array.isArray(raport.existente) && raport.existente.length > 0 && (
            <div style={{ marginTop:10 }}>
              <div style={{ fontSize:12.5, fontWeight:600, marginBottom:4 }}>Parcele existente refolosite ({raport.existente.length})</div>
              <div style={{ ...S.mono, fontSize:12, background:G.bg, border:`1px solid ${G.border}`, borderRadius:7, padding:10, maxHeight:220, overflow:'auto', display:'flex', flexWrap:'wrap', gap:'4px 12px' }}>
                {raport.existente.map((id, i) => <span key={i}>{typeof id === 'string' ? id : (id?.id_parcela || JSON.stringify(id))}</span>)}
              </div>
            </div>
          )}
        </div>
      )}

      <div style={{ ...S.card, marginTop:12 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
          <div style={{ fontWeight:700 }}>Loturi importate anterior — rândurile de tratat</div>
          <button style={S.btnS} onClick={incarcaLoturi} disabled={loturiStare.lucru}>{loturiStare.lucru ? 'Încarc…' : (loturi ? '↻ Reîncarcă' : 'Arată loturile')}</button>
        </div>
        {loturiStare.eroare && <div style={{ fontSize:12.5, color:G.red, marginTop:8 }}>Nu am putut citi loturile: {loturiStare.eroare}</div>}
        {loturi && (loturi.length === 0 ? <Gol text="Niciun lot de import pe acest proiect." /> : (
          <div style={{ marginTop:8 }}>
            {loturi.map(l => (
              <div key={l.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'6px 0', borderTop:`1px solid ${G.border}`, fontSize:12.5, flexWrap:'wrap' }}>
                <span style={S.mono}>{String(l.created_at || '').slice(0, 16).replace('T', ' ')}</span>
                <span>„{l.versiune_lista_tgz || '-'}” · {l.sursa || '-'} · {fmtNum(l.randuri_total)} rânduri · stare <b>{l.stare}</b></span>
                <span style={{ color: l.puseDeoparte ? G.orange : G.muted }}>{fmtNum(l.puseDeoparte)} rânduri puse deoparte</span>
                {l.randuri.length > 0 && <button style={S.btnS} onClick={() => descarcaCsvDeTratat(l.randuri, `${l.versiune_lista_tgz || 'lot'}-${String(l.created_at || '').slice(0, 10)}`)}>⬇ CSV (fără nume)</button>}
              </div>
            ))}
            <div style={{ fontSize:12, color:G.muted, marginTop:6 }}>Ultimele 20 de loturi finalizate. Un rând Excel = un rând în CSV, cu toate diagnosticele lui; la loturile vechi, rândurile ambigue care apăreau și la erori sunt numărate o singură dată.</div>
          </div>
        ))}
      </div>
    </div>
  )
}
