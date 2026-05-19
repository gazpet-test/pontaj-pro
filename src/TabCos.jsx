// ════════════════════════════════════════════════════════════════════════════
// MODULUL HR — Tab Coș (Recycle Bin)
// ════════════════════════════════════════════════════════════════════════════
// Etapa 13 (19.05.2026) — cerere Natalia: „nevoie de un coș în care să meargă
// autorizația ștearsă pentru câteva zile". Implementat unitar pentru:
//   - hr_autorizatii
//   - hr_documente_personale
//   - hr_semnaturi_electronice
// Soft-delete = UPDATE deleted_at = NOW() + deleted_by = uid.
// Cleanup definitiv = Edge Function cleanup-recycle-bin rulat zilnic prin
// pg_cron 07:00 UTC (09:00 RO vară). Retenție per modul configurabilă în
// setari_recycle_bin (default 30 zile).
// View unificat: v_recycle_bin_hr (3 UNION ALL).
// Acțiuni: ♻ Restaurează (UPDATE deleted_at=NULL) + ❌ Șterge definitiv (DELETE
// + storage cleanup imediat).
// Acces: doar utilizatori cu can_access_personal_data OR is_owner.
// ════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from './lib/supabase.js'

// ─── Theme (sincron cu HR.jsx) ──────────────────────────────────────────────
const G = {
  bg:'#0D1117', surface:'#161B22', border:'#21262D', border2:'#30363D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  blue:'#58A6FF', green:'#3FB950', red:'#F85149', yellow:'#D29922',
  purple:'#BC8CFF', orange:'#F0883E', hr:'#FF6B9D',
}
const S = {
  card: { background:G.surface, border:`1px solid ${G.border}`, borderRadius:12 },
  input: { background:G.bg, border:`1px solid ${G.border2}`, color:G.text, borderRadius:8, padding:'8px 12px', fontFamily:'inherit', fontSize:14, outline:'none', width:'100%' },
  btnP: { background:'#1F6FEB', color:'white', border:'none', borderRadius:8, padding:'9px 18px', fontFamily:'inherit', fontSize:14, fontWeight:700, cursor:'pointer' },
  btnS: { background:G.surface, color:G.text, border:`1px solid ${G.border}`, borderRadius:8, padding:'7px 14px', fontFamily:'inherit', fontSize:13, fontWeight:600, cursor:'pointer' },
}

const MODULE_INFO = {
  hr_autorizatii: { 
    label: 'Autorizație', icon: '📜', color: G.purple, bucket: 'autorizatii',
  },
  hr_documente_personale: { 
    label: 'Doc. personal', icon: '🆔', color: G.blue, bucket: 'hr-documente-personale',
  },
  hr_semnaturi_electronice: { 
    label: 'Semnătură', icon: '🖋️', color: G.orange, bucket: 'hr-semnaturi',
  },
}

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('ro-RO', { day:'2-digit', month:'2-digit', year:'numeric' }) : '—'
const fmtDateTime = (d) => d ? new Date(d).toLocaleString('ro-RO', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '—'

// ─── KPI ─────────────────────────────────────────────────────────────────────
function KPIMic({ icon, label, value, color = G.blue, sub }) {
  return (
    <div style={{...S.card, padding:'12px 16px', minWidth:140, flex:1}}>
      <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:4}}>
        <span style={{fontSize:20}}>{icon}</span>
        <span style={{fontSize:11, color:G.muted, fontWeight:600, textTransform:'uppercase', letterSpacing:0.5}}>{label}</span>
      </div>
      <div style={{fontSize:22, fontWeight:800, color}}>{value}</div>
      {sub && <div style={{fontSize:11, color:G.dim, marginTop:2}}>{sub}</div>}
    </div>
  )
}

