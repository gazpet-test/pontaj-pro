// ═══════════════════════════════════════════════════════════════════════════
// RezumatZiModal.jsx — „📝 Rezumatul zilei” din Rapoarte Șantier (birou), r2 al rezumatului raportului zilnic
// Un singur text pe zi, pe toate șantierele pe care cel care cere le vede deja (lista din ecran + RLS-ul de azi), pentru
// directorul de execuție / WhatsApp: antet cu totaluri, câteva rânduri pe șantier, apoi șantierele active fără raport.
// Doar CITIRE (SELECT pe rapoarte_zilnice / raport_lucrari), nimic salvat, niciun drept nou, fără buton de trimitere.
// Textul e determinist (rezumatZi din raportRezumat.js), fără AI.
// ═══════════════════════════════════════════════════════════════════════════
import { useState, useEffect, useRef, useMemo } from 'react'
import { supabase } from './lib/supabase.js'
import { rezumatZi, citesteRapoarteZi, intrareZi, santiereDeRaportat } from './raportRezumat.js'
import { copiaza } from './RubricaRezumat.jsx'

const G = {
  bg: '#0D1117', surface: '#161B22', border: '#21262D', border2: '#30363D',
  text: '#E6EDF3', muted: '#8B949E', dim: '#6E7681',
  blue: '#58A6FF', green: '#3FB950', red: '#F85149', yellow: '#D29922',
}
const btn = (culoare) => ({
  background: culoare + '18', color: culoare, border: `1px solid ${culoare}55`, borderRadius: 8,
  padding: '8px 13px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
})

// sites = șantierele din ecran (cele pe care le vede utilizatorul); numele vin de aici (sites.name)
export default function RezumatZiModal({ ziInitiala, sites, onClose }) {
  const [zi, setZi] = useState(ziInitiala || '')
  const [stare, setStare] = useState({ incarc: false, eroare: null, text: '', nr: 0 })
  const [copiat, setCopiat] = useState(false)
  const genRef = useRef(0)   // L24: un răspuns întârziat (altă zi aleasă între timp / fereastra închisă) nu se aplică
  const siteIds = useMemo(() => (sites || []).map(s => s.id), [sites])
  const nume = useMemo(() => new Map((sites || []).map(s => [String(s.id), s.name])), [sites])
  const active = useMemo(() => santiereDeRaportat(sites), [sites])

  useEffect(() => {
    const gen = ++genRef.current
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(zi)) { setStare({ incarc: false, eroare: null, text: '', nr: 0 }); return undefined }
    setStare({ incarc: true, eroare: null, text: '', nr: 0 })
    ;(async () => {
      try {
        const randuri = await citesteRapoarteZi(supabase, siteIds, zi)
        if (gen !== genRef.current) return
        const text = rezumatZi(randuri.map(r => intrareZi(r, id => nume.get(String(id)))), zi, { santiereActive: active })
        setStare({ incarc: false, eroare: null, text, nr: randuri.length })
      } catch (e) {
        // L18: o eroare de citire NU devine „niciun raport”
        if (gen === genRef.current) setStare({ incarc: false, eroare: 'Nu s-au putut citi rapoartele zilei: ' + (e?.message || e), text: '', nr: 0 })
      }
    })()
    return () => { genRef.current++ }
  }, [zi, siteIds, nume, active])

  const onCopiaza = async () => {
    const ok = await copiaza(stare.text)
    setCopiat(ok ? 'Copiat ✓' : 'Nu s-a putut copia — selectează textul și copiază-l manual')
    setTimeout(() => setCopiat(false), 2500)
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.72)', zIndex: 3000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '5vh 16px', overflowY: 'auto' }}>
      <div data-rezumat-zi onClick={e => e.stopPropagation()} style={{ background: G.surface, border: `1px solid ${G.border2}`, borderRadius: 16, maxWidth: 760, width: '100%', padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: G.text }}>📝 Rezumatul zilei</div>
            <div style={{ fontSize: 12.5, color: G.muted, marginTop: 3 }}>Toate șantierele tale, din rapoartele trimise în ziua aleasă. Textul se copiază, nu se trimite de aici.</div>
          </div>
          <button onClick={onClose} style={{ background: G.bg, border: `1px solid ${G.border}`, color: G.text, borderRadius: 9, width: 34, height: 34, fontSize: 17, cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <label style={{ fontSize: 13, color: G.muted, display: 'flex', alignItems: 'center', gap: 8 }}>
            Ziua
            <input data-rezumat-zi-data type="date" value={zi} onChange={e => setZi(e.target.value)} style={{ background: G.bg, border: `1px solid ${G.border2}`, color: G.text, borderRadius: 8, padding: '7px 10px', fontFamily: 'inherit', fontSize: 14, outline: 'none' }} />
          </label>
          <button data-rezumat-zi-copiaza onClick={onCopiaza} disabled={!stare.text || stare.incarc} style={{ ...btn(G.blue), opacity: !stare.text || stare.incarc ? .5 : 1 }}>📋 Copiază</button>
          {copiat && <span style={{ fontSize: 12, color: copiat === 'Copiat ✓' ? G.green : G.yellow }}>{copiat}</span>}
        </div>
        {stare.incarc && <div style={{ color: G.dim, padding: '30px 0', textAlign: 'center' }}>Se citesc rapoartele…</div>}
        {stare.eroare && <div role="alert" style={{ color: G.red, fontSize: 13, padding: '10px 0' }}>{stare.eroare}</div>}
        {!stare.incarc && !stare.eroare && !zi && <div style={{ color: G.dim, padding: '30px 0', textAlign: 'center' }}>Alege ziua.</div>}
        {!stare.incarc && !stare.eroare && stare.text && (
          <textarea data-rezumat-zi-text readOnly value={stare.text} rows={Math.min(28, Math.max(6, stare.text.split('\n').length + 1))}
            onFocus={e => e.target.select()}
            style={{ width: '100%', boxSizing: 'border-box', background: G.bg, border: `1px solid ${G.border2}`, color: G.text, borderRadius: 10, padding: 12,
              fontFamily: 'inherit', fontSize: 13.5, lineHeight: 1.5, resize: 'vertical', outline: 'none' }} />
        )}
      </div>
    </div>
  )
}
