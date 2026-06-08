// ===========================================================================
// CONTRACTE COMERCIALE — Tab Administrativ
// 07.06.2026 v1 — Lista upstream/downstream + modal adăugare
// Fundație BD: contracte_terti extins + contracte_linii + v_contracte_cu_linii
// ===========================================================================

import { useState, useEffect, useMemo } from 'react'
import { supabase } from './lib/supabase.js'

const G = {
  bg:'#0D1117', surface:'#161B22', card:'#161B22', text:'#E6EDF3',
  muted:'#8B949E', dim:'#6E7681', border:'#30363D', border2:'#21262D',
  orange:'#F0883E', purple:'#A371F7', blue:'#1F6FEB', green:'#2EA043',
  yellow:'#D29922', red:'#F85149',
}

const S = {
  card: { background: G.card, borderRadius: 12, border: `1px solid ${G.border}` },
  btnP: { padding: '9px 16px', background: G.orange, color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  input: { width: '100%', padding: '9px 12px', background: G.bg, color: G.text, border: `1px solid ${G.border}`, borderRadius: 8, fontSize: 13, outline: 'none', boxSizing: 'border-box' },
  label: { fontSize: 11, fontWeight: 700, color: G.muted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4, display: 'block' },
  select: { width: '100%', padding: '9px 12px', background: G.bg, color: G.text, border: `1px solid ${G.border}`, borderRadius: 8, fontSize: 13, outline: 'none', boxSizing: 'border-box', cursor: 'pointer' },
}

// ─── Meta date tipuri + roluri ─────────────────────────────────────────────
const TIP_META = {
  asociere:         { label: 'Asociere',         emoji: '🤝', color: G.blue },
  subcontractare:   { label: 'Subcontractare',   emoji: '📋', color: G.yellow },
  prestari_servicii:{ label: 'Prestări Servicii',emoji: '🔧', color: G.purple },
}

const ROL_META = {
  lider:                   { label: 'Asociat Lider',          color: G.green },
  asociat_simplu:          { label: 'Asociat Simplu',         color: G.blue },
  asociat_unic:            { label: 'Asociat Unic',           color: G.orange },
  subcontractor_declarat:  { label: 'Subctr. Declarat',       color: G.yellow },
  subcontractor_parcurs:   { label: 'Subctr. pe Parcurs',     color: G.orange },
  prestator:               { label: 'Prestator',              color: G.purple },
}

const ROLURI_PER_TIP = {
  asociere:          ['lider', 'asociat_simplu', 'asociat_unic'],
  subcontractare:    ['subcontractor_declarat', 'subcontractor_parcurs'],
  prestari_servicii: ['prestator'],
}

const STATUS_META = {
  activ:     { label: 'Activ',     color: G.green },
  draft:     { label: 'Draft',     color: G.yellow },
  suspendat: { label: 'Suspendat', color: G.orange },
  reziliat:  { label: 'Reziliat',  color: G.red },
  finalizat: { label: 'Finalizat', color: G.muted },
}

function fmtRON(v) {
  if (!v) return '—'
  return Number(v).toLocaleString('ro-RO', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' RON'
}

// ─── Badge helper ───────────────────────────────────────────────────────────
function Badge({ label, color, emoji }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 5, fontSize: 11, fontWeight: 700,
      background: (color || G.muted) + '22', color: color || G.muted,
      border: `1px solid ${(color || G.muted)}44`,
    }}>
      {emoji && <span>{emoji}</span>}{label}
    </span>
  )
}

