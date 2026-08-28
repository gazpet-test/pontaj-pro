// ════════════════════════════════════════════════════════════════
// OfertareRFQ.jsx — 🛒 Cereri de ofertă pe materiale (fluxul RFQ)
// Prețurile se învechesc → la fiecare licitație: generezi cererea de ofertă
// (PDF pe antet Gazpet, o trimiți tu pe mail), imporți PDF-urile ofertelor
// primite (AI: ofertare-rfq-import), comparativul se face singur, prețurile
// alese se împing în Referințe (ofertare_preturi_materiale). Decizie Razvan 28.08.
// ════════════════════════════════════════════════════════════════
import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase.js'

const G = {
  bg:'#0D1117', surface:'#161B22', card:'#1C2128', border:'#30363D', border2:'#21262D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  ofertare:'#3FB6E2', green:'#3FB950', blue:'#58A6FF', orange:'#F0883E', yellow:'#E3B341', red:'#F85149',
}
const S = {
  input: { width:'100%', boxSizing:'border-box', background:G.bg, border:`1px solid ${G.border2}`, borderRadius:6, padding:'7px 11px', color:G.text, fontSize:12.5, outline:'none' },
  lbl: { display:'block', fontSize:11, color:G.muted, marginBottom:4, fontWeight:600, textTransform:'uppercase', letterSpacing:'.3px' },
  btnP: { padding:'8px 16px', background:G.ofertare, color:'#0D1117', border:'none', borderRadius:7, cursor:'pointer', fontSize:12.5, fontWeight:700 },
  btnS: { padding:'8px 16px', background:G.surface, color:G.text, border:`1px solid ${G.border2}`, borderRadius:7, cursor:'pointer', fontSize:12.5 },
  card: { background:G.card, border:`1px solid ${G.border}`, borderRadius:10 },
}
const fmtLei = v => (v || v === 0) ? new Intl.NumberFormat('ro-RO', { maximumFractionDigits: 2 }).format(v) : '—'
const RFQ_STATUS = { draft:['📝 Draft', G.muted], trimisa:['📮 Trimisă', G.blue], oferte_primite:['📥 Oferte primite', G.orange], finalizata:['✅ Finalizată', G.green] }

