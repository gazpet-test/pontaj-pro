// ═══════════════════════════════════════════════════════════════════════════
// RubricaRezumat.jsx — rubrica „Rezumat” a raportului zilnic (20261215a, etapa 1)
// Textul scurt salvat pe raport (pentru WhatsApp / directorul de execuție): eticheta „generat automat” / „editat de <nume>”,
// „Copiază”, iar pentru cine are drept de scriere pe raport: corectură, „Revino la automat”, „Generează” (rapoartele vechi).
// Textul automat îl scrie SERVERUL (trigger pe rapoarte_zilnice); aici doar se cere: sursa 'editat' + textul omului, sau sursa 'automat'.
// Scrierea = UPDATE cu CAS pe versiune_salvare (L01): 0 rânduri = raportul s-a schimbat între timp sau lipsește dreptul → reîncarci.
// Fără buton de trimitere (WhatsApp / mail) în etapa 1.
// Înainte de aplicarea migrării (coloanele lipsesc din rând) rubrica nu apare deloc.
// ═══════════════════════════════════════════════════════════════════════════
import { useState, useEffect, useRef } from 'react'
import { supabase } from './lib/supabase.js'
import { etichetaRezumat, valideazaEditat, MAX_EDITAT } from './raportRezumat.js'

const G = {
  bg: '#0D1117', surface: '#161B22', surface2: '#1C2230', border: '#21262D', border2: '#30363D',
  text: '#E6EDF3', muted: '#8B949E', dim: '#6E7681',
  blue: '#58A6FF', green: '#3FB950', red: '#F85149', yellow: '#D29922', purple: '#BC8CFF',
}
const COLOANE = 'id, versiune_salvare, rezumat_text, rezumat_sursa, rezumat_la, rezumat_de, updated_at'
const fmtMoment = (t) => t ? new Date(t).toLocaleString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Bucharest' }) : ''
const btn = (culoare, plin) => ({
  background: plin ? culoare : culoare + '18', color: plin ? '#0D1117' : culoare, border: `1px solid ${culoare}55`, borderRadius: 8,
  padding: '7px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
})

