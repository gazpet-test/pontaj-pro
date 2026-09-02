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
      // HTML pe antet → html2canvas → A4 (fontul standard jsPDF nu are diacritice)
      const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      const azi = new Date().toLocaleDateString('ro-RO')
      const html = `
        <div style="font-family:Arial,Helvetica,sans-serif;color:#111;padding:48px 56px;font-size:13.5px;line-height:1.55">
          <table style="width:100%;border-collapse:collapse"><tr>
            <td style="vertical-align:bottom">
              <div style="font-size:21px;font-weight:800;letter-spacing:.4px">GAZPET INSTAL S.R.L.</div>
              <div style="font-size:10.5px;color:#444;margin-top:3px">Str. Fluturilor nr. 34, Ploiești, Prahova &nbsp;·&nbsp; CUI RO 22029920 &nbsp;·&nbsp; J29/1650/2007<br/>office@gazpet.ro &nbsp;·&nbsp; tel/fax 0244/435005</div>
            </td>
            <td style="vertical-align:bottom;text-align:right;font-size:11px;color:#444">Ploiești, ${azi}</td>
          </tr></table>
          <div style="border-bottom:2.5px solid #111;margin:10px 0 26px"></div>
          <div style="margin-bottom:4px"><b>Către:</b> ${esc(lic?.autoritate || '—')}</div>
          <div style="font-size:11.5px;color:#444;margin-bottom:26px">În atenția comisiei de evaluare</div>
          <div style="text-align:center;font-size:16px;font-weight:800;letter-spacing:.5px;margin-bottom:6px">SOLICITARE DE CLARIFICĂRI</div>
          <div style="text-align:center;font-size:12px;color:#333;margin-bottom:24px">Referitor: anunțul de participare <b>${esc(lic?.nr_anunt || '')}</b> — „${esc(lic?.obiect || '')}"</div>
          <p style="text-align:justify;margin:0 0 14px">Stimate doamne / Stimați domni,</p>
          <p style="text-align:justify;margin:0 0 18px">În conformitate cu prevederile art. 160 din Legea nr. 98/2016 privind achizițiile publice, vă adresăm următoarele solicitări de clarificare cu privire la documentația de atribuire:</p>
          ${deTrimis.map(q => `
            <table style="width:100%;border-collapse:collapse;margin-bottom:14px"><tr>
              <td style="vertical-align:top;width:34px;font-weight:800;font-size:13.5px;padding-top:1px">${q.nr}.</td>
              <td style="text-align:justify">${esc(q.intrebare.trim())}</td>
            </tr></table>`).join('')}
          <p style="text-align:justify;margin:20px 0 0">Vă mulțumim și așteptăm răspunsul dumneavoastră în termenul legal, prin intermediul SEAP.</p>
          <table style="width:100%;border-collapse:collapse;margin-top:44px"><tr>
            <td style="width:55%"></td>
            <td style="text-align:center">
              <div style="font-weight:800">GAZPET INSTAL S.R.L.</div>
              <div style="font-size:12px;margin-top:2px">Administrator</div>
              <div style="font-size:12px;font-weight:700;margin-top:2px">Trușu Răzvan</div>
            </td>
          </tr></table>
        </div>`
      const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([import('jspdf'), import('html2canvas')])
      const div = document.createElement('div')
      div.style.cssText = 'position:fixed;left:-10000px;top:0;width:794px;background:#fff'
      div.innerHTML = html
      document.body.appendChild(div)
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
      const canvas = await html2canvas(div, { scale: 2, backgroundColor: '#fff' })
      document.body.removeChild(div)
      const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
      const imgH = canvas.height * 210 / canvas.width
      const pagini = Math.max(1, Math.ceil(imgH / 297))
      for (let i = 0; i < pagini; i++) {
        if (i > 0) pdf.addPage()
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, -i * 297, 210, imgH)
      }
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
            {/* clarificare depusă în afara generatorului (ex. de Mirela, direct în SEAP) — se urcă PDF-ul ca platforma să țină cont de ea */}
            <label style={{ ...S.btnS, padding:'5px 12px', fontSize:12, cursor:'pointer' }}>
              📎 Clarificare externă (PDF)
              <input type="file" accept=".pdf" style={{ display:'none' }} onChange={async e => {
                const file = e.target.files?.[0]; e.target.value = ''
                if (!file) return
                const path = `${licId}/clarificari/${Date.now()}_${file.name.replace(/[^\w.-]+/g, '_')}`
                const { error: eUp } = await supabase.storage.from('ofertare').upload(path, file, { upsert:false })
                if (eUp) return showToast('Upload: ' + eUp.message, 'err')
                const nr = (clar?.length ? Math.max(...clar.map(q => q.nr || 0)) : 0) + 1
                const { error } = await supabase.from('ofertare_clarificari').insert({
                  licitatie_id: licId, nr, sursa: 'extern', status: 'trimisa', fisier_path: path,
                  intrebare: `(clarificare depusă extern — ${file.name}; completează aici pe scurt ce s-a întrebat)`,
                })
                if (error) return showToast('Eroare: ' + error.message, 'err')
                showToast('✓ Clarificarea externă e în platformă — completează întrebarea pe scurt și, când vine, răspunsul.')
                load()
              }} />
            </label>
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
                    <div style={{ display:'flex', gap:10, alignItems:'center', marginTop:3 }}>
                      {q.sursa && <span style={{ fontSize:11, color:G.dim }}>sursa: {q.sursa}</span>}
                      {q.fisier_path && <button style={{ ...S.btnS, padding:'2px 8px', fontSize:11 }} onClick={async () => {
                        const { data } = await supabase.storage.from('ofertare').createSignedUrl(q.fisier_path, 600)
                        if (data?.signedUrl) window.open(data.signedUrl, '_blank')
                      }}>📄 PDF-ul depus</button>}
                    </div>
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
