// ===========================================================================
// SugestiiChuckTab.jsx — Tab "Chuck Norris" în HR (sugestii bot HR)
// v1 — 24.05.2026
// "Chuck Norris nu intra in BD, BD intra in Chuck Norris."
// ===========================================================================
import { useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase.js'

// Theme HR (compatibil cu HR.jsx)
const G = {
  bg:'#0D1117', surface:'#161B22', card:'#161B22', text:'#E6EDF3', muted:'#8B949E',
  border:'#30363D', border2:'#21262D',
  blue:'#1F6FEB', green:'#2EA043', yellow:'#D29922', orange:'#F0883E', red:'#F85149', purple:'#A371F7',
  hr:'#EC6CB9', pink:'#EC6CB9',
}

// Meta tipuri sugestii Chuck
const TIP_META = {
  autorizatie_expirata: { 
    emoji: '🚨', label: 'Autorizație expirată', color: G.red,
    desc: 'Autorizația e deja expirată — angajatul lucrează neautorizat'
  },
  autorizatie_expira_30z: { 
    emoji: '⚠️', label: 'Expiră în 30 zile', color: G.orange,
    desc: 'Programare reînnoire urgentă'
  },
  autorizatie_expira_60z: { 
    emoji: '📅', label: 'Expiră în 60 zile', color: G.yellow,
    desc: 'Early warning — planificare reînnoire'
  },
  angajat_fara_aviz_medical: { 
    emoji: '🩺', label: 'Fără aviz medical', color: G.red,
    desc: 'Angajat activ fără aviz medical valid în sistem'
  },
}

const SEVERITY_META = {
  critic: { color: G.red, label: 'CRITIC', bg: G.red + '22' },
  high:   { color: G.orange, label: 'HIGH', bg: G.orange + '22' },
  info:   { color: G.blue, label: 'INFO', bg: G.blue + '22' },
}

// ─────────────────────────────────────────────────────────────────────────
// COMPONENT PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────
export default function SugestiiChuckTab({ profile, employees, autorizatii, showToast, onReload, openEmployee }) {
  const [sugestii, setSugestii] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterTip, setFilterTip] = useState('all')
  const [filterSev, setFilterSev] = useState('all')
  const [lastRun, setLastRun] = useState(null)
  const [running, setRunning] = useState(false)
  const [confirmAction, setConfirmAction] = useState(null) // { sg, type }
  const [actionMotiv, setActionMotiv] = useState('')
  const [actionZile, setActionZile] = useState(7)
  const [processing, setProcessing] = useState(false)
  
  // ─── Load sugestii Chuck ───────────────────────────────────────────────
  const loadSugestii = async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('claude_bot_sugestii')
        .select('*')
        .in('tinta_tip', ['hr_autorizatii', 'employee'])
        .eq('status', 'propus')
        .order('created_at', { ascending: false })
        .limit(200)
      if (error) throw error
      setSugestii(data || [])
      
      // Ultima patrulă Chuck
      const { data: runs } = await supabase
        .from('claude_bot_runs')
        .select('id, run_type, finished_at, sugestii_create, alerte_emise, duration_ms')
        .like('run_type', 'chuck_%')
        .or('run_type.eq.manual')
        .order('id', { ascending: false })
        .limit(1)
      // Filter manual la cele specifice Chuck (cele cu sugestii hr_*)
      if (runs && runs.length > 0) {
        setLastRun(runs[0])
      }
    } catch (e) {
      showToast?.('Eroare load Chuck: ' + (e.message || e), 'error')
    }
    setLoading(false)
  }
  
  useEffect(() => { loadSugestii() }, [])
  
  // ─── Rulează patrula manual ────────────────────────────────────────────
  const runChuckPatrol = async () => {
    setRunning(true)
    try {
      const SUPABASE_URL = supabase.supabaseUrl
      const r = await fetch(`${SUPABASE_URL}/functions/v1/chuck_norris_hr_bot`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-bot-secret': 'nenicu-patrol-2026',
        },
        body: JSON.stringify({ run_type: 'manual_chuck_ui' }),
      })
      const data = await r.json()
      if (data.error) throw new Error(data.error)
      showToast?.(`🥋 Chuck a vorbit! ${data.sugestii_create || 0} sugestii noi în ${data.output_text?.match(/\d+ms/)?.[0] || '?'}`, 'success')
      await loadSugestii()
      if (onReload) onReload()
    } catch (e) {
      showToast?.('Chuck refuză 403: ' + (e.message || e), 'error')
    }
    setRunning(false)
  }
  
  // ─── Filtrare ──────────────────────────────────────────────────────────
  const sugestiiFiltrate = useMemo(() => {
    return sugestii.filter(s => {
      if (filterTip !== 'all' && s.tip_sugestie !== filterTip) return false
      if (filterSev !== 'all' && s.severity !== filterSev) return false
      return true
    })
  }, [sugestii, filterTip, filterSev])
  
  // ─── Counts per tip pentru chip-uri filtru ─────────────────────────────
  const countByTip = useMemo(() => {
    const m = {}
    sugestii.forEach(s => { m[s.tip_sugestie] = (m[s.tip_sugestie] || 0) + 1 })
    return m
  }, [sugestii])
  
  const countBySev = useMemo(() => {
    const m = { critic: 0, high: 0, info: 0 }
    sugestii.forEach(s => { if (m[s.severity] != null) m[s.severity]++ })
    return m
  }, [sugestii])
  
  // ─── Click "Mergi la angajat" ──────────────────────────────────────────
  const handleMergi = async (sg) => {
    let empId = null
    if (sg.tinta_tip === 'employee') {
      empId = Number(sg.tinta_id)
    } else if (sg.tinta_tip === 'hr_autorizatii') {
      // Caut employee_id din autorizatii prop sau BD
      const aut = (autorizatii || []).find(a => a.id === Number(sg.tinta_id))
      if (aut) {
        empId = aut.employee_id
      } else {
        const { data } = await supabase.from('hr_autorizatii').select('employee_id').eq('id', sg.tinta_id).maybeSingle()
        if (data) empId = data.employee_id
      }
    }
    if (!empId) {
      showToast?.('Nu găsesc angajatul pentru această sugestie', 'warning')
      return
    }
    if (openEmployee) {
      openEmployee(empId)
    } else {
      showToast?.('Funcție openEmployee neimplementată în parent', 'warning')
    }
  }
  
  // ─── Click acțiune: silentiate / respinge ──────────────────────────────
  const openActionModal = (sg, type) => {
    setConfirmAction({ sg, type })
    setActionMotiv('')
    setActionZile(7)
  }
  
  const closeActionModal = () => {
    setConfirmAction(null)
    setActionMotiv('')
    setActionZile(7)
  }
  
  const applyAction = async () => {
    const { sg, type } = confirmAction
    if (!actionMotiv.trim()) {
      showToast?.('Motivul e obligatoriu', 'warning')
      return
    }
    setProcessing(true)
    try {
      const now = new Date()
      
      if (type === 'silentiate') {
        const zile = parseInt(actionZile)
        if (isNaN(zile) || zile < 1 || zile > 90) {
          showToast?.('Zile între 1-90', 'warning')
          setProcessing(false)
          return
        }
        const silentiatPana = new Date(now.getTime() + zile * 86400000).toISOString().slice(0, 10)
        
        const { error: errSil } = await supabase
          .from('claude_bot_silentiate')
          .upsert({
            tinta_tip: sg.tinta_tip,
            tinta_id: sg.tinta_id,
            tinta_descriere: sg.tinta_descriere,
            tip_sugestie: sg.tip_sugestie,
            silentiat_pana: silentiatPana,
            motiv: actionMotiv,
            silentiat_de: profile?.id,
            silentiat_la: now.toISOString(),
          }, { onConflict: 'tinta_tip,tinta_id,tip_sugestie' })
        if (errSil) throw errSil
        
        await supabase.from('claude_bot_sugestii').update({
          status: 'auto_aplicat',
          aprobat_de: profile?.id,
          aprobat_la: now.toISOString(),
          motivare: (sg.motivare || '') + `\n[Chuck: silentiat ${zile} zile (până ${silentiatPana}): ${actionMotiv}]`,
        }).eq('id', sg.id)
        
        showToast?.(`🔇 Alertă silențiată ${zile} zile (până ${silentiatPana})`, 'success')
      }
      
      if (type === 'respinge') {
        await supabase.from('claude_bot_sugestii').update({
          status: 'respins',
          aprobat_de: profile?.id,
          aprobat_la: now.toISOString(),
          respins_motiv: actionMotiv,
        }).eq('id', sg.id)
        
        showToast?.('❌ Sugestie respinsă', 'success')
      }
      
      closeActionModal()
      await loadSugestii()
      if (onReload) onReload()
    } catch (e) {
      showToast?.('Eroare: ' + (e.message || e), 'error')
    }
    setProcessing(false)
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: 4 }}>
      {/* Header card Chuck Norris */}
      <div style={{
        background: `linear-gradient(135deg, ${G.surface} 0%, ${G.surface} 70%, ${G.red}11 100%)`,
        border: `1px solid ${G.border}`,
        borderRadius: 12,
        padding: 18,
        marginBottom: 16,
        display: 'flex',
        alignItems: 'center',
        gap: 16,
      }}>
        <div style={{ fontSize: 44 }}>🥋</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: G.text, marginBottom: 4 }}>
            Chuck Norris HR Bot
          </div>
          <div style={{ fontSize: 12, color: G.muted, fontStyle: 'italic' }}>
            "Chuck Norris nu intră în BD. BD intră în Chuck Norris."
          </div>
          <div style={{ fontSize: 11, color: G.muted, marginTop: 6 }}>
            Patrulează zilnic 07:00 RO · {sugestii.length} sugestii active
            {lastRun?.finished_at && (
              <> · Ultima patrulă: {new Date(lastRun.finished_at).toLocaleString('ro-RO', { dateStyle: 'short', timeStyle: 'short' })}</>
            )}
          </div>
        </div>
        <button
          onClick={runChuckPatrol}
          disabled={running}
          style={{
            padding: '12px 18px',
            background: running ? G.muted : G.red,
            color: '#fff',
            border: 'none',
            borderRadius: 10,
            cursor: running ? 'wait' : 'pointer',
            fontSize: 13,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
          title="Rulează manual o patrulă Chuck Norris">
          {running ? '⏳ Patrulează...' : '🥋 Rulează acum'}
        </button>
      </div>
      
      {/* Filtre */}
      <div style={{ marginBottom: 14 }}>
        {/* Filtru pe TIP */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          <button
            onClick={() => setFilterTip('all')}
            style={chipStyle(filterTip === 'all', G.purple)}>
            Toate <span style={badgeStyle(filterTip === 'all', G.purple)}>{sugestii.length}</span>
          </button>
          {Object.entries(TIP_META).map(([key, meta]) => {
            const count = countByTip[key] || 0
            if (count === 0) return null
            return (
              <button
                key={key}
                onClick={() => setFilterTip(filterTip === key ? 'all' : key)}
                style={chipStyle(filterTip === key, meta.color)}>
                <span style={{ fontSize: 16 }}>{meta.emoji}</span> {meta.label}
                <span style={badgeStyle(filterTip === key, meta.color)}>{count}</span>
              </button>
            )
          })}
        </div>
        
        {/* Filtru pe SEVERITY */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            onClick={() => setFilterSev('all')}
            style={{ ...chipStyle(filterSev === 'all', G.muted), padding: '6px 14px', fontSize: 12 }}>
            Toate <span style={badgeStyle(filterSev === 'all', G.muted)}>{sugestii.length}</span>
          </button>
          {Object.entries(SEVERITY_META).map(([key, meta]) => {
            const count = countBySev[key] || 0
            if (count === 0) return null
            return (
              <button
                key={key}
                onClick={() => setFilterSev(filterSev === key ? 'all' : key)}
                style={{ ...chipStyle(filterSev === key, meta.color), padding: '6px 14px', fontSize: 12 }}>
                <span>●</span> {meta.label}
                <span style={badgeStyle(filterSev === key, meta.color)}>{count}</span>
              </button>
            )
          })}
        </div>
      </div>
      
      {/* Lista sugestii */}
      {loading && <div style={{ padding: 60, textAlign: 'center', color: G.muted }}>Chuck se gândește...</div>}
      
      {!loading && sugestiiFiltrate.length === 0 && (
        <div style={{
          padding: 60, textAlign: 'center', color: G.muted,
          background: G.surface, border: `1px solid ${G.border}`, borderRadius: 12,
        }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🥋</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: G.text, marginBottom: 4 }}>
            Chuck nu a găsit nimic.
          </div>
          <div style={{ fontSize: 12 }}>
            Toate autorizațiile valide, toți angajații cu aviz medical. Pace în trupă. 👌
          </div>
        </div>
      )}
      
      {!loading && sugestiiFiltrate.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {sugestiiFiltrate.map(sg => {
            const meta = TIP_META[sg.tip_sugestie] || { emoji: '❓', label: sg.tip_sugestie, color: G.muted, desc: '' }
            const sev = SEVERITY_META[sg.severity] || { color: G.muted, label: sg.severity, bg: G.muted + '22' }
            const createdMin = Math.round((Date.now() - new Date(sg.created_at).getTime()) / 60000)
            const ageStr = createdMin < 60 ? `${createdMin} min` 
              : createdMin < 1440 ? `${Math.round(createdMin / 60)} h`
              : `${Math.round(createdMin / 1440)} zile`
            
            return (
              <div key={sg.id} style={{
                background: G.surface,
                border: `1px solid ${G.border}`,
                borderLeft: `3px solid ${meta.color}`,
                borderRadius: 10,
                padding: 14,
              }}>
                {/* Header row */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 18 }}>{meta.emoji}</span>
                      <span style={{
                        fontSize: 10, fontWeight: 700, color: meta.color,
                        textTransform: 'uppercase', letterSpacing: 0.5,
                      }}>
                        {meta.label}
                      </span>
                      <span style={{
                        fontSize: 9, fontWeight: 700, color: sev.color,
                        background: sev.bg, padding: '2px 7px', borderRadius: 4,
                        letterSpacing: 0.5,
                      }}>
                        {sev.label}
                      </span>
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: G.text }}>
                      {sg.tinta_descriere}
                    </div>
                  </div>
                  <div style={{ fontSize: 10, color: G.muted, whiteSpace: 'nowrap' }}>
                    {ageStr}
                  </div>
                </div>
                
                {/* Motivare */}
                <div style={{
                  fontSize: 12, color: G.muted, lineHeight: 1.5,
                  padding: '8px 10px', background: G.bg, borderRadius: 6,
                  marginBottom: 10, border: `1px solid ${G.border}`,
                }}>
                  {sg.motivare}
                </div>
                
                {/* Acțiuni */}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    onClick={() => handleMergi(sg)}
                    style={btnStyle(G.blue)}>
                    📍 Mergi la angajat
                  </button>
                  <button
                    onClick={() => openActionModal(sg, 'silentiate')}
                    style={btnStyle(G.muted)}>
                    🔇 Suspendă alerta
                  </button>
                  <button
                    onClick={() => openActionModal(sg, 'respinge')}
                    style={{ ...btnStyle(G.muted), opacity: 0.7 }}>
                    ❌ Respinge
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
      
      {/* Modal acțiune (silentiate / respinge) */}
      {confirmAction && (
        <div onClick={closeActionModal} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000, padding: 16,
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: G.surface, border: `1px solid ${G.border}`,
            borderRadius: 12, padding: 22, maxWidth: 500, width: '100%',
          }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: G.text, marginBottom: 6 }}>
              {confirmAction.type === 'silentiate' ? '🔇 Suspendă alerta' : '❌ Respinge sugestia'}
            </div>
            <div style={{ fontSize: 12, color: G.muted, marginBottom: 14 }}>
              <strong>{confirmAction.sg.tinta_descriere}</strong>
            </div>
            
            {confirmAction.type === 'silentiate' && (
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 12, color: G.muted, marginBottom: 5 }}>
                  Suspendă pentru câte zile?
                </label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                  <input
                    type="number" min="1" max="90"
                    value={actionZile}
                    onChange={e => setActionZile(e.target.value)}
                    style={{
                      width: 100, padding: 10,
                      background: G.bg, color: G.text,
                      border: `1px solid ${G.border}`,
                      borderRadius: 6, fontSize: 14,
                      boxSizing: 'border-box',
                    }}/>
                  <span style={{ fontSize: 13, color: G.muted }}>zile</span>
                  {actionZile && !isNaN(parseInt(actionZile)) && (
                    <span style={{ fontSize: 11, color: G.muted, marginLeft: 4 }}>
                      → până {new Date(Date.now() + parseInt(actionZile) * 86400000).toLocaleDateString('ro-RO')}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {[3, 7, 14, 30].map(z => (
                    <button
                      key={z}
                      type="button"
                      onClick={() => setActionZile(z)}
                      style={{
                        padding: '5px 12px',
                        background: parseInt(actionZile) === z ? (G.muted + '33') : 'transparent',
                        color: parseInt(actionZile) === z ? G.text : G.muted,
                        border: `1px solid ${G.border}`,
                        borderRadius: 5,
                        fontSize: 11, fontWeight: 500, cursor: 'pointer',
                      }}>
                      {z} zile
                    </button>
                  ))}
                </div>
              </div>
            )}
            
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 12, color: G.muted, marginBottom: 5 }}>
                {confirmAction.type === 'silentiate' 
                  ? 'De ce silențiezi? (obligatoriu)'
                  : 'Motiv respingere (obligatoriu)'}
              </label>
              <textarea
                value={actionMotiv}
                onChange={e => setActionMotiv(e.target.value)}
                rows={3}
                style={{
                  width: '100%', padding: 10,
                  background: G.bg, color: G.text,
                  border: `1px solid ${G.border}`,
                  borderRadius: 6, fontSize: 13, fontFamily: 'inherit',
                  resize: 'vertical', boxSizing: 'border-box',
                }}
                placeholder={confirmAction.type === 'silentiate'
                  ? 'Ex: angajat în concediu, programare prelungită...'
                  : 'Ex: nu mai e angajat, autorizație în reînnoire externă...'}
              />
            </div>
            
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={closeActionModal} style={btnStyle(G.muted)}>
                Anulează
              </button>
              <button
                onClick={applyAction}
                disabled={processing || !actionMotiv.trim()}
                style={{
                  ...btnStyle(confirmAction.type === 'silentiate' ? G.muted : G.red),
                  opacity: (processing || !actionMotiv.trim()) ? 0.5 : 1,
                  cursor: (processing || !actionMotiv.trim()) ? 'not-allowed' : 'pointer',
                }}>
                {processing ? '⏳ ...' : (confirmAction.type === 'silentiate' ? '🔇 Silentiez' : '❌ Respinge')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers stiluri
// ─────────────────────────────────────────────────────────────────────────
function chipStyle(active, color) {
  return {
    padding: '8px 16px',
    background: active ? (color + '22') : 'transparent',
    color: active ? color : G.muted,
    border: `2px solid ${active ? color : G.border}`,
    borderRadius: 22,
    fontSize: 13, fontWeight: 600,
    cursor: 'pointer',
    display: 'flex', alignItems: 'center', gap: 8,
    fontFamily: 'inherit',
    transition: 'all 0.15s',
  }
}

function badgeStyle(active, color) {
  return {
    padding: '2px 8px',
    background: active ? color : G.border,
    color: active ? '#fff' : G.muted,
    borderRadius: 10,
    fontSize: 11, fontWeight: 700,
    minWidth: 22, textAlign: 'center',
  }
}

function btnStyle(color) {
  return {
    padding: '8px 14px',
    background: color + '22',
    color: color,
    border: `1px solid ${color}44`,
    borderRadius: 6,
    fontSize: 12, fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  }
}
