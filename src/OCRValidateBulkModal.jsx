// ════════════════════════════════════════════════════════════════════════════
// OCRValidateBulkModal — Validare OCR Vision pe bonuri Rompetrol
// 25.05.2026 — Etapa 4 WhatsApp Motorină
// ════════════════════════════════════════════════════════════════════════════
// Workflow:
//   1. Fetch alimentări cu poză din v_alimentari_pt_ocr (status: NULL/pending/discrepancy/unreadable)
//   2. User confirmă rularea (vede cost estimat + durată)
//   3. Trigger Edge Function `analyze_bon_rompetrol` în batches de 10 IDs
//   4. Progress bar real-time + buton stop
//   5. Summary la final: match / discrepancy / unreadable / errors + listă detalii
// ════════════════════════════════════════════════════════════════════════════
// Toleranțe pe Edge Function:
//   - Litri: ±3% sau ±3L (care e mai mare)
//   - LEI:   ±2% sau ±5 RON (care e mai mare)
// Model: claude-haiku-4-5-20251001 (~0.05¢ per bon estimat)
// ════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback } from 'react'
import { supabase } from './lib/supabase.js'

const G = {
  bg:'#0D1117', surface:'#161B22', border:'#21262D', border2:'#30363D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  blue:'#58A6FF', green:'#3FB950', red:'#F85149', yellow:'#D29922',
  purple:'#BC8CFF', orange:'#F0883E', logistica:'#E3B341',
  greenDim:'#1A3A1A', redDim:'#3A1A1A', yellowDim:'#3A2A0A',
}

const BATCH_SIZE = 10           // max ID-uri per call Edge Function (evită timeout 60s)
const COST_PER_BON = 0.001      // estimat USD/bon Haiku 4.5 Vision

const STATUS_META = {
  match:       { icon: '✅', color: G.green, label: 'Match' },
  discrepancy: { icon: '⚠️', color: G.orange, label: 'Discrepanță' },
  unreadable:  { icon: '👁️', color: G.muted, label: 'Ilizibil' },
  no_poza:     { icon: '📭', color: G.dim, label: 'Fără poză' },
  error:       { icon: '❌', color: G.red, label: 'Eroare' },
  pending:     { icon: '⏳', color: G.blue, label: 'Pending' },
}