// ─── Card contract ──────────────────────────────────────────────────────────
function ContractCard({ c, isOwner, onEdit, onViewLinii, downstreamList=[], dsSearch='', onDsSearch }) {
  const tip = TIP_META[c.tip_contract]
  const rol = ROL_META[c.rol_gazpet]
  const st  = STATUS_META[c.status] || STATUS_META.draft
  const isDownstream = c.sens === 'plata'
  const [expanded, setExpanded] = useState(false)
  const [localSearch, setLocalSearch] = useState('')

  return (
    <div style={{
      ...S.card, padding: '14px 18px', marginBottom: 8,
      borderLeft: `3px solid ${isDownstream ? G.purple : G.blue}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        {/* Icon sens */}
        <div style={{
          width: 36, height: 36, borderRadius: 8, flexShrink: 0,
          background: (isDownstream ? G.purple : G.blue) + '22',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 18,
        }}>
          {isDownstream ? '🔽' : '🔼'}
        </div>

        {/* Conținut */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: G.text }}>
              {c.numar_contract ? `Nr. ${c.numar_contract}` : '—'}
            </span>
            <Badge label={st.label} color={st.color} />
            {tip && <Badge label={tip.label} color={tip.color} emoji={tip.emoji} />}
            {rol && <Badge label={rol.label} color={rol.color} />}
            {/* Alerte critice */}
            {isDownstream && !c.contract_parinte_id && (
              <Badge label="⚠️ Fără contract mamă" color={G.red} />
            )}
            {c.data_termen && new Date(c.data_termen) < new Date() && (
              <Badge label="❌ Expirat" color={G.red} />
            )}
            {c.data_termen && new Date(c.data_termen) > new Date() &&
             new Date(c.data_termen) < new Date(Date.now() + 30*24*3600*1000) && (
              <Badge label="⏳ Expiră în 30 zile" color={G.yellow} />
            )}
            {c.nr_pret_depasit_neaprobat > 0 && (
              <Badge label={`⚠️ ${c.nr_pret_depasit_neaprobat} preț depășit`} color={G.red} />
            )}
          </div>

          <div style={{ fontSize: 13, color: G.text, fontWeight: 600, marginBottom: 4, lineHeight: 1.4 }}>
            {c.denumire?.length > 100 ? c.denumire.slice(0, 100) + '…' : c.denumire}
          </div>

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12, color: G.muted }}>
            {(c.beneficiar_name || c.partener_text) && (
              <span>👤 {c.beneficiar_name || c.partener_text}</span>
            )}
            {c.site_qr && <span>📍 {c.site_qr}</span>}
            {c.data_semnare && <span>📅 {c.data_semnare}</span>}
            {c.termen_plata_zile && <span>⏱️ {c.termen_plata_zile}z plată</span>}
            {c.garantie_buna_executie_pct && <span>🔐 GBE {c.garantie_buna_executie_pct}%</span>}
            {c.parinte_numar && (
              <span style={{ color: G.purple }}>🔗 din contract nr. {c.parinte_numar}</span>
            )}
          </div>

          {/* Downstream: sumar clickabil + expand lista */}
          {!isDownstream && c.nr_downstream > 0 && (
            <div style={{ marginTop: 8 }}>
              <button onClick={e => { e.stopPropagation(); setExpanded(v => !v) }} style={{
                width: '100%', textAlign: 'left', padding: '5px 10px', borderRadius: 6, cursor: 'pointer',
                background: expanded ? G.purple + '22' : G.purple + '11',
                border: `1px solid ${G.purple}${expanded ? '66' : '33'}`,
                fontSize: 11, color: G.purple, fontWeight: 600,
                display: 'flex', alignItems: 'center', gap: 6, userSelect: 'none',
              }}>
                <span>{expanded ? '▾' : '▸'}</span>
                📎 {c.nr_downstream} contract{c.nr_downstream > 1 ? 'e' : ''} cu prestatori
                {c.valoare_downstream_total > 0 && ` · ${fmtRON(c.valoare_downstream_total)}`}
                <span style={{ marginLeft: 'auto', fontSize: 10, opacity: 0.7 }}>{expanded ? '▲ Ascunde' : '▼ Vezi lista'}</span>
              </button>
              {expanded && (
                <div style={{ marginTop: 8, padding: '10px 12px', background: G.bg, border: `1px solid ${G.border}`, borderRadius: 8 }}>
                  {/* Search downstream */}
                  {downstreamList.length > 3 && (
                    <input value={localSearch} onChange={e => setLocalSearch(e.target.value)}
                      placeholder="🔍 Caută în contractele cu prestatori..."
                      style={{ width: '100%', padding: '6px 10px', background: G.surface, border: `1px solid ${G.border}`, borderRadius: 6, color: G.text, fontSize: 12, marginBottom: 8, boxSizing: 'border-box' }} />
                  )}
                  {/* Lista downstream filtrata */}
                  {downstreamList
                    .filter(d => !localSearch || (d.denumire || '').toLowerCase().includes(localSearch.toLowerCase()) || (d.numar_contract || '').toLowerCase().includes(localSearch.toLowerCase()) || (d.partener_text || '').toLowerCase().includes(localSearch.toLowerCase()))
                    .map(d => {
                      const dSt = STATUS_META[d.status] || STATUS_META.draft
                      const dTip = TIP_META[d.tip_contract]
                      return (
                        <div key={d.id} style={{ padding: '8px 10px', marginBottom: 6, borderRadius: 6, background: G.surface, border: `1px solid ${G.border}`, display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, flexWrap: 'wrap' }}>
                              <span style={{ fontSize: 11, fontWeight: 700, color: G.text, fontFamily: 'monospace' }}>Nr. {d.numar_contract || '—'}</span>
                              <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: dSt.color + '22', color: dSt.color, fontWeight: 700 }}>{dSt.label}</span>
                              {dTip && <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: dTip.color + '22', color: dTip.color }}>{dTip.emoji} {dTip.label}</span>}
                            </div>
                            <div style={{ fontSize: 12, color: G.text, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.denumire}</div>
                            <div style={{ fontSize: 11, color: G.muted }}>{d.partener_text || d.beneficiar_name || '—'}{d.site_qr && ` · 📍 ${d.site_qr}`}</div>
                          </div>
                          <div style={{ textAlign: 'right', flexShrink: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: G.purple }}>↑ {fmtRON(d.valoare_lei)}</div>
                            <div style={{ display: 'flex', gap: 4, marginTop: 4, justifyContent: 'flex-end' }}>
                              <button onClick={() => onViewLinii(d)} style={{ padding: '3px 8px', background: G.blue + '22', color: G.blue, border: `1px solid ${G.blue}44`, borderRadius: 4, cursor: 'pointer', fontSize: 10 }}>📋 Linii ({d.nr_linii || 0})</button>
                              {isOwner && <button onClick={() => onEdit(d)} style={{ padding: '3px 8px', background: G.orange + '22', color: G.orange, border: `1px solid ${G.orange}44`, borderRadius: 4, cursor: 'pointer', fontSize: 10 }}>✏️</button>}
                            </div>
                          </div>
                        </div>
                      )
                    })
                  }
                  {downstreamList.filter(d => !localSearch || (d.denumire || '').toLowerCase().includes(localSearch.toLowerCase()) || (d.numar_contract || '').toLowerCase().includes(localSearch.toLowerCase()) || (d.partener_text || '').toLowerCase().includes(localSearch.toLowerCase())).length === 0 && (
                    <div style={{ textAlign: 'center', padding: '12px 0', color: G.muted, fontSize: 12 }}>Niciun contract găsit</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Valoare + acțiuni */}
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: isDownstream ? G.red : G.green, marginBottom: 4 }}>
            {isDownstream ? '↑' : '↓'} {fmtRON(c.valoare_lei)}
          </div>
          {c.nr_acte_aditionale > 0 && (
            <div style={{ fontSize: 11, color: G.muted, marginBottom: 6 }}>
              +{c.nr_acte_aditionale} acte adiționale
            </div>
          )}
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 4 }}>
            <button onClick={() => onViewLinii(c)} style={{
              padding: '5px 10px', background: G.blue + '22', color: G.blue,
              border: `1px solid ${G.blue}44`, borderRadius: 6, cursor: 'pointer',
              fontSize: 11, fontWeight: 600,
            }}>📋 Linii ({c.nr_linii})</button>
            {(isOwner) && (
              <button onClick={() => onEdit(c)} style={{
                padding: '5px 10px', background: G.orange + '22', color: G.orange,
                border: `1px solid ${G.orange}44`, borderRadius: 6, cursor: 'pointer',
                fontSize: 11, fontWeight: 600,
              }}>✏️</button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Modal contract nou/editare ─────────────────────────────────────────────
function ModalContract({ contract, contracteUpstream, sites, beneficiari, profile, onClose, onSaved }) {
  const isEdit = !!contract?.id
  const isOwner = profile?.is_owner === true

  const [form, setForm] = useState({
    numar_contract: contract?.numar_contract || '',
    denumire: contract?.denumire || '',
    tip_contract: contract?.tip_contract || 'subcontractare',
    rol_gazpet: contract?.rol_gazpet || '',
    sens: contract?.sens || 'incasare',
    status: contract?.status || 'draft',
    valoare_lei: contract?.valoare_lei || '',
    data_semnare: contract?.data_semnare || '',
    data_termen: contract?.data_termen || '',
    termen_plata_zile: contract?.termen_plata_zile || '',
    garantie_buna_executie_pct: contract?.garantie_buna_executie_pct || '',
    contract_parinte_id: contract?.contract_parinte_id || '',
    site_id: contract?.site_id || '',
    beneficiar_id: contract?.beneficiar_id || '',
    partener_text: contract?.partener_text || '',
    observatii: contract?.observatii || '',
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [pdfFile, setPdfFile] = useState(null)
  const [pdfUploading, setPdfUploading] = useState(false)
  const [pdfPath, setPdfPath] = useState(contract?.pdf_path || '')

  async function handlePdfSelect(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.includes('pdf')) { setErr('Doar fișiere PDF.'); return }
    if (file.size > 20 * 1024 * 1024) { setErr('PDF prea mare (max 20MB).'); return }
    setPdfFile(file)
  }

  async function uploadPdf(contractId) {
    if (!pdfFile) return pdfPath || null
    setPdfUploading(true)
    try {
      const ext = 'pdf'
      const path = `contracte-comerciale/${contractId}_${Date.now()}.${ext}`
      const { error } = await supabase.storage.from('contracte-terti').upload(path, pdfFile, { upsert: true, contentType: 'application/pdf' })
      if (error) throw error
      setPdfPath(path)
      return path
    } catch (e) {
      setErr('Eroare upload PDF: ' + e.message)
      return null
    } finally { setPdfUploading(false) }
  }

  async function handleViewPdf() {
    if (!pdfPath) return
    const { data } = await supabase.storage.from('contracte-terti').createSignedUrl(pdfPath, 120)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  const rolDisponibile = ROLURI_PER_TIP[form.tip_contract] || []

  // Când se schimbă tipul, resetăm rolul
  function handleTipChange(tip) {
    const roluri = ROLURI_PER_TIP[tip] || []
    setForm(f => ({ ...f, tip_contract: tip, rol_gazpet: roluri[0] || '' }))
  }

  async function handleSave() {
    if (!form.denumire.trim()) { setErr('Denumirea contractului este obligatorie.'); return }
    if (!form.tip_contract)   { setErr('Selectează tipul contractului.'); return }
    if (form.sens === 'incasare' && !form.rol_gazpet) { setErr('Selectează rolul Gazpet.'); return }
    setSaving(true); setErr('')
    try {
      // Upload PDF dacă e selectat
      let finalPdfPath = pdfPath
      if (pdfFile) {
        const tempId = isEdit ? contract.id : Date.now()
        finalPdfPath = await uploadPdf(tempId)
        if (!finalPdfPath && pdfFile) { setSaving(false); return }
      }
      const payload = {
        numar_contract: form.numar_contract || null,
        denumire: form.denumire.trim(),
        tip_contract: form.tip_contract,
        rol_gazpet: form.sens === 'plata' ? (form.rol_gazpet || 'prestator') : form.rol_gazpet,
        sens: form.sens,
        status: form.status,
        categorie: 'executie',
        valoare_lei: form.valoare_lei ? Number(form.valoare_lei) : null,
        data_semnare: form.data_semnare || null,
        data_termen: form.data_termen || null,
        termen_plata_zile: form.termen_plata_zile ? Number(form.termen_plata_zile) : null,
        garantie_buna_executie_pct: form.garantie_buna_executie_pct ? Number(form.garantie_buna_executie_pct) : null,
        contract_parinte_id: form.contract_parinte_id ? Number(form.contract_parinte_id) : null,
        site_id: form.site_id ? Number(form.site_id) : null,
        beneficiar_id: form.beneficiar_id ? Number(form.beneficiar_id) : null,
        partener_text: form.partener_text || null,
        observatii: form.observatii || null,
        pdf_path: finalPdfPath || null,
        updated_at: new Date().toISOString(),
      }
      if (isEdit) {
        const { error } = await supabase.from('contracte_terti').update(payload).eq('id', contract.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('contracte_terti').insert({ ...payload, created_at: new Date().toISOString() })
        if (error) throw error
      }
      onSaved()
    } catch (e) {
      setErr(e.message || 'Eroare salvare.')
    } finally { setSaving(false) }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 9000, padding: 16,
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: G.surface, border: `1px solid ${G.border}`, borderRadius: 14,
        width: '100%', maxWidth: 680, maxHeight: '90vh', overflowY: 'auto',
        padding: 28,
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: G.text }}>
            {isEdit ? '✏️ Editează Contract' : '➕ Contract Comercial Nou'}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: G.muted, cursor: 'pointer', fontSize: 20 }}>×</button>
        </div>

        {/* TIP CONTRACT */}
        <div style={{ marginBottom: 20 }}>
          <label style={S.label}>Tip Contract</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {Object.entries(TIP_META)
              // Downstream: asocierea nu se aplică (Gazpet e mereu constructor general față de prestator)
              .filter(([key]) => form.sens === 'incasare' || key !== 'asociere')
              .map(([key, meta]) => (
                <button key={key} onClick={() => handleTipChange(key)} style={{
                  flex: 1, padding: '12px 8px', border: `2px solid ${form.tip_contract === key ? meta.color : G.border}`,
                  borderRadius: 10, cursor: 'pointer', textAlign: 'center',
                  background: form.tip_contract === key ? meta.color + '22' : G.bg,
                  color: form.tip_contract === key ? meta.color : G.muted,
                  fontWeight: 700, fontSize: 12, transition: 'all 0.15s',
                }}>
                  <div style={{ fontSize: 20, marginBottom: 4 }}>{meta.emoji}</div>
                  {meta.label}
                </button>
              ))}
          </div>
        </div>

        {/* ROL GAZPET — doar la upstream (downstream = Gazpet e mereu constructor general) */}
        {form.sens === 'incasare' && (
          <div style={{ marginBottom: 20 }}>
            <label style={S.label}>Rolul Gazpet</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {rolDisponibile.map(rol => {
                const meta = ROL_META[rol]
                return (
                  <button key={rol} onClick={() => setForm(f => ({ ...f, rol_gazpet: rol }))} style={{
                    padding: '8px 14px', border: `2px solid ${form.rol_gazpet === rol ? meta.color : G.border}`,
                    borderRadius: 8, cursor: 'pointer',
                    background: form.rol_gazpet === rol ? meta.color + '22' : G.bg,
                    color: form.rol_gazpet === rol ? meta.color : G.muted,
                    fontWeight: 700, fontSize: 12,
                  }}>
                    {meta.label}
                  </button>
                )
              })}
            </div>
          </div>
        )}
        {form.sens === 'plata' && (
          <div style={{ marginBottom: 20, padding: '8px 14px', background: G.green + '11', borderRadius: 8, border: `1px solid ${G.green}33` }}>
            <span style={{ fontSize: 12, color: G.green, fontWeight: 700 }}>
              🏗️ Rolul Gazpet: Constructor General (implicit pentru toate contractele cu prestatori)
            </span>
          </div>
        )}

        {/* SENS */}
        <div style={{ marginBottom: 20 }}>
          <label style={S.label}>Sens Financiar</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {[
              { val: 'incasare', label: '🔼 Upstream — Gazpet execută (încasează)', color: G.green },
              { val: 'plata',    label: '🔽 Downstream — Contract cu prestator (plătim)', color: G.purple },
            ].map(s => (
              <button key={s.val} onClick={() => setForm(f => ({ ...f, sens: s.val }))} style={{
                flex: 1, padding: '10px 12px', border: `2px solid ${form.sens === s.val ? s.color : G.border}`,
                borderRadius: 8, cursor: 'pointer',
                background: form.sens === s.val ? s.color + '22' : G.bg,
                color: form.sens === s.val ? s.color : G.muted,
                fontWeight: 700, fontSize: 12, textAlign: 'center',
              }}>{s.label}</button>
            ))}
          </div>
        </div>

        {/* CONTRACT PARINTE (doar dacă sens=plata) */}
        {form.sens === 'plata' && (
          <div style={{ marginBottom: 20, padding: 14, background: G.purple + '11', borderRadius: 10, border: `1px solid ${G.purple}33` }}>
            <label style={{ ...S.label, color: G.purple }}>🔗 Contract Upstream (din care derivă)</label>
            <select value={form.contract_parinte_id} onChange={e => {
              const pid = e.target.value
              // Auto-populare șantier din contractul parinte
              const parinte = contracteUpstream.find(c => String(c.id) === String(pid))
              setForm(f => ({
                ...f,
                contract_parinte_id: pid,
                site_id: parinte?.site_id ? String(parinte.site_id) : f.site_id,
              }))
            }} style={S.select}>
              <option value="">— Selectează contractul principal —</option>
              {contracteUpstream.map(c => (
                <option key={c.id} value={c.id}>
                  Nr. {c.numar_contract} — {c.denumire?.slice(0, 60)}...
                </option>
              ))}
            </select>
            {form.contract_parinte_id && contracteUpstream.find(c => String(c.id) === String(form.contract_parinte_id))?.site_qr && (
              <div style={{ marginTop: 6, fontSize: 11, color: G.purple }}>
                📍 Șantier auto-completat: {contracteUpstream.find(c => String(c.id) === String(form.contract_parinte_id))?.site_qr}
              </div>
            )}
          </div>
        )}

        {/* GRID CÂMPURI */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
          <div>
            <label style={S.label}>Număr Contract</label>
            <input value={form.numar_contract} onChange={e => setForm(f => ({ ...f, numar_contract: e.target.value }))} placeholder="ex: 70/2024" style={S.input} />
          </div>
          <div>
            <label style={S.label}>Status</label>
            <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} style={S.select}>
              {Object.entries(STATUS_META).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={S.label}>Denumire Contract *</label>
          <textarea value={form.denumire} onChange={e => setForm(f => ({ ...f, denumire: e.target.value }))}
            placeholder="Denumirea completă a contractului..."
            rows={2} style={{ ...S.input, resize: 'vertical', fontFamily: 'inherit' }} />
        </div>

        {/* Beneficiar sau Partener */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          <div>
            <label style={S.label}>{form.sens === 'incasare' ? 'Beneficiar' : 'Prestator / Partener'}</label>
            {form.sens === 'incasare' ? (
              <select value={form.beneficiar_id} onChange={e => setForm(f => ({ ...f, beneficiar_id: e.target.value }))} style={S.select}>
                <option value="">— Selectează —</option>
                {beneficiari.map(b => <option key={b.id} value={b.id}>{b.nume}</option>)}
              </select>
            ) : (
              <input value={form.partener_text} onChange={e => setForm(f => ({ ...f, partener_text: e.target.value }))}
                placeholder="Denumire firmă prestator..." style={S.input} />
            )}
          </div>
          <div>
            <label style={S.label}>Șantier / Proiect</label>
            <select value={form.site_id} onChange={e => setForm(f => ({ ...f, site_id: e.target.value }))} style={S.select}>
              <option value="">— Fără șantier specific —</option>
              {sites.map(s => <option key={s.id} value={s.id}>{s.denumire_qr || s.name}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 16 }}>
          <div>
            <label style={S.label}>Valoare Contract (RON)</label>
            <input type="number" value={form.valoare_lei} onChange={e => setForm(f => ({ ...f, valoare_lei: e.target.value }))}
              placeholder="0" style={S.input} />
          </div>
          <div>
            <label style={S.label}>Termen Plată (zile)</label>
            <input type="number" value={form.termen_plata_zile} onChange={e => setForm(f => ({ ...f, termen_plata_zile: e.target.value }))}
              placeholder="30" style={S.input} />
          </div>
          <div>
            <label style={S.label}>GBE % din Valoare</label>
            <input type="number" value={form.garantie_buna_executie_pct} onChange={e => setForm(f => ({ ...f, garantie_buna_executie_pct: e.target.value }))}
              placeholder="10" style={S.input} />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          <div>
            <label style={S.label}>Data Semnare</label>
            <input type="date" value={form.data_semnare} onChange={e => setForm(f => ({ ...f, data_semnare: e.target.value }))} style={S.input} />
          </div>
          <div>
            <label style={S.label}>Termen Execuție</label>
            <input type="date" value={form.data_termen} onChange={e => setForm(f => ({ ...f, data_termen: e.target.value }))} style={S.input} />
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={S.label}>Observații</label>
          <textarea value={form.observatii} onChange={e => setForm(f => ({ ...f, observatii: e.target.value }))}
            placeholder="Note interne..." rows={2} style={{ ...S.input, resize: 'vertical', fontFamily: 'inherit' }} />
        </div>

        {/* PDF UPLOAD */}
        <div style={{ marginBottom: 20, padding: 14, background: G.bg, borderRadius: 10, border: `1px solid ${G.border}` }}>
          <label style={S.label}>📎 PDF Contract</label>
          {pdfPath && !pdfFile && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <span style={{ fontSize: 12, color: G.green }}>✅ PDF atașat</span>
              <button onClick={handleViewPdf} style={{
                padding: '4px 10px', background: G.blue + '22', color: G.blue,
                border: `1px solid ${G.blue}44`, borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 600,
              }}>👁 Vezi PDF</button>
            </div>
          )}
          {pdfFile && (
            <div style={{ marginBottom: 8, fontSize: 12, color: G.yellow }}>
              📄 {pdfFile.name} ({(pdfFile.size/1024/1024).toFixed(1)} MB) — se uploadează la salvare
            </div>
          )}
          <label style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '8px 14px', background: G.surface, border: `1px dashed ${G.border}`,
            borderRadius: 8, cursor: 'pointer', fontSize: 12, color: G.muted, fontWeight: 600,
          }}>
            {pdfUploading ? '⏳ Se uploadează...' : '📤 ' + (pdfPath ? 'Înlocuiește PDF' : 'Upload PDF')}
            <input type="file" accept="application/pdf" onChange={handlePdfSelect}
              style={{ display: 'none' }} disabled={pdfUploading} />
          </label>
        </div>

        {err && (
          <div style={{ padding: '10px 14px', background: G.red + '22', color: G.red, borderRadius: 8, fontSize: 13, marginBottom: 16 }}>
            ⚠️ {err}
          </div>
        )}

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onClose} style={{
            padding: '9px 18px', background: 'transparent', color: G.muted,
            border: `1px solid ${G.border}`, borderRadius: 8, cursor: 'pointer', fontSize: 13,
          }}>Anulează</button>
          <button onClick={handleSave} disabled={saving} style={{
            ...S.btnP, opacity: saving ? 0.6 : 1, cursor: saving ? 'wait' : 'pointer',
          }}>
            {saving ? '⏳ Se salvează...' : isEdit ? '✅ Salvează' : '✅ Adaugă Contract'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Modal Linii Contract ────────────────────────────────────────────────────
function ModalLinii({ contract, profile, onClose }) {
  const [linii, setLinii] = useState([])
  const [loading, setLoading] = useState(true)
  const [dsSearchMap, setDsSearchMap] = useState({})
  const [newLinie, setNewLinie] = useState({ denumire: '', unitate_masura: '', cantitate: '', pret_unitar: '' })
  const [saving, setSaving] = useState(false)
  const isOwner = profile?.is_owner === true
  const canEdit = isOwner || profile?.can_manage_contracts === true

  useEffect(() => { loadLinii() }, [])

  async function loadLinii() {
    setLoading(true)
    const { data } = await supabase.from('contracte_linii')
      .select('*').eq('contract_id', contract.id).order('pozitie')
    setLinii(data || [])
    setLoading(false)
  }

  async function addLinie() {
    if (!newLinie.denumire || !newLinie.pret_unitar) return
    setSaving(true)
    const { error } = await supabase.from('contracte_linii').insert({
      contract_id: contract.id,
      pozitie: linii.length,
      denumire: newLinie.denumire,
      unitate_masura: newLinie.unitate_masura || null,
      cantitate: newLinie.cantitate ? Number(newLinie.cantitate) : null,
      pret_unitar: Number(newLinie.pret_unitar),
    })
    if (!error) {
      setNewLinie({ denumire: '', unitate_masura: '', cantitate: '', pret_unitar: '' })
      loadLinii()
    }
    setSaving(false)
  }

  async function deleteLinie(id) {
    if (!confirm('Ștergi linia?')) return
    await supabase.from('contracte_linii').delete().eq('id', id)
    loadLinii()
  }

  const totalValoare = linii.reduce((s, l) => s + Number(l.valoare_totala || 0), 0)

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 9001, padding: 16,
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: G.surface, border: `1px solid ${G.border}`, borderRadius: 14,
        width: '100%', maxWidth: 780, maxHeight: '88vh', overflowY: 'auto', padding: 28,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: G.text }}>📋 Linii Contract</div>
            <div style={{ fontSize: 12, color: G.muted, marginTop: 2 }}>
              Nr. {contract.numar_contract} — {contract.denumire?.slice(0, 60)}...
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: G.muted, cursor: 'pointer', fontSize: 20 }}>×</button>
        </div>

        {/* Tabel linii */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: 24, color: G.muted }}>⏳ Se încarcă...</div>
        ) : linii.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 24, color: G.muted, background: G.bg, borderRadius: 10, marginBottom: 16 }}>
            Nicio linie adăugată încă.
          </div>
        ) : (
          <div style={{ marginBottom: 16 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: G.bg }}>
                  {['Denumire', 'UM', 'Cantitate', 'Preț/UM', 'Valoare', ''].map(h => (
                    <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: G.muted, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', borderBottom: `1px solid ${G.border}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {linii.map(l => (
                  <tr key={l.id} style={{ borderBottom: `1px solid ${G.border2}` }}>
                    <td style={{ padding: '8px 10px', color: G.text, fontWeight: 600 }}>
                      {l.denumire}
                      {l.pret_depasit && !l.pret_depasit_aprobat_de && (
                        <span style={{ marginLeft: 6, color: G.red, fontSize: 10, fontWeight: 700 }}>⚠️ Preț depășit</span>
                      )}
                      {l.pret_depasit && l.pret_depasit_aprobat_de && (
                        <span style={{ marginLeft: 6, color: G.green, fontSize: 10, fontWeight: 700 }}>✅ Aprobat</span>
                      )}
                    </td>
                    <td style={{ padding: '8px 10px', color: G.muted }}>{l.unitate_masura || '—'}</td>
                    <td style={{ padding: '8px 10px', color: G.muted }}>{l.cantitate != null ? l.cantitate : '—'}</td>
                    <td style={{ padding: '8px 10px', color: G.text }}>{Number(l.pret_unitar).toLocaleString('ro-RO')} RON</td>
                    <td style={{ padding: '8px 10px', color: G.green, fontWeight: 700 }}>{Number(l.valoare_totala).toLocaleString('ro-RO')} RON</td>
                    <td style={{ padding: '8px 10px' }}>
                      {isOwner && (
                        <button onClick={() => deleteLinie(l.id)} style={{
                          padding: '3px 8px', background: G.red + '22', color: G.red,
                          border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 11,
                        }}>🗑</button>
                      )}
                    </td>
                  </tr>
                ))}
                <tr style={{ background: G.bg }}>
                  <td colSpan={4} style={{ padding: '10px', textAlign: 'right', fontWeight: 800, color: G.muted, fontSize: 12 }}>TOTAL</td>
                  <td style={{ padding: '10px', fontWeight: 800, color: G.green, fontSize: 14 }}>{totalValoare.toLocaleString('ro-RO')} RON</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Adaugă linie nouă */}
        {canEdit && (
          <div style={{ ...S.card, padding: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: G.muted, marginBottom: 12 }}>➕ Adaugă linie</div>
            <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr 1fr 1fr auto', gap: 8, alignItems: 'end' }}>
              <div>
                <label style={S.label}>Denumire *</label>
                <input value={newLinie.denumire} onChange={e => setNewLinie(n => ({ ...n, denumire: e.target.value }))}
                  placeholder="ex: Nisip sort 0-4" style={S.input} />
              </div>
              <div>
                <label style={S.label}>UM</label>
                <input value={newLinie.unitate_masura} onChange={e => setNewLinie(n => ({ ...n, unitate_masura: e.target.value }))}
                  placeholder="mc, t, ml..." style={S.input} />
              </div>
              <div>
                <label style={S.label}>Cantitate</label>
                <input type="number" value={newLinie.cantitate} onChange={e => setNewLinie(n => ({ ...n, cantitate: e.target.value }))}
                  placeholder="—" style={S.input} />
              </div>
              <div>
                <label style={S.label}>Preț/UM (RON) *</label>
                <input type="number" value={newLinie.pret_unitar} onChange={e => setNewLinie(n => ({ ...n, pret_unitar: e.target.value }))}
                  placeholder="0" style={S.input} />
              </div>
              <button onClick={addLinie} disabled={saving || !newLinie.denumire || !newLinie.pret_unitar} style={{
                ...S.btnP, opacity: (saving || !newLinie.denumire || !newLinie.pret_unitar) ? 0.5 : 1,
                cursor: (saving || !newLinie.denumire || !newLinie.pret_unitar) ? 'not-allowed' : 'pointer',
                whiteSpace: 'nowrap',
              }}>
                {saving ? '⏳' : '+ Adaugă'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Dashboard alerte contracte ─────────────────────────────────────────────
function AlerteDashboard({ contracte, onFilterSens, onFilterStatus }) {
  const azi = new Date()
  const in30z = new Date(Date.now() + 30 * 24 * 3600 * 1000)

  const faraParinte  = contracte.filter(c => c.sens === 'plata' && !c.contract_parinte_id)
  const expirate     = contracte.filter(c => c.data_termen && new Date(c.data_termen) < azi && c.status === 'activ')
  const expiraCurand = contracte.filter(c => c.data_termen && new Date(c.data_termen) >= azi && new Date(c.data_termen) <= in30z && c.status === 'activ')
  const inDraft      = contracte.filter(c => c.status === 'draft')

  const alerte = [
    expirate.length     && { icon: '❌', label: `${expirate.length} contract${expirate.length > 1 ? 'e' : ''} expirat${expirate.length > 1 ? 'e' : ''}`, color: G.red,    action: () => onFilterStatus('activ') },
    expiraCurand.length && { icon: '⏳', label: `${expiraCurand.length} expiră în 30 zile`, color: G.yellow, action: () => onFilterStatus('activ') },
    faraParinte.length  && { icon: '🔗', label: `${faraParinte.length} fără contract mamă`, color: G.orange, action: () => onFilterSens('plata') },
    inDraft.length      && { icon: '📋', label: `${inDraft.length} draft${inDraft.length > 1 ? '-uri' : ''} nesemnate`, color: G.muted, action: () => onFilterStatus('draft') },
  ].filter(Boolean)

  if (!alerte.length) return null

  return (
    <div style={{
      ...S.card, marginBottom: 16, padding: '12px 16px',
      borderColor: G.red + '44', borderTopWidth: 3, borderTopColor: G.red,
    }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: G.red, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
        🔔 Alerte Contracte
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {alerte.map((a, i) => (
          <button key={i} onClick={a.action} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 12px', background: a.color + '15',
            border: `1px solid ${a.color}44`, borderRadius: 8,
            cursor: 'pointer', fontSize: 12, fontWeight: 700, color: a.color,
          }}>
            {a.icon} {a.label}
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── Componentă principală ──────────────────────────────────────────────────
export default function ContracteComerciale({ profile }) {
  const [contracte, setContracte] = useState([])
  const [loading, setLoading] = useState(true)
  const [sites, setSites] = useState([])
  const [beneficiari, setBeneficiari] = useState([])
  const [filterSens, setFilterSens] = useState('toate')  // toate | incasare | plata
  const [filterTip, setFilterTip] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editContract, setEditContract] = useState(null)
  const [liniiContract, setLiniiContract] = useState(null)

  const isOwner = profile?.is_owner === true
  const canManage = isOwner || profile?.can_manage_contracts === true

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    const [{ data: contracteData }, { data: sitesData }, { data: benData }] = await Promise.all([
      supabase.from('v_contracte_cu_linii').select('*').order('sens').order('created_at', { ascending: false }),
      supabase.from('sites').select('id, name, denumire_qr').order('name'),
      supabase.from('beneficiari').select('id, nume').eq('activ', true).order('nume'),
    ])
    setContracte(contracteData || [])
    setSites(sitesData || [])
    setBeneficiari(benData || [])
    setLoading(false)
  }

  // Filtrare
  const filtered = useMemo(() => {
    return (contracte || []).filter(c => {
      if (filterSens !== 'toate' && c.sens !== filterSens) return false
      if (filterTip && c.tip_contract !== filterTip) return false
      if (filterStatus && c.status !== filterStatus) return false
      if (search) {
        const q = search.toLowerCase()
        return (c.denumire || '').toLowerCase().includes(q)
          || (c.numar_contract || '').toLowerCase().includes(q)
          || (c.partener_text || '').toLowerCase().includes(q)
          || (c.beneficiar_name || '').toLowerCase().includes(q)
      }
      return true
    })
  }, [contracte, filterSens, filterTip, filterStatus, search])

  const upstream   = filtered.filter(c => c.sens === 'incasare')
  const downstream = filtered.filter(c => c.sens === 'plata')
  const contracteUpstream = contracte.filter(c => c.sens === 'incasare')

  // KPIs
  const totalUpstream   = contracte.filter(c => c.sens === 'incasare').reduce((s, c) => s + Number(c.valoare_lei || 0), 0)
  const totalDownstream = contracte.filter(c => c.sens === 'plata').reduce((s, c) => s + Number(c.valoare_lei || 0), 0)
  const nrDepasit       = contracte.reduce((s, c) => s + Number(c.nr_pret_depasit_neaprobat || 0), 0)

  return (
    <div>
      {/* Dashboard alerte */}
      {!loading && contracte.length > 0 && (
        <AlerteDashboard
          contracte={contracte}
          onFilterSens={s => setFilterSens(s)}
          onFilterStatus={s => setFilterStatus(s)}
        />
      )}

      {/* KPI */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
        {[
          { icon: '🔼', label: 'Contracte upstream', value: contracte.filter(c => c.sens === 'incasare').length, color: G.blue },
          { icon: '💰', label: 'Valoare upstream', value: fmtRON(totalUpstream), color: G.green },
          { icon: '🔽', label: 'Contracte prestatori', value: contracte.filter(c => c.sens === 'plata').length, color: G.purple },
          { icon: nrDepasit > 0 ? '⚠️' : '✅', label: 'Prețuri depășite neaprobate', value: nrDepasit || '0', color: nrDepasit > 0 ? G.red : G.green },
        ].map(k => (
          <div key={k.label} style={{
            ...S.card, padding: '14px 18px',
            borderColor: k.color + '44', borderTopWidth: 3,
          }}>
            <div style={{ fontSize: 11, color: k.color, fontWeight: 700, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 }}>
              {k.icon} {k.label}
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: G.text }}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* Filtre + buton nou */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="🔍 Caută contract / partener..."
          style={{ ...S.input, width: 220 }} />

        <div style={{ display: 'flex', gap: 4, background: G.surface, borderRadius: 8, padding: 4, border: `1px solid ${G.border}` }}>
          {[
            { val: 'toate', label: 'Toate' },
            { val: 'incasare', label: '🔼 Upstream' },
            { val: 'plata', label: '🔽 Downstream' },
          ].map(f => (
            <button key={f.val} onClick={() => setFilterSens(f.val)} style={{
              padding: '6px 12px', border: 'none', borderRadius: 6, cursor: 'pointer',
              background: filterSens === f.val ? G.orange + '33' : 'transparent',
              color: filterSens === f.val ? G.orange : G.muted,
              fontWeight: 700, fontSize: 12,
            }}>{f.label}</button>
          ))}
        </div>

        <select value={filterTip} onChange={e => setFilterTip(e.target.value)} style={{ ...S.select, width: 180 }}>
          <option value="">Toate tipurile</option>
          {Object.entries(TIP_META).map(([k, v]) => <option key={k} value={k}>{v.emoji} {v.label}</option>)}
        </select>

        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ ...S.select, width: 140 }}>
          <option value="">Toate statusurile</option>
          {Object.entries(STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>

        {canManage && (
          <button onClick={() => { setEditContract(null); setModalOpen(true) }} style={{ ...S.btnP, marginLeft: 'auto' }}>
            + Contract nou
          </button>
        )}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: G.muted }}>⏳ Se încarcă contractele...</div>
      ) : filtered.length === 0 ? (
        <div style={{ ...S.card, padding: 40, textAlign: 'center' }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>📜</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: G.text, marginBottom: 6 }}>Niciun contract</div>
          <div style={{ fontSize: 13, color: G.muted }}>
            {search || filterTip || filterStatus || filterSens !== 'toate'
              ? 'Niciun contract nu corespunde filtrelor selectate.'
              : 'Adaugă primul contract comercial.'}
          </div>
        </div>
      ) : (
        <>
          {/* UPSTREAM */}
          {(filterSens === 'toate' || filterSens === 'incasare') && upstream.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: G.blue, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  🔼 Upstream — Gazpet Execută
                </div>
                <div style={{ fontSize: 11, color: G.muted }}>({upstream.length} contracte · {fmtRON(upstream.reduce((s, c) => s + Number(c.valoare_lei || 0), 0))})</div>
              </div>
              {upstream.map(c => {
                const childDs = contracte.filter(d => d.sens === 'plata' && Number(d.contract_parinte_id) === Number(c.id))
                return (
                  <ContractCard key={c.id} c={c} isOwner={isOwner}
                    onEdit={c => { setEditContract(c); setModalOpen(true) }}
                    onViewLinii={c => setLiniiContract(c)}
                    downstreamList={childDs}
                    dsSearch={dsSearchMap[c.id] || ''}
                    onDsSearch={v => setDsSearchMap(prev => ({...prev, [c.id]: v}))} />
                )
              })}
            </div>
          )}

          {/* DOWNSTREAM */}
          {(filterSens === 'toate' || filterSens === 'plata') && downstream.length > 0 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: G.purple, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  🔽 Downstream — Contracte cu Prestatori
                </div>
                <div style={{ fontSize: 11, color: G.muted }}>({downstream.length} contracte · {fmtRON(downstream.reduce((s, c) => s + Number(c.valoare_lei || 0), 0))})</div>
              </div>
              {downstream.map(c => (
                <ContractCard key={c.id} c={c} isOwner={isOwner}
                  onEdit={c => { setEditContract(c); setModalOpen(true) }}
                  onViewLinii={c => setLiniiContract(c)} />
              ))}
            </div>
          )}
        </>
      )}

      {/* Modal contract nou/editare */}
      {modalOpen && (
        <ModalContract
          contract={editContract}
          contracteUpstream={contracteUpstream}
          sites={sites}
          beneficiari={beneficiari}
          profile={profile}
          onClose={() => { setModalOpen(false); setEditContract(null) }}
          onSaved={() => { setModalOpen(false); setEditContract(null); loadAll() }}
        />
      )}

      {/* Modal linii */}
      {liniiContract && (
        <ModalLinii
          contract={liniiContract}
          profile={profile}
          onClose={() => setLiniiContract(null)}
        />
      )}
    </div>
  )
}
