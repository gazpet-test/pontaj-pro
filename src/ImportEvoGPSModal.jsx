// ETAPA 8.5: Modal import telemetrie EvoGPS
// Drag&drop XLSX raport „Foaie de activitate zilnica" → parse → match cu logistica_active → bulk INSERT
// Componentă standalone, integrabilă în Logistica.jsx sau Admin Settings.
import { useState, useEffect, useRef, useMemo } from 'react'
import * as XLSX from 'xlsx-js-style'

// Helper coloane fixe în raportul EvoGPS „Foaie de activitate zilnica" (0-indexed)
const COL = {
  DATA: 5, ORA_INC: 24, ORA_SF: 39,
  TIMP_MISCARE: 57, TIMP_STAT: 77, TIMP_TOTAL: 99,
  DISTANTA: 118, KILOMETRAJ: 138,
  VITEZA: 159, CONSUM: 173, ORE_MOTOR: 176,
}

// Regex pentru extragere nr înmatriculare din nume EvoGPS (suportă majoritatea județelor RO)
// 2 versiuni separate ca să evităm bug-ul lastIndex la regex global cu .test()
const _NR_PATTERN = '\\b((?:PH|MS|B|CT|CJ|BV|IF|SB|TM|GL|AG|BC|BR|DB|GJ|MM|HD|HG|VL|VN|VS|AB|BH|BN|BT|BZ|CL|CS|CV|DJ|GR|HR|IL|IS|MH|NT|OT|PR|SJ|SM|SV|TL|TR|JR)\\s?[\\-\\s]?\\d{1,6}\\s?[\\-\\s]?[A-Z]{0,4})\\b'
const NR_REGEX_TEST = new RegExp(_NR_PATTERN, 'i')   // pentru .test() / .match() (fără side-effects)
const NR_REGEX_ALL = new RegExp(_NR_PATTERN, 'gi')   // pentru matchAll() (extracție all matches)

const normalizeNr = (s) => {
  if (!s) return ''
  return String(s).replace(/[\-\/\s]+/g, ' ').toUpperCase().trim()
}

const extractNrFromEvoName = (name) => {
  if (!name) return null
  // Iau TOATE match-urile, prefer ULTIMUL (nr e mereu la finalul numelui)
  // Ex: „Nissan NT400 Cabstar PH 2" → match1=NT400, match2=PH 2 → iau PH 2
  const matches = [...String(name).matchAll(NR_REGEX_ALL)]
  if (matches.length === 0) return null
  const lastMatch = matches[matches.length - 1][1]
  return normalizeNr(lastMatch)
}

