import React, { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase.js'
import { G, S, msgEroare } from './comune.jsx'
import { salveazaPoartaUtilizatori } from '../convocareUtilizatori.js'

export default function PoartaUtilizatori({ proiect, esteOwner, show, onSchimbat }) {
  const [lucru, setLucru] = useState(false)
  const ocupat = useRef(false), generatie = useRef(0), context = useRef(null)
  context.current = { id: proiect.id, versiune: proiect.versiune, esteOwner }
  useEffect(() => {
    ++generatie.current
    ocupat.current = false; setLucru(false)
    return () => { ++generatie.current }
  }, [proiect.id, proiect.versiune, esteOwner])
  if (!esteOwner) return null
  const aprobata = proiect.convocare_utilizatori_aprobata === true
  const schimba = async () => {
    if (ocupat.current || typeof proiect.convocare_utilizatori_aprobata !== 'boolean') return
    if (!window.confirm(aprobata
      ? 'Oprești convocarea utilizatorilor și arendașilor din acest proiect? Rezervarea, regenerarea și expedierea vor fi refuzate.'
      : 'Aprobi convocarea utilizatorilor și arendașilor din acest proiect? Aprobarea se înregistrează cu identitatea ta și momentul salvării. Generarea documentului va fi disponibilă după livrarea șablonului separat (PR3b).')) return
    const g = generatie.current, id = proiect.id, versiune = proiect.versiune
    const curent = () => g === generatie.current && context.current?.id === id && context.current?.versiune === versiune && context.current?.esteOwner
    ocupat.current = true; setLucru(true)
    try {
      await salveazaPoartaUtilizatori(supabase, proiect, !aprobata)
      if (!curent()) return
      show(aprobata ? 'Convocarea utilizatorilor este oprită.' : 'Convocarea utilizatorilor este aprobată. Șablonul rămâne de livrat în PR3b.', 'success')
      onSchimbat?.()
    } catch (e) {
      if (curent()) {
        show('Convocarea utilizatorilor: ' + msgEroare(e), 'error')
        onSchimbat?.() // conflict sau rezultat necunoscut: recitim serverul, fără retry automat
      }
    } finally { if (curent()) { ocupat.current = false; setLucru(false) } }
  }
  return <div style={{ ...S.card, marginTop: 12 }}>
    <h3 style={{ fontSize: 15 }}>Convocarea utilizatorilor / arendașilor</h3>
    <p style={{ color: G.muted }}>Doar owner-ul aprobă. Convocatorul utilizatorului nu cere avizul avocatului. Șablonul juridic vine separat (PR3b).</p>
    <label><input type="checkbox" role="switch" checked={aprobata} disabled={lucru || typeof proiect.convocare_utilizatori_aprobata !== 'boolean'} onChange={schimba} /> Convocare aprobată</label>
    {typeof proiect.convocare_utilizatori_aprobata !== 'boolean' && <p>Poarta nu este încă disponibilă în baza de date.</p>}
  </div>
}
