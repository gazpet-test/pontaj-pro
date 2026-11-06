// Legătura apare numai dacă Redări întoarce un proiect vizibil prin RLS.
import React, { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase.js'
import { S } from './comune.jsx'

export default function LegaturaExecutie({ proiectId }) {
  const generatie = useRef(0)
  const [legatura, setLegatura] = useState(null)
  useEffect(() => {
    const token = ++generatie.current
    const id = proiectId
    setLegatura(null)
    supabase.from('red_proiecte').select('id').eq('executie_proiect_id', id).eq('activ', true).maybeSingle()
      .then(({ data, error }) => { if (generatie.current === token) setLegatura(!error && data ? { proiectId: id, redId: data.id } : null) })
      .catch(() => { if (generatie.current === token) setLegatura(null) })
    return () => { generatie.current++ }
  }, [proiectId])
  return legatura?.proiectId === proiectId ? <Link to={'/redari?proiect=' + legatura.redId} style={S.btnS}>Redări teren</Link> : null
}
