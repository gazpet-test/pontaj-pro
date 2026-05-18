// ════════════════════════════════════════════════════════════════════════════
// MODULUL LOGISTICĂ — Documente Flotă (Etapa 1 + 2)
// ════════════════════════════════════════════════════════════════════════════
// Etapa 1: KPI + filtre + tabel paginat (read-only listing)
// Etapa 2: DocumentFormModal (add/edit/delete + upload PDF) integrat în
//          pagina utilajului (DocumenteUtilajList).
//
// Bucket Storage pentru PDF-uri: documente-flota
// Sursa adevărului utilaje: logistica_active
// View pentru alerte: v_logistica_alerte
// ════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from './lib/supabase.js'
import AmcSection from './AmcSection.jsx'
import PersonalSection from './PersonalSection.jsx'
import DocumentScannerButton from './DocumentScannerButton.jsx'

// ─── Theme (sincron cu Logistica.jsx) ───────────────────────────────────────
const G = {
  bg:'#0D1117', surface:'#161B22', border:'#21262D', border2:'#30363D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  blue:'#58A6FF', green:'#3FB950', red:'#F85149', yellow:'#D29922',
  purple:'#BC8CFF', orange:'#F0883E',
  greenDim:'#1A3A1A', redDim:'#3A1A1A', yellowDim:'#3A2A0A',
  logistica:'#E3B341',
}
const S = {
  card: { background:G.surface, border:`1px solid ${G.border}`, borderRadius:12 },
  input: { background:G.bg, border:`1px solid ${G.border2}`, color:G.text, borderRadius:8, padding:'8px 12px', fontFamily:'inherit', fontSize:14, outline:'none', width:'100%' },
  btnP: { background:'#1F6FEB', color:'white', border:'none', borderRadius:8, padding:'9px 18px', fontFamily:'inherit', fontSize:14, fontWeight:700, cursor:'pointer' },
  btnS: { background:G.surface, color:G.text, border:`1px solid ${G.border}`, borderRadius:8, padding:'7px 14px', fontFamily:'inherit', fontSize:13, fontWeight:600, cursor:'pointer' },
}

const PAGE_SIZE = 50
const BUCKET = 'documente-flota'

const STARI = [
  { key:'expirat',    label:'Expirat',     color:G.red,    bg:G.redDim    },
  { key:'expira_30z', label:'Expiră 30z',  color:G.orange, bg:'#3A2010'   },
  { key:'expira_90z', label:'Expiră 90z',  color:G.yellow, bg:G.yellowDim },
  { key:'ok',         label:'În regulă',   color:G.green,  bg:G.greenDim  },
]

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('ro-RO', { day:'2-digit', month:'2-digit', year:'numeric' }) : '—'
const todayISO = () => new Date().toISOString().slice(0, 10)

const computeStatus = (zile) => {
  if (zile == null) return 'ok'
  if (zile < 0)   return 'expirat'
  if (zile <= 30) return 'expira_30z'
  if (zile <= 90) return 'expira_90z'
  return 'ok'
}

const fmtZile = (zile) => {
  if (zile == null) return '—'
  if (zile === 0)   return 'Azi'
  if (zile < 0)     return `−${Math.abs(zile)}z`
  return `${zile}z`
}

const daysUntilToday = (dateStr) => {
  if (!dateStr) return null
  const today = new Date(); today.setHours(0,0,0,0)
  const target = new Date(dateStr); target.setHours(0,0,0,0)
  return Math.round((target - today) / 86400000)
}

const addDaysISO = (isoStr, days) => {
  if (!isoStr || !days) return ''
  const d = new Date(isoStr)
  d.setDate(d.getDate() + Number(days))
  return d.toISOString().slice(0, 10)
}

const slugify = (s) => (s || '').toString().toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)

// ─── Sub-componente ─────────────────────────────────────────────────────────

function KPICard({ icon, label, value, color, bg }) {
  return (
    <div style={{...S.card, padding:'14px 18px', background: bg || G.surface, borderColor: color ? color+'33' : G.border}}>
      <div style={{display:'flex', alignItems:'center', gap:6, fontSize:11, fontWeight:600, color: color || G.muted, textTransform:'uppercase', letterSpacing:'.4px', marginBottom:8}}>
        <span style={{fontSize:13}}>{icon}</span>
        <span>{label}</span>
      </div>
      <div style={{fontSize:28, fontWeight:800, color: color || G.text, fontVariantNumeric:'tabular-nums', lineHeight:1}}>{value}</div>
    </div>
  )
}

function StareBadge({ stare }) {
  const cfg = STARI.find(s => s.key === stare) || { label:stare, color:G.dim }
  return (
    <span style={{display:'inline-block', padding:'3px 10px', borderRadius:12, fontSize:11, fontWeight:700, letterSpacing:'.3px', background: cfg.color+'22', color: cfg.color, whiteSpace:'nowrap'}}>
      {cfg.label}
    </span>
  )
}

async function openPdfFromBucket(pdfPath, showToast, setLoadingId, docId) {
  if (!pdfPath) { showToast('Acest document nu are PDF uploadat', 'warn'); return }
  if (setLoadingId) setLoadingId(docId)
  try {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(pdfPath, 60)
    if (error) throw error
    window.open(data.signedUrl, '_blank')
  } catch (e) {
    showToast('Eroare preview PDF: ' + (e.message || e), 'error')
  } finally {
    if (setLoadingId) setLoadingId(null)
  }
}

