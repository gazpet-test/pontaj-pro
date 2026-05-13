// ===========================================================================
// MODUL HR — Bulk Import Modal pentru Documente Personale
// Acceptă drag-drop multiple fișiere, detectează automat:
//   • Tip document (keyword matching pe filename, ~25 mappings)
//   • Angajat (fuzzy match pe employees.name)
//   • Data emitere (regex pe filename)
// Apoi user confirmă/corectează în tabel preview și salvează atomic.
// ===========================================================================
import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './lib/supabase.js'

// Theme consistent cu TabDocumentePersonale.jsx
const G = {
  bg:'#0D1117', surface:'#161B22', card:'#161B22', text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  border:'#30363D', border2:'#21262D',
  blue:'#1F6FEB', green:'#2EA043', yellow:'#D29922', orange:'#F0883E', red:'#F85149', purple:'#A371F7',
  hr:'#EC6CB9',
  greenDim:'#0F2A1E', redDim:'#3F1A1F', yellowDim:'#332100', orangeDim:'#3F2618', blueDim:'#0F1F3F',
}

const S = {
  card: { background:G.card, borderRadius:12, border:`1px solid ${G.border}` },
  input: { width:'100%', background:G.bg, border:`1px solid ${G.border}`, borderRadius:8, padding:'7px 10px', color:G.text, fontSize:12, outline:'none' },
  btnP: { padding:'9px 16px', background:G.hr, color:'#fff', border:'none', borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:600 },
  btnS: { padding:'8px 14px', background:G.surface, color:G.text, border:`1px solid ${G.border}`, borderRadius:8, cursor:'pointer', fontSize:13 },
}

const BUCKET = 'documente-personal'

const CAT_META = {
  identitate: { emoji: '🪪', label: 'Identitate' },
  stare_civila: { emoji: '👨‍👩‍👧', label: 'Stare civilă' },
  studii: { emoji: '🎓', label: 'Studii' },
  juridic: { emoji: '⚖', label: 'Juridic' },
  angajator_anterior: { emoji: '💼', label: 'Angajator anterior' },
  fiscal: { emoji: '🏦', label: 'Fiscal' },
  medical: { emoji: '🩺', label: 'Medical' },
  contract_intern: { emoji: '📄', label: 'Contract & Formulare' },
}

