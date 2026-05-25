// ════════════════════════════════════════════════════════════════════════════
// OCRValidateBulkModal v2 — Validare OCR Vision SMART pe bonuri Rompetrol
// 25.05.2026 — Etapa 4.5 cu tipuri de dovezi + buton Accept 1-click
// ════════════════════════════════════════════════════════════════════════════
// NOU v2:
//   - 6 categorii statusuri (match / acceptat_vizual / discrepancy / invalid / ilizibil / no_poza)
//   - Display tip_dovada (bon_fiscal / display_pompa / combo_placuta / bon_alta_statie etc.)
//   - Buton ✓ Accept manual 1-click (fără motiv) pe rânduri cu discrepancy/invalid/ilizibil
//   - Buton ✗ Respinge inline cu confirmare
//   - Refresh state local cu noile statusuri după decisions
// ════════════════════════════════════════════════════════════════════════════
// Workflow:
//   1. Fetch alimentări din v_alimentari_pt_ocr (status='pending')
//   2. User confirmă rularea (vede cost estimat + durată)
//   3. Trigger Edge Function `analyze_bon_rompetrol` v2 (clasifică tip_dovada)
//   4. Progress bar real-time + buton stop
//   5. Summary final: 6 categorii + listă cu buton Accept/Respinge inline
// ════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback } from 'react'
import { supabase } from './lib/supabase.js'

const G = {
  bg:'#0D1117', surface:'#161B22', border:'#21262D', border2:'#30363D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  blue:'#58A6FF', green:'#3FB950', red:'#F85149', yellow:'#D29922',
  purple:'#BC8CFF', orange:'#F0883E', cyan:'#79C0FF', logistica:'#E3B341',
  greenDim:'#1A3A1A', redDim:'#3A1A1A', yellowDim:'#3A2A0A',
}

const BATCH_SIZE = 10
const COST_PER_BON = 0.003   // estimat USD/bon Haiku 4.5 v2 (prompt mai lung)

// 25.05.2026 v2: 6 categorii noi (înainte erau 5)
const STATUS_META = {
  match:           { icon: '✅', color: G.green,  label: 'Match' },
  acceptat_vizual: { icon: '👁️', color: G.cyan,   label: 'Dovadă vizuală' },
  discrepancy:     { icon: '⚠️', color: G.orange, label: 'Discrepanță' },
  invalid:         { icon: '🚨', color: G.red,    label: 'Bon invalid' },
  ilizibil:        { icon: '🌫️', color: G.muted,  label: 'Ilizibil' },
  no_poza:         { icon: '📭', color: G.dim,    label: 'Fără poză' },
  error:           { icon: '❌', color: G.red,    label: 'Eroare' },
  pending:         { icon: '⏳', color: G.blue,   label: 'Pending' },
  accepted_manual: { icon: '✓',  color: G.green,  label: 'Accept manual' },
  rejected_manual: { icon: '✗',  color: G.red,    label: 'Respins manual' },
}

// 25.05.2026 v2: cele 7 tipuri dovezi clasificate de Vision
const TIP_DOVADA_META = {
  bon_fiscal_rompetrol:    { icon: '🧾', color: G.green,  label: 'Bon fiscal' },
  display_pompa:           { icon: '📺', color: G.cyan,   label: 'Display pompă' },
  combo_placuta_plus_bon:  { icon: '📷', color: G.cyan,   label: 'Plăcuța + bon' },
  caption_explicit:        { icon: '💬', color: G.blue,   label: 'Caption explicit' },
  bon_alta_statie:         { icon: '🚨', color: G.red,    label: 'Altă stație!' },
  bon_alta_data:           { icon: '🚨', color: G.red,    label: 'Altă dată!' },
  bon_alt_produs:          { icon: '🚨', color: G.red,    label: 'Alt produs!' },
  ilizibil:                { icon: '🌫️', color: G.muted,  label: 'Ilizibil' },
}

