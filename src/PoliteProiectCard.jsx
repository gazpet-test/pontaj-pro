// PoliteProiectCard.jsx — Execuție → proiect → Dashboard: polițele contractului proiectului (Polițe 20261205a, etapa 1).
//   Doar citire, din v_polite_scadente (aceeași regulă ca mailurile de alertă). Polițele se adaugă / prelungesc pe contract
//   (Administrativ → contract → 🛡️ Polițe). L24: rezultatul se aplică doar dacă proiectul e încă cel curent.
import { useEffect, useRef, useState } from 'react'
import { supabase } from './lib/supabase.js'
import { situatiePolita, fmtZiRo, fmtSuma } from './polite.js'

const C = { bg:'#0D1117', card:'#161B22', border:'#30363D', text:'#E6EDF3', muted:'#8B949E', green:'#3FB950', yellow:'#E3B341', red:'#F85149', orange:'#F0883E' }
const culoare = r => r.data_expirare == null ? C.muted : r.zile < 0 ? C.red : r.zile <= 15 ? C.red : r.zile <= 30 ? C.orange : r.zile <= 60 ? C.yellow : C.green

export default function PoliteProiectCard({ proiectId }) {
  const [stare, setStare] = useState({ incarcat:false, contract:null, randuri:[], eroare:null })
  const gen = useRef(0)
  useEffect(() => {
    const g = ++gen.current
    setStare({ incarcat:false, contract:null, randuri:[], eroare:null })
    ;(async () => {
      const { data: p, error: e1 } = await supabase.from('executie_proiecte').select('contract_id').eq('id', proiectId).maybeSingle()
      if (g !== gen.current) return
      if (e1) { setStare({ incarcat:true, contract:null, randuri:[], eroare:'Nu am putut citi proiectul.' }); return }
      if (!p?.contract_id) { setStare({ incarcat:true, contract:null, randuri:[], eroare:null }); return }
      const { data, error } = await supabase.from('v_polite_scadente').select('cheie, tip, asigurator, nr_polita, valoare, moneda, data_expirare, zile, prag, sursa')
        .eq('contract_id', p.contract_id).order('data_expirare', { ascending:true, nullsFirst:true })
      if (g !== gen.current) return
      // vederea lipsește până la migrarea 20261205a: cartonașul nu apare (nu e o eroare a utilizatorului)
      if (error) { setStare({ incarcat:true, contract:p.contract_id, randuri:[], eroare:/v_polite_scadente|schema cache|does not exist/i.test(error.message || '') ? 'lipsa' : 'Nu am putut citi polițele.' }); return }
      setStare({ incarcat:true, contract:p.contract_id, randuri:data || [], eroare:null })
    })()
  }, [proiectId])

  if (!stare.incarcat || stare.eroare === 'lipsa') return null
  return (
    <div style={{ background:C.bg, borderRadius:10, padding:'14px 16px', marginBottom:14 }}>
      <div style={{ fontSize:11, color:C.muted, fontWeight:700, textTransform:'uppercase', letterSpacing:'.6px', marginBottom:10 }}>🛡️ Polițe (CAR / GBE) ale contractului</div>
      {stare.eroare && <div style={{ fontSize:12, color:C.red }}>{stare.eroare}</div>}
      {!stare.eroare && !stare.contract && <div style={{ fontSize:12, color:C.muted }}>Proiectul nu are contract legat: polițele se urmăresc pe contract (Administrativ → Contracte).</div>}
      {!stare.eroare && stare.contract && stare.randuri.length === 0 && <div style={{ fontSize:12, color:C.muted }}>Nicio poliță activă pe contract. Polițele se adaugă din Administrativ → contract → 🛡️ Polițe.</div>}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(230px, 1fr))', gap:10 }}>
        {stare.randuri.map(r => {
          const col = culoare(r)
          return (
            <div key={r.cheie} style={{ background:C.card, borderRadius:8, padding:'10px 14px', borderLeft:`3px solid ${col}` }}>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <b style={{ color:C.text }}>{r.tip}</b><span style={{ fontSize:12, color:C.muted, fontFamily:'monospace' }}>{r.nr_polita || '—'}</span>
              </div>
              <div style={{ fontSize:12, color:C.muted, marginTop:3 }}>{r.asigurator || '—'} · {fmtSuma(r.valoare, r.moneda)}</div>
              <div style={{ fontSize:12.5, marginTop:5 }}>valabilă până la <b style={{ color:col }}>{fmtZiRo(r.data_expirare)}</b></div>
              <div style={{ fontSize:12, color:col, fontWeight:700, marginTop:2 }}>{r.data_expirare == null ? 'fără dată de expirare' : r.zile > 60 ? `${r.zile} zile` : situatiePolita(r.prag, r.zile)}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
