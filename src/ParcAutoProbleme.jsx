// ════════════════════════════════════════════════════════════════════════════
// MODULUL LOGISTICĂ — Tab Parc Auto: Probleme cu istoric (13.08.2026)
// ════════════════════════════════════════════════════════════════════════════
// Înlocuiește raportul zilnic retastat pe WhatsApp: fiecare problemă = un record
// per vehicul (logistica_probleme) + jurnal de actualizări (logistica_probleme_jurnal).
// „Raportul de ședință" e generat din problemele deschise (v_parc_auto_raport):
// zile de staționare, ce/pe cine așteptăm, ultima actualizare — verificabil oricând.
// ════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from './lib/supabase.js'

const G = {
  bg:'#0D1117', surface:'#161B22', border:'#21262D', border2:'#30363D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  blue:'#58A6FF', green:'#3FB950', red:'#F85149', yellow:'#D29922',
  purple:'#BC8CFF', orange:'#F0883E', logistica:'#E3B341',
}
const S = {
  card: { background:G.surface, border:`1px solid ${G.border}`, borderRadius:12 },
  input: { background:G.bg, border:`1px solid ${G.border2}`, color:G.text, borderRadius:8, padding:'8px 12px', fontFamily:'inherit', fontSize:14, outline:'none', width:'100%' },
  btnP: { background:'#1F6FEB', color:'white', border:'none', borderRadius:8, padding:'9px 18px', fontFamily:'inherit', fontSize:14, fontWeight:700, cursor:'pointer' },
  btnS: { background:G.surface, color:G.text, border:`1px solid ${G.border}`, borderRadius:8, padding:'7px 14px', fontFamily:'inherit', fontSize:13, fontWeight:600, cursor:'pointer' },
}

const STATUSURI = {
  deschisa:        { label:'Deschisă',          color:G.red },
  in_lucru:        { label:'În lucru',          color:G.blue },
  asteapta_piese:  { label:'Așteaptă piese',    color:G.yellow },
  asteapta_service:{ label:'Așteaptă service',  color:G.orange },
  rezolvata:       { label:'Rezolvată',         color:G.green },
  anulata:         { label:'Anulată',           color:G.dim },
}
const SEVERITATI = {
  blocant: { label:'Blocant — nu funcționează', short:'Blocant', color:G.red },
  major:   { label:'Major — funcționează cu limitări', short:'Major', color:G.yellow },
  minor:   { label:'Minor', short:'Minor', color:G.muted },
}

const fmtD = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('ro-RO') : '—'
const azi = () => {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone:'Europe/Bucharest' }).format(new Date())
  return p // YYYY-MM-DD
}

function Chip({ text, color }) {
  return <span style={{ padding:'2px 8px', borderRadius:10, fontSize:11, fontWeight:700, background:color+'22', color, whiteSpace:'nowrap' }}>{text}</span>
}

function numeActiv(p) {
  const bits = [p.marca, p.model].filter(Boolean).join(' ')
  const idf = p.nr_inmatriculare || p.cod_intern
  return idf ? `${bits} · ${idf}` : bits || `Activ #${p.activ_id}`
}

