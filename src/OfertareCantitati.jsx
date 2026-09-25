// ════════════════════════════════════════════════════════════════
// OfertareCantitati.jsx — 📋 Cantități per licitație
// Cantitățile se extrag cu AI din documentație (PT/planșe/CS), se verifică
// încrucișat și se validează de om; diferențele devin întrebări de clarificare.
// Clarificările (întrebări, adresa PDF, răspunsul autorității) s-au MUTAT în ecranul lor —
// OfertareClarificari.jsx (Răzvan 15.09.2026: la Domnești ajungeai la ele după zeci de pagini).
// Regula fluxului (Razvan, 28.08): tranșa 1 RFQ pe cantitățile certe,
// tranșa 2 după răspunsurile la clarificări.
// ════════════════════════════════════════════════════════════════
import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase.js'
import { ruleazaExtragere, mesajExtragere, reluareDupa } from './ofertareExtragereCantitati.js'

const G = {
  bg:'#0D1117', surface:'#161B22', card:'#1C2128', border:'#30363D', border2:'#21262D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  ofertare:'#3FB6E2', green:'#3FB950', blue:'#58A6FF', orange:'#F0883E', yellow:'#E3B341', red:'#F85149', purple:'#A371F7',
}
const S = {
  input: { width:'100%', boxSizing:'border-box', background:G.bg, border:`1px solid ${G.border2}`, borderRadius:6, padding:'7px 10px', color:G.text, fontSize:12.5, outline:'none' },
  btnP: { padding:'8px 16px', background:G.ofertare, color:'#0D1117', border:'none', borderRadius:7, cursor:'pointer', fontSize:12.5, fontWeight:700 },
  btnS: { padding:'8px 16px', background:G.surface, color:G.text, border:`1px solid ${G.border2}`, borderRadius:7, cursor:'pointer', fontSize:12.5 },
  card: { background:G.card, border:`1px solid ${G.border}`, borderRadius:10 },
}
const CANT_STATUS = {
  extras:               ['🤖 extras',      G.blue],
  validat:              ['✅ validat',     G.green],
  diferenta:            ['⚠ diferență',   G.red],
  revizuit_clarificare: ['🔁 revizuit',    G.purple],
}