// „12.05.2026" sau Date obj → '2026-05-12' (ISO)
const parseDataRO = (val) => {
  if (!val) return null
  if (val instanceof Date) {
    const y = val.getFullYear(), m = String(val.getMonth() + 1).padStart(2, '0'), d = String(val.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  const s = String(val).trim()
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/)
  if (!m) return null
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
}

// „01h 38m 39s" → 5919 secunde; „00s" → 0; „1z 17h 11m 32s" → secunde (1 zi)
const parseTimpEvo = (val) => {
  if (val == null || val === '-' || val === '') return null
  const s = String(val).trim()
  let total = 0
  const matchZi = s.match(/(\d+)z/i)
  const matchH = s.match(/(\d+)h/i)
  const matchM = s.match(/(\d+)m/i)
  const matchS = s.match(/(\d+)s/i)
  if (matchZi) total += Number(matchZi[1]) * 86400
  if (matchH) total += Number(matchH[1]) * 3600
  if (matchM) total += Number(matchM[1]) * 60
  if (matchS) total += Number(matchS[1])
  return total > 0 ? total : 0
}

// „07:01:32" → '07:01:32' (PostgreSQL TIME); date obj timp Excel → '07:01:32'
const parseOraEvo = (val) => {
  if (val == null || val === '-' || val === '') return null
  if (val instanceof Date) {
    const h = String(val.getHours()).padStart(2, '0'), m = String(val.getMinutes()).padStart(2, '0'), s = String(val.getSeconds()).padStart(2, '0')
    return `${h}:${m}:${s}`
  }
  const m = String(val).match(/^(\d{1,2}):(\d{2}):(\d{2})/)
  if (!m) return null
  return `${m[1].padStart(2, '0')}:${m[2]}:${m[3]}`
}

const parseNumber = (val) => {
  if (val == null || val === '-' || val === '') return null
  if (typeof val === 'number') return val
  const s = String(val).replace(/\s/g, '').replace(',', '.')
  const n = Number(s)
  return isNaN(n) ? null : n
}

// PARSER PRINCIPAL: XLSX → array vehicule cu zile
const parseEvoGPSWorkbook = (arrayBuffer) => {
  const wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: true })
  const sheetName = wb.SheetNames[0]
  const ws = wb.Sheets[sheetName]
  if (!ws || !ws['!ref']) throw new Error('Sheet gol sau invalid')

  const range = XLSX.utils.decode_range(ws['!ref'])
  const maxRow = range.e.r
  const maxCol = range.e.c

  // 1. Caut toate header-urile „Kilometraj" → început tabel vehicul
  const headerRows = []
  for (let r = 0; r <= maxRow; r++) {
    for (let c = 0; c <= Math.min(maxCol, 200); c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })]
      if (cell && cell.v === 'Kilometraj') {
        headerRows.push(r)
        break
      }
    }
  }

  // 2. Pentru fiecare header, găsesc numele vehiculului 
  //    Scan ÎN SUS cu protecție: nu trec peste header-ul precedent
  //    Spacing offset variază (5 zile→12, 16 zile→24, 30 zile→37) deci scan range mărit
  const vehicles = []
  for (let i = 0; i < headerRows.length; i++) {
    const headerRow = headerRows[i]
    const prevHeaderRow = i > 0 ? headerRows[i - 1] : -1
    const scanStart = Math.max(prevHeaderRow + 3, headerRow - 60) // max 60 sus, dar nu peste prev header
    
    let vehicleName = null
    // Scan de la cel mai apropiat de header (mai sigur că e numele corect)
    for (let r = headerRow - 1; r >= scanStart; r--) {
      for (let c = 0; c <= 35; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })]
        const v = cell?.v
        if (typeof v === 'string' && v.trim() && NR_REGEX_TEST.test(v)) {
          vehicleName = String(v).trim()
          break
        }
      }
      if (vehicleName) break
    }

    // 3. Citesc zilele după header. Max 50 zile (acoperă luni complete + tampon).
    //    Stop la „Total" sau celulă goală.
    const days = []
    for (let r = headerRow + 1; r <= Math.min(headerRow + 50, maxRow); r++) {
      const dataCell = ws[XLSX.utils.encode_cell({ r, c: COL.DATA })]
      const v = dataCell?.v
      if (v == null || v === '') break
      if (typeof v === 'string' && v.toLowerCase().includes('total')) break

      const dataISO = parseDataRO(v)
      if (!dataISO) continue

      const get = (col) => ws[XLSX.utils.encode_cell({ r, c: col })]?.v
      const distanta = parseNumber(get(COL.DISTANTA))
      const kilometraj = parseNumber(get(COL.KILOMETRAJ))

      // Zi fără activitate → skip dacă distanta și kilometraj sunt ambele goale/„-"
      if (distanta == null && kilometraj == null) continue

      days.push({
        data: dataISO,
        ora_inceput: parseOraEvo(get(COL.ORA_INC)),
        ora_sfarsit: parseOraEvo(get(COL.ORA_SF)),
        timp_miscare_secunde: parseTimpEvo(get(COL.TIMP_MISCARE)),
        timp_stationare_secunde: parseTimpEvo(get(COL.TIMP_STAT)),
        timp_total_secunde: parseTimpEvo(get(COL.TIMP_TOTAL)),
        total_km_zi: distanta,
        km_sfarsit_zi: kilometraj,
        viteza_maxima_kmh: parseNumber(get(COL.VITEZA)),
        consum_total_normat_l: parseNumber(get(COL.CONSUM)),
        ore_motor_secunde: parseTimpEvo(get(COL.ORE_MOTOR)),
      })
    }

    if (!vehicleName) continue
    const nr_extracted = extractNrFromEvoName(vehicleName)
    vehicles.push({
      evogps_name: vehicleName,
      nr_extracted,
      days,
      total_days: days.length,
    })
  }

  return vehicles
}

