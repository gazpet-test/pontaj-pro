/* ConvocatoareMasa.jsx — panoul „📦 Generează convocatoarele UAT-ului” (L1, docs/redari/PLAN_CONVOCATOARE_MASA.md).
   Doar admin / editor. Verifică (citiri) → generează cel mult 200 pe rulare, cu progres și oprire → zip (DOCX + borderou.csv + opis.xlsx).
   Nu marchează expediat, nu trimite nimic. Logica: ../convocatoareMasa.js. */
import React, { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase.js'
import { G, S, Camp, msgEroare, azi, SABLON_CONVOCATOR } from './comune.jsx'
import { descarcaBlob } from '../docx.js'
import { pregatesteLot, executaLot, construiesteZip, sumar, numereDeConsumat, limitaValida, LIMITA_LOT, ACTIUNI } from '../convocatoareMasa.js'

export default function ConvocatoareMasa({ proiect, uats, nivel, show, onSchimbat }) {
  const poateScrie = nivel === 'admin' || nivel === 'editor'
  const [uatId, setUatId] = useState('')
  const [limita, setLimita] = useState(LIMITA_LOT)
  const [pregatit, setPregatit] = useState(null)   // { uatId, blocat, plan, exclusi }
  const [lucru, setLucru] = useState(false)
  const [progres, setProgres] = useState(null)     // { i, n, text }
  const [rezultat, setRezultat] = useState(null)   // { raport, exclusi, sumar, numeZip }
  const [arataExclusi, setArataExclusi] = useState(false)
  const oprit = useRef(false)
  const montat = useRef(true)
  const generatie = useRef(0)
  useEffect(() => () => { montat.current = false; oprit.current = true; generatie.current++ }, [])
  useEffect(() => { setPregatit(null); setRezultat(null); generatie.current++ }, [uatId, proiect.id])

  if (!poateScrie) return null
  const uat = uats.find(u => u.id === uatId) || null

  const verifica = async () => {
    if (!uat) { show('Alege UAT-ul.', 'error'); return }
    const g = ++generatie.current
    setLucru(true); setRezultat(null); setPregatit(null); setProgres({ text: 'Citesc deținătorii UAT-ului…' })
    try {
      const rez = await pregatesteLot(supabase, { proiect, uat, esteCurent: () => g === generatie.current && montat.current })
      if (g !== generatie.current) return
      setPregatit({ uatId: uat.id, ...rez })
    } catch (e) { if (g === generatie.current) show('Verificare: ' + msgEroare(e), 'error') }
    finally { if (g === generatie.current) { setLucru(false); setProgres(null) } }
  }

  const genereaza = async () => {
    if (!pregatit || pregatit.blocat || pregatit.uatId !== uat?.id || !pregatit.plan.length) return
    const lim = limitaValida(limita), noi = numereDeConsumat(pregatit.plan, lim)
    const deFacut = Math.min(lim, pregatit.plan.length)
    if (!window.confirm(`Generez ${deFacut} convocatoare pentru UAT ${uat.nume}?\n` +
      `${noi} numere noi C-nnnn se rezervă (consum ireversibil), restul se reiau cu numărul existent.\nNu se marchează nimic expediat și nu se trimite nimic.`)) return
    const g = ++generatie.current
    oprit.current = false
    setLucru(true); setRezultat(null); setProgres({ i: 0, n: deFacut, text: 'Descarc șablonul…' })
    try {
      const rs = await fetch(SABLON_CONVOCATOR)
      if (!rs.ok) throw new Error(`Șablonul convocatorului lipsește (${rs.status}).`)
      const templateArrayBuffer = await rs.arrayBuffer()
      const { fisiere, raport } = await executaLot(supabase, { plan: pregatit.plan, proiect, uat, templateArrayBuffer, limita: lim,
        esteOprit: () => oprit.current || g !== generatie.current,
        onProgres: ({ i, n, rand }) => { if (montat.current) setProgres({ i, n, text: `${rand.id_parcela} · ${rand.nume}` }) } })
      const s = sumar(raport, pregatit.exclusi)
      let numeZip = null
      if (fisiere.length) {
        if (montat.current) setProgres({ text: 'Fac arhiva zip…' })
        const zip = await construiesteZip({ proiect, uat, fisiere, raport, exclusi: pregatit.exclusi })
        numeZip = `convocatoare_${proiect.cod}_${uat.uat3}_${azi()}.zip`
        descarcaBlob(zip, numeZip)
      }
      if (!montat.current) return
      setRezultat({ raport, exclusi: pregatit.exclusi, sumar: s, numeZip })
      setPregatit(null)
      show(`Lot gata: ${s.nou} noi, ${s.reia} reluate, ${s.reincarca} reîncărcate${s.erori ? `, ${s.erori} erori` : ''}${s.oprite ? `, ${s.oprite} oprite` : ''}.`, s.erori ? 'error' : 'success')
      onSchimbat?.()
    } catch (e) { if (montat.current) show('Generare în masă: ' + msgEroare(e), 'error') }
    finally { if (montat.current) { setLucru(false); setProgres(null) } }
  }

  const plan = pregatit?.plan || []
  const lim = limitaValida(limita)
  const nr = (a) => plan.slice(0, lim).filter(p => p.actiune === a).length

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
        <Camp eticheta={`Limită pe lot (max ${LIMITA_LOT})`}>
          <input type="number" min={1} max={LIMITA_LOT} value={limita} onChange={e => setLimita(e.target.value)} style={{ ...S.input, width: 90 }} disabled={lucru} />
        </Camp>
        <button style={S.btnS} onClick={verifica} disabled={lucru || !uat}>Verifică</button>
        <button style={{ ...S.btnP, opacity: (!pregatit || pregatit.blocat || !plan.length) ? 0.5 : 1 }} onClick={genereaza}
          disabled={lucru || !pregatit || !!pregatit.blocat || !plan.length}>📦 Generează convocatoarele UAT-ului</button>
        {lucru && progres?.n != null && <button style={{ ...S.btnS, borderColor: G.red, color: G.red }} onClick={() => { oprit.current = true }}>⏹ Oprește</button>}
      </div>
      <div style={{ fontSize: 12, color: G.muted, marginTop: 6 }}>Zip cu DOCX-urile + borderou.csv + opis.xlsx. Cine are deja convocator neexpediat nu primește număr nou. Nu se marchează expediat, nu se trimite nimic.</div>

      {progres && <div style={{ fontSize: 12.5, marginTop: 8, color: G.blue }}>{progres.n != null && progres.i ? `${progres.i} / ${progres.n} · ` : ''}{progres.text}</div>}

      {pregatit?.blocat && <div style={{ ...S.card, borderColor: G.red, color: G.red, fontSize: 12.5, marginTop: 10 }}>⛔ Lotul nu se poate genera: {pregatit.blocat}. Niciun număr consumat.</div>}
      {pregatit && !pregatit.blocat && (
        <div style={{ fontSize: 13, marginTop: 10 }}>
          <div>De generat în lotul ăsta: <b>{nr('nou')}</b> noi (numere C rezervate) · <b>{nr('reia')}</b> reluate · <b>{nr('reincarca')}</b> reîncărcate
            {plan.length > lim && <> · <span style={{ color: G.yellow }}>{plan.length - lim} amânate (peste limită)</span></>}
            {' '}· <span style={{ color: pregatit.exclusi.length ? G.yellow : G.muted }}>{pregatit.exclusi.length} excluși</span>
            {pregatit.exclusi.length > 0 && <button style={{ ...S.btnX, marginLeft: 8 }} onClick={() => setArataExclusi(v => !v)}>{arataExclusi ? 'ascunde' : 'vezi motivele'}</button>}
          </div>
          {arataExclusi && <ListaMotive randuri={pregatit.exclusi.map(x => ({ rand: x.rand, motiv: x.motiv }))} />}
        </div>
      )}

      {rezultat && (
        <div style={{ fontSize: 13, marginTop: 10 }}>
          <div>✅ <b>{rezultat.sumar.nou}</b> noi · <b>{rezultat.sumar.reia}</b> reluate · <b>{rezultat.sumar.reincarca}</b> reîncărcate
            {rezultat.sumar.erori > 0 && <> · <span style={{ color: G.red }}>{rezultat.sumar.erori} erori</span></>}
            {rezultat.sumar.oprite > 0 && <> · {rezultat.sumar.oprite} oprite</>}
            {rezultat.sumar.amanate > 0 && <> · {rezultat.sumar.amanate} amânate</>}
            {' '}· {rezultat.sumar.exclusi} excluși{rezultat.numeZip ? <> · descărcat <code>{rezultat.numeZip}</code></> : ' · niciun fișier'}</div>
          {rezultat.raport.some(r => r.stare === 'eroare') && <ListaMotive titlu="Erori (lotul a continuat):" culoare={G.red}
            randuri={rezultat.raport.filter(r => r.stare === 'eroare').map(r => ({ rand: r.rand, motiv: `${r.nrDocument ? r.nrDocument + ' · ' : ''}${ACTIUNI[r.actiune]}: ${r.motiv}` }))} />}
          {(rezultat.sumar.oprite > 0 || rezultat.sumar.amanate > 0 || rezultat.sumar.erori > 0) && <div style={{ fontSize: 12, color: G.muted, marginTop: 6 }}>Rulează din nou „Verifică” + „Generează”: ce s-a generat se reia cu același număr, restul continuă.</div>}
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