export default function ParcAutoProbleme({ active = [], canEdit = false, profile, showToast }) {
  const [sub, setSub] = useState('deschise')      // deschise | raport | rezolvate
  const [rows, setRows] = useState([])            // v_parc_auto_raport (deschise)
  const [rezolvate, setRezolvate] = useState([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [fSev, setFSev] = useState('')
  const [fStatus, setFStatus] = useState('')
  const [expand, setExpand] = useState(null)      // problema_id expandat
  const [jurnal, setJurnal] = useState({})        // problema_id -> intrări
  const [modalNoua, setModalNoua] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase.from('v_parc_auto_raport').select('*')
      .order('severitate').order('zile_deschisa', { ascending:false })
    if (error) showToast?.('Eroare la încărcare probleme: ' + error.message, 'error')
    setRows(data || [])
    setLoading(false)
  }, [showToast])

  const loadRezolvate = useCallback(async () => {
    const { data } = await supabase.from('logistica_probleme').select('*')
      .in('status', ['rezolvata','anulata']).order('data_rezolvare', { ascending:false }).limit(200)
    setRezolvate(data || [])
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { if (sub === 'rezolvate') loadRezolvate() }, [sub, loadRezolvate])

  const loadJurnal = useCallback(async (pid) => {
    const { data } = await supabase.from('logistica_probleme_jurnal').select('*')
      .eq('problema_id', pid).order('data', { ascending:false }).order('id', { ascending:false })
    setJurnal(j => ({ ...j, [pid]: data || [] }))
  }, [])

  const filtrate = useMemo(() => {
    const nq = q.trim().toLowerCase()
    return rows.filter(r => {
      if (fSev && r.severitate !== fSev) return false
      if (fStatus && r.status !== fStatus) return false
      if (!nq) return true
      return [r.marca, r.model, r.nr_inmatriculare, r.cod_intern, r.titlu, r.descriere, r.locatie, r.responsabil]
        .filter(Boolean).join(' ').toLowerCase().includes(nq)
    })
  }, [rows, q, fSev, fStatus])

  // KPI pentru ședință
  const kpi = useMemo(() => ({
    total: rows.length,
    blocante: rows.filter(r => r.severitate === 'blocant').length,
    peste30: rows.filter(r => r.zile_deschisa > 30).length,
    faraUpdate7: rows.filter(r => !r.data_ultima_actualizare || (new Date(azi()) - new Date(r.data_ultima_actualizare)) / 86400000 > 7).length,
    costEstimat: rows.reduce((s, r) => s + (Number(r.cost_estimat) || 0), 0),
  }), [rows])

  async function adaugaJurnal(p, text, statusNou) {
    if (!text?.trim() && !statusNou) return
    const ins = { problema_id: p.id, text: text?.trim() || `Status: ${STATUSURI[statusNou]?.label}`, status_nou: statusNou || null }
    const { error } = await supabase.from('logistica_probleme_jurnal').insert(ins)
    if (error) { showToast?.('Eroare jurnal: ' + error.message, 'error'); return }
    if (statusNou) {
      const upd = { status: statusNou }
      if (statusNou === 'rezolvata' || statusNou === 'anulata') { upd.data_rezolvare = azi(); upd.rezolvare = text?.trim() || null }
      const { error: e2 } = await supabase.from('logistica_probleme').update(upd).eq('id', p.id)
      if (e2) { showToast?.('Eroare status: ' + e2.message, 'error'); return }
    }
    showToast?.('Salvat ✓', 'success')
    loadJurnal(p.id); load()
  }

  // ─── Raport ședință: text copiabil (pt. WhatsApp / minută) ────────────────
  function textRaport() {
    const dat = new Date().toLocaleDateString('ro-RO', { timeZone:'Europe/Bucharest' })
    let t = `📍 RAPORT PARC AUTO & UTILAJE — ${dat}\n${rows.length} probleme deschise · ${kpi.blocante} blocante · ${kpi.peste30} mai vechi de 30 zile\n`
    const grupuri = {}
    rows.forEach(r => { const g = r.categorie_tip || 'Altele'; (grupuri[g] = grupuri[g] || []).push(r) })
    Object.entries(grupuri).forEach(([g, list]) => {
      t += `\n══ ${g.toUpperCase()} (${list.length}) ══\n`
      list.forEach(r => {
        t += `\n• ${numeActiv(r)} — ${r.titlu} [${STATUSURI[r.status]?.label}, ${r.zile_deschisa} zile]`
        if (r.asteapta) t += `\n  Așteptăm: ${r.asteapta}`
        if (r.ultima_actualizare) t += `\n  Ultima info (${fmtD(r.data_ultima_actualizare)}): ${r.ultima_actualizare}`
      })
      t += '\n'
    })
    return t
  }

  const sBtn = k => ({ ...S.btnS, ...(sub === k ? { borderColor:G.logistica, color:G.logistica, fontWeight:700 } : {}) })

  return (
    <div>
      {/* KPI */}
      <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginBottom:14 }}>
        {[['Probleme deschise', kpi.total, G.text], ['Blocante', kpi.blocante, G.red], ['> 30 zile', kpi.peste30, G.yellow], ['Fără update > 7 zile', kpi.faraUpdate7, G.orange], ['Cost estimat', kpi.costEstimat ? kpi.costEstimat.toLocaleString('ro-RO') + ' lei' : '—', G.blue]].map(([l, v, c]) => (
          <div key={l} style={{ ...S.card, padding:'10px 16px', minWidth:130 }}>
            <div style={{ fontSize:11, color:G.muted }}>{l}</div>
            <div style={{ fontSize:20, fontWeight:800, color:c }}>{v}</div>
          </div>
        ))}
      </div>

      <div style={{ display:'flex', gap:8, marginBottom:12, flexWrap:'wrap', alignItems:'center' }}>
        <button style={sBtn('deschise')} onClick={() => setSub('deschise')}>🔴 Deschise ({rows.length})</button>
        <button style={sBtn('raport')} onClick={() => setSub('raport')}>📋 Raport ședință</button>
        <button style={sBtn('rezolvate')} onClick={() => setSub('rezolvate')}>✅ Rezolvate</button>
        <div style={{ flex:1 }} />
        {canEdit && <button style={S.btnP} onClick={() => setModalNoua(true)}>+ Problemă nouă</button>}
      </div>

      {sub !== 'rezolvate' && (
        <div style={{ display:'flex', gap:8, marginBottom:12, flexWrap:'wrap' }}>
          <input style={{ ...S.input, maxWidth:280 }} placeholder="Caută vehicul / problemă / persoană..." value={q} onChange={e => setQ(e.target.value)} />
          <select style={{ ...S.input, maxWidth:180 }} value={fSev} onChange={e => setFSev(e.target.value)}>
            <option value="">Toate severitățile</option>
            {Object.entries(SEVERITATI).map(([k, v]) => <option key={k} value={k}>{v.short}</option>)}
          </select>
          <select style={{ ...S.input, maxWidth:190 }} value={fStatus} onChange={e => setFStatus(e.target.value)}>
            <option value="">Toate statusurile</option>
            {Object.entries(STATUSURI).filter(([k]) => !['rezolvata','anulata'].includes(k)).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
      )}

      {loading && <div style={{ color:G.muted, padding:20 }}>Se încarcă...</div>}

      {/* ── LISTĂ DESCHISE ── */}
      {!loading && sub === 'deschise' && (
        filtrate.length === 0
          ? <div style={{ ...S.card, padding:30, textAlign:'center', color:G.muted }}>Nicio problemă deschisă {q || fSev || fStatus ? 'cu filtrele curente' : '— parcul e OK 🎉'}</div>
          : filtrate.map(r => (
            <div key={r.id} style={{ ...S.card, padding:14, marginBottom:10 }}>
              <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap', cursor:'pointer' }}
                   onClick={() => { const nx = expand === r.id ? null : r.id; setExpand(nx); if (nx && !jurnal[r.id]) loadJurnal(r.id) }}>
                <strong style={{ fontSize:15 }}>{numeActiv(r)}</strong>
                <Chip text={SEVERITATI[r.severitate]?.short || r.severitate} color={SEVERITATI[r.severitate]?.color || G.muted} />
                <Chip text={STATUSURI[r.status]?.label || r.status} color={STATUSURI[r.status]?.color || G.muted} />
                <Chip text={`${r.zile_deschisa} zile`} color={r.zile_deschisa > 30 ? G.red : r.zile_deschisa > 14 ? G.yellow : G.muted} />
                {r.locatie && <span style={{ fontSize:12, color:G.muted }}>📍 {r.locatie}</span>}
                <div style={{ flex:1 }} />
                <span style={{ color:G.dim, fontSize:12 }}>{expand === r.id ? '▲' : '▼'}</span>
              </div>
              <div style={{ marginTop:6, fontSize:14 }}>{r.titlu}</div>
              {r.asteapta && <div style={{ marginTop:4, fontSize:13, color:G.yellow }}>⏳ Așteptăm: {r.asteapta}</div>}
              {r.ultima_actualizare && expand !== r.id && (
                <div style={{ marginTop:4, fontSize:12, color:G.muted }}>Ultima info ({fmtD(r.data_ultima_actualizare)}): {r.ultima_actualizare.slice(0, 160)}{r.ultima_actualizare.length > 160 ? '…' : ''}</div>
              )}
              {expand === r.id && (
                <DetaliuProblema r={r} jurnal={jurnal[r.id]} canEdit={canEdit} onJurnal={adaugaJurnal} onReload={() => { loadJurnal(r.id); load() }} showToast={showToast} />
              )}
            </div>
          ))
      )}

      {/* ── RAPORT ȘEDINȚĂ ── */}
      {!loading && sub === 'raport' && (
        <div style={{ ...S.card, padding:18 }}>
          <div style={{ display:'flex', gap:10, marginBottom:14, alignItems:'center', flexWrap:'wrap' }}>
            <strong style={{ fontSize:16 }}>📋 Raport ședință — {new Date().toLocaleDateString('ro-RO', { timeZone:'Europe/Bucharest' })}</strong>
            <div style={{ flex:1 }} />
            <button style={S.btnS} onClick={() => { navigator.clipboard.writeText(textRaport()).then(() => showToast?.('Raport copiat — îl poți lipi pe WhatsApp', 'success')) }}>📄 Copiază ca text</button>
            <button style={S.btnS} onClick={() => window.print()}>🖨 Printează</button>
          </div>
          {Object.entries(filtrate.reduce((g, r) => { const k = r.categorie_tip || 'Altele'; (g[k] = g[k] || []).push(r); return g }, {})).map(([grup, list]) => (
            <div key={grup} style={{ marginBottom:18 }}>
              <div style={{ fontSize:13, fontWeight:800, color:G.logistica, borderBottom:`1px solid ${G.border2}`, paddingBottom:4, marginBottom:8 }}>{grup.toUpperCase()} ({list.length})</div>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
                <thead><tr style={{ color:G.muted, textAlign:'left' }}>
                  <th style={{ padding:'4px 8px' }}>Vehicul</th><th style={{ padding:'4px 8px' }}>Problema</th><th style={{ padding:'4px 8px' }}>Status</th><th style={{ padding:'4px 8px' }}>Zile</th><th style={{ padding:'4px 8px' }}>Așteptăm</th><th style={{ padding:'4px 8px' }}>Ultima info</th>
                </tr></thead>
                <tbody>{list.map(r => (
                  <tr key={r.id} style={{ borderTop:`1px solid ${G.border}` }}>
                    <td style={{ padding:'6px 8px', fontWeight:600, whiteSpace:'nowrap' }}>{numeActiv(r)}</td>
                    <td style={{ padding:'6px 8px' }}>{r.titlu}</td>
                    <td style={{ padding:'6px 8px' }}><Chip text={STATUSURI[r.status]?.label} color={STATUSURI[r.status]?.color} /></td>
                    <td style={{ padding:'6px 8px', fontWeight:700, color: r.zile_deschisa > 30 ? G.red : G.text }}>{r.zile_deschisa}</td>
                    <td style={{ padding:'6px 8px', color:G.yellow }}>{r.asteapta || '—'}</td>
                    <td style={{ padding:'6px 8px', color:G.muted, maxWidth:340 }}>{r.ultima_actualizare ? `${fmtD(r.data_ultima_actualizare)}: ${r.ultima_actualizare.slice(0, 140)}` : '—'}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {/* ── REZOLVATE ── */}
      {!loading && sub === 'rezolvate' && (
        rezolvate.length === 0
          ? <div style={{ ...S.card, padding:30, textAlign:'center', color:G.muted }}>Nimic rezolvat încă.</div>
          : rezolvate.map(p => {
            const a = active.find(x => x.id === p.activ_id)
            return (
              <div key={p.id} style={{ ...S.card, padding:12, marginBottom:8, opacity:.85 }}>
                <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
                  <strong>{a ? numeActiv({ ...a, activ_id: a.id }) : `Activ #${p.activ_id}`}</strong>
                  <Chip text={STATUSURI[p.status]?.label} color={STATUSURI[p.status]?.color} />
                  <span style={{ fontSize:12, color:G.muted }}>{fmtD(p.data_deschidere)} → {fmtD(p.data_rezolvare)}</span>
                </div>
                <div style={{ marginTop:4, fontSize:13 }}>{p.titlu}</div>
                {p.rezolvare && <div style={{ marginTop:2, fontSize:12, color:G.green }}>✓ {p.rezolvare}</div>}
              </div>
            )
          })
      )}

      {modalNoua && <ModalProblemaNoua active={active} onClose={() => setModalNoua(false)} onSaved={() => { setModalNoua(false); load() }} showToast={showToast} />}
    </div>
  )
}

// ─── Detaliu expandat: jurnal + acțiuni ──────────────────────────────────────
function DetaliuProblema({ r, jurnal, canEdit, onJurnal, onReload, showToast }) {
  const [text, setText] = useState('')
  const [statusNou, setStatusNou] = useState('')
  return (
    <div style={{ marginTop:12, borderTop:`1px solid ${G.border}`, paddingTop:12 }}>
      {r.descriere && <div style={{ fontSize:13, color:G.muted, marginBottom:8, whiteSpace:'pre-wrap' }}>{r.descriere}</div>}
      <div style={{ display:'flex', gap:16, flexWrap:'wrap', fontSize:12, color:G.muted, marginBottom:10 }}>
        <span>Deschisă: <b style={{ color:G.text }}>{fmtD(r.data_deschidere)}</b></span>
        {r.responsabil && <span>Responsabil: <b style={{ color:G.text }}>{r.responsabil}</b></span>}
        {r.cost_estimat != null && <span>Cost estimat: <b style={{ color:G.blue }}>{Number(r.cost_estimat).toLocaleString('ro-RO')} lei</b></span>}
        {r.tichet_id && <span>Tichet: <b style={{ color:G.purple }}>#{r.tichet_id}</b></span>}
      </div>

      {canEdit && (
        <div style={{ display:'flex', gap:8, marginBottom:12, flexWrap:'wrap' }}>
          <input style={{ ...S.input, flex:1, minWidth:220 }} placeholder="Actualizare (ce s-a întâmplat azi cu problema asta)..." value={text} onChange={e => setText(e.target.value)} />
          <select style={{ ...S.input, maxWidth:190 }} value={statusNou} onChange={e => setStatusNou(e.target.value)}>
            <option value="">— fără schimbare status —</option>
            {Object.entries(STATUSURI).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <button style={S.btnP} onClick={() => { onJurnal(r, text, statusNou || null); setText(''); setStatusNou('') }}>Salvează</button>
        </div>
      )}

      <div style={{ fontSize:12, fontWeight:700, color:G.muted, marginBottom:6 }}>ISTORIC</div>
      {!jurnal && <div style={{ color:G.dim, fontSize:13 }}>Se încarcă istoricul...</div>}
      {jurnal && jurnal.length === 0 && <div style={{ color:G.dim, fontSize:13 }}>Nicio intrare încă.</div>}
      {jurnal && jurnal.map(j => (
        <div key={j.id} style={{ display:'flex', gap:10, padding:'6px 0', borderTop:`1px dashed ${G.border}`, fontSize:13 }}>
          <span style={{ color:G.muted, whiteSpace:'nowrap' }}>{fmtD(j.data)}</span>
          <span style={{ flex:1, whiteSpace:'pre-wrap' }}>{j.text}</span>
          {j.status_nou && <Chip text={STATUSURI[j.status_nou]?.label || j.status_nou} color={STATUSURI[j.status_nou]?.color || G.muted} />}
        </div>
      ))}
    </div>
  )
}

// ─── Modal problemă nouă ─────────────────────────────────────────────────────
function ModalProblemaNoua({ active, onClose, onSaved, showToast }) {
  const [qa, setQa] = useState('')
  const [activId, setActivId] = useState(null)
  const [f, setF] = useState({ titlu:'', descriere:'', severitate:'major', locatie:'', responsabil:'', asteapta:'', cost_estimat:'' })
  const [saving, setSaving] = useState(false)

  const sugestii = useMemo(() => {
    const nq = qa.trim().toLowerCase()
    if (!nq) return []
    return active.filter(a => [a.marca, a.model, a.nr_inmatriculare, a.cod_intern].filter(Boolean).join(' ').toLowerCase().includes(nq)).slice(0, 8)
  }, [qa, active])

  const ales = active.find(a => a.id === activId)

  async function salveaza() {
    if (!activId) { showToast?.('Alege vehiculul/utilajul', 'error'); return }
    if (!f.titlu.trim()) { showToast?.('Scrie pe scurt problema', 'error'); return }
    setSaving(true)
    const { error } = await supabase.from('logistica_probleme').insert({
      activ_id: activId, titlu: f.titlu.trim(), descriere: f.descriere.trim() || null,
      severitate: f.severitate, locatie: f.locatie.trim() || null, responsabil: f.responsabil.trim() || null,
      asteapta: f.asteapta.trim() || null, cost_estimat: f.cost_estimat === '' ? null : Number(f.cost_estimat),
    })
    setSaving(false)
    if (error) { showToast?.('Eroare: ' + error.message, 'error'); return }
    showToast?.('Problemă înregistrată ✓', 'success')
    onSaved()
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'#000A', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000, padding:16 }} onClick={onClose}>
      <div style={{ ...S.card, padding:20, width:560, maxWidth:'100%', maxHeight:'90vh', overflowY:'auto' }} onClick={e => e.stopPropagation()}>
        <strong style={{ fontSize:16 }}>➕ Problemă nouă parc auto</strong>
        <div style={{ marginTop:14 }}>
          {!ales ? (
            <>
              <input style={S.input} autoFocus placeholder="Caută vehicul (marcă / model / plăcuță / cod TST)..." value={qa} onChange={e => setQa(e.target.value)} />
              {sugestii.map(a => (
                <div key={a.id} style={{ padding:'8px 10px', cursor:'pointer', borderBottom:`1px solid ${G.border}`, fontSize:14 }} onClick={() => setActivId(a.id)}>
                  {[a.marca, a.model].filter(Boolean).join(' ')} <span style={{ color:G.muted }}>{a.nr_inmatriculare || a.cod_intern || ''}</span>
                </div>
              ))}
            </>
          ) : (
            <div style={{ display:'flex', gap:8, alignItems:'center', padding:'8px 10px', background:G.bg, borderRadius:8 }}>
              <strong>{[ales.marca, ales.model].filter(Boolean).join(' ')} {ales.nr_inmatriculare || ales.cod_intern || ''}</strong>
              <button style={{ ...S.btnS, padding:'2px 8px', marginLeft:'auto' }} onClick={() => setActivId(null)}>schimbă</button>
            </div>
          )}
        </div>
        <div style={{ display:'grid', gap:10, marginTop:12 }}>
          <input style={S.input} placeholder="Problema, pe scurt (ex: Grupul față trebuie schimbat)" value={f.titlu} onChange={e => setF({ ...f, titlu:e.target.value })} />
          <textarea style={{ ...S.input, minHeight:70 }} placeholder="Detalii (opțional)" value={f.descriere} onChange={e => setF({ ...f, descriere:e.target.value })} />
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            <select style={{ ...S.input, flex:1, minWidth:170 }} value={f.severitate} onChange={e => setF({ ...f, severitate:e.target.value })}>
              {Object.entries(SEVERITATI).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <input style={{ ...S.input, flex:1, minWidth:140 }} placeholder="Unde e (service X / curte / șantier)" value={f.locatie} onChange={e => setF({ ...f, locatie:e.target.value })} />
          </div>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            <input style={{ ...S.input, flex:1, minWidth:140 }} placeholder="Responsabil" value={f.responsabil} onChange={e => setF({ ...f, responsabil:e.target.value })} />
            <input style={{ ...S.input, flex:1, minWidth:140 }} placeholder="Ce așteptăm (piesă / ofertă / constatare)" value={f.asteapta} onChange={e => setF({ ...f, asteapta:e.target.value })} />
            <input style={{ ...S.input, width:130 }} type="number" placeholder="Cost est. lei" value={f.cost_estimat} onChange={e => setF({ ...f, cost_estimat:e.target.value })} />
          </div>
        </div>
        <div style={{ display:'flex', gap:8, marginTop:16, justifyContent:'flex-end' }}>
          <button style={S.btnS} onClick={onClose}>Renunță</button>
          <button style={{ ...S.btnP, opacity: saving ? .6 : 1 }} disabled={saving} onClick={salveaza}>{saving ? 'Se salvează...' : 'Salvează problema'}</button>
        </div>
      </div>
    </div>
  )
}
