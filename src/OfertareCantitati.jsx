// ════════════════════════════════════════════════════════════════
// OfertareCantitati.jsx — 📋 Cantități & Clarificări per licitație
// Cantitățile se extrag cu AI din documentație (PT/planșe/CS), se verifică
// încrucișat și se validează de om; diferențele devin întrebări de clarificare.
// Adresa de clarificări se generează pe antet Gazpet (PDF) — se depune în SEAP.
// Regula fluxului (Razvan, 28.08): tranșa 1 RFQ pe cantitățile certe,
// tranșa 2 după răspunsurile la clarificări.
// ════════════════════════════════════════════════════════════════
import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase.js'

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
const CLAR_STATUS = {
  de_trimis: ['📝 de trimis', G.orange],
  trimisa:   ['📮 trimisă',   G.blue],
  raspunsa:  ['✅ răspunsă',  G.green],
  retrasa:   ['⛔ retrasă',   G.dim],
}

export default function CantitatiPanel({ licitatii, profile, showToast }) {
  const active = (licitatii || []).filter(l => !['castigata', 'pierduta', 'abandonata'].includes(l.status))
  const [licId, setLicId] = useState(null)
  const [cant, setCant] = useState(null)
  const [clar, setClar] = useState(null)
  const [busy, setBusy] = useState(null)

  useEffect(() => {
    if (licId == null && active.length) {
      // implicit: licitația cu termenul cel mai apropiat
      const cuT = [...active].sort((a, b) => new Date(a.termen_depunere || '2099') - new Date(b.termen_depunere || '2099'))
      setLicId(cuT[0].id)
    }
  }, [licitatii])

  const load = async () => {
    if (!licId) return
    const [{ data: c }, { data: q }] = await Promise.all([
      supabase.from('ofertare_cantitati').select('*').eq('licitatie_id', licId).order('id'),
      supabase.from('ofertare_clarificari').select('*').eq('licitatie_id', licId).order('nr'),
    ])
    setCant(c || []); setClar(q || [])
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

  // ── clarificări ──
  const setQ = (id, k, v) => setClar(qs => qs.map(q => q.id === id ? { ...q, [k]: v, _mod: true } : q))
  const saveQ = async (q) => {
    if (!q._mod) return
    await supabase.from('ofertare_clarificari').update({
      intrebare: q.intrebare, sursa: q.sursa || null, raspuns: q.raspuns || null,
      status: q.status, updated_at: new Date().toISOString(),
    }).eq('id', q.id)
    await load()
  }
  const addQ = async () => {
    const nr = (clar?.length ? Math.max(...clar.map(q => q.nr || 0)) : 0) + 1
    const { error } = await supabase.from('ofertare_clarificari').insert({ licitatie_id: licId, nr, intrebare: '', status: 'de_trimis' })
    if (error) { showToast('Eroare: ' + error.message, 'err'); return }
    await load()
  }
  const delQ = async (q) => {
    if (!window.confirm(`Ștergi întrebarea ${q.nr}?`)) return
    await supabase.from('ofertare_clarificari').delete().eq('id', q.id)
    await load()
  }

  // Adresa de clarificări — PDF pe antet, cu întrebările "de trimis"
  const genereazaAdresa = async () => {
    const deTrimis = (clar || []).filter(q => q.status === 'de_trimis' && (q.intrebare || '').trim())
    if (!deTrimis.length) { showToast('Nicio întrebare cu status „de trimis".', 'warn'); return }
    setBusy('PDF...')
    try {
      const { default: jsPDF } = await import('jspdf')
      const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
      const W = pdf.internal.pageSize.getWidth()
      pdf.setFontSize(12); pdf.setFont(undefined, 'bold'); pdf.text('GAZPET INSTAL S.R.L.', 14, 16)
      pdf.setFontSize(8); pdf.setFont(undefined, 'normal')
      pdf.text('Str. Fluturilor nr. 34, Ploiesti, Prahova · RO 22029920 · J29/1650/2007 · office@gazpet.ro · 0244/435005', 14, 21)
      pdf.line(14, 25, W - 14, 25)
      pdf.setFontSize(10)
      pdf.text(`Catre: ${lic?.autoritate || '—'}`, 14, 33)
      pdf.setFontSize(11); pdf.setFont(undefined, 'bold')
      pdf.text('SOLICITARE DE CLARIFICARI', W / 2, 43, { align: 'center' })
      pdf.setFontSize(9.5); pdf.setFont(undefined, 'normal')
      const ref = pdf.splitTextToSize(`Referitor: anuntul de participare ${lic?.nr_anunt || ''} — „${lic?.obiect || ''}"`, W - 28)
      pdf.text(ref, 14, 51)
      let y = 51 + ref.length * 4.5 + 4
      pdf.text('In conformitate cu prevederile art. 160 din Legea 98/2016, va adresam urmatoarele solicitari de clarificare:', 14, y)
      y += 8
      deTrimis.forEach(q => {
        const txt = pdf.splitTextToSize(`${q.nr}. ${q.intrebare.trim()}`, W - 28)
        if (y + txt.length * 4.3 > 275) { pdf.addPage(); y = 20 }
        pdf.text(txt, 14, y)
        y += txt.length * 4.3 + 4
      })
      if (y > 255) { pdf.addPage(); y = 20 }
      pdf.text('Va multumim si asteptam raspunsul dumneavoastra in termenul legal.', 14, y + 4)
      pdf.text('GAZPET INSTAL S.R.L.', 14, y + 14)
      pdf.save(`clarificari_${lic?.nr_anunt || licId}.pdf`)
      showToast(`Adresa cu ${deTrimis.length} întrebări generată — de depus în SEAP, apoi marchează-le „trimisă".`)
    } catch (e) { showToast('Eroare PDF: ' + (e?.message || e), 'err') }
    setBusy(null)
  }

  const fmtNr = v => (v || v === 0) ? new Intl.NumberFormat('ro-RO').format(v) : '—'
  const nrDif = (cant || []).filter(c => c.status === 'diferenta').length

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14, flexWrap:'wrap', gap:10 }}>
        <div>
          <div style={{ fontSize:19, fontWeight:800 }}>📋 Cantități & Clarificări</div>
          <div style={{ fontSize:12, color:G.muted }}>Extrase cu AI din documentație → verificate pe planșe → validate de om; diferențele merg la clarificări</div>
        </div>
        <select style={{ ...S.input, width:'auto', minWidth:220 }} value={licId || ''} onChange={e => setLicId(Number(e.target.value))}>
          {active.map(l => <option key={l.id} value={l.id}>{l.nr_anunt} · {(l.obiect || '').slice(0, 44)}</option>)}
        </select>
      </div>

      {busy && <div style={{ position:'fixed', top:76, right:20, zIndex:2000, padding:'11px 18px', borderRadius:9, fontSize:13, fontWeight:600, background:G.ofertare, color:'#0D1117' }}>{busy}</div>}

      {/* Cantități */}
      <div style={{ ...S.card, padding:14, marginBottom:12 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8, flexWrap:'wrap', gap:8 }}>
          <div style={{ fontWeight:800, fontSize:13.5 }}>
            🧮 Cantități ({cant?.length ?? '...'})
            {nrDif > 0 && <span style={{ color:G.red, marginLeft:10, fontSize:12 }}>⚠ {nrDif} cu diferențe</span>}
          </div>
          <button style={{ ...S.btnS, padding:'5px 12px', fontSize:12 }} onClick={addC}>＋ rând</button>
        </div>
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12, minWidth:860 }}>
            <thead><tr style={{ color:G.muted, fontSize:10.5, textTransform:'uppercase', textAlign:'left' }}>
              {['Status', 'Denumire', 'UM', 'Cantitate', 'Specificații', 'Sursă', '', ''].map((h, i) => <th key={i} style={{ padding:'5px 7px', borderBottom:`1px solid ${G.border}` }}>{h}</th>)}
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

      {/* Clarificări */}
      <div style={{ ...S.card, padding:14 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8, flexWrap:'wrap', gap:8 }}>
          <div style={{ fontWeight:800, fontSize:13.5 }}>❓ Clarificări către autoritate ({clar?.length ?? '...'})</div>
          <div style={{ display:'flex', gap:8 }}>
            <button style={{ ...S.btnS, padding:'5px 12px', fontSize:12 }} onClick={addQ}>＋ întrebare</button>
            <button style={{ ...S.btnP, padding:'5px 14px', fontSize:12 }} onClick={genereazaAdresa} disabled={!!busy}>📄 Generează adresa</button>
          </div>
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {(clar || []).map(q => {
            const [lbl, col] = CLAR_STATUS[q.status] || CLAR_STATUS.de_trimis
            return (
              <div key={q.id} style={{ padding:'10px 12px', background:G.bg, borderRadius:8, border:`1px solid ${G.border2}`, borderLeft:`3px solid ${col}` }}>
                <div style={{ display:'flex', gap:10, alignItems:'flex-start' }}>
                  <span style={{ fontWeight:800, color:G.muted, paddingTop:8 }}>{q.nr}.</span>
                  <div style={{ flex:1 }}>
                    <textarea style={{ ...S.input, minHeight:54, resize:'vertical' }} value={q.intrebare || ''} placeholder="Textul întrebării..."
                      onChange={e => setQ(q.id, 'intrebare', e.target.value)} onBlur={() => saveQ(q)} />
                    {q.sursa && <div style={{ fontSize:11, color:G.dim, marginTop:3 }}>sursa: {q.sursa}</div>}
                    {(q.status === 'raspunsa' || q.raspuns) && (
                      <textarea style={{ ...S.input, minHeight:40, resize:'vertical', marginTop:6, borderColor:G.green + '55' }} value={q.raspuns || ''} placeholder="Răspunsul autorității..."
                        onChange={e => setQ(q.id, 'raspuns', e.target.value)} onBlur={() => saveQ(q)} />
                    )}
                  </div>
                  <div style={{ display:'flex', flexDirection:'column', gap:5, minWidth:120 }}>
                    <select style={{ ...S.input, fontSize:11.5 }} value={q.status} onChange={e => { setQ(q.id, 'status', e.target.value); }} onBlur={() => saveQ(q)}>
                      {Object.entries(CLAR_STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                    <button onClick={() => delQ(q)} style={{ ...S.btnS, padding:'3px 8px', fontSize:11, color:G.red, borderColor:G.red + '66' }}>✕</button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
        {clar !== null && !clar.length && <div style={{ color:G.dim, fontSize:12.5, padding:14, textAlign:'center' }}>Nicio clarificare — diferențele din cantități apar automat aici la extracție.</div>}
      </div>
    </div>
  )
}
