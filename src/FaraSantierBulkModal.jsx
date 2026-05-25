// ════════════════════════════════════════════════════════════════════════════
// FaraSantierBulkModal — Alocare manuală bulk pentru alimentări fără șantier
// 25.05.2026 — Etapa 4 WhatsApp Motorină, complement la Import WhatsApp
// ════════════════════════════════════════════════════════════════════════════
// Workflow:
//   1. Fetch alimentări cu site_id IS NULL (limit 200, ordonat data DESC)
//   2. Per row: dropdown șantier + mass action „aplică pe toate filtrate"
//   3. La save: UPDATE-uri batch (Promise.all max 50 simultan) cu:
//        site_id = X
//        sursa_alocare_santier = 'manual'
//        aloc_santier_de = profile.id
//        aloc_santier_la = now()
//   4. Refresh count în AlimentariBulkPage prin callback onSaved()
// ════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from './lib/supabase.js'

// Theme — paletă G identică cu Logistica.jsx
const G = {
  bg:'#0D1117', surface:'#161B22', border:'#21262D', border2:'#30363D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  blue:'#58A6FF', green:'#3FB950', red:'#F85149', yellow:'#D29922',
  purple:'#BC8CFF', orange:'#F0883E',
  greenDim:'#1A3A1A', redDim:'#3A1A1A', yellowDim:'#3A2A0A',
  logistica:'#E3B341',
}

const fmtDate = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

