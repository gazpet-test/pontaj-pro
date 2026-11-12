// PolitaCitire.jsx — „📖 Citește documentul” la încărcarea unei polițe / unui act adițional (Polițe 20261205a, etapa 1).
//   PDF-ul se previzualizează local (fără upload până la citire); citirea o face edge-ul polita-citeste (urcă PDF-ul în spațiul
//   propunerilor, citește primele 2 pagini, întoarce o PROPUNERE). Nimic nu se salvează aici: formularul părinte arată câmpurile
//   propuse, omul le verifică pe pagină și abia „Salvează” scrie (fn_polita_salveaza).
//   Butonul apare doar pentru cine are dreptul (fn_poate_scrie_polite). L24: un rezultat întârziat pentru alt fișier e ignorat.
import { useEffect, useRef, useState } from 'react'
import { supabase } from './lib/supabase.js'
import { mesajEroare, pdfInBase64 } from './polite.js'

const T = {
  dark: { bg:'#0D1117', card:'#161B22', border:'#30363D', text:'#E6EDF3', muted:'#8B949E', yellow:'#E3B341', red:'#F85149', green:'#3FB950', blue:'#58A6FF' },
}

// dreptul de citire (același ca la salvarea prin RPC); null = în verificare
export function usePoateScriePolite() {
  const [poate, setPoate] = useState(null)
  useEffect(() => {
    let viu = true
    supabase.rpc('fn_poate_scrie_polite').then(({ data, error }) => { if (viu) setPoate(!error && data === true) })
    return () => { viu = false }
  }, [])
  return poate
}

async function eroareEdge(error) {
  if (!error?.context || typeof error.context.json !== 'function') return error?.message || 'serviciu_indisponibil'
  try { const j = await (typeof error.context.clone === 'function' ? error.context.clone() : error.context).json(); return j?.eroare || j?.error || 'serviciu_indisponibil' }
  catch { return 'serviciu_indisponibil' }
}

export default function PolitaCitire({ fisier, onFisier, onPropunere, eticheta = 'PDF poliță' }) {
  const c = T.dark
  const poate = usePoateScriePolite()
  const [url, setUrl] = useState(null)
  const [busy, setBusy] = useState(false)
  const [mesaj, setMesaj] = useState(null)   // {t, c}
  const gen = useRef(0)

  useEffect(() => {
    if (!fisier) { setUrl(null); return }
    const u = URL.createObjectURL(fisier)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [fisier])

  const alege = e => {
    gen.current++
    setMesaj(null); setBusy(false)
    onFisier?.(e.target.files?.[0] || null)
    onPropunere?.(null)
  }

  const citeste = async () => {
    if (!fisier || busy) return
    const g = ++gen.current
    setBusy(true); setMesaj({ t: 'Se citește documentul (primele 2 pagini)…', c: c.muted })
    try {
      const pdf_base64 = await pdfInBase64(fisier)
      const { data, error } = await supabase.functions.invoke('polita-citeste', { body: { pdf_base64 } })
      if (g !== gen.current) return
      if (error || !data?.success) throw new Error(error ? await eroareEdge(error) : data?.eroare || 'serviciu_indisponibil')
      const p = data.propunere
      if (g !== gen.current) return
      if (p?.stare === 'confirmat' && (p.polita_id || p.act_id)) {
        setMesaj({ t: `Atenție: documentul acesta e deja înregistrat${p.polita_id ? ` (poliță #${p.polita_id})` : ` (act #${p.act_id})`}. Nu-l adăuga a doua oară.`, c: c.red })
        onPropunere?.(null)
        return
      }
      // citit deja, dar respins sau cu polița ștearsă: valorile se folosesc, salvarea rămâne pe calea manuală
      onPropunere?.(p?.stare === 'propus' ? p : { ...p, doar_valori: true })
      const n = Object.keys(p?.campuri || {}).filter(k => !['dovezi', 'este_act_aditional'].includes(k)).length
      const nes = (p?.dezacorduri || []).length
      setMesaj({ t: `${data.din_cache ? 'Document citit deja: am folosit aceeași citire. ' : ''}Am completat ${n} câmpuri (galben)${nes ? `; ${nes} nesigure rămân goale (roșu)` : ''}. Verifică-le pe pagină înainte de salvare.`, c: c.yellow })
    } catch (e) {
      if (g === gen.current) setMesaj({ t: mesajEroare(e), c: c.red })
    } finally {
      if (g === gen.current) setBusy(false)
    }
  }

  return (
    <div>
      <label style={{ display:'block', fontSize:10.5, color:c.muted, marginBottom:3, fontWeight:600, textTransform:'uppercase', letterSpacing:'.3px' }}>{eticheta}</label>
      <input type="file" accept=".pdf,application/pdf" onChange={alege} style={{ fontSize:12, color:c.muted, marginBottom:8 }} />
      {fisier && poate && (
        <button type="button" onClick={citeste} disabled={busy}
          style={{ padding:'6px 12px', borderRadius:7, border:`1px solid ${c.blue}66`, background:c.blue + '18', color:c.blue, fontSize:12, fontWeight:700, cursor:busy ? 'wait' : 'pointer', marginLeft:8 }}>
          {busy ? '⏳ Se citește…' : '📖 Citește documentul'}
        </button>
      )}
      {mesaj && <div style={{ fontSize:11.5, color:mesaj.c, margin:'6px 0', lineHeight:1.5 }}>{mesaj.t}</div>}
      {url && <iframe title="Previzualizare document" src={`${url}#page=1`} style={{ width:'100%', height:380, border:`1px solid ${c.border}`, borderRadius:8, background:'#fff', marginTop:6 }} />}
    </div>
  )
}

// stilul unui câmp: galben = completat din document și neschimbat; roșu = nesigur (gol, de completat)
export function stilCampPropus(base, cheie, valoare, citire) {
  if (!citire) return base
  if (citire.nesigure?.includes(cheie) && (valoare === '' || valoare == null)) return { ...base, border:'1px solid #F85149', background:'#F8514912' }
  if (citire.propuse?.includes(cheie) && String(citire.valori?.[cheie] ?? '') === String(valoare ?? '')) return { ...base, border:'1px solid #E3B341', background:'#E3B34112' }
  return base
}
