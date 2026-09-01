// ════════════════════════════════════════════════════════════════
// TabDocumenteFirma.jsx — Sub-tab Administrativ „Documente firmă"
// LIVE 19.05.2026 (Etapa 16 — CRUD + AI parser + versionare + alerte)
//
// Features:
// - Upload PDF (max 50MB) în bucket privat documente-firma
// - 7 categorii predefinite (act_constitutiv, certificat_legal, autorizatie, iso, financiar, hr, altele)
// - AI parser Claude Haiku 4.5 pentru extract automat tip/data/autoritate
// - Versionare prin parent_id (acte constitutive v1/v2/v3, doar ultimul activ)
// - Alerte expirare: expirat / urgent <=7z / atentie <=30z / aproape <=60z / ok
// - Banner sticky cu documente expirate sau urgente
// - Permisiuni: doar OWNER (Razvan + Marilena) pot adăuga/edita
// ════════════════════════════════════════════════════════════════
import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from './lib/supabase.js'

const G = {
  bg:'#0D1117', surface:'#161B22', border:'#21262D', border2:'#30363D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  blue:'#58A6FF', green:'#3FB950', red:'#F85149', yellow:'#D29922',
  purple:'#BC8CFF', orange:'#F0883E', pink:'#EC6CB9'
}

