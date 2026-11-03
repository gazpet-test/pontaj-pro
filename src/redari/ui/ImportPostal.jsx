import React, { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase.js'
import { descarcaBlob } from '../docx.js'
import { citesteFisierPostal, ghicesteMaparea, propune, aplica, confirmariAplicare, reevalueazaTermene, confirmareTermeneSchimbate } from '../importPostal.js'
import { G, S, Camp, Gol, msgEroare, fmtDate, MOTIVE_RETUR, etichetaRetur, citestePaginat } from './comune.jsx'
import { TERMEN_CONVOCARE_ZILE } from '../setari.js'

const TIPURI = { expediere: 'Expediere', ar: 'Confirmare primire (AR)', retur: 'Retur' }
const CAMPURI = { nr_document: 'Nr. plic (PL-XXX-nnnn)', nr_tracking: 'Tracking', data: 'Data', eveniment: 'Eveniment', motiv: 'Motiv retur' }

// Only project-scoped IDs, keyset to EMPTY page, at most 100 IDs per URL.
export async function citesteConvocariPostal(client, proiectId, esteCurent) {
  return citestePaginat(() => client.from('red_plicuri')
    .select('id,proiect_id,uat_id,nr_plic,lot_id,opis_path,awb,data_expediere,data_ar,retur,retur_data,stare,versiune')
    .eq('proiect_id', proiectId), { cheie: 'id', esteCurent })
}
// Copilot f-v2 r3 P2-01: UAT-urile proiectului, citite proaspăt la previzualizare, pentru termenul de expediere (ziua 1 − 10 zile)
export async function citesteUatPostal(client, proiectId, esteCurent) {
  return citestePaginat(() => client.from('red_uat').select('id,nume,sesiune_zi1').eq('proiect_id', proiectId), { cheie: 'id', esteCurent })
}
function schimbari(patch) {
  return Object.entries(patch || {}).map(([k, v]) => `${k}: ${k === 'retur' ? etichetaRetur(v) : k === 'awb' ? v : fmtDate(v)}`).join('; ')
}

function Tabel({ titlu, randuri }) {
  return <div style={{ ...S.card, marginTop: 12, overflowX: 'auto' }}>
    <b>{titlu} ({randuri.length})</b>
    {randuri.length ? <>
      <p style={{ color: G.muted }}>Primele {Math.min(200, randuri.length)} rânduri din {randuri.length}.</p>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr>
        {['Rând fișier', 'Nr. document', 'Tracking', 'Tip', 'Modificări / motiv'].map(c => <th key={c} style={S.th}>{c}</th>)}
      </tr></thead><tbody>{randuri.slice(0, 200).map((r, i) => <tr key={`${r.rand}/${i}`}>
        <td style={S.td}>{r.rand}</td><td style={S.td}>{r.nr_document || '-'}</td>
        <td style={S.td}>{r.tracking || '-'}</td><td style={S.td}>{TIPURI[r.tip] || '-'}</td>
        <td style={S.td}>{r.motiv || schimbari(r.patch) || 'Deja înregistrat'}
          {r.avertisment && <div role="alert" style={{ color: G.yellow }}>⚠ {r.avertisment}</div>}</td>
      </tr>)}</tbody></table>
    </> : <Gol />}
  </div>
}

export default function ImportPostal({ proiect, nivel, onSchimbat }) {
  const [fisier, setFisier] = useState(null), [mod, setMod] = useState('expediere')
  const [mapare, setMapare] = useState({}), [preview, setPreview] = useState(null)
  const [raport, setRaport] = useState(null), [lucru, setLucru] = useState(false), [mesaj, setMesaj] = useState('')
  const generatie = useRef(0), ocupat = useRef(false), input = useRef(null)
  const identitate = useRef(proiect.id)
  identitate.current = proiect.id
  useEffect(() => {
    generatie.current++; ocupat.current = false
    setFisier(null); setMapare({}); setPreview(null); setRaport(null); setMesaj(''); setLucru(false)
    if (input.current) input.current.value = ''
    return () => { generatie.current++ }
  }, [proiect.id, nivel])
  const poateScrie = nivel === 'admin' || nivel === 'editor'
  const reset = () => { generatie.current++; setPreview(null); setRaport(null); setMesaj('') }
  const incepe = () => {
    ocupat.current = true; setLucru(true); setMesaj('')
    const token = ++generatie.current, id = proiect.id
    return () => generatie.current === token && identitate.current === id
  }
  async function alege(e) {
    if (ocupat.current || !poateScrie) return
    const f = e.target.files?.[0]
    reset(); setFisier(null); setMapare({})
    if (!f) return
    const curent = incepe()
    try {
      const buffer = await f.arrayBuffer()
      if (!curent()) return
      const date = citesteFisierPostal(buffer, f.name)
      if (curent()) { setFisier(date); setMapare(ghicesteMaparea(date.coloane)) }
    } catch (e) { if (curent()) setMesaj(msgEroare(e)) }
    finally { if (curent()) { ocupat.current = false; setLucru(false) } }
  }
  async function previzualizeaza() {
    if (ocupat.current || !poateScrie || !fisier) return
    const curent = incepe()
    setPreview(null); setRaport(null)
    try {
      let convocari, uats
      try { [convocari, uats] = await Promise.all([citesteConvocariPostal(supabase, proiect.id, curent), citesteUatPostal(supabase, proiect.id, curent)]) }
      catch { throw new Error('Nu s-au putut citi toate plicurile și UAT-urile. Previzualizarea nu a fost creată.') }
      if (curent()) setPreview(propune(fisier.randuri, mapare, mod, convocari, { date1904: !!fisier.date1904, imputernicire: !!(String(proiect?.imputernicire_nr || '').trim() && proiect?.imputernicire_data), uats }))
    } catch (e) { if (curent()) setMesaj(msgEroare(e)) }
    finally { if (curent()) { ocupat.current = false; setLucru(false) } }
  }
  async function confirma() {
    if (ocupat.current || !poateScrie || !preview?.aplicabile.length || raport) return
    // a doua confirmare numără expedierile după termenul de 10 zile; oricare refuz = nu se aplică nimic
    for (const m of confirmariAplicare(preview, proiect.cod)) if (!window.confirm(m)) return
    const curent = incepe()
    try {
      // Copilot f-v2 r4 P2: ziua 1 se recitește imediat înainte de aplicare; dacă termenele diferă de previzualizare,
      // confirmarea se cere pe valorile de acum; recitire eșuată = nu se aplică nimic
      let uatsAcum
      try { uatsAcum = await citesteUatPostal(supabase, proiect.id, curent) }
      catch { if (curent()) setMesaj('Nu pot reciti zilele de sesiune ale UAT-urilor; nu s-a aplicat nimic. Reîncearcă.'); return }
      if (!curent()) return
      let reevaluat
      try { reevaluat = reevalueazaTermene(preview.aplicabile, uatsAcum) }
      catch (e) { setMesaj(msgEroare(e)); return }
      if (reevaluat.schimbat) {
        setPreview(p => (p ? { ...p, aplicabile: reevaluat.aplicabile } : p))
        if (!window.confirm(confirmareTermeneSchimbate(reevaluat.aplicabile))) { setMesaj('Ziua 1 de sesiune s-a schimbat între timp; nu s-a aplicat nimic. Previzualizarea arată termenele de acum.'); return }
      }
      const r = await aplica(supabase, reevaluat.aplicabile, { esteCurent: curent })
      if (!curent()) return
      setRaport(r)
      setMesaj(`Aplicate: ${r.aplicate.length}; conflicte: ${r.conflicte.length}; erori cu rezultat neconfirmat: ${r.erori.length}; neprocesate: ${r.neprocesate.length}. Verifică în Plicuri înainte de reluare.`)
      if (r.aplicate.length) onSchimbat?.()
    } finally { if (curent()) { ocupat.current = false; setLucru(false) } }
  }
  const exceptii = [...(preview?.exceptii || []), ...(raport?.conflicte || []), ...(raport?.erori || []),
    ...(raport?.neprocesate || []).map(r => ({ ...r, motiv: 'Neprocesat: import oprit.' }))]
  function descarca() {
    const celula = v => {
      const s = String(v ?? '')
      return `"${(/^[\s]*[=+@-]/.test(s) ? "'" : '') + s.replace(/"/g, '""')}"`
    }
    const csv = [['rand', 'nr_document', 'tracking', 'motiv'], ...exceptii.map(r => [r.rand, r.nr_document, r.tracking, r.motiv])]
      .map(r => r.map(celula).join(';')).join('\r\n')
    descarcaBlob(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), 'exceptii-postale.csv')
  }
  if (!poateScrie) return null
  return <div>
    <p>CSV-ul înregistrează numai expedierea plicurilor cu lot. AR și retur se înregistrează cu scanul în Plicuri. Nimic nu se scrie fără confirmare; conflictele rămân pentru verificare manuală în Plicuri.</p>
    <div style={{ ...S.card, display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
      <Camp eticheta="1. Fișier poștal (XLSX / XLS / CSV UTF-8)"><input ref={input} style={S.input} type="file" accept=".xlsx,.xls,.csv" disabled={lucru} onChange={alege} /></Camp>
      <Camp eticheta="Mod implicit"><select style={S.select} disabled={lucru} value={mod} onChange={e => { reset(); setMod(e.target.value) }}>
        {Object.entries(TIPURI).filter(([k]) => k === 'expediere').map(([k, v]) => <option key={k} value={k}>{v}</option>)}   {/* AR / retur doar în Plicuri, cu scan (Copilot f10 UI P3-03) */}
      </select></Camp>
    </div>
    {fisier && <div style={{ ...S.card, marginTop: 12 }}>
      <b>2. Mapare coloane ({fisier.randuri.length} rânduri)</b>
      <p style={{ color: G.muted }}>Obligatoriu: număr de plic sau AWB și data. Coloana eveniment poate înlocui modul implicit pentru fiecare rând. Motivul de retur se citește din coloana mapată.</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>{Object.entries(CAMPURI).map(([k, label]) => <Camp key={k} eticheta={label}>
        <select style={S.select} value={mapare[k] || ''} disabled={lucru} onChange={e => { reset(); setMapare(m => ({ ...m, [k]: e.target.value })) }}>
          <option value="">— Nemapat —</option>{fisier.coloane.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </Camp>)}</div>
      <p style={{ color: G.muted }}>Motive acceptate: {MOTIVE_RETUR.map(m => m.eticheta).join('; ')}.</p>
      <button style={S.btnS} disabled={lucru || !mapare.data || (!mapare.nr_document && !mapare.nr_tracking)} onClick={previzualizeaza}>3. Previzualizează</button>
    </div>}
    {lucru && <p role="status">Se prelucrează…</p>}
    {mesaj && <p role="status" style={{ color: G.yellow }}>{mesaj}</p>}
    {preview && <>
      <div style={{ display: 'flex', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
        {[['De aplicat', preview.aplicabile.length], ['Deja', preview.deja.length], ['Excepții', preview.exceptii.length]].map(([k, n]) => <div key={k} style={S.card}>{k}: <b>{n}</b></div>)}
        {preview.aplicabile.some(a => a.avertisment) && <div role="alert" style={{ ...S.card, color: G.yellow }}>După termenul de {TERMEN_CONVOCARE_ZILE} zile: <b>{preview.aplicabile.filter(a => a.avertisment).length}</b> (se înregistrează, cu confirmare)</div>}
      </div>
      <Tabel titlu="Propuneri" randuri={preview.aplicabile} /><Tabel titlu="Deja înregistrate" randuri={preview.deja} />
      <Tabel titlu="Excepții / conflicte / erori" randuri={exceptii} />
      {exceptii.length > 0 && <button style={{ ...S.btnS, marginTop: 12 }} onClick={descarca}>Descarcă excepțiile CSV</button>}{' '}
      <button style={S.btnP} disabled={lucru || !!raport || !preview.aplicabile.length} onClick={confirma}>4. Aplică {preview.aplicabile.length} modificări</button>
    </>}
  </div>
}
