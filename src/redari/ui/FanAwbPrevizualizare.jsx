/* FanAwbPrevizualizare.jsx — FAN Courier pe un lot de plicuire: previzualizarea (ce s-ar trimite pentru fiecare plic și ce lipsește) +
   pașii propune → aprobă → generează → etichete A6 → comandă curier → urmărire → confirmări / retururi.
   Cât timp TRANSPORT_REAL_ACTIV = false (redariFanHandler.mjs) TOȚI pașii sunt dezactivați vizibil, cu „transport oprit”; nu se cheamă
   funcția edge și nu se scrie nimic. Proiectare: docs/redari/FANCOURIER_INTEGRARE.md. Contactul (PII) se citește cu JWT-ul omului
   (RLS: doar admin/editor). Răspunsurile FAN sunt date: ridicarea și returul le confirmă omul aici / în tabelul Plicuri. */
import React, { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase.js'
import { pregatestePlicuriFan, contactPePlic, LIMITA_LOT_PILOT_IMPLICITA, FORMAT_ETICHETA } from '../../../supabase/functions/_shared/redariFan.mjs'
import { stariPasi, stareMarcaj, TRANSPORT_REAL_ACTIV, MESAJ_TRANSPORT_OPRIT, ETICHETE_STARE_FAN, ETICHETE_URMARIRE, ETICHETE_CONFIRMARE, prefixLot, titluLot, csvBorderouFan, mesajEdgeFan } from '../fanLot.js'
import { descarcaBlob } from '../docx.js'
import { G, S, Modal, msgEroare, citestePaginat, etichetaRetur } from './comune.jsx'

export { contactPePlic }   // compatibil cu testele vechi (definiția e în redariFan.mjs, comună cu funcția edge)
const LOT_IN = 100
const COL_FAN = 'id,plic_id,nr_plic,stare,hash_date,awb,tarif,motiv,urmarire_stare,ultim_eveniment,ultim_eveniment_la,ridicat_propus,livrat_la,retur_propus,confirmare_stare'
// tabelul FAN lipsește (migrarea neaplicată) ≠ eroare de citire (L18)
const lipsaTabel = e => ['PGRST205', '42P01'].includes(e?.code) || /does not exist|could not find the table/i.test(e?.message || '')

export default function FanAwbPrevizualizare({ proiect, lot, plicuri, esteOwner = false, poateScrie = false, onClose, onRetur }) {
  const [randuri, setRanduri] = useState(null), [fan, setFan] = useState(null), [eroare, setEroare] = useState(''), [mesaj, setMesaj] = useState('')
  const [lucru, setLucru] = useState(false), [reload, setReload] = useState(0)
  const gen = useRef(0), ocupat = useRef(false)
  const cheie = plicuri.map(p => p.id).join(',')   // lista nouă la fiecare randare a părintelui → efectul depinde de id-uri, nu de referință
  useEffect(() => {
    const token = ++gen.current, curent = () => gen.current === token
    setRanduri(null); setEroare('')
    ;(async () => {
      const ids = plicuri.map(p => p.id)
      const conv = []
      for (let i = 0; i < ids.length; i += LOT_IN) conv.push(...await citestePaginat(() => supabase.from('red_convocari').select('id,plic_id,detinator_id')
        .in('plic_id', ids.slice(i, i + LOT_IN)).eq('stare', 'activ').is('sters_la', null), { cheie: 'id', esteCurent: curent }))
      const det = [...new Set(conv.map(c => c.detinator_id))]
      const cont = []
      for (let i = 0; i < det.length; i += LOT_IN) cont.push(...await citestePaginat(() => supabase.from('red_detinatori_contact')
        .select('detinator_id,telefon,adresa_strada,adresa_sat,adresa_comuna,adresa_judet,cod_postal').in('detinator_id', det.slice(i, i + LOT_IN)), { cheie: 'detinator_id', esteCurent: curent }))
      const pregatite = await pregatestePlicuriFan({ plicuri, convocari: conv, contacte: cont, proiectCod: proiect.cod })
      // evidența FAN (după migrare): rândurile lotului, marcajul de test, plafonul pilot
      let stare = { instalata: false }
      try {
        const awb = await citestePaginat(() => supabase.from('red_fan_awb').select(COL_FAN).eq('lot_id', lot.id), { cheie: 'id', esteCurent: curent })
        const { data: fl, error: e1 } = await supabase.from('red_fan_loturi').select('lot_id,test').eq('lot_id', lot.id).maybeSingle()
        if (e1) throw e1
        const { data: st, error: e2 } = await supabase.from('red_fan_setari').select('limita_lot').maybeSingle()
        if (e2) throw e2
        stare = { instalata: true, awb, fanLot: fl || null, limita: st?.limita_lot ?? null }
      } catch (e) { if (!lipsaTabel(e)) throw e }
      if (!curent()) return
      setRanduri(pregatite); setFan(stare)
    })().catch(e => { if (curent()) setEroare(msgEroare(e)) })
    return () => { gen.current++ }
  }, [proiect.cod, lot.id, cheie, reload])   // eslint-disable-line react-hooks/exhaustive-deps

  const awb = fan?.awb || []
  const pePlic = new Map(awb.filter(r => !['eroare', 'anulat'].includes(r.stare)).map(r => [r.plic_id, r]))
  const gata = randuri?.filter(r => r.ok).length ?? 0
  const pasi = stariPasi({ transportActiv: TRANSPORT_REAL_ACTIV, evidentaInstalata: !!fan?.instalata, esteOwner, poateScrie, fanLot: fan?.fanLot, randuri: awb, gataDePropus: gata })
  const marcaj = stareMarcaj({ transportActiv: TRANSPORT_REAL_ACTIV, evidentaInstalata: !!fan?.instalata, esteOwner, randuri: awb })
  const pas = k => (k === 'marcaj' ? { ...marcaj, cheie: 'marcaj', titlu: 'Marcaj', ajutor: 'doar owner-ul, înainte de aprobare: lot de TEST sau lot real' } : pasi.find(p => p.cheie === k))

  async function executa(cheiePas, fn) {
    if (ocupat.current || !pas(cheiePas)?.activ) return   // dublă gardă: butonul e dezactivat, iar funcția refuză oricum
    ocupat.current = true; setLucru(true); setMesaj('')
    const token = gen.current
    try { const m = await fn(); if (token === gen.current) setMesaj(m || 'Operație încheiată.') }
    catch (e) { setMesaj(`Eroare: ${msgEroare(e)}. Reîncarcă evidența înainte de reluare.`) }
    finally { ocupat.current = false; setLucru(false); setReload(n => n + 1) }
  }
  async function edge(actiune, extra = {}) {
    const rez = await supabase.functions.invoke('redari-fan-awb', { body: { actiune, lot_id: lot.id, ...extra } })
    let corp = rez.data
    if (rez.error && typeof rez.error.context?.json === 'function') { try { corp = await rez.error.context.json() } catch { corp = null } }
    return { corp, mesaj: mesajEdgeFan({ data: corp, error: corp ? null : rez.error }) }
  }
  const propune = () => executa('propune', async () => {
    let n = 0; const erori = []
    for (const r of randuri.filter(x => x.ok)) {
      const { error } = await supabase.rpc('fn_red_fan_propune', { p_plic_id: r.plic.id, p_hash: r.hash, p_tarif_estimat: null })
      if (error) erori.push(`${r.plic.nr_plic}: ${msgEroare(error)}`); else n++
    }
    return `Propuse: ${n}; erori: ${erori.length}. ${erori.join('; ')}`
  })
  const marcheaza = test => executa('marcaj', async () => {
    if (!window.confirm(test ? `Marchezi ${lot.nr_lot} ca LOT DE TEST? AWB-urile lui nu vor fi expedieri ale convocărilor.` : `Marchezi ${lot.nr_lot} ca lot REAL (convocări cu efect juridic)?`)) return 'Nimic schimbat.'
    const { error } = await supabase.rpc('fn_red_fan_lot_marcheaza', { p_lot_id: lot.id, p_test: test }); if (error) throw error
    return test ? 'Lot marcat: TEST.' : 'Lot marcat: real.'
  })
  const aproba = () => executa('aproba', async () => {
    const curent = new Map(randuri.filter(r => r.ok).map(r => [r.plic.id, r.hash]))
    const propuse = awb.filter(r => r.stare === 'propus' && curent.get(r.plic_id) === r.hash_date)
    if (!propuse.length) return 'Niciun plic propus cu datele de acum: propune din nou.'
    if (!window.confirm(`Aprobi ${propuse.length} AWB-uri FAN pentru ${titluLot(lot, fan.fanLot)}? Fiecare AWB generat costă (tariful vine de la FAN).`)) return 'Nimic aprobat.'
    const { data, error } = await supabase.rpc('fn_red_fan_aproba', { p_lot_id: lot.id, p_ids: propuse.map(r => r.id), p_hashuri: propuse.map(r => r.hash_date) })
    if (error) throw error
    return `Aprobate: ${data}.`
  })
  const genereaza = () => executa('genereaza', async () => {
    if (!window.confirm(`Generezi AWB-urile aprobate pentru ${titluLot(lot, fan.fanLot)}? Se plătesc.`)) return 'Nimic trimis.'
    const { corp, mesaj } = await edge('genereaza')
    return corp?.cod === 'ok' ? `Generate: ${corp.generat}; respinse: ${corp.eroare}; necunoscute: ${corp.necunoscut}; rămase: ${corp.ramase}.${corp.oprit ? ' Oprit: ' + corp.oprit : ''}` : mesaj
  })
  const etichete = (parte = 1) => executa('etichete', async () => {
    const { corp, mesaj } = await edge('eticheta', { parte })
    if (corp?.cod !== 'ok' || typeof corp.pdf_base64 !== 'string') return mesaj
    const bin = atob(corp.pdf_base64), bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    descarcaBlob(new Blob([bytes], { type: 'application/pdf' }), `${prefixLot(fan.fanLot)}${lot.nr_lot}_etichete_${FORMAT_ETICHETA}${corp.parti > 1 ? `_partea${corp.parte}din${corp.parti}` : ''}.pdf`)
    return `Etichete ${FORMAT_ETICHETA}: ${corp.nr_plicuri.length} plicuri (${corp.nr_plicuri[0]} … ${corp.nr_plicuri.at(-1)})${corp.parti > 1 ? `, partea ${corp.parte} din ${corp.parti}` : ''}.`
  })
  const urmarire = () => executa('urmarire', async () => { const { corp, mesaj } = await edge('urmarire'); return corp?.cod === 'ok' ? `Urmărire actualizată: ${corp.scrise} AWB-uri.` : mesaj })
  const confirmari = () => executa('confirmari', async () => { const { corp, mesaj } = await edge('confirmari'); return corp?.cod === 'ok' ? `Confirmări verificate: ${corp.scrise} AWB-uri.` : mesaj })
  const deConfirmatRidicare = awb.filter(r => r.stare === 'generat' && r.ridicat_propus)
  const confirmaRidicarea = () => executa('urmarire', async () => {
    const efect = fan.fanLot?.test ? 'Lot de TEST: se marchează doar în evidența FAN.' : 'Lot real: plicurile primesc AWB-ul și data expedierii (pornește termenul de 10 zile).'
    if (!window.confirm(`Confirmi ridicarea de către curier pentru ${deConfirmatRidicare.length} plicuri, la datele evenimentului C0? ${efect}`)) return 'Nimic confirmat.'
    let n = 0; const erori = []
    for (const r of deConfirmatRidicare) {
      const { error } = await supabase.rpc('fn_red_fan_ridicat', { p_id: r.id, p_data: r.ridicat_propus })
      if (error) erori.push(`${r.nr_plic}: ${msgEroare(error)}`); else n++
    }
    return `Ridicări confirmate: ${n}; erori: ${erori.length}. ${erori.join('; ')}`
  })
  const borderou = () => descarcaBlob(new Blob([csvBorderouFan({ lot, fanLot: fan?.fanLot, randuri: awb })], { type: 'text/csv;charset=utf-8' }), `${prefixLot(fan?.fanLot)}${lot.nr_lot}_borderou_FAN.csv`)

  const Pas = ({ cheie: k, onClick, children }) => { const p = pas(k)
    return <button style={{ ...S.btnX, opacity: p.activ ? 1 : 0.5 }} disabled={!p.activ || lucru} title={p.activ ? p.ajutor : `${p.ajutor} — ${p.motiv}`} onClick={onClick}>{children || p.titlu}</button> }
  const retururi = awb.filter(r => r.urmarire_stare === 'retur')
  return <Modal titlu={`AWB FAN — ${titluLot(lot, fan?.fanLot)}`} onClose={onClose} latime={860}>
    {fan?.fanLot?.test === true && <p role="note" style={{ margin: '0 0 8px', padding: 8, borderRadius: 6, background: G.blueDim, color: G.blue, fontWeight: 700 }}>
      LOT DE TEST: AWB-urile lui nu sunt expedieri ale convocărilor și nu intră în registru, PV sau export. Fișierele lui încep cu „TEST_”.</p>}
    {!TRANSPORT_REAL_ACTIV && <p role="status" style={{ margin: '0 0 8px', padding: 8, borderRadius: 6, background: G.yellowDim, color: G.yellow }}>
      Transport oprit: pașii FAN sunt dezactivați până la activare (acordul proprietarului, migrarea, secretele FAN și publicarea funcției). Nu se trimite și nu se plătește nimic.</p>}
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
      {pasi.map(p => <div key={p.cheie} style={{ ...S.card, padding: 8, minWidth: 150, opacity: p.activ ? 1 : 0.6 }}>
        <b style={{ fontSize: 12.5 }}>{p.titlu}</b><div style={{ fontSize: 11.5, color: G.muted }}>{p.ajutor}</div>
        {!p.activ && <div style={{ fontSize: 11.5, color: G.yellow }}>{p.motiv === MESAJ_TRANSPORT_OPRIT ? 'transport oprit' : p.motiv}</div>}
      </div>)}
    </div>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
      <Pas cheie="propune" onClick={propune}>1. Propune {gata} plicuri</Pas>
      <Pas cheie="marcaj" onClick={() => marcheaza(true)}>2a. Marchează TEST</Pas>
      <Pas cheie="marcaj" onClick={() => marcheaza(false)}>2b. Marchează real</Pas>
      <Pas cheie="aproba" onClick={aproba}>2c. Aprobă</Pas>
      <Pas cheie="genereaza" onClick={genereaza} />
      <Pas cheie="etichete" onClick={() => etichete(1)}>4. Etichete {FORMAT_ETICHETA} (PDF)</Pas>
      <Pas cheie="urmarire" onClick={urmarire} />
      <Pas cheie="urmarire" onClick={confirmaRidicarea}>6b. Confirmă ridicarea ({deConfirmatRidicare.length})</Pas>
      <Pas cheie="confirmari" onClick={confirmari} />
      {fan?.instalata && awb.length > 0 && <button style={S.btnX} disabled={lucru} onClick={borderou}>Borderou FAN (CSV, fără date personale)</button>}
    </div>
    <p style={{ fontSize: 12, color: G.muted, margin: '0 0 8px' }}>
      Plafonul lotului pilot: {fan?.limita ?? LIMITA_LOT_PILOT_IMPLICITA} plicuri aprobate pe lot{fan?.instalata ? '' : ' (implicit; evidența FAN nu e instalată încă)'}.
      Comanda curierului (pasul 5) se face în selfAWB: o comandă pe zi pentru punctul de lucru, interval de cel puțin 2 ore.
      Înainte de predare, verifică pe fiecare plic cele trei numere: eticheta FAN, prima pagină (opisul) și opisul cu convocările din plic.</p>
    {eroare && <p role="alert" style={{ color: G.red }}>Nu am putut citi datele: {eroare}</p>}
    {mesaj && <p role="status" style={{ color: G.yellow, whiteSpace: 'pre-wrap' }}>{mesaj}</p>}
    {!randuri && !eroare && <p>Se citesc plicurile…</p>}
    {retururi.length > 0 && <div style={{ ...S.card, borderColor: G.orange, marginBottom: 8 }}>
      <b style={{ color: G.orange }}>Retururi semnalate de FAN ({retururi.length})</b> — se înregistrează de om, cu scanul plicului returnat, din tabelul Plicuri („Retur…”); apar apoi în PV B la „Demersurile de convocare”.
      {retururi.map(r => { const p = plicuri.find(x => x.id === r.plic_id)
        return <div key={r.id}>{r.nr_plic} · AWB {r.awb} · {r.ultim_eveniment || '-'} · propus: {r.retur_propus ? etichetaRetur(r.retur_propus) : 'motiv de ales'}
          {fan?.fanLot?.test ? ' · lot de test: nu se înregistrează pe plic' : p?.data_expediere && !p?.retur && onRetur
            ? <> <button style={S.btnX} disabled={lucru} onClick={() => onRetur(p.id, r.retur_propus, (r.ultim_eveniment_la || '').slice(0, 10))}>Înregistrează returul…</button></> : ''}</div> })}
    </div>}
    {randuri && <>
      <p>{gata} din {randuri.length} plicuri au toate datele cerute de FAN.</p>
      <div style={{ display: 'grid', gap: 8 }}>
        {randuri.map(r => { const f = pePlic.get(r.plic.id)
          return <div key={r.plic.id} style={{ ...S.card, borderColor: r.ok ? G.green : G.yellow }}>
            <b>{r.plic.nr_plic}</b> · {r.shipment.recipient.name || '(fără nume)'} · {[r.shipment.recipient.address.street, r.shipment.recipient.address.locality, r.shipment.recipient.address.county].filter(Boolean).join(', ') || '(fără adresă)'}
            {r.ok ? <div style={{ color: G.green }}>✓ gata pentru FAN · referința pe etichetă: {r.shipment.info.observation}</div> : <ul style={{ margin: '4px 0 0', paddingLeft: 18, color: G.yellow }}>{r.probleme.map((x, i) => <li key={i}>{x}</li>)}</ul>}
            {f && <div style={{ fontSize: 12.5, color: G.muted }}>FAN: {ETICHETE_STARE_FAN[f.stare] || f.stare}{f.awb ? ` · AWB ${f.awb}` : ''}{f.hash_date !== r.hash && ['propus', 'aprobat'].includes(f.stare) ? ' · datele s-au schimbat după propunere: propune din nou' : ''}
              {f.urmarire_stare && f.urmarire_stare !== 'neurmarit' ? ` · urmărire: ${ETICHETE_URMARIRE[f.urmarire_stare] || f.urmarire_stare}` : ''}
              {f.confirmare_stare && f.confirmare_stare !== 'nesolicitata' ? ` · ${ETICHETE_CONFIRMARE[f.confirmare_stare] || f.confirmare_stare}` : ''}
              {f.motiv ? ` · ${f.motiv}` : ''}</div>}
          </div> })}
      </div>
    </>}
  </Modal>
}
