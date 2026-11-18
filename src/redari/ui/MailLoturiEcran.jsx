import React, { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase.js'
import { S } from './comune.jsx'
import { citesteMail, rpcMail, hashLot, hashMesaj, inventarMail, MOTIVE_MAIL, transportPermis, DOAR_PROIECTE_TEST, EXPEDITOR,
  CAMPURI_MAIL, CAMP_LINK, campuriNecunoscute, areLinkRaspuns, mascheazaLink, MESAJ_FARA_LINK } from '../mailLoturi.js'

// F2b (18.11.2026): conectarea căsuței redari@ pentru trimitere (OAuth, doar owner), comutatorul de trimitere și „Trimite lotul” — DOAR pe
// proiecte de TEST (codul începe cu „TEST-”, aceeași gardă ca în funcția edge: transportPermis). Pe proiectele reale butoanele rămân
// dezactivate cu motivul. Fără atașament PDF în această felie (limită documentată în plan).
// Câmpurile textului (19.11.2026, migrarea 20261131i): {LINK_RASPUNS} / {COMUNA} / {ZILE} / {PROGRAM} / {TEL} sunt completate de BAZĂ, pe fiecare
// mesaj, la crearea lotului (în snapshot, înaintea hash-ului) — ecranul doar le listează (valorile lotului vin din RPC-ul fn_red_mail_f2_campuri),
// oprește crearea la un câmp scris greșit și avertizează când textul n-are {LINK_RASPUNS}. Previzualizarea arată textul final al FIECĂRUI mesaj din
// snapshot, cu linkul personal MASCAT (tokenul e secretul proprietarului; hash-ul se verifică pe textul întreg, afișarea e mascată).
const COL_SETARI = 'trimitere_oprita, extern_permis, doar_proiecte_test, trimitere_conectata_la, trimitere_casuta, pauza_pana, versiune'
export const MESAJ_FARA_ATASAMENT = 'Fără atașament PDF în această etapă: e-mailul conține doar textul de mai jos. Poșta cu AR rămâne obligatorie.'
export const MESAJ_CAMP_NECUNOSCUT = necunoscute => `Câmp necunoscut în text: ${necunoscute.map(n => `{${n}}`).join(', ')}. Serverul refuză crearea lotului; corectează numele (vezi lista câmpurilor).`
export const MESAJ_LINK_IN_SUBIECT = `{${CAMP_LINK}} nu poate sta în subiect (linkul personal intră doar în corpul mesajului).`
export const MESAJ_CAMP_NECOMPLETABIL = 'nu se poate completa din datele proiectului / UAT-ului'

export default function MailLoturiEcran({ proiect, uats, profile }) {
  const owner = profile?.is_owner === true
  const [uat, setUat] = useState(''), [lotId, setLotId] = useState('')
  const [loturi, setLoturi] = useState([]), [mesaje, setMesaje] = useState([]), [destinatari, setDestinatari] = useState([])
  const [selectie, setSelectie] = useState([]), [subiect, setSubiect] = useState(''), [text, setText] = useState('')
  const [eroare, setEroare] = useState(''), [ocupat, setOcupat] = useState(false), [reload, setReload] = useState(0)
  const [confirm, setConfirm] = useState(false), [integru, setIntegru] = useState(false)
  const [inventar, setInventar] = useState(null), [setari, setSetari] = useState(null), [rezultat, setRezultat] = useState('')
  const [campuri, setCampuri] = useState(null)   // valorile câmpurilor lotului pentru UAT-ul ales (din RPC; null = necitite)
  const generatie = useRef(0), intentie = useRef(null), activ = useRef(true)
  const lot = loturi.find(l => l.id === lotId)
  const garda = transportPermis({ proiectCod: proiect?.cod })
  const conectata = !!setari?.trimitere_conectata_la
  const pornita = setari?.trimitere_oprita === false
  // câmpurile scrise greșit opresc crearea înainte de server (serverul refuză oricum: camp_necunoscut); {LINK_RASPUNS} în subiect = refuz
  const necunoscute = [...new Set([...campuriNecunoscute(subiect), ...campuriNecunoscute(text)])]
  const linkInSubiect = areLinkRaspuns(subiect)
  const motivCampuri = necunoscute.length ? MESAJ_CAMP_NECUNOSCUT(necunoscute) : linkInSubiect ? MESAJ_LINK_IN_SUBIECT : ''
  useEffect(() => { activ.current = true; return () => { activ.current = false; generatie.current++ } }, [])
  useEffect(() => {
    const g = ++generatie.current, id = proiect.id
    const curent = () => activ.current && g === generatie.current && id === proiect.id
    setMesaje([]); setDestinatari([]); setLoturi([]); setIntegru(false); setConfirm(false); setEroare(''); setInventar(null); setSelectie([]); setSetari(null); setCampuri(null)
    if (!owner) return
    ;(async () => {
      try {
        const st = await supabase.from('red_mail_setari').select(COL_SETARI).eq('id', 1).maybeSingle()
        if (!curent()) return
        if (st.error) throw new Error('Setările e-mail nu au putut fi citite.')
        setSetari(st.data)
        const lista = await citesteMail(supabase, 'red_mail_loturi', { proiect_id: id, ...(uat ? { uat_id: uat } : {}) }, curent)
        if (!curent()) return
        setLoturi(lista)
        if (lotId && !lista.some(l => l.id === lotId)) setLotId('')
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
          // valorile câmpurilor lotului (COMUNA / ZILE / PROGRAM / TEL), definite o singură dată în bază — aceeași funcție o folosește și crearea
          const c = await rpcMail(supabase, 'fn_red_mail_f2_campuri', { p_proiect: id, p_uat: uat })
          if (!c || typeof c !== 'object' || Array.isArray(c)) throw new Error('Câmpurile textului nu au putut fi citite.')
          if (curent()) setCampuri(c)
        }
      } catch (e) { if (curent()) setEroare(e.message) }
    })()
    return () => { generatie.current++ }
  }, [owner, proiect.id, uat, lotId, reload])
  const actiune = async fn => {
    const g = generatie.current
    setOcupat(true); setEroare(''); setRezultat('')
    try { await fn(() => activ.current && g === generatie.current) }
    catch (e) { if (activ.current && g === generatie.current) setEroare(e.message) }
    finally { if (activ.current && g === generatie.current) { setOcupat(false); setReload(n => n + 1) } }
  }
  const edge = async (fn, corp) => {
    const { data, error } = await supabase.functions.invoke(fn, { body: corp })
    if (error) {
      // corpul răspunsului de refuz (409 / 423 / 503) vine în context; codul e din listă închisă, fără conținut
      let cod = null
      try { cod = (await error.context?.json())?.cod ?? null } catch { /* fără corp */ }
      throw new Error(cod ? `Refuzat: ${cod}. Recitește stările; nu crea un lot duplicat.` : 'Operația nu a fost confirmată. Recitește stările; nu crea un lot duplicat.')
    }
    return data
  }
  if (!owner) return null
  const motivTrimite = !garda.ok ? garda.motiv : !conectata ? 'căsuța nu e conectată pentru trimitere' : !pornita ? 'trimiterea e oprită (comutatorul de mai sus)'
    : !lot || !['aprobat', 'in_trimitere'].includes(lot.stare) ? 'lotul trebuie să fie aprobat' : ''
  return <div style={S.card}>
    <h3>Loturi e-mail către proprietari</h3>
    <p>{garda.ok
      ? <b>Proiect de TEST: trimiterea reală din {EXPEDITOR} e permisă pe acest proiect{DOAR_PROIECTE_TEST ? ' (doar proiecte de TEST în această etapă)' : ''}.</b>
      : <>Trimiterea reală este oprită pe acest proiect: {garda.motiv}.</>} E-mailul este suplimentar; poșta cu AR rămâne obligatorie.</p>
    <div style={S.card} aria-label="Căsuța de trimitere">
      <b>Căsuța {EXPEDITOR} pentru trimitere: {setari === null ? 'se citește…' : conectata ? `conectată (${setari.trimitere_casuta || EXPEDITOR}, ${new Date(setari.trimitere_conectata_la).toLocaleString('ro-RO')})` : 'neconectată'}</b>
      {setari && <p>Trimiterea: {pornita ? 'PORNITĂ' : 'oprită'}{setari.pauza_pana && Date.parse(setari.pauza_pana) > Date.now() ? ` · pauză până la ${new Date(setari.pauza_pana).toLocaleTimeString('ro-RO')}` : ''} · destinatari externi: {setari.extern_permis ? 'permiși' : 'doar @gazpet.ro'}.</p>}
      {!conectata && <button style={S.btnP} disabled={ocupat || !setari} onClick={() => actiune(async () => {
        const d = await edge('redari-mail-oauth', { actiune: 'start', scop: 'trimitere' })
        if (typeof d?.url !== 'string' || !d.url.startsWith('https://accounts.google.com/')) throw new Error('Adresa de autorizare nu a fost confirmată.')
        window.location.href = d.url
      })}>Conectează căsuța pentru trimitere (Google)</button>}
      {conectata && <button style={S.btnS} disabled={ocupat} onClick={() => actiune(async () => {
        if (!window.confirm('Revoci conectarea căsuței pentru trimitere? Trimiterea se oprește.')) return
        await edge('redari-mail-oauth', { actiune: 'revoca' })
      })}>Revocă conectarea</button>}
      {setari && <button style={S.btnS} disabled={ocupat || (!pornita && !conectata)} onClick={() => actiune(async () => {
        if (!pornita && !window.confirm('Pornești trimiterea e-mailurilor (doar proiecte de TEST, doar @gazpet.ro)?')) return
        await rpcMail(supabase, 'fn_red_mail_f2_setari', { p_oprit: pornita, p_extern: false, p_versiune: setari.versiune })
      })}>{pornita ? 'Oprește trimiterea' : 'Pornește trimiterea'}</button>}
    </div>
    <select aria-label="UAT e-mail" style={S.select} value={uat} disabled={ocupat} onChange={e => { generatie.current++; setUat(e.target.value); setLotId(''); setSelectie([]); intentie.current = null }}>
      <option value="">Alege UAT</option>{uats.map(u => <option key={u.id} value={u.id}>{u.nume}</option>)}
    </select>
    <select aria-label="Lot e-mail" style={S.select} disabled={ocupat} value={lotId} onChange={e => setLotId(e.target.value)}>
      <option value="">Lot nou</option>{loturi.map(l => <option key={l.id} value={l.id}>{l.id} · {l.stare}</option>)}
    </select>
    <button style={S.btnS} disabled={ocupat} onClick={() => setReload(n => n + 1)}>Recitește</button>
    {eroare && <p role="alert">{eroare}</p>}
    {rezultat && <p role="status">{rezultat}</p>}
    {!lotId && uat && <>
      <p>{selectie.length} destinatari selectați / maximum 300.</p>
      {inventar && <div aria-label="Inventar eligibilitate">
        <p>Total: {inventar.total} · Eligibili: {inventar.eligibili} · Excluși: {inventar.exclusi}</p>
        {Object.entries(MOTIVE_MAIL).map(([cod, eticheta]) => <p key={cod}>{eticheta}: {inventar.motive[cod]}</p>)}
        <p>Motivele se pot suprapune. Poșta cu AR rămâne obligatorie și nu exclude e-mailul suplimentar.</p>
      </div>}
      <p>{MESAJ_FARA_ATASAMENT}</p>
      <input aria-label="Subiect e-mail" style={S.input} value={subiect} maxLength={400} onChange={e => { setSubiect(e.target.value); intentie.current = null }} placeholder="Subiectul validat de Juridic" disabled={ocupat} />
      <textarea aria-label="Text e-mail" style={{ ...S.input, width: '100%', minHeight: 150 }} value={text} maxLength={19000} onChange={e => { setText(e.target.value); intentie.current = null }} placeholder="Textul exact al convocării" disabled={ocupat} />
      <div aria-label="Câmpurile textului" style={S.card}>
        <b>Câmpuri completate automat de server pe fiecare mesaj</b> (se scriu exact așa, cu acolade; un nume greșit = lotul nu se creează):
        <ul>{CAMPURI_MAIL.map(c => <li key={c.nume}><code>{`{${c.nume}}`}</code> — {c.descriere}
          {!c.perMesaj && <> → <i>{campuri === null ? 'se citește…' : campuri[c.nume] ? campuri[c.nume] : MESAJ_CAMP_NECOMPLETABIL}</i></>}
          {c.perMesaj && <> → <i>diferit pe fiecare destinatar; în previzualizare apare mascat</i></>}</li>)}</ul>
        <p>Destinatarii fără link personal valid (token lipsă sau expirat) sunt excluși din lot: {MOTIVE_MAIL.fara_token}.</p>
      </div>
      {text.trim() && !areLinkRaspuns(text) && <p role="alert">{MESAJ_FARA_LINK}</p>}
      {motivCampuri && <p role="alert">{motivCampuri}</p>}
      {destinatari.map(d => <label key={d.id} style={{ display: 'block' }}>
        <input type="checkbox" disabled={ocupat || (!selectie.includes(d.id) && selectie.length >= 300)} checked={selectie.includes(d.id)} onChange={e => { intentie.current = null; setSelectie(xs => e.target.checked ? [...xs, d.id] : xs.filter(x => x !== d.id)) }} />{d.nume} · {d.email}
      </label>)}
      <button style={S.btnP} disabled={ocupat || !selectie.length || !text.trim() || !subiect.trim() || !!motivCampuri} title={motivCampuri} onClick={() => actiune(async curent => {
        if (!intentie.current) intentie.current = { id: crypto.randomUUID(), proiect: proiect.id, uat, destinatari: [...selectie], subiect, text }
        const i = intentie.current
        const id = await rpcMail(supabase, 'fn_red_mail_lot_creeaza', { p_operatie: i.id, p_proiect: i.proiect, p_uat: i.uat, p_destinatari: i.destinatari, p_subiect: i.subiect, p_text: i.text })
        if (curent()) { setLotId(id); intentie.current = null }
      })}>Creează ciorna pentru previzualizare</button>
    </>}
    {lot && <>
      <p>UAT lot: {uats.find(u => u.id === lot.uat_id)?.nume || lot.uat_id}</p>
      <p>Stare lot: {lot.stare} · {mesaje.length} destinatari · {mesaje.filter(m => m.stare === 'in_apel').length} trimiteri deja autorizate în curs · {mesaje.filter(m => m.stare === 'necunoscut').length} cu rezultat necunoscut (de reconciliat, nu se retrimit).</p>
      <p>Textul fiecărui mesaj e cel din snapshot (completat pe destinatar); linkul personal de răspuns apare mascat (ultimele 6 caractere), hash-ul se verifică pe textul întreg.</p>
      {mesaje.map(m => <div style={S.card} key={m.id}><b>{m.nr_document} · {m.catre || 'conținut golit'}</b> · {m.stare}{m.eroare_cod ? ` (${m.eroare_cod})` : ''}<p>{mascheazaLink(m.subiect_final)}</p><pre style={{ whiteSpace: 'pre-wrap' }}>{mascheazaLink(m.corp_text_final)}</pre>{m.atasament_path && <p>Atașament: {m.atasament_nume}</p>}</div>)}
      {lot.stare === 'ciorna' && <>
        <label><input type="checkbox" checked={confirm} disabled={ocupat} onChange={e => setConfirm(e.target.checked)} />Aprob explicit acest lot, destinatarii și textele afișate.</label>
        <button style={S.btnP} disabled={ocupat || !confirm || !integru} onClick={() => actiune(async () => {
          await rpcMail(supabase, 'fn_red_mail_lot_aproba', { p_lot: lot.id, p_versiune: lot.versiune, p_lot_sha256: lot.lot_sha256 })
        })}>Aprobă acest lot</button>
      </>}
      <button style={S.btnP} disabled={ocupat || !!motivTrimite} title={motivTrimite} onClick={() => actiune(async curent => {
        if (!window.confirm(`Trimiți acum e-mailurile din coada acestui lot, din ${EXPEDITOR}? Fiecare apăsare trimite cel mult 20 de mesaje.`)) return
        const d = await edge('redari-mail-trimite', { lot_id: lot.id })
        // o persistare neconfirmată (RPC-ul n-a întors true) NU e trimitere: se arată separat, cu starea recitită din server
        const neconf = d?.neconfirmate ? `, neconfirmate ${d.neconfirmate} (starea în server: ${d?.stare_server ?? 'necitită'})` : ''
        if (curent()) setRezultat(`Rulat: trimise ${d?.trimise ?? 0}, eșuate sigur ${d?.esuate ?? 0}, necunoscute ${d?.necunoscute ?? 0}${neconf}, rezervate ${d?.rezervate ?? 0}${d?.cod && d.cod !== 'rulat' ? ` · oprit: ${d.cod}` : ''}. Recitește lotul; un rezultat necunoscut sau neconfirmat NU se retrimite.`)
      })}>{motivTrimite ? `Trimite lotul — ${motivTrimite}` : 'Trimite lotul (până la 20 de mesaje)'}</button>
      {lot.stare !== 'incheiat' && <button style={S.btnS} disabled={ocupat} onClick={() => actiune(async () => {
        await rpcMail(supabase, 'fn_red_mail_lot_inchide', { p_lot: lot.id, p_versiune: lot.versiune })
      })}>Încheie lotul și anulează mesajele neîncepute</button>}
    </>}
  </div>
}
