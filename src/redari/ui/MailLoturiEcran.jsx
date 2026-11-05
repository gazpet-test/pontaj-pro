import React, { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase.js'
import { S } from './comune.jsx'
import { citesteMail, rpcMail, hashLot, hashMesaj, TRANSPORT_REAL_ACTIV, inventarMail, MOTIVE_MAIL } from '../mailLoturi.js'

export default function MailLoturiEcran({ proiect, uats, profile }) {
  const owner = profile?.is_owner === true
  const [uat, setUat] = useState(''), [lotId, setLotId] = useState('')
  const [loturi, setLoturi] = useState([]), [mesaje, setMesaje] = useState([]), [destinatari, setDestinatari] = useState([])
  const [selectie, setSelectie] = useState([]), [subiect, setSubiect] = useState(''), [text, setText] = useState('')
  const [eroare, setEroare] = useState(''), [ocupat, setOcupat] = useState(false), [reload, setReload] = useState(0)
  const [confirm, setConfirm] = useState(false), [integru, setIntegru] = useState(false)
  const [inventar, setInventar] = useState(null)
  const generatie = useRef(0), intentie = useRef(null), activ = useRef(true)
  const lot = loturi.find(l => l.id === lotId)
  useEffect(() => { activ.current = true; return () => { activ.current = false; generatie.current++ } }, [])
  useEffect(() => {
    const g = ++generatie.current, id = proiect.id
    const curent = () => activ.current && g === generatie.current && id === proiect.id
    setMesaje([]); setDestinatari([]); setLoturi([]); setIntegru(false); setConfirm(false); setEroare(''); setInventar(null); setSelectie([])
    if (!owner) return
    ;(async () => {
      try {
        const lista = await citesteMail(supabase, 'red_mail_loturi', { proiect_id: id, ...(uat ? { uat_id: uat } : {}) }, curent)
        if (!curent()) return
        setLoturi(lista)
        if (lotId && lista.some(l => l.id === lotId)) {
          const ms = await citesteMail(supabase, 'red_mail_mesaje', { lot_id: lotId }, curent)
          const h = await hashLot(ms)
          const corecte = await Promise.all(ms.map(async m => m.retentie_stare !== 'golit' && await hashMesaj(m) === m.mesaj_sha256))
          if (!curent()) return
          setMesaje(ms); setIntegru(ms.length > 0 && corecte.every(Boolean) && h === lista.find(l => l.id === lotId).lot_sha256)
        }
        if (uat) {
          let dupa = null, tot = []
          for (;;) {
            if (!curent()) return
            const pagina = await rpcMail(supabase, 'fn_red_mail_destinatari', { p_proiect: id, p_uat: uat, p_dupa: dupa })
            if (!Array.isArray(pagina)) throw new Error('Lista destinatarilor este invalidă.')
            if (!pagina.length) break
            if (pagina.some((r, i) => !r.id || (i ? r.id <= pagina[i - 1].id : dupa && r.id <= dupa))) throw new Error('Paginarea nu avansează.')
            tot.push(...pagina); dupa = pagina[pagina.length - 1].id
          }
          const rezumat = inventarMail(tot)
          if (curent()) { setInventar(rezumat); setDestinatari(tot.filter(d => d.motive.length === 0)) }
        }
      } catch (e) { if (curent()) setEroare(e.message) }
    })()
    return () => { generatie.current++ }
  }, [owner, proiect.id, uat, lotId, reload])
  const actiune = async fn => {
    const g = generatie.current
    setOcupat(true); setEroare('')
    try { await fn(() => activ.current && g === generatie.current) }
    catch (e) { if (activ.current && g === generatie.current) setEroare(e.message) }
    finally { if (activ.current && g === generatie.current) { setOcupat(false); setReload(n => n + 1) } }
  }
  if (!owner) return null
  return <div style={S.card}>
    <h3>Loturi e-mail către proprietari</h3>
    <p>Trimiterea reală este oprită în această livrare. E-mailul este suplimentar; poșta cu AR rămâne obligatorie.</p>
    <select aria-label="UAT e-mail" style={S.select} value={uat} disabled={ocupat} onChange={e => { generatie.current++; setUat(e.target.value); setLotId(''); setSelectie([]); intentie.current = null }}>
      <option value="">Alege UAT</option>{uats.map(u => <option key={u.id} value={u.id}>{u.nume}</option>)}
    </select>
    <select aria-label="Lot e-mail" style={S.select} disabled={ocupat} value={lotId} onChange={e => setLotId(e.target.value)}>
      <option value="">Lot nou</option>{loturi.map(l => <option key={l.id} value={l.id}>{l.id} · {l.stare}</option>)}
    </select>
    <button style={S.btnS} disabled={ocupat} onClick={() => setReload(n => n + 1)}>Recitește</button>
    {eroare && <p role="alert">{eroare}</p>}
    {!lotId && uat && <>
      <p>{selectie.length} destinatari selectați / maximum 300.</p>
      {inventar && <div aria-label="Inventar eligibilitate">
        <p>Total: {inventar.total} · Eligibili: {inventar.eligibili} · Excluși: {inventar.exclusi}</p>
        {Object.entries(MOTIVE_MAIL).map(([cod, eticheta]) => <p key={cod}>{eticheta}: {inventar.motive[cod]}</p>)}
        <p>Motivele se pot suprapune. Poșta cu AR rămâne obligatorie și nu exclude e-mailul suplimentar.</p>
      </div>}
      <input aria-label="Subiect e-mail" style={S.input} value={subiect} maxLength={400} onChange={e => { setSubiect(e.target.value); intentie.current = null }} placeholder="Subiectul validat de Juridic" disabled={ocupat} />
      <textarea aria-label="Text e-mail" style={{ ...S.input, width: '100%', minHeight: 150 }} value={text} maxLength={19000} onChange={e => { setText(e.target.value); intentie.current = null }} placeholder="Textul exact al convocării" disabled={ocupat} />
      {destinatari.map(d => <label key={d.id} style={{ display: 'block' }}>
        <input type="checkbox" disabled={ocupat || (!selectie.includes(d.id) && selectie.length >= 300)} checked={selectie.includes(d.id)} onChange={e => { intentie.current = null; setSelectie(xs => e.target.checked ? [...xs, d.id] : xs.filter(x => x !== d.id)) }} />{d.nume} · {d.email}
      </label>)}
      <button style={S.btnP} disabled={ocupat || !selectie.length || !text.trim() || !subiect.trim()} onClick={() => actiune(async curent => {
        if (!intentie.current) intentie.current = { id: crypto.randomUUID(), proiect: proiect.id, uat, destinatari: [...selectie], subiect, text }
        const i = intentie.current
        const id = await rpcMail(supabase, 'fn_red_mail_lot_creeaza', { p_operatie: i.id, p_proiect: i.proiect, p_uat: i.uat, p_destinatari: i.destinatari, p_subiect: i.subiect, p_text: i.text })
        if (curent()) { setLotId(id); intentie.current = null }
      })}>Creează ciorna pentru previzualizare</button>
    </>}
    {lot && <>
      <p>Stare lot: {lot.stare} · {mesaje.length} destinatari · {mesaje.filter(m => m.stare === 'in_apel').length} trimiteri deja autorizate în curs.</p>
      {mesaje.map(m => <div style={S.card} key={m.id}><b>{m.nr_document} · {m.catre || 'conținut golit'}</b> · {m.stare}<p>{m.subiect_final}</p><pre style={{ whiteSpace: 'pre-wrap' }}>{m.corp_text_final}</pre>{m.atasament_path && <p>Atașament: {m.atasament_nume}</p>}</div>)}
      {lot.stare === 'ciorna' && <>
        <label><input type="checkbox" checked={confirm} disabled={ocupat} onChange={e => setConfirm(e.target.checked)} />Aprob explicit acest lot, destinatarii și textele afișate.</label>
        <button style={S.btnP} disabled={ocupat || !confirm || !integru} onClick={() => actiune(async () => {
          await rpcMail(supabase, 'fn_red_mail_lot_aproba', { p_lot: lot.id, p_versiune: lot.versiune, p_lot_sha256: lot.lot_sha256 })
        })}>Aprobă acest lot</button>
      </>}
      <button style={S.btnP} disabled={!TRANSPORT_REAL_ACTIV || ocupat || !['aprobat', 'in_trimitere'].includes(lot.stare)} onClick={() => actiune(async () => {
        const { error } = await supabase.functions.invoke('redari-mail-trimite', { body: { lot_id: lot.id } })
        if (error) throw new Error('Trimiterea nu a fost confirmată. Recitește stările; nu crea un lot duplicat.')
      })}>Trimite lotul — oprit</button>
      {lot.stare !== 'incheiat' && <button style={S.btnS} disabled={ocupat} onClick={() => actiune(async () => {
        await rpcMail(supabase, 'fn_red_mail_lot_inchide', { p_lot: lot.id, p_versiune: lot.versiune })
      })}>Încheie lotul și anulează mesajele neîncepute</button>}
    </>}
  </div>
}