export default function CantitatiPanel({ licitatii, profile, showToast, initialLicId = null, onInapoi = null, onGoClarificari = null }) {
  const active = (licitatii || []).filter(l => !['castigata', 'pierduta', 'abandonata'].includes(l.status))
  const [licId, setLicId] = useState(initialLicId)
  const [cant, setCant] = useState(null)
  const [nrClar, setNrClar] = useState(null)   // doar numărul — lista e în ecranul ❓ Clarificări

  useEffect(() => {
    if (licId == null && active.length) {
      // implicit: licitația cu termenul cel mai apropiat
      const cuT = [...active].sort((a, b) => new Date(a.termen_depunere || '2099') - new Date(b.termen_depunere || '2099'))
      setLicId(cuT[0].id)
    }
  }, [licitatii])

  const load = async () => {
    if (!licId) return
    const [{ data: c }, { count: nq }] = await Promise.all([
      // .limit explicit: fără el PostgREST taie tăcut la 1000 de rânduri, iar Domnești
      // are 1069 de poziții — 69 dispăreau din ecran fără niciun semn.
      supabase.from('ofertare_cantitati').select('*').eq('licitatie_id', licId).order('ordine', { nullsFirst: false }).order('id').limit(20000),
      supabase.from('ofertare_clarificari').select('id', { count: 'exact', head: true }).eq('licitatie_id', licId),
    ])
    setCant(c || []); setNrClar(nq ?? 0)
  }
  useEffect(() => { load() }, [licId])

  const lic = active.find(l => l.id === licId)

  // ── cantități ──
  const setC = (id, k, v) => setCant(cs => cs.map(c => c.id === id ? { ...c, [k]: v, _mod: true } : c))
  const saveC = async (c) => {
    if (!c._mod) return
    await supabase.from('ofertare_cantitati').update({
      obiect: c.obiect || null, categorie: c.categorie || null, denumire: c.denumire,
      um: c.um || null, cantitate: c.cantitate !== '' && c.cantitate != null ? Number(c.cantitate) : null,
      specificatii: c.specificatii || null, sursa: c.sursa || null,
      diferenta_nota: c.diferenta_nota || null, updated_at: new Date().toISOString(),
    }).eq('id', c.id)
  }
  const valideazaC = async (c) => {
    const nou = c.status === 'validat' ? 'extras' : 'validat'
    await supabase.from('ofertare_cantitati').update({ status: nou, updated_at: new Date().toISOString() }).eq('id', c.id)
    await load()
  }
  const addC = async () => {
    const { error } = await supabase.from('ofertare_cantitati').insert({ licitatie_id: licId, denumire: 'Material/articol nou', status: 'extras', extras_de_ai: false })
    if (error) { showToast('Eroare: ' + error.message, 'err'); return }
    await load()
  }
  const delC = async (c) => {
    if (!window.confirm(`Ștergi „${(c.denumire || '').slice(0, 60)}"?`)) return
    await supabase.from('ofertare_cantitati').delete().eq('id', c.id)
    await load()
  }

  // 🤖 extragerea din documentație (ofertare-cantitati-extrage): funcția lucrează cu buget de timp
  // și întoarce `continua` + `urmatorul` — o reluăm până termină. Costă (model AI), deci cu confirmare.
  // Bucla + mesajele sunt în ofertareExtragereCantitati.js (25.09.2026, Jilava): eroarea reală (ex. 403
  // „doar ownerul sau responsabilul") nu mai e acoperită de un fals „terminată: 0 rânduri", iar o rulare
  // oprită de plafonul de apeluri SAU de o eroare trecătoare la mijloc (504/546, furnizor) se reia de unde
  // a rămas, nu de la zero (feliile deja plătite nu se replătesc). La 401/403 nu se oferă o reluare nouă,
  // dar se păstrează cea de dinainte de clic (reluareDupa(r, licId, reluare)).
  const [extrag, setExtrag] = useState(null)
  const [reluare, setReluare] = useState(null)   // { licId, deLa } după o rulare neterminată / întreruptă
  const extrage = async () => {
    if (!licId || extrag) return
    const deLa = reluare?.licId === licId ? reluare.deLa : 0
    const intrebare = deLa
      ? `Continui extragerea cantităților de la felia ${deLa + 1} (rularea anterioară s-a oprit acolo)? Costă (model AI).`
      : 'Extrag cantitățile din documentația licitației cu AI (cost de ordinul centimilor pe felie)? Rândurile existente nu se șterg.'
    if (!window.confirm(intrebare)) return
    let feliaCurenta = deLa
    try {
      const r = await ruleazaExtragere(
        body => supabase.functions.invoke('ofertare-cantitati-extrage', { body }),
        licId, { deLa, onPas: i => { feliaCurenta = i; setExtrag(`felia ${i + 1}…`) } })
      setReluare(reluareDupa(r, licId, reluare))
      const m = mesajExtragere(r)
      showToast(m.text, m.tip)
    } catch (e) {
      // excepție neașteptată (nu {error} de la invoke): păstrăm punctul de reluare dacă trecuserăm de prima felie
      setReluare(feliaCurenta > 0 ? { licId, deLa: feliaCurenta } : null)
      showToast('Extragere oprită: ' + (e?.message || e), 'err')
    } finally { setExtrag(null); await load() }
  }

  const fmtNr = v => (v || v === 0) ? new Intl.NumberFormat('ro-RO').format(v) : '—'
  const nrDif = (cant || []).filter(c => c.status === 'diferenta').length

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14, flexWrap:'wrap', gap:10 }}>
        <div>
          <div style={{ fontSize:19, fontWeight:800 }}>📋 Cantități</div>
          <div style={{ fontSize:12, color:G.muted }}>Extrase cu AI din documentație → verificate pe planșe → validate de om; diferențele merg în ❓ Clarificări</div>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center', flex:1, minWidth:260 }}>
          {onInapoi && <button style={{ ...S.btnS, padding:'8px 14px', whiteSpace:'nowrap' }} onClick={onInapoi} title="Înapoi la fișa licitației">← Înapoi la fișă</button>}
          <select style={{ ...S.input, flex:1, minWidth:200, maxWidth:760 }} title="Licitația de lucru" value={licId || ''} onChange={e => setLicId(Number(e.target.value))}>
            {active.map(l => <option key={l.id} value={l.id}>{l.nr_anunt} · {(l.obiect || '').slice(0, 44)}</option>)}
          </select>
        </div>
      </div>

      {/* Cantități */}
      <div style={{ ...S.card, padding:14, marginBottom:12 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8, flexWrap:'wrap', gap:8 }}>
          <div style={{ fontWeight:800, fontSize:13.5 }}>
            🧮 Cantități ({cant?.length ?? '...'})
            {nrDif > 0 && <span style={{ color:G.red, marginLeft:10, fontSize:12 }}>⚠ {nrDif} cu diferențe</span>}
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <button style={{ ...S.btnP, padding:'5px 12px', fontSize:12, opacity: extrag ? 0.6 : 1 }} disabled={!!extrag} onClick={extrage}
              title="Citește lista de cantități / caietele deja importate și scrie pozițiile (F3 pe obiecte, cu cod articol)">{extrag ? '⏳ ' + extrag : reluare?.licId === licId ? `🤖 Continuă extragerea (felia ${reluare.deLa + 1})` : '🤖 Extrage din documentație'}</button>
            <button style={{ ...S.btnS, padding:'5px 12px', fontSize:12 }} onClick={addC}>＋ rând</button>
          </div>
        </div>
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12, minWidth:860 }}>
            <thead><tr style={{ color:G.muted, fontSize:10.5, textTransform:'uppercase', textAlign:'left' }}>
              {['Status', 'Obiect', 'Cod', 'Denumire', 'UM', 'Cantitate', 'Specificații', 'Sursă', '', ''].map((h, i) => <th key={i} style={{ padding:'5px 7px', borderBottom:`1px solid ${G.border}` }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {(cant || []).map(c => {
                const [lbl, col] = CANT_STATUS[c.status] || CANT_STATUS.extras
                return (
                  <tr key={c.id} style={{ borderBottom:`1px solid ${G.border2}`, background: c.status === 'diferenta' ? G.red + '0D' : 'transparent' }}>
                    <td style={{ padding:'4px 7px', whiteSpace:'nowrap' }} title={c.diferenta_nota || ''}>
                      <span style={{ color:col, fontWeight:700, fontSize:11.5 }}>{lbl}</span>
                      {c.diferenta_nota && <span style={{ color:G.red }}> *</span>}
                    </td>
                    <td style={{ padding:'4px 7px', color:G.muted, fontSize:11, maxWidth:110, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }} title={c.obiect || ''}>{c.obiect || '—'}</td>
                    <td style={{ padding:'4px 7px', color:G.muted, fontSize:11, whiteSpace:'nowrap' }}>{c.cod_articol || '—'}</td>
                    <td style={{ padding:'4px 7px', minWidth:260 }}>
                      <input style={S.input} value={c.denumire || ''} onChange={e => setC(c.id, 'denumire', e.target.value)} onBlur={() => saveC(c)} title={c.diferenta_nota || ''} /></td>
                    <td style={{ padding:'4px 7px', width:60 }}>
                      <input style={S.input} value={c.um || ''} onChange={e => setC(c.id, 'um', e.target.value)} onBlur={() => saveC(c)} /></td>
                    <td style={{ padding:'4px 7px', width:100 }}>
                      <input style={S.input} type="number" value={c.cantitate ?? ''} onChange={e => setC(c.id, 'cantitate', e.target.value)} onBlur={() => saveC(c)} placeholder="?" /></td>
                    <td style={{ padding:'4px 7px', minWidth:150 }}>
                      <input style={S.input} value={c.specificatii || ''} onChange={e => setC(c.id, 'specificatii', e.target.value)} onBlur={() => saveC(c)} /></td>
                    <td style={{ padding:'4px 7px', color:G.dim, fontSize:11, maxWidth:170, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }} title={c.sursa || ''}>{c.sursa || '—'}</td>
                    <td style={{ padding:'4px 4px' }}>
                      <button title={c.status === 'validat' ? 'Redeschide' : 'Validează'} onClick={() => valideazaC(c)}
                        style={{ ...S.btnS, padding:'3px 9px', fontSize:11, color: c.status === 'validat' ? G.dim : G.green, borderColor: (c.status === 'validat' ? G.dim : G.green) + '66' }}>
                        {c.status === 'validat' ? '↩' : '✓'}</button></td>
                    <td style={{ padding:'4px 4px' }}>
                      <button title="Șterge" onClick={() => delC(c)} style={{ ...S.btnS, padding:'3px 8px', fontSize:11, color:G.red, borderColor:G.red + '66' }}>✕</button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {cant !== null && !cant.length && <div style={{ color:G.dim, fontSize:12.5, padding:14, textAlign:'center' }}>Nicio cantitate încă — se extrag cu AI din documentație sau se adaugă manual.</div>}
      </div>

      {/* Clarificările s-au mutat în ecranul lor (Răzvan 15.09.2026) — aici rămâne doar trimiterea */}
      <div style={{ ...S.card, padding:'10px 14px', display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
        <span style={{ fontSize:12.5, color:G.muted }}>❓ Clarificările s-au mutat în ecranul lor{nrClar != null ? ` (${nrClar} pe licitația asta)` : ''} — întrebări, adresa PDF, răspunsul autorității.</span>
        <button style={{ ...S.btnP, padding:'5px 14px', fontSize:12, marginLeft:'auto' }} disabled={!onGoClarificari || !licId} onClick={() => onGoClarificari?.(licId)}>Deschide Clarificări →</button>
      </div>
    </div>
  )
}
