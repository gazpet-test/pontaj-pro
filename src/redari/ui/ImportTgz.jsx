// Import Excel TGZ: fișier → parseazaTgz (client-side) → previzualizare + statistici → scrieImport cu progres → raport.
// Contract: docs/redari/CONTRACT_SCHEMA.md §7. Tronsonul se dă manual per UAT. UI-ul NU calculează numerele parcelelor (P2-6/P1-1):
// previzualizarea arată id-uri provizorii (T3-HUS-????), iar scrieImport le rezervă server-side (fn_red_rezerva_numere_parcele).
import React, { useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase.js'
import { parseazaTgz, scrieImport } from '../importTgz.js'
import { G, S, fmtNum, msgEroare, Camp, Gol } from './comune.jsx'

const TRONSOANE = Array.from({ length: 11 }, (_, i) => i + 1)
const MAX_PREVIEW = 50

export default function ImportTgz({ proiect, uats, nivel, show, onImportat }) {
  const poateScrie = nivel === 'admin' || nivel === 'editor'
  const [fisier, setFisier] = useState(null)
  const [versiune, setVersiune] = useState('')
  const [sursa, setSursa] = useState('TGZ')
  const [tronsonPeUat, setTronsonPeUat] = useState(() => Object.fromEntries(uats.map(u => [u.uat3, 1])))
  const [preview, setPreview] = useState(null)
  const [nota, setNota] = useState('')            // P2-7: de ce s-a golit previzualizarea
  const [lucru, setLucru] = useState(false)
  const [progres, setProgres] = useState(null)   // { facut, total, etapa }
  const [raport, setRaport] = useState(null)
  const [subTab, setSubTab] = useState('parcele')

  // uats pot veni după primul render — completează tronsoanele lipsă cu 1
  const tronsoane = useMemo(() => ({ ...Object.fromEntries(uats.map(u => [u.uat3, 1])), ...tronsonPeUat }), [uats, tronsonPeUat])

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
      const rez = parseazaTgz(ab, { uats: uats.map(u => ({ id: u.id, nume: u.nume, uat3: u.uat3 })), tronsonPeUat: tronsoane, versiune: versiune.trim(), sursa })
      setPreview(rez)
      if (rez.erori?.length) show(`${rez.erori.length} rânduri cu erori — vezi tab-ul „Erori”.`, 'error')
      else show(`Previzualizare gata: ${rez.parcele?.length || 0} parcele, ${rez.detinatori?.length || 0} deținători.`, 'success')
    } catch (e) { show('Citire fișier: ' + msgEroare(e), 'error') }
    finally { setLucru(false) }
  }

  const importa = async () => {
    if (!poateScrie || !preview) return
    const nParc = preview.parcele?.length || 0
    if (!nParc) { show('Nu e nimic de importat.', 'error'); return }
    if (!window.confirm(`Import ${nParc} parcele și ${preview.detinatori?.length || 0} deținători în ${proiect.cod} (lista „${versiune.trim()}”)?`)) return
    setLucru(true); setProgres({ facut: 0, total: nParc, etapa: 'pornire' })
    try {
      const rez = await scrieImport(supabase, preview, { proiectId: proiect.id, versiune: versiune.trim(), sursa, fisierNume: fisier?.name || null,
        onProgress: ({ etapa, facut, total } = {}) => setProgres({ etapa: etapa || '', facut: facut ?? 0, total: total ?? nParc }) })
      setRaport(rez); setPreview(null); setFisier(null)
      show(`Import terminat: ${rez.parceleNoi ?? 0} parcele noi, ${rez.detinatoriNoi ?? 0} deținători${rez.existente ? `, ${rez.existente} parcele existente sărite` : ''}.`, 'success')
      onImportat?.()
    } catch (e) { show('Import: ' + msgEroare(e), 'error') }
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
          <Camp eticheta="Excel TGZ (.xlsx) — antet pe rândul 3">
            <input type="file" accept=".xlsx,.xls" onChange={e => { setFisier(e.target.files?.[0] || null); setRaport(null); invalideaza('alt fișier') }} style={{ ...S.input, padding:5 }} disabled={lucru} />
          </Camp>
          <Camp eticheta="Versiunea listei (obligatoriu)"><input value={versiune} onChange={e => { setVersiune(e.target.value); invalideaza('versiunea s-a schimbat') }} style={S.input} placeholder="ex. TGZ 13.07.2026" disabled={lucru} /></Camp>
          <Camp eticheta="Sursa"><select value={sursa} onChange={e => { setSursa(e.target.value); invalideaza('sursa s-a schimbat') }} style={{ ...S.select, width:'100%' }} disabled={lucru}><option value="TGZ">TGZ</option><option value="ANEXA7">ANEXA7</option></select></Camp>
        </div>
        <div style={{ fontWeight:700, margin:'14px 0 8px' }}>2. Tronsonul per UAT (manual, până la corelarea pe km)</div>
        {uats.length === 0 ? <Gol text="Proiectul nu are UAT-uri." /> : (
          <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
            {uats.map(u => (
              <div key={u.id} style={{ display:'flex', alignItems:'center', gap:6, fontSize:13 }}>
                <span style={{ color:G.muted }}>{u.uat3}</span>
                <select value={tronsoane[u.uat3] || 1} onChange={e => { const t = Number(e.target.value); setTronsonPeUat(x => ({ ...x, [u.uat3]: t })); invalideaza(`tronsonul ${u.uat3} s-a schimbat`) }} style={S.select} disabled={lucru}>
                  {TRONSOANE.map(t => <option key={t} value={t}>T{t}</option>)}
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
            {statCard('Parcele noi', fmtNum(st.parcele ?? preview.parcele?.length), G.green)}
            {statCard('Deținători', fmtNum(st.detinatori ?? preview.detinatori?.length), G.blue)}
            {statCard('Coproprietari', fmtNum(nrCoproprietari))}
            {statCard('Neidentificați', fmtNum(st.neidentificati ?? preview.neidentificati?.length), G.yellow)}
            {statCard('Dubluri', fmtNum(st.dubluri ?? preview.dubluri?.length), G.orange)}
            {statCard('Erori', fmtNum(preview.erori?.length || 0), preview.erori?.length ? G.red : G.text)}
          </div>
          <div style={{ display:'flex', gap:4, borderBottom:`1px solid ${G.border2}`, marginBottom:8 }}>
            {[['parcele', 'Parcele'], ['detinatori', 'Deținători'], ['contacte', 'Contacte'], ['dubluri', 'Dubluri'], ['neidentificati', 'Neidentificați'], ['erori', 'Erori']].map(([k, et]) => (
              <button key={k} onClick={() => setSubTab(k)} style={{ padding:'6px 12px', background:'transparent', border:'none', borderBottom: subTab === k ? `2px solid ${G.green}` : '2px solid transparent', color: subTab === k ? G.text : G.muted, cursor:'pointer', fontSize:12.5, fontWeight:600 }}>
                {et} ({Array.isArray(preview[k]) ? preview[k].length : 0})
              </button>
            ))}
          </div>
          {subTab === 'erori' ? (
            (preview.erori || []).length === 0 ? <Gol text="Nicio eroare." /> : (
              <div style={{ maxHeight:360, overflow:'auto' }}>
                {preview.erori.map((e, i) => <div key={i} style={{ padding:'5px 0', borderTop:`1px solid ${G.border}`, fontSize:12.5, color:G.red }}>{e.rand ? `Rând ${e.rand}: ` : ''}{e.motiv}{e.uat ? <span style={{ color:G.muted }}> · UAT „{e.uat}”</span> : null}</div>)}
              </div>
            )
          ) : (<>
            {subTab === 'parcele' && <div style={{ fontSize:12, color:G.muted, marginBottom:6 }}>ID-urile parcelelor sunt <b>provizorii</b> (numărul apare ca ????) — numerele finale se rezervă în BD la import și apar în raport.</div>}
            <TabelPreview randuri={Array.isArray(preview[subTab]) ? preview[subTab] : []} gol="Nimic în această categorie." />
          </>)}

          <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:12, alignItems:'center' }}>
            {progres && <span style={{ fontSize:12.5, color:G.muted }}>{progres.etapa ? progres.etapa + ' · ' : ''}{progres.facut} / {progres.total}</span>}
            {progres && <div style={{ width:160, height:6, background:G.border2, borderRadius:3, overflow:'hidden' }}><div style={{ width:`${progres.total ? Math.min(100, Math.round(progres.facut / progres.total * 100)) : 0}%`, height:'100%', background:G.green }} /></div>}
            {!poateScrie && <span style={{ fontSize:12.5, color:G.muted }}>Doar admin/editor pot importa.</span>}
            {poateScrie && <button style={S.btnP} onClick={importa} disabled={lucru || !(preview.parcele?.length)}>{lucru ? 'Import în curs…' : `📥 Importă ${preview.parcele?.length || 0} parcele`}</button>}
          </div>
          {preview.erori?.length > 0 && <div style={{ fontSize:12, color:G.yellow, marginTop:6 }}>⚠ Rândurile cu erori nu intră în import; corectează fișierul sau continuă fără ele.</div>}
        </div>
      )}

      {raport && (
        <div style={{ ...S.card, borderColor:G.green }}>
          <div style={{ fontWeight:700, marginBottom:8 }}>4. Raport import</div>
          <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
            {statCard('Parcele noi', fmtNum(raport.parceleNoi), G.green)}
            {statCard('Deținători noi', fmtNum(raport.detinatoriNoi), G.blue)}
            {statCard('Contacte', fmtNum(raport.contacteNoi))}
            {statCard('Parcele existente (sărite)', fmtNum(raport.existente ?? 0), raport.existente ? G.orange : G.text)}
          </div>
          <div style={{ fontSize:12, color:G.muted, marginTop:8 }}>Lot import: <span style={S.mono}>{raport.lotId || '-'}</span> · lista „{versiune}” · {sursa}</div>
          {Array.isArray(raport.idParcele) && raport.idParcele.length > 0 && (
            <div style={{ marginTop:10 }}>
              <div style={{ fontSize:12.5, fontWeight:600, marginBottom:4 }}>ID-urile finale ale parcelelor ({raport.idParcele.length})</div>
              <div style={{ ...S.mono, fontSize:12, background:G.bg, border:`1px solid ${G.border}`, borderRadius:7, padding:10, maxHeight:220, overflow:'auto', display:'flex', flexWrap:'wrap', gap:'4px 12px' }}>
                {raport.idParcele.map((id, i) => <span key={i}>{typeof id === 'string' ? id : (id?.id_parcela || JSON.stringify(id))}</span>)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