const fmtDateTime = (iso) => {
  if (!iso) return ''
  return new Date(iso).toLocaleString('ro-RO', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function FaraSantierBulkModal({ sites, profile, showToast, onClose, onSaved }) {
  const [loading, setLoading] = useState(true)
  const [alimentari, setAlimentari] = useState([])     // toate alim fără șantier
  const [selections, setSelections] = useState({})     // map: alim_id → site_id
  const [saving, setSaving] = useState(false)
  const [savedCount, setSavedCount] = useState(0)
  
  // Filtre
  const [filterLuna, setFilterLuna] = useState('toate')     // 'toate' | YYYY-MM
  const [filterVehicul, setFilterVehicul] = useState('')    // text search
  const [filterStatie, setFilterStatie] = useState('toate') // 'toate' | nume stație
  const [filterWhatsApp, setFilterWhatsApp] = useState('toate') // 'toate' | 'cu_wa' | 'fara_wa'
  
  // Mass action
  const [massSantierId, setMassSantierId] = useState('')
  
  // Fetch alimentări fără șantier
  const loadAlim = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('logistica_alimentari')
      .select(`
        id, data_alimentare, cantitate_litri, pret_total, pret_per_litru,
        statie_combustibil, ore_la_alimentare, km_la_alimentare,
        whatsapp_caption, whatsapp_autor, whatsapp_msg_dt,
        sursa_alocare_santier, observatii,
        logistica_active(id, cod_intern, nr_inmatriculare, marca, model)
      `)
      .is('site_id', null)
      .order('data_alimentare', { ascending: false })
      .order('id', { ascending: false })
      .limit(500)
    setLoading(false)
    if (error) {
      showToast('Eroare încărcare: ' + error.message, 'error')
      setAlimentari([])
      return
    }
    setAlimentari(data || [])
  }, [showToast])
  
  useEffect(() => { loadAlim() }, [loadAlim])
  
  // Liste pentru filtre
  const luniDisponibile = useMemo(() => {
    const set = new Set()
    alimentari.forEach(a => {
      if (a.data_alimentare) set.add(a.data_alimentare.slice(0, 7))
    })
    return Array.from(set).sort().reverse()
  }, [alimentari])
  
  const statiiDisponibile = useMemo(() => {
    const set = new Set()
    alimentari.forEach(a => { if (a.statie_combustibil) set.add(a.statie_combustibil) })
    return Array.from(set).sort()
  }, [alimentari])
  
  // Alimentări filtrate
  const filtered = useMemo(() => {
    let res = alimentari
    if (filterLuna !== 'toate') res = res.filter(a => a.data_alimentare?.startsWith(filterLuna))
    if (filterStatie !== 'toate') res = res.filter(a => a.statie_combustibil === filterStatie)
    if (filterWhatsApp === 'cu_wa') res = res.filter(a => a.whatsapp_caption)
    if (filterWhatsApp === 'fara_wa') res = res.filter(a => !a.whatsapp_caption)
    if (filterVehicul.trim()) {
      const q = filterVehicul.toLowerCase()
      res = res.filter(a => {
        const av = a.logistica_active || {}
        return (
          (av.cod_intern || '').toLowerCase().includes(q) ||
          (av.nr_inmatriculare || '').toLowerCase().includes(q) ||
          (av.marca || '').toLowerCase().includes(q) ||
          (av.model || '').toLowerCase().includes(q)
        )
      })
    }
    return res
  }, [alimentari, filterLuna, filterVehicul, filterStatie, filterWhatsApp])
  
  // Selecții active pentru save
  const validSelections = useMemo(() => {
    return Object.entries(selections)
      .filter(([id, siteId]) => siteId && filtered.some(a => a.id === Number(id)))
      .map(([id, siteId]) => ({ id: Number(id), site_id: Number(siteId) }))
  }, [selections, filtered])
  
  // Stats
  const totalLitri = useMemo(() => filtered.reduce((s, a) => s + Number(a.cantitate_litri || 0), 0), [filtered])
  const totalCost = useMemo(() => filtered.reduce((s, a) => s + Number(a.pret_total || 0), 0), [filtered])
  const cuWhatsApp = useMemo(() => filtered.filter(a => a.whatsapp_caption).length, [filtered])
  
  // Handler: setare șantier pe row
  const handleSetSite = (alimId, siteId) => {
    setSelections(prev => ({ ...prev, [alimId]: siteId || null }))
  }
  
  // Handler: mass action - aplică șantier pe toate filtrate
  const handleMassApply = () => {
    if (!massSantierId) {
      showToast('Selectează un șantier mai întâi', 'warn')
      return
    }
    const updates = {}
    filtered.forEach(a => { updates[a.id] = massSantierId })
    setSelections(prev => ({ ...prev, ...updates }))
    showToast(`✅ ${filtered.length} alocări preselectate. Verifică și apoi salvează.`, 'success')
  }
  
  // Handler: clear toate selecțiile
  const handleClearAll = () => {
    setSelections({})
    setMassSantierId('')
  }
  
  // Handler: save bulk
  const handleSave = async () => {
    if (validSelections.length === 0) {
      showToast('Nu există alocări de salvat', 'warn')
      return
    }
    if (!confirm(`Confirmi alocarea a ${validSelections.length} alimentări la șantierele selectate?`)) return
    
    setSaving(true)
    const now = new Date().toISOString()
    let success = 0
    const errors = []
    
    // Batch în grupuri de 30 ca să nu suprasolicite Supabase
    const BATCH = 30
    for (let i = 0; i < validSelections.length; i += BATCH) {
      const slice = validSelections.slice(i, i + BATCH)
      const results = await Promise.all(slice.map(({ id, site_id }) =>
        supabase
          .from('logistica_alimentari')
          .update({
            site_id,
            sursa_alocare_santier: 'manual',
            aloc_santier_de: profile?.id || null,
            aloc_santier_la: now,
          })
          .eq('id', id)
      ))
      results.forEach((r, idx) => {
        if (r.error) errors.push({ id: slice[idx].id, msg: r.error.message })
        else success++
      })
    }
    
    setSavedCount(success)
    setSaving(false)
    
    if (errors.length === 0) {
      showToast(`✅ ${success} alimentări alocate cu succes!`, 'success')
      // Auto-close după success complet (după 1 sec ca să se vadă toast-ul)
      setTimeout(() => { if (onSaved) onSaved() }, 1000)
    } else {
      showToast(`⚠️ ${success} salvate, ${errors.length} erori (vezi console)`, 'warn')
      console.error('Erori save:', errors)
      // Refresh date ca să vadă ce s-a salvat
      loadAlim()
      setSelections({})
    }
  }
  
  // ────────────────────────── RENDER ──────────────────────────
  
  return (
    <div 
      style={{
        position:'fixed', inset:0, background:'rgba(0,0,0,0.78)',
        zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center',
        padding:20
      }} 
      onClick={onClose}
    >
      <div 
        style={{
          background:G.surface, border:`1px solid ${G.border2}`, borderRadius:14,
          width:'100%', maxWidth:1300, maxHeight:'92vh', overflow:'hidden',
          display:'flex', flexDirection:'column'
        }} 
        onClick={e => e.stopPropagation()}
      >
        
        {/* HEADER */}
        <div style={{
          padding:'16px 22px', borderBottom:`1px solid ${G.border}`,
          display:'flex', justifyContent:'space-between', alignItems:'center', gap:16,
          flexWrap:'wrap'
        }}>
          <div>
            <div style={{fontSize:18, fontWeight:800, color:G.red}}>🚨 Alocare manuală șantier — Bulk Edit</div>
            <div style={{fontSize:12, color:G.muted, marginTop:2}}>
              {loading ? 'Se încarcă...' : `${alimentari.length} alimentări fără șantier · ${filtered.length} afișate cu filtrele curente`}
            </div>
          </div>
          <button onClick={onClose} style={{
            background:'transparent', border:'none', color:G.muted,
            fontSize:24, cursor:'pointer', padding:'4px 12px'
          }}>×</button>
        </div>
        
        {/* FILTRE + MASS ACTION */}
        {!loading && alimentari.length > 0 && (
          <div style={{
            padding:'12px 22px', background:G.bg, borderBottom:`1px solid ${G.border}`,
            display:'flex', gap:12, flexWrap:'wrap', alignItems:'center'
          }}>
            <div style={{fontSize:11, color:G.muted, fontWeight:700, textTransform:'uppercase', letterSpacing:'.4px'}}>Filtre:</div>
            
            {/* Filtru lună */}
            <select 
              value={filterLuna} 
              onChange={e => setFilterLuna(e.target.value)}
              style={{
                background:G.surface, border:`1px solid ${G.border2}`, color:G.text,
                borderRadius:6, padding:'6px 10px', fontSize:12, minWidth:140
              }}
            >
              <option value="toate">Toate lunile</option>
              {luniDisponibile.map(m => (
                <option key={m} value={m}>{new Date(m + '-01').toLocaleDateString('ro-RO', { month: 'long', year: 'numeric' })}</option>
              ))}
            </select>
            
            {/* Filtru stație */}
            <select 
              value={filterStatie} 
              onChange={e => setFilterStatie(e.target.value)}
              style={{
                background:G.surface, border:`1px solid ${G.border2}`, color:G.text,
                borderRadius:6, padding:'6px 10px', fontSize:12, minWidth:140
              }}
            >
              <option value="toate">Toate stațiile</option>
              {statiiDisponibile.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            
            {/* Filtru WhatsApp */}
            <select 
              value={filterWhatsApp} 
              onChange={e => setFilterWhatsApp(e.target.value)}
              style={{
                background:G.surface, border:`1px solid ${G.border2}`, color:G.text,
                borderRadius:6, padding:'6px 10px', fontSize:12, minWidth:160
              }}
            >
              <option value="toate">Toate WhatsApp</option>
              <option value="cu_wa">📲 Doar cu mesaj WhatsApp</option>
              <option value="fara_wa">Doar fără mesaj WhatsApp</option>
            </select>
            
            {/* Search vehicul */}
            <input
              type="text"
              placeholder="🔍 Caută vehicul..."
              value={filterVehicul}
              onChange={e => setFilterVehicul(e.target.value)}
              style={{
                background:G.surface, border:`1px solid ${G.border2}`, color:G.text,
                borderRadius:6, padding:'6px 10px', fontSize:12, minWidth:180, flex:'0 1 220px'
              }}
            />
            
            {/* Mass action */}
            <div style={{
              marginLeft:'auto', display:'flex', gap:6, alignItems:'center',
              padding:'4px 8px', background:G.surface, border:`1px dashed ${G.purple}`, borderRadius:8
            }}>
              <span style={{fontSize:10, color:G.purple, fontWeight:700, textTransform:'uppercase'}}>Mass:</span>
              <select 
                value={massSantierId} 
                onChange={e => setMassSantierId(e.target.value)}
                style={{
                  background:G.bg, border:`1px solid ${G.border2}`, color:G.text,
                  borderRadius:6, padding:'5px 8px', fontSize:12, minWidth:140
                }}
              >
                <option value="">— alege șantier —</option>
                {(sites || []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <button
                onClick={handleMassApply}
                disabled={!massSantierId || filtered.length === 0}
                style={{
                  background: massSantierId ? G.purple : G.dim, color:'#000',
                  border:'none', borderRadius:6, padding:'6px 10px', fontSize:11, fontWeight:800,
                  cursor: massSantierId ? 'pointer' : 'not-allowed', whiteSpace:'nowrap'
                }}
              >
                Aplică toate ({filtered.length})
              </button>
            </div>
          </div>
        )}
        
        {/* STATS BAR */}
        {!loading && filtered.length > 0 && (
          <div style={{
            padding:'8px 22px', background:G.bg + '88', borderBottom:`1px solid ${G.border}`,
            display:'flex', gap:18, fontSize:11, color:G.muted, alignItems:'center', flexWrap:'wrap'
          }}>
            <span><strong style={{color:G.text}}>{filtered.length}</strong> alimentări</span>
            <span><strong style={{color:G.orange}}>{totalLitri.toFixed(1)} L</strong> total</span>
            {totalCost > 0 && <span><strong style={{color:G.green}}>{totalCost.toLocaleString('ro-RO', {minimumFractionDigits:2, maximumFractionDigits:2})} RON</strong></span>}
            {cuWhatsApp > 0 && <span style={{color:'#25D366'}}>📲 <strong>{cuWhatsApp}</strong> au mesaj WhatsApp (probabil score insuficient pentru auto-match)</span>}
            <span style={{marginLeft:'auto'}}>
              <strong style={{color: validSelections.length > 0 ? G.green : G.muted}}>
                {validSelections.length}
              </strong> alocări gata de salvat
            </span>
            {Object.keys(selections).length > 0 && (
              <button 
                onClick={handleClearAll}
                style={{
                  background:'transparent', color:G.muted, border:`1px solid ${G.border2}`,
                  borderRadius:6, padding:'3px 8px', fontSize:10, cursor:'pointer'
                }}
              >
                ✕ Clear selecții
              </button>
            )}
          </div>
        )}
        
        {/* TABEL */}
        <div style={{flex:1, overflow:'auto', padding:'0 22px 18px 22px'}}>
          {loading ? (
            <div style={{padding:60, textAlign:'center', color:G.muted, fontSize:14}}>
              ⏳ Se încarcă alimentările fără șantier...
            </div>
          ) : alimentari.length === 0 ? (
            <div style={{padding:60, textAlign:'center', color:G.green, fontSize:16, fontWeight:700}}>
              🎉 Toate alimentările au șantier alocat!
              <div style={{fontSize:12, color:G.muted, fontWeight:400, marginTop:8}}>
                Nu există nimic de alocat manual.
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div style={{padding:60, textAlign:'center', color:G.muted, fontSize:13}}>
              Niciun rezultat cu filtrele curente. Încearcă să modifici filtrele.
            </div>
          ) : (
            <table style={{width:'100%', borderCollapse:'collapse', fontSize:12, marginTop:14}}>
              <thead style={{position:'sticky', top:0, background:G.surface, zIndex:1}}>
                <tr style={{borderBottom:`2px solid ${G.border2}`}}>
                  <th style={thStyle}>Data</th>
                  <th style={thStyle}>Vehicul</th>
                  <th style={{...thStyle, textAlign:'right'}}>Litri</th>
                  <th style={thStyle}>Stație</th>
                  <th style={{...thStyle, textAlign:'right'}}>Cost</th>
                  <th style={thStyle}>WhatsApp</th>
                  <th style={{...thStyle, minWidth:220}}>Șantier alocat</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(a => {
                  const av = a.logistica_active || {}
                  const selectedSite = selections[a.id]
                  const hasWA = !!a.whatsapp_caption
                  return (
                    <tr 
                      key={a.id} 
                      style={{
                        borderBottom:`1px solid ${G.border}`,
                        background: selectedSite ? G.greenDim + '44' : 'transparent',
                      }}
                    >
                      <td style={{padding:'8px 10px', fontFamily:'monospace', fontWeight:600, color:G.text, whiteSpace:'nowrap'}}>
                        {fmtDate(a.data_alimentare)}
                      </td>
                      <td style={{padding:'8px 10px'}}>
                        <div style={{fontWeight:600, color:G.text}}>{av.marca} {av.model?.substring(0, 26)}{av.model?.length > 26 ? '...' : ''}</div>
                        <div style={{fontSize:10, color:G.muted, marginTop:2}}>
                          {av.cod_intern && <span style={{color:G.logistica, fontFamily:'monospace'}}>{av.cod_intern}</span>}
                          {av.nr_inmatriculare && <span style={{color:G.blue, fontFamily:'monospace', marginLeft:6}}>{av.nr_inmatriculare}</span>}
                        </div>
                      </td>
                      <td style={{padding:'8px 10px', textAlign:'right', color:G.orange, fontWeight:700, fontVariantNumeric:'tabular-nums'}}>
                        {Number(a.cantitate_litri).toFixed(1)} L
                      </td>
                      <td style={{padding:'8px 10px', fontSize:11, color:G.text}}>
                        {a.statie_combustibil || '—'}
                      </td>
                      <td style={{padding:'8px 10px', textAlign:'right', fontVariantNumeric:'tabular-nums'}}>
                        {a.pret_total ? (
                          <span style={{color:G.green, fontWeight:700}}>
                            {Number(a.pret_total).toFixed(2)} RON
                          </span>
                        ) : <span style={{color:G.muted}}>—</span>}
                      </td>
                      <td style={{padding:'8px 10px', maxWidth:280}}>
                        {hasWA ? (
                          <div 
                            title={`Autor: ${a.whatsapp_autor || '?'}\nPostat: ${fmtDateTime(a.whatsapp_msg_dt)}\n\n"${a.whatsapp_caption}"`}
                            style={{
                              fontSize:10, color:G.text, lineHeight:1.3,
                              cursor:'help',
                              maxWidth:260, overflow:'hidden', textOverflow:'ellipsis',
                              display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical',
                            }}
                          >
                            <span style={{color:'#25D366', fontWeight:700, marginRight:4}}>📲</span>
                            <span style={{color:G.muted}}>{a.whatsapp_autor?.split(' ')[0] || '?'}: </span>
                            {a.whatsapp_caption.slice(0, 110)}{a.whatsapp_caption.length > 110 ? '...' : ''}
                          </div>
                        ) : (
                          <span style={{fontSize:10, color:G.muted, fontStyle:'italic'}}>fără mesaj</span>
                        )}
                      </td>
                      <td style={{padding:'8px 10px'}}>
                        <select
                          value={selectedSite || ''}
                          onChange={e => handleSetSite(a.id, e.target.value || null)}
                          style={{
                            background: selectedSite ? G.greenDim : G.bg,
                            border: `1px solid ${selectedSite ? G.green : G.border2}`,
                            color: selectedSite ? G.green : G.text,
                            borderRadius:6, padding:'5px 8px', fontSize:11, width:'100%',
                            fontWeight: selectedSite ? 700 : 400,
                          }}
                        >
                          <option value="">— alege șantier —</option>
                          {(sites || []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
        
        {/* FOOTER */}
        <div style={{
          padding:'12px 22px', borderTop:`1px solid ${G.border}`,
          display:'flex', justifyContent:'space-between', alignItems:'center', gap:12,
          background:G.bg
        }}>
          <div style={{fontSize:11, color:G.muted}}>
            {savedCount > 0 && <span style={{color:G.green, fontWeight:700}}>✅ {savedCount} salvate · </span>}
            Alocările vor fi marcate cu sursă = <strong style={{color:G.text}}>manual</strong> + audit (cine + când).
          </div>
          <div style={{display:'flex', gap:10}}>
            <button 
              onClick={onClose} 
              disabled={saving}
              style={{
                padding:'10px 22px', background:G.surface, color:G.text,
                border:`1px solid ${G.border}`, borderRadius:8,
                cursor: saving ? 'wait' : 'pointer', fontSize:13, fontWeight:600,
                opacity: saving ? 0.6 : 1
              }}
            >
              Închide
            </button>
            <button 
              onClick={handleSave} 
              disabled={validSelections.length === 0 || saving}
              style={{
                padding:'10px 22px',
                background: validSelections.length > 0 ? G.green : G.dim,
                color:'#fff', border:'none', borderRadius:8, fontSize:13, fontWeight:800,
                cursor: (validSelections.length > 0 && !saving) ? 'pointer' : 'not-allowed'
              }}
            >
              {saving ? '⏳ Salvez...' : `💾 Salvează ${validSelections.length} alocări`}
            </button>
          </div>
        </div>
        
      </div>
    </div>
  )
}

const thStyle = {
  padding:'10px 10px', textAlign:'left', color:G.muted, fontWeight:700,
  fontSize:11, textTransform:'uppercase', letterSpacing:'.4px',
  background:G.surface
}
