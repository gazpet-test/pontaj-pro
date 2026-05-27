// ════════════════════════════════════════════════════════════════════════════
// SUGESTII SCORILOS — tab nou în Logistica pentru review/aprobare bot suggestions
// Etapa 12.8 (23.05.2026): UI listă + filtre + aplică/respinge per sugestie
// Vizibil pentru: profile.is_owner=true OR profile.role='admin_logistica' (regula 25.05.2026 Razvan)
// ════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from './lib/supabase.js'

// Paleta locală (subset din G global Logistica)
const G = {
  bg: '#0F1117', surface: '#1A1D24', surface2: '#22262E',
  text: '#E4E8EF', muted: '#8B92A0', border: '#2D3340',
  logistica: '#5DD4B5', blue: '#4DA8FF', red: '#F87171',
  yellow: '#F0C040', green: '#5DD4A0', orange: '#F0883E',
  purple: '#A98BE5', pink: '#E5709E',
}

// ─── Mapping pentru tipuri sugestii și severities ───────────────────────────
const TIP_META = {
  tip_carburant_lipsa: { label: 'Tip carburant', icon: '⛽', color: G.blue, aplicabil: true },
  norma_consum_lipsa: { label: 'Normă consum', icon: '📏', color: G.green, aplicabil: true },
  specs_negaste: { label: 'Specs negăsite', icon: '🔍', color: G.muted, aplicabil: false },
  pattern_recurent: { label: 'Pattern fraudă', icon: '🚨', color: G.red, aplicabil: false },
  drift_consum: { label: 'Drift consum', icon: '📈', color: G.yellow, aplicabil: false },
  anomalie_alimentare: { label: 'Anomalie alimentare', icon: '⚠️', color: G.orange, aplicabil: false },
  // 27.05.2026 Scorilos v16: Cross-check Rompetrol vs EvoGPS
  alim_fara_telemetrie: { label: 'Alim fără GPS', icon: '🛰️', color: '#A78BFA', aplicabil: false },
  km_discrepancy_evogps: { label: 'KM discrepancy', icon: '🚩', color: '#F97316', aplicabil: false },
  // 27.05.2026 Scorilos v17: Raport vehicule fără GPS montat (info, NU fraudă)
  vehicul_fara_gps_history: { label: 'GPS lipsă/defect', icon: '📡', color: '#0EA5E9', aplicabil: false },
  dimensiuni_lipsa: { label: 'Dimensiuni', icon: '📐', color: G.blue, aplicabil: false },
  dimensiuni_negaste: { label: 'Dim negăsite', icon: '🔍', color: G.muted, aplicabil: false },
}

const SEV_META = {
  critic: { label: 'CRITIC', color: G.red, bg: G.red + '22' },
  high: { label: 'HIGH', color: G.orange, bg: G.orange + '22' },
  info: { label: 'INFO', color: G.blue, bg: G.blue + '22' },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmtConf = (c) => c == null ? '—' : `${Math.round(Number(c) * 100)}%`
const fmtTime = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  const diff = (Date.now() - d.getTime()) / 1000
  if (diff < 60) return 'acum'
  if (diff < 3600) return `${Math.floor(diff/60)} min`
  if (diff < 86400) return `${Math.floor(diff/3600)} h`
  if (diff < 604800) return `${Math.floor(diff/86400)} zile`
  return d.toLocaleDateString('ro-RO', { day: '2-digit', month: 'short' })
}

// ─── Parser pentru valoare_noua de tipul "50 l/h" ────────────────────────────
function parseNormaConsum(text) {
  if (!text) return { norma: null, unitate: null }
  const m = String(text).trim().match(/^([\d.,]+)\s*(l\/h|l\/100km|kWh\/h|kWh\/100km)?$/i)
  if (!m) return { norma: null, unitate: null }
  const norma = parseFloat(String(m[1]).replace(',', '.'))
  const unitate = normalizeUnitate(m[2]) || 'l/h'
  return { norma: isNaN(norma) ? null : norma, unitate }
}

// Normalize tip_carburant — orice limbă/format → valoare BD validă
function normalizeTipCarburant(v) {
  if (!v) return null
  const s = String(v).toLowerCase().trim()
  if (/^(diesel|motorin[ăa]|gasóleo|gasoil|dizel)$/i.test(s)) return 'motorina'
  if (/^(benzin[ăa]|petrol|gasoline|essence|gasolina|95|98)$/i.test(s)) return 'benzina'
  if (/^(electric|electrico|electrique|ev|battery)$/i.test(s)) return 'electric'
  if (/^(hibrid|hybrid|hybride)$/i.test(s)) return 'hibrid'
  if (/^(gpl|lpg|autogas|propan|gaz)$/i.test(s)) return 'gpl'
  // Dacă valoarea e deja una validă în BD, o păstrăm
  if (['motorina','benzina','electric','hibrid','gpl','N/A'].includes(s)) return s
  return null
}

// Normalize unitate_norma
function normalizeUnitate(v) {
  if (!v) return null
  const s = String(v).toLowerCase().trim()
  if (/^l\s*\/\s*h$/.test(s)) return 'l/h'
  if (/^l\s*\/\s*100\s*km$/.test(s)) return 'l/100km'
  if (/^kwh\s*\/\s*h$/.test(s)) return 'kWh/h'
  if (/^kwh\s*\/\s*100\s*km$/.test(s)) return 'kWh/100km'
  return null
}

