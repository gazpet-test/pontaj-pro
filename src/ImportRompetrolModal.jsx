// ===========================================================================
// ImportRompetrolModal.jsx — Import alimentări din Excel Rompetrol
// v1 — 24.05.2026
// Format Excel: secțiuni „Vehicul: XYZ" cu tabel Data/Cantitate/Valoare/Km
// Match: nr_inmatriculare normalizat (fără spații)
// Carduri GAZPET1-21 = SKIP (atribuire ulterioară prin QR)
// ===========================================================================
import { useEffect, useRef, useState } from 'react'
import { supabase } from './lib/supabase.js'
import * as XLSX from 'xlsx-js-style'

const G = {
  bg:'#0D1117', surface:'#161B22', text:'#E6EDF3', muted:'#8B949E',
  border:'#30363D',
  blue:'#1F6FEB', green:'#2EA043', yellow:'#D29922', orange:'#F0883E', red:'#F85149', purple:'#A371F7',
}

const ROMPETROL_ICON = '🟢' // Rompetrol logo green-ish

// Normalizare nr înmatriculare: ELIMIN spații, upper case
function normalizeNrInmat(s) {
  if (!s) return ''
  return String(s).toUpperCase().replace(/\s+/g, '').trim()
}

// Detecție card brand (GAZPET1, GAZPET2, etc.)
function isCardBrand(s) {
  if (!s) return false
  return /^GAZPET\d+$/i.test(String(s).trim())
}

// Parse data din Excel — Rompetrol format „2026-05-01 08:17:39" sau Date object
function parseDataAlim(val) {
  if (!val) return null
  if (val instanceof Date && !isNaN(val.getTime())) return val.toISOString().slice(0, 10)
  const s = String(val).trim()
  // Format „2026-05-01 08:17:39" sau „2026-05-01"
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  // Format „01.05.2026" 
  const m2 = s.match(/^(\d{2})\.(\d{2})\.(\d{4})/)
  if (m2) return `${m2[3]}-${m2[2]}-${m2[1]}`
  return null
}

// Helper: ia valoarea din primă coloană non-null dintr-un range
function firstNonNull(row, indices) {
  for (const i of indices) {
    const v = row[i]
    if (v !== null && v !== undefined && v !== '') return v
  }
  return null
}

// Helper: parse număr (acceptă „1,234.56" sau „1234,56" sau Number direct)
function parseNum(v) {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return isNaN(v) ? null : v
  const s = String(v).replace(/\s/g, '').replace(/[^\d.,-]/g, '')
  // Heuristic: dacă are atât . cât și , presupun comma=mii, dot=zecimal
  let normalized = s
  if (s.includes(',') && s.includes('.')) {
    normalized = s.replace(/,/g, '')
  } else if (s.includes(',') && !s.includes('.')) {
    normalized = s.replace(',', '.')
  }
  const n = parseFloat(normalized)
  return isNaN(n) ? null : n
}

