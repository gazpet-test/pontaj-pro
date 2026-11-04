/* ConvocatoareMasa.jsx — panoul „📦 Generează convocatoarele UAT-ului” (L1, docs/redari/PLAN_CONVOCATOARE_MASA.md).
   Doar admin / editor. Verifică (citiri) → generează cel mult 200 de convocatoare NOI pe rulare, cu progres și oprire → zip
   (DOCX + borderou.csv + opis.xlsx). Nu marchează expediat, nu trimite nimic. Logica: ../convocatoareMasa.js. */
import React, { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase.js'
import { G, S, Camp, msgEroare, azi, SABLON_CONVOCATOR } from './comune.jsx'
import { descarcaBlob } from '../docx.js'
import { pregatesteLot, executaLot, construiesteZip, sumar, numereDeConsumat, limitaValida, selecteazaLot, LIMITA_LOT, ACTIUNI, AVERTISMENT_FARA_PROTECTIE } from '../convocatoareMasa.js'

export default function ConvocatoareMasa({ proiect, uats, nivel, show, onSchimbat }) {
  const poateScrie = nivel === 'admin' || nivel === 'editor'
  const [uatId, setUatId] = useState('')
  const [limita, setLimita] = useState(LIMITA_LOT)
  const [includeGenerate, setIncludeGenerate] = useState(false)
  const [pregatit, setPregatit] = useState(null)   // { uatId, blocat, plan, exclusi, protectie }
  const [lucru, setLucru] = useState(false)
  const [progres, setProgres] = useState(null)     // { i, n, text }
  const [rezultat, setRezultat] = useState(null)   // { raport, exclusi, sumar, fisiere, avertismente, uat, numeZip, eroareZip }
  const [arataExclusi, setArataExclusi] = useState(false)
  const oprit = useRef(false)
  const montat = useRef(false)
  const generatie = useRef(0)
  // StrictMode: setup-ul repune montat = true după cleanup-ul de probă
  useEffect(() => { montat.current = true; return () => { montat.current = false; oprit.current = true; generatie.current++ } }, [])
  useEffect(() => { setPregatit(null); setRezultat(null); generatie.current++ }, [uatId, proiect.id])

  if (!poateScrie) return null
  const uat = uats.find(u => u.id === uatId) || null

  const verifica = async () => {
    if (!uat) { show('Alege UAT-ul.', 'error'); return }
    const g = ++generatie.current
    const curent = () => g === generatie.current && montat.current
    setLucru(true); setRezultat(null); setPregatit(null); setProgres({ text: 'Citesc deținătorii UAT-ului…' })
    try {
      const rez = await pregatesteLot(supabase, { proiect, uat, esteCurent: curent })
      if (!curent()) return
      setPregatit({ uatId: uat.id, ...rez })
    } catch (e) { if (curent()) show('Verificare: ' + msgEroare(e), 'error') }
    finally { if (curent()) { setLucru(false); setProgres(null) } }
  }

  // zip din rezultatele păstrate (și pentru reîncercarea exportului, fără regenerare)
  const descarcaZip = async (rez) => {
    try {
      if (!rez.fisiere.length) return
      const zip = await construiesteZip({ proiect, uat: rez.uat, fisiere: rez.fisiere, raport: rez.raport, exclusi: rez.exclusi })
      if (!montat.current) return
      const numeZip = `convocatoare_${proiect.cod}_${rez.uat.uat3}_${azi()}.zip`
      descarcaBlob(zip, numeZip)
      setRezultat(r => (r === rez || r?.fisiere === rez.fisiere) ? { ...r, numeZip, eroareZip: null } : r)
    } catch (e) {
      if (!montat.current) return
      setRezultat(r => (r?.fisiere === rez.fisiere) ? { ...r, eroareZip: msgEroare(e) } : r)
      show('Arhiva zip: ' + msgEroare(e) + ' — documentele sunt salvate; reîncearcă descărcarea.', 'error')
    }
  }

  const genereaza = async () => {
    if (!pregatit || pregatit.blocat || pregatit.uatId !== uat?.id) return
    const plan = pregatit.plan, lim = limitaValida(limita), noi = numereDeConsumat(plan, lim)
    const deFacut = selecteazaLot(plan, { limita: lim, includeGenerate }).filter(s => s.decizie === 'fa').length
    if (!deFacut) { show('Nimic de generat în lotul ăsta.', 'error'); return }
    if (!window.confirm(`Generez ${deFacut} convocatoare pentru UAT ${uat.nume}?\n` +
      `Cel mult ${noi} numere noi C-nnnn se rezervă (consum ireversibil); restul se reiau cu numărul existent.\n` +
      (pregatit.protectie ? '' : `ATENȚIE: ${AVERTISMENT_FARA_PROTECTIE}\n`) +
      'Nu se marchează nimic expediat și nu se trimite nimic.')) return
    const g = ++generatie.current
    const pentruUat = uat, exclusi = pregatit.exclusi
    oprit.current = false
    setLucru(true); setRezultat(null); setProgres({ i: 0, n: deFacut, text: 'Descarc șablonul…' })
    let rez = null
    try {
      const rs = await fetch(SABLON_CONVOCATOR)
      if (!rs.ok) throw new Error(`Șablonul convocatorului lipsește (${rs.status}).`)
      const templateArrayBuffer = await rs.arrayBuffer()
      setPregatit(null)   // P2: planul de scriere nu mai e refolosibil din clipa în care începe execuția
      const { fisiere, raport, avertismente } = await executaLot(supabase, { plan, proiect, uat: pentruUat, templateArrayBuffer, limita: lim, includeGenerate,
        protectie: pregatit.protectie, esteOprit: () => oprit.current || g !== generatie.current,
        onProgres: ({ i, n, rand }) => { if (montat.current) setProgres({ i, n, text: `${rand.id_parcela} · ${rand.nume}` }) } })
      rez = { raport, exclusi, sumar: sumar(raport, exclusi), fisiere, avertismente, uat: pentruUat, numeZip: null, eroareZip: null }
      if (!montat.current) return
      setRezultat(rez)
      onSchimbat?.()
      const s = rez.sumar
      show(`Lot gata: ${s.nou} noi, ${s.reia} reluate, ${s.reincarca} reîncărcate${s.erori ? `, ${s.erori} erori` : ''}${s.schimbate ? `, ${s.schimbate} schimbate între timp` : ''}${s.oprite ? `, ${s.oprite} oprite` : ''}.`, s.erori ? 'error' : 'success')
      setProgres({ text: 'Fac arhiva zip…' })
      await descarcaZip(rez)
    } catch (e) { if (montat.current) show('Generare în masă: ' + msgEroare(e), 'error') }
    finally { if (montat.current) { setLucru(false); setProgres(null) } }
  }

  const plan = pregatit?.plan || []
  const lim = limitaValida(limita)
  const sel = selecteazaLot(plan, { limita: lim, includeGenerate })
  const nr = (a) => sel.filter(s => s.decizie === 'fa' && s.p.actiune === a).length
  const nrDeja = sel.filter(s => s.decizie === 'deja').length, nrAmanat = sel.filter(s => s.decizie === 'amanat').length
  const nimic = !pregatit || !!pregatit.blocat || !sel.some(s => s.decizie === 'fa')

  return (
    <div style={{ ...S.card, marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginRight: 6 }}>📦 Convocatoare în masă (poștă)</div>
        <Camp eticheta="UAT">
          <select value={uatId} onChange={e => setUatId(e.target.value)} style={S.select} disabled={lucru}>
            <option value="">— alege —</option>
            {uats.map(u => <option key={u.id} value={u.id}>{u.nume} ({u.uat3})</option>)}
          </select>
        </Camp>
        <Camp eticheta={`Convocatoare noi pe lot (max ${LIMITA_LOT})`}>
          <input type="number" min={1} max={LIMITA_LOT} value={limita} onChange={e => setLimita(e.target.value)} style={{ ...S.input, width: 90 }} disabled={lucru} />
        </Camp>
        <label style={{ fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 6, paddingBottom: 6 }}>
          <input type="checkbox" checked={includeGenerate} onChange={e => setIncludeGenerate(e.target.checked)} disabled={lucru} /> include și cele deja generate (redescărcare)
        </label>
        <button style={S.btnS} onClick={verifica} disabled={lucru || !uat}>Verifică</button>
        <button style={{ ...S.btnP, opacity: nimic ? 0.5 : 1 }} onClick={genereaza} disabled={lucru || nimic}>📦 Generează convocatoarele UAT-ului</button>
        {lucru && progres?.n != null && <button style={{ ...S.btnS, borderColor: G.red, color: G.red }} onClick={() => { oprit.current = true }}>⏹ Oprește</button>}
      </div>
      <div style={{ fontSize: 12, color: G.muted, marginTop: 6 }}>Zip cu DOCX-urile + borderou.csv + opis.xlsx. Cine are deja convocator neexpediat nu primește număr nou. Nu se marchează expediat, nu se trimite nimic.</div>

      {progres && <div style={{ fontSize: 12.5, marginTop: 8, color: G.blue }}>{progres.n != null && progres.i ? `${progres.i} / ${progres.n} · ` : ''}{progres.text}</div>}

      {pregatit?.blocat && <div style={{ ...S.card, borderColor: G.red, color: G.red, fontSize: 12.5, marginTop: 10 }}>⛔ Lotul nu se poate genera: {pregatit.blocat}. Niciun număr consumat.</div>}
      {pregatit && !pregatit.blocat && pregatit.protectie === false && <div style={{ ...S.card, borderColor: G.yellow, color: G.yellow, fontSize: 12.5, marginTop: 10 }}>⚠ {AVERTISMENT_FARA_PROTECTIE}</div>}
      {pregatit && !pregatit.blocat && (
        <div style={{ fontSize: 13, marginTop: 10 }}>
          <div>În lotul ăsta: <b>{nr('nou')}</b> noi (numere C rezervate) · <b>{nr('reincarca')}</b> reîncărcate · <b>{nr('reia')}</b> reluate
            {nrDeja > 0 && <> · <span style={{ color: G.muted }}>{nrDeja} deja generate (nu intră în zip)</span></>}
            {nrAmanat > 0 && <> · <span style={{ color: G.yellow }}>{nrAmanat} noi amânate (peste limită)</span></>}
            {' '}· <span style={{ color: pregatit.exclusi.length ? G.yellow : G.muted }}>{pregatit.exclusi.length} excluși</span>
            {pregatit.exclusi.length > 0 && <button style={{ ...S.btnX, marginLeft: 8 }} onClick={() => setArataExclusi(v => !v)}>{arataExclusi ? 'ascunde' : 'vezi motivele'}</button>}
          </div>
          {arataExclusi && <ListaMotive randuri={pregatit.exclusi.map(x => ({ rand: x.rand, motiv: x.motiv }))} />}
        </div>
      )}

      {rezultat && (
        <div style={{ fontSize: 13, marginTop: 10 }}>
          {rezultat.avertismente.map((a, i) => <div key={i} style={{ color: G.yellow, fontSize: 12.5 }}>⚠ {a}</div>)}
          <div>✅ <b>{rezultat.sumar.nou}</b> noi · <b>{rezultat.sumar.reia}</b> reluate · <b>{rezultat.sumar.reincarca}</b> reîncărcate
            {rezultat.sumar.erori > 0 && <> · <span style={{ color: G.red }}>{rezultat.sumar.erori} erori</span></>}
            {rezultat.sumar.schimbate > 0 && <> · <span style={{ color: G.yellow }}>{rezultat.sumar.schimbate} schimbate între timp</span></>}
            {rezultat.sumar.oprite > 0 && <> · {rezultat.sumar.oprite} oprite</>}
            {rezultat.sumar.amanate > 0 && <> · {rezultat.sumar.amanate} amânate</>}
            {' '}· {rezultat.sumar.exclusi} excluși{rezultat.numeZip ? <> · descărcat <code>{rezultat.numeZip}</code></> : rezultat.fisiere.length ? '' : ' · niciun fișier'}</div>
          {rezultat.fisiere.length > 0 && <button style={{ ...S.btnS, marginTop: 6 }} disabled={lucru} onClick={() => descarcaZip(rezultat)}>⬇ Descarcă din nou zip-ul{rezultat.eroareZip ? ' (a eșuat)' : ''}</button>}
          {rezultat.raport.some(r => r.stare === 'eroare' || r.stare === 'schimbat') && <ListaMotive titlu="Erori / schimbate între timp (lotul a continuat):" culoare={G.red}
            randuri={rezultat.raport.filter(r => r.stare === 'eroare' || r.stare === 'schimbat').map(r => ({ rand: r.rand, motiv: `${r.nrDocument ? r.nrDocument + ' · ' : ''}${ACTIUNI[r.actiune]}: ${r.motiv}` }))} />}
          {(rezultat.sumar.oprite > 0 || rezultat.sumar.amanate > 0 || rezultat.sumar.erori > 0 || rezultat.sumar.schimbate > 0) && <div style={{ fontSize: 12, color: G.muted, marginTop: 6 }}>Rulează din nou „Verifică” + „Generează”: ce s-a generat nu mai consumă număr, iar limita se aplică doar celor noi.</div>}
        </div>
      )}
    </div>
  )
}

function ListaMotive({ randuri, titlu, culoare = G.text }) {
  return (
    <div style={{ maxHeight: 220, overflowY: 'auto', marginTop: 6, fontSize: 12 }}>
      {titlu && <div style={{ color: culoare, fontWeight: 600 }}>{titlu}</div>}
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {randuri.map((r, i) => <li key={i}><b>{r.rand.id_parcela}</b> · {r.rand.nume}: <span style={{ color: G.muted }}>{r.motiv}</span></li>)}
      </ul>
    </div>
  )
}
