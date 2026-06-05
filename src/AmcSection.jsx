// ════════════════════════════════════════════════════════════════════════════
// MODULUL LOGISTICĂ — Tab AMC (Aparate de Măsură și Control)
// ════════════════════════════════════════════════════════════════════════════
// Etapa 4b: evidență AMC standalone (NU legate de utilaj)
// - 10 tipuri pre-populate în logistica_amc_tipuri (seed)
// - admin_logistica adaugă/editează echipamente + tipuri
// - editor poate edita; viewer doar vede
// Bucket Storage: documente-amc
// ════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from './lib/supabase.js'
import ScannerAmcButton from './ScannerAmcButton.jsx'
import { compressFileBeforeUpload } from './utils/compressFile'

// ─── Theme (sincron cu DocumenteFlotaPage.jsx) ──────────────────────────────
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
const BUCKET = 'documente-amc'

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
  if (!pdfPath) { showToast('Acest echipament nu are PDF uploadat', 'warn'); return }
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

// ════════════════════════════════════════════════════════════════════════════
// MODAL: Add / Edit Echipament AMC
// ════════════════════════════════════════════════════════════════════════════

function AmcFormModal({ doc, tipuri, onClose, onSaved, canEdit, showToast }) {
  const isEdit = !!doc

  const [form, setForm] = useState({
    tip_id: doc?.tip_id ?? '',
    denumire: doc?.denumire || '',
    serie: doc?.serie || '',
    producator: doc?.producator || '',
    model: doc?.model || '',
    clasa_presiune: doc?.clasa_presiune || '',
    data_verificare: doc?.data_verificare || todayISO(),
    data_expirare: doc?.data_expirare || '',
    emitent: doc?.emitent || '',
    cost: doc?.cost ?? '',
    observatii: doc?.observatii || '',
    activ: doc?.activ ?? true,
  })
  const [pdfFile, setPdfFile] = useState(null)
  const [removeExistingPdf, setRemoveExistingPdf] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [autoExpirare, setAutoExpirare] = useState(!isEdit)

  const setField = (k, v) => setForm(p => ({ ...p, [k]: v }))

  // Auto-calc data_expirare bazat pe tip + data_verificare
  useEffect(() => {
    if (!autoExpirare) return
    const tip = tipuri.find(t => t.id === Number(form.tip_id))
    if (tip && tip.perioada_default_zile && form.data_verificare) {
      setForm(p => ({ ...p, data_expirare: addDaysISO(form.data_verificare, tip.perioada_default_zile) }))
    }
  }, [form.tip_id, form.data_verificare, autoExpirare, tipuri])

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

  const tipSelected = tipuri.find(t => t.id === Number(form.tip_id))
  const isManometru = tipSelected && /manometru/i.test(tipSelected.nume)

  const handleSave = async () => {
    if (!form.tip_id)      { showToast('Selectează tipul echipamentului', 'error'); return }
    if (!form.denumire.trim()) { showToast('Completează denumirea', 'error'); return }
    if (!form.data_expirare)   { showToast('Completează data expirării', 'error'); return }

    setSaving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      let pdfPath = doc?.pdf_url ?? null

      if (pdfFile) {
        const tipSlug = slugify(tipSelected?.nume || 'amc')
        const denSlug = slugify(form.denumire) || 'amc'
        const fileName = `${tipSlug}/${denSlug}-${Date.now()}.pdf`
        const compressedPdf = await compressFileBeforeUpload(pdfFile)
        const { error: upErr } = await supabase.storage.from(BUCKET)
          .upload(fileName, compressedPdf, { contentType: 'application/pdf', upsert: false })
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
        tip_id: Number(form.tip_id),
        denumire: form.denumire.trim(),
        serie: form.serie.trim() || null,
        producator: form.producator.trim() || null,
        model: form.model.trim() || null,
        clasa_presiune: form.clasa_presiune.trim() || null,
        data_verificare: form.data_verificare || null,
        data_expirare: form.data_expirare,
        emitent: form.emitent.trim() || null,
        cost: form.cost !== '' ? Number(form.cost) : null,
        observatii: form.observatii.trim() || null,
        activ: !!form.activ,
        pdf_url: pdfPath,
      }
      if (!isEdit) payload.created_by = user?.id || null

      const op = isEdit
        ? supabase.from('logistica_amc').update(payload).eq('id', doc.id).select().single()
        : supabase.from('logistica_amc').insert(payload).select().single()
      const { error: dbErr } = await op
      if (dbErr) throw dbErr

      showToast(isEdit ? '✓ Echipament actualizat' : '✓ Echipament adăugat', 'success')
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
      const { error } = await supabase.from('logistica_amc').delete().eq('id', doc.id)
      if (error) throw error
      showToast('✓ Echipament șters', 'success')
      onSaved()
    } catch (e) {
      showToast('Eroare la ștergere: ' + (e.message || e), 'error')
    } finally {
      setDeleting(false); setConfirmDel(false)
    }
  }

  return (
    <div onClick={onClose} style={{position:'fixed', inset:0, background:'#000000cc', zIndex:300, display:'flex', alignItems:'flex-start', justifyContent:'center', padding:'30px 16px', overflowY:'auto'}}>
      <div onClick={e => e.stopPropagation()} style={{...S.card, padding:22, width:'100%', maxWidth:680, boxShadow:'0 20px 80px rgba(0,0,0,.6)', borderTop:`3px solid ${G.logistica}`}}>

        <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:16, paddingBottom:14, borderBottom:`1px solid ${G.border}`}}>
          <div>
            <div style={{fontSize:18, fontWeight:800, color:G.text}}>
              {isEdit ? '✏️ Editează echipament AMC' : '➕ Echipament AMC nou'}
            </div>
            <div style={{fontSize:11, color:G.muted, marginTop:3}}>
              Aparat de măsură și control · verificare metrologică
            </div>
          </div>
          <button onClick={onClose} style={{...S.btnS, padding:'4px 10px', fontSize:13}}>✕</button>
        </div>

        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:14}}>

          <div style={{gridColumn:'1 / -1'}}>
            <div style={{fontSize:11, color:G.muted, fontWeight:600, marginBottom:5}}>Tip echipament <span style={{color:G.red}}>*</span></div>
            <select value={form.tip_id} onChange={e => setField('tip_id', e.target.value)} style={{...S.input, cursor:'pointer'}}>
              <option value="">— alege tipul —</option>
              {tipuri.filter(t => t.activ).map(t => (
                <option key={t.id} value={t.id}>{t.nume}{t.perioada_default_zile ? ` (${t.perioada_default_zile}z)` : ''}</option>
              ))}
            </select>
            {tipSelected?.descriere && <div style={{fontSize:10, color:G.dim, marginTop:3}}>{tipSelected.descriere}</div>}
          </div>

          <div style={{gridColumn:'1 / -1'}}>
            <div style={{fontSize:11, color:G.muted, fontWeight:600, marginBottom:5}}>Denumire <span style={{color:G.red}}>*</span></div>
            <input type="text" value={form.denumire} onChange={e => setField('denumire', e.target.value)} placeholder="ex: Manometru digital 0-25 bar, șantier Brașov" style={{...S.input}} />
          </div>

          <div>
            <div style={{fontSize:11, color:G.muted, fontWeight:600, marginBottom:5}}>Serie</div>
            <input type="text" value={form.serie} onChange={e => setField('serie', e.target.value)} placeholder="ex: SN-2024-12345" style={{...S.input, fontFamily:'monospace', fontSize:13}} />
          </div>

          <div>
            <div style={{fontSize:11, color:G.muted, fontWeight:600, marginBottom:5}}>Producător</div>
            <input type="text" value={form.producator} onChange={e => setField('producator', e.target.value)} placeholder="ex: WIKA, GMC, Honeywell" style={{...S.input}} />
          </div>

          <div>
            <div style={{fontSize:11, color:G.muted, fontWeight:600, marginBottom:5}}>Model</div>
            <input type="text" value={form.model} onChange={e => setField('model', e.target.value)} placeholder="ex: DPI-705" style={{...S.input}} />
          </div>

          <div>
            <div style={{fontSize:11, color:G.muted, fontWeight:600, marginBottom:5}}>
              Clasa presiune {isManometru && <span style={{color:G.logistica, fontSize:10}}>(pt. manometru)</span>}
            </div>
            <input type="text" value={form.clasa_presiune} onChange={e => setField('clasa_presiune', e.target.value)} placeholder="ex: 0-25 bar, 0-100 bar" style={{...S.input, fontFamily:'monospace', fontSize:13}} />
          </div>

          <div>
            <div style={{fontSize:11, color:G.muted, fontWeight:600, marginBottom:5}}>Data verificare</div>
            <input type="date" value={form.data_verificare} onChange={e => setField('data_verificare', e.target.value)} style={{...S.input}} />
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
            <div style={{fontSize:11, color:G.muted, fontWeight:600, marginBottom:5}}>Emitent verificare</div>
            <input type="text" value={form.emitent} onChange={e => setField('emitent', e.target.value)} placeholder="ex: INM, BRML, laborator autorizat" style={{...S.input}} />
          </div>

          <div>
            <div style={{fontSize:11, color:G.muted, fontWeight:600, marginBottom:5}}>Cost (RON)</div>
            <input type="number" step="0.01" min="0" value={form.cost} onChange={e => setField('cost', e.target.value)} placeholder="ex: 250.00" style={{...S.input, fontVariantNumeric:'tabular-nums'}} />
          </div>

          <div style={{gridColumn:'1 / -1'}}>
            <div style={{fontSize:11, color:G.muted, fontWeight:600, marginBottom:5}}>Observații</div>
            <textarea rows={2} value={form.observatii} onChange={e => setField('observatii', e.target.value)} style={{...S.input, resize:'vertical', fontFamily:'inherit'}} />
          </div>

          {isEdit && (
            <div style={{gridColumn:'1 / -1', display:'flex', alignItems:'center', gap:8, padding:'8px 12px', background:G.bg, border:`1px solid ${G.border}`, borderRadius:8}}>
              <input type="checkbox" id="amc-activ" checked={form.activ} onChange={e => setField('activ', e.target.checked)} style={{cursor:'pointer'}} />
              <label htmlFor="amc-activ" style={{fontSize:12, color:G.text, cursor:'pointer'}}>
                Echipament <strong>activ</strong> (debifează dacă e scos din uz / casat)
              </label>
            </div>
          )}
        </div>

        <div style={{background:G.bg, border:`1px solid ${G.border}`, borderRadius:8, padding:14, marginBottom:16}}>
          <div style={{fontSize:11, color:G.logistica, fontWeight:700, textTransform:'uppercase', letterSpacing:'.5px', marginBottom:10}}>📄 Certificat verificare</div>

          {doc?.pdf_url && !pdfFile && !removeExistingPdf && (
            <div style={{display:'flex', alignItems:'center', gap:10, marginBottom:10, padding:'8px 12px', background:G.surface, border:`1px solid ${G.border2}`, borderRadius:6}}>
              <span style={{fontSize:18}}>📎</span>
              <div style={{flex:1, minWidth:0}}>
                <div style={{fontSize:12, color:G.text, fontWeight:600}}>Certificat existent</div>
                <div style={{fontSize:10, color:G.muted, fontFamily:'monospace', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{doc.pdf_url}</div>
              </div>
              <button onClick={() => openPdfFromBucket(doc.pdf_url, showToast)} style={{...S.btnS, padding:'5px 10px', fontSize:12, color:G.blue}}>👁 Vezi</button>
              {canEdit && <button onClick={() => setRemoveExistingPdf(true)} style={{...S.btnS, padding:'5px 10px', fontSize:12, color:G.red}}>🗑 Șterge</button>}
            </div>
          )}

          {removeExistingPdf && !pdfFile && (
            <div style={{padding:'8px 12px', background:G.redDim+'66', border:`1px solid ${G.red}55`, borderRadius:6, marginBottom:10, fontSize:12, color:G.red, display:'flex', justifyContent:'space-between', alignItems:'center'}}>
              <span>⚠️ Certificatul va fi șters la salvare</span>
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
                <span>{doc?.pdf_url || pdfFile ? 'Înlocuiește certificat' : 'Încarcă certificat'}</span>
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
                {saving ? '⏳ Se salvează...' : (isEdit ? '✓ Salvează modificările' : '➕ Adaugă echipament')}
              </button>
            )}
          </div>
        </div>

        {!canEdit && (
          <div style={{marginTop:12, padding:'8px 12px', background:G.yellowDim+'44', borderRadius:6, fontSize:11, color:G.yellow, textAlign:'center'}}>
            ℹ️ Mod doar-citire. Doar admin sau editor pot modifica AMC-uri.
          </div>
        )}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// MODAL: Gestionare tipuri AMC (admin only)
// ════════════════════════════════════════════════════════════════════════════

function TipuriAmcManager({ tipuri, onClose, onSaved, showToast }) {
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState({ nume:'', descriere:'', perioada_default_zile:365, activ:true })
  const [saving, setSaving] = useState(false)
  const [confirmDelId, setConfirmDelId] = useState(null)

  const startEdit = (t) => {
    setEditingId(t.id)
    setEditForm({ nume:t.nume, descriere:t.descriere || '', perioada_default_zile:t.perioada_default_zile || 365, activ:t.activ })
  }
  const startAdd = () => {
    setEditingId('new')
    setEditForm({ nume:'', descriere:'', perioada_default_zile:365, activ:true })
  }
  const cancel = () => { setEditingId(null); setConfirmDelId(null) }

  const save = async () => {
    if (!editForm.nume.trim()) { showToast('Completează numele tipului', 'error'); return }
    setSaving(true)
    try {
      const payload = {
        nume: editForm.nume.trim(),
        descriere: editForm.descriere.trim() || null,
        perioada_default_zile: Number(editForm.perioada_default_zile) || 365,
        activ: !!editForm.activ,
      }
      const op = editingId === 'new'
        ? supabase.from('logistica_amc_tipuri').insert({ ...payload, ordine: tipuri.length + 1 }).select().single()
        : supabase.from('logistica_amc_tipuri').update(payload).eq('id', editingId).select().single()
      const { error } = await op
      if (error) throw error
      showToast(editingId === 'new' ? '✓ Tip adăugat' : '✓ Tip actualizat', 'success')
      setEditingId(null)
      onSaved()
    } catch (e) {
      showToast('Eroare: ' + (e.message || e), 'error')
    } finally {
      setSaving(false)
    }
  }

  const del = async (id) => {
    setSaving(true)
    try {
      // Verific dacă există echipamente cu acest tip
      const { count } = await supabase.from('logistica_amc').select('*', { count:'exact', head:true }).eq('tip_id', id)
      if (count && count > 0) {
        showToast(`Nu poți șterge — există ${count} echipament${count===1?'':'e'} cu acest tip. Dezactivează-l în schimb.`, 'error')
        setConfirmDelId(null)
        return
      }
      const { error } = await supabase.from('logistica_amc_tipuri').delete().eq('id', id)
      if (error) throw error
      showToast('✓ Tip șters', 'success')
      setConfirmDelId(null)
      onSaved()
    } catch (e) {
      showToast('Eroare: ' + (e.message || e), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div onClick={onClose} style={{position:'fixed', inset:0, background:'#000000cc', zIndex:300, display:'flex', alignItems:'flex-start', justifyContent:'center', padding:'30px 16px', overflowY:'auto'}}>
      <div onClick={e => e.stopPropagation()} style={{...S.card, padding:20, width:'100%', maxWidth:720, boxShadow:'0 20px 80px rgba(0,0,0,.6)', borderTop:`3px solid ${G.logistica}`}}>

        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14, paddingBottom:12, borderBottom:`1px solid ${G.border}`}}>
          <div>
            <div style={{fontSize:17, fontWeight:800, color:G.text}}>⚙ Gestionare tipuri AMC</div>
            <div style={{fontSize:11, color:G.muted, marginTop:3}}>{tipuri.length} tip{tipuri.length===1?'':'uri'} configurat{tipuri.length===1?'':'e'}</div>
          </div>
          <div style={{display:'flex', gap:8}}>
            {editingId !== 'new' && <button onClick={startAdd} style={{...S.btnS, color:G.logistica, borderColor:G.logistica+'55', fontSize:13}}>➕ Tip nou</button>}
            <button onClick={onClose} style={{...S.btnS, padding:'4px 10px', fontSize:13}}>✕</button>
          </div>
        </div>

        {editingId === 'new' && (
          <div style={{padding:14, background:G.bg, border:`1px solid ${G.logistica}55`, borderRadius:8, marginBottom:14}}>
            <div style={{fontSize:12, fontWeight:700, color:G.logistica, marginBottom:10}}>➕ Tip nou</div>
            <div style={{display:'grid', gridTemplateColumns:'2fr 1fr', gap:10, marginBottom:10}}>
              <input type="text" placeholder="Nume tip (ex: Calorimetru)" value={editForm.nume} onChange={e => setEditForm(p => ({...p, nume:e.target.value}))} style={{...S.input}} />
              <input type="number" min="1" placeholder="Perioadă (zile)" value={editForm.perioada_default_zile} onChange={e => setEditForm(p => ({...p, perioada_default_zile:e.target.value}))} style={{...S.input, fontVariantNumeric:'tabular-nums'}} />
            </div>
            <input type="text" placeholder="Descriere (opțional)" value={editForm.descriere} onChange={e => setEditForm(p => ({...p, descriere:e.target.value}))} style={{...S.input, marginBottom:10}} />
            <div style={{display:'flex', justifyContent:'flex-end', gap:8}}>
              <button onClick={cancel} style={{...S.btnS, fontSize:12}}>Anulează</button>
              <button onClick={save} disabled={saving} style={{...S.btnP, background:G.logistica, color:'#000', padding:'7px 14px', fontSize:13, opacity:saving?.6:1}}>{saving ? '⏳' : '✓ Adaugă'}</button>
            </div>
          </div>
        )}

        <div style={{...S.card, padding:0, overflow:'hidden'}}>
          <div style={{display:'grid', gridTemplateColumns:'minmax(0, 2fr) 90px 70px 110px', gap:10, padding:'10px 14px', background:G.bg, borderBottom:`1px solid ${G.border}`, fontSize:10, fontWeight:700, color:G.muted, textTransform:'uppercase', letterSpacing:'.4px'}}>
            <div>Nume</div>
            <div>Perioadă</div>
            <div>Activ</div>
            <div></div>
          </div>
          {tipuri.length === 0 && (
            <div style={{padding:30, textAlign:'center', color:G.muted, fontSize:12}}>Niciun tip configurat.</div>
          )}
          {tipuri.map(t => {
            const isEditing = editingId === t.id
            const isConfirmDel = confirmDelId === t.id
            return (
              <div key={t.id} style={{padding:'10px 14px', borderBottom:`1px solid ${G.border}`, fontSize:13}}>
                {!isEditing ? (
                  <div style={{display:'grid', gridTemplateColumns:'minmax(0, 2fr) 90px 70px 110px', gap:10, alignItems:'center'}}>
                    <div style={{minWidth:0}}>
                      <div style={{fontWeight:600, color: t.activ ? G.text : G.dim, textDecoration: t.activ ? 'none' : 'line-through'}}>{t.nume}</div>
                      {t.descriere && <div style={{fontSize:10, color:G.muted, marginTop:2}}>{t.descriere}</div>}
                    </div>
                    <div style={{color:G.muted, fontVariantNumeric:'tabular-nums', fontSize:12}}>{t.perioada_default_zile}z</div>
                    <div>
                      <span style={{fontSize:10, fontWeight:700, padding:'2px 7px', borderRadius:8, background: t.activ ? G.green+'22' : G.dim+'22', color: t.activ ? G.green : G.dim}}>
                        {t.activ ? 'ACTIV' : 'INACTIV'}
                      </span>
                    </div>
                    <div style={{display:'flex', gap:4, justifyContent:'flex-end'}}>
                      {!isConfirmDel ? (
                        <>
                          <button onClick={() => startEdit(t)} style={{...S.btnS, padding:'3px 8px', fontSize:11}}>✏️</button>
                          <button onClick={() => setConfirmDelId(t.id)} style={{...S.btnS, padding:'3px 8px', fontSize:11, color:G.red}}>🗑</button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => del(t.id)} disabled={saving} style={{...S.btnP, background:G.red, padding:'3px 8px', fontSize:11}}>{saving ? '⏳' : 'Da'}</button>
                          <button onClick={cancel} disabled={saving} style={{...S.btnS, padding:'3px 8px', fontSize:11}}>Nu</button>
                        </>
                      )}
                    </div>
                  </div>
                ) : (
                  <div>
                    <div style={{display:'grid', gridTemplateColumns:'2fr 1fr', gap:8, marginBottom:8}}>
                      <input type="text" value={editForm.nume} onChange={e => setEditForm(p => ({...p, nume:e.target.value}))} style={{...S.input}} />
                      <input type="number" min="1" value={editForm.perioada_default_zile} onChange={e => setEditForm(p => ({...p, perioada_default_zile:e.target.value}))} style={{...S.input, fontVariantNumeric:'tabular-nums'}} />
                    </div>
                    <input type="text" placeholder="Descriere" value={editForm.descriere} onChange={e => setEditForm(p => ({...p, descriere:e.target.value}))} style={{...S.input, marginBottom:8}} />
                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                      <label style={{display:'flex', alignItems:'center', gap:6, fontSize:11, color:G.muted, cursor:'pointer'}}>
                        <input type="checkbox" checked={editForm.activ} onChange={e => setEditForm(p => ({...p, activ:e.target.checked}))} style={{cursor:'pointer'}} />
                        Activ
                      </label>
                      <div style={{display:'flex', gap:6}}>
                        <button onClick={cancel} style={{...S.btnS, fontSize:12}}>Anulează</button>
                        <button onClick={save} disabled={saving} style={{...S.btnP, background:G.logistica, color:'#000', padding:'6px 12px', fontSize:12, opacity:saving?.6:1}}>{saving ? '⏳' : '✓ Salvează'}</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div style={{marginTop:12, padding:'8px 12px', background:G.bg, borderRadius:6, fontSize:11, color:G.muted, lineHeight:1.5}}>
          💡 <strong>Tip dezactivat</strong> = nu apare în dropdown la adăugare echipament nou, dar echipamentele existente rămân vizibile.
          <br/>💡 Pentru a șterge un tip, trebuie să nu existe echipamente cu acel tip (sau le muți manual pe alt tip prin BD).
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// SECȚIUNEA PRINCIPALĂ — Tab AMC din DocumenteFlotaPage
// ════════════════════════════════════════════════════════════════════════════

export default function AmcSection({ accessLevel, showToast, profile }) {
  const [docs, setDocs]     = useState([])
  const [tipuri, setTipuri] = useState([])
  const [load, setLoad]     = useState(true)
  const [openingPdfId, setOpeningPdfId] = useState(null)
  const [modal, setModal]   = useState(null)        // { mode:'add'|'edit', doc? }
  const [showTipuri, setShowTipuri] = useState(false)

  const [search, setSearch] = useState('')
  const [tipF, setTipF]     = useState('Toate')
  const [stareF, setStareF] = useState('Toate')
  const [activF, setActivF] = useState('active')    // 'active' | 'toate' | 'inactive'
  const [page, setPage]     = useState(1)

  const canEdit = accessLevel === 'admin' || accessLevel === 'editor'

  const loadAll = useCallback(async () => {
    setLoad(true)
    const [docsRes, tipuriRes] = await Promise.all([
      supabase.from('logistica_amc')
        .select('*')
        .order('data_expirare', { ascending:true, nullsFirst:false }),
      supabase.from('logistica_amc_tipuri')
        .select('*')
        .order('ordine').order('nume'),
    ])
    if (docsRes.error)   showToast(`Eroare echipamente: ${docsRes.error.message}`, 'error')
    if (tipuriRes.error) showToast(`Eroare tipuri: ${tipuriRes.error.message}`, 'error')
    setDocs(docsRes.data || [])
    setTipuri(tipuriRes.data || [])
    setLoad(false)
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadAll() }, [loadAll])
  useEffect(() => { setPage(1) }, [search, tipF, stareF, activF])

  const enriched = useMemo(() => {
    return docs.map(d => {
      const zile = daysUntilToday(d.data_expirare)
      const status = computeStatus(zile)
      const tip = tipuri.find(t => t.id === d.tip_id)
      return { ...d, _zile:zile, _status:status, _tipNume: tip?.nume || `tip #${d.tip_id}` }
    })
  }, [docs, tipuri])

  // KPI numai pentru echipamente active
  const kpi = useMemo(() => {
    const k = { total: 0, expirat:0, expira_30z:0, expira_90z:0, ok:0, inactive:0 }
    for (const d of enriched) {
      if (!d.activ) { k.inactive++; continue }
      k.total++
      k[d._status]++
    }
    return k
  }, [enriched])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return enriched.filter(d => {
      if (activF === 'active'   && !d.activ) return false
      if (activF === 'inactive' &&  d.activ) return false
      if (tipF !== 'Toate' && d._tipNume !== tipF) return false
      if (stareF !== 'Toate' && d._status !== stareF) return false
      if (q) {
        const hay = [
          d.denumire, d.serie, d.producator, d.model, d.clasa_presiune,
          d._tipNume, d.emitent,
        ].filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [enriched, search, tipF, stareF, activF])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const paginated = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE
    return filtered.slice(start, start + PAGE_SIZE)
  }, [filtered, safePage])

  if (load) {
    return (
      <div style={{...S.card, padding:60, textAlign:'center', color:G.muted, fontSize:14}}>
        ⏳ Se încarcă echipamentele AMC…
      </div>
    )
  }

  return (
    <div>
      <div style={{display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:12, marginBottom:16}}>
        <KPICard icon="🔬" label="Total active" value={kpi.total} />
        <KPICard icon="🚨" label="Expirate"      value={kpi.expirat}    color={G.red}    bg={G.redDim+'66'} />
        <KPICard icon="⏰" label="Expiră ≤ 30z"  value={kpi.expira_30z} color={G.orange} bg="#3A201066" />
        <KPICard icon="🕒" label="Expiră ≤ 90z"  value={kpi.expira_90z} color={G.yellow} bg={G.yellowDim+'66'} />
      </div>

      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1.4fr auto', gap:10, marginBottom:14}}>
        <select value={tipF} onChange={e => setTipF(e.target.value)} style={{...S.input, padding:'9px 12px', cursor:'pointer'}}>
          <option value="Toate">Toate tipurile</option>
          {tipuri.filter(t => t.activ).map(t => <option key={t.id} value={t.nume}>{t.nume}</option>)}
        </select>
        <select value={stareF} onChange={e => setStareF(e.target.value)} style={{...S.input, padding:'9px 12px', cursor:'pointer'}}>
          <option value="Toate">Toate stările</option>
          <option value="expirat">Doar expirate</option>
          <option value="expira_30z">Expiră în 30 zile</option>
          <option value="expira_90z">Expiră în 90 zile</option>
          <option value="ok">În regulă</option>
        </select>
        <select value={activF} onChange={e => setActivF(e.target.value)} style={{...S.input, padding:'9px 12px', cursor:'pointer'}}>
          <option value="active">Doar active</option>
          <option value="toate">Active + inactive</option>
          <option value="inactive">Doar inactive (scoase)</option>
        </select>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="🔎 Denumire, serie, producător, model…"
          style={{...S.input, padding:'9px 12px'}}
        />
        <div style={{display:'flex', gap:6}}>
          {canEdit && accessLevel === 'admin' && (
            <button onClick={() => setShowTipuri(true)} title="Gestionare tipuri AMC" style={{...S.btnS, padding:'9px 12px', fontSize:12, color:G.muted}}>
              ⚙
            </button>
          )}
          {canEdit && (
            <ScannerAmcButton
              profile={profile}
              showToast={showToast}
              tipuri={tipuri}
              onSaved={loadAll}
              compact={false}
            />
          )}
          {canEdit && (
            <button onClick={() => setModal({ mode:'add' })} style={{...S.btnP, background:G.logistica, color:'#000', padding:'9px 14px', fontSize:13}}>
              ➕ Adaugă AMC
            </button>
          )}
        </div>
      </div>

      <div style={{...S.card, overflow:'hidden'}}>
        <div style={{display:'grid', gridTemplateColumns:'minmax(0, 2fr) minmax(0, 1.3fr) 110px 100px 70px 110px 50px', gap:10, padding:'12px 16px', background:G.bg, borderBottom:`1px solid ${G.border}`, fontSize:11, fontWeight:700, color:G.muted, textTransform:'uppercase', letterSpacing:'.5px'}}>
          <div>Denumire</div>
          <div>Tip · Serie</div>
          <div>Clasă</div>
          <div>Expirare</div>
          <div>Zile</div>
          <div>Stare</div>
          <div></div>
        </div>

        {paginated.length === 0 ? (
          <div style={{padding:50, textAlign:'center', color:G.muted, fontSize:13}}>
            {filtered.length === 0 && enriched.length > 0
              ? '🔍 Niciun echipament nu se potrivește cu filtrele aplicate.'
              : (canEdit
                  ? '📭 Niciun echipament AMC încă. Click pe „➕ Adaugă AMC" pentru a începe.'
                  : '📭 Nu există echipamente AMC.')}
          </div>
        ) : paginated.map(d => {
          const zileColor = d._status === 'expirat' ? G.red
                          : d._status === 'expira_30z' ? G.orange
                          : d._status === 'expira_90z' ? G.yellow
                          : G.muted
          const hasPdf = !!d.pdf_url
          return (
            <div key={d.id}
              onClick={() => canEdit && setModal({ mode:'edit', doc:d })}
              style={{display:'grid', gridTemplateColumns:'minmax(0, 2fr) minmax(0, 1.3fr) 110px 100px 70px 110px 50px', gap:10, padding:'11px 16px', alignItems:'center', borderBottom:`1px solid ${G.border}`, fontSize:13, cursor: canEdit ? 'pointer' : 'default', transition:'background .12s', opacity: d.activ ? 1 : .55}}
              onMouseEnter={e => { if (canEdit) e.currentTarget.style.background = G.bg + '88' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >
              <div style={{minWidth:0}}>
                <div style={{fontWeight:600, color:G.text, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                  {d.denumire}
                  {!d.activ && <span style={{marginLeft:8, fontSize:9, fontWeight:800, padding:'1px 6px', borderRadius:6, background:G.dim+'33', color:G.dim, letterSpacing:'.5px'}}>INACTIV</span>}
                </div>
                {(d.producator || d.model) && (
                  <div style={{fontSize:11, color:G.muted, marginTop:2}}>
                    {[d.producator, d.model].filter(Boolean).join(' · ')}
                  </div>
                )}
              </div>
              <div style={{minWidth:0}}>
                <div style={{color:G.text, fontSize:12, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{d._tipNume}</div>
                {d.serie && <div style={{color:G.blue, fontSize:11, fontFamily:'monospace', marginTop:2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{d.serie}</div>}
              </div>
              <div style={{color: d.clasa_presiune ? G.logistica : G.dim, fontSize:11, fontFamily:'monospace', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                {d.clasa_presiune || '—'}
              </div>
              <div style={{color:G.muted, fontVariantNumeric:'tabular-nums', fontSize:12}}>{fmtDate(d.data_expirare)}</div>
              <div style={{color: zileColor, fontWeight:600, fontVariantNumeric:'tabular-nums'}}>{fmtZile(d._zile)}</div>
              <div><StareBadge stare={d._status} /></div>
              <div>
                <button
                  onClick={(e) => { e.stopPropagation(); if (hasPdf) openPdfFromBucket(d.pdf_url, showToast, setOpeningPdfId, d.id) }}
                  disabled={!hasPdf || openingPdfId === d.id}
                  title={hasPdf ? 'Deschide certificat PDF' : 'Fără certificat uploadat'}
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
          {kpi.inactive > 0 && activF === 'active' && <span style={{color:G.dim, marginLeft:10}}>· {kpi.inactive} inactive ascunse</span>}
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

      {modal && (
        <AmcFormModal
          doc={modal.mode === 'edit' ? modal.doc : null}
          tipuri={tipuri}
          canEdit={canEdit}
          showToast={showToast}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); loadAll() }}
        />
      )}

      {showTipuri && (
        <TipuriAmcManager
          tipuri={tipuri}
          showToast={showToast}
          onClose={() => setShowTipuri(false)}
          onSaved={loadAll}
        />
      )}
    </div>
  )
}
