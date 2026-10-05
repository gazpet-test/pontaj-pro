// ════════════════════════════════════════════════════════════════
// OfertareTipareDeclansate.jsx — panoul „Tipare declanșate” din Documentație (pasul B, MAPARE_CNSC_IN_ERP.md §1a).
// Determinist și gratuit: frazele dintre ghilimele din trigger.semnal (doar tiparele cu tip_detectie = cuvant_cheie) sunt
// căutate în textul extras al documentelor din unde_cauti (caiet de sarcini / contract / F3 / fișa de date…).
// Ex.: PAT-GAZ-14 („contract doar execuție, dar CS cere proiectare”) ar fi prins Mânăstirea din F3 în ziua publicării.
// „Creează întrebare din tipar” preia intrebare_propusa ca CIORNĂ (origine platforma) și atașează tiparul ca temei —
// omul o rescrie, nimic nu pleacă automat.
// ════════════════════════════════════════════════════════════════
import { useState } from 'react'
import { supabase } from './lib/supabase.js'
import { tipareDeclansate, UNDE_CAUTI_TIP } from './ofertareTemeiuri.js'

const G = { bg:'#0D1117', surface:'#161B22', card:'#1C2128', border:'#30363D', border2:'#21262D', text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  ofertare:'#3FB6E2', green:'#3FB950', blue:'#58A6FF', orange:'#F0883E', yellow:'#E3B341', red:'#F85149', purple:'#A371F7' }
const S = { btnS: { padding:'5px 11px', background:G.surface, color:G.text, border:`1px solid ${G.border2}`, borderRadius:7, cursor:'pointer', fontSize:11.5 } }
const TIPURI = [...new Set(Object.values(UNDE_CAUTI_TIP).flat())]
const MAX_DOCS = 40            // documente citite per verificare (text_extras ~100k caractere fiecare)

export default function OfertareTipareDeclansate({ licitatie: l, showToast = null, onCreat = null }) {
  const [rez, setRez] = useState(null)        // null = neverificat
  const [busy, setBusy] = useState(false)
  const [info, setInfo] = useState('')
  const anunta = (t, tip = 'ok') => showToast ? showToast(t, tip) : console.log(tip, t)

  const verifica = async () => {
    setBusy(true); setInfo('')
    const [{ data: tipare, error: eT }, { data: docs, error: eD }] = await Promise.all([
      supabase.from('clarificari_tipare').select('pattern_id, titlu, trigger, precedente_cnsc, intrebare_propusa, confidence, requires_human_legal_review'),
      supabase.from('ofertare_documente_atribuire').select('id, nume_original, tip, text_extras').eq('licitatie_id', l.id).in('tip', TIPURI).not('text_extras', 'is', null).order('id').limit(MAX_DOCS),
    ])
    setBusy(false)
    if (eT || eD) return anunta('Verificarea a eșuat: ' + (eT?.message || eD?.message), 'err')
    const texte = (docs || []).map(d => ({ id: d.id, nume: d.nume_original, tip: d.tip, text: d.text_extras }))
    setRez(tipareDeclansate(tipare || [], texte))
    setInfo(`${(tipare || []).filter(t => t.trigger?.tip_detectie === 'cuvant_cheie').length} tipare cu cuvinte-cheie · ${texte.length} documente cu text extras${(docs || []).length >= MAX_DOCS ? ` (limitat la ${MAX_DOCS})` : ''}`)
  }

  const creeaza = async t => {
    setBusy(true)
    const { data: ex } = await supabase.from('ofertare_clarificari').select('nr').eq('licitatie_id', l.id)
    const nr = ((ex || []).reduce((m, q) => Math.max(m, q.nr || 0), 0) || 0) + 1
    const { data: ins, error } = await supabase.from('ofertare_clarificari').insert({
      licitatie_id: l.id, nr, intrebare: t.intrebare_propusa || '', status: 'de_trimis', origine: 'platforma', sursa: `tipar:${t.pattern_id}`, cheie: `tipar_${t.pattern_id}`,
    }).select('id').single()
    if (error) { setBusy(false); return anunta('Ciorna nu s-a creat: ' + error.message, 'err') }
    const { error: eTem } = await supabase.from('ofertare_clarificari_temeiuri').insert({ clarificare_id: ins.id, pattern_id: t.pattern_id, sursa: 'propus_tipar', confirmat: true })
    setBusy(false)
    anunta(eTem ? `Ciorna #${nr} creată, dar tiparul nu s-a atașat ca temei (${/does not exist|schema cache/i.test(eTem.message) ? 'migrarea temeiurilor nu e aplicată' : eTem.message})` : `Ciorna #${nr} creată din ${t.pattern_id} — rescrie-o în Clarificări înainte de trimitere`, eTem ? 'warn' : 'ok')
    onCreat?.(ins.id)
  }

  return (
    <div style={{ padding:'12px 14px', borderRadius:10, border:`1px solid ${G.border}`, background:G.card, marginBottom:14 }}>
      <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
        <div style={{ fontSize:13.5, fontWeight:800 }}>📐 Tipare declanșate</div>
        <span style={{ fontSize:11.5, color:G.dim }}>cuvinte-cheie din tiparele de clarificări, căutate în textul extras al documentelor — determinist, fără AI</span>
        <button style={{ ...S.btnS, marginLeft:'auto', color:G.ofertare, borderColor:G.ofertare + '66' }} disabled={busy} onClick={verifica}>{busy ? '⏳ verific…' : '🔍 Verifică față de tipare'}</button>
      </div>
      {info && <div style={{ fontSize:11, color:G.dim, marginTop:4 }}>{info}</div>}
      {rez && rez.length === 0 && <div style={{ fontSize:12, color:G.muted, marginTop:8 }}>Niciun tipar declanșat pe documentele citite. (Tiparele care cer comparație între documente sau judecată umană nu se detectează automat.)</div>}
      {rez && rez.length > 0 && (
        <div style={{ display:'grid', gap:8, marginTop:10 }}>
          {rez.map(t => (
            <div key={t.pattern_id} style={{ padding:'8px 10px', borderRadius:8, border:`1px solid ${G.border2}`, background:G.bg }}>
              <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
                <b style={{ fontSize:12.5 }}>{t.pattern_id}</b><span style={{ fontSize:12.5 }}>{t.titlu}</span>
                <span style={{ fontSize:10.5, color:G.muted, border:`1px solid ${G.border}`, borderRadius:5, padding:'1px 6px' }}>încredere {t.confidence}</span>
                {t.review && <span style={{ fontSize:10.5, color:G.purple, border:`1px solid ${G.purple}55`, borderRadius:5, padding:'1px 6px' }}>⚖️ review juridic</span>}
                <span style={{ fontSize:10.5, color:G.dim }}>{t.nr_precedente} precedente CNSC</span>
                <button style={{ ...S.btnS, marginLeft:'auto', color:G.green, borderColor:G.green + '66' }} disabled={busy || !t.intrebare_propusa} onClick={() => creeaza(t)} title="Creează o ciornă de întrebare din tipar (origine: platformă). O rescrii înainte de trimitere.">＋ Creează întrebare din tipar</button>
              </div>
              <ul style={{ margin:'6px 0 0', paddingLeft:18, fontSize:11.5, color:G.muted }}>
                {t.potriviri.slice(0, 6).map((p, i) => <li key={i}>„{p.fraza}” — în <span style={{ color:G.text }}>{p.doc}</span></li>)}
                {t.potriviri.length > 6 && <li>+ încă {t.potriviri.length - 6} potriviri</li>}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