// MAIN COMPONENT
export default function ImportEvoGPSModal({ open, onClose, supabase, profile, onSuccess, G, S }) {
  // G = global colors, S = styles (le pasăm din App.jsx ca să avem coerență)
  const fileRef = useRef(null)
  const [file, setFile] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [parsedVehicles, setParsedVehicles] = useState([]) // raw parse
  const [assetsBD, setAssetsBD] = useState([]) // logistica_active toate
  const [existingTelem, setExistingTelem] = useState(new Set()) // chei „assetId_data" deja în BD (pentru dedup)
  const [assignments, setAssignments] = useState({}) // evogps_name → asset_id (manual override)
  const [importing, setImporting] = useState(false)
  const [toast, setToast] = useState(null)
  const [tab, setTab] = useState('matched')
  const [step, setStep] = useState('upload') // 'upload' | 'preview' | 'done'

  // Load assets BD la deschidere modal
  useEffect(() => {
    if (!open) return
    setStep('upload'); setFile(null); setParsedVehicles([]); setAssignments({}); setToast(null)
    ;(async () => {
      try {
        const { data, error } = await supabase
          .from('logistica_active')
          .select('id, nr_inmatriculare, marca, model, km_actuali, vandut, stare')
          .order('nr_inmatriculare')
        if (error) throw error
        setAssetsBD(data || [])
      } catch (e) {
        setToast({ type: 'error', msg: 'Eroare load logistica_active: ' + e.message })
      }
    })()
  }, [open, supabase])

  // Reverse-lookup map: nr_normalized → asset row
  const assetsByNr = useMemo(() => {
    const m = new Map()
    for (const a of assetsBD) {
      if (!a.nr_inmatriculare) continue
      const nrm = normalizeNr(a.nr_inmatriculare)
      if (nrm) m.set(nrm, a)
    }
    return m
  }, [assetsBD])

  // Auto-match: pentru fiecare vehicul EvoGPS, găsește asset_id
  const matchedVehicles = useMemo(() => {
    return parsedVehicles.map(v => {
      let asset = null
      let matchType = 'none' // 'exact' | 'prefix' | 'manual' | 'none'
      // Manual override
      if (assignments[v.evogps_name]) {
        asset = assetsBD.find(a => a.id === assignments[v.evogps_name])
        if (asset) matchType = 'manual'
      } else if (v.nr_extracted) {
        // Exact match
        asset = assetsByNr.get(v.nr_extracted)
        if (asset) matchType = 'exact'
        else {
          // Prefix match (pentru nume trunchiate „PH 39 G" → găsește „PH 39 GAZ")
          for (const [nrm, a] of assetsByNr) {
            if (nrm.startsWith(v.nr_extracted)) { asset = a; matchType = 'prefix'; break }
          }
        }
      }
      // Check duplicate per zi
      const daysWithStatus = v.days.map(d => ({
        ...d,
        is_duplicate: asset ? existingTelem.has(`${asset.id}_${d.data}`) : false,
      }))
      return { ...v, asset, matchType, daysWithStatus }
    })
  }, [parsedVehicles, assignments, assetsBD, assetsByNr, existingTelem])

  const stats = useMemo(() => {
    const s = { matched: 0, unmatched: 0, duplicate_days: 0, total_days: 0, new_days: 0 }
    for (const v of matchedVehicles) {
      if (v.asset) s.matched++; else s.unmatched++
      for (const d of v.daysWithStatus) {
        s.total_days++
        if (d.is_duplicate) s.duplicate_days++; else if (v.asset) s.new_days++
      }
    }
    return s
  }, [matchedVehicles])

  const handleFileSelect = async (f) => {
    if (!f) return
    if (!/\.xlsx?$/i.test(f.name)) {
      setToast({ type: 'error', msg: 'Numai fișiere .xlsx sau .xls acceptate' })
      return
    }
    setFile(f); setParsing(true); setToast(null)
    try {
      const buf = await f.arrayBuffer()
      const vehicles = parseEvoGPSWorkbook(buf)
      if (vehicles.length === 0) throw new Error('Niciun vehicul găsit în fișier. Verifică formatul.')
      setParsedVehicles(vehicles)
      // Check existing telemetry pentru aceste asset+date
      const assetIds = new Set()
      const dates = new Set()
      for (const v of vehicles) {
        const nr = v.nr_extracted
        if (!nr) continue
        const a = assetsByNr.get(nr) || [...assetsByNr.values()].find(x => normalizeNr(x.nr_inmatriculare).startsWith(nr))
        if (a) assetIds.add(a.id)
        for (const d of v.days) dates.add(d.data)
      }
      if (assetIds.size > 0 && dates.size > 0) {
        const { data: existing } = await supabase
          .from('logistica_telemetrie_zilnica')
          .select('asset_id, data')
          .in('asset_id', [...assetIds])
          .in('data', [...dates])
          .eq('sursa', 'evogps')
        const set = new Set()
        ;(existing || []).forEach(e => set.add(`${e.asset_id}_${e.data}`))
        setExistingTelem(set)
      }
      setStep('preview'); setTab('matched')
    } catch (e) {
      console.error('Parse EvoGPS err:', e)
      setToast({ type: 'error', msg: 'Eroare parsing: ' + e.message })
    } finally {
      setParsing(false)
    }
  }

  const onDrop = (e) => {
    e.preventDefault(); setDragOver(false)
    const f = e.dataTransfer?.files?.[0]
    if (f) handleFileSelect(f)
  }

  const executeImport = async () => {
    if (!profile?.is_owner && !['admin', 'manager_proiect', 'logistica'].includes(profile?.role)) {
      setToast({ type: 'error', msg: 'Acces interzis - doar manager/owner pot importa.' })
      return
    }
    const rows = []
    for (const v of matchedVehicles) {
      if (!v.asset) continue
      for (const d of v.daysWithStatus) {
        if (d.is_duplicate) continue
        rows.push({
          asset_id: v.asset.id,
          data: d.data,
          ora_inceput: d.ora_inceput,
          ora_sfarsit: d.ora_sfarsit,
          timp_miscare_secunde: d.timp_miscare_secunde,
          timp_stationare_secunde: d.timp_stationare_secunde,
          timp_total_secunde: d.timp_total_secunde,
          total_km_zi: d.total_km_zi,
          km_sfarsit_zi: d.km_sfarsit_zi,
          viteza_maxima_kmh: d.viteza_maxima_kmh,
          consum_total_normat_l: d.consum_total_normat_l,
          ore_motor_secunde: d.ore_motor_secunde,
          sursa: 'evogps',
          raw_data: { evogps_name: v.evogps_name, file: file?.name, imported_at: new Date().toISOString() },
        })
      }
    }
    if (rows.length === 0) {
      setToast({ type: 'warn', msg: 'Nimic de importat - toate datele sunt deja în BD sau nu au match.' })
      return
    }
    setImporting(true)
    try {
      // Insert în chunks de 500 (limite Supabase)
      const chunkSize = 500
      let inserted = 0
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize)
        const { error, count } = await supabase
          .from('logistica_telemetrie_zilnica')
          .insert(chunk)
        if (error) throw error
        inserted += chunk.length
      }
      setToast({ type: 'success', msg: `✓ Importate ${inserted} înregistrări telemetrie din ${stats.matched} vehicule. km_actuali actualizat automat prin trigger.` })
      setStep('done')
      onSuccess && onSuccess(inserted)
    } catch (e) {
      console.error('Import err:', e)
      setToast({ type: 'error', msg: 'Eroare la import: ' + e.message })
    } finally {
      setImporting(false)
    }
  }

  if (!open) return null

  // Fallback theme dacă App.jsx nu pasează G/S
  const colors = G || { card: '#161B22', text: '#E6EDF3', muted: '#8B949E', border: '#30363D', green: '#3FB950', red: '#F85149', blue: '#58A6FF', orange: '#FF9F40' }
  const card = { background: colors.card, color: colors.text, borderRadius: 8, border: `1px solid ${colors.border}` }
  const btnP = { background: colors.blue, color: '#fff', border: 'none', borderRadius: 6, padding: '8px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 700 }
  const btnS = { background: 'transparent', color: colors.muted, border: `1px solid ${colors.border}`, borderRadius: 6, padding: '8px 14px', cursor: 'pointer', fontSize: 13 }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.85)', zIndex: 250, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ ...card, width: '95vw', maxWidth: 1100, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div style={{ padding: '14px 20px', borderBottom: `1px solid ${colors.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: colors.text }}>🛰️ Import telemetrie EvoGPS</div>
            <div style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>Etapa 8.5 — descarcă raportul „Foaie de activitate zilnica" din EvoGPS Rapoarte și importă aici (XLSX)</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: colors.muted, cursor: 'pointer', fontSize: 22 }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          {toast && (
            <div style={{
              padding: 12, borderRadius: 6, marginBottom: 14, fontSize: 13,
              background: toast.type === 'error' ? '#3D1A1A' : toast.type === 'success' ? '#1A3D1A' : '#3D3A1A',
              border: `1px solid ${toast.type === 'error' ? colors.red : toast.type === 'success' ? colors.green : colors.orange}66`,
              color: toast.type === 'error' ? colors.red : toast.type === 'success' ? colors.green : colors.orange,
            }}>
              {toast.msg}
            </div>
          )}

          {/* STEP UPLOAD */}
          {step === 'upload' && (
            <div>
              <div
                onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                onClick={() => fileRef.current?.click()}
                style={{
                  border: `2px dashed ${dragOver ? colors.blue : colors.border}`,
                  borderRadius: 12, padding: 60, textAlign: 'center', cursor: 'pointer',
                  background: dragOver ? colors.blue + '11' : 'transparent', transition: 'all .2s',
                }}>
                <div style={{ fontSize: 48, marginBottom: 12 }}>📂</div>
                <div style={{ fontSize: 15, color: colors.text, fontWeight: 600, marginBottom: 6 }}>
                  {parsing ? '⏳ Procesare...' : 'Drag&drop XLSX EvoGPS aici sau click pentru selectare'}
                </div>
                <div style={{ fontSize: 12, color: colors.muted }}>
                  Raport „Foaie de activitate zilnica" exportat din EvoGPS Rapoarte → Excel
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,.xls"
                  style={{ display: 'none' }}
                  onChange={e => handleFileSelect(e.target.files?.[0])}
                />
              </div>
              <div style={{ marginTop: 18, fontSize: 12, color: colors.muted, lineHeight: 1.6 }}>
                <strong style={{ color: colors.text }}>💡 Cum obții fișierul:</strong>
                <ol style={{ marginTop: 6, paddingLeft: 20 }}>
                  <li>EvoGPS → Rapoarte → <strong style={{ color: colors.text }}>Foaie de activitate zilnica</strong></li>
                  <li>Selectează perioada dorită + grup vehicule</li>
                  <li>Click <strong style={{ color: colors.text }}>View Report</strong></li>
                  <li>Click iconul Export → <strong style={{ color: colors.text }}>Excel</strong></li>
                  <li>Drag fișierul aici sau click pentru selectare</li>
                </ol>
              </div>
            </div>
          )}

          {/* STEP PREVIEW */}
          {step === 'preview' && (
            <div>
              {/* Stats */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
                <StatBox title="✓ Match auto" value={stats.matched} sub="vehicule" color={colors.green} colors={colors} />
                <StatBox title="⚠ Nematche" value={stats.unmatched} sub="vehicule" color={colors.orange} colors={colors} />
                <StatBox title="📅 Total zile" value={stats.total_days} sub={`${stats.new_days} noi · ${stats.duplicate_days} duplicate`} color={colors.blue} colors={colors} />
                <StatBox title="📁 Fișier" value={file?.name?.slice(0, 18) || '-'} sub={`${(file?.size / 1024).toFixed(0)} KB`} color={colors.muted} colors={colors} />
              </div>

              {/* Tabs */}
              <div style={{ display: 'flex', gap: 0, borderBottom: `1px solid ${colors.border}`, marginBottom: 12 }}>
                {['matched', 'unmatched', 'duplicate'].map(t => {
                  const labels = { matched: '✓ Matched', unmatched: '⚠ Nematche', duplicate: '🔁 Duplicate' }
                  const counts = { matched: stats.matched, unmatched: stats.unmatched, duplicate: stats.duplicate_days }
                  return (
                    <button key={t} onClick={() => setTab(t)} style={{
                      background: 'none', border: 'none', padding: '10px 16px', cursor: 'pointer',
                      color: tab === t ? colors.text : colors.muted, fontWeight: tab === t ? 700 : 400,
                      borderBottom: `2px solid ${tab === t ? colors.blue : 'transparent'}`, fontSize: 13,
                    }}>
                      {labels[t]} ({counts[t]})
                    </button>
                  )
                })}
              </div>

              {/* Tab content */}
              {tab === 'matched' && (
                <VehiclesTable
                  vehicles={matchedVehicles.filter(v => v.asset)}
                  colors={colors}
                  showDays
                />
              )}
              {tab === 'unmatched' && (
                <UnmatchedTable
                  vehicles={matchedVehicles.filter(v => !v.asset)}
                  assets={assetsBD}
                  assignments={assignments}
                  setAssignments={setAssignments}
                  colors={colors}
                />
              )}
              {tab === 'duplicate' && (
                <DuplicatesTable
                  vehicles={matchedVehicles.filter(v => v.asset && v.daysWithStatus.some(d => d.is_duplicate))}
                  colors={colors}
                />
              )}
            </div>
          )}

          {/* STEP DONE */}
          {step === 'done' && (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <div style={{ fontSize: 60, marginBottom: 16 }}>✅</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: colors.green, marginBottom: 8 }}>Import finalizat!</div>
              <div style={{ fontSize: 13, color: colors.muted }}>km_actuali actualizat automat în logistica_active pentru toate vehiculele importate.</div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 20px', borderTop: `1px solid ${colors.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 11, color: colors.muted }}>
            {step === 'preview' && `${stats.new_days} înregistrări noi vor fi adăugate`}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {step === 'preview' && (
              <button onClick={() => { setStep('upload'); setFile(null); setParsedVehicles([]) }} style={btnS}>← Înapoi</button>
            )}
            <button onClick={onClose} style={btnS}>{step === 'done' ? 'Închide' : 'Anulează'}</button>
            {step === 'preview' && stats.new_days > 0 && (
              <button onClick={executeImport} disabled={importing} style={{ ...btnP, background: colors.green, opacity: importing ? .5 : 1 }}>
                {importing ? '⏳ Import...' : `📥 Importă ${stats.new_days} înregistrări`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// === SUB-COMPONENTE ===

function StatBox({ title, value, sub, color, colors }) {
  return (
    <div style={{ background: '#1C2128', padding: 12, borderRadius: 8, border: `1px solid ${colors.border}` }}>
      <div style={{ fontSize: 10, color: colors.muted, marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color }}>{value}</div>
      <div style={{ fontSize: 10, color: colors.muted, marginTop: 2 }}>{sub}</div>
    </div>
  )
}

function VehiclesTable({ vehicles, colors, showDays }) {
  const [expanded, setExpanded] = useState(new Set())
  if (vehicles.length === 0) return <div style={{ color: colors.muted, fontSize: 13, padding: 20, textAlign: 'center' }}>Niciun vehicul aici.</div>
  return (
    <div style={{ maxHeight: '50vh', overflowY: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead style={{ position: 'sticky', top: 0, background: '#1C2128', zIndex: 1 }}>
          <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
            <th style={{ padding: 8, textAlign: 'left', color: colors.muted, fontSize: 11 }}>EvoGPS</th>
            <th style={{ padding: 8, textAlign: 'left', color: colors.muted, fontSize: 11 }}>→ Match BD</th>
            <th style={{ padding: 8, textAlign: 'left', color: colors.muted, fontSize: 11 }}>Tip</th>
            <th style={{ padding: 8, textAlign: 'center', color: colors.muted, fontSize: 11 }}>Zile noi</th>
            <th style={{ padding: 8, textAlign: 'center', color: colors.muted, fontSize: 11 }}>Total km</th>
            <th style={{ padding: 8, textAlign: 'center', color: colors.muted, fontSize: 11 }}>Ultim km</th>
            <th style={{ padding: 8, color: colors.muted, fontSize: 11 }}></th>
          </tr>
        </thead>
        <tbody>
          {vehicles.map((v, i) => {
            const newDays = v.daysWithStatus.filter(d => !d.is_duplicate)
            const totalKm = newDays.reduce((s, d) => s + (d.total_km_zi || 0), 0)
            const lastKm = Math.max(...v.daysWithStatus.map(d => d.km_sfarsit_zi || 0))
            const isExp = expanded.has(v.evogps_name)
            return (
              <>
                <tr key={i} style={{ borderBottom: `1px solid ${colors.border}33` }}>
                  <td style={{ padding: 8, color: colors.text }}>{v.evogps_name}</td>
                  <td style={{ padding: 8, color: colors.green }}>{v.asset?.nr_inmatriculare} <span style={{ color: colors.muted, fontSize: 10 }}>· {v.asset?.marca}</span></td>
                  <td style={{ padding: 8, fontSize: 10 }}>
                    <span style={{
                      padding: '2px 6px', borderRadius: 4,
                      background: v.matchType === 'exact' ? colors.green + '22' : v.matchType === 'prefix' ? colors.orange + '22' : colors.blue + '22',
                      color: v.matchType === 'exact' ? colors.green : v.matchType === 'prefix' ? colors.orange : colors.blue,
                    }}>
                      {v.matchType === 'exact' ? 'EXACT' : v.matchType === 'prefix' ? 'PREFIX' : 'MANUAL'}
                    </span>
                  </td>
                  <td style={{ padding: 8, textAlign: 'center', color: colors.text, fontWeight: 700 }}>{newDays.length}</td>
                  <td style={{ padding: 8, textAlign: 'center', color: colors.text }}>{totalKm.toFixed(1)}</td>
                  <td style={{ padding: 8, textAlign: 'center', color: colors.blue, fontWeight: 700 }}>{lastKm > 0 ? lastKm.toFixed(0) : '-'}</td>
                  <td style={{ padding: 8 }}>
                    <button onClick={() => {
                      const ns = new Set(expanded)
                      if (isExp) ns.delete(v.evogps_name); else ns.add(v.evogps_name)
                      setExpanded(ns)
                    }} style={{ background: 'none', border: `1px solid ${colors.border}`, color: colors.muted, padding: '3px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}>
                      {isExp ? '▲' : '▼'}
                    </button>
                  </td>
                </tr>
                {isExp && (
                  <tr>
                    <td colSpan={7} style={{ padding: 0, background: '#0D1117' }}>
                      <div style={{ padding: 10 }}>
                        <table style={{ width: '100%', fontSize: 11 }}>
                          <thead>
                            <tr style={{ color: colors.muted }}>
                              <th style={{ padding: 4, textAlign: 'left' }}>Data</th>
                              <th style={{ padding: 4, textAlign: 'left' }}>Pornire</th>
                              <th style={{ padding: 4, textAlign: 'left' }}>Oprire</th>
                              <th style={{ padding: 4, textAlign: 'right' }}>Km zi</th>
                              <th style={{ padding: 4, textAlign: 'right' }}>Kilometraj</th>
                              <th style={{ padding: 4, textAlign: 'right' }}>Vit max</th>
                              <th style={{ padding: 4, textAlign: 'right' }}>Consum</th>
                              <th style={{ padding: 4 }}>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {v.daysWithStatus.map((d, j) => (
                              <tr key={j} style={{ opacity: d.is_duplicate ? .5 : 1 }}>
                                <td style={{ padding: 4, color: colors.text }}>{d.data}</td>
                                <td style={{ padding: 4, color: colors.muted }}>{d.ora_inceput || '-'}</td>
                                <td style={{ padding: 4, color: colors.muted }}>{d.ora_sfarsit || '-'}</td>
                                <td style={{ padding: 4, textAlign: 'right', color: colors.text }}>{d.total_km_zi?.toFixed(1) || '-'}</td>
                                <td style={{ padding: 4, textAlign: 'right', color: colors.blue }}>{d.km_sfarsit_zi?.toFixed(0) || '-'}</td>
                                <td style={{ padding: 4, textAlign: 'right', color: colors.muted }}>{d.viteza_maxima_kmh || '-'}</td>
                                <td style={{ padding: 4, textAlign: 'right', color: colors.muted }}>{d.consum_total_normat_l?.toFixed(2) || '-'}L</td>
                                <td style={{ padding: 4, fontSize: 10, color: d.is_duplicate ? colors.muted : colors.green }}>
                                  {d.is_duplicate ? '🔁 DUP' : '✓ NEW'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function UnmatchedTable({ vehicles, assets, assignments, setAssignments, colors }) {
  if (vehicles.length === 0) return <div style={{ color: colors.green, fontSize: 13, padding: 20, textAlign: 'center' }}>✓ Toate vehiculele au match automat.</div>
  return (
    <div style={{ maxHeight: '50vh', overflowY: 'auto' }}>
      <div style={{ fontSize: 12, color: colors.muted, marginBottom: 10, lineHeight: 1.5 }}>
        Vehiculele de mai jos nu au putut fi identificate automat (numele EvoGPS poate fi trunchiat sau format necunoscut). Selectează manual din BD:
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead style={{ position: 'sticky', top: 0, background: '#1C2128' }}>
          <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
            <th style={{ padding: 8, textAlign: 'left', color: colors.muted }}>Nume EvoGPS</th>
            <th style={{ padding: 8, textAlign: 'left', color: colors.muted }}>Nr extras</th>
            <th style={{ padding: 8, textAlign: 'left', color: colors.muted }}>Asignează din BD</th>
            <th style={{ padding: 8, textAlign: 'center', color: colors.muted }}>Zile</th>
          </tr>
        </thead>
        <tbody>
          {vehicles.map((v, i) => (
            <tr key={i} style={{ borderBottom: `1px solid ${colors.border}33` }}>
              <td style={{ padding: 8, color: colors.text }}>{v.evogps_name}</td>
              <td style={{ padding: 8, color: colors.orange, fontFamily: 'monospace' }}>{v.nr_extracted || '(necunoscut)'}</td>
              <td style={{ padding: 8 }}>
                <select
                  value={assignments[v.evogps_name] || ''}
                  onChange={e => setAssignments({ ...assignments, [v.evogps_name]: Number(e.target.value) || null })}
                  style={{ background: '#0D1117', color: colors.text, border: `1px solid ${colors.border}`, padding: '4px 8px', borderRadius: 4, fontSize: 12, minWidth: 280 }}
                >
                  <option value="">— Selectează vehicul —</option>
                  {assets.filter(a => !a.vandut).map(a => (
                    <option key={a.id} value={a.id}>{a.nr_inmatriculare} · {a.marca} {a.model?.slice(0, 30)}</option>
                  ))}
                </select>
              </td>
              <td style={{ padding: 8, textAlign: 'center', color: colors.text, fontWeight: 700 }}>{v.total_days}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function DuplicatesTable({ vehicles, colors }) {
  if (vehicles.length === 0) return <div style={{ color: colors.muted, fontSize: 13, padding: 20, textAlign: 'center' }}>Niciun duplicat — toate zilele vor fi inserate.</div>
  return (
    <div style={{ maxHeight: '50vh', overflowY: 'auto' }}>
      <div style={{ fontSize: 12, color: colors.muted, marginBottom: 10, lineHeight: 1.5 }}>
        Aceste zile sunt deja în BD pentru aceste vehicule (sursa: evogps). Vor fi <strong>SĂRITE</strong> la import:
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead><tr style={{ borderBottom: `1px solid ${colors.border}` }}>
          <th style={{ padding: 8, textAlign: 'left', color: colors.muted }}>Vehicul</th>
          <th style={{ padding: 8, textAlign: 'left', color: colors.muted }}>Zile duplicate</th>
        </tr></thead>
        <tbody>
          {vehicles.map((v, i) => {
            const dups = v.daysWithStatus.filter(d => d.is_duplicate)
            return (
              <tr key={i} style={{ borderBottom: `1px solid ${colors.border}33` }}>
                <td style={{ padding: 8, color: colors.text }}>{v.asset?.nr_inmatriculare} · <span style={{ color: colors.muted }}>{v.evogps_name}</span></td>
                <td style={{ padding: 8, color: colors.muted }}>{dups.map(d => d.data).join(', ')}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
