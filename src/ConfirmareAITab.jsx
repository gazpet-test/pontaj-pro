// ConfirmareAITab.jsx
// 26.05.2026 - Etapa 4.6: Tab pentru confirmarea manuală a alimentărilor create de AI
// Pentru alimentari cu sursa_alocare_santier IN ('whatsapp_external_pending', 'plate_ai_orphan')
//
// Flow:
//   1. Vizualizare card cu poza + cifre extrase + plăcuța + autor + dată
//   2. Buton ✅ Confirmă cu alocare șantier inline
//   3. Buton ❌ Respinge cu confirm + opțional ștergere alimentare
//   4. Buton ✏️ Editează (deschide modal normal pentru ajustări)
//   5. Click poză → preview fullscreen

import { useState, useEffect, useCallback, useMemo } from 'react'

// Reutilizez G/S din scope-ul părinte (se vor pasa ca prop)
export default function ConfirmareAITab({ G, S, supabase, profile, accessLevel, sites, showToast, onSaved, onEdit }) {
  const [alim, setAlim] = useState([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(null)  // id-ul în curs de procesare
  const [previewUrl, setPreviewUrl] = useState(null)
  const [editingSite, setEditingSite] = useState({})  // { alimId: siteId }
  const [filter, setFilter] = useState('all')  // all / external / plate_ai
  const canEdit = accessLevel === 'admin' || accessLevel === 'editor' || profile?.is_owner
  
  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('logistica_alimentari')
        .select(`
          id, data_alimentare, cantitate_litri, pret_total, pret_per_litru,
          statie_combustibil, numar_factura, observatii, ocr_data, ocr_status,
          ocr_tip_dovada, sursa_alocare_santier,
          whatsapp_caption, whatsapp_autor, whatsapp_msg_dt, whatsapp_poza_path,
          site_id, active_id,
          active:logistica_active(id, nr_inmatriculare, marca, model, tip_carburant)
        `)
        .in('sursa_alocare_santier', ['whatsapp_external_pending', 'plate_ai_orphan'])
        .order('created_at', { ascending: false })
      
      if (error) throw error
      setAlim(data || [])
    } catch (e) {
      console.error('Eroare loadData ConfirmareAI:', e)
      showToast('Eroare încărcare alimentări: ' + e.message, 'error')
    } finally {
      setLoading(false)
    }
  }, [supabase, showToast])
  
  useEffect(() => { loadData() }, [loadData])
  
  // Filtru aplicat
  const filtered = useMemo(() => {
    if (filter === 'all') return alim
    if (filter === 'external') return alim.filter(a => a.sursa_alocare_santier === 'whatsapp_external_pending')
    if (filter === 'plate_ai') return alim.filter(a => a.sursa_alocare_santier === 'plate_ai_orphan')
    return alim
  }, [alim, filter])
  
  const stats = useMemo(() => ({
    total: alim.length,
    external: alim.filter(a => a.sursa_alocare_santier === 'whatsapp_external_pending').length,
    plate_ai: alim.filter(a => a.sursa_alocare_santier === 'plate_ai_orphan').length,
    cu_santier: alim.filter(a => a.site_id != null).length,
    fara_santier: alim.filter(a => a.site_id == null).length,
  }), [alim])
  
  // Preview poză cu signed URL (60 sec valid)
  const showPoza = async (path) => {
    if (!path) { showToast('Nicio poză atașată', 'warn'); return }
    try {
      const { data, error } = await supabase.storage
        .from('whatsapp-motorina-bonuri')
        .createSignedUrl(path, 60)
      if (error) throw error
      setPreviewUrl(data.signedUrl)
    } catch (e) {
      showToast('Eroare preview poză: ' + e.message, 'error')
    }
  }
  
  // Confirmă alimentare (cu opțional alocare șantier)
  const confirmAlim = async (id, siteId) => {
    if (!canEdit) { showToast('Nu ai permisiune', 'warn'); return }
    setProcessing(id)
    try {
      const updates = {
        ocr_status: 'accepted_manual',
        ocr_decided_by: profile?.id || null,
        ocr_decided_at: new Date().toISOString(),
        sursa_alocare_santier: 'whatsapp_external_confirmed',
      }
      if (siteId) updates.site_id = siteId
      
      const { error } = await supabase
        .from('logistica_alimentari')
        .update(updates)
        .eq('id', id)
      if (error) throw error
      
      showToast(`✅ Alimentare #${id} confirmată${siteId ? ' cu șantier' : ''}`, 'success')
      await loadData()
      if (onSaved) onSaved()
    } catch (e) {
      showToast('Eroare confirmare: ' + e.message, 'error')
    } finally {
      setProcessing(null)
    }
  }
  
  // Respinge alimentare (DELETE)
  const respingeAlim = async (id, doStetge = false) => {
    if (!canEdit) { showToast('Nu ai permisiune', 'warn'); return }
    const motiv = doStetge 
      ? `Sigur ștergi alimentarea #${id}? IREVERSIBIL.`
      : `Marchezi alimentarea #${id} ca respinsă (rămâne în BD ca audit)?`
    if (!confirm(motiv)) return
    
    setProcessing(id)
    try {
      if (doStetge) {
        const { error } = await supabase.from('logistica_alimentari').delete().eq('id', id)
        if (error) throw error
        showToast(`🗑️ Alimentare #${id} ștearsă`, 'success')
      } else {
        const { error } = await supabase
          .from('logistica_alimentari')
          .update({
            ocr_status: 'rejected_manual',
            ocr_decided_by: profile?.id || null,
            ocr_decided_at: new Date().toISOString(),
            sursa_alocare_santier: 'whatsapp_external_rejected',
          })
          .eq('id', id)
        if (error) throw error
        showToast(`❌ Alimentare #${id} marcată ca respinsă`, 'warn')
      }
      await loadData()
      if (onSaved) onSaved()
    } catch (e) {
      showToast('Eroare respingere: ' + e.message, 'error')
    } finally {
      setProcessing(null)
    }
  }
  
  if (loading) {
    return (
      <div style={{...S.card, padding: 60, textAlign: 'center'}}>
        <div style={{fontSize: 32, marginBottom: 10, opacity: 0.5}}>⏳</div>
        <div style={{color: G.muted}}>Încărcare alimentări de confirmat...</div>
      </div>
    )
  }
  
  if (alim.length === 0) {
    return (
      <div style={{...S.card, padding: 60, textAlign: 'center'}}>
        <div style={{fontSize: 48, marginBottom: 14}}>🎉</div>
        <div style={{fontSize: 16, fontWeight: 700, color: G.green, marginBottom: 8}}>
          Toate alimentările AI sunt deja confirmate
        </div>
        <div style={{fontSize: 12, color: G.muted, lineHeight: 1.6}}>
          Aici apar alimentările create automat din pozele WhatsApp orfane (poze fără caption).<br/>
          Vor apărea aici după ce rulezi Vision OCR pe poze noi orfane.
        </div>
      </div>
    )
  }
  
  return (
    <div>
      {/* Header cu stats */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', 
        gap: 10, marginBottom: 16,
      }}>
        <StatCard label="Total" val={stats.total} color={G.text} icon="📋" />
        <StatCard label="Bon extern AI" val={stats.external} color={G.purple} icon="🤖" />
        <StatCard label="Plate AI orphan" val={stats.plate_ai} color={G.blue} icon="🔍" />
        <StatCard label="Cu șantier" val={stats.cu_santier} color={G.green} icon="✓" />
        <StatCard label="Fără șantier" val={stats.fara_santier} color={G.orange} icon="⚠" />
      </div>
      
      {/* Filtru chips */}
      <div style={{display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap'}}>
        {[
          {key: 'all', label: 'Toate', icon: '📋'},
          {key: 'external', label: 'Bon extern AI', icon: '🤖'},
          {key: 'plate_ai', label: 'Plate AI orphan', icon: '🔍'},
        ].map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)} style={{
            padding: '8px 14px', borderRadius: 8, border: `1px solid ${filter === f.key ? G.logistica : G.border}`,
            background: filter === f.key ? G.logistica + '22' : G.surface,
            color: filter === f.key ? G.logistica : G.muted,
            fontSize: 12, fontWeight: filter === f.key ? 700 : 500, cursor: 'pointer',
          }}>
            {f.icon} {f.label}
          </button>
        ))}
      </div>
      
      {/* Card-uri alimentări */}
      <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(450px, 1fr))', gap: 14}}>
        {filtered.map(a => (
          <AlimCard 
            key={a.id} 
            alim={a} 
            G={G} S={S}
            sites={sites}
            editingSiteId={editingSite[a.id]}
            setEditingSiteId={(sid) => setEditingSite(prev => ({...prev, [a.id]: sid}))}
            onShowPoza={() => showPoza(a.whatsapp_poza_path)}
            onConfirm={(sid) => confirmAlim(a.id, sid)}
            onRespinge={(doDelete) => respingeAlim(a.id, doDelete)}
            onEdit={() => onEdit && onEdit(a)}
            processing={processing === a.id}
            canEdit={canEdit}
          />
        ))}
      </div>
      
      {/* Modal preview poză */}
      {previewUrl && (
        <div onClick={() => setPreviewUrl(null)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 9999,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, cursor: 'pointer',
        }}>
          <img src={previewUrl} alt="Bon WhatsApp" style={{
            maxWidth: '95%', maxHeight: '95vh', objectFit: 'contain', borderRadius: 8,
            boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
          }} />
          <button onClick={() => setPreviewUrl(null)} style={{
            position: 'absolute', top: 20, right: 20, padding: '10px 18px',
            background: G.red, color: '#fff', border: 'none', borderRadius: 8,
            fontSize: 14, fontWeight: 700, cursor: 'pointer',
          }}>✕ Închide</button>
        </div>
      )}
    </div>
  )
}