// ─── Component principal ──────────────────────────────────────────────────────
export default function SugestiiScorilosTab({ profile, showToast, onApplied, setTab, openActiv }) {
  const [sugestii, setSugestii] = useState([])
  const [load, setLoad] = useState(false)
  const [filterTip, setFilterTip] = useState('all')
  const [filterSev, setFilterSev] = useState('all')
  const [confirmApply, setConfirmApply] = useState(null) // sugestie de aprobat
  const [confirmReject, setConfirmReject] = useState(null) // sugestie de respins
  const [confirmAction, setConfirmAction] = useState(null) // sugestie pentru acțiune custom
  const [actionType, setActionType] = useState('') // deep_sleep | vandut | non_motor | feedback | edit_consum
  const [actionMotiv, setActionMotiv] = useState('') // motiv/feedback text liber
  const [actionNormaNoua, setActionNormaNoua] = useState('') // pentru edit_consum
  const [actionUnitateNoua, setActionUnitateNoua] = useState('l/h') // pentru edit_consum
  const [actionActivCurent, setActionActivCurent] = useState(null) // norma + unitate curente
  const [actionZileSilentiere, setActionZileSilentiere] = useState(7) // pentru silentiere
  const [processing, setProcessing] = useState(false)

  const loadSugestii = useCallback(async () => {
    setLoad(true)
    const { data, error } = await supabase
      .from('claude_bot_sugestii')
      .select('id, bot_run_id, tip_sugestie, tinta_tip, tinta_id, tinta_descriere, camp_propus, valoare_veche, valoare_noua, motivare, source_url, confidence, severity, status, created_at')
      .eq('status', 'propus')
      .eq('tinta_tip', 'logistica_active')
      .order('severity', { ascending: false })
      .order('confidence', { ascending: false, nullsLast: true })
      .order('created_at', { ascending: false })
      .limit(200)
    setLoad(false)
    if (error) {
      showToast('Eroare la încărcare sugestii: ' + error.message, 'error')
      return
    }
    setSugestii(data || [])
  }, [showToast])

  useEffect(() => { loadSugestii() }, [loadSugestii])

  // ─── Stats grupate pe tip ───────────────────────────────────────────────────
  const stats = useMemo(() => {
    const s = {}
    for (const sg of sugestii) {
      s[sg.tip_sugestie] = (s[sg.tip_sugestie] || 0) + 1
    }
    s._total = sugestii.length
    return s
  }, [sugestii])

  const statsSev = useMemo(() => {
    const s = { critic: 0, high: 0, info: 0 }
    for (const sg of sugestii) s[sg.severity || 'info'] = (s[sg.severity || 'info'] || 0) + 1
    return s
  }, [sugestii])

  // ─── Filtrare ───────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return sugestii.filter(sg => {
      if (filterTip !== 'all' && sg.tip_sugestie !== filterTip) return false
      if (filterSev !== 'all' && (sg.severity || 'info') !== filterSev) return false
      return true
    })
  }, [sugestii, filterTip, filterSev])

  // ─── Acțiuni: aprobă / respinge ─────────────────────────────────────────────
  const applyAprobat = async (sg) => {
    setProcessing(true)
    try {
      // 1. UPDATE pe logistica_active dacă sugestia e aplicabilă
      const tip = TIP_META[sg.tip_sugestie]
      if (tip?.aplicabil && sg.tinta_tip === 'logistica_active' && sg.tinta_id && sg.valoare_noua) {
        const upd = {}
        if (sg.camp_propus === 'tip_carburant') {
          // Normalize defensive: „Diesel" -> „motorina", „Petrol" -> „benzina", etc.
          const tipNormalizat = normalizeTipCarburant(sg.valoare_noua)
          if (!tipNormalizat) {
            showToast(`Valoarea „${sg.valoare_noua}" nu poate fi normalizată automat. Aplică manual din modul Active.`, 'warning')
            setProcessing(false)
            setConfirmApply(null)
            return
          }
          upd.tip_carburant = tipNormalizat
        } else if (sg.camp_propus === 'norma_consum') {
          const { norma, unitate } = parseNormaConsum(sg.valoare_noua)
          if (norma != null) {
            upd.norma_consum = norma
            upd.unitate_norma = unitate
          }
        }
        if (Object.keys(upd).length > 0) {
          // Adaug în observații audit
          const { data: actCur } = await supabase
            .from('logistica_active').select('observatii').eq('id', sg.tinta_id).maybeSingle()
          const obsAudit = `[Scorilos aprobat ${new Date().toLocaleString('ro-RO', { dateStyle: 'short' })}] ${sg.camp_propus}=${JSON.stringify(upd[sg.camp_propus] !== undefined ? upd[sg.camp_propus] : sg.valoare_noua)} (confidence ${fmtConf(sg.confidence)}${sg.source_url ? ', sursa: ' + sg.source_url : ''})`
          upd.observatii = (actCur?.observatii ? actCur.observatii + '\n' : '') + obsAudit
          
          const { error: errUpd } = await supabase
            .from('logistica_active').update(upd).eq('id', sg.tinta_id)
          if (errUpd) throw errUpd
        }
      }
      
      // 2. UPDATE pe sugestie status='aprobat'
      const { error: errSug } = await supabase
        .from('claude_bot_sugestii')
        .update({ 
          status: 'aprobat', 
          aprobat_de: profile?.id,
          aprobat_la: new Date().toISOString() 
        })
        .eq('id', sg.id)
      if (errSug) throw errSug
      
      showToast(`✓ Aplicat: ${sg.tinta_descriere}`, 'success')
      setConfirmApply(null)
      await loadSugestii()
      if (onApplied) onApplied()
    } catch (e) {
      showToast('Eroare aprobare: ' + (e.message || e), 'error')
    }
    setProcessing(false)
  }
  
  const applyRespins = async (sg) => {
    setProcessing(true)
    try {
      const { error } = await supabase
        .from('claude_bot_sugestii')
        .update({ 
          status: 'respins', 
          aprobat_de: profile?.id, 
          aprobat_la: new Date().toISOString() 
        })
        .eq('id', sg.id)
      if (error) throw error
      showToast(`✗ Respins: ${sg.tinta_descriere}`, 'info')
      setConfirmReject(null)
      await loadSugestii()
    } catch (e) {
      showToast('Eroare respingere: ' + (e.message || e), 'error')
    }
    setProcessing(false)
  }
  
  const mergiLaActiv = (sg) => {
    if (sg.tinta_tip === 'logistica_active' && sg.tinta_id) {
      // Preferat: deschide direct modal cu activul prin callback părinte
      if (openActiv) {
        openActiv(sg.tinta_id)
        return
      }
      // Fallback: doar navigare la tab Active
      if (setTab) {
        setTab('lista')
        showToast(`Caută activul #${sg.tinta_id}: ${sg.tinta_descriere}`, 'info')
      }
    }
  }
  
  // ─── Acțiune pe activ: deep_sleep / vandut / non_motor / feedback / edit_consum / silentiate ──
  const applyAction = async (sg, type, motiv) => {
    if (!type) {
      showToast('Selectează o acțiune', 'warning')
      return
    }
    if ((type === 'deep_sleep' || type === 'feedback' || type === 'silentiate') && !motiv?.trim()) {
      showToast('Motivul/feedback-ul e obligatoriu pentru această acțiune', 'warning')
      return
    }
    if (type === 'edit_consum') {
      const normaParsed = parseFloat(String(actionNormaNoua).replace(',', '.'))
      if (isNaN(normaParsed) || normaParsed < 0) {
        showToast('Norma trebuie să fie un număr valid (>= 0)', 'warning')
        return
      }
      if (!motiv?.trim()) {
        showToast('Motivul update-ului e obligatoriu pentru a păstra audit', 'warning')
        return
      }
    }
    if (type === 'silentiate') {
      const zile = parseInt(actionZileSilentiere)
      if (isNaN(zile) || zile < 1 || zile > 90) {
        showToast('Zilele trebuie să fie un număr între 1 și 90', 'warning')
        return
      }
    }
    setProcessing(true)
    try {
      const now = new Date()
      const dataStr = now.toLocaleString('ro-RO', { dateStyle: 'short' })
      const auditPrefix = `[Razvan + Scorilos ${dataStr}]`
      
      // SPECIAL: silentiate — NU modifică logistica_active, ci doar inserează în claude_bot_silentiate
      if (type === 'silentiate') {
        const zile = parseInt(actionZileSilentiere)
        const silentiatPana = new Date(now.getTime() + zile * 24 * 3600 * 1000).toISOString().slice(0, 10)
        
        // UPSERT: dacă există deja silentiere pentru aceeași combinație, o suprascriu
        const { error: errSil } = await supabase
          .from('claude_bot_silentiate')
          .upsert({
            tinta_tip: sg.tinta_tip,
            tinta_id: sg.tinta_id,
            tinta_descriere: sg.tinta_descriere,
            tip_sugestie: sg.tip_sugestie,
            silentiat_pana: silentiatPana,
            motiv: motiv,
            silentiat_de: profile?.id,
            silentiat_la: now.toISOString(),
          }, { onConflict: 'tinta_tip,tinta_id,tip_sugestie' })
        if (errSil) throw errSil
        
        // Marchez sugestia curentă ca auto_aplicat (dispare din UI)
        await supabase.from('claude_bot_sugestii').update({
          status: 'auto_aplicat',
          aprobat_de: profile?.id,
          aprobat_la: now.toISOString(),
          motivare: (sg.motivare || '') + `\n[Silentiat ${zile} zile (până ${silentiatPana}): ${motiv}]`,
        }).eq('id', sg.id)
        
        // Lecție pentru Scorilos
        await supabase.from('claude_context').insert({
          category: 'decision',
          title: `Silentiat ${sg.tip_sugestie} pentru ${sg.tinta_descriere} - ${zile} zile`,
          content: `Razvan a silentiat alerta "${sg.tip_sugestie}" pentru activul "${sg.tinta_descriere}" (id ${sg.tinta_id}) până la ${silentiatPana} (${zile} zile).\n\nMotiv: ${motiv}\n\nScorilos NU mai propune sugestie de acest tip pentru acest activ până la data expirării.`,
          priority: 'low',
          tags: ['scorilos_silentiat', `activ_${sg.tinta_id}`, `tip_${sg.tip_sugestie}`],
          active: true,
        })
        
        showToast(`🔇 Alertă silențiată ${zile} zile (până ${silentiatPana})`, 'success')
        closeActionModal()
        await loadSugestii()
        if (onApplied) onApplied()
        setProcessing(false)
        return
      }
      
      // 1. UPDATE logistica_active în funcție de acțiune
      if (sg.tinta_tip === 'logistica_active' && sg.tinta_id) {
        const upd = {}
        let auditMsg = ''
        
        if (type === 'deep_sleep') {
          upd.deep_sleep = true
          upd.deep_sleep_motiv = motiv
          upd.deep_sleep_data = now.toISOString().slice(0, 10)
          upd.deep_sleep_by = profile?.id
          auditMsg = `Marcat DEEP SLEEP: ${motiv}`
        } else if (type === 'vandut') {
          upd.vandut = true
          auditMsg = `Marcat VÂNDUT/SCOS DIN UZ${motiv ? ': ' + motiv : ''}`
        } else if (type === 'non_motor') {
          upd.non_motor = true
          if (!sg.tip_carburant) upd.tip_carburant = 'electric'
          if (sg.norma_consum == null) upd.norma_consum = 0
          auditMsg = `Marcat NON-MOTOR (echipament staționar fără combustibil)${motiv ? ': ' + motiv : ''}`
        } else if (type === 'edit_consum') {
          const normaParsed = parseFloat(String(actionNormaNoua).replace(',', '.'))
          const vechiNorma = actionActivCurent?.norma_consum
          const vechiUnitate = actionActivCurent?.unitate_norma
          upd.norma_consum = normaParsed
          upd.unitate_norma = actionUnitateNoua
          auditMsg = `Update normă consum: ${vechiNorma ?? '∅'} ${vechiUnitate ?? ''} → ${normaParsed} ${actionUnitateNoua} (motiv: ${motiv})`
        } else if (type === 'feedback') {
          auditMsg = `Feedback Razvan: ${motiv}`
        }
        
        // Adaug în observații
        const { data: actCur } = await supabase
          .from('logistica_active').select('observatii').eq('id', sg.tinta_id).maybeSingle()
        upd.observatii = (actCur?.observatii ? actCur.observatii + '\n' : '') + `${auditPrefix} ${auditMsg}`
        
        if (Object.keys(upd).length > 1) { // mai mult de doar observatii
          const { error: errUpd } = await supabase
            .from('logistica_active').update(upd).eq('id', sg.tinta_id)
          if (errUpd) throw errUpd
        } else {
          // doar observatii (caz feedback) — face UPDATE doar pe observatii
          await supabase.from('logistica_active').update({ observatii: upd.observatii }).eq('id', sg.tinta_id)
        }
      }
      
      // 2. Salvez lecția în claude_context pentru ca Scorilos să o citească la patrula viitoare
      const tags = ['scorilos_feedback', `activ_${sg.tinta_id}`, `actiune_${type}`]
      const titluLectie = type === 'feedback' 
        ? `Feedback Razvan pentru ${sg.tinta_descriere}`
        : type === 'edit_consum'
        ? `Normă consum actualizată pentru ${sg.tinta_descriere}`
        : `Activ ${sg.tinta_descriere} marcat ${type}`
      const continutLectie = `Activul "${sg.tinta_descriere}" (id ${sg.tinta_id}) a primit acțiune "${type}" prin UI Sugestii Scorilos pe ${dataStr}.\n\nMotiv/feedback Razvan: ${motiv || '(fără text)'}\n${type === 'edit_consum' ? `\nNormă veche: ${actionActivCurent?.norma_consum ?? '∅'} ${actionActivCurent?.unitate_norma ?? ''}\nNormă nouă: ${actionNormaNoua} ${actionUnitateNoua}\n` : ''}\nContext sugestie originală:\n- Tip: ${sg.tip_sugestie}\n- Motivare Scorilos: ${sg.motivare}\n${sg.source_url ? '- Sursă: ' + sg.source_url : ''}\n\nScorilos NU mai trebuie să propună acțiuni similare pe acest activ.`
      
      await supabase.from('claude_context').insert({
        category: (type === 'feedback' || type === 'edit_consum') ? 'razvan_pref' : 'decision',
        title: titluLectie,
        content: continutLectie,
        priority: 'medium',
        tags: tags,
        active: true,
      })
      
      // 3. Marchez sugestia ca auto_aplicat
      await supabase.from('claude_bot_sugestii').update({
        status: 'auto_aplicat',
        aprobat_de: profile?.id,
        aprobat_la: now.toISOString(),
        motivare: (sg.motivare || '') + `\n[Razvan: aplicat acțiune "${type}" → ${motiv || '(fără text)'}]`,
      }).eq('id', sg.id)
      
      const actLabel = {
        deep_sleep: '💤 Deep Sleep',
        vandut: '💰 Vândut',
        non_motor: '🔌 Non-motor',
        edit_consum: '📝 Normă consum',
        feedback: '💬 Feedback',
        silentiate: '🔇 Silentiat'
      }[type] || type
      
      showToast(`✓ ${actLabel} aplicat pe ${sg.tinta_descriere}`, 'success')
      closeActionModal()
      await loadSugestii()
      if (onApplied) onApplied()
    } catch (e) {
      showToast('Eroare acțiune: ' + (e.message || e), 'error')
    }
    setProcessing(false)
  }
  
  // ─── Handler pick acțiune: pentru edit_consum pre-load norma curenta ─────────
  const onPickAction = async (key) => {
    setActionType(key)
    setActionMotiv('')
    if (key === 'silentiate') {
      setActionZileSilentiere(7) // default 7 zile
    }
    if (key === 'edit_consum' && confirmAction?.tinta_id) {
      const { data } = await supabase.from('logistica_active')
        .select('norma_consum, unitate_norma')
        .eq('id', confirmAction.tinta_id).maybeSingle()
      if (data) {
        setActionActivCurent(data)
        if (data.norma_consum != null) setActionNormaNoua(String(data.norma_consum))
        if (data.unitate_norma) setActionUnitateNoua(data.unitate_norma)
      } else {
        setActionActivCurent({ norma_consum: null, unitate_norma: null })
      }
    }
  }
  
  // Reset state când se închide modalul de acțiune
  const closeActionModal = () => {
    setConfirmAction(null)
    setActionType('')
    setActionMotiv('')
    setActionNormaNoua('')
    setActionUnitateNoua('l/h')
    setActionActivCurent(null)
    setActionZileSilentiere(7)
  }
  
  // ─── Card sugestie ──────────────────────────────────────────────────────────
  const renderCard = (sg) => {
    const tip = TIP_META[sg.tip_sugestie] || { label: sg.tip_sugestie, icon: '?', color: G.muted, aplicabil: false }
    const sev = SEV_META[sg.severity || 'info']
    
    return (
      <div key={sg.id} style={{
        background: G.surface,
        border: `1px solid ${G.border}`,
        borderLeft: `4px solid ${sev.color}`,
        borderRadius: 10,
        padding: 14,
        marginBottom: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{
            width: 36, height: 36,
            background: tip.color + '22',
            borderRadius: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18,
            flexShrink: 0,
          }}>{tip.icon}</div>
          
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: tip.color, textTransform: 'uppercase', letterSpacing: 0.5 }}>{tip.label}</span>
              <span style={{
                fontSize: 10, fontWeight: 700,
                padding: '2px 7px', borderRadius: 4,
                background: sev.bg, color: sev.color,
              }}>{sev.label}</span>
              {sg.confidence != null && (
                <span style={{ fontSize: 11, color: G.muted }}>· Confidence: <strong style={{ color: G.text }}>{fmtConf(sg.confidence)}</strong></span>
              )}
              <span style={{ fontSize: 11, color: G.muted, marginLeft: 'auto' }}>{fmtTime(sg.created_at)}</span>
            </div>
            
            <div style={{ fontSize: 14, fontWeight: 600, color: G.text, marginBottom: 8 }}>
              {sg.tinta_descriere}
            </div>
            
            {tip.aplicabil && sg.valoare_noua && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 12px',
                background: G.surface2,
                borderRadius: 6,
                marginBottom: 8,
              }}>
                <span style={{ fontSize: 12, color: G.muted }}>Propunere:</span>
                {sg.valoare_veche && (
                  <>
                    <span style={{ fontSize: 13, color: G.muted, textDecoration: 'line-through' }}>{sg.valoare_veche}</span>
                    <span style={{ fontSize: 13, color: G.muted }}>→</span>
                  </>
                )}
                <span style={{ fontSize: 13, fontWeight: 700, color: tip.color }}>{sg.valoare_noua}</span>
                <span style={{ fontSize: 11, color: G.muted, marginLeft: 4 }}>pentru câmpul <code style={{ color: G.text }}>{sg.camp_propus}</code></span>
              </div>
            )}
            
            <div style={{ fontSize: 13, color: G.muted, lineHeight: 1.5, marginBottom: 10 }}>
              {sg.motivare}
            </div>
            
            {sg.source_url && (
              <a href={sg.source_url} target="_blank" rel="noopener noreferrer" style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                fontSize: 11, color: G.blue,
                textDecoration: 'none', marginBottom: 10,
                wordBreak: 'break-all',
              }}>
                🔗 {sg.source_url.length > 80 ? sg.source_url.slice(0, 80) + '…' : sg.source_url}
              </a>
            )}
            
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
              {tip.aplicabil && sg.valoare_noua ? (
                <button 
                  onClick={() => setConfirmApply(sg)}
                  disabled={processing}
                  style={{
                    padding: '7px 14px',
                    background: G.green + '22',
                    color: G.green,
                    border: `1px solid ${G.green}55`,
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: processing ? 'wait' : 'pointer',
                    fontFamily: 'inherit',
                  }}>
                  ✓ Aplică în BD
                </button>
              ) : (
                <button 
                  onClick={() => mergiLaActiv(sg)}
                  disabled={!openActiv && !setTab}
                  style={{
                    padding: '7px 14px',
                    background: G.blue + '22',
                    color: G.blue,
                    border: `1px solid ${G.blue}55`,
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}>
                  📍 Mergi la activ
                </button>
              )}
              
              {/* NOU: Acțiune custom pe activ */}
              {sg.tinta_tip === 'logistica_active' && sg.tinta_id && (
                <button 
                  onClick={() => { setConfirmAction(sg); setActionType(''); setActionMotiv('') }}
                  disabled={processing}
                  style={{
                    padding: '7px 14px',
                    background: G.purple + '22',
                    color: G.purple,
                    border: `1px solid ${G.purple}55`,
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: processing ? 'wait' : 'pointer',
                    fontFamily: 'inherit',
                  }}>
                  🛠️ Acțiune
                </button>
              )}
              
              <button 
                onClick={() => setConfirmReject(sg)}
                disabled={processing}
                style={{
                  padding: '7px 14px',
                  background: 'transparent',
                  color: G.muted,
                  border: `1px solid ${G.border}`,
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: processing ? 'wait' : 'pointer',
                  fontFamily: 'inherit',
                }}>
                ✗ Respinge
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }
  
  // ─── Modal acțiune custom (deep_sleep / vandut / non_motor / feedback / edit_consum) ──
  const renderActionModal = () => {
    if (!confirmAction) return null
    const sg = confirmAction
    
    const ACTIONS = [
      { 
        key: 'silentiate', 
        icon: '🔇', 
        label: 'Suspendă alerta (N zile)', 
        desc: 'Util când datele sunt insuficiente (puține alimentări/ore). Scorilos nu mai propune alertă de acest tip pentru acest activ N zile. Util pentru pattern fraudă incipient.',
        color: G.muted || '#8B949E',
        requireMotiv: true,
        motivLabel: 'De ce silențiezi (obligatoriu)',
        motivPlaceholder: 'Ex: date insuficiente, aștept mai multe alimentări/ore în sistem...',
      },
      { 
        key: 'edit_consum', 
        icon: '📝', 
        label: 'Editare normă consum', 
        desc: 'Actualizează norma de consum a utilajului direct, fără să intri în modul Active. Util când drift-ul indică o normă veche greșită.',
        color: G.yellow || '#D29922',
        requireMotiv: true,
        motivLabel: 'De ce schimbi norma (obligatoriu — audit)',
        motivPlaceholder: 'Ex: norma vechi era subestimată, recalibrat după media reală 30 zile...',
      },
      { 
        key: 'deep_sleep', 
        icon: '💤', 
        label: 'Deep Sleep', 
        desc: 'Utilaj stricat pe perioadă lungă (așteptare reparație/casare). Va fi exclus din alerte și scan-uri.',
        color: G.purple,
        requireMotiv: true,
        motivLabel: 'Motivul deep sleep (obligatoriu)',
        motivPlaceholder: 'Ex: așteaptă expertiza, decizie casare, vândut viitor...',
      },
      { 
        key: 'vandut', 
        icon: '💰', 
        label: 'Vândut / Scos din uz', 
        desc: 'Utilaj scos definitiv din flotă. Va fi ascuns din toate listările active.',
        color: G.orange,
        requireMotiv: false,
        motivLabel: 'Detalii (opțional)',
        motivPlaceholder: 'Ex: vândut 15.05.2026 către...',
      },
      { 
        key: 'non_motor', 
        icon: '🔌', 
        label: 'Non-motor (fără combustibil)', 
        desc: 'Echipament staționar (compresor electric, sudură electrofuziune, remorcă pasivă). Va fi exclus din scan consum.',
        color: G.green,
        requireMotiv: false,
        motivLabel: 'Detalii (opțional)',
        motivPlaceholder: 'Ex: alimentare 230V, fără motor termic...',
      },
      { 
        key: 'feedback', 
        icon: '💬', 
        label: 'Doar feedback pentru Scorilos', 
        desc: 'Salvează observații libere care vor influența patrulele viitoare. Activul rămâne neschimbat.',
        color: G.blue,
        requireMotiv: true,
        motivLabel: 'Mesaj pentru Scorilos (obligatoriu)',
        motivPlaceholder: 'Ex: motorul e demontat din 2023, nu mai propune normă...',
      },
    ]
    
    const actCurent = ACTIONS.find(a => a.key === actionType)
    const isEditConsum = actionType === 'edit_consum'
    const isSilentiate = actionType === 'silentiate'
    const submitDisabled = processing 
      || (actCurent?.requireMotiv && !actionMotiv.trim())
      || (isEditConsum && (!actionNormaNoua || isNaN(parseFloat(String(actionNormaNoua).replace(',','.')))))
      || (isSilentiate && (isNaN(parseInt(actionZileSilentiere)) || parseInt(actionZileSilentiere) < 1))
    
    return (
      <div onClick={closeActionModal} style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000, padding: 16,
      }}>
        <div onClick={e => e.stopPropagation()} style={{
          background: G.surface, borderRadius: 12,
          border: `1px solid ${G.border}`,
          padding: 22, width: '100%', maxWidth: 580,
          maxHeight: '90vh', overflowY: 'auto',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}>
          <h3 style={{ margin: '0 0 6px 0', fontSize: 16, color: G.text }}>
            🛠️ Acțiune pe activ
          </h3>
          <div style={{ fontSize: 12, color: G.muted, marginBottom: 14 }}>
            Decizii directe care se aplică pe activ + salvează context pentru Scorilos.
          </div>
          
          <div style={{ background: G.surface2, padding: 10, borderRadius: 6, marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: G.text }}>{sg.tinta_descriere}</div>
            <div style={{ fontSize: 11, color: G.muted, marginTop: 4 }}>
              {sg.motivare?.slice(0, 200)}{sg.motivare?.length > 200 ? '…' : ''}
            </div>
          </div>
          
          {/* Lista de acțiuni - butoane mari */}
          {!actionType && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {ACTIONS.map(a => (
                <button
                  key={a.key}
                  onClick={() => onPickAction(a.key)}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 12,
                    padding: '12px 14px',
                    background: G.surface2,
                    border: `1px solid ${G.border}`,
                    borderLeft: `4px solid ${a.color}`,
                    borderRadius: 8,
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all .15s',
                    fontFamily: 'inherit',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = a.color + '15'; e.currentTarget.style.borderColor = a.color + '88' }}
                  onMouseLeave={e => { e.currentTarget.style.background = G.surface2; e.currentTarget.style.borderColor = G.border }}
                >
                  <div style={{ fontSize: 22 }}>{a.icon}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: a.color, marginBottom: 3 }}>{a.label}</div>
                    <div style={{ fontSize: 11, color: G.muted, lineHeight: 1.4 }}>{a.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
          
          {/* Pas 2: introducere motiv (și norma pentru edit_consum) */}
          {actionType && actCurent && (
            <>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 12px',
                background: actCurent.color + '15',
                border: `1px solid ${actCurent.color}55`,
                borderRadius: 8,
                marginBottom: 14,
              }}>
                <div style={{ fontSize: 22 }}>{actCurent.icon}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: actCurent.color }}>{actCurent.label}</div>
                  <div style={{ fontSize: 11, color: G.muted, marginTop: 2 }}>{actCurent.desc}</div>
                </div>
                <button
                  onClick={() => { setActionType(''); setActionMotiv(''); setActionActivCurent(null); setActionNormaNoua(''); setActionUnitateNoua('l/h'); setActionZileSilentiere(7) }}
                  style={{
                    background: 'transparent', border: 'none',
                    color: G.muted, cursor: 'pointer', fontSize: 16,
                    fontFamily: 'inherit', padding: 4,
                  }}>← schimbă</button>
              </div>
              
              {/* SPECIAL: silentiate - input zile + butoane rapide */}
              {isSilentiate && (
                <div style={{ marginBottom: 14 }}>
                  <label style={{ display: 'block', fontSize: 12, color: G.muted, marginBottom: 5 }}>
                    Suspendă alerta pentru câte zile?
                  </label>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                    <input
                      type="number"
                      min="1"
                      max="90"
                      value={actionZileSilentiere}
                      onChange={e => setActionZileSilentiere(e.target.value)}
                      style={{
                        width: 100, padding: 10,
                        background: G.bg, color: G.text,
                        border: `1px solid ${G.border}`,
                        borderRadius: 6, fontSize: 14, fontFamily: 'inherit',
                        boxSizing: 'border-box',
                      }}/>
                    <span style={{ fontSize: 13, color: G.muted }}>zile</span>
                    {actionZileSilentiere && !isNaN(parseInt(actionZileSilentiere)) && (
                      <span style={{ fontSize: 11, color: G.muted, marginLeft: 4 }}>
                        → până {new Date(Date.now() + parseInt(actionZileSilentiere) * 86400000).toLocaleDateString('ro-RO')}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {[3, 7, 14, 30].map(z => (
                      <button
                        key={z}
                        type="button"
                        onClick={() => setActionZileSilentiere(z)}
                        style={{
                          padding: '5px 12px',
                          background: parseInt(actionZileSilentiere) === z ? (G.muted + '33') : 'transparent',
                          color: parseInt(actionZileSilentiere) === z ? G.text : G.muted,
                          border: `1px solid ${G.border}`,
                          borderRadius: 5,
                          fontSize: 11,
                          fontWeight: 500,
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                        }}>
                        {z} zile
                      </button>
                    ))}
                  </div>
                </div>
              )}
              
              {/* SPECIAL: edit_consum - input norma + select unitate */}
              {isEditConsum && (
                <>
                  <div style={{
                    background: G.bg, border: `1px dashed ${G.border}`,
                    padding: '10px 12px', borderRadius: 6, marginBottom: 12,
                    display: 'flex', alignItems: 'center', gap: 10,
                  }}>
                    <div style={{ fontSize: 12, color: G.muted }}>Norma curentă în BD:</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: G.text }}>
                      {actionActivCurent ? (
                        actionActivCurent.norma_consum != null 
                          ? `${actionActivCurent.norma_consum} ${actionActivCurent.unitate_norma || 'l/h'}`
                          : '∅ (nesetată)'
                      ) : 'se încarcă...'}
                    </div>
                  </div>
                  
                  <div style={{ marginBottom: 14, display: 'flex', gap: 10 }}>
                    <div style={{ flex: 2 }}>
                      <label style={{ display: 'block', fontSize: 12, color: G.muted, marginBottom: 5 }}>
                        Normă nouă
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        value={actionNormaNoua}
                        onChange={e => setActionNormaNoua(e.target.value)}
                        placeholder="Ex: 18.5"
                        style={{
                          width: '100%', padding: 10,
                          background: G.bg, color: G.text,
                          border: `1px solid ${G.border}`,
                          borderRadius: 6, fontSize: 14, fontFamily: 'inherit',
                          boxSizing: 'border-box',
                        }}/>
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={{ display: 'block', fontSize: 12, color: G.muted, marginBottom: 5 }}>
                        Unitate
                      </label>
                      <select
                        value={actionUnitateNoua}
                        onChange={e => setActionUnitateNoua(e.target.value)}
                        style={{
                          width: '100%', padding: 10,
                          background: G.bg, color: G.text,
                          border: `1px solid ${G.border}`,
                          borderRadius: 6, fontSize: 14, fontFamily: 'inherit',
                          boxSizing: 'border-box',
                        }}>
                        <option value="l/h">l/h</option>
                        <option value="l/100km">l/100km</option>
                        <option value="kWh/h">kWh/h</option>
                        <option value="kWh/100km">kWh/100km</option>
                      </select>
                    </div>
                  </div>
                </>
              )}
              
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 12, color: G.muted, marginBottom: 5 }}>
                  {actCurent.motivLabel}
                </label>
                <textarea
                  value={actionMotiv}
                  onChange={e => setActionMotiv(e.target.value)}
                  placeholder={actCurent.motivPlaceholder}
                  rows={isEditConsum ? 3 : 4}
                  style={{
                    width: '100%',
                    padding: 10,
                    background: G.bg,
                    color: G.text,
                    border: `1px solid ${G.border}`,
                    borderRadius: 6,
                    fontSize: 13,
                    fontFamily: 'inherit',
                    resize: 'vertical',
                    boxSizing: 'border-box',
                  }}/>
              </div>
              
              <div style={{ 
                fontSize: 11, color: G.muted, 
                background: G.surface2, padding: 10, borderRadius: 6,
                marginBottom: 14,
              }}>
                💡 Lecția se salvează în <code style={{color:G.text}}>claude_context</code> ca Scorilos să o citească la patrula viitoare și să NU mai propună acțiuni similare.
              </div>
            </>
          )}
          
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
            <button 
              onClick={closeActionModal}
              disabled={processing}
              style={{
                padding: '8px 16px',
                background: 'transparent',
                color: G.muted,
                border: `1px solid ${G.border}`,
                borderRadius: 6,
                fontSize: 13,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}>
              Anulează
            </button>
            {actionType && (
              <button 
                onClick={() => applyAction(sg, actionType, actionMotiv)}
                disabled={submitDisabled}
                style={{
                  padding: '8px 18px',
                  background: actCurent?.color || G.green,
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: processing ? 'wait' : 'pointer',
                  fontFamily: 'inherit',
                  opacity: submitDisabled ? 0.5 : 1,
                }}>
                {processing ? '…' : `${actCurent?.icon} Aplică ${actCurent?.label}`}
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }
  
  // ─── Modal confirmare ───────────────────────────────────────────────────────
  const renderConfirmModal = () => {
    const sg = confirmApply || confirmReject
    if (!sg) return null
    const isApply = !!confirmApply
    const tip = TIP_META[sg.tip_sugestie] || { label: sg.tip_sugestie, icon: '?' }
    
    return (
      <div onClick={() => { setConfirmApply(null); setConfirmReject(null) }} style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000, padding: 16,
      }}>
        <div onClick={e => e.stopPropagation()} style={{
          background: G.surface, borderRadius: 12,
          border: `1px solid ${G.border}`,
          padding: 22, width: '100%', maxWidth: 500,
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}>
          <h3 style={{ margin: '0 0 12px 0', fontSize: 16, color: G.text }}>
            {isApply ? '✓ Aplică sugestia?' : '✗ Respinge sugestia?'}
          </h3>
          
          <div style={{ background: G.surface2, padding: 12, borderRadius: 8, marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: G.muted, textTransform: 'uppercase', marginBottom: 4 }}>{tip.label}</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: G.text, marginBottom: 8 }}>{sg.tinta_descriere}</div>
            {isApply && sg.valoare_noua && (
              <div style={{ fontSize: 13, color: G.muted }}>
                Setez <code style={{ color: G.text }}>{sg.camp_propus} = {sg.valoare_noua}</code>
              </div>
            )}
            {!isApply && (
              <div style={{ fontSize: 13, color: G.muted }}>
                Sugestia va fi marcată respinsă și nu va mai apărea în review.
              </div>
            )}
          </div>
          
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button 
              onClick={() => { setConfirmApply(null); setConfirmReject(null) }}
              disabled={processing}
              style={{
                padding: '8px 16px',
                background: 'transparent',
                color: G.muted,
                border: `1px solid ${G.border}`,
                borderRadius: 6,
                fontSize: 13,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}>
              Anulează
            </button>
            <button 
              onClick={() => isApply ? applyAprobat(sg) : applyRespins(sg)}
              disabled={processing}
              style={{
                padding: '8px 18px',
                background: isApply ? G.green : G.red,
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 600,
                cursor: processing ? 'wait' : 'pointer',
                fontFamily: 'inherit',
              }}>
              {processing ? '…' : (isApply ? '✓ Aplică' : '✗ Respinge')}
            </button>
          </div>
        </div>
      </div>
    )
  }
  
  // ─── Render principal ──────────────────────────────────────────────────────
  // FIX 25.05.2026: vizibil pentru toți din departamentul Logistica (owner + admin_logistica)
  const canSeeScorilos = !!profile?.is_owner || profile?.role === 'admin_logistica'
  if (!canSeeScorilos) {
    return (
      <div style={{
        padding: 30, textAlign: 'center', background: G.surface,
        borderRadius: 10, border: `1px solid ${G.border}`, color: G.muted,
      }}>
        🛡️ Acces restricționat — doar membrii departamentului Logistică pot revizui sugestiile Scorilos.
      </div>
    )
  }
  
  return (
    <div>
      {/* Header cu stats */}
      <div style={{
        background: `linear-gradient(135deg, ${G.purple}11, ${G.logistica}11)`,
        border: `1px solid ${G.border}`,
        borderRadius: 12, padding: 18,
        marginBottom: 14,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <div style={{ fontSize: 28 }}>⚔️</div>
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: 18, color: G.text }}>Sugestii Scorilos</h2>
            <div style={{ fontSize: 12, color: G.muted, marginTop: 2 }}>
              Patrula nocturnă propune. Tu validezi. {stats._total > 0 ? `${stats._total} sugestii pentru review.` : 'Nimic nou momentan.'}
            </div>
          </div>
          <button 
            onClick={loadSugestii}
            disabled={load}
            style={{
              padding: '8px 14px',
              background: G.logistica + '22',
              color: G.logistica,
              border: `1px solid ${G.logistica}55`,
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              cursor: load ? 'wait' : 'pointer',
              fontFamily: 'inherit',
            }}>
            {load ? '⟳ Se încarcă…' : '🔄 Reîncarcă'}
          </button>
        </div>
        
        {stats._total > 0 && (
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            {Object.entries(TIP_META).map(([key, meta]) => {
              const count = stats[key] || 0
              if (count === 0) return null
              return (
                <div key={key} style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '6px 12px',
                  background: meta.color + '15',
                  borderRadius: 7,
                  fontSize: 12,
                  color: meta.color,
                  fontWeight: 600,
                }}>
                  <span>{meta.icon}</span>
                  <span>{meta.label}:</span>
                  <strong style={{ fontSize: 13 }}>{count}</strong>
                </div>
              )
            })}
          </div>
        )}
      </div>
      
      {/* Filtre */}
      {stats._total > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: G.muted, marginRight: 4 }}>Filtru:</span>
          
          {[
            { key: 'all', label: 'Toate', count: stats._total },
            ...Object.entries(TIP_META).map(([key, meta]) => ({ 
              key, label: meta.icon + ' ' + meta.label, count: stats[key] || 0, color: meta.color 
            })).filter(x => x.count > 0)
          ].map(opt => (
            <button 
              key={opt.key}
              onClick={() => setFilterTip(opt.key)}
              style={{
                padding: '5px 11px',
                background: filterTip === opt.key ? (opt.color || G.logistica) + '33' : 'transparent',
                color: filterTip === opt.key ? (opt.color || G.logistica) : G.muted,
                border: `1px solid ${filterTip === opt.key ? (opt.color || G.logistica) + '88' : G.border}`,
                borderRadius: 16,
                fontSize: 11,
                fontWeight: filterTip === opt.key ? 700 : 500,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}>
              {opt.label} <span style={{ opacity: 0.7 }}>({opt.count})</span>
            </button>
          ))}
          
          <div style={{ width: 1, height: 24, background: G.border, margin: '0 4px' }} />
          
          {[
            { key: 'all', label: 'Toate', count: stats._total },
            { key: 'critic', label: '🔴 Critic', count: statsSev.critic, color: G.red },
            { key: 'high', label: '🟠 High', count: statsSev.high, color: G.orange },
            { key: 'info', label: '🔵 Info', count: statsSev.info, color: G.blue },
          ].filter(x => x.count > 0).map(opt => (
            <button 
              key={'sev_' + opt.key}
              onClick={() => setFilterSev(opt.key)}
              style={{
                padding: '5px 11px',
                background: filterSev === opt.key ? (opt.color || G.logistica) + '33' : 'transparent',
                color: filterSev === opt.key ? (opt.color || G.logistica) : G.muted,
                border: `1px solid ${filterSev === opt.key ? (opt.color || G.logistica) + '88' : G.border}`,
                borderRadius: 16,
                fontSize: 11,
                fontWeight: filterSev === opt.key ? 700 : 500,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}>
              {opt.label} <span style={{ opacity: 0.7 }}>({opt.count})</span>
            </button>
          ))}
        </div>
      )}
      
      {/* Listă sugestii */}
      {load && filtered.length === 0 && (
        <div style={{ padding: 40, textAlign: 'center', color: G.muted }}>⏳ Scorilos își descarcă raportul…</div>
      )}
      
      {!load && filtered.length === 0 && stats._total === 0 && (
        <div style={{
          padding: 50, textAlign: 'center',
          background: G.surface, borderRadius: 10, border: `1px solid ${G.border}`,
        }}>
          <div style={{ fontSize: 42, marginBottom: 10 }}>🛡️</div>
          <div style={{ fontSize: 16, color: G.text, fontWeight: 600, marginBottom: 4 }}>Nicio sugestie pendentă</div>
          <div style={{ fontSize: 13, color: G.muted }}>
            Scorilos verifică din nou la 05:00–06:15 dimineața.<br />
            Toate sugestiile aprobate/respinse rămân în istoric.
          </div>
        </div>
      )}
      
      {!load && filtered.length === 0 && stats._total > 0 && (
        <div style={{ padding: 30, textAlign: 'center', color: G.muted }}>
          Nicio sugestie cu filtrul curent. Schimbă filtrul.
        </div>
      )}
      
      {filtered.map(renderCard)}
      
      {renderConfirmModal()}
      {renderActionModal()}
    </div>
  )
}
