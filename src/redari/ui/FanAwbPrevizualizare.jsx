/* FanAwbPrevizualizare.jsx — FAN Courier (SCHELET, doar citire): pentru un lot de plicuire arată ce s-ar trimite la FAN pentru
   fiecare plic și ce lipsește (telefon, județ, localitate, lungimi). NU generează AWB-uri, nu cheamă funcția edge, nu scrie nimic.
   Proiectare: docs/redari/FANCOURIER_INTEGRARE.md. Contactul (PII) se citește cu JWT-ul omului (RLS: doar admin/editor). */
import React, { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase.js'
import { construiestePlicFan } from '../../../supabase/functions/_shared/redariFan.mjs'
import { G, S, Modal, msgEroare, citestePaginat } from './comune.jsx'

const LOT_IN = 100

/** Pentru fiecare plic: contactul primului deținător din plic care are telefon (altfel primul). Funcție pură, testată. */
export function contactPePlic(plicuri, convocari, contacte) {
  const peDet = new Map((contacte || []).map(c => [c.detinator_id, c]))
  const detPePlic = new Map()
  for (const c of convocari || []) {
    if (!c.plic_id) continue
    if (!detPePlic.has(c.plic_id)) detPePlic.set(c.plic_id, [])
    detPePlic.get(c.plic_id).push(c.detinator_id)
  }
  return (plicuri || []).map(p => {
    const lista = [...new Set(detPePlic.get(p.id) || [])].sort().map(id => peDet.get(id)).filter(Boolean)
    return { plic: p, contact: lista.find(c => String(c.telefon || '').trim()) || lista[0] || null }
  })
}

export default function FanAwbPrevizualizare({ proiect, lot, plicuri, onClose }) {
  const [randuri, setRanduri] = useState(null), [eroare, setEroare] = useState('')
  const gen = useRef(0)
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
      if (!curent()) return
      setRanduri(contactPePlic(plicuri, conv, cont).map(({ plic, contact }) => ({ plic, ...construiestePlicFan({ plic, contact, proiectCod: proiect.cod }) })))
    })().catch(e => { if (curent()) setEroare(msgEroare(e)) })
    return () => { gen.current++ }
  }, [proiect.cod, lot.id, cheie])   // eslint-disable-line react-hooks/exhaustive-deps
  const gata = randuri?.filter(r => r.ok).length ?? 0
  return <Modal titlu={`AWB FAN — previzualizare ${lot.nr_lot}`} onClose={onClose} latime={760}>
    <p style={{ color: G.yellow }}>Doar previzualizare: generarea AWB-urilor FAN nu e activă (necesită aprobarea lui Răzvan, secretele FAN și activarea funcției). Nu se trimite și nu se plătește nimic.</p>
    {eroare && <p role="alert" style={{ color: G.red }}>Nu am putut citi datele: {eroare}</p>}
    {!randuri && !eroare && <p>Se citesc plicurile…</p>}
    {randuri && <>
      <p>{gata} din {randuri.length} plicuri au toate datele cerute de FAN.</p>
      <div style={{ display: 'grid', gap: 8 }}>
        {randuri.map(r => <div key={r.plic.id} style={{ ...S.card, borderColor: r.ok ? G.green : G.yellow }}>
          <b>{r.plic.nr_plic}</b> · {r.shipment.recipient.name || '(fără nume)'} · {[r.shipment.recipient.address.street, r.shipment.recipient.address.locality, r.shipment.recipient.address.county].filter(Boolean).join(', ') || '(fără adresă)'}
          {r.ok ? <div style={{ color: G.green }}>✓ gata pentru FAN</div> : <ul style={{ margin: '4px 0 0', paddingLeft: 18, color: G.yellow }}>{r.probleme.map((x, i) => <li key={i}>{x}</li>)}</ul>}
        </div>)}
      </div>
    </>}
  </Modal>
}