const fmtDate = (iso) => {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

export default function OCRValidateBulkModal({ profile, showToast, onClose, onFinished }) {
  const [phase, setPhase] = useState('loading') // loading | confirm | running | done
  const [alimentari, setAlimentari] = useState([])
  const [progress, setProgress] = useState({ done: 0, total: 0, current: null })
  const [allResults, setAllResults] = useState([])
  const [aggSummary, setAggSummary] = useState({ match: 0, discrepancy: 0, unreadable: 0, no_poza: 0, errors: 0 })
  const [totalCost, setTotalCost] = useState(0)
  const [shouldStop, setShouldStop] = useState(false)
  const [error, setError] = useState(null)
  
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
    let agg = { match: 0, discrepancy: 0, unreadable: 0, no_poza: 0, errors: 0 }
    let allRes = []
    let totalCostUsd = 0
    
    try {
      for (let i = 0; i < ids.length; i += BATCH_SIZE) {
        if (shouldStop) break
        
        const batch = ids.slice(i, i + BATCH_SIZE)
        setProgress({ 
          done: i, 
          total: ids.length, 
          current: batch[0]
        })
        
        const { data, error: invokeErr } = await supabase.functions.invoke('analyze_bon_rompetrol', {
          body: { alim_ids: batch }
        })
        
        if (invokeErr) {
          // Eroare per batch — log + continue
          console.error('Batch OCR failed:', invokeErr)
          showToast(`Eroare batch ${i / BATCH_SIZE + 1}: ${invokeErr.message || 'unknown'}`, 'warn')
          // Marchez tot batch-ul ca error
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
        
        // Agreg rezultate
        const batchResults = data.results || []
        allRes = allRes.concat(batchResults)
        
        const s = data.summary || {}
        agg.match += s.match || 0
        agg.discrepancy += s.discrepancy || 0
        agg.unreadable += s.unreadable || 0
        agg.no_poza += s.no_poza || 0
        agg.errors += s.errors || 0
        
        totalCostUsd += data.meta?.cost_usd || 0
        
        // Update state pentru UI live
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
      const totalProcesat = agg.match + agg.discrepancy + agg.unreadable + agg.no_poza + agg.errors
      
      if (agg.errors > 0) {
        showToast(`OCR finalizat cu ${agg.errors} erori. Vezi detaliile.`, 'warn')
      } else {
        showToast(`✅ OCR finalizat: ${totalProcesat} bonuri procesate`, 'success')
      }
    } catch (e) {
      console.error('Eroare runOCR:', e)
      setError(e.message)
      setPhase('done')
    }
  }, [alimentari, shouldStop, showToast])
  
  // Aggregate lookup pentru lista rezultate finală
  const alimById = alimentari.reduce((m, a) => { m[a.id] = a; return m }, {})
  
  // ──────────────────── RENDER ────────────────────
  
  return (
    <div 
      style={{
        position:'fixed', inset:0, background:'rgba(0,0,0,0.78)',
        zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center',
        padding:20
      }} 
      onClick={() => { if (phase !== 'running') onClose() }}
    >
      <div 
        style={{
          background:G.surface, border:`1px solid ${G.border2}`, borderRadius:14,
          width:'100%', maxWidth:1100, maxHeight:'92vh', overflow:'hidden',
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
            <div style={{fontSize:18, fontWeight:800, color:G.blue}}>🔍 Validare OCR Vision pe bonuri Rompetrol</div>
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
          
          {/* FAZA 2: CONFIRM (înainte de rulare) */}
          {phase === 'confirm' && (
            <div>
              {alimentari.length === 0 ? (
                <div style={{textAlign:'center', padding:'60px 20px', color:G.green, fontSize:16, fontWeight:700}}>
                  🎉 Nicio alimentare de validat momentan!
                  <div style={{fontSize:12, color:G.muted, fontWeight:400, marginTop:8}}>
                    Toate alimentările cu poză au fost validate prin OCR.
                  </div>
                </div>
              ) : (
                <>
                  {/* Statistici prediction */}
                  <div style={{
                    display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:12, marginBottom:20
                  }}>
                    <div style={{background:G.bg, border:`1px solid ${G.border}`, borderRadius:10, padding:14, textAlign:'center'}}>
                      <div style={{fontSize:22, fontWeight:900, color:G.blue}}>{alimentari.length}</div>
                      <div style={{fontSize:11, color:G.muted, marginTop:4}}>Alimentări de validat</div>
                    </div>
                    <div style={{background:G.bg, border:`1px solid ${G.border}`, borderRadius:10, padding:14, textAlign:'center'}}>
                      <div style={{fontSize:22, fontWeight:900, color:G.green}}>
                        ~${(alimentari.length * COST_PER_BON).toFixed(3)}
                      </div>
                      <div style={{fontSize:11, color:G.muted, marginTop:4}}>Cost estimat (Haiku 4.5)</div>
                    </div>
                    <div style={{background:G.bg, border:`1px solid ${G.border}`, borderRadius:10, padding:14, textAlign:'center'}}>
                      <div style={{fontSize:22, fontWeight:900, color:G.purple}}>
                        ~{Math.ceil(alimentari.length * 3 / 60)} min
                      </div>
                      <div style={{fontSize:11, color:G.muted, marginTop:4}}>Durată estimată</div>
                    </div>
                  </div>
                  
                  {/* Info despre toleranțe */}
                  <div style={{
                    background:G.bg, border:`1px solid ${G.border}`, borderRadius:10,
                    padding:'12px 16px', marginBottom:20, fontSize:12, color:G.muted, lineHeight:1.6
                  }}>
                    <div style={{color:G.text, fontWeight:700, marginBottom:6}}>📐 Toleranțe match:</div>
                    <div>• <strong style={{color:G.text}}>Cantitate</strong>: ±3% sau ±3 L (care e mai mare)</div>
                    <div>• <strong style={{color:G.text}}>LEI total</strong>: ±2% sau ±5 RON (care e mai mare)</div>
                    <div style={{marginTop:6, color:G.dim, fontStyle:'italic'}}>
                      Vision citește bonul, compară cu valorile declarate. Status: ✅ match / ⚠️ discrepancy / 👁️ ilizibil
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
                        <span style={{color:G.orange, fontWeight:700, marginRight:10}}>{Number(a.cantitate_litri).toFixed(1)} L</span>
                        <span style={{color:G.muted, fontSize:10}}>
                          {a.ocr_status === 'discrepancy' && '⚠️ re-validare'}
                          {a.ocr_status === 'unreadable' && '👁️ retry'}
                          {!a.ocr_status && '🆕 nou'}
                        </span>
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
                  display:'flex', justifyContent:'space-between', alignItems:'center',
                  marginBottom:12
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
              
              {/* Stats live */}
              <div style={{
                display:'grid', gridTemplateColumns:'repeat(5, 1fr)', gap:8, marginBottom:20
              }}>
                {['match', 'discrepancy', 'unreadable', 'no_poza', 'errors'].map(k => {
                  const meta = STATUS_META[k] || STATUS_META[k === 'errors' ? 'error' : 'match']
                  return (
                    <div key={k} style={{
                      background:G.bg, border:`1px solid ${G.border}`, borderRadius:8,
                      padding:'10px 8px', textAlign:'center'
                    }}>
                      <div style={{fontSize:18, fontWeight:900, color: meta.color}}>
                        {meta.icon} {aggSummary[k] || 0}
                      </div>
                      <div style={{fontSize:10, color:G.muted, marginTop:2}}>{meta.label}</div>
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
              {/* Summary mare */}
              <div style={{
                display:'grid', gridTemplateColumns:'repeat(5, 1fr)', gap:10, marginBottom:20
              }}>
                {['match', 'discrepancy', 'unreadable', 'no_poza', 'errors'].map(k => {
                  const meta = STATUS_META[k] || STATUS_META[k === 'errors' ? 'error' : 'match']
                  return (
                    <div key={k} style={{
                      background:G.bg, border:`1px solid ${meta.color}55`, borderRadius:10,
                      padding:'14px 10px', textAlign:'center'
                    }}>
                      <div style={{fontSize:32}}>{meta.icon}</div>
                      <div style={{fontSize:26, fontWeight:900, color: meta.color, marginTop:4}}>
                        {aggSummary[k] || 0}
                      </div>
                      <div style={{fontSize:11, color:G.muted, marginTop:2}}>{meta.label}</div>
                    </div>
                  )
                })}
              </div>
              
              <div style={{
                background:G.bg, border:`1px solid ${G.border}`, borderRadius:8,
                padding:'10px 16px', marginBottom:20, fontSize:12, color:G.muted
              }}>
                💰 Cost total: <strong style={{color:G.green}}>${totalCost.toFixed(4)}</strong> · 
                Model: <code style={{fontSize:11, color:G.blue}}>claude-haiku-4-5</code> · 
                {allResults.length} alimentări procesate
              </div>
              
              {/* Listă rezultate */}
              {allResults.length > 0 && (
                <div style={{
                  background:G.bg, border:`1px solid ${G.border}`, borderRadius:10,
                  maxHeight:380, overflow:'auto'
                }}>
                  <table style={{width:'100%', borderCollapse:'collapse', fontSize:11}}>
                    <thead style={{position:'sticky', top:0, background:G.surface}}>
                      <tr style={{borderBottom:`2px solid ${G.border2}`}}>
                        <th style={thS}>Data</th>
                        <th style={thS}>Vehicul</th>
                        <th style={{...thS, textAlign:'right'}}>Decl. L</th>
                        <th style={{...thS, textAlign:'right'}}>Decl. RON</th>
                        <th style={thS}>Status</th>
                        <th style={thS}>Detalii OCR</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allResults.map(r => {
                        const a = alimById[r.id] || {}
                        const meta = STATUS_META[r.status] || STATUS_META.error
                        return (
                          <tr key={r.id} style={{borderBottom:`1px solid ${G.border}88`}}>
                            <td style={{padding:'6px 10px', fontFamily:'monospace', color:G.text}}>{fmtDate(a.data_alimentare)}</td>
                            <td style={{padding:'6px 10px', color:G.text}}>
                              {a.marca} {a.model?.substring(0, 20)}
                              {a.nr_inmatriculare && <span style={{color:G.blue, marginLeft:5, fontFamily:'monospace', fontSize:10}}>{a.nr_inmatriculare}</span>}
                            </td>
                            <td style={{padding:'6px 10px', textAlign:'right', color:G.orange, fontWeight:700}}>{a.cantitate_litri ? Number(a.cantitate_litri).toFixed(1) : '—'}</td>
                            <td style={{padding:'6px 10px', textAlign:'right', color:G.green, fontWeight:600}}>{a.pret_total ? Number(a.pret_total).toFixed(2) : '—'}</td>
                            <td style={{padding:'6px 10px'}}>
                              <span style={{
                                color: meta.color, fontWeight:700,
                                background: meta.color + '22', padding:'2px 8px', borderRadius:6, fontSize:10
                              }}>
                                {meta.icon} {meta.label}
                              </span>
                            </td>
                            <td style={{padding:'6px 10px', fontSize:10, color:G.muted}}>
                              {r.status === 'discrepancy' && (
                                <span>
                                  {r.diff_litri > 0 && `Δ litri: ${r.diff_litri} L `}
                                  {r.diff_lei > 0 && `· Δ LEI: ${r.diff_lei}`}
                                </span>
                              )}
                              {r.status === 'unreadable' && (r.notes || 'poza ilizibilă')}
                              {r.status === 'error' && <span style={{color:G.red}}>{r.error?.substring(0, 50)}</span>}
                              {r.status === 'match' && <span style={{color:G.green}}>OCR confirmă</span>}
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