// ─── Mapping keyword → tip cod (priority descending) ───────────────────────
// Ordinea contează: cele cu priority mai mare se verifică ÎNTÂI
// Exemplu: „CALIFICARE STIVUITORIST - SUPLIMENT" trebuie să prindă SUPLIMENT, NU CALIFICARE
const TYPE_PATTERNS = [
  // Studii — Suplimentele ÎNAINTE de Calificări
  { cod: 'supliment_calificare', keywords: ['supliment'], priority: 100 },
  { cod: 'cert_calificare', keywords: ['calificare', 'calificat'], priority: 90 },
  { cod: 'diploma_scoala_prof', keywords: ['scoala profesionala', 'profesionala'], priority: 95 },
  { cod: 'diploma_liceu', keywords: ['diploma liceu', 'liceu', 'bacalaureat', 'diploma de liceu'], priority: 92 },
  { cod: 'diploma_studii_sup', keywords: ['diploma studii', 'diploma facultate', 'diploma master', 'licenta', 'diploma de studii'], priority: 90 },
  
  // Stare civilă — cert nastere COPIL ÎNAINTE de cert nastere angajat
  { cod: 'cert_nastere_copil', keywords: ['nastere copil', 'copil minor', 'copil_minor'], priority: 100 },
  { cod: 'cert_casatorie', keywords: ['casatorie'], priority: 95 },
  { cod: 'adeverinta_scoala_copil', keywords: ['adeverinta scoala', 'adev scoala', 'scoala copil'], priority: 95 },
  { cod: 'cert_nastere_angajat', keywords: ['certificat nastere', 'cert nastere', 'certificat de nastere'], priority: 85 },
  
  // Identitate
  { cod: 'buletin', keywords: ['carte de identitate', 'carte identitate', 'c.i.', '(c.i)', 'buletin', ' ci ', '_ci_', '-ci-', '/ci.'], priority: 95 },
  { cod: 'pasaport', keywords: ['pasaport', 'passport'], priority: 95 },
  { cod: 'permis_conducere', keywords: ['permis de conducere', 'permis conducere'], priority: 95 },
  
  // Juridic
  { cod: 'cazier_judiciar', keywords: ['cazier'], priority: 95 },
  { cod: 'decl_propria_raspundere', keywords: ['declaratie proprie', 'declaratie propria', 'lipsa interdictii', 'decl_propria'], priority: 90 },
  
  // Angajator anterior
  { cod: 'dec_incetare_anterior', keywords: ['decizie incetare', 'dec incetare', 'decizie de incetare'], priority: 100 },
  { cod: 'adev_incetare_anterior', keywords: ['adeverinta incetare', 'adev incetare'], priority: 100 },
  { cod: 'anexa7_cotizare', keywords: ['anexa 7', 'anexa7', 'stadiu cotizare'], priority: 100 },
  
  // Fiscal — handicap ÎNAINTE de orice ce ar putea conține „decizie"
  { cod: 'decizie_handicap', keywords: ['handicap'], priority: 100 },
  { cod: 'extras_cont_bancar', keywords: ['extras cont', 'iban'], priority: 95 },
  { cod: 'decl_persoane_intretinere', keywords: ['persoane intretinere', 'deducere taxe'], priority: 90 },
  
  // Medical
  { cod: 'adeverinta_medic_familie', keywords: ['adeverinta medic familie', 'adev medic familie', 'medic familie', 'apt de munca', 'apt munca'], priority: 95 },
  
  // Contract & Formulare interne
  { cod: 'contract_munca', keywords: ['contract individual', 'contract munca', 'contract de munca', ' cim ', '_cim_', '-cim-'], priority: 95 },
  { cod: 'fisa_post', keywords: ['fisa post', 'fisa postului', 'fisa de post', 'fişa post'], priority: 95 },
  { cod: 'acord_gdpr', keywords: ['gdpr', 'consimtamant', 'acord prelucrare'], priority: 95 },
  { cod: 'dosar_acorduri_formulare', keywords: ['dosar angajare', 'dosar acorduri', 'formulare angajare', 'minuta informare'], priority: 95 },
]

// ─── Helpers ────────────────────────────────────────────────────────────────

function normalizeStr(s) {
  return (s || '')
    .toString()
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // strip diacritics
    .replace(/[._\-]+/g, ' ')                          // separators → space
    .replace(/[^a-z0-9 ]+/g, ' ')                      // non-alphanumeric → space
    .replace(/\s+/g, ' ')
    .trim()
}

function detectDocumentType(filename, tipuri) {
  const norm = ` ${normalizeStr(filename)} `  // padding pentru match exact
  const sorted = [...TYPE_PATTERNS].sort((a, b) => b.priority - a.priority)
  
  for (const pattern of sorted) {
    for (const kw of pattern.keywords) {
      const normKw = ` ${normalizeStr(kw)} `
      if (norm.includes(normKw)) {
        const tip = tipuri.find(t => t.cod === pattern.cod)
        if (tip) return { tip, confidence: pattern.priority, matchedKeyword: kw }
      }
    }
  }
  return { tip: null, confidence: 0, matchedKeyword: null }
}

function fuzzyMatchEmployee(filename, employees) {
  const fileTokens = new Set(normalizeStr(filename).split(' ').filter(t => t.length >= 3))
  if (fileTokens.size === 0) return { employee: null, confidence: 0 }
  
  let best = null
  let bestScore = 0
  
  for (const emp of employees) {
    if (emp.active === false) continue
    const empTokens = normalizeStr(emp.name).split(' ').filter(t => t.length >= 2)
    if (empTokens.length === 0) continue
    
    const matches = empTokens.filter(t => fileTokens.has(t)).length
    if (matches < 2) continue  // minimum 2 tokens match (nume + prenume)
    
    const score = matches / empTokens.length
    if (score > bestScore) {
      bestScore = score
      best = emp
    }
  }
  
  return { employee: best, confidence: Math.round(bestScore * 100) }
}