// ─── Sub-tabs bar pentru pagina Documente Flotă ─────────────────────────────
function DocumenteSubTabsBar({ subTab, setSubTab, badgeAlerte, badgePersonal }) {
  const subTabs = [
    { key:'flota',    icon:'🚛', label:'Flotă'    },
    { key:'alerte',   icon:'🚨', label:'Alerte',   badge: badgeAlerte },
    { key:'personal', icon:'📋', label:'Personal', badge: badgePersonal },
    { key:'amc',      icon:'🔬', label:'AMC'      },
  ]
  return (
    <div style={{display:'flex', gap:3, marginBottom:14, padding:3, background:G.bg, borderRadius:8, border:`1px solid ${G.border}`, flexWrap:'wrap'}}>
      {subTabs.map(t => {
        const active = subTab === t.key
        return (
          <button key={t.key} onClick={() => setSubTab(t.key)} style={{
            padding:'6px 12px', borderRadius:6, border:'none',
            cursor:'pointer', fontSize:12,
            fontWeight: active ? 700 : 500,
            background: active ? G.logistica + '22' : 'transparent',
            color: active ? G.logistica : G.muted,
            display:'flex', alignItems:'center', gap:6,
            transition:'all .12s',
          }}>
            <span>{t.icon}</span>
            <span>{t.label}</span>
            {t.badge > 0 && (
              <span style={{
                background: active ? G.red : G.red + '33',
                color: active ? '#fff' : G.red,
                borderRadius:10, padding:'1px 7px',
                fontSize:10, fontWeight:800,
                fontVariantNumeric:'tabular-nums',
                minWidth:18, textAlign:'center',
              }}>{t.badge}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

// ─── Secțiunea Alerte (3 grupuri colorate, click pe rând = edit) ────────────
function AlerteSection({ enriched, canEdit, onEditDoc, openingPdfId, setOpeningPdfId, showToast }) {
  const sectiuni = [
    { key:'expirat',    label:'Expirate',          icon:'🚨', color:G.red,    bg:G.redDim    },
    { key:'expira_30z', label:'Expiră în 30 zile', icon:'⏰', color:G.orange, bg:'#3A2010'   },
    { key:'expira_90z', label:'Expiră în 90 zile', icon:'🕒', color:G.yellow, bg:G.yellowDim },
  ]
  const sortMarca = (a, b) => {
    const ma = (a._utilaj?.marca || '').toLowerCase()
    const mb = (b._utilaj?.marca || '').toLowerCase()
    if (ma !== mb) return ma.localeCompare(mb, 'ro')
    const moa = (a._utilaj?.model || '').toLowerCase()
    const mob = (b._utilaj?.model || '').toLowerCase()
    return moa.localeCompare(mob, 'ro')
  }
  const grupuri = sectiuni.map(sec => ({
    ...sec,
    items: enriched.filter(d => d._status === sec.key).sort(sortMarca),
  })).filter(g => g.items.length > 0)

  if (grupuri.length === 0) {
    return (
      <div style={{...S.card, padding:60, textAlign:'center'}}>
        <div style={{fontSize:48, marginBottom:14, opacity:.5}}>✅</div>
        <div style={{fontSize:18, fontWeight:800, color:G.green}}>Niciun document expirat sau pe punctul de a expira</div>
        <div style={{fontSize:13, color:G.muted, marginTop:8}}>Toată flota e la zi cu actele.</div>
      </div>
    )
  }

  return (
    <div>
      {grupuri.map(g => (
        <div key={g.key} style={{...S.card, marginBottom:14, overflow:'hidden'}}>
          <div style={{padding:'10px 16px', background:g.bg, borderBottom:`1px solid ${G.border2}`, display:'flex', alignItems:'center', gap:10}}>
            <span style={{fontSize:16}}>{g.icon}</span>
            <span style={{fontSize:14, fontWeight:800, color:g.color, flex:1}}>{g.label}</span>
            <span style={{fontSize:11, fontWeight:700, color:g.color, background:G.bg+'66', padding:'2px 9px', borderRadius:10, fontVariantNumeric:'tabular-nums'}}>{g.items.length}</span>
          </div>
          <div style={{display:'grid', gridTemplateColumns:'minmax(0, 2fr) minmax(0, 1.1fr) 100px 70px 50px', gap:10, padding:'10px 16px', background:G.bg, borderBottom:`1px solid ${G.border}`, fontSize:10, fontWeight:700, color:G.muted, textTransform:'uppercase', letterSpacing:'.5px'}}>
            <div>Utilaj</div>
            <div>Tip doc</div>
            <div>Expirare</div>
            <div>Zile</div>
            <div></div>
          </div>
          {g.items.map(d => {
            const u = d._utilaj
            const hasPdf = !!d.pdf_url
            return (
              <div key={d.id}
                onClick={() => canEdit && onEditDoc(d)}
                title={canEdit ? 'Click pentru reînnoire / editare' : ''}
                style={{display:'grid', gridTemplateColumns:'minmax(0, 2fr) minmax(0, 1.1fr) 100px 70px 50px', gap:10, padding:'11px 16px', alignItems:'center', borderBottom:`1px solid ${G.border}`, fontSize:13, cursor: canEdit ? 'pointer' : 'default', transition:'background .12s'}}
                onMouseEnter={e => { if (canEdit) e.currentTarget.style.background = G.bg + '88' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
              >
                <div style={{minWidth:0}}>
                  {u ? (
                    <>
                      <div style={{fontWeight:600, color:G.text, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                        {u.marca} {u.model}
                      </div>
                      <div style={{display:'flex', gap:8, fontSize:11, marginTop:2, alignItems:'center'}}>
                        {u.nr_inmatriculare && <span style={{color:G.blue, fontFamily:'monospace'}}>{u.nr_inmatriculare}</span>}
                        {u.cod_intern && <span style={{color:G.logistica, fontFamily:'monospace', fontWeight:700}}>{u.cod_intern}</span>}
                      </div>
                    </>
                  ) : (
                    <span style={{color:G.dim, fontStyle:'italic'}}>utilaj #{d.entitate_id ?? d.active_id} (lipsă)</span>
                  )}
                </div>
                <div style={{color:G.text, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{d._tipNume}</div>
                <div style={{color:G.muted, fontVariantNumeric:'tabular-nums', fontSize:12}}>{fmtDate(d.data_expirare)}</div>
                <div style={{color:g.color, fontWeight:700, fontVariantNumeric:'tabular-nums'}}>{fmtZile(d._zile)}</div>
                <div>
                  <button
                    onClick={(e) => { e.stopPropagation(); if (hasPdf) openPdfFromBucket(d.pdf_url, showToast, setOpeningPdfId, d.id) }}
                    disabled={!hasPdf || openingPdfId === d.id}
                    title={hasPdf ? 'Deschide PDF' : 'Fără PDF'}
                    style={{
                      width:32, height:32, borderRadius:6,
                      background: hasPdf ? G.bg : 'transparent',
                      border:`1px solid ${hasPdf ? G.border2 : G.border}`,
                      color: hasPdf ? G.blue : G.dim,
                      cursor: hasPdf ? 'pointer' : 'not-allowed',
                      opacity: hasPdf ? 1 : .35, fontSize:14,
                      display:'flex', alignItems:'center', justifyContent:'center',
                    }}
                  >
                    {openingPdfId === d.id ? '⏳' : (hasPdf ? '👁' : '∅')}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      ))}
      {canEdit && (
        <div style={{fontSize:12, color:G.muted, marginTop:8, textAlign:'center'}}>
          💡 Click pe rând pentru a reînnoi documentul (deschide editorul cu data nouă)
        </div>
      )}
    </div>
  )
}

// ─── Sub-tab placeholder (pentru Personal + AMC) ────────────────────────────
function PlaceholderSubTab({ emoji, titlu, descriere }) {
  return (
    <div style={{...S.card, padding:60, textAlign:'center'}}>
      <div style={{fontSize:48, marginBottom:14, opacity:.4}}>{emoji}</div>
      <div style={{fontSize:20, fontWeight:800, color:G.text}}>{titlu}</div>
      <div style={{fontSize:13, color:G.muted, marginTop:10, maxWidth:440, margin:'10px auto 0', lineHeight:1.55}}>{descriere}</div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// MODAL: Add / Edit Document
// ════════════════════════════════════════════════════════════════════════════

export function DocumentFormModal({ doc, activId, activList, tipuri, onClose, onSaved, canEdit, showToast }) {
  const isEdit = !!doc
  const utilajLocked = !!activId && !isEdit

  const [form, setForm] = useState({
    entitate_id: doc?.entitate_id ?? activId ?? '',
    tip_id: doc?.tip_id ?? '',
    numar_document: doc?.numar_document || '',
    data_emitere: doc?.data_emitere || todayISO(),
    data_expirare: doc?.data_expirare || '',
    emitent: doc?.emitent || '',
    cost: doc?.cost ?? '',
    observatii: doc?.observatii || '',
  })
  const [pdfFile, setPdfFile] = useState(null)
  const [removeExistingPdf, setRemoveExistingPdf] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [autoExpirare, setAutoExpirare] = useState(!isEdit)

  const setField = (k, v) => setForm(p => ({ ...p, [k]: v }))

  useEffect(() => {
    if (!autoExpirare) return
    const tip = tipuri.find(t => t.id === Number(form.tip_id))
    if (tip && tip.perioada_default_zile && form.data_emitere) {
      setForm(p => ({ ...p, data_expirare: addDaysISO(form.data_emitere, tip.perioada_default_zile) }))
    }
  }, [form.tip_id, form.data_emitere, autoExpirare, tipuri])

  const onChangeExpirare = (v) => {
    setAutoExpirare(false)
    setField('data_expirare', v)
  }

  const onFileSelect = (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    if (f.type !== 'application/pdf') { showToast('Doar fișiere PDF permise', 'error'); e.target.value = ''; return }
    if (f.size > 10 * 1024 * 1024) { showToast('PDF prea mare (max 10MB)', 'error'); e.target.value = ''; return }
    setPdfFile(f)
    setRemoveExistingPdf(false)
  }

  const handleSave = async () => {
    if (!form.entitate_id) { showToast('Selectează utilajul', 'error'); return }
    if (!form.tip_id)      { showToast('Selectează tipul documentului', 'error'); return }
    if (!form.data_expirare) { showToast('Completează data expirării', 'error'); return }

    setSaving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      let pdfPath = doc?.pdf_url ?? null

      if (pdfFile) {
        const tipNume = tipuri.find(t => t.id === Number(form.tip_id))?.nume || 'doc'
        const nrSlug = slugify(form.numar_document) || 'nonr'
        const fileName = `activ-${form.entitate_id}/${slugify(tipNume)}-${nrSlug}-${Date.now()}.pdf`
        const { error: upErr } = await supabase.storage.from(BUCKET)
          .upload(fileName, pdfFile, { contentType: 'application/pdf', upsert: false })
        if (upErr) throw new Error('Upload PDF eșuat: ' + upErr.message)
        if (doc?.pdf_url) {
          await supabase.storage.from(BUCKET).remove([doc.pdf_url])
        }
        pdfPath = fileName
      } else if (removeExistingPdf && doc?.pdf_url) {
        await supabase.storage.from(BUCKET).remove([doc.pdf_url])
        pdfPath = null
      }

      const payload = {
        entitate_tip: 'activ',
        entitate_id: Number(form.entitate_id),
        active_id: Number(form.entitate_id),
        tip_id: Number(form.tip_id),
        numar_document: form.numar_document.trim() || null,
        data_emitere: form.data_emitere || null,
        data_expirare: form.data_expirare,
        emitent: form.emitent.trim() || null,
        cost: form.cost !== '' ? Number(form.cost) : null,
        observatii: form.observatii.trim() || null,
        pdf_url: pdfPath,
      }
      if (!isEdit) payload.created_by = user?.id || null

      const op = isEdit
        ? supabase.from('logistica_documente').update(payload).eq('id', doc.id).select().single()
        : supabase.from('logistica_documente').insert(payload).select().single()
      const { error: dbErr } = await op
      if (dbErr) throw dbErr

      showToast(isEdit ? '✓ Document actualizat' : '✓ Document adăugat', 'success')
      onSaved()
    } catch (e) {
      showToast('Eroare: ' + (e.message || e), 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!isEdit) return
    setDeleting(true)
    try {
      if (doc.pdf_url) {
        await supabase.storage.from(BUCKET).remove([doc.pdf_url])
      }
      const { error } = await supabase.from('logistica_documente').delete().eq('id', doc.id)
      if (error) throw error
      showToast('✓ Document șters', 'success')
      onSaved()
    } catch (e) {
      showToast('Eroare la ștergere: ' + (e.message || e), 'error')
    } finally {
      setDeleting(false); setConfirmDel(false)
    }
  }

  const tipSelected = tipuri.find(t => t.id === Number(form.tip_id))
  const utilajSelected = activList?.find(a => a.id === Number(form.entitate_id))

  return (
    <div onClick={onClose} style={{position:'fixed', inset:0, background:'#000000cc', zIndex:300, display:'flex', alignItems:'flex-start', justifyContent:'center', padding:'30px 16px', overflowY:'auto'}}>
      <div onClick={e => e.stopPropagation()} style={{...S.card, padding:22, width:'100%', maxWidth:680, boxShadow:'0 20px 80px rgba(0,0,0,.6)', borderTop:`3px solid ${G.logistica}`}}>

        <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:16, paddingBottom:14, borderBottom:`1px solid ${G.border}`}}>
          <div>
            <div style={{fontSize:18, fontWeight:800, color:G.text}}>
              {isEdit ? '✏️ Editează document' : '➕ Document nou'}
            </div>
            <div style={{fontSize:11, color:G.muted, marginTop:3}}>
              {utilajSelected
                ? <>Pentru: <strong style={{color:G.text}}>{utilajSelected.marca} {utilajSelected.model}</strong> {utilajSelected.nr_inmatriculare && <span style={{color:G.blue, fontFamily:'monospace'}}>· {utilajSelected.nr_inmatriculare}</span>}</>
                : 'Completează câmpurile de mai jos'}
            </div>
          </div>
          <button onClick={onClose} style={{...S.btnS, padding:'4px 10px', fontSize:13}}>✕</button>
        </div>

        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:14}}>

          {!utilajLocked && (
            <div style={{gridColumn:'1 / -1'}}>
              <div style={{fontSize:11, color:G.muted, fontWeight:600, marginBottom:5}}>Utilaj <span style={{color:G.red}}>*</span></div>
              <select
                value={form.entitate_id}
                onChange={e => setField('entitate_id', e.target.value)}
                disabled={isEdit}
                style={{...S.input, cursor: isEdit ? 'default' : 'pointer', opacity: isEdit ? .7 : 1}}
              >
                <option value="">— alege utilajul —</option>
                {(activList || []).map(a => (
                  <option key={a.id} value={a.id}>
                    {a.marca} {a.model}
                    {a.nr_inmatriculare ? ` · ${a.nr_inmatriculare}` : ''}
                    {a.cod_intern ? ` (${a.cod_intern})` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <div style={{fontSize:11, color:G.muted, fontWeight:600, marginBottom:5}}>Tip document <span style={{color:G.red}}>*</span></div>
            <select value={form.tip_id} onChange={e => setField('tip_id', e.target.value)} style={{...S.input, cursor:'pointer'}}>
              <option value="">— alege tipul —</option>
              {tipuri.filter(t => t.activ).map(t => (
                <option key={t.id} value={t.id}>{t.nume}{t.perioada_default_zile ? ` (${t.perioada_default_zile}z)` : ''}</option>
              ))}
            </select>
            {tipSelected?.descriere && <div style={{fontSize:10, color:G.dim, marginTop:3}}>{tipSelected.descriere}</div>}
          </div>

          <div>
            <div style={{fontSize:11, color:G.muted, fontWeight:600, marginBottom:5}}>Număr document</div>
            <input type="text" value={form.numar_document} onChange={e => setField('numar_document', e.target.value)} placeholder="ex: RO/2026/12345" style={{...S.input, fontFamily:'monospace', fontSize:13}} />
          </div>

          <div>
            <div style={{fontSize:11, color:G.muted, fontWeight:600, marginBottom:5}}>Data emitere</div>
            <input type="date" value={form.data_emitere} onChange={e => setField('data_emitere', e.target.value)} style={{...S.input}} />
          </div>

          <div>
            <div style={{fontSize:11, color:G.muted, fontWeight:600, marginBottom:5}}>
              Data expirare <span style={{color:G.red}}>*</span>
              {autoExpirare && tipSelected?.perioada_default_zile && (
                <span style={{color:G.green, fontSize:10, marginLeft:6, fontWeight:500}}>(auto-calc)</span>
              )}
            </div>
            <input type="date" value={form.data_expirare} onChange={e => onChangeExpirare(e.target.value)} style={{...S.input}} />
          </div>

          <div>
            <div style={{fontSize:11, color:G.muted, fontWeight:600, marginBottom:5}}>Emitent</div>
            <input type="text" value={form.emitent} onChange={e => setField('emitent', e.target.value)} placeholder="ex: RAR, ARR, Allianz" style={{...S.input}} />
          </div>

          <div>
            <div style={{fontSize:11, color:G.muted, fontWeight:600, marginBottom:5}}>Cost (RON)</div>
            <input type="number" step="0.01" min="0" value={form.cost} onChange={e => setField('cost', e.target.value)} placeholder="ex: 450.00" style={{...S.input, fontVariantNumeric:'tabular-nums'}} />
          </div>

          <div style={{gridColumn:'1 / -1'}}>
            <div style={{fontSize:11, color:G.muted, fontWeight:600, marginBottom:5}}>Observații</div>
            <textarea rows={2} value={form.observatii} onChange={e => setField('observatii', e.target.value)} style={{...S.input, resize:'vertical', fontFamily:'inherit'}} />
          </div>
        </div>

        <div style={{background:G.bg, border:`1px solid ${G.border}`, borderRadius:8, padding:14, marginBottom:16}}>
          <div style={{fontSize:11, color:G.logistica, fontWeight:700, textTransform:'uppercase', letterSpacing:'.5px', marginBottom:10}}>📄 Fișier PDF</div>

          {doc?.pdf_url && !pdfFile && !removeExistingPdf && (
            <div style={{display:'flex', alignItems:'center', gap:10, marginBottom:10, padding:'8px 12px', background:G.surface, border:`1px solid ${G.border2}`, borderRadius:6}}>
              <span style={{fontSize:18}}>📎</span>
              <div style={{flex:1, minWidth:0}}>
                <div style={{fontSize:12, color:G.text, fontWeight:600}}>PDF existent</div>
                <div style={{fontSize:10, color:G.muted, fontFamily:'monospace', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{doc.pdf_url}</div>
              </div>
              <button onClick={() => openPdfFromBucket(doc.pdf_url, showToast)} style={{...S.btnS, padding:'5px 10px', fontSize:12, color:G.blue}}>👁 Vezi</button>
              {canEdit && <button onClick={() => setRemoveExistingPdf(true)} style={{...S.btnS, padding:'5px 10px', fontSize:12, color:G.red}}>🗑 Șterge</button>}
            </div>
          )}

          {removeExistingPdf && !pdfFile && (
            <div style={{padding:'8px 12px', background:G.redDim+'66', border:`1px solid ${G.red}55`, borderRadius:6, marginBottom:10, fontSize:12, color:G.red, display:'flex', justifyContent:'space-between', alignItems:'center'}}>
              <span>⚠️ PDF-ul va fi șters la salvare</span>
              <button onClick={() => setRemoveExistingPdf(false)} style={{...S.btnS, padding:'3px 8px', fontSize:11}}>Anulează</button>
            </div>
          )}

          {pdfFile && (
            <div style={{padding:'8px 12px', background:G.greenDim+'66', border:`1px solid ${G.green}55`, borderRadius:6, marginBottom:10, fontSize:12, color:G.green, display:'flex', justifyContent:'space-between', alignItems:'center'}}>
              <span>✓ Fișier nou: <strong>{pdfFile.name}</strong> ({(pdfFile.size/1024).toFixed(0)} KB)</span>
              <button onClick={() => setPdfFile(null)} style={{...S.btnS, padding:'3px 8px', fontSize:11}}>Anulează</button>
            </div>
          )}

          {canEdit && (
            <>
              <label style={{...S.btnS, display:'inline-flex', alignItems:'center', gap:8, cursor:'pointer'}}>
                <span>📤</span>
                <span>{doc?.pdf_url || pdfFile ? 'Înlocuiește PDF' : 'Încarcă PDF'}</span>
                <input type="file" accept="application/pdf" onChange={onFileSelect} style={{display:'none'}} />
              </label>
              <div style={{fontSize:10, color:G.dim, marginTop:6}}>Doar PDF, max 10MB</div>
            </>
          )}
        </div>

        <div style={{display:'flex', justifyContent:'space-between', gap:8, paddingTop:14, borderTop:`1px solid ${G.border}`}}>
          <div>
            {isEdit && canEdit && (
              !confirmDel ? (
                <button onClick={() => setConfirmDel(true)} disabled={saving || deleting} style={{...S.btnS, color:G.red, borderColor:G.red+'44', fontSize:13}}>🗑 Șterge</button>
              ) : (
                <div style={{display:'flex', gap:6, alignItems:'center'}}>
                  <span style={{fontSize:12, color:G.red}}>Sigur?</span>
                  <button onClick={handleDelete} disabled={deleting} style={{...S.btnP, background:G.red, padding:'6px 12px', fontSize:12}}>
                    {deleting ? '⏳' : '✓ Da, șterge'}
                  </button>
                  <button onClick={() => setConfirmDel(false)} disabled={deleting} style={{...S.btnS, padding:'6px 12px', fontSize:12}}>Nu</button>
                </div>
              )
            )}
          </div>

          <div style={{display:'flex', gap:8}}>
            <button onClick={onClose} disabled={saving || deleting} style={{...S.btnS, fontSize:13}}>Anulează</button>
            {canEdit && (
              <button onClick={handleSave} disabled={saving || deleting} style={{...S.btnP, background:G.logistica, color:'#000', opacity:(saving||deleting)?.6:1}}>
                {saving ? '⏳ Se salvează...' : (isEdit ? '✓ Salvează modificările' : '➕ Adaugă document')}
              </button>
            )}
          </div>
        </div>

        {!canEdit && (
          <div style={{marginTop:12, padding:'8px 12px', background:G.yellowDim+'44', borderRadius:6, fontSize:11, color:G.yellow, textAlign:'center'}}>
            ℹ️ Mod doar-citire. Doar admin sau editor pot modifica documente.
          </div>
        )}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// LISTA COMPACTĂ — pentru integrare în ActivFormModal (pagina utilajului)
// ════════════════════════════════════════════════════════════════════════════

export function DocumenteUtilajList({ activId, canEdit, showToast }) {
  const [docs, setDocs] = useState([])
  const [tipuri, setTipuri] = useState([])
  const [load, setLoad] = useState(true)
  const [modal, setModal] = useState(null)
  const [openingPdfId, setOpeningPdfId] = useState(null)

  const loadAll = useCallback(async () => {
    if (!activId) return
    setLoad(true)
    const [docsRes, tipuriRes] = await Promise.all([
      supabase.from('logistica_documente')
        .select('*')
        .or(`entitate_id.eq.${activId},active_id.eq.${activId}`)
        .order('data_expirare', { ascending:true, nullsFirst:false }),
      supabase.from('logistica_tipuri_documente')
        .select('*').eq('activ', true).order('nume'),
    ])
    if (docsRes.error) showToast('Eroare docs: ' + docsRes.error.message, 'error')
    if (tipuriRes.error) showToast('Eroare tipuri: ' + tipuriRes.error.message, 'error')
    setDocs(docsRes.data || [])
    setTipuri(tipuriRes.data || [])
    setLoad(false)
  }, [activId])  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadAll() }, [loadAll])

  const enriched = useMemo(() => docs.map(d => {
    const zile = daysUntilToday(d.data_expirare)
    const status = computeStatus(zile)
    const tip = tipuri.find(t => t.id === d.tip_id)
    return { ...d, _zile:zile, _status:status, _tipNume: tip?.nume || `tip #${d.tip_id}` }
  }), [docs, tipuri])

  return (
    <>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10}}>
        <div style={{fontSize:11, color:G.muted}}>
          {load ? 'Se încarcă...' : `${enriched.length} document${enriched.length === 1 ? '' : 'e'}`}
        </div>
        {canEdit && (
          <button onClick={() => setModal({ mode:'add' })} style={{...S.btnS, padding:'5px 11px', fontSize:12, color:G.logistica, borderColor:G.logistica+'55'}}>
            ➕ Adaugă document
          </button>
        )}
      </div>

      {!load && enriched.length === 0 && (
        <div style={{padding:'18px', background:G.bg, border:`1px dashed ${G.border2}`, borderRadius:8, textAlign:'center', color:G.dim, fontSize:12}}>
          Niciun document înregistrat pentru acest utilaj.
        </div>
      )}

      {enriched.length > 0 && (
        <div style={{...S.card, padding:0, overflow:'hidden'}}>
          {enriched.map((d, idx) => {
            const zileColor = d._status === 'expirat' ? G.red
                            : d._status === 'expira_30z' ? G.orange
                            : d._status === 'expira_90z' ? G.yellow : G.muted
            const hasPdf = !!d.pdf_url
            return (
              <div key={d.id}
                onClick={() => canEdit && setModal({ mode:'edit', doc:d })}
                style={{
                  display:'grid', gridTemplateColumns:'minmax(0, 1.4fr) 90px 60px 90px auto auto', gap:10,
                  padding:'10px 14px', alignItems:'center',
                  borderBottom: idx < enriched.length-1 ? `1px solid ${G.border}` : 'none',
                  fontSize:12,
                  cursor: canEdit ? 'pointer' : 'default',
                  transition:'background .12s',
                }}
                onMouseEnter={e => { if (canEdit) e.currentTarget.style.background = G.bg }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
              >
                <div style={{minWidth:0}}>
                  <div style={{fontWeight:600, color:G.text}}>{d._tipNume}</div>
                  {d.numar_document && <div style={{fontSize:10, color:G.muted, fontFamily:'monospace', marginTop:2}}>{d.numar_document}</div>}
                </div>
                <div style={{color:G.muted, fontVariantNumeric:'tabular-nums', fontSize:11}}>{fmtDate(d.data_expirare)}</div>
                <div style={{color:zileColor, fontWeight:600, fontVariantNumeric:'tabular-nums'}}>{fmtZile(d._zile)}</div>
                <div><StareBadge stare={d._status} /></div>
                <button
                  onClick={(e) => { e.stopPropagation(); if (hasPdf) openPdfFromBucket(d.pdf_url, showToast, setOpeningPdfId, d.id) }}
                  disabled={!hasPdf || openingPdfId === d.id}
                  title={hasPdf ? 'Deschide PDF' : 'Fără PDF'}
                  style={{
                    width:28, height:28, borderRadius:6,
                    background: hasPdf ? G.bg : 'transparent',
                    border:`1px solid ${hasPdf ? G.border2 : G.border}`,
                    color: hasPdf ? G.blue : G.dim,
                    cursor: hasPdf ? 'pointer' : 'not-allowed',
                    opacity: hasPdf ? 1 : .35, fontSize:12,
                  }}
                >
                  {openingPdfId === d.id ? '⏳' : (hasPdf ? '👁' : '∅')}
                </button>
                {canEdit && <span style={{color:G.dim, fontSize:10}}>✏️</span>}
              </div>
            )
          })}
        </div>
      )}

      {modal && (
        <DocumentFormModal
          doc={modal.mode === 'edit' ? modal.doc : null}
          activId={activId}
          activList={null}
          tipuri={tipuri}
          canEdit={canEdit}
          showToast={showToast}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); loadAll() }}
        />
      )}
    </>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// PAGINA PRINCIPALĂ — tab Documente Flotă
// ════════════════════════════════════════════════════════════════════════════

export default function DocumenteFlotaPage({ active, accessLevel, profile, showToast }) {
  const loc = useLocation()
  const [docs, setDocs]       = useState([])
  const [tipuri, setTipuri]   = useState([])
  const [personalDocs, setPersonalDocs] = useState([])
  const [load, setLoad]       = useState(true)
  const [loadPersonal, setLoadPersonal] = useState(true)
  const [openingPdfId, setOpeningPdfId] = useState(null)
  const [editModal, setEditModal] = useState(null)

  const [subTab, setSubTab] = useState(() => {
    const params = new URLSearchParams(loc.search)
    const s = params.get('sub')
    const valid = ['flota','alerte','personal','amc']
    return valid.includes(s) ? s : 'flota'
  })

  const [search, setSearch]   = useState('')
  const [tipF, setTipF]       = useState('Toate')
  const [stareF, setStareF]   = useState('Toate')
  const [page, setPage]       = useState(1)

  const canEdit = accessLevel === 'admin' || accessLevel === 'editor'

  // Sincronizez subTab cu URL la schimbare externă (ex: navigare directă)
  useEffect(() => {
    const params = new URLSearchParams(loc.search)
    const s = params.get('sub')
    const valid = ['flota','alerte','personal','amc']
    if (s && valid.includes(s) && s !== subTab) setSubTab(s)
  }, [loc.search])  // eslint-disable-line react-hooks/exhaustive-deps

  const activMap = useMemo(() => {
    const m = {}
    for (const a of (active || [])) m[a.id] = a
    return m
  }, [active])

  const loadAll = useCallback(async () => {
    setLoad(true)
    setLoadPersonal(true)
    const [docsRes, tipuriRes, persIscirTransport, persProfesional] = await Promise.all([
      supabase.from('logistica_documente')
        .select('id, entitate_id, active_id, tip_id, numar_document, data_emitere, data_expirare, emitent, cost, pdf_url, pdf_locatie, observatii, created_at')
        .order('data_expirare', { ascending:true, nullsFirst:false }),
      supabase.from('logistica_tipuri_documente')
        .select('id, nume, descriere, perioada_default_zile, activ')
        .eq('activ', true)
        .order('nume'),
      // Personal — scope logistică: ISCIR + Transport (toate tipurile)
      supabase.from('v_hr_autorizatii_status')
        .select('id, employee_name, functie, departament_hr, tip_categorie, tip_cod, tip_denumire, numar_autorizatie, emitent, data_expirare, fara_expirare, zile_pana_expirare, status, fisier_path, fisier_nume')
        .in('tip_categorie', ['iscir', 'transport'])
        .order('data_expirare', { ascending:true, nullsFirst:false }),
      // Personal — scope logistică: Profesional restrâns (doar OPERATOR_UTILAJ + MECANIC_AUTO)
      supabase.from('v_hr_autorizatii_status')
        .select('id, employee_name, functie, departament_hr, tip_categorie, tip_cod, tip_denumire, numar_autorizatie, emitent, data_expirare, fara_expirare, zile_pana_expirare, status, fisier_path, fisier_nume')
        .eq('tip_categorie', 'profesional')
        .in('tip_cod', ['OPERATOR_UTILAJ', 'MECANIC_AUTO'])
        .order('data_expirare', { ascending:true, nullsFirst:false }),
    ])
    if (docsRes.error)   showToast(`Eroare la încărcare documente: ${docsRes.error.message}`, 'error')
    if (tipuriRes.error) showToast(`Eroare la încărcare tipuri: ${tipuriRes.error.message}`, 'error')
    if (persIscirTransport.error) showToast(`Eroare autorizații personal: ${persIscirTransport.error.message}`, 'error')
    if (persProfesional.error)    showToast(`Eroare autorizații personal: ${persProfesional.error.message}`, 'error')
    setDocs(docsRes.data || [])
    setTipuri(tipuriRes.data || [])
    // Merge cele 2 fetch-uri + re-sort pe data_expirare ASC (NULL last)
    const mergedPersonal = [...(persIscirTransport.data || []), ...(persProfesional.data || [])]
      .sort((a, b) => {
        if (!a.data_expirare && !b.data_expirare) return 0
        if (!a.data_expirare) return 1
        if (!b.data_expirare) return -1
        return a.data_expirare.localeCompare(b.data_expirare)
      })
    setPersonalDocs(mergedPersonal)
    setLoad(false)
    setLoadPersonal(false)
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadAll() }, [loadAll])
  useEffect(() => { setPage(1) }, [search, tipF, stareF])

  const enriched = useMemo(() => {
    return docs.map(d => {
      const activId = d.entitate_id ?? d.active_id
      const u = activMap[activId] || null
      const zile = daysUntilToday(d.data_expirare)
      const status = computeStatus(zile)
      const tip = tipuri.find(t => t.id === d.tip_id)
      return { ...d, _utilaj:u, _zile:zile, _status:status, _tipNume: tip?.nume || `tip #${d.tip_id}` }
    })
  }, [docs, activMap, tipuri])

  const kpi = useMemo(() => {
    const k = { total: enriched.length, expirat:0, expira_30z:0, expira_90z:0, ok:0 }
    for (const d of enriched) k[d._status]++
    return k
  }, [enriched])

  // Badge Personal = autorizații expirate + expiră ≤30z în scope-ul logisticii
  const badgePersonal = useMemo(() => {
    let n = 0
    for (const d of personalDocs) {
      if (d.status === 'expirat' || d.status === 'expira_30z') n++
    }
    return n
  }, [personalDocs])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return enriched.filter(d => {
      if (tipF !== 'Toate'   && d._tipNume !== tipF) return false
      if (stareF !== 'Toate' && d._status !== stareF) return false
      if (q) {
        const u = d._utilaj
        const hay = [
          u?.marca, u?.model, u?.nr_inmatriculare, u?.cod_intern, u?.nr_inventar,
          d.numar_document, d._tipNume, d.emitent,
        ].filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [enriched, search, tipF, stareF])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const paginated = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE
    return filtered.slice(start, start + PAGE_SIZE)
  }, [filtered, safePage])

  if (load) {
    return (
      <div style={{...S.card, padding:60, textAlign:'center', color:G.muted, fontSize:14}}>
        ⏳ Se încarcă documentele…
      </div>
    )
  }

  return (
    <div>
      <DocumenteSubTabsBar
        subTab={subTab}
        setSubTab={setSubTab}
        badgeAlerte={(kpi.expirat || 0) + (kpi.expira_30z || 0)}
        badgePersonal={badgePersonal}
      />

      {subTab === 'flota' && (<>
      <div style={{display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:12, marginBottom:16}}>
        <KPICard icon="📎" label="Total documente" value={kpi.total} />
        <KPICard icon="🚨" label="Expirate"        value={kpi.expirat}    color={G.red}    bg={G.redDim+'66'} />
        <KPICard icon="⏰" label="Expiră ≤ 30z"    value={kpi.expira_30z} color={G.orange} bg="#3A201066" />
        <KPICard icon="🕒" label="Expiră ≤ 90z"    value={kpi.expira_90z} color={G.yellow} bg={G.yellowDim+'66'} />
      </div>

      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1.6fr auto', gap:10, marginBottom:14}}>
        <select value={tipF} onChange={e => setTipF(e.target.value)} style={{...S.input, padding:'9px 12px', cursor:'pointer'}}>
          <option value="Toate">Toate tipurile</option>
          {tipuri.map(t => <option key={t.id} value={t.nume}>{t.nume}</option>)}
        </select>
        <select value={stareF} onChange={e => setStareF(e.target.value)} style={{...S.input, padding:'9px 12px', cursor:'pointer'}}>
          <option value="Toate">Toate stările</option>
          <option value="expirat">Doar expirate</option>
          <option value="expira_30z">Expiră în 30 zile</option>
          <option value="expira_90z">Expiră în 90 zile</option>
          <option value="ok">În regulă</option>
        </select>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="🔎 Marcă, plăcuță, cod intern, nr document…"
          style={{...S.input, padding:'9px 12px'}}
        />
        {(profile?.is_owner || profile?.can_use_document_scanner) ? (
          <DocumentScannerButton profile={profile} showToast={showToast} onSaved={loadAll} />
        ) : (
          <div title="Adăugarea documentelor se face din detaliul utilajului (tab Active → click pe utilaj → secțiunea 📎 Documente)"
               style={{...S.btnS, padding:'9px 14px', display:'flex', alignItems:'center', gap:8, opacity:.6, cursor:'help', borderStyle:'dashed', fontSize:12}}>
            <span>ℹ️ Adaugă din pagina utilajului</span>
          </div>
        )}
      </div>

      <div style={{...S.card, overflow:'hidden'}}>
        <div style={{display:'grid', gridTemplateColumns:'minmax(0, 2fr) minmax(0, 1.1fr) 100px 70px 110px 50px', gap:10, padding:'12px 16px', background:G.bg, borderBottom:`1px solid ${G.border}`, fontSize:11, fontWeight:700, color:G.muted, textTransform:'uppercase', letterSpacing:'.5px'}}>
          <div>Utilaj</div>
          <div>Tip doc</div>
          <div>Expirare</div>
          <div>Zile</div>
          <div>Stare</div>
          <div></div>
        </div>

        {paginated.length === 0 ? (
          <div style={{padding:50, textAlign:'center', color:G.muted, fontSize:13}}>
            {filtered.length === 0 && enriched.length > 0
              ? '🔍 Niciun document nu se potrivește cu filtrele aplicate.'
              : '📭 Nu există documente.'}
          </div>
        ) : paginated.map(d => {
          const u = d._utilaj
          const zileColor = d._status === 'expirat' ? G.red
                          : d._status === 'expira_30z' ? G.orange
                          : d._status === 'expira_90z' ? G.yellow
                          : G.muted
          const hasPdf = !!d.pdf_url
          return (
            <div key={d.id}
              onClick={() => canEdit && setEditModal({ doc:d })}
              style={{display:'grid', gridTemplateColumns:'minmax(0, 2fr) minmax(0, 1.1fr) 100px 70px 110px 50px', gap:10, padding:'11px 16px', alignItems:'center', borderBottom:`1px solid ${G.border}`, fontSize:13, cursor: canEdit ? 'pointer' : 'default', transition:'background .12s'}}
              onMouseEnter={e => { if (canEdit) e.currentTarget.style.background = G.bg + '88' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >
              <div style={{minWidth:0}}>
                {u ? (
                  <>
                    <div style={{fontWeight:600, color:G.text, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                      {u.marca} {u.model}
                    </div>
                    <div style={{display:'flex', gap:8, fontSize:11, marginTop:2, alignItems:'center'}}>
                      {u.nr_inmatriculare && <span style={{color:G.blue, fontFamily:'monospace'}}>{u.nr_inmatriculare}</span>}
                      {u.cod_intern && <span style={{color:G.logistica, fontFamily:'monospace', fontWeight:700}}>{u.cod_intern}</span>}
                    </div>
                  </>
                ) : (
                  <span style={{color:G.dim, fontStyle:'italic'}}>utilaj #{d.entitate_id ?? d.active_id} (lipsă)</span>
                )}
              </div>
              <div style={{color:G.text, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{d._tipNume}</div>
              <div style={{color:G.muted, fontVariantNumeric:'tabular-nums', fontSize:12}}>{fmtDate(d.data_expirare)}</div>
              <div style={{color: zileColor, fontWeight:600, fontVariantNumeric:'tabular-nums'}}>{fmtZile(d._zile)}</div>
              <div><StareBadge stare={d._status} /></div>
              <div>
                <button
                  onClick={(e) => { e.stopPropagation(); if (hasPdf) openPdfFromBucket(d.pdf_url, showToast, setOpeningPdfId, d.id) }}
                  disabled={!hasPdf || openingPdfId === d.id}
                  title={hasPdf ? 'Deschide PDF în tab nou' : 'Fără PDF uploadat'}
                  style={{
                    width:32, height:32, borderRadius:6,
                    background: hasPdf ? G.bg : 'transparent',
                    border:`1px solid ${hasPdf ? G.border2 : G.border}`,
                    color: hasPdf ? G.blue : G.dim,
                    cursor: hasPdf ? 'pointer' : 'not-allowed',
                    opacity: hasPdf ? 1 : .4, fontSize:14,
                    display:'flex', alignItems:'center', justifyContent:'center',
                  }}
                >
                  {openingPdfId === d.id ? '⏳' : (hasPdf ? '👁' : '∅')}
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:14, fontSize:12, color:G.muted}}>
        <div>
          Afișate {paginated.length > 0 ? ((safePage-1)*PAGE_SIZE + 1) : 0}–{(safePage-1)*PAGE_SIZE + paginated.length}
          {' '}din {filtered.length}
          {filtered.length !== enriched.length && <span style={{color:G.dim}}> (total {enriched.length})</span>}
          {canEdit && filtered.length > 0 && <span style={{color:G.dim, marginLeft:10}}>· click pe rând = editare</span>}
        </div>
        {totalPages > 1 && (
          <div style={{display:'flex', gap:6, alignItems:'center'}}>
            <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={safePage <= 1} style={{...S.btnS, padding:'5px 12px', fontSize:12, opacity: safePage <= 1 ? .4 : 1, cursor: safePage <= 1 ? 'not-allowed' : 'pointer'}}>← Prev</button>
            <span style={{padding:'0 8px', fontVariantNumeric:'tabular-nums'}}>{safePage} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p+1))} disabled={safePage >= totalPages} style={{...S.btnS, padding:'5px 12px', fontSize:12, opacity: safePage >= totalPages ? .4 : 1, cursor: safePage >= totalPages ? 'not-allowed' : 'pointer'}}>Next →</button>
          </div>
        )}
      </div>
      </>)}

      {subTab === 'alerte' && (
        <AlerteSection
          enriched={enriched}
          canEdit={canEdit}
          onEditDoc={d => setEditModal({ doc:d })}
          openingPdfId={openingPdfId}
          setOpeningPdfId={setOpeningPdfId}
          showToast={showToast}
        />
      )}

      {subTab === 'personal' && (
        <PersonalSection
          docs={personalDocs}
          loading={loadPersonal}
          showToast={showToast}
        />
      )}

      {subTab === 'amc' && (
        <AmcSection
          accessLevel={accessLevel}
          showToast={showToast}
        />
      )}

      {editModal && (
        <DocumentFormModal
          doc={editModal.doc}
          activId={editModal.doc.entitate_id ?? editModal.doc.active_id}
          activList={active}
          tipuri={tipuri}
          canEdit={canEdit}
          showToast={showToast}
          onClose={() => setEditModal(null)}
          onSaved={() => { setEditModal(null); loadAll() }}
        />
      )}
    </div>
  )
}