// Parser principal Excel Rompetrol
// Layout Excel Rompetrol (descoperit empiric):
//   Col 2  = label „Vehicul:" / „Total Vehicul:" / „Data" / data alimentare
//   Col 7  = nume vehicul (după „Vehicul:")
//   Col 11 = Cantitate (litri)
//   Col 14 = Valoare (RON)
//   Col 17 = Km la bord
//   Col 28 = Ore func motor
function parseRompetrolExcel(workbook) {
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  // raw: true ca să avem Date objects + Numbers (nu stringuri formatate)
  const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null })
  
  const sections = []
  let curentSection = null
  let inDataRows = false
  
  for (let i = 0; i < raw.length; i++) {
    const row = raw[i] || []
    
    // Cell-uri cheie din layout-ul Rompetrol
    const labelCell = row[2] // poate fi „Vehicul:" / „Total Vehicul:" / „Data" / data alimentare
    const labelStr = (labelCell != null) ? String(labelCell).trim() : ''
    
    // Detecție header secțiune „Vehicul:" (NU „Total Vehicul:" care-i row total final)
    if (labelStr === 'Vehicul:') {
      // Salvez secțiunea anterioară dacă există
      if (curentSection && curentSection.alimentari.length > 0) {
        const existing = sections.find(s => s.vehicul === curentSection.vehicul)
        if (!existing) sections.push(curentSection)
      }
      // Numele vehiculului în Col 7
      const vehiculRaw = row[7]
      const vehicul = vehiculRaw != null ? String(vehiculRaw).trim() : ''
      if (vehicul) {
        curentSection = { vehicul, alimentari: [] }
      } else {
        curentSection = null
      }
      inDataRows = false
      continue
    }
    
    // „Total Vehicul:" = sfârșit secțiune, NU bagaj ca secțiune nouă
    if (labelStr === 'Total Vehicul:') {
      inDataRows = false
      continue
    }
    
    // Detecție header tabel „Data" + „Cantitate" (Col 2 + Col 11)
    if (labelStr === 'Data' && String(row[11] || '').trim() === 'Cantitate') {
      inDataRows = true
      continue
    }
    
    // Detecție rânduri date (data în Col 2 + cantitate în Col 11)
    if (inDataRows && curentSection && labelCell != null) {
      const dataAlim = parseDataAlim(labelCell)
      if (!dataAlim) {
        // Nu-i data validă → posibil end of section
        continue
      }
      const cantitate = parseNum(row[11])
      const valoare = parseNum(row[14])
      const km = parseNum(row[17])
      const ore = parseNum(row[28])
      
      if (cantitate != null && cantitate > 0) {
        curentSection.alimentari.push({
          data_alimentare: dataAlim,
          cantitate_litri: Number(cantitate.toFixed(2)),
          pret_total: valoare != null && valoare > 0 ? Number(valoare.toFixed(2)) : null,
          km_la_alimentare: km != null && km > 100 ? Math.round(km) : null, // ignor km mici/invalizi
          ore_la_alimentare: ore != null && ore > 0 ? Math.round(ore) : null,
          raw_row: i + 1, // pentru debug
        })
      }
    }
  }
  
  // Salvez ultima secțiune
  if (curentSection && curentSection.alimentari.length > 0) {
    const existing = sections.find(s => s.vehicul === curentSection.vehicul)
    if (!existing) sections.push(curentSection)
  }
  
  return sections
}