function detectDate(filename) {
  // YYYY-MM-DD, YYYY_MM_DD, YYYY.MM.DD
  let m = filename.match(/(\d{4})[-_.\s](\d{1,2})[-_.\s](\d{1,2})/)
  if (m && Number(m[1]) >= 1950 && Number(m[1]) <= 2050) {
    return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`
  }
  // DD-MM-YYYY, DD.MM.YYYY
  m = filename.match(/(\d{1,2})[-_.\s](\d{1,2})[-_.\s](\d{4})/)
  if (m && Number(m[3]) >= 1950 && Number(m[3]) <= 2050) {
    return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`
  }
  // Doar an (ex: VIZA 2016)
  m = filename.match(/(?:^|[^\d])(19[5-9]\d|20[0-4]\d)(?:[^\d]|$)/)
  if (m) return `${m[1]}-01-01`
  return null
}

function genStoragePath(employeeId, tipCod, fileName) {
  const ext = fileName.split('.').pop().toLowerCase()
  const today = new Date().toISOString().split('T')[0]
  const uuid = (typeof crypto !== 'undefined' && crypto.randomUUID) 
    ? crypto.randomUUID().slice(0, 8) 
    : Math.random().toString(36).slice(2, 10)
  return `${employeeId}/${tipCod}/${today}_${uuid}.${ext}`
}

// ─── COMPONENT PRINCIPAL ────────────────────────────────────────────────────

