// ═══════════════════════════════════════════════════════════════════════════
// DOMENII PE AUTORIZAȚIE (RTE / RTS)
// ───────────────────────────────────────────────────────────────────────────
// Bifele sunt doar scurtătura pentru domeniile uzuale. Autorizațiile I.S.C. au
// domeniile numerotate — 8.4(T), 8.4(D), 8.5 — iar lista închisă făcea
// imposibilă transcrierea lor: se putea bifa doar „Gaze", deși pe act scrie
// altceva. Domeniul se scrie exact ca pe document, de aia există și textul liber.
//
// Fișier separat ca să-l folosească și HR.jsx, și rubrica de personal extern,
// fără import circular între ele.
//
// Componenta stă la nivel de modul, NU în corpul altei componente — altfel
// s-ar remonta la fiecare tastă și inputul ar pierde focusul (lecția din #105).
// ═══════════════════════════════════════════════════════════════════════════

import { useState } from 'react'

export const DOMENII_RTE = ['Gaze', 'Apă', 'Țiței', 'Electrice', 'Construcții civile', 'Construcții edilitare']

const C = {
  bg:'#0D1117', text:'#E6EDF3', muted:'#8B949E', border:'#30363D', blue:'#1F6FEB',
}

export default function DomeniiPicker({ domenii = [], setDomenii }) {
  const [nou, setNou] = useState('')

  const adauga = () => {
    const v = nou.trim()
    if (!v) return
    if (!domenii.includes(v)) setDomenii([...domenii, v])
    setNou('')
  }

  const libere = domenii.filter(d => !DOMENII_RTE.includes(d))

  return (
    <div style={{marginBottom:12, padding:12, background:C.blue+'11', border:`1px solid ${C.blue}33`, borderRadius:8}}>
      <div style={{fontSize:11, color:C.blue, fontWeight:700, marginBottom:8}}>
        🏷 Domenii — scrie-le exact ca pe document
      </div>

      <div style={{display:'flex', gap:6, flexWrap:'wrap'}}>
        {DOMENII_RTE.map(d => (
          <label key={d} style={{
            display:'flex', alignItems:'center', gap:6, padding:'6px 10px',
            background: domenii.includes(d) ? C.blue+'33' : C.bg,
            border:`1px solid ${domenii.includes(d) ? C.blue : C.border}`,
            borderRadius:6, cursor:'pointer', fontSize:12, color:C.text }}>
            <input type="checkbox" checked={domenii.includes(d)} onChange={e => {
              setDomenii(e.target.checked ? [...domenii, d] : domenii.filter(x => x !== d))
            }} style={{accentColor:C.blue}}/>
            {d}
          </label>
        ))}

        {libere.map(d => (
          <span key={d} style={{
            display:'flex', alignItems:'center', gap:6, padding:'6px 10px',
            background:C.blue+'33', border:`1px solid ${C.blue}`,
            borderRadius:6, fontSize:12, color:C.text }}>
            {d}
            <button type="button" onClick={() => setDomenii(domenii.filter(x => x !== d))}
              title="Scoate domeniul"
              style={{background:'transparent', border:'none', color:C.muted, cursor:'pointer', fontSize:13, lineHeight:1, padding:0}}>✕</button>
          </span>
        ))}
      </div>

      <div style={{display:'flex', gap:6, marginTop:8}}>
        <input value={nou} onChange={e => setNou(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); adauga() } }}
          placeholder="Alt domeniu — ex. 8.4(T), 8.4(D), 8.5"
          style={{flex:1, background:C.bg, border:`1px solid ${C.border}`, borderRadius:8, padding:'9px 12px', color:C.text, fontSize:13, outline:'none'}}/>
        <button type="button" onClick={adauga} style={{
          padding:'8px 14px', background:C.blue+'22', color:C.blue, border:`1px solid ${C.blue}66`,
          borderRadius:8, cursor:'pointer', fontWeight:700, fontSize:12, whiteSpace:'nowrap'}}>➕ Adaugă</button>
      </div>
    </div>
  )
}