const fmtDate = (iso) => {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

export default function OCRValidateBulkModal({ profile, showToast, onClose, onFinished }) {
  const [phase, setPhase] = useState('loading')
  const [alimentari, setAlimentari] = useState([])
  const [progress, setProgress] = useState({ done: 0, total: 0, current: null })
  const [allResults, setAllResults] = useState([])
  const [aggSummary, setAggSummary] = useState({ 
    match: 0, acceptat_vizual: 0, discrepancy: 0, invalid: 0, 
    ilizibil: 0, no_poza: 0, errors: 0 
  })
  const [totalCost, setTotalCost] = useState(0)
  const [shouldStop, setShouldStop] = useState(false)
  const [error, setError] = useState(null)
  // 25.05.2026 v2: tracking accept/respinge manual (set de id-uri deja decise)
  const [decidedIds, setDecidedIds] = useState({}) // { [id]: 'accepted_manual' | 'rejected_manual' }
  const [decidingId, setDecidingId] = useState(null) // loading per rând
  
  // ──────────────────── 1. FETCH LISTA AT MOUNT ────────────────────
  const loadAlim = useCallback(async () => {
    setPhase('loading')
    const { data, error: err } = await supabase
      .from('v_alimentari_pt_ocr')
      .select('*')
      .limit(500)
    
    if (err) {
      setError(err.message)
      setPhase('confirm')
      return
    }
    setAlimentari(data || [])
    setPhase('confirm')
  }, [])
  
  useEffect(() => { loadAlim() }, [loadAlim])
  
  // ──────────────────── 2. RULARE OCR (BATCHES) ────────────────────
  const runOCR = useCallback(async () => {
    if (alimentari.length === 0) return
    setPhase('running')
    setShouldStop(false)
    setProgress({ done: 0, total: alimentari.length, current: alimentari[0]?.id || null })
    
    const ids = alimentari.map(a => a.id)
    let agg = { match: 0, acceptat_vizual: 0, discrepancy: 0, invalid: 0, ilizibil: 0, no_poza: 0, errors: 0 }
    let allRes = []
    let totalCostUsd = 0
    
    try {
      for (let i = 0; i < ids.length; i += BATCH_SIZE) {
        if (shouldStop) break
        
        const batch = ids.slice(i, i + BATCH_SIZE)
        setProgress({ done: i, total: ids.length, current: batch[0] })
        
        const { data, error: invokeErr } = await supabase.functions.invoke('analyze_bon_rompetrol', {
          body: { alim_ids: batch }
        })
        
        if (invokeErr) {
          console.error('Batch OCR failed:', invokeErr)
          showToast(`Eroare batch ${i / BATCH_SIZE + 1}: ${invokeErr.message || 'unknown'}`, 'warn')
          batch.forEach(id => {
            allRes.push({ id, status: 'error', error: invokeErr.message })
            agg.errors++
          })
          continue
        }
        
        if (!data?.success) {
          console.error('Batch response:', data)
          batch.forEach(id => {
            allRes.push({ id, status: 'error', error: data?.error || 'unknown response' })
            agg.errors++
          })
          continue
        }
        
        const batchResults = data.results || []
        allRes = allRes.concat(batchResults)
        
        const s = data.summary || {}
        agg.match += s.match || 0
        agg.acceptat_vizual += s.acceptat_vizual || 0
        agg.discrepancy += s.discrepancy || 0
        agg.invalid += s.invalid || 0
        agg.ilizibil += s.ilizibil || 0
        agg.no_poza += s.no_poza || 0
        agg.errors += s.errors || 0
        
        totalCostUsd += data.meta?.cost_usd || 0
        
        setAggSummary({ ...agg })
        setAllResults([...allRes])
        setTotalCost(totalCostUsd)
        setProgress({ 
          done: Math.min(i + BATCH_SIZE, ids.length), 
          total: ids.length, 
          current: null 
        })
      }
      
      setPhase('done')
      const totalProcesat = agg.match + agg.acceptat_vizual + agg.discrepancy + agg.invalid 
                           + agg.ilizibil + agg.no_poza + agg.errors
      
      if (agg.errors > 0) {
        showToast(`OCR finalizat cu ${agg.errors} erori. Vezi detalii.`, 'warn')
      } else {
        const reviewNeeded = agg.discrepancy + agg.invalid + agg.ilizibil
        const autoOk = agg.match + agg.acceptat_vizual
        showToast(
          `✅ OCR finalizat: ${autoOk} auto-OK · ${reviewNeeded} necesită revizuire · ${totalProcesat} total`, 
          'success'
        )
      }
    } catch (e) {
      console.error('Eroare runOCR:', e)
      setError(e.message)
      setPhase('done')
    }
  }, [alimentari, shouldStop, showToast])
  
  // ──────────────────── 3. DECIZIE MANUALĂ (Accept / Respinge) ────────────────────
  // 25.05.2026 v2: 1-click fără motiv per cerere Razvan
  const handleManualDecision = useCallback(async (alimId, decision) => {
    if (decidingId) return // anti-double-click
    setDecidingId(alimId)
    try {
      const { data, error: rpcErr } = await supabase.rpc('fn_ocr_decide_manual', {
        p_alim_id: alimId,
        p_decision: decision  // 'accept' sau 'reject'
      })
      
      if (rpcErr) {
        showToast(`Eroare: ${rpcErr.message}`, 'warn')
        return
      }
      
      if (data?.ok) {
        const newStatus = data.new_status
        setDecidedIds(prev => ({ ...prev, [alimId]: newStatus }))
        const action = decision === 'accept' ? '✓ Acceptat' : '✗ Respins'
        showToast(`${action} alim #${alimId}`, 'success')
      } else {
        showToast(`Răspuns neașteptat de la BD`, 'warn')
      }
    } catch (e) {
      showToast(`Eroare: ${e.message}`, 'warn')
    } finally {
      setDecidingId(null)
    }
  }, [decidingId, showToast])
  
  const alimById = alimentari.reduce((m, a) => { m[a.id] = a; return m }, {})
  
  return (
    <div 
      style={{
        position:'fixed', inset:0, background:'rgba(0,0,0,0.78)',
        zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:20
      }} 
      onClick={() => { if (phase !== 'running') onClose() }}
    >
      <div 
        style={{
          background:G.surface, border:`1px solid ${G.border2}`, borderRadius:14,
          width:'100%', maxWidth:1180, maxHeight:'92vh', overflow:'hidden',
          display:'flex', flexDirection:'column'
        }} 
        onClick={e => e.stopPropagation()}
      >
        
        {/* HEADER */}
        <div style={{
          padding:'16px 22px', borderBottom:`1px solid ${G.border}`,
          display:'flex', justifyContent:'space-between', alignItems:'center', gap:16
        }}>
          <div>
            <div style={{fontSize:18, fontWeight:800, color:G.blue}}>
              🔍 Validare OCR Vision SMART pe bonuri Rompetrol
              <span style={{
                marginLeft:10, fontSize:10, padding:'2px 7px', borderRadius:6,
                background:G.purple+'22', color:G.purple, fontWeight:700
              }}>v4</span>
            </div>
            <div style={{fontSize:12, color:G.muted, marginTop:2}}>
              {phase === 'loading' && 'Se încarcă lista...'}
              {phase === 'confirm' && `${alimentari.length} alimentări de validat`}
              {phase === 'running' && `Procesare ${progress.done}/${progress.total}...`}
              {phase === 'done' && 'Validare finalizată'}
            </div>
          </div>
          {phase !== 'running' && (
            <button onClick={onClose} style={{
              background:'transparent', border:'none', color:G.muted,
              fontSize:24, cursor:'pointer', padding:'4px 12px'
            }}>×</button>
          )}
        </div>
        
        {/* CONTENT */}
        <div style={{flex:1, overflow:'auto', padding:22}}>
          
          {error && (
            <div style={{
              background:G.redDim, border:`1px solid ${G.red}`, borderRadius:8,
              padding:'10px 14px', marginBottom:16, fontSize:12, color:G.red
            }}>
              ❌ {error}
            </div>
          )}
          
          {/* FAZA 1: LOADING */}
          {phase === 'loading' && (
            <div style={{textAlign:'center', padding:'60px 20px', color:G.muted, fontSize:14}}>
              ⏳ Se încarcă lista alimentărilor de validat...
            </div>
          )}
          
          {/* FAZA 2: CONFIRM */}
          {phase === 'confirm' && (
            <div>
              {alimentari.length === 0 ? (
                <div style={{
                  textAlign:'center', padding:'60px 20px',
                  background:G.bg, border:`1px solid ${G.border}`, borderRadius:10
                }}>
                  <div style={{fontSize:42, marginBottom:12}}>✅</div>
                  <div style={{fontSize:15, color:G.green, fontWeight:700, marginBottom:6}}>
                    Niciun bon de validat momentan!
                  </div>
                  <div style={{fontSize:12, color:G.muted}}>
                    Toate alimentările Rompetrol cu poză au fost deja validate prin OCR.
                  </div>
                </div>
              ) : (
                <>
                  {/* Info despre upgrade v2 */}
                  <div style={{
                    background:G.purple+'15', border:`1px solid ${G.purple}55`, borderRadius:10,
                    padding:'14px 18px', marginBottom:18
                  }}>
                    <div style={{fontSize:13, color:G.purple, fontWeight:800, marginBottom:6}}>
                      🆕 Upgrade v2 — Vision OCR SMART
                    </div>
                    <div style={{fontSize:11, color:G.text, lineHeight:1.6}}>
                      Vision clasifică acum poza în <strong>7 tipuri de dovezi</strong>:<br/>
                      🧾 Bon fiscal · 📺 Display pompă · 📷 Plăcuța+bon · 💬 Caption · 🚨 Altă stație/dată/produs · 🌫️ Ilizibil
                      <br/>
                      → <strong>Display-ul pompei și combo plăcuța+bon</strong> sunt acceptate automat ca dovadă vizuală (OK pentru ANAF).<br/>
                      → <strong>Bonurile din alte stații/date</strong> sunt marcate ca <span style={{color:G.red, fontWeight:700}}>POSIBILĂ FRAUDĂ</span>.
                    </div>
                  </div>
                  
                  {/* Cost estimat */}
                  <div style={{
                    background:G.bg, border:`1px solid ${G.border}`, borderRadius:10,
                    padding:'14px 18px', marginBottom:18,
                    display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:14
                  }}>
                    <div>
                      <div style={{fontSize:10, color:G.muted, textTransform:'uppercase', marginBottom:4}}>Total alimentări</div>
                      <div style={{fontSize:20, fontWeight:900, color:G.blue}}>{alimentari.length}</div>
                    </div>
                    <div>
                      <div style={{fontSize:10, color:G.muted, textTransform:'uppercase', marginBottom:4}}>Cost estimat</div>
                      <div style={{fontSize:20, fontWeight:900, color:G.green}}>
                        ~${(alimentari.length * COST_PER_BON).toFixed(3)}
                      </div>
                    </div>
                    <div>
                      <div style={{fontSize:10, color:G.muted, textTransform:'uppercase', marginBottom:4}}>Durată est.</div>
                      <div style={{fontSize:20, fontWeight:900, color:G.yellow}}>
                        ~{Math.ceil(alimentari.length * 6 / 60)} min
                      </div>
                    </div>
                    <div>
                      <div style={{fontSize:10, color:G.muted, textTransform:'uppercase', marginBottom:4}}>Model AI</div>
                      <div style={{fontSize:11, fontFamily:'monospace', color:G.purple, marginTop:4}}>
                        haiku-4-5
                      </div>
                    </div>
                  </div>
                  
                  {/* Preview listă scurtă */}
                  <div style={{
                    background:G.bg, border:`1px solid ${G.border}`, borderRadius:10,
                    padding:'12px 16px', marginBottom:20, maxHeight:280, overflow:'auto'
                  }}>
                    <div style={{fontSize:11, color:G.muted, fontWeight:700, textTransform:'uppercase', marginBottom:8}}>
                      Preview ({alimentari.length}):
                    </div>
                    {alimentari.slice(0, 50).map(a => (
                      <div key={a.id} style={{
                        display:'flex', justifyContent:'space-between', alignItems:'center',
                        padding:'5px 0', fontSize:11, borderBottom:`1px solid ${G.border}66`
                      }}>
                        <span style={{fontFamily:'monospace', color:G.text}}>{fmtDate(a.data_alimentare)}</span>
                        <span style={{flex:1, marginLeft:10, color:G.text}}>
                          {a.marca} {a.model?.substring(0, 20)} 
                          {a.nr_inmatriculare && <span style={{color:G.blue, marginLeft:6, fontFamily:'monospace'}}>{a.nr_inmatriculare}</span>}
                        </span>
                        <span style={{color:G.orange, fontWeight:700, marginRight:10}}>
                          {Number(a.cantitate_litri).toFixed(1)} L
                        </span>
                        <span style={{color:G.muted, fontSize:10}}>🆕 nou</span>
                      </div>
                    ))}
                    {alimentari.length > 50 && (
                      <div style={{textAlign:'center', padding:'8px 0', color:G.muted, fontSize:11}}>
                        ... și încă {alimentari.length - 50}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
          
          {/* FAZA 3: RUNNING */}
          {phase === 'running' && (
            <div>
              {/* Progress bar */}
              <div style={{
                background:G.bg, border:`1px solid ${G.border}`, borderRadius:10,
                padding:'20px 22px', marginBottom:20
              }}>
                <div style={{
                  display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12
                }}>
                  <div style={{fontSize:14, fontWeight:700, color:G.text}}>
                    🔄 {progress.done} / {progress.total} procesate
                  </div>
                  <div style={{fontSize:12, color:G.muted}}>
                    ~${totalCost.toFixed(4)} consumat
                  </div>
                </div>
                <div style={{height:10, background:G.surface, borderRadius:8, overflow:'hidden'}}>
                  <div style={{
                    height:'100%',
                    width: `${(progress.done / progress.total * 100).toFixed(1)}%`,
                    background: `linear-gradient(90deg, ${G.blue}, ${G.green})`,
                    transition: 'width 0.4s ease'
                  }}/>
                </div>
                {progress.current && (
                  <div style={{fontSize:10, color:G.dim, marginTop:8, fontFamily:'monospace'}}>
                    Procesez ID #{progress.current}...
                  </div>
                )}
              </div>
              
              {/* Stats live - 6 categorii noi */}
              <div style={{
                display:'grid', gridTemplateColumns:'repeat(6, 1fr)', gap:8, marginBottom:20
              }}>
                {['match', 'acceptat_vizual', 'discrepancy', 'invalid', 'ilizibil', 'errors'].map(k => {
                  const meta = STATUS_META[k] || STATUS_META[k === 'errors' ? 'error' : 'match']
                  return (
                    <div key={k} style={{
                      background:G.bg, border:`1px solid ${G.border}`, borderRadius:8,
                      padding:'10px 6px', textAlign:'center'
                    }}>
                      <div style={{fontSize:16, fontWeight:900, color: meta.color}}>
                        {meta.icon} {aggSummary[k] || 0}
                      </div>
                      <div style={{fontSize:9, color:G.muted, marginTop:2}}>{meta.label}</div>
                    </div>
                  )
                })}
              </div>
              
              <div style={{textAlign:'center', fontSize:11, color:G.muted, fontStyle:'italic'}}>
                ⏳ Procesare în curs. Nu închide fereastra până nu se termină.
              </div>
            </div>
          )}
          
          {/* FAZA 4: DONE - REZULTATE */}
          {phase === 'done' && (
            <div>
              {/* Summary mare - 6 categorii */}
              <div style={{
                display:'grid', gridTemplateColumns:'repeat(6, 1fr)', gap:10, marginBottom:18
              }}>
                {['match', 'acceptat_vizual', 'discrepancy', 'invalid', 'ilizibil', 'errors'].map(k => {
                  const meta = STATUS_META[k] || STATUS_META[k === 'errors' ? 'error' : 'match']
                  return (
                    <div key={k} style={{
                      background:G.bg, border:`1px solid ${meta.color}55`, borderRadius:10,
                      padding:'12px 8px', textAlign:'center'
                    }}>
                      <div style={{fontSize:26}}>{meta.icon}</div>
                      <div style={{fontSize:22, fontWeight:900, color: meta.color, marginTop:4}}>
                        {aggSummary[k] || 0}
                      </div>
                      <div style={{fontSize:10, color:G.muted, marginTop:2}}>{meta.label}</div>
                    </div>
                  )
                })}
              </div>
              
              {/* Helper text — cu instrucțiuni clare pentru Marilena */}
              {(aggSummary.discrepancy + aggSummary.invalid + aggSummary.ilizibil) > 0 && (
                <div style={{
                  background:G.yellowDim, border:`1px solid ${G.yellow}66`, borderRadius:8,
                  padding:'10px 14px', marginBottom:14, fontSize:12, color:G.text
                }}>
                  💡 <strong style={{color:G.yellow}}>Revizuire manuală necesară</strong> pentru 
                  {' '}{aggSummary.discrepancy + aggSummary.invalid + aggSummary.ilizibil} alimentări marcate cu ⚠️/🚨/🌫️.
                  Apasă <span style={{color:G.green, fontWeight:700}}>✓ Accept</span> sau 
                  {' '}<span style={{color:G.red, fontWeight:700}}>✗ Respinge</span> pe fiecare rând din tabel.
                </div>
              )}
              
              <div style={{
                background:G.bg, border:`1px solid ${G.border}`, borderRadius:8,
                padding:'10px 16px', marginBottom:14, fontSize:12, color:G.muted
              }}>
                💰 Cost total: <strong style={{color:G.green}}>${totalCost.toFixed(4)}</strong> · 
                Model: <code style={{fontSize:11, color:G.blue}}>claude-haiku-4-5</code> · 
                {allResults.length} alimentări procesate
              </div>
              
              {/* Listă rezultate cu butoane Accept/Respinge */}
              {allResults.length > 0 && (
                <div style={{
                  background:G.bg, border:`1px solid ${G.border}`, borderRadius:10,
                  maxHeight:430, overflow:'auto'
                }}>
                  <table style={{width:'100%', borderCollapse:'collapse', fontSize:11}}>
                    <thead style={{position:'sticky', top:0, background:G.surface, zIndex:1}}>
                      <tr style={{borderBottom:`2px solid ${G.border2}`}}>
                        <th style={thS}>Data</th>
                        <th style={thS}>Vehicul</th>
                        <th style={{...thS, textAlign:'right'}}>Decl. L</th>
                        <th style={{...thS, textAlign:'right'}}>Decl. RON</th>
                        <th style={thS}>Status</th>
                        <th style={thS}>Tip dovadă</th>
                        <th style={thS}>Detalii</th>
                        <th style={{...thS, textAlign:'center'}}>Acțiuni</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allResults.map(r => {
                        const a = alimById[r.id] || {}
                        // 25.05.2026 v2: status efectiv = decision manuală dacă există, altfel status OCR
                        const effectiveStatus = decidedIds[r.id] || r.status
                        const statusMeta = STATUS_META[effectiveStatus] || STATUS_META.error
                        const tipMeta = r.tip_dovada ? TIP_DOVADA_META[r.tip_dovada] : null
                        const isAlreadyDecided = !!decidedIds[r.id]
                        const needsReview = ['discrepancy', 'invalid', 'ilizibil'].includes(r.status) && !isAlreadyDecided
                        const isDeciding = decidingId === r.id
                        
                        return (
                          <tr key={r.id} style={{
                            borderBottom:`1px solid ${G.border}88`,
                            background: isAlreadyDecided ? (
                              decidedIds[r.id] === 'accepted_manual' ? G.green+'08' : G.red+'08'
                            ) : 'transparent',
                            opacity: isAlreadyDecided ? 0.85 : 1,
                          }}>
                            <td style={{padding:'7px 10px', fontFamily:'monospace', color:G.text}}>
                              {fmtDate(a.data_alimentare)}
                            </td>
                            <td style={{padding:'7px 10px', color:G.text}}>
                              {a.marca} {a.model?.substring(0, 20)}
                              {a.nr_inmatriculare && (
                                <span style={{
                                  color:G.blue, marginLeft:5, fontFamily:'monospace', fontSize:10
                                }}>{a.nr_inmatriculare}</span>
                              )}
                            </td>
                            <td style={{
                              padding:'7px 10px', textAlign:'right', color:G.orange, fontWeight:700
                            }}>
                              {a.cantitate_litri ? Number(a.cantitate_litri).toFixed(1) : '—'}
                            </td>
                            <td style={{
                              padding:'7px 10px', textAlign:'right', color:G.green, fontWeight:600
                            }}>
                              {a.pret_total ? Number(a.pret_total).toFixed(2) : '—'}
                            </td>
                            <td style={{padding:'7px 10px'}}>
                              <span style={{
                                color: statusMeta.color, fontWeight:700,
                                background: statusMeta.color + '22', 
                                padding:'2px 8px', borderRadius:6, fontSize:10,
                                whiteSpace:'nowrap'
                              }}>
                                {statusMeta.icon} {statusMeta.label}
                              </span>
                            </td>
                            <td style={{padding:'7px 10px'}}>
                              {tipMeta ? (
                                <span style={{
                                  color: tipMeta.color, fontWeight:600,
                                  background: tipMeta.color + '15', 
                                  padding:'2px 6px', borderRadius:5, fontSize:9,
                                  whiteSpace:'nowrap'
                                }}>
                                  {tipMeta.icon} {tipMeta.label}
                                </span>
                              ) : (
                                <span style={{color:G.dim, fontSize:9}}>—</span>
                              )}
                            </td>
                            <td style={{padding:'7px 10px', fontSize:10, color:G.muted, maxWidth:200}}>
                              {r.status === 'discrepancy' && (
                                <span>
                                  {r.diff_litri > 0 && `Δ L: ${r.diff_litri}`}
                                  {r.diff_lei > 0 && r.diff_litri > 0 && ' · '}
                                  {r.diff_lei > 0 && `Δ RON: ${r.diff_lei}`}
                                </span>
                              )}
                              {r.status === 'invalid' && (
                                <span style={{color:G.red, fontWeight:600}}>
                                  {r.notes?.substring(0, 80) || 'Bon suspect'}
                                </span>
                              )}
                              {r.status === 'ilizibil' && (
                                <span>{r.notes?.substring(0, 80) || 'poză ilizibilă'}</span>
                              )}
                              {r.status === 'error' && (
                                <span style={{color:G.red}}>{r.error?.substring(0, 80)}</span>
                              )}
                              {r.status === 'match' && (
                                <span style={{color:G.green}}>✓ Cifre coincid</span>
                              )}
                              {r.status === 'acceptat_vizual' && (
                                <span style={{color:G.cyan}}>👁️ Dovadă vizuală OK</span>
                              )}
                            </td>
                            {/* COLOANĂ ACȚIUNI - butoane Accept/Respinge 1-click */}
                            <td style={{padding:'7px 8px', textAlign:'center', whiteSpace:'nowrap'}}>
                              {needsReview ? (
                                <div style={{display:'flex', gap:4, justifyContent:'center'}}>
                                  <button
                                    onClick={() => handleManualDecision(r.id, 'accept')}
                                    disabled={isDeciding}
                                    title="Accept manual (1-click, fără motiv)"
                                    style={{
                                      background: G.green, color:'#fff', border:'none',
                                      borderRadius:5, padding:'4px 8px', fontSize:10, fontWeight:800,
                                      cursor: isDeciding ? 'wait' : 'pointer',
                                      opacity: isDeciding ? 0.5 : 1,
                                    }}
                                  >
                                    ✓ Accept
                                  </button>
                                  <button
                                    onClick={() => {
                                      if (confirm(`Respinge alim #${r.id}?\n\nVa rămâne în BD dar marcată ca respinsă.`)) {
                                        handleManualDecision(r.id, 'reject')
                                      }
                                    }}
                                    disabled={isDeciding}
                                    title="Respinge manual"
                                    style={{
                                      background: G.red, color:'#fff', border:'none',
                                      borderRadius:5, padding:'4px 8px', fontSize:10, fontWeight:800,
                                      cursor: isDeciding ? 'wait' : 'pointer',
                                      opacity: isDeciding ? 0.5 : 1,
                                    }}
                                  >
                                    ✗
                                  </button>
                                </div>
                              ) : isAlreadyDecided ? (
                                <span style={{
                                  fontSize:10, color: decidedIds[r.id] === 'accepted_manual' ? G.green : G.red,
                                  fontWeight:700
                                }}>
                                  {decidedIds[r.id] === 'accepted_manual' ? '✓ Decis' : '✗ Decis'}
                                </span>
                              ) : (
                                <span style={{color:G.dim, fontSize:10}}>—</span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
          
        </div>
        
        {/* FOOTER */}
        <div style={{
          padding:'12px 22px', borderTop:`1px solid ${G.border}`,
          display:'flex', justifyContent:'flex-end', gap:10, background:G.bg
        }}>
          {phase === 'confirm' && (
            <>
              <button onClick={onClose} style={{
                padding:'10px 22px', background:G.surface, color:G.text,
                border:`1px solid ${G.border}`, borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:600
              }}>Anulează</button>
              {alimentari.length > 0 && (
                <button onClick={runOCR} style={{
                  padding:'10px 22px', background:G.blue, color:'#000',
                  border:'none', borderRadius:8, fontSize:13, fontWeight:800, cursor:'pointer'
                }}>
                  🚀 Rulează OCR pe {alimentari.length} bonuri
                </button>
              )}
            </>
          )}
          {phase === 'running' && (
            <button onClick={() => setShouldStop(true)} style={{
              padding:'10px 22px', background:G.red, color:'#fff',
              border:'none', borderRadius:8, fontSize:13, fontWeight:700, cursor:'pointer'
            }}>
              ⏹ Oprește
            </button>
          )}
          {phase === 'done' && (
            <button onClick={() => { onClose(); if (onFinished) onFinished() }} style={{
              padding:'10px 22px', background:G.green, color:'#fff',
              border:'none', borderRadius:8, fontSize:13, fontWeight:800, cursor:'pointer'
            }}>
              ✓ Închide
            </button>
          )}
        </div>
        
      </div>
    </div>
  )
}

const thS = {
  padding:'8px 10px', textAlign:'left', color:G.muted, fontWeight:700,
  fontSize:10, textTransform:'uppercase', letterSpacing:'.3px',
  background:G.surface
}
