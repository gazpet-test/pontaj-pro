// Import Excel TGZ: fișier → parseazaTgz (client-side) → previzualizare + statistici → scrieImport cu progres → raport.
// Contract: docs/redari/CONTRACT_SCHEMA.md §7. Tronsonul este optional. UI-ul NU calculează numerele parcelelor (P2-6/P1-1):
// previzualizarea arată id-uri provizorii (HUS-????), iar scrieImport le rezervă server-side (fn_red_rezerva_numere_parcele).
import React, { useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase.js'
import { parseazaTgz, scrieImport } from '../importTgz.js'
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
  fara_cheie: 'Rânduri la care lipsesc ȘI poziția HG, ȘI nr. cadastral (tarla singură nu ajunge): nu au o identitate stabilă în Excel, iar un reimport le-ar dubla. NU se importă — necesită completarea poziției HG / nr. cadastral în Excel și reimport.',
  ambigue: 'Rânduri cu aceeași identitate (poziție HG / nr. cadastral) pe Nr.Crt. DIFERITE, sau cu identități CONTRADICTORII sub același Nr.Crt.: nu se poate ști care e parcela (vezi coloana „motiv” și detaliul din Erori). NU se importă — se lămuresc cu TGZ (poziție HG / nr. cadastral corectate în Excel) și se reimportă.',
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

  // uats pot veni după primul render — nu atribuie implicit tronsonul
  const tronsoane = useMemo(() => ({ ...tronsonPeUat }), [tronsonPeUat])

  // P2-7: orice schimbare a intrărilor (fișier, versiune, sursă, tronson) golește previzualizarea — altfel s-ar importa altceva decât s-a văzut
  const invalideaza = (motiv) => { if (preview) { setPreview(null); setNota(`Previzualizarea a fost golită (${motiv}). Apasă din nou „Previzualizează”.`) } }

  const previzualizeaza = async () => {
    if (!fisier) { show('Alege un fișier Excel (.xlsx).', 'error'); return }
    if (!versiune.trim()) { show('Versiunea listei e obligatorie (ex. „TGZ 13.07.2026”).', 'error'); return }
    if (!uats.length) { show('Proiectul nu are UAT-uri.', 'error'); return }
    setLucru(true); setRaport(null); setPreview(null); setNota('')
    try {
      const ab = await fisier.arrayBuffer()
      // fără idStart: numerele finale se rezervă server-side la import; previzualizarea arată id-uri provizorii
      const parser = sursa === 'ANEXA7' ? parseazaAnexa7 : parseazaTgz
      const rez = parser(ab, { uats: uats.map(u => ({ id: u.id, nume: u.nume, uat3: u.uat3, judet: u.judet })), tronsonPeUat: tronsoane, versiune: versiune.trim(), sursa })
      setPreview(rez)
      const sarite = (rez.fara_cheie?.length || 0) + (rez.ambigue?.length || 0)
      if (rez.erori?.length) show(`${rez.erori.length} rânduri cu erori — vezi tab-ul „Erori”.`, 'error')
      else { const c = cifreDeImportat(rez); show(`Previzualizare gata: ${c.parcele} parcele și ${c.detinatori} deținători de importat${sarite ? `; ${sarite} rânduri NU se importă (fără cheie / ambigue)` : ''}.`, sarite ? 'info' : 'success') }
    } catch (e) { show('Citire fișier: ' + msgEroare(e), 'error') }
    finally { setLucru(false) }
  }

  const importa = async () => {
    if (!poateScrie || !preview) return
    const cifre = cifreDeImportat(preview)
    const nParc = cifre.parcele
    if (!nParc) { show('Nu e nimic de importat (toate rândurile sunt fără cheie / ambigue sau cu erori).', 'error'); return }
    const sarite = (preview.fara_cheie?.length || 0) + (preview.ambigue?.length || 0)
    if (!window.confirm(`Import ${nParc} parcele, ${cifre.detinatori} deținători și ${cifre.contacte} contacte în ${proiect.cod} (lista „${versiune.trim()}”)${sarite ? `.\n${sarite} rânduri NU se importă (fără cheie / ambigue) — ${SUGESTIE_SARITE}` : '?'}`)) return
    const judetDiferit = preview.statistici?.judet_diferit || 0
    setLucru(true); setProgres({ facut: 0, total: nParc, etapa: 'pornire' })
    // starea lotului (in_curs / finalizat / esuat + eroare) se citește din BD, nu se presupune
    const citesteLot = async (lotId) => {
      if (!lotId) return null
      const { data } = await supabase.from('red_import_loturi').select('id, stare, eroare, parcele_noi, detinatori_noi, created_at').eq('id', lotId).maybeSingle()
      return data || null
    }
    try {
      const rez = await scrieImport(supabase, preview, { proiectId: proiect.id, versiune: versiune.trim(), sursa, fisierNume: fisier?.name || null,
        onProgress: ({ etapa, facut, total } = {}) => setProgres({ etapa: etapa || '', facut: facut ?? 0, total: total ?? nParc }) })
      const lot = await citesteLot(rez.lotId)
      setRaport({ ...rez, lot, esuat: lot?.stare === 'esuat', judetDiferit }); setPreview(null); setFisier(null)
      show(`Import terminat: ${rez.parceleNoi ?? 0} parcele noi, ${rez.detinatoriNoi ?? 0} deținători${(rez.parceleRefolosite ?? (Array.isArray(rez.existente) ? rez.existente.length : 0)) ? `, ${rez.parceleRefolosite ?? rez.existente.length} parcele existente refolosite` : ''}.`, 'success')
      onImportat?.()
    } catch (e) {
      // lotul rămâne în BD cu stare 'esuat' + eroare; previzualizarea și fișierul rămân ca să se poată relua (completează doar ce lipsește)
      const lot = await citesteLot(e?.lotId)
      setRaport({ esuat: true, lotId: e?.lotId || null, lot, mesaj: msgEroare(e) })
      show('Import eșuat: ' + msgEroare(e), 'error')
    }
    finally { setLucru(false); setProgres(null) }
  }

  const st = preview?.statistici || {}
  const nrCoproprietari = useMemo(() => (preview?.detinatori || []).filter(d => d.calitate === 'coproprietar').length, [preview])
  const statCard = (et, val, culoare = G.text) => <div style={{ ...S.card, padding:'10px 14px', minWidth:120 }}><div style={{ fontSize:11.5, color:G.muted }}>{et}</div><div style={{ fontSize:20, fontWeight:700, color: culoare }}>{val ?? '-'}</div></div>
  const celule = (obj) => Object.entries(obj || {}).filter(([k]) => !['id', 'proiect_id', 'uat_id', 'parcela_id', 'detinator_id'].includes(k) && typeof obj[k] !== 'object')

  function TabelPreview({ randuri, gol }) {
    const lista = (randuri || []).slice(0, MAX_PREVIEW)
    if (!lista.length) return <Gol text={gol} />
    const chei = celule(lista[0]).map(([k]) => k)
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
          </div>
          <div style={{ display:'flex', gap:4, borderBottom:`1px solid ${G.border2}`, marginBottom:8, flexWrap:'wrap' }}>
            {[['parcele', 'Parcele'], ['detinatori', 'Deținători'], ['contacte', 'Contacte'], ['dubluri', 'Dubluri'], ['neidentificati', 'Neidentificați'],
              ['fara_cheie', 'Fără cheie — nu se importă'], ['ambigue', 'Ambigue — nu se importă'], ['erori', 'Erori']].map(([k, et]) => (
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
            {poateScrie && <button style={S.btnP} onClick={importa} disabled={lucru || !cifreDeImportat(preview).parcele}>{lucru ? 'Import în curs…' : `📥 Importă ${cifreDeImportat(preview).parcele} parcele / ${cifreDeImportat(preview).detinatori} deținători`}</button>}
          </div>
          {preview.erori?.length > 0 && <div style={{ fontSize:12, color:G.yellow, marginTop:6 }}>⚠ Rândurile cu erori nu intră în import; corectează fișierul sau continuă fără ele.</div>}
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
          {raport.judetDiferit > 0 && <div style={{ fontSize:12.5, color:G.yellow, marginTop:8 }}>ℹ La {raport.judetDiferit} rânduri județul din adresă diferă de județul terenului — s-a păstrat județul din adresă la contact și s-a notat în observațiile parcelei.</div>}
          {[['fara_cheie', 'Rânduri fără cheie — NU au fost importate', G.orange], ['ambigue', 'Rânduri ambigue — NU au fost importate', G.red]].map(([k, titlu, culoare]) => Array.isArray(raport[k]) && raport[k].length > 0 && (
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
    </div>
  )
}