export default function DocumenteBulkImportModal({ employees, tipuri, onClose, onImported, showToast }) {
  const fileInputRef = useRef(null)
  const [rows, setRows] = useState([])  // { id, file, employeeId, tipId, dataEmitere, dataExpirare, faraExpirare, action, confidenceEmp, confidenceTip }
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0, errors: [] })
  
  // Auto-process la upload
  const processFiles = (files) => {
    const newRows = Array.from(files).map((file, idx) => {
      const { tip, confidence: tipConf } = detectDocumentType(file.name, tipuri)
      const { employee: emp, confidence: empConf } = fuzzyMatchEmployee(file.name, employees)
      const dataEmitere = detectDate(file.name)
      
      // Determinare action
      let action = 'ready'
      if (!tip || !emp) action = 'review'  // unul lipsește
      else if (tipConf < 70 || empConf < 50) action = 'review'  // confidence scăzut
      
      // Verificare mărime
      if (file.size > 10485760) action = 'skip'  // peste 10 MB
      
      return {
        id: `${Date.now()}-${idx}-${Math.random()}`,
        file,
        employeeId: emp?.id || '',
        tipId: tip?.id || '',
        dataEmitere: dataEmitere || '',
        dataExpirare: '',
        faraExpirare: tip ? !tip.are_expirare : false,
        observatii: '',
        action,
        confidenceEmp: empConf,
        confidenceTip: tipConf,
        statusFinal: null,  // 'success' | 'error' | null
        errorMsg: null,
      }
    })
    setRows(prev => [...prev, ...newRows])
  }
  
  const handleDrop = (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer.files?.length) processFiles(e.dataTransfer.files)
  }
  
  const handleSelect = (e) => {
    if (e.target.files?.length) processFiles(e.target.files)
    e.target.value = ''  // reset pentru re-select
  }
  
  const updateRow = (id, patch) => {
    setRows(prev => prev.map(r => {
      if (r.id !== id) return r
      const updated = { ...r, ...patch }
      // Recalculează action după update
      if (updated.action !== 'skip') {
        if (updated.employeeId && updated.tipId) {
          updated.action = 'ready'
        } else {
          updated.action = 'review'
        }
      }
      // Auto-set faraExpirare bazat pe tip dacă nu e setat manual
      if (patch.tipId) {
        const tip = tipuri.find(t => t.id === Number(updated.tipId))
        if (tip && !tip.are_expirare) {
          updated.faraExpirare = true
        }
      }
      return updated
    }))
  }
  
  const removeRow = (id) => setRows(prev => prev.filter(r => r.id !== id))
  
  const tipuriGrupate = useMemo(() => {
    return tipuri.filter(t => t.activ).reduce((acc, t) => {
      (acc[t.categorie] = acc[t.categorie] || []).push(t)
      return acc
    }, {})
  }, [tipuri])
  
  const stats = useMemo(() => ({
    total: rows.length,
    ready: rows.filter(r => r.action === 'ready').length,
    review: rows.filter(r => r.action === 'review').length,
    skip: rows.filter(r => r.action === 'skip').length,
    success: rows.filter(r => r.statusFinal === 'success').length,
    error: rows.filter(r => r.statusFinal === 'error').length,
  }), [rows])
  
  const doImport = async () => {
    const toImport = rows.filter(r => r.action === 'ready' && r.statusFinal !== 'success')
    if (toImport.length === 0) { showToast('Niciun fișier gata de import', 'warn'); return }
    
    setImporting(true)
    setProgress({ done: 0, total: toImport.length, errors: [] })
    
    const { data: { user } } = await supabase.auth.getUser()
    let done = 0
    const errors = []
    
    for (const row of toImport) {
      const tip = tipuri.find(t => t.id === Number(row.tipId))
      if (!tip) {
        errors.push({ name: row.file.name, msg: 'Tip invalid' })
        setRows(prev => prev.map(r => r.id === row.id ? { ...r, statusFinal: 'error', errorMsg: 'Tip invalid' } : r))
        done++
        setProgress({ done, total: toImport.length, errors: [...errors] })
        continue
      }
      
      const storagePath = genStoragePath(row.employeeId, tip.cod, row.file.name)
      
      // 1. Upload Storage
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(storagePath, row.file, {
        contentType: row.file.type,
        upsert: false,
      })
      
      if (upErr) {
        errors.push({ name: row.file.name, msg: 'Upload: ' + upErr.message })
        setRows(prev => prev.map(r => r.id === row.id ? { ...r, statusFinal: 'error', errorMsg: 'Upload: ' + upErr.message } : r))
        done++
        setProgress({ done, total: toImport.length, errors: [...errors] })
        continue
      }
      
      // 2. INSERT BD
      const payload = {
        employee_id: Number(row.employeeId),
        tip_id: Number(row.tipId),
        data_emitere: row.dataEmitere || null,
        data_expirare: row.faraExpirare || !tip.are_expirare ? null : (row.dataExpirare || null),
        fara_expirare: row.faraExpirare || !tip.are_expirare,
        fisier_path: storagePath,
        fisier_nume: row.file.name,
        fisier_size_bytes: row.file.size,
        fisier_mime: row.file.type || 'application/octet-stream',
        observatii: row.observatii || null,
        uploadat_de: user?.id || null,
        activ: true,
      }
      
      const { error: insErr } = await supabase.from('hr_documente_personale').insert(payload)
      
      if (insErr) {
        // Rollback Storage
        await supabase.storage.from(BUCKET).remove([storagePath])
        errors.push({ name: row.file.name, msg: 'DB: ' + insErr.message })
        setRows(prev => prev.map(r => r.id === row.id ? { ...r, statusFinal: 'error', errorMsg: 'DB: ' + insErr.message } : r))
      } else {
        setRows(prev => prev.map(r => r.id === row.id ? { ...r, statusFinal: 'success' } : r))
      }
      
      done++
      setProgress({ done, total: toImport.length, errors: [...errors] })
    }
    
    setImporting(false)
    
    if (errors.length === 0) {
      showToast(`✅ Importat cu succes ${done}/${toImport.length} fișiere`)
    } else {
      showToast(`⚠ Import: ${done - errors.length}/${toImport.length} ok, ${errors.length} erori — vezi tabelul`, 'warn')
    }
    
    onImported?.(done - errors.length)
  }
  
  const confidenceColor = (c) => c >= 90 ? G.green : c >= 60 ? G.yellow : c >= 30 ? G.orange : G.red
  const actionBadge = (action, statusFinal) => {
    if (statusFinal === 'success') return { bg: G.greenDim, fg: G.green, label: '✅ Importat' }
    if (statusFinal === 'error') return { bg: G.redDim, fg: G.red, label: '❌ Eroare' }
    if (action === 'ready') return { bg: G.greenDim, fg: G.green, label: '✓ Ready' }
    if (action === 'review') return { bg: G.yellowDim, fg: G.yellow, label: '⚠ Verifică' }
    return { bg: G.redDim, fg: G.red, label: '⏭ Skip' }
  }
  
  return (
    <div style={{position:'fixed', inset:0, background:'rgba(0,0,0,0.92)', zIndex:1150, display:'flex', alignItems:'center', justifyContent:'center', padding:20}}>
      <div style={{...S.card, width:'100%', maxWidth:1100, maxHeight:'94vh', display:'flex', flexDirection:'column'}}>
        
        {/* Header */}
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', padding:'18px 24px', borderBottom:`1px solid ${G.border}`}}>
          <div>
            <div style={{fontSize:17, fontWeight:700, color:G.text}}>📥 Bulk Import Documente Personale</div>
            <div style={{fontSize:11, color:G.muted, marginTop:4}}>
              Detecție automată: tip · angajat · dată. Corectează manual rândurile cu ⚠ înainte de import.
            </div>
          </div>
          <button onClick={onClose} disabled={importing} style={{...S.btnS, padding:'4px 10px', opacity: importing ? 0.4 : 1}}>✕</button>
        </div>
        
        {/* Scrollable content */}
        <div style={{flex:1, overflow:'auto', padding:20}}>
          
          {/* Drop zone */}
          <div 
            onDrop={handleDrop} 
            onDragOver={e => { e.preventDefault(); e.stopPropagation() }}
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: `2px dashed ${G.hr}`,
              borderRadius:12, padding:'40px 20px', textAlign:'center',
              background: G.hr + '08', cursor:'pointer', marginBottom:14
            }}>
            <div style={{fontSize:42, marginBottom:8}}>📂</div>
            <div style={{fontSize:15, fontWeight:700, color:G.text, marginBottom:6}}>
              Drag & drop fișiere aici · sau click pentru selectare
            </div>
            <div style={{fontSize:11, color:G.muted}}>
              PDF, JPG, PNG, WEBP · max 10 MB per fișier · {rows.length} fișiere selectate
            </div>
            <input ref={fileInputRef} type="file" multiple
              accept="application/pdf,image/jpeg,image/png,image/webp"
              onChange={handleSelect}
              style={{display:'none'}}/>
          </div>
          
          {/* Stats bar */}
          {rows.length > 0 && (
            <div style={{display:'flex', gap:10, marginBottom:14, fontSize:12, flexWrap:'wrap'}}>
              <div style={{padding:'6px 14px', background:G.surface, border:`1px solid ${G.border}`, borderRadius:6, color:G.text}}>
                📁 Total: <strong>{stats.total}</strong>
              </div>
              <div style={{padding:'6px 14px', background:G.greenDim, color:G.green, border:`1px solid ${G.green}44`, borderRadius:6, fontWeight:600}}>
                ✓ Ready: {stats.ready}
              </div>
              {stats.review > 0 && (
                <div style={{padding:'6px 14px', background:G.yellowDim, color:G.yellow, border:`1px solid ${G.yellow}44`, borderRadius:6, fontWeight:600}}>
                  ⚠ De verificat: {stats.review}
                </div>
              )}
              {stats.skip > 0 && (
                <div style={{padding:'6px 14px', background:G.redDim, color:G.red, border:`1px solid ${G.red}44`, borderRadius:6, fontWeight:600}}>
                  ⏭ Skip: {stats.skip}
                </div>
              )}
              {progress.total > 0 && (
                <div style={{padding:'6px 14px', background: stats.error > 0 ? G.orangeDim : G.greenDim, color: stats.error > 0 ? G.orange : G.green, border:`1px solid ${G.green}44`, borderRadius:6, fontWeight:600}}>
                  📊 Progres: {progress.done}/{progress.total}
                </div>
              )}
            </div>
          )}
          
          {/* Tabel preview */}
          {rows.length > 0 && (
            <div style={{...S.card, overflow:'hidden'}}>
              <div style={{overflowX:'auto'}}>
                <table style={{width:'100%', borderCollapse:'collapse', fontSize:11}}>
                  <thead style={{background:G.bg}}>
                    <tr>
                      <th style={{padding:'8px 8px', textAlign:'left', color:G.muted, fontSize:10, textTransform:'uppercase', letterSpacing:.4, fontWeight:700}}>Fișier</th>
                      <th style={{padding:'8px 8px', textAlign:'left', color:G.muted, fontSize:10, textTransform:'uppercase', letterSpacing:.4, fontWeight:700}}>Angajat</th>
                      <th style={{padding:'8px 8px', textAlign:'left', color:G.muted, fontSize:10, textTransform:'uppercase', letterSpacing:.4, fontWeight:700}}>Tip</th>
                      <th style={{padding:'8px 8px', textAlign:'left', color:G.muted, fontSize:10, textTransform:'uppercase', letterSpacing:.4, fontWeight:700}}>Emis</th>
                      <th style={{padding:'8px 8px', textAlign:'left', color:G.muted, fontSize:10, textTransform:'uppercase', letterSpacing:.4, fontWeight:700}}>Expiră</th>
                      <th style={{padding:'8px 8px', textAlign:'left', color:G.muted, fontSize:10, textTransform:'uppercase', letterSpacing:.4, fontWeight:700}}>Conf</th>
                      <th style={{padding:'8px 8px', textAlign:'left', color:G.muted, fontSize:10, textTransform:'uppercase', letterSpacing:.4, fontWeight:700}}>Status</th>
                      <th style={{padding:'8px 8px'}}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => {
                      const tipSelectat = tipuri.find(t => t.id === Number(r.tipId))
                      const badge = actionBadge(r.action, r.statusFinal)
                      return (
                        <tr key={r.id} style={{
                          borderTop:`1px solid ${G.border}`,
                          opacity: r.statusFinal === 'success' ? 0.55 : 1,
                          background: r.statusFinal === 'error' ? G.redDim + '40' : 'transparent'
                        }}>
                          <td style={{padding:'6px 8px', maxWidth:200, fontSize:11}}>
                            <div style={{fontWeight:600, color:G.text, wordBreak:'break-word'}}>{r.file.name}</div>
                            <div style={{fontSize:9, color:G.dim, marginTop:2}}>{(r.file.size / 1024).toFixed(0)} KB</div>
                            {r.errorMsg && <div style={{fontSize:10, color:G.red, marginTop:2}}>{r.errorMsg}</div>}
                          </td>
                          <td style={{padding:'6px 8px', minWidth:160}}>
                            <select value={r.employeeId} onChange={e => updateRow(r.id, { employeeId: e.target.value })}
                              disabled={importing || r.statusFinal === 'success'}
                              style={{...S.input, fontSize:11, padding:'4px 6px'}}>
                              <option value="">—</option>
                              {employees.filter(e => e.active !== false).map(e => (
                                <option key={e.id} value={e.id}>{e.name}</option>
                              ))}
                            </select>
                          </td>
                          <td style={{padding:'6px 8px', minWidth:200}}>
                            <select value={r.tipId} onChange={e => updateRow(r.id, { tipId: e.target.value })}
                              disabled={importing || r.statusFinal === 'success'}
                              style={{...S.input, fontSize:11, padding:'4px 6px'}}>
                              <option value="">—</option>
                              {Object.entries(tipuriGrupate).map(([cat, lista]) => {
                                const meta = CAT_META[cat] || { emoji:'📄', label:cat }
                                return (
                                  <optgroup key={cat} label={`${meta.emoji} ${meta.label}`}>
                                    {lista.map(t => (
                                      <option key={t.id} value={t.id}>{t.denumire}</option>
                                    ))}
                                  </optgroup>
                                )
                              })}
                            </select>
                          </td>
                          <td style={{padding:'6px 8px', minWidth:130}}>
                            <input type="date" value={r.dataEmitere}
                              onChange={e => updateRow(r.id, { dataEmitere: e.target.value })}
                              disabled={importing || r.statusFinal === 'success'}
                              style={{...S.input, fontSize:11, padding:'4px 6px'}}/>
                          </td>
                          <td style={{padding:'6px 8px', minWidth:130}}>
                            {tipSelectat?.are_expirare ? (
                              <input type="date" value={r.dataExpirare}
                                onChange={e => updateRow(r.id, { dataExpirare: e.target.value })}
                                disabled={importing || r.statusFinal === 'success' || r.faraExpirare}
                                style={{...S.input, fontSize:11, padding:'4px 6px', opacity: r.faraExpirare ? 0.4 : 1}}/>
                            ) : (
                              <span style={{fontSize:11, color:G.green}}>∞ N/A</span>
                            )}
                          </td>
                          <td style={{padding:'6px 8px', whiteSpace:'nowrap', fontSize:10}}>
                            <div title="Confidence angajat" style={{color: confidenceColor(r.confidenceEmp), fontWeight:600}}>
                              👤 {r.confidenceEmp}%
                            </div>
                            <div title="Confidence tip" style={{color: confidenceColor(r.confidenceTip), fontWeight:600, marginTop:2}}>
                              📋 {r.confidenceTip}%
                            </div>
                          </td>
                          <td style={{padding:'6px 8px'}}>
                            <span style={{padding:'3px 8px', borderRadius:4, fontSize:10, fontWeight:700, background:badge.bg, color:badge.fg, whiteSpace:'nowrap'}}>
                              {badge.label}
                            </span>
                          </td>
                          <td style={{padding:'6px 8px', textAlign:'right'}}>
                            {!importing && r.statusFinal !== 'success' && (
                              <button onClick={() => removeRow(r.id)} 
                                style={{padding:'3px 7px', background:G.red+'22', color:G.red, border:`1px solid ${G.red}55`, borderRadius:4, fontSize:11, cursor:'pointer'}}>
                                🗑
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          
          {rows.length === 0 && (
            <div style={{textAlign:'center', padding:30, color:G.muted, fontSize:13}}>
              💡 Drag & drop fișiere mai sus, sau click pentru a selecta din computer.
              <br/><br/>
              <div style={{fontSize:11, lineHeight:1.7, color:G.dim, textAlign:'left', maxWidth:600, margin:'0 auto'}}>
                <strong style={{color:G.text}}>📌 Pentru detecție optimă:</strong><br/>
                • Nume fișier să conțină NUMELE ANGAJATULUI (ex: <code>STRIMBEANU VASILE - CAZIER.pdf</code>)<br/>
                • Pentru data emiterii, include <code>YYYY-MM-DD</code> sau anul (ex: <code>BULETIN 2022.pdf</code>)<br/>
                • Pentru tip, folosește cuvinte cheie clare: BULETIN, CAZIER, DIPLOMA, CALIFICARE, CONTRACT, etc.<br/>
                • Documentele cu confidence &lt; 70% apar marcate „⚠ Verifică" și trebuie corectate manual înainte de import.
              </div>
            </div>
          )}
        </div>
        
        {/* Footer */}
        <div style={{display:'flex', gap:10, justifyContent:'space-between', alignItems:'center', padding:'14px 24px', borderTop:`1px solid ${G.border}`, background:G.bg}}>
          <div style={{fontSize:11, color:G.muted}}>
            {rows.length > 0 && `📊 ${stats.ready} ready · ${stats.review} de verificat · ${stats.success} importate cu succes`}
          </div>
          <div style={{display:'flex', gap:10}}>
            <button onClick={onClose} disabled={importing} style={{...S.btnS, opacity: importing ? 0.4 : 1}}>
              {stats.success > 0 ? 'Închide' : 'Anulează'}
            </button>
            <button onClick={doImport} disabled={importing || stats.ready === 0}
              style={{...S.btnP, opacity: (importing || stats.ready === 0) ? 0.4 : 1}}>
              {importing ? `⏳ Import... (${progress.done}/${progress.total})` : `📥 Import ${stats.ready} fișiere`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