export default function RFQPanel({ licitatii, profile, showToast }) {
  const [rfqs, setRfqs] = useState(null)
  const [selId, setSelId] = useState(null)

  const load = async () => {
    const { data } = await supabase.from('ofertare_rfq').select('*').order('created_at', { ascending: false })
    setRfqs(data || [])
  }
  useEffect(() => { load() }, [])

  const creeaza = async () => {
    const titlu = window.prompt('Titlul cererii de ofertă (ex: „Materiale PE — Mănăstirea"):')
    if (!titlu?.trim()) return
    const { data, error } = await supabase.from('ofertare_rfq')
      .insert({ titlu: titlu.trim(), created_by: profile?.id || null }).select('id').single()
    if (error) { showToast('Eroare: ' + error.message, 'err'); return }
    await load(); setSelId(data.id)
  }

  const licMap = {}; (licitatii || []).forEach(l => { licMap[l.id] = l })
  const sel = (rfqs || []).find(r => r.id === selId)

  if (sel) return <RFQDetaliu rfq={sel} licitatii={licitatii} showToast={showToast} onBack={() => { setSelId(null); load() }} onChange={load} />

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16, flexWrap:'wrap', gap:10 }}>
        <div>
          <div style={{ fontSize:19, fontWeight:800 }}>🛒 Cereri de ofertă (materiale)</div>
          <div style={{ fontSize:12, color:G.muted }}>Generezi cererea, o trimiți furnizorilor, imporți PDF-urile primite — comparativul se face singur</div>
        </div>
        <button style={S.btnP} onClick={creeaza}>＋ Cerere nouă</button>
      </div>
      {rfqs === null && <div style={{ padding:40, textAlign:'center', color:G.muted }}>Se încarcă...</div>}
      {rfqs !== null && !rfqs.length && (
        <div style={{ ...S.card, padding:40, textAlign:'center', color:G.dim, fontSize:14 }}>
          Nicio cerere de ofertă încă. „＋ Cerere nouă" → adaugi materialele → PDF către furnizori.
        </div>
      )}
      <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
        {(rfqs || []).map(r => {
          const [stLbl, stCol] = RFQ_STATUS[r.status] || RFQ_STATUS.draft
          const lic = r.licitatie_id ? licMap[r.licitatie_id] : null
          return (
            <div key={r.id} onClick={() => setSelId(r.id)} style={{ ...S.card, padding:'13px 17px', cursor:'pointer' }}>
              <div style={{ display:'flex', alignItems:'center', gap:11, flexWrap:'wrap' }}>
                <span style={{ color:stCol, fontWeight:800, fontSize:12, whiteSpace:'nowrap' }}>{stLbl}</span>
                <span style={{ fontWeight:800, fontSize:14 }}>{r.titlu}</span>
                {lic && <span style={{ fontSize:11.5, color:G.blue }}>🏛 {lic.nr_anunt}</span>}
                <span style={{ marginLeft:'auto', fontSize:11.5, color:G.dim }}>
                  {r.termen_raspuns ? `răspuns până la ${new Date(r.termen_raspuns).toLocaleDateString('ro-RO')}` : ''}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function RFQDetaliu({ rfq, licitatii, showToast, onBack, onChange }) {
  const [mats, setMats] = useState(null)
  const [oferte, setOferte] = useState(null)
  const [preturi, setPreturi] = useState([])
  const [busy, setBusy] = useState(null)
  const [meta, setMeta] = useState({ titlu: rfq.titlu, licitatie_id: rfq.licitatie_id || '', termen_raspuns: rfq.termen_raspuns || '', status: rfq.status, observatii: rfq.observatii || '' })

  const load = async () => {
    const [{ data: m }, { data: o }] = await Promise.all([
      supabase.from('ofertare_rfq_materiale').select('*').eq('rfq_id', rfq.id).order('ordine'),
      supabase.from('ofertare_rfq_oferte').select('*').eq('rfq_id', rfq.id).order('created_at'),
    ])
    setMats(m || []); setOferte(o || [])
    if (o?.length) {
      const { data: p } = await supabase.from('ofertare_rfq_preturi').select('*').in('oferta_id', o.map(x => x.id))
      setPreturi(p || [])
    } else setPreturi([])
  }
  useEffect(() => { load() }, [rfq.id])

  const salveazaMeta = async () => {
    const { error } = await supabase.from('ofertare_rfq').update({
      titlu: meta.titlu.trim() || rfq.titlu,
      licitatie_id: meta.licitatie_id ? Number(meta.licitatie_id) : null,
      termen_raspuns: meta.termen_raspuns || null,
      status: meta.status,
      observatii: meta.observatii.trim() || null,
      updated_at: new Date().toISOString(),
    }).eq('id', rfq.id)
    if (error) { showToast('Eroare: ' + error.message, 'err'); return }
    showToast('Cerere salvată.'); onChange()
  }

  // ── materiale ──
  const addMat = async () => {
    const { error } = await supabase.from('ofertare_rfq_materiale')
      .insert({ rfq_id: rfq.id, denumire: 'Material nou', ordine: (mats?.length || 0) + 1 })
    if (error) { showToast('Eroare: ' + error.message, 'err'); return }
    await load()
  }
  const setMat = async (id, k, v) => {
    setMats(ms => ms.map(m => m.id === id ? { ...m, [k]: v } : m))
  }
  const saveMat = async (m) => {
    await supabase.from('ofertare_rfq_materiale').update({
      denumire: m.denumire, um: m.um || null, cantitate: m.cantitate !== '' && m.cantitate != null ? Number(m.cantitate) : null, specificatii: m.specificatii || null,
    }).eq('id', m.id)
  }
  const delMat = async (m) => {
    if (!window.confirm(`Ștergi „${m.denumire}"?`)) return
    await supabase.from('ofertare_rfq_materiale').delete().eq('id', m.id)
    await load()
  }

  // ── PDF-ul cererii de ofertă (antet Gazpet, îl trimite omul pe mail) ──
  const genereazaPdf = async () => {
    setBusy('PDF...')
    try {
      const { default: jsPDF } = await import('jspdf')
      const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
      const W = pdf.internal.pageSize.getWidth()
      pdf.setFontSize(12); pdf.setFont(undefined, 'bold')
      pdf.text('GAZPET INSTAL S.R.L.', 14, 16)
      pdf.setFontSize(8); pdf.setFont(undefined, 'normal')
      pdf.text('Str. Fluturilor nr. 34, Ploiesti, Prahova · RO 22029920 · J29/1650/2007', 14, 21)
      pdf.text('Tel./Fax 0244/435005 · office@gazpet.ro', 14, 25)
      pdf.setLineWidth(.3); pdf.line(14, 28, W - 14, 28)
      pdf.setFontSize(13); pdf.setFont(undefined, 'bold')
      pdf.text('CERERE DE OFERTA', W / 2, 38, { align: 'center' })
      pdf.setFontSize(10); pdf.setFont(undefined, 'normal')
      const titlu = pdf.splitTextToSize(`Ref.: ${meta.titlu}`, W - 28)
      pdf.text(titlu, 14, 46)
      let y = 46 + titlu.length * 5 + 3
      pdf.text('Va rugam sa ne transmiteti cea mai buna oferta de pret (lei, fara TVA) pentru urmatoarele materiale:', 14, y); y += 8
      pdf.setFontSize(9); pdf.setFont(undefined, 'bold')
      pdf.text('Nr.', 14, y); pdf.text('Denumire material / specificatii', 24, y); pdf.text('UM', 138, y); pdf.text('Cantitate', 150, y); pdf.text('Pret unitar', 172, y)
      pdf.setFont(undefined, 'normal'); y += 2; pdf.line(14, y, W - 14, y); y += 5
      ;(mats || []).forEach((m, i) => {
        const den = pdf.splitTextToSize(m.denumire + (m.specificatii ? ' — ' + m.specificatii : ''), 110)
        if (y + den.length * 4.5 > 275) { pdf.addPage(); y = 20 }
        pdf.text(String(i + 1), 14, y)
        pdf.text(den, 24, y)
        pdf.text(m.um || '', 138, y)
        pdf.text(m.cantitate != null ? String(m.cantitate) : '', 150, y)
        pdf.text('__________', 172, y)
        y += den.length * 4.5 + 2.5
      })
      y += 4
      if (y > 255) { pdf.addPage(); y = 20 }
      pdf.setFontSize(9.5)
      pdf.text('In oferta va rugam sa precizati: valabilitatea ofertei, termenul si conditiile de livrare, conditiile de plata.', 14, y); y += 6
      if (meta.termen_raspuns) { pdf.text(`Termen de raspuns: ${new Date(meta.termen_raspuns).toLocaleDateString('ro-RO')}`, 14, y); y += 6 }
      pdf.text('Va multumim,', 14, y + 6)
      pdf.text('GAZPET INSTAL S.R.L.', 14, y + 12)
      pdf.save(`cerere_oferta_${rfq.id}.pdf`)
      showToast('PDF generat — atașează-l la mailul către furnizori.')
    } catch (e) { showToast('Eroare PDF: ' + (e?.message || e), 'err') }
    setBusy(null)
  }

  // ── oferte primite ──
  const addOferta = async (file) => {
    if (!file) return
    const furnizor = window.prompt('Numele furnizorului (AI îl poate corecta la import):', '')
    if (furnizor === null) return
    setBusy('Se încarcă PDF-ul...')
    try {
      const safe = file.name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-80)
      const path = `rfq/${rfq.id}/${Date.now()}_${safe}`
      const { error: eUp } = await supabase.storage.from('ofertare').upload(path, file, { contentType: 'application/pdf' })
      if (eUp) throw eUp
      const { error } = await supabase.from('ofertare_rfq_oferte')
        .insert({ rfq_id: rfq.id, furnizor: furnizor.trim() || file.name, fisier_path: path })
      if (error) throw error
      showToast('Ofertă adăugată — apasă 🤖 ca AI să extragă prețurile.')
      await load()
    } catch (e) { showToast('Eroare: ' + (e?.message || e), 'err') }
    setBusy(null)
  }
  const importaAI = async (o) => {
    setBusy(`AI citește oferta ${o.furnizor}...`)
    const { data, error } = await supabase.functions.invoke('ofertare-rfq-import', { body: { oferta_id: o.id } })
    setBusy(null)
    if (error || data?.error) { showToast('Import eșuat: ' + (error?.message || data?.error), 'err'); return }
    showToast(`🤖 ${data.preturi_gasite}/${data.materiale} prețuri extrase de la ${o.furnizor}.`)
    await load()
  }
  const delOferta = async (o) => {
    if (!window.confirm(`Ștergi oferta ${o.furnizor}?`)) return
    await supabase.from('ofertare_rfq_oferte').delete().eq('id', o.id)
    await load()
  }

  // ── comparativ + alegere ──
  const pretPt = (matId, ofId) => preturi.find(p => p.material_id === matId && p.oferta_id === ofId)
  const alege = async (p) => {
    // un singur preț ales per material
    const altele = preturi.filter(x => x.material_id === p.material_id && x.id !== p.id && x.ales)
    for (const a of altele) await supabase.from('ofertare_rfq_preturi').update({ ales: false }).eq('id', a.id)
    await supabase.from('ofertare_rfq_preturi').update({ ales: !p.ales }).eq('id', p.id)
    await load()
  }
  const trimiteReferinte = async () => {
    const alese = preturi.filter(p => p.ales && p.pret != null)
    if (!alese.length) { showToast('Niciun preț ales (click pe preț în comparativ).', 'warn'); return }
    const an = new Date().getFullYear()
    const rows = alese.map(p => {
      const m = (mats || []).find(x => x.id === p.material_id)
      const o = (oferte || []).find(x => x.id === p.oferta_id)
      return { denumire: m?.denumire || p.denumire_furnizor || '?', um: p.um || m?.um || null, pret: p.pret, furnizor: o?.furnizor || null, lucrare: meta.titlu, an, note: 'din RFQ #' + rfq.id }
    })
    const { error } = await supabase.from('ofertare_preturi_materiale').insert(rows)
    if (error) { showToast('Eroare: ' + error.message, 'err'); return }
    await supabase.from('ofertare_rfq').update({ status: 'finalizata', updated_at: new Date().toISOString() }).eq('id', rfq.id)
    setMeta(m => ({ ...m, status: 'finalizata' }))
    showToast(`✅ ${rows.length} prețuri trimise în Referințe → Materiale.`)
    onChange()
  }

  const minPret = (matId) => {
    const vals = preturi.filter(p => p.material_id === matId && p.pret != null).map(p => Number(p.pret))
    return vals.length ? Math.min(...vals) : null
  }
  const cuTermen = (licitatii || [])

  return (
    <div>
      {busy && <div style={{ position:'fixed', top:76, right:20, zIndex:2000, padding:'11px 18px', borderRadius:9, fontSize:13, fontWeight:600, background:G.ofertare, color:'#0D1117' }}>{busy}</div>}
      <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:14, flexWrap:'wrap' }}>
        <button style={S.btnS} onClick={onBack}>← înapoi</button>
        <div style={{ fontSize:17, fontWeight:800, flex:1 }}>🛒 {meta.titlu}</div>
        <button style={S.btnS} onClick={genereazaPdf} disabled={!mats?.length}>📄 PDF cerere</button>
        <button style={S.btnP} onClick={trimiteReferinte}>✔ Prețurile alese → Referințe</button>
      </div>

      {/* meta */}
      <div style={{ ...S.card, padding:14, marginBottom:12, display:'grid', gridTemplateColumns:'2fr 1.4fr 1fr 1fr', gap:10, alignItems:'end' }}>
        <div><label style={S.lbl}>Titlu</label><input style={S.input} value={meta.titlu} onChange={e => setMeta(m => ({ ...m, titlu: e.target.value }))} /></div>
        <div><label style={S.lbl}>Licitație</label>
          <select style={S.input} value={meta.licitatie_id} onChange={e => setMeta(m => ({ ...m, licitatie_id: e.target.value }))}>
            <option value="">— fără —</option>
            {cuTermen.map(l => <option key={l.id} value={l.id}>{l.nr_anunt}</option>)}
          </select></div>
        <div><label style={S.lbl}>Termen răspuns</label><input style={S.input} type="date" value={meta.termen_raspuns} onChange={e => setMeta(m => ({ ...m, termen_raspuns: e.target.value }))} /></div>
        <div style={{ display:'flex', gap:8 }}>
          <select style={S.input} value={meta.status} onChange={e => setMeta(m => ({ ...m, status: e.target.value }))}>
            {Object.entries(RFQ_STATUS).map(([k, [lbl]]) => <option key={k} value={k}>{lbl}</option>)}
          </select>
          <button style={S.btnS} onClick={salveazaMeta}>💾</button>
        </div>
      </div>

      {/* materiale */}
      <div style={{ ...S.card, padding:14, marginBottom:12 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
          <div style={{ fontWeight:800, fontSize:13.5 }}>🧱 Materiale cerute ({mats?.length || 0})</div>
          <button style={{ ...S.btnS, padding:'5px 12px', fontSize:12 }} onClick={addMat}>＋ material</button>
        </div>
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12, minWidth:640 }}>
            <thead><tr style={{ color:G.muted, fontSize:10.5, textTransform:'uppercase', textAlign:'left' }}>
              {['Denumire', 'UM', 'Cantitate', 'Specificații', ''].map((h, i) => <th key={i} style={{ padding:'5px 8px', borderBottom:`1px solid ${G.border}` }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {(mats || []).map(m => (
                <tr key={m.id} style={{ borderBottom:`1px solid ${G.border2}` }}>
                  <td style={{ padding:'4px 8px', minWidth:220 }}><input style={S.input} value={m.denumire || ''} onChange={e => setMat(m.id, 'denumire', e.target.value)} onBlur={() => saveMat(m)} /></td>
                  <td style={{ padding:'4px 8px', width:76 }}><input style={S.input} value={m.um || ''} onChange={e => setMat(m.id, 'um', e.target.value)} onBlur={() => saveMat(m)} placeholder="m / buc" /></td>
                  <td style={{ padding:'4px 8px', width:92 }}><input style={S.input} type="number" value={m.cantitate ?? ''} onChange={e => setMat(m.id, 'cantitate', e.target.value)} onBlur={() => saveMat(m)} /></td>
                  <td style={{ padding:'4px 8px', minWidth:170 }}><input style={S.input} value={m.specificatii || ''} onChange={e => setMat(m.id, 'specificatii', e.target.value)} onBlur={() => saveMat(m)} placeholder="SDR11, PE100..." /></td>
                  <td style={{ padding:'4px 4px' }}><button onClick={() => delMat(m)} style={{ ...S.btnS, padding:'2px 8px', fontSize:11, color:G.red, borderColor:G.red + '66' }}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* oferte primite */}
      <div style={{ ...S.card, padding:14, marginBottom:12 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8, flexWrap:'wrap', gap:8 }}>
          <div style={{ fontWeight:800, fontSize:13.5 }}>📥 Oferte primite ({oferte?.length || 0})</div>
          <label style={{ ...S.btnS, padding:'5px 12px', fontSize:12, cursor:'pointer' }}>
            ＋ PDF ofertă furnizor
            <input type="file" accept="application/pdf,.pdf" style={{ display:'none' }} onChange={e => { addOferta(e.target.files?.[0]); e.target.value = '' }} />
          </label>
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
          {(oferte || []).map(o => (
            <div key={o.id} style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap', padding:'7px 10px', background:G.bg, borderRadius:7, border:`1px solid ${G.border2}` }}>
              <span style={{ fontWeight:700, fontSize:12.5 }}>{o.furnizor}</span>
              {o.importat_ai ? <span style={{ fontSize:11, color:G.green, fontWeight:700 }}>🤖 importată</span> : <span style={{ fontSize:11, color:G.orange }}>neimportată</span>}
              {o.data_oferta && <span style={{ fontSize:11, color:G.dim }}>{new Date(o.data_oferta).toLocaleDateString('ro-RO')}</span>}
              {o.valabilitate && <span style={{ fontSize:11, color:G.dim }}>valabilă: {o.valabilitate}</span>}
              {o.conditii && <span style={{ fontSize:11, color:G.muted }} title={o.conditii}>📋 {o.conditii.slice(0, 60)}{o.conditii.length > 60 ? '…' : ''}</span>}
              <span style={{ marginLeft:'auto', display:'flex', gap:6 }}>
                <button style={{ ...S.btnS, padding:'3px 10px', fontSize:11.5 }} onClick={() => importaAI(o)} disabled={!!busy}>🤖 {o.importat_ai ? 'recitește' : 'citește cu AI'}</button>
                <button style={{ ...S.btnS, padding:'3px 8px', fontSize:11, color:G.red, borderColor:G.red + '66' }} onClick={() => delOferta(o)}>✕</button>
              </span>
            </div>
          ))}
          {!oferte?.length && <div style={{ fontSize:12, color:G.dim, padding:6 }}>Când vin ofertele pe mail, salvează PDF-urile și adaugă-le aici.</div>}
        </div>
      </div>

      {/* comparativ */}
      {(oferte?.length || 0) > 0 && (mats?.length || 0) > 0 && (
        <div style={{ ...S.card, padding:14 }}>
          <div style={{ fontWeight:800, fontSize:13.5, marginBottom:4 }}>⚖️ Comparativ (lei fără TVA) — click pe preț = alege-l pentru deviz</div>
          <div style={{ fontSize:11, color:G.dim, marginBottom:8 }}>Verde = cel mai mic preț. ✔ = ales. Prețurile vin din citirea AI — verifică-le pe cele importante în PDF.</div>
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12, minWidth:560 }}>
              <thead><tr style={{ color:G.muted, fontSize:10.5, textTransform:'uppercase', textAlign:'left' }}>
                <th style={{ padding:'6px 8px', borderBottom:`1px solid ${G.border}` }}>Material</th>
                {(oferte || []).map(o => <th key={o.id} style={{ padding:'6px 8px', borderBottom:`1px solid ${G.border}`, whiteSpace:'nowrap' }}>{o.furnizor}</th>)}
              </tr></thead>
              <tbody>
                {(mats || []).map(m => {
                  const mn = minPret(m.id)
                  return (
                    <tr key={m.id} style={{ borderBottom:`1px solid ${G.border2}` }}>
                      <td style={{ padding:'6px 8px', fontWeight:600, maxWidth:280 }}>{m.denumire}<span style={{ color:G.dim, fontWeight:400 }}>{m.um ? ` [${m.um}]` : ''}</span></td>
                      {(oferte || []).map(o => {
                        const p = pretPt(m.id, o.id)
                        if (!p || p.pret == null) return <td key={o.id} style={{ padding:'6px 8px', color:G.dim }} title={p?.note || ''}>{p?.note === 'neofertat' ? '—' : '?'}</td>
                        const eMin = mn != null && Number(p.pret) === mn
                        return (
                          <td key={o.id} style={{ padding:'6px 8px' }} title={(p.denumire_furnizor || '') + (p.note ? ' · ' + p.note : '')}>
                            <button onClick={() => alege(p)} style={{ background: p.ales ? G.green + '22' : 'transparent', color: eMin ? G.green : G.text,
                              border:`1px solid ${p.ales ? G.green : G.border2}`, borderRadius:6, padding:'3px 9px', cursor:'pointer', fontWeight: eMin ? 800 : 500, fontSize:12 }}>
                              {p.ales ? '✔ ' : ''}{fmtLei(p.pret)}{p.um && m.um && p.um !== m.um ? ` /${p.um}` : ''}
                            </button>
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