// ─────────────────────── Helpers UI ───────────────────────

function StatCard({ label, val, color, icon }) {
  return (
    <div style={{
      background: '#0f1117', border: `1px solid #2a2f3a`, borderRadius: 10,
      padding: 12, textAlign: 'center',
    }}>
      <div style={{fontSize: 20, marginBottom: 2}}>{icon}</div>
      <div style={{fontSize: 22, fontWeight: 900, color}}>{val}</div>
      <div style={{fontSize: 10, color: '#777', marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.5}}>{label}</div>
    </div>
  )
}

function AlimCard({ alim, G, S, sites, editingSiteId, setEditingSiteId, onShowPoza, onConfirm, onRespinge, onEdit, processing, canEdit }) {
  const v = alim.active || {}
  const isExternal = alim.sursa_alocare_santier === 'whatsapp_external_pending'
  const accentColor = isExternal ? G.purple : G.blue
  const sourceLabel = isExternal ? '🤖 Bon extern AI' : '🔍 Plate AI orphan'
  const ocrData = alim.ocr_data || {}
  const dataOld = alim.data_alimentare && new Date(alim.data_alimentare) < new Date('2026-01-01')
  
  return (
    <div style={{
      background: G.surface, border: `2px solid ${accentColor}44`, borderRadius: 12,
      padding: 14, position: 'relative', opacity: processing ? 0.5 : 1,
    }}>
      {/* Header */}
      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10}}>
        <div>
          <div style={{
            display: 'inline-block', padding: '3px 8px', borderRadius: 6,
            background: accentColor + '22', color: accentColor, fontSize: 10,
            fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5,
          }}>
            {sourceLabel} · #{alim.id}
          </div>
          {dataOld && (
            <div style={{
              display: 'inline-block', marginLeft: 6, padding: '3px 8px', borderRadius: 6,
              background: G.red + '22', color: G.red, fontSize: 10, fontWeight: 700,
            }}>⚠️ DATA VECHE</div>
          )}
        </div>
        <div style={{fontSize: 11, color: G.muted}}>
          📅 {alim.data_alimentare}
        </div>
      </div>
      
      {/* Vehicul + autor */}
      <div style={{fontSize: 14, fontWeight: 700, color: G.text, marginBottom: 4}}>
        🚛 {v.nr_inmatriculare || '?'} · {v.marca} {v.model}
      </div>
      <div style={{fontSize: 11, color: G.muted, marginBottom: 10}}>
        👤 {alim.whatsapp_autor || 'necunoscut'}
        {alim.whatsapp_msg_dt && (
          <span> · postat {new Date(alim.whatsapp_msg_dt).toLocaleDateString('ro-RO', {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'})}</span>
        )}
      </div>
      
      {/* Cifre extrase */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6,
        background: G.bg, borderRadius: 8, padding: 10, marginBottom: 10,
      }}>
        <CifreCell label="Litri" val={alim.cantitate_litri} />
        <CifreCell label="RON" val={alim.pret_total} />
        <CifreCell label="RON/L" val={alim.pret_per_litru || (alim.pret_total / alim.cantitate_litri).toFixed(2)} />
      </div>
      
      {/* Stație + tip dovadă */}
      <div style={{fontSize: 11, color: G.muted, marginBottom: 10, lineHeight: 1.5}}>
        🏪 {alim.statie_combustibil || 'necunoscut'}
        {alim.numar_factura && <span> · BF: {alim.numar_factura}</span>}
        <br/>
        📋 {alim.ocr_tip_dovada || 'unknown'} · {alim.ocr_status || 'pending'}
        {ocrData.confidence && <span> · conf {Number(ocrData.confidence).toFixed(2)}</span>}
      </div>
      
      {/* Alocare șantier dacă lipsește */}
      {!alim.site_id && (
        <div style={{
          background: G.bg, padding: 10, borderRadius: 8, marginBottom: 10,
          border: `1px solid ${G.orange}44`,
        }}>
          <div style={{fontSize: 11, fontWeight: 700, color: G.orange, marginBottom: 6}}>
            ⚠️ Șantier neasignat — alege înainte de confirmare:
          </div>
          <select 
            value={editingSiteId || ''} 
            onChange={(e) => setEditingSiteId(e.target.value ? Number(e.target.value) : null)}
            style={{
              width: '100%', padding: '7px 10px', background: G.surface, color: G.text,
              border: `1px solid ${G.border}`, borderRadius: 6, fontSize: 12,
            }}
            disabled={processing || !canEdit}
          >
            <option value="">— Selectează șantier —</option>
            {(sites || []).map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      )}
      {alim.site_id && (
        <div style={{fontSize: 11, color: G.green, marginBottom: 10}}>
          ✅ Șantier: {(sites || []).find(s => s.id === alim.site_id)?.name || `#${alim.site_id}`}
        </div>
      )}
      
      {/* Butoane acțiuni */}
      <div style={{display: 'flex', gap: 6, flexWrap: 'wrap'}}>
        {alim.whatsapp_poza_path && (
          <button onClick={onShowPoza} disabled={processing} style={{
            padding: '8px 12px', background: G.surface, color: G.text,
            border: `1px solid ${G.border}`, borderRadius: 7, fontSize: 11, fontWeight: 600,
            cursor: processing ? 'wait' : 'pointer',
          }}>📷 Vezi poza</button>
        )}
        {canEdit && (
          <>
            <button 
              onClick={() => onConfirm(editingSiteId)} 
              disabled={processing || (!alim.site_id && !editingSiteId)}
              style={{
                padding: '8px 14px', background: (!alim.site_id && !editingSiteId) ? G.dim : G.green,
                color: '#fff', border: 'none', borderRadius: 7, fontSize: 11, fontWeight: 700,
                cursor: processing || (!alim.site_id && !editingSiteId) ? 'not-allowed' : 'pointer',
                flex: 1, minWidth: 90,
              }}
              title={!alim.site_id && !editingSiteId ? 'Alege șantier mai întâi' : 'Confirmă alimentarea'}
            >✅ Confirmă</button>
            
            <button onClick={() => onEdit()} disabled={processing} style={{
              padding: '8px 12px', background: G.surface, color: G.text,
              border: `1px solid ${G.border}`, borderRadius: 7, fontSize: 11, fontWeight: 600,
              cursor: processing ? 'wait' : 'pointer',
            }}>✏️ Editează</button>
            
            <button onClick={() => onRespinge(false)} disabled={processing} style={{
              padding: '8px 12px', background: G.surface, color: G.orange,
              border: `1px solid ${G.orange}44`, borderRadius: 7, fontSize: 11, fontWeight: 600,
              cursor: processing ? 'wait' : 'pointer',
            }}>❌ Respinge</button>
            
            <button onClick={() => onRespinge(true)} disabled={processing} style={{
              padding: '8px 12px', background: G.surface, color: G.red,
              border: `1px solid ${G.red}44`, borderRadius: 7, fontSize: 11, fontWeight: 600,
              cursor: processing ? 'wait' : 'pointer',
            }}>🗑️ Șterge</button>
          </>
        )}
      </div>
    </div>
  )
}

function CifreCell({ label, val }) {
  return (
    <div style={{textAlign: 'center'}}>
      <div style={{fontSize: 16, fontWeight: 800, color: '#fff'}}>{val ? Number(val).toFixed(2) : '—'}</div>
      <div style={{fontSize: 9, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5}}>{label}</div>
    </div>
  )
}