async function copiaza(text) {
  try { await navigator.clipboard.writeText(text); return true } catch { /* browser vechi / fără permisiune: varianta clasică */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0'
    document.body.appendChild(ta); ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch { return false }
}

export default function RubricaRezumat({ raport, poateEdita, onActualizat, compact }) {
  const [editez, setEditez] = useState(false)
  const [text, setText] = useState('')
  const [lucreaza, setLucreaza] = useState(false)
  const [eroare, setEroare] = useState(null)
  const [copiat, setCopiat] = useState(false)
  const [numeAutor, setNumeAutor] = useState(null)
  const genRef = useRef(0)              // L24: un răspuns întârziat nu se aplică peste alt raport
  const idRef = useRef(raport?.id)

  // alt raport = altă rubrică: se închide editarea, se uită erorile și răspunsurile în zbor
  useEffect(() => { idRef.current = raport?.id; genRef.current++; setEditez(false); setEroare(null); setCopiat(false) }, [raport?.id])

  // numele celui care a corectat (doar afișare; fără nume = „un utilizator”)
  useEffect(() => {
    let viu = true
    setNumeAutor(null)
    if (raport?.rezumat_sursa === 'editat' && raport?.rezumat_de) {
      supabase.from('profiles').select('name').eq('id', raport.rezumat_de).maybeSingle()
        .then(({ data }) => { if (viu) setNumeAutor(data?.name || null) })
    }
    return () => { viu = false }
  }, [raport?.rezumat_de, raport?.rezumat_sursa])

  if (!raport || !('rezumat_sursa' in raport)) return null   // migrarea încă neaplicată
  const areVersiune = Number.isInteger(raport.versiune_salvare)
  const scrie = poateEdita && areVersiune
  const eticheta = etichetaRezumat(raport, numeAutor)
  // corectura e mai veche decât ultima salvare a raportului: textul poate să nu mai corespundă
  const corecturaVeche = raport.rezumat_sursa === 'editat' && raport.updated_at && raport.rezumat_la
    && Date.parse(raport.updated_at) > Date.parse(raport.rezumat_la)

  const trimite = async (patch) => {
    const gen = ++genRef.current, id = raport.id
    setLucreaza(true); setEroare(null)
    const { data, error } = await supabase.from('rapoarte_zilnice').update(patch)
      .eq('id', id).eq('versiune_salvare', raport.versiune_salvare).select(COLOANE)
    if (gen !== genRef.current || idRef.current !== id) return
    setLucreaza(false)
    // L18: eroarea serverului se arată (nu devine „nimic schimbat”); 0 rânduri = conflict sau fără drept, reîncarci
    if (error) { setEroare('Nu s-a salvat: ' + (error.message || 'eroare la server')); return }
    if (!Array.isArray(data) || data.length !== 1) {
      setEroare('Nu s-a salvat: raportul s-a modificat între timp (sau nu ai drept de scriere pe el). Redeschide raportul și încearcă din nou.')
      return
    }
    setEditez(false)
    onActualizat?.(data[0])
  }
  const salveaza = () => {
    const er = valideazaEditat(text)
    if (er) { setEroare(er); return }
    trimite({ rezumat_text: text, rezumat_sursa: 'editat' })
  }
  const laAutomat = () => {
    if (raport.rezumat_sursa === 'editat' && !window.confirm('Înlocuiești textul corectat cu rezumatul generat automat din raport?')) return
    trimite({ rezumat_sursa: 'automat' })
  }
  const onCopiaza = async () => {
    const ok = await copiaza(raport.rezumat_text || '')
    setCopiat(ok ? 'Copiat ✓' : 'Nu s-a putut copia — selectează textul și copiază-l manual')
    setTimeout(() => setCopiat(false), 2500)
  }

  return (
    <div style={{ background: G.bg, border: `1px solid ${G.border2}`, borderRadius: 10, padding: compact ? 10 : 12 }}>
      {raport.rezumat_sursa == null ? (
        <div style={{ fontSize: 13, color: G.dim }}>
          Raportul a fost salvat înainte de rubrica de rezumat — încă nu are rezumat.
          {scrie && <div style={{ marginTop: 8 }}><button data-rezumat-genereaza disabled={lucreaza} onClick={laAutomat} style={btn(G.blue)}>{lucreaza ? '…' : 'Generează rezumatul'}</button></div>}
        </div>
      ) : editez ? (
        <>
          <textarea data-rezumat-editor value={text} onChange={e => setText(e.target.value)} rows={7} maxLength={MAX_EDITAT}
            style={{ width: '100%', boxSizing: 'border-box', background: G.surface2, border: `1px solid ${G.border2}`, color: G.text, borderRadius: 8,
              padding: '9px 11px', fontFamily: 'inherit', fontSize: 14, lineHeight: 1.45, resize: 'vertical', outline: 'none' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11.5, color: G.dim }}>{Array.from(text).length}/{MAX_EDITAT} · textul corectat nu se mai schimbă singur la salvarea raportului</span>
            <span style={{ display: 'flex', gap: 6 }}>
              <button data-rezumat-renunta disabled={lucreaza} onClick={() => { setEditez(false); setEroare(null) }} style={btn(G.muted)}>Renunță</button>
              <button data-rezumat-salveaza disabled={lucreaza} onClick={salveaza} style={btn(G.green, true)}>{lucreaza ? 'Se salvează…' : 'Salvează'}</button>
            </span>
          </div>
        </>
      ) : (
        <>
          <div data-rezumat-text style={{ fontSize: 14, color: G.text, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{raport.rezumat_text}</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <span data-rezumat-eticheta style={{ fontSize: 11.5, color: raport.rezumat_sursa === 'editat' ? G.purple : G.dim }}>
              {eticheta}{raport.rezumat_la ? ` · ${fmtMoment(raport.rezumat_la)}` : ''}
              {raport.rezumat_sursa === 'automat' && ' · se reface la fiecare salvare a raportului'}
            </span>
            <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button data-rezumat-copiaza onClick={onCopiaza} style={btn(G.blue)}>📋 Copiază</button>
              {scrie && <button data-rezumat-corecteaza disabled={lucreaza} onClick={() => { setText(raport.rezumat_text || ''); setEroare(null); setEditez(true) }} style={btn(G.muted)}>✏️ Corectează</button>}
              {scrie && raport.rezumat_sursa === 'editat' && <button data-rezumat-automat disabled={lucreaza} onClick={laAutomat} style={btn(G.yellow)}>{lucreaza ? '…' : '↺ Revino la automat'}</button>}
            </span>
          </div>
          {corecturaVeche && <div data-rezumat-veche style={{ marginTop: 8, fontSize: 12, color: G.yellow }}>⚠️ Raportul a fost salvat din nou după corectură — verifică dacă rezumatul mai corespunde.</div>}
          {copiat && <div data-rezumat-copiat style={{ marginTop: 6, fontSize: 12, color: copiat === 'Copiat ✓' ? G.green : G.yellow }}>{copiat}</div>}
        </>
      )}
      {eroare && <div data-rezumat-eroare role="alert" style={{ marginTop: 8, fontSize: 12.5, color: G.red }}>{eroare}</div>}
    </div>
  )
}
