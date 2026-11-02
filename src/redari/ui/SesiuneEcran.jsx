import React, { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase.js'
import { aziBucuresti, formatDataRo } from '../docx.js'
import { zileSesiune, ziImplicita, filtreazaSesiune, rezumatSesiune, randPrezenta, intervalZiBucuresti } from '../sesiune.js'
import { G, S, TagStare, msgEroare } from './comune.jsx'
import ModalPv from './ModalPv.jsx'

const buton = { ...S.btnS, minHeight: 44, fontSize: 16 }
const input = { ...S.input, minHeight: 44, fontSize: 16 }
// Keyset cu range de 500; inclusiv o pagina scurta este urmata pana la gol.
async function pagini(fabrica, cheie, curent) {
  const tot = []
  let ultim
  while (curent()) {
    let q = fabrica().order(cheie).range(0, 499)
    if (ultim !== undefined) q = q.gt(cheie, ultim)
    const { data, error } = await q
    if (error) throw error
    if (!curent()) return null
    if (!Array.isArray(data)) throw new Error('Citire incompleta: lipseste lista.')
    if (!data.length) return tot
    const nou = data.at(-1)[cheie]
    if (nou == null || nou === ultim) throw new Error('Paginarea nu a avansat.')
    tot.push(...data); ultim = nou
  }
  return null
}

export default function SesiuneEcran({ proiect, nivel, show }) {
  const [uats, setUats] = useState(null), [uatId, setUatId] = useState('')
  const [mesaj, setMesaj] = useState(''), [reload, setReload] = useState(0)
  const generatie = useRef(0)
  useEffect(() => {
    const token = ++generatie.current, curent = () => token === generatie.current
    setUats(null); setUatId(''); setMesaj('')
    pagini(() => supabase.from('red_uat').select('id,nume,sesiune_zi1,sesiune_zi2,sesiune_zi3,program_zi1,program_zi2,program_zi3')
      .eq('proiect_id', proiect.id), 'id', curent)
      .then(d => { if (curent()) { setUats(d.sort((a, b) => a.nume.localeCompare(b.nume, 'ro'))); setUatId(d[0]?.id || '') } })
      .catch(e => { if (curent()) setMesaj(msgEroare(e)) })
    return () => { generatie.current++ }
  }, [proiect.id, reload])
  const uat = uats?.find(u => u.id === uatId)
  return <div style={S.card}>
    {mesaj && <p role="alert">{mesaj}</p>}
    {!uats && !mesaj && <p>Se încarcă UAT-urile...</p>}
    {mesaj && <button style={buton} onClick={() => setReload(n => n + 1)}>↻ Reîncarcă UAT-urile</button>}
    {uats && !uats.length && <p>Niciun UAT în proiect.</p>}
    {!!uats?.length && <label style={{ display: 'block', marginBottom: 12 }}>UAT
      <select aria-label="UAT" style={{ ...input, display: 'block' }} value={uatId} onChange={e => setUatId(e.target.value)}>
        {uats.map(u => <option key={u.id} value={u.id}>{u.nume}</option>)}
      </select>
    </label>}
    {uat && <ListaSesiune key={`${proiect.id}:${uat.id}`} proiectId={proiect.id} uat={uat} nivel={nivel} show={show} />}
  </div>
}

function ListaSesiune({ proiectId, uat, nivel, show }) {
  const [azi, setAzi] = useState(aziBucuresti)
  const zile = zileSesiune(uat)
  const [zi, setZi] = useState(() => ziImplicita(zile, azi))
  const [cauta, setCauta] = useState(''), [doarNesemnate, setDoarNesemnate] = useState(false)
  const [date, setDate] = useState(null), [mesaj, setMesaj] = useState('')
  const [lucru, setLucru] = useState(true), [reload, setReload] = useState(0), [pv, setPv] = useState(null)
  const generatie = useRef(0), ocupat = useRef(true)
  const poateScrie = nivel === 'admin' || nivel === 'editor'
  useEffect(() => {
    const timer = setInterval(() => setAzi(aziBucuresti()), 30000)
    return () => clearInterval(timer)
  }, [])
  const citeste = async curent => {
    const randuri = await pagini(() => supabase.from('red_v_stare_parcela')
      .select('parcela_id,detinator_id,id_parcela,nume,stare,pv_nr,pv_stare').eq('proiect_id', proiectId).eq('uat_id', uat.id), 'detinator_id', curent)
    if (!curent()) return null
    const ids = [...new Set(randuri.map(r => r.detinator_id))], prezenti = new Set()
    const interval = intervalZiBucuresti(azi)
    for (let i = 0; i < ids.length && curent(); i += 100) {
      const raspunsuri = await pagini(() => supabase.from('red_raspunsuri').select('id,detinator_id')
        .eq('canal', 'sesiune').gte('data', interval.de).lt('data', interval.pana).in('detinator_id', ids.slice(i, i + 100)), 'id', curent)
      if (!curent()) return null
      raspunsuri.forEach(r => prezenti.add(r.detinator_id))
    }
    return { randuri, prezenti }
  }
  useEffect(() => {
    const token = ++generatie.current, curent = () => token === generatie.current
    ocupat.current = true; setLucru(true); setDate(null); setMesaj('')
    citeste(curent).then(d => { if (curent()) setDate(d) })
      .catch(e => { if (curent()) setMesaj(msgEroare(e)) })
      .finally(() => { if (curent()) { ocupat.current = false; setLucru(false) } })
    return () => { generatie.current++ }
  }, [proiectId, uat.id, azi, reload])
  const prezent = async rand => {
    if (!poateScrie || ocupat.current || !date || date.prezenti.has(rand.detinator_id) || !zile.some(z => z.data === zi)) return
    ocupat.current = true; setLucru(true); setMesaj('')
    const token = generatie.current, curent = () => token === generatie.current
    let confirmat = false
    try {
      const { data: inserat, error } = await supabase.from('red_raspunsuri')
        .insert(randPrezenta({ detinatorId: rand.detinator_id, zi, acum: new Date().toISOString() })).select('id').single()
      if (!curent()) return
      confirmat = !error && !!inserat?.id
      // Reconciliere inclusiv la timeout; niciodata INSERT repetat automat.
      setDate(null)
      const nou = await citeste(curent)
      if (!curent()) return
      setDate(nou)
      // Copilot f5 r1 P2-02: a doua tableta primeste 23505 de la indexul unic -> prezenta exista deja
      if (error?.code === '23505' && String(error.message||'').includes('red_raspunsuri_prezenta_uq')) setMesaj('Prezența era deja înregistrată (altă tabletă).')
      else if (error) setMesaj(msgEroare(error) + (nou.prezenti.has(rand.detinator_id) ? ' Prezenta exista la recitire.' : ' Prezenta neconfirmata; verifica inainte de reluare.'))
      else if (!confirmat) setMesaj('Scriere neconfirmata; verifica prezentele reincarcate.')
      else setMesaj('Prezența a fost înregistrată.')
    } catch (e) {
      if (curent()) { setDate(null); setMesaj((confirmat ? 'Prezenta salvata, reincarcarea a esuat: ' : 'Rezultat neconfirmat; reincarca inainte de reluare: ') + msgEroare(e)) }
    } finally { if (curent()) { ocupat.current = false; setLucru(false) } }
  }
  const randuri = date ? filtreazaSesiune(date.randuri, { cauta, doarNesemnate }) : []
  const rezumat = date && rezumatSesiune(date.randuri, date.prezenti)
  return <div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,280px),1fr))', gap: 12 }}>
      <label>Zi sesiune<select aria-label="Zi sesiune" style={input} value={zi} disabled={lucru} onChange={e => setZi(e.target.value)}>
        {!zile.length && <option value="">Fără zile de sesiune</option>}
        {zile.map(z => <option key={z.nr} value={z.data}>Ziua {z.nr}: {formatDataRo(z.data)} {z.program}</option>)}
      </select></label>
      <label>Caută nume / parcelă<input style={input} value={cauta} onChange={e => setCauta(e.target.value)} /></label>
    </div>
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 44, fontSize: 16 }}>
      <input type="checkbox" checked={doarNesemnate} onChange={e => setDoarNesemnate(e.target.checked)} />Doar nesemnate
    </label>
    <button style={buton} disabled={lucru} onClick={() => setReload(n => n + 1)}>↻ Reîncarcă</button>
    {mesaj && <p role="status">{mesaj}</p>}
    {lucru && <p>Se încarcă...</p>}
    {rezumat && <p>Total: {rezumat.total} | Semnate: {rezumat.semnate} | Trimise: {rezumat.trimise} | Fără PV: {rezumat.fara_pv} | Prezenți azi ({formatDataRo(azi)}): {rezumat.prezenti_azi}</p>}
    {date && !randuri.length && <p>Niciun rezultat.</p>}
    <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
      {randuri.map(r => <article key={r.detinator_id} style={{ ...S.card, fontSize: 16, overflowWrap: 'anywhere' }}>
        <b>{r.id_parcela} - {r.nume}</b><p><TagStare cod={r.stare} /></p>
        <p>PV: {r.pv_nr || '-'} / {r.pv_stare || 'fără PV'}{date.prezenti.has(r.detinator_id) ? ' | Prezent azi' : ''}</p>
        {poateScrie && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {!date.prezenti.has(r.detinator_id) && <button style={buton} disabled={lucru || !zile.some(z => z.data === zi)} onClick={() => prezent(r)}>Prezent</button>}
          <button style={buton} disabled={lucru} onClick={() => setPv(r)}>PV A</button>
        </div>}
      </article>)}
    </div>
    {pv && poateScrie && <ModalPv parcelaId={pv.parcela_id} detinatorId={pv.detinator_id} proiectId={proiectId} tip="A" dinSesiune
      nivel={nivel} show={show} onClose={() => { setPv(null); setReload(n => n + 1) }} onGata={() => setReload(n => n + 1)} />}
  </div>
}