// ─── Modal: Setări retenție (doar owner) ────────────────────────────────────
function SetariRetentieModal({ setari, onClose, onSaved, showToast }) {
  const [local, setLocal] = useState(() => 
    setari.reduce((acc, s) => ({ ...acc, [s.modul]: s.retentie_zile }), {})
  )
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    const { data: u } = await supabase.auth.getUser()
    const updates = setari.map(s => ({
      id: s.id, modul: s.modul, retentie_zile: Number(local[s.modul]) || 30,
      activ: true, updated_at: new Date().toISOString(), updated_by: u?.user?.id,
    }))
    const { error } = await supabase.from('setari_recycle_bin').upsert(updates, { onConflict: 'modul' })
    if (error) { showToast('Eroare: ' + error.message, 'error'); setSaving(false); return }
    showToast('✓ Setări salvate')
    setSaving(false)
    onSaved()
  }

  return (
    <div onClick={onClose} style={{
      position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', zIndex:1000,
      display:'flex', alignItems:'center', justifyContent:'center', padding:20,
    }}>
      <div onClick={e => e.stopPropagation()} style={{...S.card, padding:24, maxWidth:520, width:'100%'}}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:18}}>
          <h3 style={{margin:0, fontSize:18, color:G.text}}>⚙️ Setări retenție Coș HR</h3>
          <button onClick={onClose} style={{...S.btnS, padding:'4px 10px', fontSize:18}}>×</button>
        </div>
        <div style={{fontSize:12, color:G.muted, marginBottom:18, lineHeight:1.5}}>
          După câte zile elementele șterse devin definitiv șterse (împreună cu fișierele din Storage). Cleanup-ul rulează automat zilnic la 09:00.
        </div>
        <div style={{display:'grid', gap:14}}>
          {setari.map(s => {
            const info = MODULE_INFO[s.modul] || { label: s.modul, icon: '📁' }
            return (
              <div key={s.modul} style={{display:'flex', alignItems:'center', gap:12, padding:'10px 14px', background:G.bg, borderRadius:8, border:`1px solid ${G.border}`}}>
                <span style={{fontSize:24}}>{info.icon}</span>
                <div style={{flex:1}}>
                  <div style={{fontSize:14, color:G.text, fontWeight:600}}>{info.label}</div>
                  <div style={{fontSize:11, color:G.muted}}>{s.descriere}</div>
                </div>
                <input type="number" min="1" max="365" value={local[s.modul]} 
                  onChange={e => setLocal({...local, [s.modul]: e.target.value})}
                  style={{...S.input, width:80, textAlign:'center'}} />
                <span style={{fontSize:12, color:G.muted}}>zile</span>
              </div>
            )
          })}
        </div>
        <div style={{display:'flex', gap:8, marginTop:20, justifyContent:'flex-end'}}>
          <button onClick={onClose} style={S.btnS}>Anulează</button>
          <button onClick={save} disabled={saving} style={{...S.btnP, opacity: saving ? 0.5 : 1}}>
            {saving ? 'Se salvează…' : '💾 Salvează'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// COMPONENTĂ PRINCIPALĂ
// ════════════════════════════════════════════════════════════════════════════
export default function TabCos({ profile, showToast }) {
  const [items, setItems] = useState([])
  const [setari, setSetari] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterModul, setFilterModul] = useState('toate')
  const [search, setSearch] = useState('')
  const [setariOpen, setSetariOpen] = useState(false)

  const hasAccess = profile?.can_access_personal_data === true || profile?.is_owner === true
  const isOwner = profile?.is_owner === true

  const loadAll = useCallback(async () => {
    setLoading(true)
    const [itemsRes, setariRes] = await Promise.all([
      supabase.from('v_recycle_bin_hr').select('*').order('deleted_at', { ascending: false }),
      supabase.from('setari_recycle_bin').select('*').order('modul'),
    ])
    if (itemsRes.error) showToast('Eroare încărcare coș: ' + itemsRes.error.message, 'error')
    if (setariRes.error) showToast('Eroare încărcare setări: ' + setariRes.error.message, 'error')
    setItems(itemsRes.data || [])
    setSetari(setariRes.data || [])
    setLoading(false)
  }, [showToast])

  useEffect(() => {
    if (hasAccess) loadAll()
    else setLoading(false)
  }, [hasAccess, loadAll])

  // ─── Filtrare ─────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter(it => {
      if (filterModul !== 'toate' && it.modul !== filterModul) return false
      if (!q) return true
      return (it.employee_name || '').toLowerCase().includes(q) ||
             (it.detaliu_tip || '').toLowerCase().includes(q) ||
             (it.detaliu_extra || '').toLowerCase().includes(q) ||
             (it.deleted_by_name || '').toLowerCase().includes(q)
    })
  }, [items, filterModul, search])

  // ─── KPI ──────────────────────────────────────────────────────────────────
  const kpi = useMemo(() => {
    const total = items.length
    const aut = items.filter(i => i.modul === 'hr_autorizatii').length
    const doc = items.filter(i => i.modul === 'hr_documente_personale').length
    const sem = items.filter(i => i.modul === 'hr_semnaturi_electronice').length
    const expira1z = items.filter(i => (i.zile_ramase ?? 999) <= 1).length
    return { total, aut, doc, sem, expira1z }
  }, [items])

  // ─── Acțiuni ──────────────────────────────────────────────────────────────
  const restore = async (item) => {
    if (!confirm(`Restaurezi „${item.detaliu_tip}" pentru ${item.employee_name}?\n\nElementul va reveni în lista activă.`)) return
    const { error } = await supabase.from(item.modul)
      .update({ deleted_at: null, deleted_by: null })
      .eq('id', item.row_id)
    if (error) { showToast('Eroare restaurare: ' + error.message, 'error'); return }
    showToast(`♻ Restaurat: ${item.detaliu_tip} (${item.employee_name})`)
    loadAll()
  }

  const hardDelete = async (item) => {
    if (!confirm(
      `⚠️ ȘTERGE DEFINITIV „${item.detaliu_tip}" pentru ${item.employee_name}?\n\n` +
      `Fișierul din Storage (${item.fisier_nume || 'fără fișier'}) va fi șters PERMANENT.\n` +
      `Această acțiune NU POATE FI ANULATĂ.`
    )) return

    const info = MODULE_INFO[item.modul]
    // 1. Storage cleanup
    if (item.fisier_path && info) {
      const { error: stErr } = await supabase.storage.from(info.bucket).remove([item.fisier_path])
      if (stErr) console.warn('Storage cleanup error (ignorat):', stErr.message)
    }
    // 2. DELETE row
    const { error } = await supabase.from(item.modul).delete().eq('id', item.row_id)
    if (error) { showToast('Eroare ștergere definitivă: ' + error.message, 'error'); return }
    showToast(`❌ Șters definitiv: ${item.detaliu_tip} (${item.employee_name})`)
    loadAll()
  }

  // ─── Acces restricționat ──────────────────────────────────────────────────
  if (!hasAccess) {
    return (
      <div style={{...S.card, padding:40, textAlign:'center'}}>
        <div style={{fontSize:42, marginBottom:14}}>🔒</div>
        <div style={{fontSize:16, fontWeight:700, color:G.red, marginBottom:8}}>Acces restricționat</div>
        <div style={{fontSize:12, color:G.muted, maxWidth:480, margin:'0 auto', lineHeight:1.6}}>
          Coșul HR conține date personale GDPR-sensibile. Necesită bifa <strong style={{color:G.text}}>„Acces Date Personale"</strong> pe profil, setată de OWNER din Admin → Manageri.
        </div>
      </div>
    )
  }

  if (loading) {
    return <div style={{padding:40, textAlign:'center', color:G.muted, fontSize:14}}>Se încarcă coșul…</div>
  }

  return (
    <>
      {/* KPI Header */}
      <div style={{display:'flex', gap:12, marginBottom:14, flexWrap:'wrap'}}>
        <KPIMic icon="🗑" label="Total în coș" value={kpi.total} color={G.muted}
          sub={kpi.expira1z > 0 ? `⚠ ${kpi.expira1z} expiră în ≤1 zi` : 'toate cu retenție OK'} />
        <KPIMic icon="📜" label="Autorizații" value={kpi.aut} color={G.purple} />
        <KPIMic icon="🆔" label="Doc. personale" value={kpi.doc} color={G.blue} />
        <KPIMic icon="🖋️" label="Semnături" value={kpi.sem} color={G.orange} />
      </div>

      {/* Bară: filtru + search + setări */}
      <div style={{...S.card, padding:14, marginBottom:14}}>
        <div style={{display:'flex', gap:10, flexWrap:'wrap', alignItems:'center', marginBottom:10}}>
          <input placeholder="🔍 Caută angajat, tip document, numărul..." value={search} onChange={e => setSearch(e.target.value)}
            style={{...S.input, flex:1, minWidth:280}} />
          {isOwner && (
            <button onClick={() => setSetariOpen(true)} style={{...S.btnS, padding:'7px 12px', fontSize:12, color:G.muted}}>
              ⚙️ Setări retenție
            </button>
          )}
        </div>
        <div style={{display:'flex', gap:6, alignItems:'center', flexWrap:'wrap'}}>
          <span style={{fontSize:11, color:G.muted, fontWeight:600, marginRight:4}}>FILTRU:</span>
          {[
            { key:'toate', label:'Toate', icon:'📦', count: kpi.total },
            { key:'hr_autorizatii', label:'Autorizații', icon:'📜', count: kpi.aut, color:G.purple },
            { key:'hr_documente_personale', label:'Doc. personale', icon:'🆔', count: kpi.doc, color:G.blue },
            { key:'hr_semnaturi_electronice', label:'Semnături', icon:'🖋️', count: kpi.sem, color:G.orange },
          ].map(f => {
            const active = filterModul === f.key
            const accent = f.color || G.muted
            return (
              <button key={f.key} onClick={() => setFilterModul(f.key)} style={{
                ...S.btnS, padding:'6px 12px', fontSize:12, fontWeight:600,
                background: active ? accent + '22' : 'transparent',
                color: active ? accent : (f.count === 0 ? G.dim : G.muted),
                borderColor: active ? accent + '55' : G.border,
              }}>{f.icon} {f.label} {f.count > 0 && <span style={{opacity:.7, marginLeft:3}}>({f.count})</span>}</button>
            )
          })}
        </div>
      </div>

      {/* Listă */}
      {filtered.length === 0 ? (
        <div style={{...S.card, padding:40, textAlign:'center', color:G.muted, fontSize:14}}>
          <div style={{fontSize:48, marginBottom:12}}>🌱</div>
          <div style={{fontSize:16, marginBottom:6, color:G.text}}>
            {items.length === 0 ? 'Coș gol — nimic șters recent.' : `Niciun rezultat pentru filtrul curent.`}
          </div>
          <div style={{fontSize:12, color:G.dim, lineHeight:1.5, maxWidth:420, margin:'8px auto 0'}}>
            Documentele HR șterse vor apărea aici și vor fi păstrate timp de N zile (configurat per modul) înainte să fie șterse definitiv automat.
          </div>
        </div>
      ) : (
        <div style={{display:'grid', gap:8}}>
          {filtered.map(item => {
            const info = MODULE_INFO[item.modul] || { label: item.modul, icon: '📁', color: G.muted }
            const expiraCurand = (item.zile_ramase ?? 999) <= 3
            const expiraAzi = (item.zile_ramase ?? 999) <= 1
            return (
              <div key={`${item.modul}-${item.row_id}`} style={{
                ...S.card, padding:14,
                borderLeft: `3px solid ${expiraAzi ? G.red : expiraCurand ? G.yellow : info.color}`,
              }}>
                <div style={{display:'flex', gap:14, alignItems:'flex-start', flexWrap:'wrap'}}>
                  {/* Stânga: icon + tip */}
                  <div style={{display:'flex', flexDirection:'column', alignItems:'center', minWidth:60}}>
                    <span style={{fontSize:28}}>{info.icon}</span>
                    <span style={{fontSize:9, color:info.color, fontWeight:700, marginTop:2, textTransform:'uppercase', letterSpacing:0.3}}>{info.label}</span>
                  </div>

                  {/* Centru: detalii */}
                  <div style={{flex:1, minWidth:240}}>
                    <div style={{fontSize:15, color:G.text, fontWeight:600, marginBottom:4}}>
                      {item.detaliu_tip}
                      {item.detaliu_extra && item.detaliu_extra !== 'fără număr' && (
                        <span style={{marginLeft:8, fontSize:12, fontFamily:'ui-monospace, monospace', color:G.muted, background:G.bg, padding:'2px 6px', borderRadius:4}}>
                          {item.detaliu_extra}
                        </span>
                      )}
                    </div>
                    <div style={{fontSize:13, color:G.muted, marginBottom:4}}>
                      👤 <strong style={{color:G.text}}>{item.employee_name}</strong>
                      {item.functie && <span style={{marginLeft:8, color:G.dim}}>· {item.functie}</span>}
                    </div>
                    <div style={{fontSize:11, color:G.dim}}>
                      🗑 Șters {fmtDateTime(item.deleted_at)}
                      {item.deleted_by_name && <span> · de <strong style={{color:G.muted}}>{item.deleted_by_name}</strong></span>}
                      {item.fisier_nume && <span style={{marginLeft:10}}>📎 {item.fisier_nume}</span>}
                    </div>
                  </div>

                  {/* Dreapta: zile rămase + butoane */}
                  <div style={{display:'flex', flexDirection:'column', alignItems:'flex-end', gap:8, minWidth:180}}>
                    <div style={{
                      padding:'4px 10px', borderRadius:6, fontSize:11, fontWeight:700,
                      background: expiraAzi ? G.red+'22' : expiraCurand ? G.yellow+'22' : G.green+'22',
                      color:     expiraAzi ? G.red     : expiraCurand ? G.yellow     : G.green,
                    }}>
                      {item.zile_ramase === 0 ? '⏰ ȘTERG AZI' :
                       item.zile_ramase === 1 ? '⏰ Mâine șterg' :
                       `📅 ${item.zile_ramase} zile rămase`}
                    </div>
                    <div style={{fontSize:10, color:G.dim}}>șterg definitiv: {fmtDate(item.sterge_definitiv_pe)}</div>
                    <div style={{display:'flex', gap:6}}>
                      <button onClick={() => restore(item)} style={{
                        ...S.btnS, padding:'6px 12px', fontSize:12,
                        color:G.green, borderColor:G.green+'55', background:G.green+'11',
                      }}>♻ Restaurează</button>
                      <button onClick={() => hardDelete(item)} style={{
                        ...S.btnS, padding:'6px 10px', fontSize:12,
                        color:G.red, borderColor:G.red+'55',
                      }} title="Șterge definitiv ACUM">❌</button>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Footer hint */}
      <div style={{marginTop:14, padding:'10px 14px', fontSize:11, color:G.dim, textAlign:'center', lineHeight:1.5}}>
        💡 Cleanup automat zilnic la 09:00. Retenție configurabilă per modul (default 30 zile). Doar owner poate modifica setările.
      </div>

      {setariOpen && (
        <SetariRetentieModal
          setari={setari}
          onClose={() => setSetariOpen(false)}
          onSaved={() => { setSetariOpen(false); loadAll() }}
          showToast={showToast}
        />
      )}
    </>
  )
}
