// ════════════════════════════════════════════════════════════════
// GraficLucrare.jsx — Graficul de execuție (Gantt) al unei lucrări
// Rută: /grafic/:tip/:id  (tip = 'proiect' → executie_proiecte, 'licitatie' → ofertare_licitatii)
// Datele: tabela grafic_activitati. Drumul critic (CPM) se calculează aici,
// client-side: forward/backward pass pe dependențe FS/SS cu lag, în zile
// calendaristice (graficele de ofertă sunt în zile calendaristice; calendarul
// de lucru vine în v2). Export PDF: html2canvas + jspdf (pattern existent).
// Primul caz real: proiectul 25 — DISTRIBUTIE GAZE HOGHILAG (seed din
// propunerea tehnică depusă, formular nr. 8, pag. 54-57).
// ════════════════════════════════════════════════════════════════
import { useState, useEffect, useMemo, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from './lib/supabase.js'

const G = {
  bg:'#0D1117', surface:'#161B22', card:'#1C2128', border:'#30363D', border2:'#21262D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  accent:'#3FB6E2', green:'#3FB950', blue:'#58A6FF', orange:'#F0883E',
  yellow:'#E3B341', red:'#F85149', purple:'#A371F7', teal:'#2DD4BF',
}
const S = {
  input: { boxSizing:'border-box', background:G.bg, border:`1px solid ${G.border2}`, borderRadius:6, padding:'5px 8px', color:G.text, fontSize:12, outline:'none', width:'100%' },
  btnP: { padding:'8px 16px', background:G.accent, color:'#0D1117', border:'none', borderRadius:7, cursor:'pointer', fontSize:13, fontWeight:700 },
  btnS: { padding:'8px 16px', background:G.surface, color:G.text, border:`1px solid ${G.border2}`, borderRadius:7, cursor:'pointer', fontSize:13 },
  card: { background:G.card, border:`1px solid ${G.border}`, borderRadius:10 },
}

// „1FS, 3SS+10" ↔ [{id:1,tip:'FS',lag:0},{id:3,tip:'SS',lag:10}]
const predToText = (p) => (p || []).map(x => `${x.id}${x.tip || 'FS'}${x.lag ? '+' + x.lag : ''}`).join(', ')
const textToPred = (t) => (t || '').split(/[,;]+/).map(s => s.trim()).filter(Boolean).map(s => {
  const m = s.match(/^(\d+)\s*(FS|SS)?\s*(?:\+\s*(\d+))?$/i)
  return m ? { id: Number(m[1]), tip: (m[2] || 'FS').toUpperCase(), lag: Number(m[3] || 0) } : null
}).filter(Boolean)

// CPM în zile: ES/EF forward, LS/LF backward, float, critic. Ciclurile se
// opresc prin plafonul de iterații (graficul rămâne calculabil, nu îngheață UI-ul).
function calcCPM(rows) {
  const byId = {}; rows.forEach(r => { byId[r.id] = r })
  const es = {}, ef = {}
  const done = new Set()
  let pass = 0
  while (done.size < rows.length && pass < rows.length + 5) {
    pass++
    for (const r of rows) {
      if (done.has(r.id)) continue
      const preds = (r.predecesori || []).filter(p => byId[p.id])
      if (preds.some(p => !done.has(p.id))) continue
      let start = 0
      for (const p of preds) {
        const cand = p.tip === 'SS' ? es[p.id] + (p.lag || 0) : ef[p.id] + (p.lag || 0)
        if (cand > start) start = cand
      }
      es[r.id] = start
      ef[r.id] = start + (r.durata_zile || 0)
      done.add(r.id)
    }
  }
  // rândurile prinse în ciclu rămân la 0 — le marcăm
  const inCiclu = new Set(rows.filter(r => !done.has(r.id)).map(r => { es[r.id] = 0; ef[r.id] = r.durata_zile || 0; return r.id }))

  const proiectEF = Math.max(0, ...rows.map(r => ef[r.id] || 0))
  const ls = {}, lf = {}
  rows.forEach(r => { lf[r.id] = proiectEF; ls[r.id] = proiectEF - (r.durata_zile || 0) })
  // backward: succesorii impun LF
  for (let i = 0; i < rows.length + 5; i++) {
    let schimbat = false
    for (const r of rows) {
      for (const p of (r.predecesori || [])) {
        if (!byId[p.id]) continue
        const limita = p.tip === 'SS'
          ? ls[r.id] - (p.lag || 0) + (byId[p.id].durata_zile || 0)   // SS constrânge startul predecesorului
          : ls[r.id] - (p.lag || 0)
        if (limita < lf[p.id]) { lf[p.id] = limita; ls[p.id] = limita - (byId[p.id].durata_zile || 0); schimbat = true }
      }
    }
    if (!schimbat) break
  }
  const rez = {}
  rows.forEach(r => {
    const fl = (ls[r.id] ?? 0) - (es[r.id] ?? 0)
    rez[r.id] = { es: es[r.id] ?? 0, ef: ef[r.id] ?? 0, float: fl, critic: fl <= 0, ciclu: inCiclu.has(r.id) }
  })
  return { rez, total: proiectEF }
}

const fmtData = (start, plusZile) => {
  if (!start) return ''
  const d = new Date(start + 'T00:00:00'); d.setDate(d.getDate() + plusZile)
  return d.toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit' })
}

export default function GraficLucrare({ profile }) {
  const { tip, id } = useParams()
  const eProiect = tip === 'proiect'
  const [lucrare, setLucrare] = useState(null)
  const [rows, setRows] = useState(null)
  const [dataStart, setDataStart] = useState('')
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(null)
  const [toast, setToast] = useState(null)
  const ganttRef = useRef(null)

  const showToast = (msg, tip2 = 'ok') => { setToast({ msg, tip: tip2 }); setTimeout(() => setToast(null), 4000) }

  const load = async () => {
    const col = eProiect ? 'proiect_id' : 'licitatie_id'
    const [{ data: acts }, { data: luc }] = await Promise.all([
      supabase.from('grafic_activitati').select('*').eq(col, Number(id)).order('ordine'),
      eProiect
        ? supabase.from('executie_proiecte').select('id, nume, data_start, data_termen').eq('id', Number(id)).single()
        : supabase.from('ofertare_licitatii').select('id, nr_anunt, obiect, termen_depunere').eq('id', Number(id)).single(),
    ])
    setRows((acts || []).map(r => ({ ...r, _predText: predToText(r.predecesori) })))
    setLucrare(luc)
    setDataStart((eProiect ? luc?.data_start : null) || new Date().toISOString().slice(0, 10))
  }
  useEffect(() => { load() }, [tip, id])

  const { rez, total } = useMemo(() => calcCPM(rows || []), [rows])

  const set = (rid, k, v) => {
    setRows(rs => rs.map(r => r.id === rid ? { ...r, [k]: v, _mod: true } : r))
    setDirty(true)
  }
  const setPred = (rid, text) => {
    setRows(rs => rs.map(r => r.id === rid ? { ...r, _predText: text, predecesori: textToPred(text), _mod: true } : r))
    setDirty(true)
  }
  const adauga = () => {
    const tempId = -Date.now()
    const ord = (rows?.length ? Math.max(...rows.map(r => r.ordine)) : 0) + 1
    setRows(rs => [...(rs || []), { id: tempId, [eProiect ? 'proiect_id' : 'licitatie_id']: Number(id), denumire: '', durata_zile: 1, jalon: false, predecesori: [], _predText: '', resurse: '', nivel: 0, ordine: ord, note: '', _nou: true }])
    setDirty(true)
  }
  const sterge = async (r) => {
    if (r._nou) { setRows(rs => rs.filter(x => x.id !== r.id)); return }
    if (!window.confirm(`Ștergi „${r.denumire}"? (dependențele către ea rămân de curățat manual)`)) return
    const { error } = await supabase.from('grafic_activitati').delete().eq('id', r.id)
    if (error) { showToast('Eroare: ' + error.message, 'err'); return }
    setRows(rs => rs.filter(x => x.id !== r.id))
  }
  const muta = (r, dir) => {
    const idx = rows.findIndex(x => x.id === r.id)
    const j = idx + dir
    if (j < 0 || j >= rows.length) return
    const nou = [...rows]
    ;[nou[idx], nou[j]] = [nou[j], nou[idx]]
    setRows(nou.map((x, i) => ({ ...x, ordine: i + 1, _mod: true })))
    setDirty(true)
  }

  const salveaza = async () => {
    setBusy('Se salvează...')
    for (const r of rows) {
      const payload = {
        denumire: (r.denumire || '').trim() || 'Activitate',
        durata_zile: Math.max(0, Number(r.durata_zile) || 0),
        jalon: !!r.jalon, predecesori: r.predecesori || [],
        resurse: (r.resurse || '').trim() || null, nivel: r.nivel || 0,
        ordine: r.ordine, note: (r.note || '').trim() || null, updated_at: new Date().toISOString(),
      }
      if (r._nou) {
        const { data: ins, error } = await supabase.from('grafic_activitati')
          .insert({ ...payload, [eProiect ? 'proiect_id' : 'licitatie_id']: Number(id) }).select('id').single()
        if (error) { showToast('Eroare la rândul nou: ' + error.message, 'err'); setBusy(null); return }
        // predecesorii cu id temporar nu se pot referi — rămân cum au fost tastați pe id-uri reale
        r.id = ins.id
      } else if (r._mod) {
        const { error } = await supabase.from('grafic_activitati').update(payload).eq('id', r.id)
        if (error) { showToast('Eroare la salvare: ' + error.message, 'err'); setBusy(null); return }
      }
    }
    setBusy(null); setDirty(false)
    showToast('Grafic salvat.')
    await load()
  }

  const exportPdf = async () => {
    setBusy('Se generează PDF-ul...')
    try {
      const { default: html2canvas } = await import('html2canvas')
      const { default: jsPDF } = await import('jspdf')
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
      const canvas = await html2canvas(ganttRef.current, { backgroundColor: '#FFFFFF', scale: 2 })
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' })
      const pw = pdf.internal.pageSize.getWidth() - 20
      const ph = (canvas.height * pw) / canvas.width
      pdf.setFontSize(13)
      pdf.text(`Grafic de execuție — ${eProiect ? (lucrare?.nume || '') : (lucrare?.nr_anunt || '')}`, 10, 10)
      pdf.setFontSize(9)
      pdf.text(`Start: ${dataStart} · Durata totală: ${total} zile calendaristice · Generat din PontajPRO`, 10, 16)
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 10, 20, pw, Math.min(ph, pdf.internal.pageSize.getHeight() - 30))
      pdf.save(`grafic_${eProiect ? 'proiect' : 'licitatie'}_${id}.pdf`)
      showToast('PDF generat.')
    } catch (e) { showToast('Eroare la PDF: ' + (e?.message || e), 'err') }
    setBusy(null)
  }

  // ── Gantt: geometrie ──
  const ZI_PX = total > 200 ? 4 : total > 120 ? 6 : 9
  const ROW_H = 26
  const NAME_W = 340
  const ganttW = NAME_W + Math.max(total, 10) * ZI_PX + 40
  const saptamani = useMemo(() => {
    const out = []
    for (let z = 0; z <= total + 6; z += 7) out.push(z)
    return out
  }, [total])

  if (rows === null) return <div style={{ background:G.bg, minHeight:'100vh', color:G.muted, padding:40 }}>Se încarcă graficul...</div>

  return (
    <div style={{ background:G.bg, minHeight:'100vh', color:G.text, padding:'20px 24px', fontFamily:'system-ui, sans-serif' }}>
      {toast && (
        <div style={{ position:'fixed', top:16, right:20, zIndex:2000, padding:'11px 18px', borderRadius:9, fontSize:13, fontWeight:600,
          background: toast.tip === 'err' ? G.red : G.green, color:'#0D1117' }}>{toast.msg}</div>
      )}

      <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:6, flexWrap:'wrap' }}>
        <Link to={eProiect ? '/executie' : '/ofertare'} style={{ color:G.muted, textDecoration:'none', fontSize:13 }}>← înapoi</Link>
        <div style={{ fontSize:19, fontWeight:800 }}>📅 Grafic de execuție</div>
        <span style={{ color:G.accent, fontWeight:700, fontSize:14 }}>{eProiect ? lucrare?.nume : `${lucrare?.nr_anunt || ''} · ${(lucrare?.obiect || '').slice(0, 60)}`}</span>
        <span style={{ marginLeft:'auto', fontSize:12.5, color:G.muted }}>
          Durata totală: <b style={{ color: G.text }}>{total} zile</b> · start {fmtData(dataStart, 0)} → final {fmtData(dataStart, total)}
        </span>
      </div>
      <div style={{ fontSize:11.5, color:G.dim, marginBottom:14 }}>
        Zile calendaristice de la start (ziua 0). Predecesori: „3FS" = începe după activitatea 3; „7SS+10" = începe la 10 zile după startul activității 7. <b style={{ color:G.red }}>Roșu = drumul critic</b> — orice întârziere acolo întârzie finalul.
      </div>

      <div style={{ display:'flex', gap:10, marginBottom:14, flexWrap:'wrap', alignItems:'center' }}>
        <label style={{ fontSize:12, color:G.muted }}>Data de start:{' '}
          <input type="date" value={dataStart} onChange={e => setDataStart(e.target.value)} style={{ ...S.input, width:140, display:'inline-block' }} /></label>
        <button style={S.btnS} onClick={adauga}>＋ Activitate</button>
        <button style={{ ...S.btnP, opacity: dirty && !busy ? 1 : .5 }} disabled={!dirty || !!busy} onClick={salveaza}>💾 Salvează graficul</button>
        <button style={S.btnS} onClick={exportPdf} disabled={!!busy}>📄 Export PDF</button>
        {busy && <span style={{ fontSize:12.5, color:G.accent, fontWeight:700 }}>{busy}</span>}
      </div>

      {/* ── Tabelul + Gantt-ul, aliniate pe rânduri ── */}
      <div ref={ganttRef} style={{ ...S.card, padding:14, overflowX:'auto' }}>
        <svg width={ganttW} height={(rows.length + 1) * ROW_H + 30} style={{ display:'block' }}>
          {/* grila săptămânală */}
          {saptamani.map(z => (
            <g key={z}>
              <line x1={NAME_W + z * ZI_PX} y1={0} x2={NAME_W + z * ZI_PX} y2={(rows.length + 1) * ROW_H} stroke={G.border2} strokeWidth={1} />
              <text x={NAME_W + z * ZI_PX + 2} y={12} fill={G.dim} fontSize={9}>{fmtData(dataStart, z)}</text>
            </g>
          ))}
          {rows.map((r, i) => {
            const c = rez[r.id] || { es: 0, ef: 0, critic: false }
            const y = (i + 1) * ROW_H
            const x = NAME_W + c.es * ZI_PX
            const w = Math.max((r.durata_zile || 0) * ZI_PX, 2)
            const culoare = r.jalon ? G.yellow : c.critic ? G.red : G.blue
            return (
              <g key={r.id}>
                {i % 2 === 0 && <rect x={0} y={y} width={ganttW} height={ROW_H} fill={G.surface} opacity={0.35} />}
                <text x={6} y={y + 17} fill={c.critic && !r.jalon ? G.red : G.text} fontSize={11} fontWeight={c.critic ? 700 : 400}>
                  {String(r.ordine).padStart(2, ' ')}. {(r.denumire || '').slice(0, 48)}
                </text>
                {r.jalon ? (
                  <path d={`M ${x} ${y + 13} l 7 -7 l 7 7 l -7 7 z`} fill={G.yellow} stroke={G.orange} />
                ) : (
                  <rect x={x} y={y + 6} width={w} height={14} rx={3} fill={culoare} opacity={0.9} />
                )}
                <text x={x + (r.jalon ? 18 : w + 5)} y={y + 17} fill={G.dim} fontSize={9}>
                  {c.es}–{c.ef}z{c.ciclu ? ' ⚠ciclu' : ''}
                </text>
              </g>
            )
          })}
        </svg>
      </div>

      {/* ── Tabelul de editare ── */}
      <div style={{ ...S.card, marginTop:14, padding:14, overflowX:'auto' }}>
        <table style={{ borderCollapse:'collapse', width:'100%', minWidth:900, fontSize:12 }}>
          <thead>
            <tr style={{ color:G.muted, textAlign:'left' }}>
              {['#','Activitate','Zile','Jalon','Predecesori','Resurse','Start–Final','Rezervă','',''].map((h, i) => (
                <th key={i} style={{ padding:'6px 8px', borderBottom:`1px solid ${G.border}`, fontSize:11, fontWeight:700 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const c = rez[r.id] || {}
              return (
                <tr key={r.id} style={{ borderBottom:`1px solid ${G.border2}` }}>
                  <td style={{ padding:'4px 8px', color: c.critic ? G.red : G.dim, fontWeight:700, whiteSpace:'nowrap' }}>{r.ordine}</td>
                  <td style={{ padding:'4px 8px', minWidth:260 }}>
                    <input style={S.input} value={r.denumire || ''} onChange={e => set(r.id, 'denumire', e.target.value)} title={r.note || ''} /></td>
                  <td style={{ padding:'4px 8px', width:64 }}>
                    <input style={S.input} type="number" min="0" value={r.durata_zile} onChange={e => set(r.id, 'durata_zile', e.target.value)} /></td>
                  <td style={{ padding:'4px 8px', textAlign:'center' }}>
                    <input type="checkbox" checked={!!r.jalon} onChange={e => set(r.id, 'jalon', e.target.checked)} style={{ accentColor:G.yellow }} /></td>
                  <td style={{ padding:'4px 8px', width:150 }}>
                    <input style={S.input} value={r._predText} onChange={e => setPred(r.id, e.target.value)} placeholder="ex: 3FS, 7SS+10" /></td>
                  <td style={{ padding:'4px 8px', minWidth:150 }}>
                    <input style={S.input} value={r.resurse || ''} onChange={e => set(r.id, 'resurse', e.target.value)} /></td>
                  <td style={{ padding:'4px 8px', color:G.muted, whiteSpace:'nowrap' }}>{fmtData(dataStart, c.es || 0)} – {fmtData(dataStart, c.ef || 0)}</td>
                  <td style={{ padding:'4px 8px', color: c.critic ? G.red : G.green, fontWeight:700 }}>{c.critic ? 'CRITIC' : `${c.float}z`}</td>
                  <td style={{ padding:'4px 2px', whiteSpace:'nowrap' }}>
                    <button title="Sus" onClick={() => muta(r, -1)} style={{ ...S.btnS, padding:'2px 7px', fontSize:11 }}>↑</button>{' '}
                    <button title="Jos" onClick={() => muta(r, 1)} style={{ ...S.btnS, padding:'2px 7px', fontSize:11 }}>↓</button></td>
                  <td style={{ padding:'4px 2px' }}>
                    <button title="Șterge" onClick={() => sterge(r)} style={{ ...S.btnS, padding:'2px 7px', fontSize:11, color:G.red, borderColor:G.red + '66' }}>✕</button></td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {!rows.length && <div style={{ color:G.dim, fontSize:13, padding:20, textAlign:'center' }}>Niciun rând — „＋ Activitate" sau (în curând) „🤖 Propune graficul".</div>}
      </div>
    </div>
  )
}