// ─────────────────────────────────────────────────────────────────────────
// COMPONENT MODAL
// ─────────────────────────────────────────────────────────────────────────
export default function ImportRompetrolModal({ active, profile, showToast, onClose, onSaved }) {
  const [file, setFile] = useState(null)
  const [parsing, setParsing] = useState(false)
  const [sections, setSections] = useState([])
  const [matchResults, setMatchResults] = useState({ matched: [], carduri: [], nematched: [], duplicate: [] })
  const [importing, setImporting] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef(null)
  
  // ─── Drag & drop ────────────────────────────────────────────────────────
  const onFileSelect = (f) => {
    if (!f) return
    if (!/\.(xls|xlsx)$/i.test(f.name)) {
      showToast?.('Format invalid. Acceptă doar .xls sau .xlsx', 'error')
      return
    }
    setFile(f)
    parseFile(f)
  }
  
  const onDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer?.files?.[0]
    onFileSelect(f)
  }
  
  // ─── Parse + match ──────────────────────────────────────────────────────
  const parseFile = async (f) => {
    setParsing(true)
    try {
      const buf = await f.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array', cellDates: true })
      const secs = parseRompetrolExcel(wb)
      setSections(secs)
      
      if (secs.length === 0) {
        showToast?.('⚠️ Excel-ul nu pare să fie un raport Rompetrol valid. Nu am găsit nicio secțiune „Vehicul:".', 'warning')
        setParsing(false)
        return
      }
      
      // Match per secțiune
      const matched = [], carduri = [], nematched = [], duplicate = []
      
      // Pre-fetch BD: alimentări existente per active_id în interval (pentru detectare duplicate)
      // Fac un singur query la final pentru a evita N+1
      const allDates = secs.flatMap(s => s.alimentari.map(a => a.data_alimentare)).filter(Boolean)
      const minDate = allDates.length ? allDates.sort()[0] : null
      const maxDate = allDates.length ? allDates.sort()[allDates.length - 1] : null
      let existingAlim = []
      if (minDate && maxDate) {
        const { data: ex } = await supabase.from('logistica_alimentari')
          .select('id, active_id, data_alimentare, cantitate_litri')
          .gte('data_alimentare', minDate)
          .lte('data_alimentare', maxDate)
        existingAlim = ex || []
      }
      
      const existSet = new Set(existingAlim.map(e => 
        `${e.active_id}|${e.data_alimentare}|${Number(e.cantitate_litri).toFixed(2)}`
      ))
      
      for (const sec of secs) {
        const vehKey = normalizeNrInmat(sec.vehicul)
        
        if (isCardBrand(sec.vehicul)) {
          // Card brand GAZPET1-21 → SKIP (QR ulterior)
          carduri.push({
            ...sec,
            motiv: 'Card brand (GAZPET) — atribuire ulterioară prin QR code',
            total_litri: sec.alimentari.reduce((a, b) => a + (b.cantitate_litri || 0), 0),
            total_valoare: sec.alimentari.reduce((a, b) => a + (b.pret_total || 0), 0),
          })
          continue
        }
        
        // Caut activ cu nr_inmatriculare match
        const activ = (active || []).find(a => 
          a.nr_inmatriculare && normalizeNrInmat(a.nr_inmatriculare) === vehKey
        )
        
        if (!activ) {
          nematched.push({
            ...sec,
            motiv: `Nicio mașină în BD cu nr înmatriculare „${sec.vehicul}"`,
            total_litri: sec.alimentari.reduce((a, b) => a + (b.cantitate_litri || 0), 0),
          })
          continue
        }
        
        // Pentru fiecare alimentare, verific duplicate
        const newAlim = []
        const dupAlim = []
        for (const a of sec.alimentari) {
          const key = `${activ.id}|${a.data_alimentare}|${Number(a.cantitate_litri).toFixed(2)}`
          if (existSet.has(key)) {
            dupAlim.push(a)
          } else {
            newAlim.push(a)
          }
        }
        
        if (newAlim.length > 0) {
          matched.push({
            ...sec,
            activ,
            alimentari_noi: newAlim,
            alimentari_duplicate: dupAlim,
            total_litri: newAlim.reduce((a, b) => a + (b.cantitate_litri || 0), 0),
            total_valoare: newAlim.reduce((a, b) => a + (b.pret_total || 0), 0),
          })
        }
        if (dupAlim.length > 0 && newAlim.length === 0) {
          duplicate.push({ ...sec, activ, alimentari_duplicate: dupAlim })
        }
      }
      
      setMatchResults({ matched, carduri, nematched, duplicate })
    } catch (e) {
      showToast?.('Eroare parsare Excel: ' + (e.message || e), 'error')
    }
    setParsing(false)
  }
  
  // ─── Import în BD ──────────────────────────────────────────────────────
  const handleImport = async () => {
    if (!matchResults.matched.length) {
      showToast?.('Nimic de importat', 'warning')
      return
    }
    setImporting(true)
    try {
      const inserts = []
      for (const m of matchResults.matched) {
        for (const a of m.alimentari_noi) {
          inserts.push({
            active_id: m.activ.id,
            data_alimentare: a.data_alimentare,
            cantitate_litri: a.cantitate_litri,
            km_la_alimentare: a.km_la_alimentare,
            ore_la_alimentare: a.ore_la_alimentare,
            pret_total: a.pret_total,
            pret_per_litru: a.pret_total && a.cantitate_litri 
              ? Number((a.pret_total / a.cantitate_litri).toFixed(4)) 
              : null,
            statie_combustibil: 'Rompetrol',
            card_combustibil: null, // pentru nr înmatriculare; carduri GAZPET vor seta câmpul ăsta
            observatii: `[Import Rompetrol Excel ${new Date().toLocaleDateString('ro-RO')}]`,
            created_by: profile?.id || null,
          })
        }
      }
      
      // Insert batch (1000 max per chunk)
      const CHUNK = 500
      let total = 0
      for (let i = 0; i < inserts.length; i += CHUNK) {
        const chunk = inserts.slice(i, i + CHUNK)
        const { error } = await supabase.from('logistica_alimentari').insert(chunk)
        if (error) throw error
        total += chunk.length
      }
      
      showToast?.(`✓ Import Rompetrol: ${total} alimentări noi importate pentru ${matchResults.matched.length} mașini`, 'success')
      if (onSaved) onSaved()
      onClose()
    } catch (e) {
      showToast?.('Eroare import: ' + (e.message || e), 'error')
    }
    setImporting(false)
  }
  
  const totalLitriDeImportat = matchResults.matched.reduce((s, m) => s + m.total_litri, 0)
  const totalValoareDeImportat = matchResults.matched.reduce((s, m) => s + (m.total_valoare || 0), 0)
  const totalAlimDeImportat = matchResults.matched.reduce((s, m) => s + m.alimentari_noi.length, 0)
  
  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, padding: 16,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: G.surface, border: `1px solid ${G.border}`,
        borderRadius: 14, maxWidth: 900, width: '100%', maxHeight: '90vh',
        overflowY: 'auto', padding: 24,
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: G.text, display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 28 }}>{ROMPETROL_ICON}</span> Import Alimentări Rompetrol
            </div>
            <div style={{ fontSize: 11, color: G.muted, marginTop: 4 }}>
              Upload raport Excel „Refilling" → match automat pe nr înmatriculare
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none', color: G.muted,
            cursor: 'pointer', fontSize: 22, padding: '0 8px',
          }}>✕</button>
        </div>
        
        {/* Drag & drop area */}
        {!file && (
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: `2px dashed ${dragOver ? G.green : G.border}`,
              background: dragOver ? G.green + '11' : G.bg,
              borderRadius: 10,
              padding: 40,
              textAlign: 'center',
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}>
            <div style={{ fontSize: 48, marginBottom: 10 }}>📥</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: G.text, marginBottom: 4 }}>
              Trage aici fișierul Excel Rompetrol
            </div>
            <div style={{ fontSize: 11, color: G.muted }}>
              sau click pentru selectare · acceptă .xls și .xlsx
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xls,.xlsx"
              style={{ display: 'none' }}
              onChange={e => onFileSelect(e.target.files?.[0])}
            />
          </div>
        )}
        
        {/* File loaded */}
        {file && (
          <div style={{
            background: G.bg, border: `1px solid ${G.border}`, borderRadius: 8,
            padding: 12, marginBottom: 14, display: 'flex',
            justifyContent: 'space-between', alignItems: 'center',
          }}>
            <div style={{ fontSize: 12, color: G.text }}>
              <strong>📄 {file.name}</strong> · {(file.size / 1024).toFixed(1)} KB
            </div>
            <button
              onClick={() => { setFile(null); setSections([]); setMatchResults({ matched: [], carduri: [], nematched: [], duplicate: [] }) }}
              style={{
                padding: '4px 10px', background: 'transparent',
                color: G.muted, border: `1px solid ${G.border}`,
                borderRadius: 5, fontSize: 11, cursor: 'pointer',
              }}>
              Înlocuiește
            </button>
          </div>
        )}
        
        {parsing && (
          <div style={{ padding: 30, textAlign: 'center', color: G.muted }}>
            ⏳ Parsez Excel-ul...
          </div>
        )}
        
        {/* Rezultate match */}
        {!parsing && sections.length > 0 && (
          <>
            {/* Summary KPIs */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
              <KPI label="Matched (import)" value={matchResults.matched.length} color={G.green} icon="✓" />
              <KPI label="Carduri GAZPET" value={matchResults.carduri.length} color={G.purple} icon="🎫" />
              <KPI label="Fără match BD" value={matchResults.nematched.length} color={G.orange} icon="?" />
              <KPI label="Doar duplicate" value={matchResults.duplicate.length} color={G.muted} icon="↺" />
            </div>
            
            {/* Total de importat */}
            {matchResults.matched.length > 0 && (
              <div style={{
                background: G.green + '11', border: `1px solid ${G.green}33`,
                borderRadius: 8, padding: 14, marginBottom: 14,
              }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: G.green, marginBottom: 6 }}>
                  ✓ Va importa {totalAlimDeImportat} alimentări pentru {matchResults.matched.length} mașini
                </div>
                <div style={{ fontSize: 11, color: G.muted }}>
                  Total: <strong style={{ color: G.text }}>{totalLitriDeImportat.toFixed(2)} L</strong>
                  {' '}·{' '}
                  Valoare: <strong style={{ color: G.text }}>{totalValoareDeImportat.toFixed(2)} RON</strong>
                </div>
              </div>
            )}
            
            {/* Lista matched */}
            {matchResults.matched.length > 0 && (
              <SectionList
                titlu={`✓ Matched — ${matchResults.matched.length} mașini, ${totalAlimDeImportat} alimentări noi`}
                color={G.green}
                items={matchResults.matched.map(m => ({
                  vehicul: m.vehicul,
                  activ: `${m.activ.marca || ''} ${m.activ.model || ''} (${m.activ.nr_inmatriculare})`,
                  alim_count: m.alimentari_noi.length,
                  dup_count: m.alimentari_duplicate?.length || 0,
                  total_litri: m.total_litri,
                  total_valoare: m.total_valoare,
                }))}
              />
            )}
            
            {/* Lista carduri GAZPET */}
            {matchResults.carduri.length > 0 && (
              <SectionList
                titlu={`🎫 Carduri brand — ${matchResults.carduri.length} carduri (atribuire ulterioară prin QR)`}
                color={G.purple}
                items={matchResults.carduri.map(c => ({
                  vehicul: c.vehicul,
                  activ: '(card brand, va fi atribuit ulterior prin QR)',
                  alim_count: c.alimentari.length,
                  total_litri: c.total_litri,
                  total_valoare: c.total_valoare,
                }))}
              />
            )}
            
            {/* Lista nematched */}
            {matchResults.nematched.length > 0 && (
              <SectionList
                titlu={`? Fără match BD — ${matchResults.nematched.length} mașini`}
                color={G.orange}
                items={matchResults.nematched.map(n => ({
                  vehicul: n.vehicul,
                  activ: n.motiv,
                  alim_count: n.alimentari.length,
                  total_litri: n.total_litri,
                }))}
              />
            )}
            
            {/* Lista duplicate */}
            {matchResults.duplicate.length > 0 && (
              <SectionList
                titlu={`↺ Doar duplicate — ${matchResults.duplicate.length} mașini (deja importate)`}
                color={G.muted}
                items={matchResults.duplicate.map(d => ({
                  vehicul: d.vehicul,
                  activ: `${d.activ.marca || ''} ${d.activ.model || ''}`,
                  alim_count: d.alimentari_duplicate.length,
                }))}
              />
            )}
            
            {/* Footer butoane */}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
              <button
                onClick={onClose}
                disabled={importing}
                style={{
                  padding: '10px 18px', background: 'transparent',
                  color: G.muted, border: `1px solid ${G.border}`,
                  borderRadius: 8, fontSize: 13, cursor: 'pointer',
                }}>
                Anulează
              </button>
              <button
                onClick={handleImport}
                disabled={importing || matchResults.matched.length === 0}
                style={{
                  padding: '10px 22px',
                  background: importing ? G.muted : G.green,
                  color: '#fff', border: 'none',
                  borderRadius: 8, fontSize: 13, fontWeight: 700,
                  cursor: (importing || matchResults.matched.length === 0) ? 'not-allowed' : 'pointer',
                  opacity: matchResults.matched.length === 0 ? 0.5 : 1,
                }}>
                {importing ? '⏳ Import...' : `✓ Importă ${totalAlimDeImportat} alimentări`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────
function KPI({ label, value, color, icon }) {
  return (
    <div style={{
      background: G.bg, border: `1px solid ${G.border}`,
      borderLeft: `3px solid ${color}`,
      borderRadius: 6, padding: 10,
    }}>
      <div style={{ fontSize: 10, color: G.muted, marginBottom: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
        <span>{icon}</span> {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color }}>{value}</div>
    </div>
  )
}

function SectionList({ titlu, color, items }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div style={{
      background: G.bg, border: `1px solid ${G.border}`,
      borderLeft: `3px solid ${color}`,
      borderRadius: 8, padding: 12, marginBottom: 10,
    }}>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          fontSize: 12, fontWeight: 700, color, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
        <span>{titlu}</span>
        <span style={{ fontSize: 11, color: G.muted }}>{expanded ? '▴ ascunde' : '▾ vezi'}</span>
      </div>
      {expanded && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {items.map((it, i) => (
            <div key={i} style={{
              padding: '6px 10px', background: G.surface,
              borderRadius: 4, fontSize: 11, color: G.muted,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: G.text, fontWeight: 600, marginBottom: 2 }}>{it.vehicul}</div>
                <div style={{ fontSize: 10, color: G.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {it.activ}
                </div>
              </div>
              <div style={{ textAlign: 'right', fontSize: 10, whiteSpace: 'nowrap' }}>
                <div style={{ color: G.text }}>{it.alim_count} alim</div>
                {it.dup_count > 0 && <div style={{ color: G.muted }}>+{it.dup_count} dup</div>}
                {it.total_litri != null && <div style={{ color: G.muted }}>{it.total_litri.toFixed(0)}L</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