const S = {
  input: { width:'100%', padding:'8px 12px', background:G.bg, border:`1px solid ${G.border2}`, borderRadius:6, color:G.text, fontSize:13, outline:'none' },
  btnP:  { padding:'9px 16px', background:G.orange, color:'#fff', border:'none', borderRadius:7, cursor:'pointer', fontSize:13, fontWeight:700 },
  btnS:  { padding:'9px 16px', background:G.surface, color:G.text, border:`1px solid ${G.border2}`, borderRadius:7, cursor:'pointer', fontSize:13, fontWeight:600 },
  btnD:  { padding:'9px 16px', background:G.red+'22', color:G.red, border:`1px solid ${G.red}44`, borderRadius:7, cursor:'pointer', fontSize:13, fontWeight:600 },
  card:  { background:G.surface, border:`1px solid ${G.border}`, borderRadius:10, padding:18 },
  lbl:   { display:'block', fontSize:11, color:G.muted, marginBottom:4, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.3px' },
}

const CATEGORII = {
  act_constitutiv:  { label:'Acte constitutive',  icon:'📜', color:G.purple },
  certificat_legal: { label:'Certificate legale', icon:'🏛️', color:G.blue },
  autorizatie:      { label:'Autorizații',        icon:'🔧', color:G.orange },
  iso:              { label:'Certificate ISO',    icon:'🏆', color:G.green },
  financiar:        { label:'Financiar',          icon:'💰', color:G.yellow },
  hr:               { label:'HR',                 icon:'👥', color:G.pink },
  sudura_otel:      { label:'Sudură Oțel',        icon:'🔥', color:G.red  },
  sudura_pehd:      { label:'Sudură PEHD',        icon:'🔵', color:G.cyan || G.blue },
  altele:           { label:'Altele',             icon:'📄', color:G.dim },
}

const STATUS = {
  expirat:        { label:'Expirat',           color:G.red,     bg:G.red+'22',     icon:'🔴' },
  urgent:         { label:'Expiră în 7z',      color:G.red,     bg:G.red+'15',     icon:'🟠' },
  atentie:        { label:'Expiră în 30z',     color:G.orange,  bg:G.orange+'22',  icon:'🟠' },
  aproape:        { label:'Expiră în 60z',     color:G.yellow,  bg:G.yellow+'22',  icon:'🟡' },
  ok:             { label:'Valid',             color:G.green,   bg:G.green+'15',   icon:'🟢' },
  fara_expirare:  { label:'Fără expirare',     color:G.dim,     bg:G.surface,      icon:'∞'  },
  fara_data:      { label:'Fără dată',         color:G.muted,   bg:G.surface,      icon:'❓' },
}

const fmtDate = (s) => s ? new Date(s).toLocaleDateString('ro-RO', { day:'2-digit', month:'short', year:'numeric' }) : '—'
const fmtSize = (b) => !b ? '—' : b < 1024 ? `${b} B` : b < 1024*1024 ? `${(b/1024).toFixed(0)} KB` : `${(b/1024/1024).toFixed(1)} MB`

function useToast() {
  const [toast, setToast] = useState(null)
  const show = (msg, kind='ok') => { setToast({ msg, kind }); setTimeout(() => setToast(null), 4000) }
  const Toast = () => toast ? (
    <div style={{
      position:'fixed', bottom:24, right:24, padding:'12px 18px',
      background: toast.kind === 'err' ? G.red : toast.kind === 'warn' ? G.yellow : G.green,
      color:'#fff', borderRadius:8, fontWeight:600, fontSize:13, zIndex:10000,
      boxShadow:'0 8px 24px rgba(0,0,0,0.4)'
    }}>{toast.msg}</div>
  ) : null
  return { show, Toast }
}

export default function TabDocumenteFirma() {
  const [profile, setProfile] = useState(null)
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [showInactive, setShowInactive] = useState(false)
  const [filterCat, setFilterCat] = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')
  const [search, setSearch] = useState('')
  const [editDoc, setEditDoc] = useState(null)
  const [viewDoc, setViewDoc] = useState(null)
  const [bulkUploadOpen, setBulkUploadOpen] = useState(false)
  const { show, Toast } = useToast()

  const loadAll = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data } = await supabase.from('profiles').select('id, name, is_owner').eq('id', user.id).single()
      // Poate edita: admin pe tot modulul, SAU acces granular pe tab-ul ăsta
      // ('administrativ.documente', admin/editor — cazul Natalia: adaugă autorizațiile firmei)
      const { data: modAccess } = await supabase.from('user_module_access')
        .select('module, access_level').eq('profile_id', user.id)
        .in('module', ['administrativ', 'administrativ.documente'])
      const poateEdita = (modAccess || []).some(m =>
        (m.module === 'administrativ' && m.access_level === 'admin') ||
        (m.module === 'administrativ.documente' && ['admin', 'editor'].includes(m.access_level)))
      setProfile({ ...data, _adminAccess: poateEdita })
    }
    const { data } = await supabase.from('v_documente_firma_alerte').select('*').order('data_valabilitate', { ascending: true, nullsFirst: false })
    // Adaug și documente inactive separat dacă vrem să afișăm istoric
    const { data: allDocs } = await supabase.from('documente_firma').select('id, parent_id, versiune, activ, pdf_size_bytes, ai_extracted_at, uploadat_la, uploadat_de').order('uploadat_la', { ascending: false })
    // Combinăm: status din view + size din tabel
    const sizeMap = Object.fromEntries((allDocs || []).map(d => [d.id, d]))
    const merged = (data || []).map(d => ({ ...d, ...sizeMap[d.id] }))
    // Adaug și docs inactive dacă cerute
    if (showInactive) {
      const inactiveIds = (allDocs || []).filter(d => !d.activ).map(d => d.id)
      if (inactiveIds.length > 0) {
        const { data: inactiveDocs } = await supabase.from('documente_firma').select('*').in('id', inactiveIds)
        ;(inactiveDocs || []).forEach(d => merged.push({ ...d, status_expirare: 'fara_data' }))
      }
    }
    setDocs(merged)
    setLoading(false)
  }

  useEffect(() => { loadAll() }, [showInactive])

  const isOwner = profile?.is_owner === true || profile?._adminAccess === true

  const filtered = useMemo(() => {
    let list = docs
    if (filterCat !== 'all') list = list.filter(d => d.categorie === filterCat)
    if (filterStatus !== 'all') list = list.filter(d => d.status_expirare === filterStatus)
    if (search.trim()) {
      const s = search.toLowerCase()
      list = list.filter(d => 
        (d.tip || '').toLowerCase().includes(s) ||
        (d.denumire || '').toLowerCase().includes(s) ||
        (d.autoritate_emitenta || '').toLowerCase().includes(s) ||
        (d.numar_document || '').toLowerCase().includes(s)
      )
    }
    return list
  }, [docs, filterCat, filterStatus, search])

  // KPI calc
  const kpi = useMemo(() => {
    const k = { total: 0, expirate: 0, urgent: 0, atentie: 0, ok: 0, total_size: 0 }
    docs.forEach(d => {
      if (d.activ === false) return
      k.total++
      if (d.status_expirare === 'expirat') k.expirate++
      else if (d.status_expirare === 'urgent') k.urgent++
      else if (d.status_expirare === 'atentie') k.atentie++
      else if (d.status_expirare === 'ok' || d.status_expirare === 'aproape') k.ok++
      k.total_size += (d.pdf_size_bytes || 0)
    })
    return k
  }, [docs])

  const alerte = docs.filter(d => d.activ !== false && ['expirat','urgent','atentie'].includes(d.status_expirare))

  if (loading) {
    return <div style={{padding:40, textAlign:'center', color:G.muted, fontSize:13}}>⏳ Se încarcă documentele...</div>
  }

  return (
    <div style={{display:'flex', flexDirection:'column', gap:18}}>
      {/* HERO */}
      <div style={{
        padding:'20px 24px',
        background:`linear-gradient(135deg, ${G.blue}22, ${G.surface})`,
        border:`1px solid ${G.blue}44`, borderRadius:12
      }}>
        <div style={{display:'flex', alignItems:'center', gap:14, flexWrap:'wrap'}}>
          <span style={{fontSize:32}}>📁</span>
          <div style={{flex:1, minWidth:200}}>
            <div style={{fontSize:20, fontWeight:800, color:G.blue}}>Documente firmă</div>
            <div style={{fontSize:12, color:G.muted, marginTop:2}}>
              Acte constitutive · Certificate legale · Autorizații · ISO · Financiar · HR
            </div>
          </div>
          <div style={{display:'flex', gap:14, fontSize:11, color:G.muted, flexWrap:'wrap'}}>
            <div>📊 <strong style={{color:G.text}}>{kpi.total}</strong> active</div>
            {kpi.expirate > 0 && <div>🔴 <strong style={{color:G.red}}>{kpi.expirate}</strong> expirate</div>}
            {kpi.urgent > 0 && <div>🟠 <strong style={{color:G.red}}>{kpi.urgent}</strong> &lt;7z</div>}
            {kpi.atentie > 0 && <div>🟡 <strong style={{color:G.orange}}>{kpi.atentie}</strong> &lt;30z</div>}
            <div>💾 {fmtSize(kpi.total_size)}</div>
          </div>
        </div>
        {!isOwner && (
          <div style={{marginTop:12, padding:'8px 12px', background:G.yellow+'22', borderRadius:6, fontSize:11, color:G.yellow}}>
            ⚠ Doar utilizatorii cu acces Admin pe modul Administrativ pot uploada / edita. Tu poți doar vizualiza.
          </div>
        )}
      </div>

      {/* BANNER ALERTE EXPIRATE/URGENTE */}
      {alerte.length > 0 && (
        <div style={{
          padding:'14px 18px',
          background: kpi.expirate > 0 ? G.red+'15' : G.orange+'15',
          border:`1px solid ${kpi.expirate > 0 ? G.red : G.orange}66`,
          borderRadius:10,
          display:'flex', flexDirection:'column', gap:10
        }}>
          <div style={{display:'flex', alignItems:'center', gap:10}}>
            <span style={{fontSize:22}}>{kpi.expirate > 0 ? '🚨' : '⚠️'}</span>
            <div style={{fontSize:14, fontWeight:700, color: kpi.expirate > 0 ? G.red : G.orange}}>
              {kpi.expirate > 0 ? `${kpi.expirate} document${kpi.expirate>1?'e':''} EXPIRAT${kpi.expirate>1?'E':''}` : 'Documente care expiră curând'}
              {kpi.urgent + kpi.atentie > 0 && ` · ${kpi.urgent + kpi.atentie} expiră în 30 zile`}
            </div>
          </div>
          <div style={{display:'flex', flexDirection:'column', gap:6}}>
            {alerte.slice(0, 8).map(d => {
              const st = STATUS[d.status_expirare] || STATUS.fara_data
              const cat = CATEGORII[d.categorie] || CATEGORII.altele
              return (
                <div key={d.id} onClick={() => setViewDoc(d)} style={{
                  display:'flex', alignItems:'center', gap:10, padding:'6px 10px',
                  background:G.bg, borderRadius:6, cursor:'pointer', fontSize:12
                }}>
                  <span>{cat.icon}</span>
                  <span style={{flex:1, color:G.text, fontWeight:600}}>{d.tip || d.denumire}</span>
                  <span style={{color:st.color, fontWeight:700}}>{fmtDate(d.data_valabilitate)}</span>
                  <span style={{padding:'2px 8px', background:st.bg, color:st.color, borderRadius:10, fontSize:10, fontWeight:700}}>
                    {st.icon} {d.zile_pana_expirare !== null && d.zile_pana_expirare !== undefined
                      ? (d.zile_pana_expirare < 0 ? `acum ${Math.abs(d.zile_pana_expirare)}z` : `${d.zile_pana_expirare}z`)
                      : st.label}
                  </span>
                </div>
              )
            })}
            {alerte.length > 8 && (
              <div style={{textAlign:'center', fontSize:11, color:G.muted, fontStyle:'italic'}}>
                ... și încă {alerte.length - 8}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TOOLBAR */}
      <div style={{display:'flex', gap:10, alignItems:'center', flexWrap:'wrap'}}>
        <input
          placeholder="🔍 Caută document..."
          style={{...S.input, flex:1, minWidth:200, maxWidth:300}}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select value={filterCat} onChange={e => setFilterCat(e.target.value)} style={{...S.input, width:'auto', minWidth:160}}>
          <option value="all">📁 Toate categoriile</option>
          {Object.entries(CATEGORII).map(([k, v]) => (
            <option key={k} value={k}>{v.icon} {v.label}</option>
          ))}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{...S.input, width:'auto', minWidth:150}}>
          <option value="all">📊 Toate statusurile</option>
          <option value="expirat">🔴 Expirat</option>
          <option value="urgent">🟠 Urgent &lt;7z</option>
          <option value="atentie">🟡 Atenție &lt;30z</option>
          <option value="aproape">🟡 Aproape &lt;60z</option>
          <option value="ok">🟢 Valid</option>
          <option value="fara_expirare">∞ Fără expirare</option>
        </select>
        <label style={{display:'flex', alignItems:'center', gap:6, fontSize:12, color:G.muted, cursor:'pointer'}}>
          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
          Versiuni vechi
        </label>
        {isOwner && (
          <>
            <button onClick={() => setBulkUploadOpen(true)} style={{...S.btnS, color:G.purple, borderColor:G.purple+'66', marginLeft:'auto'}}>📁 Bulk Upload PDFs</button>
            <button onClick={() => setEditDoc({})} style={S.btnP}>+ Adaugă document</button>
          </>
        )}
      </div>

      {/* LISTA */}
      {filtered.length === 0 ? (
        <div style={{padding:40, textAlign:'center', color:G.muted, fontSize:13, ...S.card}}>
          {search || filterCat !== 'all' || filterStatus !== 'all'
            ? '🔍 Niciun rezultat pentru filtrele alese'
            : '📭 Niciun document încă. Apasă „+ Adaugă document" pentru a încărca primul PDF.'}
        </div>
      ) : (
        <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(320px, 1fr))', gap:12}}>
          {filtered.map(d => {
            const st = STATUS[d.status_expirare] || STATUS.fara_data
            const cat = CATEGORII[d.categorie] || CATEGORII.altele
            const isInactive = d.activ === false
            return (
              <div key={d.id} onClick={() => setViewDoc(d)} style={{
                ...S.card,
                cursor:'pointer',
                opacity: isInactive ? 0.5 : 1,
                borderColor: st.color === G.red ? G.red+'66' : G.border,
                transition:'all 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-2px)'}
              onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}>
                <div style={{display:'flex', alignItems:'flex-start', gap:10, marginBottom:10}}>
                  <div style={{
                    width:40, height:40, borderRadius:8,
                    background:cat.color+'22', border:`1px solid ${cat.color}44`,
                    display:'flex', alignItems:'center', justifyContent:'center', fontSize:20
                  }}>{cat.icon}</div>
                  <div style={{flex:1, minWidth:0}}>
                    <div style={{fontSize:13, fontWeight:700, color:G.text, marginBottom:2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
                      {d.tip || 'Fără tip'}
                    </div>
                    <div style={{fontSize:11, color:G.muted, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
                      {d.denumire}
                    </div>
                  </div>
                  {isInactive && <span style={{fontSize:9, padding:'2px 5px', background:G.red+'22', color:G.red, borderRadius:4, fontWeight:600, whiteSpace:'nowrap'}}>VECHI v{d.versiune || 1}</span>}
                </div>
                <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:8, flexWrap:'wrap'}}>
                  <span style={{
                    padding:'3px 9px', borderRadius:12,
                    background:st.bg, color:st.color,
                    fontSize:10, fontWeight:700
                  }}>{st.icon} {st.label}</span>
                  {d.ai_extracted_at && (
                    <span title="Extras cu AI" style={{fontSize:11, color:G.purple}}>🤖</span>
                  )}
                  {d.versiune > 1 && (
                    <span style={{fontSize:10, color:G.dim}}>v{d.versiune}</span>
                  )}
                </div>
                <div style={{fontSize:11, color:G.dim, display:'flex', flexDirection:'column', gap:3, paddingTop:8, borderTop:`1px solid ${G.border}`}}>
                  {d.autoritate_emitenta && <div>🏛️ {d.autoritate_emitenta}</div>}
                  {d.data_valabilitate && !d.fara_expirare && (
                    <div>📅 Valabil până: <strong style={{color:st.color}}>{fmtDate(d.data_valabilitate)}</strong>
                      {d.zile_pana_expirare !== null && d.zile_pana_expirare !== undefined && (
                        <span style={{marginLeft:6, fontSize:10}}>
                          ({d.zile_pana_expirare < 0 ? `acum ${Math.abs(d.zile_pana_expirare)}z` : `în ${d.zile_pana_expirare}z`})
                        </span>
                      )}
                    </div>
                  )}
                  {d.fara_expirare && <div style={{color:G.green}}>∞ Fără expirare</div>}
                  {d.pdf_size_bytes && <div>📄 {fmtSize(d.pdf_size_bytes)}</div>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* MODALE */}
      {editDoc && (
        <DocumentModal
          item={editDoc}
          allDocs={docs}
          onClose={() => setEditDoc(null)}
          onSaved={() => { setEditDoc(null); loadAll(); show('✓ Document salvat') }}
          onError={(e) => show('Eroare: ' + e, 'err')}
          onAiSuccess={() => { setEditDoc(null); loadAll(); show('🤖 AI extract complet · document actualizat') }}
        />
      )}
      {viewDoc && (
        <DocumentDetailModal
          doc={viewDoc}
          isOwner={isOwner}
          onClose={() => setViewDoc(null)}
          onEdit={() => { setEditDoc(viewDoc); setViewDoc(null) }}
          onDelete={async () => {
            if (!confirm(`Șterge „${viewDoc.tip || viewDoc.denumire}"?\n\nIREVERSIBIL.`)) return
            // Șterg PDF din storage
            if (viewDoc.pdf_path) {
              await supabase.storage.from('documente-firma').remove([viewDoc.pdf_path])
            }
            const { error } = await supabase.from('documente_firma').delete().eq('id', viewDoc.id)
            if (error) show('Eroare: ' + error.message, 'err')
            else { setViewDoc(null); loadAll(); show('✓ Document șters') }
          }}
          onUploadVersion={() => {
            // Deschid modal de upload nou cu parent_id setat
            setEditDoc({ parent_id: viewDoc.parent_id || viewDoc.id, categorie: viewDoc.categorie, tip: viewDoc.tip, versiune: (viewDoc.versiune || 1) + 1 })
            setViewDoc(null)
          }}
        />
      )}

      {bulkUploadOpen && (
        <BulkUploadModal
          onClose={() => setBulkUploadOpen(false)}
          onDone={() => { setBulkUploadOpen(false); loadAll(); show('✓ Bulk upload complet') }}
          onError={(e) => show('Eroare: ' + e, 'err')}
        />
      )}

      <Toast />
    </div>
  )
}

// ───────────────────────────── MODALE ─────────────────────────────
function DocumentModal({ item, allDocs, onClose, onSaved, onError, onAiSuccess }) {
  const isNew = !item.id
  const [f, setF] = useState({
    categorie: item.categorie || 'altele',
    tip: item.tip || '',
    denumire: item.denumire || '',
    numar_document: item.numar_document || '',
    autoritate_emitenta: item.autoritate_emitenta || '',
    data_emitere: item.data_emitere || '',
    data_valabilitate: item.data_valabilitate || '',
    fara_expirare: item.fara_expirare || false,
    observatii: item.observatii || '',
    pdf_path: item.pdf_path || '',
    pdf_size_bytes: item.pdf_size_bytes || 0,
    parent_id: item.parent_id || null,
    versiune: item.versiune || 1,
  })
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)

  const handleUpload = async (file) => {
    if (!file) return
    if (file.size > 50 * 1024 * 1024) return onError('PDF prea mare (max 50MB)')
    if (file.type !== 'application/pdf') return onError('Doar fișiere PDF acceptate')
    setUploading(true)
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const path = `${f.categorie || 'altele'}/${ts}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
    const { error } = await supabase.storage.from('documente-firma').upload(path, file, { upsert: false })
    setUploading(false)
    if (error) return onError(`Upload eșuat: ${error.message}`)
    // Setez denumire default = nume fișier dacă nu există
    setF(prev => ({
      ...prev,
      pdf_path: path,
      pdf_size_bytes: file.size,
      denumire: prev.denumire || file.name.replace(/\.pdf$/i, ''),
    }))
  }

  const handleSave = async (alsoAi = false) => {
    if (!f.tip.trim() && !alsoAi) return onError('Tip-ul e obligatoriu (sau folosește AI Extract)')
    if (!f.denumire.trim()) return onError('Denumirea e obligatorie')
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    const payload = {
      categorie: f.categorie,
      tip: f.tip.trim() || 'Document',
      denumire: f.denumire.trim(),
      numar_document: f.numar_document.trim() || null,
      autoritate_emitenta: f.autoritate_emitenta.trim() || null,
      data_emitere: f.data_emitere || null,
      data_valabilitate: f.fara_expirare ? null : (f.data_valabilitate || null),
      fara_expirare: !!f.fara_expirare,
      observatii: f.observatii.trim() || null,
      pdf_path: f.pdf_path || null,
      pdf_size_bytes: f.pdf_size_bytes || null,
      parent_id: f.parent_id || null,
      versiune: f.versiune || 1,
    }
    let documentId = item.id
    if (isNew) {
      payload.uploadat_de = user?.id
      const { data, error } = await supabase.from('documente_firma').insert(payload).select('id').single()
      if (error) { setSaving(false); return onError(error.message) }
      documentId = data.id
    } else {
      const { error } = await supabase.from('documente_firma').update(payload).eq('id', item.id)
      if (error) { setSaving(false); return onError(error.message) }
    }
    setSaving(false)

    if (alsoAi && f.pdf_path) {
      setAiLoading(true)
      const { data: { session } } = await supabase.auth.getSession()
      try {
        const resp = await fetch(`${supabase.supabaseUrl}/functions/v1/parse-document-pdf`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session?.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ document_id: documentId, pdf_path: f.pdf_path })
        })
        const result = await resp.json()
        setAiLoading(false)
        if (!resp.ok) return onError(`AI parser eroare: ${result.error || resp.status}`)
        onAiSuccess()
      } catch (e) {
        setAiLoading(false)
        onError(`AI parser exception: ${e.message}`)
      }
    } else {
      onSaved()
    }
  }

  return (
    <ModalShell title={isNew ? (f.parent_id ? '+ Versiune nouă document' : '+ Adaugă document') : `✏️ ${item.tip || item.denumire}`} onClose={onClose} wide>
      <div style={{display:'flex', flexDirection:'column', gap:14}}>
        {f.parent_id && (
          <div style={{padding:10, background:G.purple+'22', borderRadius:6, fontSize:12, color:G.purple}}>
            📚 Versiune nouă v{f.versiune}. Versiunile vechi vor fi automat marcate inactive după salvare.
          </div>
        )}

        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:14}}>
          <div>
            <label style={S.lbl}>Categorie <span style={{color:G.red}}>*</span></label>
            <select style={S.input} value={f.categorie} onChange={e => setF({...f, categorie:e.target.value})}>
              {Object.entries(CATEGORII).map(([k, v]) => (
                <option key={k} value={k}>{v.icon} {v.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={S.lbl}>Tip document <span style={{color:G.red}}>*</span></label>
            <input style={S.input} value={f.tip} onChange={e => setF({...f, tip:e.target.value})} placeholder="ex: Cazier firmă, ANAF, ISO 9001" />
          </div>
        </div>

        <div>
          <label style={S.lbl}>Denumire completă <span style={{color:G.red}}>*</span></label>
          <input style={S.input} value={f.denumire} onChange={e => setF({...f, denumire:e.target.value})} placeholder="Numele complet al documentului" />
        </div>

        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:14}}>
          <div>
            <label style={S.lbl}>Autoritate emitentă</label>
            <input style={S.input} value={f.autoritate_emitenta} onChange={e => setF({...f, autoritate_emitenta:e.target.value})} placeholder="ANAF, Reg.Comerțului, SRAC..." />
          </div>
          <div>
            <label style={S.lbl}>Număr/Serie document</label>
            <input style={S.input} value={f.numar_document} onChange={e => setF({...f, numar_document:e.target.value})} />
          </div>
        </div>

        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:14}}>
          <div>
            <label style={S.lbl}>Data emitere</label>
            <input type="date" style={S.input} value={f.data_emitere} onChange={e => setF({...f, data_emitere:e.target.value})} />
          </div>
          <div>
            <label style={S.lbl}>Data valabilitate</label>
            <input 
              type="date" style={S.input} 
              value={f.data_valabilitate} 
              onChange={e => setF({...f, data_valabilitate:e.target.value})}
              disabled={f.fara_expirare}
            />
          </div>
        </div>

        <label style={{display:'flex', alignItems:'center', gap:8, cursor:'pointer', padding:'8px 12px', background:G.bg, borderRadius:6}}>
          <input 
            type="checkbox" 
            checked={f.fara_expirare} 
            onChange={e => setF({...f, fara_expirare:e.target.checked, data_valabilitate: e.target.checked ? '' : f.data_valabilitate})}
            style={{accentColor:G.green, width:16, height:16}}
          />
          <span style={{fontSize:13, color:G.text, fontWeight:600}}>∞ Document fără expirare (ex: CIF, act constitutiv, balanțe lunare)</span>
        </label>

        <div>
          <label style={S.lbl}>Observații</label>
          <textarea style={{...S.input, minHeight:50, fontFamily:'inherit', resize:'vertical'}} value={f.observatii} onChange={e => setF({...f, observatii:e.target.value})} />
        </div>

        {/* PDF UPLOAD */}
        <div style={{padding:16, background:G.bg, border:`1px dashed ${G.border2}`, borderRadius:8}}>
          <div style={{fontSize:12, fontWeight:700, color:G.muted, marginBottom:10}}>📄 PDF Document</div>
          {f.pdf_path ? (
            <div style={{display:'flex', alignItems:'center', gap:10}}>
              <span style={{fontSize:24}}>📄</span>
              <div style={{flex:1, minWidth:0}}>
                <div style={{fontSize:12, color:G.green, fontWeight:600}}>✓ PDF încărcat ({fmtSize(f.pdf_size_bytes)})</div>
                <div style={{fontSize:10, color:G.dim, fontFamily:'monospace', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{f.pdf_path}</div>
              </div>
              <button onClick={() => setF({...f, pdf_path:'', pdf_size_bytes:0})} style={{...S.btnS, padding:'4px 10px', fontSize:11, color:G.red}}>✕</button>
            </div>
          ) : (
            <div>
              <input
                type="file"
                accept="application/pdf"
                onChange={e => handleUpload(e.target.files?.[0])}
                disabled={uploading}
                style={{fontSize:12, color:G.muted}}
              />
              <div style={{fontSize:11, color:G.dim, marginTop:6}}>
                {uploading ? '⏳ Upload...' : 'Max 50MB · doar PDF · stocat privat în Supabase Storage'}
              </div>
            </div>
          )}
        </div>

        <div style={{display:'flex', gap:10, marginTop:8, flexWrap:'wrap'}}>
          <button onClick={onClose} style={{...S.btnS, flex:'1 1 100px'}}>Anulează</button>
          <button onClick={() => handleSave(false)} disabled={saving || uploading || aiLoading} style={{...S.btnP, flex:'1 1 130px', background:G.surface, color:G.text, border:`1px solid ${G.border2}`, opacity: (saving||uploading||aiLoading)?0.6:1}}>
            {saving ? '⏳ ...' : '✓ Salvează'}
          </button>
          <button 
            onClick={() => handleSave(true)} 
            disabled={saving || uploading || aiLoading || !f.pdf_path}
            style={{...S.btnP, flex:'1 1 160px', background:G.purple, opacity: (!f.pdf_path||saving||uploading||aiLoading) ? 0.6 : 1}}
            title={!f.pdf_path ? 'Încarcă întâi un PDF' : 'Salvează + extrage automat tip/dată/autoritate cu Claude AI'}
          >
            {aiLoading ? '🤖 AI extrage...' : '🤖 Salvează + Extract AI'}
          </button>
        </div>
        {aiLoading && (
          <div style={{padding:10, background:G.purple+'22', borderRadius:6, fontSize:11, color:G.purple, textAlign:'center'}}>
            ⏳ Claude analizează documentul... (5-15 secunde)
          </div>
        )}
      </div>
    </ModalShell>
  )
}

function DocumentDetailModal({ doc, isOwner, onClose, onEdit, onDelete, onUploadVersion }) {
  const [pdfUrl, setPdfUrl] = useState(null)
  const st = STATUS[doc.status_expirare] || STATUS.fara_data
  const cat = CATEGORII[doc.categorie] || CATEGORII.altele

  useEffect(() => {
    if (doc.pdf_path) {
      supabase.storage.from('documente-firma').createSignedUrl(doc.pdf_path, 600)
        .then(({ data }) => setPdfUrl(data?.signedUrl))
    }
  }, [doc.pdf_path])

  return (
    <ModalShell title={doc.tip || doc.denumire} onClose={onClose} wide>
      <div style={{display:'flex', flexDirection:'column', gap:16}}>
        {/* Status badge + categorie */}
        <div style={{display:'flex', alignItems:'center', gap:10, padding:'12px 16px', background:G.bg, borderRadius:8, flexWrap:'wrap'}}>
          <span style={{padding:'4px 10px', borderRadius:14, background:cat.color+'22', color:cat.color, fontSize:11, fontWeight:700}}>
            {cat.icon} {cat.label}
          </span>
          <span style={{padding:'4px 10px', borderRadius:14, background:st.bg, color:st.color, fontSize:11, fontWeight:700}}>
            {st.icon} {st.label}
            {doc.zile_pana_expirare !== null && doc.zile_pana_expirare !== undefined && !doc.fara_expirare && (
              <span style={{marginLeft:4, fontSize:10}}>
                ({doc.zile_pana_expirare < 0 ? `acum ${Math.abs(doc.zile_pana_expirare)}z` : `în ${doc.zile_pana_expirare}z`})
              </span>
            )}
          </span>
          {doc.versiune > 1 && (
            <span style={{fontSize:11, color:G.purple, fontWeight:700}}>v{doc.versiune}</span>
          )}
          <div style={{flex:1}} />
          {isOwner && (
            <>
              <button onClick={onUploadVersion} style={{...S.btnS, padding:'6px 12px', fontSize:12, color:G.purple, borderColor:G.purple+'66'}}>📚 Versiune nouă</button>
              <button onClick={onEdit} style={{...S.btnS, padding:'6px 12px', fontSize:12}}>✏️ Editează</button>
              <button onClick={onDelete} style={{...S.btnD, padding:'6px 12px', fontSize:12}}>🗑 Șterge</button>
            </>
          )}
        </div>

        {/* Detalii */}
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:16}}>
          <DetailRow label="📝 Denumire" value={doc.denumire} />
          <DetailRow label="🏛️ Autoritate emitentă" value={doc.autoritate_emitenta || '—'} />
          <DetailRow label="📄 Nr/Serie" value={doc.numar_document || '—'} />
          <DetailRow label="📅 Data emitere" value={fmtDate(doc.data_emitere)} />
          <DetailRow label="📅 Data valabilitate" value={doc.fara_expirare ? '∞ Fără expirare' : fmtDate(doc.data_valabilitate)} />
          <DetailRow label="🤖 Extract AI" value={doc.ai_extracted_at ? fmtDate(doc.ai_extracted_at) : 'Neaplicat'} />
        </div>

        {doc.observatii && (
          <div style={{...S.card, background:G.bg}}>
            <div style={S.lbl}>📝 Observații</div>
            <div style={{fontSize:13, color:G.text, lineHeight:1.5}}>{doc.observatii}</div>
          </div>
        )}

        {/* PDF link */}
        {pdfUrl && (
          <a href={pdfUrl} target="_blank" rel="noopener noreferrer" style={{
            display:'inline-flex', alignItems:'center', gap:8, padding:'10px 14px',
            background:G.blue+'22', color:G.blue, textDecoration:'none',
            borderRadius:8, fontSize:13, fontWeight:600,
            border:`1px solid ${G.blue}44`, justifyContent:'center'
          }}>
            📄 Deschide PDF în tab nou
          </a>
        )}

        <button onClick={onClose} style={{...S.btnS, marginTop:8}}>Închide</button>
      </div>
    </ModalShell>
  )
}

// ─────────────────────── BULK UPLOAD MODAL ───────────────────────
// Match-uiește fișiere PDF după nume cu records existente (ai_extracted_jsonb->original_filename)
// Upload PDF în bucket + UPDATE pdf_path. Opțional: rulează AI parser pentru cele fără data valabilitate.
function BulkUploadModal({ onClose, onDone, onError }) {
  const [allRecords, setAllRecords] = useState([])
  const [files, setFiles] = useState([])
  const [matches, setMatches] = useState([])  // array of { file, record, status, error }
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0, current: '' })
  const [runAI, setRunAI] = useState(false)
  const fileInputRef = useRef(null)

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('documente_firma')
        .select('id, tip, denumire, categorie, ai_extracted_jsonb, pdf_path')
      setAllRecords(data || [])
      setLoading(false)
    })()
  }, [])

  const handleFiles = (fileList) => {
    const arr = Array.from(fileList).filter(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'))
    setFiles(arr)
    // Match prin nume fișier ↔ ai_extracted_jsonb.original_filename
    const newMatches = arr.map(file => {
      const rec = allRecords.find(r => 
        r.ai_extracted_jsonb?.original_filename === file.name
      )
      return {
        file,
        record: rec || null,
        status: rec ? (rec.pdf_path ? 'has_pdf' : 'ready') : 'no_match',
        error: null,
      }
    })
    setMatches(newMatches)
  }

  const handleUploadAll = async () => {
    const toProcess = matches.filter(m => m.status === 'ready' || m.status === 'has_pdf')
    if (toProcess.length === 0) return onError('Niciun match pentru upload')
    
    setUploading(true)
    setProgress({ done: 0, total: toProcess.length, current: '' })
    
    const updatedMatches = [...matches]
    let successCount = 0
    let aiCount = 0
    
    for (let i = 0; i < toProcess.length; i++) {
      const m = toProcess[i]
      setProgress({ done: i, total: toProcess.length, current: m.file.name })
      const idx = updatedMatches.findIndex(x => x.file === m.file)
      
      try {
        // Path: <categorie>/<id>_<filename_safe>
        const safeName = m.file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
        const path = `${m.record.categorie}/${m.record.id}_${safeName}`
        
        // Upload (upsert = replace if exists)
        const { error: upErr } = await supabase.storage
          .from('documente-firma')
          .upload(path, m.file, { upsert: true, contentType: 'application/pdf' })
        
        if (upErr) {
          updatedMatches[idx] = { ...m, status: 'error', error: upErr.message }
          continue
        }
        
        // UPDATE record cu pdf_path + size
        const { error: updErr } = await supabase
          .from('documente_firma')
          .update({ pdf_path: path, pdf_size_bytes: m.file.size })
          .eq('id', m.record.id)
        
        if (updErr) {
          updatedMatches[idx] = { ...m, status: 'error', error: updErr.message }
          continue
        }
        
        updatedMatches[idx] = { ...m, status: 'done', error: null }
        successCount++
        
        // Optional AI extract pentru records fără data_valabilitate
        if (runAI && !m.record.ai_extracted_jsonb?.confidence) {
          try {
            const { data: { session } } = await supabase.auth.getSession()
            const resp = await fetch(`${supabase.supabaseUrl}/functions/v1/parse-document-pdf`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${session?.access_token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ document_id: m.record.id, pdf_path: path })
            })
            if (resp.ok) aiCount++
          } catch (e) {
            // AI eșuat — nu blocăm upload-ul
            console.error('AI parser err:', e)
          }
        }
        
        setMatches([...updatedMatches])
      } catch (e) {
        updatedMatches[idx] = { ...m, status: 'error', error: e.message }
      }
    }
    
    setMatches(updatedMatches)
    setProgress({ done: toProcess.length, total: toProcess.length, current: '' })
    setUploading(false)
    
    if (successCount > 0) {
      const msg = `${successCount} PDF-uri urcate` + (runAI ? ` · ${aiCount} procesate AI` : '')
      onDone(msg)
    }
  }

  const readyCount = matches.filter(m => m.status === 'ready').length
  const hasPdfCount = matches.filter(m => m.status === 'has_pdf').length
  const noMatchCount = matches.filter(m => m.status === 'no_match').length
  const doneCount = matches.filter(m => m.status === 'done').length
  const errCount = matches.filter(m => m.status === 'error').length

  return (
    <ModalShell title="📁 Bulk Upload PDF-uri" onClose={uploading ? undefined : onClose} wide>
      <div style={{display:'flex', flexDirection:'column', gap:14}}>
        <div style={{padding:12, background:G.blue+'15', border:`1px solid ${G.blue}44`, borderRadius:8, fontSize:12, color:G.text, lineHeight:1.5}}>
          📋 <strong>Cum funcționează:</strong> selectează toate cele <strong>34 PDF-uri</strong> din folder-ul Administrativ (Ctrl+A) sau folder-ul întreg. 
          Fișierele sunt match-uite automat după nume cu record-urile existente în BD, apoi PDF-urile sunt urcate în Storage.
        </div>

        {loading ? (
          <div style={{padding:30, textAlign:'center', color:G.muted}}>⏳ Se încarcă records-urile existente...</div>
        ) : (
          <>
            {files.length === 0 && (
              <div 
                onDragOver={e => { e.preventDefault(); e.stopPropagation() }}
                onDrop={e => { 
                  e.preventDefault(); e.stopPropagation()
                  if (e.dataTransfer?.files) handleFiles(e.dataTransfer.files)
                }}
                onClick={() => fileInputRef.current?.click()}
                style={{
                  padding:'40px 20px', border:`2px dashed ${G.border2}`, borderRadius:10,
                  background:G.bg, cursor:'pointer', textAlign:'center',
                  transition:'all 0.2s'
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = G.purple; e.currentTarget.style.background = G.purple+'08' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = G.border2; e.currentTarget.style.background = G.bg }}
              >
                <div style={{fontSize:48, marginBottom:12}}>📂</div>
                <div style={{fontSize:14, fontWeight:600, color:G.text, marginBottom:6}}>
                  Click pentru a selecta fișiere sau drag&drop aici
                </div>
                <div style={{fontSize:11, color:G.muted}}>
                  Selectează toate cele 34 PDF-uri din folder Administrativ (cu Ctrl+A în file picker)
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf"
                  multiple
                  webkitdirectory=""
                  directory=""
                  onChange={e => handleFiles(e.target.files)}
                  style={{display:'none'}}
                />
              </div>
            )}

            {files.length > 0 && (
              <>
                {/* SUMMARY */}
                <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(110px, 1fr))', gap:10}}>
                  <div style={{...S.card, padding:'10px 12px', textAlign:'center', borderColor:G.blue+'44'}}>
                    <div style={{fontSize:24, fontWeight:800, color:G.blue}}>{files.length}</div>
                    <div style={{fontSize:10, color:G.muted, textTransform:'uppercase'}}>Fișiere</div>
                  </div>
                  <div style={{...S.card, padding:'10px 12px', textAlign:'center', borderColor:G.green+'44'}}>
                    <div style={{fontSize:24, fontWeight:800, color:G.green}}>{readyCount + doneCount}</div>
                    <div style={{fontSize:10, color:G.muted, textTransform:'uppercase'}}>Match-uri OK</div>
                  </div>
                  {hasPdfCount > 0 && (
                    <div style={{...S.card, padding:'10px 12px', textAlign:'center', borderColor:G.yellow+'44'}}>
                      <div style={{fontSize:24, fontWeight:800, color:G.yellow}}>{hasPdfCount}</div>
                      <div style={{fontSize:10, color:G.muted, textTransform:'uppercase'}}>Au deja PDF</div>
                    </div>
                  )}
                  {noMatchCount > 0 && (
                    <div style={{...S.card, padding:'10px 12px', textAlign:'center', borderColor:G.red+'44'}}>
                      <div style={{fontSize:24, fontWeight:800, color:G.red}}>{noMatchCount}</div>
                      <div style={{fontSize:10, color:G.muted, textTransform:'uppercase'}}>Fără match</div>
                    </div>
                  )}
                  {errCount > 0 && (
                    <div style={{...S.card, padding:'10px 12px', textAlign:'center', borderColor:G.red+'66'}}>
                      <div style={{fontSize:24, fontWeight:800, color:G.red}}>{errCount}</div>
                      <div style={{fontSize:10, color:G.muted, textTransform:'uppercase'}}>Erori</div>
                    </div>
                  )}
                </div>

                {/* LISTA MATCH-URI */}
                <div style={{maxHeight:300, overflowY:'auto', border:`1px solid ${G.border}`, borderRadius:8}}>
                  {matches.map((m, i) => {
                    const colorMap = {
                      ready:    { c: G.green,  bg: G.green+'15',  icon: '✓',  label: 'Pregătit' },
                      has_pdf:  { c: G.yellow, bg: G.yellow+'15', icon: '↻',  label: 'Are deja PDF (va înlocui)' },
                      no_match: { c: G.red,    bg: G.red+'15',    icon: '✗',  label: 'Fără match' },
                      done:     { c: G.green,  bg: G.green+'22',  icon: '✓',  label: 'Urcat' },
                      error:    { c: G.red,    bg: G.red+'22',    icon: '⚠',  label: 'Eroare' },
                    }[m.status]
                    return (
                      <div key={i} style={{
                        display:'flex', alignItems:'center', gap:10, padding:'8px 12px',
                        borderBottom: i < matches.length-1 ? `1px solid ${G.border}` : 'none',
                        background: colorMap.bg, fontSize:11,
                      }}>
                        <span style={{fontSize:14, color: colorMap.c, fontWeight:800, width:18}}>{colorMap.icon}</span>
                        <div style={{flex:1, minWidth:0}}>
                          <div style={{color:G.text, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{m.file.name}</div>
                          {m.record && <div style={{fontSize:10, color:G.muted}}>→ #{m.record.id} · {m.record.tip}</div>}
                          {m.error && <div style={{fontSize:10, color:G.red}}>⚠ {m.error}</div>}
                        </div>
                        <span style={{fontSize:10, color: colorMap.c, fontWeight:700, whiteSpace:'nowrap'}}>{colorMap.label}</span>
                        <span style={{fontSize:10, color:G.dim, whiteSpace:'nowrap'}}>{(m.file.size / 1024).toFixed(0)} KB</span>
                      </div>
                    )
                  })}
                </div>

                {/* AI option */}
                <label style={{display:'flex', alignItems:'center', gap:8, cursor:'pointer', padding:'10px 14px', background:G.purple+'15', borderRadius:8, border:`1px solid ${G.purple}44`}}>
                  <input type="checkbox" checked={runAI} onChange={e => setRunAI(e.target.checked)} disabled={uploading} style={{accentColor:G.purple, width:16, height:16}} />
                  <span style={{fontSize:12, color:G.text, fontWeight:600}}>
                    🤖 Rulează AI Extract pe ISO 45001 (fără data valabilitate)
                    <span style={{color:G.muted, fontWeight:400, marginLeft:6}}>· cost ~$0.04 (2 PDF-uri)</span>
                  </span>
                </label>

                {/* PROGRESS */}
                {uploading && (
                  <div style={{padding:14, background:G.bg, borderRadius:8, border:`1px solid ${G.purple}66`}}>
                    <div style={{display:'flex', justifyContent:'space-between', fontSize:11, color:G.muted, marginBottom:8}}>
                      <span>📤 Upload în curs... {progress.done}/{progress.total}</span>
                      <span style={{color:G.purple, fontWeight:700}}>{Math.round((progress.done / progress.total) * 100)}%</span>
                    </div>
                    <div style={{height:6, background:G.border, borderRadius:3, overflow:'hidden'}}>
                      <div style={{height:'100%', width:`${(progress.done / progress.total) * 100}%`, background:G.purple, transition:'width 0.3s'}} />
                    </div>
                    {progress.current && (
                      <div style={{fontSize:10, color:G.dim, marginTop:6, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
                        ⏳ {progress.current}
                      </div>
                    )}
                  </div>
                )}

                <div style={{display:'flex', gap:10}}>
                  <button onClick={() => { setFiles([]); setMatches([]) }} disabled={uploading} style={{...S.btnS, flex:1}}>
                    🔄 Alege alte fișiere
                  </button>
                  <button 
                    onClick={handleUploadAll} 
                    disabled={uploading || (readyCount + hasPdfCount) === 0}
                    style={{...S.btnP, flex:2, background:G.purple, opacity: (uploading || (readyCount + hasPdfCount) === 0) ? 0.6 : 1}}
                  >
                    {uploading ? `⏳ Upload ${progress.done}/${progress.total}...` : `🚀 Upload ${readyCount + hasPdfCount} PDF-uri`}
                  </button>
                </div>
              </>
            )}

            <button onClick={onClose} disabled={uploading} style={{...S.btnS, marginTop:4}}>
              {doneCount > 0 ? `Închide (${doneCount} urcate)` : 'Anulează'}
            </button>
          </>
        )}
      </div>
    </ModalShell>
  )
}

function DetailRow({ label, value }) {
  return (
    <div>
      <div style={S.lbl}>{label}</div>
      <div style={{fontSize:13, color:G.text, fontWeight:600}}>{value}</div>
    </div>
  )
}

function ModalShell({ title, onClose, children, wide }) {
  return (
    <div onClick={onClose} style={{
      position:'fixed', inset:0, background:'rgba(0,0,0,0.7)',
      display:'flex', alignItems:'center', justifyContent:'center',
      zIndex:9999, padding:20
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background:G.surface, border:`1px solid ${G.border2}`, borderRadius:14,
        width:'100%', maxWidth: wide ? 720 : 480,
        maxHeight:'90vh', overflow:'auto',
        padding:'22px 26px',
        boxShadow:'0 20px 60px rgba(0,0,0,0.5)'
      }}>
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:18}}>
          <div style={{fontSize:17, fontWeight:800, color:G.text}}>{title}</div>
          <button onClick={onClose} style={{background:'transparent', border:'none', color:G.muted, fontSize:22, cursor:'pointer', padding:0, lineHeight:1}}>×</button>
        </div>
        {children}
      </div>
    </div>
  )
}
