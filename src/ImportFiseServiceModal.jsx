// ImportFiseServiceModal.jsx — import bulk fișe service istorice (XLSX)
// Format: identic cu exportul ServiceTab.exportExcel (round-trip)
// Match utilaj: cod_intern (exact) → nr_inmatriculare (exact) → fuzzy >= 0.6
// Dedup: skip dacă există fișă (activ_id + data_fisei + numar_factura)
//   sau (activ_id + data_fisei + titlu) când numar_factura lipsește

import { useState, useRef } from 'react'
import * as XLSX from 'xlsx-js-style'

// ── Helpers fuzzy match (același pattern ca ImportEvoGPSModal) ─────────
function normalizeForFuzzy(s) {
  if (!s) return ''
  return String(s).toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ').trim()
}
function fuzzyTokenize(s) {
  return normalizeForFuzzy(s).split(' ').filter(t => t.length >= 2)
}
function fuzzyScore(a, b) {
  const ta = fuzzyTokenize(a), tb = fuzzyTokenize(b)
  if (ta.length === 0 || tb.length === 0) return 0
  const setA = new Set(ta)
  const common = tb.filter(t => setA.has(t)).length
  return common / Math.max(ta.length, tb.length)
}

// ── Date parser ──────────────────────────────────────────────────────────
function parseDate(val) {
  if (!val) return null
  // Excel date number
  if (typeof val === 'number') {
    const d = XLSX.SSF.parse_date_code(val)
    if (d) {
      const month = String(d.m).padStart(2, '0')
      const day = String(d.d).padStart(2, '0')
      return `${d.y}-${month}-${day}`
    }
    return null
  }
  const s = String(val).trim()
  // dd.mm.yyyy / dd/mm/yyyy / dd-mm-yyyy
  const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/)
  if (m) {
    const day = m[1].padStart(2, '0')
    const month = m[2].padStart(2, '0')
    let year = m[3]
    if (year.length === 2) year = '20' + year
    return `${year}-${month}-${day}`
  }
  // yyyy-mm-dd
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  // Try Date.parse
  const d = new Date(s)
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10)
  return null
}

function parseNumber(val) {
  if (val == null || val === '') return null
  if (typeof val === 'number') return val
  const s = String(val).replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '')
  const n = parseFloat(s)
  return isNaN(n) ? null : n
}

function parseInt2(val) {
  const n = parseNumber(val)
  return n == null ? null : Math.round(n)
}

// Parse string „DD.MM.YYYY / NNNH" sau „DD.MM.YYYY / N.NNNH" → { data, ore }
function parseDataOre(val) {
  if (val == null || val === '') return null
  const s = String(val).trim()
  const parts = s.split(/\s*\/\s*/)
  const data = parseDate(parts[0])
  let ore = null
  if (parts[1]) {
    // Extrage doar cifre (ignoră H suffix, ignoră . ca separator mii)
    const digits = parts[1].replace(/[^\d]/g, '')
    ore = digits ? parseInt(digits, 10) : null
    if (isNaN(ore)) ore = null
  }
  return { data, ore }
}

// ── Parser pentru formatul „Carte service utilaj" (2 foi: Mentenanta + Reparatii)
function parseCarteServiceXLSX(wb) {
  const rows = []
  const utilaj = {}  // header utilaj — comun pentru ambele foi
  
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName]
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null })
    
    const sn = sheetName.toLowerCase()
    const tip = (sn.includes('reparatii') || sn.includes('reparații') || sn.includes('reparatie')) 
      ? 'reparatie' : 'mentenanta'
    
    // Parse header utilaj (rândurile 0-15)
    for (let r = 0; r < Math.min(data.length, 16); r++) {
      const row = data[r] || []
      const labelL = String(row[0] || '').toLowerCase()
      const valL = row[2] != null && row[2] !== '' ? row[2] : (row[1] || null)
      const labelR = String(row[5] || '').toLowerCase()
      const valR = row[7] != null && row[7] !== '' ? row[7] : (row[6] || null)
      
      if (labelL.includes('denumire utilaj') && valL) utilaj.denumire = String(valL).trim()
      else if (labelL.startsWith('model') && valL) utilaj.model = String(valL).trim()
      else if (labelL.includes('serie sasiu') && valL) utilaj.serie_sasiu = String(valL).trim()
      else if (labelL.includes('serie motor') && valL) utilaj.serie_motor = String(valL).trim()
      else if (labelL.includes('nr. inmatriculare') && valL) utilaj.nr_inmat = String(valL).trim()
      else if (labelL.includes('inmatriculare') && valL) utilaj.nr_inmat = String(valL).trim()
      
      if (labelR.includes('cod intern') && valR) utilaj.cod_intern = String(valR).trim()
    }
    
    // Caut rândul cu header tabel (conține „Denumire Piesa")
    let tabelHeaderRow = -1
    for (let r = 0; r < Math.min(data.length, 25); r++) {
      const row = data[r] || []
      const text = row.map(c => String(c || '').toLowerCase()).join(' ')
      if (text.includes('denumire piesa') || text.includes('denumire piesă') || text.includes('denumire lucrare')) {
        tabelHeaderRow = r
        break
      }
    }
    if (tabelHeaderRow === -1) continue
    
    // Detectez care sunt coloanele după header (ar trebui să fie: Data, Nr, Denumire, Cod, Cantitate, ...)
    const headerCols = (data[tabelHeaderRow] || []).map(h => normalizeForFuzzy(h))
    const col = {
      data: headerCols.findIndex(h => h === 'data'),
      denumire: headerCols.findIndex(h => h.includes('denumire')),
      cod: headerCols.findIndex(h => h.includes('cod piesa')),
      cantitate: headerCols.findIndex(h => h.includes('cantitate')),
      serv_efectuat: headerCols.findIndex(h => h.includes('service efectuat')),
      serv_de_efectuat: headerCols.findIndex(h => h.includes('service de efectuat')),
      locatie: headerCols.findIndex(h => h.includes('locatie')),
      obs: headerCols.findIndex(h => h === 'obs' || h.includes('observ')),
    }
    
    // Grupez piesele per dată (1 fișă = 1 intervenție = N piese cu aceeași dată)
    const grupuri = new Map()
    for (let r = tabelHeaderRow + 1; r < data.length; r++) {
      const row = data[r] || []
      if (row.every(c => c == null || c === '')) continue
      
      const dataStr = parseDate(col.data >= 0 ? row[col.data] : null)
      const denumirePiesa = col.denumire >= 0 ? String(row[col.denumire] || '').trim() : ''
      if (!dataStr || !denumirePiesa) continue
      
      if (!grupuri.has(dataStr)) {
        grupuri.set(dataStr, { data: dataStr, piese: [], locatie: '', obs: '', ore_intrare: null, data_intrare: null, urmatoarea_ore: null, urmatoarea_data: null })
      }
      const grup = grupuri.get(dataStr)
      
      const cantitate = col.cantitate >= 0 ? String(row[col.cantitate] || '').trim() : ''
      const codPiesa = col.cod >= 0 ? String(row[col.cod] || '').trim() : ''
      grup.piese.push({ denumire: denumirePiesa, cod: codPiesa, cantitate })
      
      // Date/Ore service efectuat (mentenanta) — col 5 = ora curentă la intervenție
      if (col.serv_efectuat >= 0 && row[col.serv_efectuat]) {
        const p = parseDataOre(row[col.serv_efectuat])
        if (p && p.ore != null && !grup.ore_intrare) grup.ore_intrare = p.ore
        if (p && p.data && !grup.data_intrare) grup.data_intrare = p.data
      }
      // Date/Ore service DE efectuat (următoarea revizie) — col 6
      if (col.serv_de_efectuat >= 0 && row[col.serv_de_efectuat]) {
        const p = parseDataOre(row[col.serv_de_efectuat])
        if (p && p.ore != null && !grup.urmatoarea_ore) grup.urmatoarea_ore = p.ore
        if (p && p.data && !grup.urmatoarea_data) grup.urmatoarea_data = p.data
      }
      // Locatie
      if (col.locatie >= 0 && row[col.locatie] && !grup.locatie) {
        grup.locatie = String(row[col.locatie]).trim()
      }
      // Observații
      if (col.obs >= 0 && row[col.obs]) {
        const o = String(row[col.obs]).trim()
        if (o) grup.obs = grup.obs ? grup.obs + ' · ' + o : o
      }
    }
    
    // Construiesc fișele finale
    for (const grup of grupuri.values()) {
      const titlu = tip === 'mentenanta'
        ? (grup.ore_intrare ? `Revizie ${grup.ore_intrare}H — ${grup.piese.length} piese` : `Mentenanță — ${grup.piese.length} piese`)
        : (grup.piese[0]?.denumire ? `${grup.piese[0].denumire}${grup.piese.length > 1 ? ` + ${grup.piese.length - 1} piese` : ''}` : 'Reparație')
      const diagnostic = grup.piese
        .map(p => `${p.denumire}${p.cantitate ? ' ×' + p.cantitate : ''}${p.cod ? ' [' + p.cod + ']' : ''}`)
        .join(' · ')
      
      // Match utilaj — punem cod_intern dacă există, altfel folosim denumirea/modelul ca placuta (fuzzy match)
      const nrInmat = utilaj.nr_inmat && !['NU ARE', 'NUARE', '-'].includes(utilaj.nr_inmat.toUpperCase()) 
        ? utilaj.nr_inmat : ''
      const fallbackId = utilaj.denumire || utilaj.model || ''
      
      rows.push({
        raw_row: 0,
        data_fisei: grup.data,
        cod_tst: utilaj.cod_intern || '',
        placuta: nrInmat || fallbackId,
        tip,
        status: 'finalizat',
        titlu,
        locatie_service: grup.locatie || '',
        numar_factura: '',
        suma_factura: null,
        manopera: null,
        km_intrare: null,
        km_iesire: null,
        ore_intrare: grup.ore_intrare,
        ore_iesire: null,
        diagnostic_lucrari: diagnostic,
        urmatoarea_km: null,
        urmatoarea_ore: grup.urmatoarea_ore,
        urmatoarea_data: grup.urmatoarea_data,
        observatii: grup.obs || '',
      })
    }
  }
  return rows
}

// ── Parser XLSX ──────────────────────────────────────────────────────────
async function parseXLSX(file) {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  
  // Detectare format „Carte service utilaj" (foi Mentenanta + Reparatii)
  const sheetNames = wb.SheetNames.map(s => s.toLowerCase())
  const isCarteService = sheetNames.some(s => 
    s.includes('mentenanta') || s.includes('mentenanță') || 
    s.includes('reparatii') || s.includes('reparații') || s.includes('reparatie')
  )
  if (isCarteService) {
    const rows = parseCarteServiceXLSX(wb)
    if (rows.length === 0) throw new Error('Format „Carte service" detectat, dar fără intervenții valide (verifică datele și piesele).')
    return rows
  }
  
  // Format standard - tabel cu coloane Data + Cod TST/Plăcuță
  const ws = wb.Sheets[wb.SheetNames[0]]
  if (!ws) throw new Error('Foaie Excel goală')
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null })
  // Caut rândul de header (conține „Cod TST" sau „Plăcuță" sau „Data")
  let headerRow = -1
  for (let i = 0; i < Math.min(data.length, 10); i++) {
    const row = data[i] || []
    const text = row.map(c => String(c || '').toLowerCase()).join(' ')
    if ((text.includes('data') && (text.includes('cod') || text.includes('plăcuță') || text.includes('placuta'))) ||
        text.includes('cod tst')) {
      headerRow = i
      break
    }
  }
  if (headerRow === -1) throw new Error('Nu am găsit rândul de header. Asigură-te că Excel-ul conține coloane Data, Cod TST / Plăcuță.')
  
  const header = (data[headerRow] || []).map(h => normalizeForFuzzy(h))
  
  // Mapare numele coloanei → index
  const findCol = (...candidates) => {
    for (const cand of candidates) {
      const norm = normalizeForFuzzy(cand)
      const idx = header.findIndex(h => h === norm || h.includes(norm))
      if (idx !== -1) return idx
    }
    return -1
  }
  
  const cols = {
    data: findCol('data'),
    cod_tst: findCol('cod tst', 'cod intern', 'cod'),
    placuta: findCol('placuta', 'plăcuță', 'nr inmatriculare', 'numar inmatriculare'),
    tip: findCol('tip'),
    status: findCol('status'),
    titlu: findCol('titlu', 'denumire'),
    locatie: findCol('locatie', 'locație', 'locatie service', 'service'),
    nr_factura: findCol('nr factura', 'numar factura', 'factura'),
    suma: findCol('suma', 'sumă', 'suma ron', 'total'),
    manopera: findCol('manopera', 'manoperă'),
    km_in: findCol('km in', 'km intrare'),
    km_out: findCol('km out', 'km iesire', 'km ieșire'),
    ore_in: findCol('ore in', 'ore intrare'),
    ore_out: findCol('ore out', 'ore iesire', 'ore ieșire'),
    diagnostic: findCol('diagnostic', 'lucrari', 'lucrări', 'interventie', 'intervenție', 'descriere'),
    urm_km: findCol('urmator km', 'următor km', 'urm km'),
    urm_ore: findCol('urmator ore', 'următor ore', 'urm ore'),
    urm_data: findCol('urmator data', 'următor data', 'urm data'),
    observatii: findCol('observatii', 'observații'),
  }
  
  if (cols.data === -1) throw new Error('Coloana „Data" lipsește.')
  if (cols.cod_tst === -1 && cols.placuta === -1) throw new Error('Trebuie cel puțin una din coloanele „Cod TST" sau „Plăcuță".')
  
  // Parse rânduri de la headerRow + 1
  const rows = []
  for (let i = headerRow + 1; i < data.length; i++) {
    const row = data[i] || []
    if (row.length === 0 || row.every(c => c == null || c === '')) continue
    
    const dataFisei = parseDate(cols.data >= 0 ? row[cols.data] : null)
    if (!dataFisei) continue  // skip rânduri fără dată
    
    const codTST = cols.cod_tst >= 0 ? String(row[cols.cod_tst] || '').trim() : ''
    const placuta = cols.placuta >= 0 ? String(row[cols.placuta] || '').trim() : ''
    if (!codTST && !placuta) continue  // fără identificator vehicul
    
    rows.push({
      raw_row: i + 1,
      data_fisei: dataFisei,
      cod_tst: codTST,
      placuta: placuta,
      tip: cols.tip >= 0 ? String(row[cols.tip] || '').trim().toLowerCase() : '',
      status: cols.status >= 0 ? String(row[cols.status] || '').trim().toLowerCase() : '',
      titlu: cols.titlu >= 0 ? String(row[cols.titlu] || '').trim() : '',
      locatie_service: cols.locatie >= 0 ? String(row[cols.locatie] || '').trim() : '',
      numar_factura: cols.nr_factura >= 0 ? String(row[cols.nr_factura] || '').trim() : '',
      suma_factura: cols.suma >= 0 ? parseNumber(row[cols.suma]) : null,
      manopera: cols.manopera >= 0 ? parseNumber(row[cols.manopera]) : null,
      km_intrare: cols.km_in >= 0 ? parseInt2(row[cols.km_in]) : null,
      km_iesire: cols.km_out >= 0 ? parseInt2(row[cols.km_out]) : null,
      ore_intrare: cols.ore_in >= 0 ? parseInt2(row[cols.ore_in]) : null,
      ore_iesire: cols.ore_out >= 0 ? parseInt2(row[cols.ore_out]) : null,
      diagnostic_lucrari: cols.diagnostic >= 0 ? String(row[cols.diagnostic] || '').trim() : '',
      urmatoarea_km: cols.urm_km >= 0 ? parseInt2(row[cols.urm_km]) : null,
      urmatoarea_ore: cols.urm_ore >= 0 ? parseInt2(row[cols.urm_ore]) : null,
      urmatoarea_data: cols.urm_data >= 0 ? parseDate(row[cols.urm_data]) : null,
      observatii: cols.observatii >= 0 ? String(row[cols.observatii] || '').trim() : '',
    })
  }
  return rows
}

// ── Template Excel pentru download ──────────────────────────────────────
function downloadTemplate() {
  const header = ['Data', 'Cod TST', 'Plăcuță', 'Tip', 'Status', 'Titlu', 'Locație', 'Nr. factură', 'Sumă (RON)', 'Manoperă (RON)', 'KM in', 'KM out', 'Ore in', 'Ore out', 'Diagnostic', 'Următor KM', 'Următor Ore', 'Următor data', 'Observații']
  const sample = [
    ['15.03.2025', 'TST020', '', 'mentenanta', 'finalizat', 'Revizie 5000h', 'KIKI&DANI', '12345', 2500, 800, '', '', 6700, 6705, 'Schimb ulei motor + filtre', '', 7200, '15.09.2025', ''],
    ['22.04.2025', '', 'PH 22 ABC', 'reparatie', 'finalizat', 'Înlocuit alternator', 'AUTOCOS', '67890', 1800, 500, 145000, 145001, '', '', 'Alternator defect, înlocuit cu unul nou', 160000, '', '', 'Garanție 6 luni'],
  ]
  const aoa = [
    ['Template Import Fișe Service — completează rândurile, apoi importă în PontajPRO'],
    ['Coloane obligatorii: Data + (Cod TST SAU Plăcuță). Restul opțional.'],
    [],
    header,
    ...sample,
  ]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = header.map(h => ({ wch: Math.max(h.length + 2, 12) }))
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: header.length - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: header.length - 1 } },
  ]
  if (ws['A1']) ws['A1'].s = { font: { bold: true, sz: 14, color: { rgb: 'E3B341' } } }
  if (ws['A2']) ws['A2'].s = { font: { italic: true, sz: 10, color: { rgb: '8B949E' } } }
  header.forEach((_, c) => {
    const a = XLSX.utils.encode_cell({ r: 3, c })
    if (ws[a]) ws[a].s = { fill: { fgColor: { rgb: '1F2937' } }, font: { bold: true, color: { rgb: 'E3B341' }, sz: 10 }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true } }
  })
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Fișe Service')
  XLSX.writeFile(wb, `Template_Import_Fise_Service.xlsx`)
}

// ════════════════════════════════════════════════════════════════════════
export default function ImportFiseServiceModal({ open, onClose, supabase, profile, onSuccess, G, S }) {
  const [step, setStep] = useState('upload')  // upload | preview | done
  const [file, setFile] = useState(null)
  const [parsing, setParsing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState(null)
  const [parsedRows, setParsedRows] = useState([])
  const [matched, setMatched] = useState([])
  const [unmatched, setUnmatched] = useState([])
  const [duplicates, setDuplicates] = useState([])
  const [tab, setTab] = useState('matched')
  const [doneStats, setDoneStats] = useState(null)
  const inputRef = useRef()
  
  if (!open) return null
  
  const reset = () => {
    setStep('upload'); setFile(null); setError(null)
    setParsedRows([]); setMatched([]); setUnmatched([]); setDuplicates([])
    setDoneStats(null); setTab('matched')
  }
  const close = () => { reset(); onClose() }
  
  const handleFileSelect = async (f) => {
    if (!f) return
    setFile(f); setParsing(true); setError(null)
    try {
      const rows = await parseXLSX(f)
      if (rows.length === 0) throw new Error('Niciun rând valid în Excel (verifică Data + Cod TST/Plăcuță).')
      
      // Fetch toate activele pentru match
      const { data: assets, error: errAssets } = await supabase
        .from('logistica_active')
        .select('id, cod_intern, nr_inmatriculare, marca, model, deep_sleep, vandut')
      if (errAssets) throw errAssets
      
      // Fetch fișe existente pentru dedup (data + activ_id + nr_factura/titlu)
      const { data: existing, error: errEx } = await supabase
        .from('logistica_service_fise')
        .select('activ_id, data_fisei, numar_factura, titlu')
      if (errEx) throw errEx
      
      const existingKey = new Set(existing.map(e => {
        const k1 = `${e.activ_id}__${e.data_fisei}__nf:${e.numar_factura || ''}`
        return k1
      }))
      const existingKeyTitlu = new Set(existing.map(e => {
        const k2 = `${e.activ_id}__${e.data_fisei}__t:${(e.titlu || '').toLowerCase()}`
        return k2
      }))
      
      const mat = [], unm = [], dup = []
      for (const r of rows) {
        let asset = null
        // 1. Exact cod_intern
        if (r.cod_tst) {
          asset = assets.find(a => a.cod_intern && a.cod_intern.toLowerCase() === r.cod_tst.toLowerCase())
        }
        // 2. Exact nr_inmatriculare (normalizat)
        if (!asset && r.placuta) {
          const placNorm = r.placuta.replace(/\s+/g, '').toLowerCase()
          asset = assets.find(a => a.nr_inmatriculare && a.nr_inmatriculare.replace(/\s+/g, '').toLowerCase() === placNorm)
        }
        // 3. Fuzzy fallback pe placuta+cod
        if (!asset) {
          const needle = `${r.cod_tst} ${r.placuta}`.trim()
          let best = null, bestScore = 0
          for (const a of assets) {
            if (a.deep_sleep || a.vandut) continue
            const haystack = `${a.cod_intern || ''} ${a.nr_inmatriculare || ''} ${a.marca || ''} ${a.model || ''}`
            const score = fuzzyScore(needle, haystack)
            if (score > bestScore && score >= 0.6) {
              best = a; bestScore = score
            }
          }
          if (best) asset = best
        }
        
        if (!asset) { unm.push(r); continue }
        
        // Dedup
        const key1 = `${asset.id}__${r.data_fisei}__nf:${r.numar_factura || ''}`
        const key2 = `${asset.id}__${r.data_fisei}__t:${(r.titlu || '').toLowerCase()}`
        if ((r.numar_factura && existingKey.has(key1)) || (r.titlu && existingKeyTitlu.has(key2))) {
          dup.push({ ...r, asset })
          continue
        }
        
        mat.push({ ...r, asset })
      }
      
      setParsedRows(rows)
      setMatched(mat)
      setUnmatched(unm)
      setDuplicates(dup)
      setStep('preview')
    } catch (e) {
      console.error(e)
      setError(e.message || 'Eroare la parsare Excel')
    } finally {
      setParsing(false)
    }
  }
  
  const executeImport = async () => {
    if (matched.length === 0) { setError('Niciun rând de importat'); return }
    setImporting(true); setError(null)
    try {
      // Obținem user-ul curent pentru created_by / finalizat_by
      const { data: { user } } = await supabase.auth.getUser()
      const userId = user?.id || profile?.id || null
      
      // Normalizez tip + status
      const validTipuri = ['mentenanta', 'reparatie']
      const validStatusuri = ['programat', 'in_lucru', 'finalizat']
      
      const records = matched.map(r => {
        let tip = (r.tip || '').toLowerCase()
        if (tip === 'mentenanță' || tip === 'mentenanță') tip = 'mentenanta'
        if (tip === 'reparație') tip = 'reparatie'
        if (!validTipuri.includes(tip)) tip = 'mentenanta'
        
        let status = (r.status || '').toLowerCase()
        if (status === 'în lucru' || status === 'in lucru') status = 'in_lucru'
        if (!validStatusuri.includes(status)) {
          // Default: dacă fișa e veche cu sumă/diagnostic → finalizat, altfel programat
          status = (r.suma_factura || r.diagnostic_lucrari || r.numar_factura) ? 'finalizat' : 'programat'
        }
        
        const finalizat_at = status === 'finalizat' ? new Date(r.data_fisei + 'T12:00:00').toISOString() : null
        const finalizat_by = status === 'finalizat' ? userId : null
        
        return {
          activ_id: r.asset.id,
          data_fisei: r.data_fisei,
          tip,
          status,
          titlu: r.titlu || null,
          locatie_service: r.locatie_service || null,
          numar_factura: r.numar_factura || null,
          suma_factura: r.suma_factura,
          manopera: r.manopera,
          km_intrare: r.km_intrare,
          km_iesire: r.km_iesire,
          ore_intrare: r.ore_intrare,
          ore_iesire: r.ore_iesire,
          diagnostic_lucrari: r.diagnostic_lucrari || null,
          urmatoarea_data: r.urmatoarea_data,
          urmatoarea_km: r.urmatoarea_km,
          urmatoarea_ore: r.urmatoarea_ore,
          observatii: r.observatii || null,
          created_by: userId,
          finalizat_at,
          finalizat_by,
        }
      })
      
      // INSERT bulk (Supabase suportă chunk-uri mari, dar le sparg la 200 just in case)
      const chunkSize = 200
      let inserted = 0
      for (let i = 0; i < records.length; i += chunkSize) {
        const chunk = records.slice(i, i + chunkSize)
        const { error: errIns } = await supabase.from('logistica_service_fise').insert(chunk)
        if (errIns) throw errIns
        inserted += chunk.length
      }
      
      setDoneStats({
        inserted,
        skipped_unmatched: unmatched.length,
        skipped_duplicate: duplicates.length,
        total: parsedRows.length,
      })
      setStep('done')
      if (onSuccess) onSuccess(inserted)
    } catch (e) {
      console.error(e)
      setError('Eroare la import: ' + (e.message || e))
    } finally {
      setImporting(false)
    }
  }
  
  // ── UI ──────────────────────────────────────────────────────────────
  const colors = G
  
  return (
    <div onClick={close} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.78)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 14,
        maxWidth: 980, width: '100%', maxHeight: '92vh', overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{
          padding: '14px 18px', borderBottom: `1px solid ${colors.border}`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: colors.text }}>📥 Import fișe service (XLSX)</div>
            <div style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>
              Pentru istoric — fișe vechi cu KM, ore, intervenții. Format identic cu exportul.
            </div>
          </div>
          <button onClick={close} style={{ background: 'transparent', color: colors.muted, border: 'none', fontSize: 22, cursor: 'pointer', padding: 4 }}>✕</button>
        </div>
        
        {/* Step indicator */}
        <div style={{ display: 'flex', padding: '8px 18px', gap: 8, borderBottom: `1px solid ${colors.border}`, fontSize: 12 }}>
          {['upload', 'preview', 'done'].map(s => {
            const labels = { upload: '1. Upload', preview: '2. Preview', done: '3. Done' }
            const active = step === s
            return (
              <div key={s} style={{
                padding: '4px 10px', borderRadius: 6,
                background: active ? colors.logistica + '22' : 'transparent',
                color: active ? colors.logistica : colors.muted,
                fontWeight: active ? 700 : 500,
              }}>{labels[s]}</div>
            )
          })}
        </div>
        
        {/* Body */}
        <div style={{ flex: 1, overflow: 'auto', padding: 18 }}>
          {error && (
            <div style={{
              padding: '10px 14px', borderRadius: 6, marginBottom: 12,
              background: colors.red + '15', border: `1px solid ${colors.red}55`,
              color: colors.red, fontSize: 12,
            }}>❌ {error}</div>
          )}
          
          {step === 'upload' && (
            <div>
              <div style={{
                padding: 28, border: `2px dashed ${colors.border2}`, borderRadius: 10,
                background: colors.bg, textAlign: 'center', marginBottom: 14,
                cursor: parsing ? 'wait' : 'pointer',
              }}
              onClick={() => !parsing && inputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault() }}
              onDrop={(e) => {
                e.preventDefault()
                if (parsing) return
                const f = e.dataTransfer.files?.[0]
                if (f) handleFileSelect(f)
              }}>
                <div style={{ fontSize: 38, marginBottom: 8 }}>{parsing ? '⏳' : '📄'}</div>
                <div style={{ fontSize: 14, color: colors.text, fontWeight: 600, marginBottom: 4 }}>
                  {parsing ? 'Procesare fișier...' : 'Trage fișierul XLSX aici sau apasă pentru a alege'}
                </div>
                <div style={{ fontSize: 11, color: colors.muted }}>
                  Format acceptat: Excel (XLSX) cu coloane Data, Cod TST sau Plăcuță
                </div>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  style={{ display: 'none' }}
                  onChange={(e) => handleFileSelect(e.target.files?.[0])}
                />
              </div>
              
              <div style={{
                padding: '12px 14px', background: colors.blue + '10',
                border: `1px solid ${colors.blue}33`, borderRadius: 8, marginBottom: 12,
              }}>
                <div style={{ fontSize: 12, color: colors.text, fontWeight: 700, marginBottom: 6 }}>📋 Coloane așteptate:</div>
                <div style={{ fontSize: 11, color: colors.muted, lineHeight: 1.6 }}>
                  <strong style={{ color: colors.text }}>Obligatorii:</strong> Data + (Cod TST SAU Plăcuță)<br/>
                  <strong style={{ color: colors.text }}>Recomandate:</strong> Tip (mentenanta/reparatie), Titlu, Diagnostic, KM in/out, Ore in/out, Sumă, Manoperă<br/>
                  <strong style={{ color: colors.text }}>Opționale:</strong> Status, Locație, Nr. factură, Următor KM/Ore/data, Observații
                </div>
                <div style={{ fontSize: 11, color: colors.muted, marginTop: 8, fontStyle: 'italic' }}>
                  💡 Dacă status NU e completat: fișa cu sumă/diagnostic devine „finalizat", restul „programat".
                </div>
              </div>
              
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                <button onClick={downloadTemplate} style={{
                  background: 'transparent', color: colors.logistica,
                  border: `1px solid ${colors.logistica}55`, borderRadius: 8,
                  padding: '8px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                }}>📥 Descarcă template Excel</button>
                <div style={{ fontSize: 11, color: colors.muted, fontStyle: 'italic' }}>
                  Recomandat: descarcă întâi un export curent, șterge fișele și completează cu cele vechi.
                </div>
              </div>
            </div>
          )}
          
          {step === 'preview' && (
            <div>
              {/* Stats */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 14 }}>
                <StatBox title="✓ Matched" value={matched.length} sub="vor fi importate" color={colors.green} colors={colors} />
                <StatBox title="⚠ Nematche" value={unmatched.length} sub="cod/placă necunoscute" color={colors.orange} colors={colors} />
                <StatBox title="🔁 Duplicate" value={duplicates.length} sub="există deja în BD" color={colors.muted} colors={colors} />
                <StatBox title="📊 Total" value={parsedRows.length} sub="rânduri în fișier" color={colors.blue} colors={colors} />
              </div>
              
              {/* Tabs */}
              <div style={{ display: 'flex', gap: 0, borderBottom: `1px solid ${colors.border}`, marginBottom: 10 }}>
                {['matched', 'unmatched', 'duplicate'].map(t => {
                  const labels = { matched: '✓ Matched', unmatched: '⚠ Nematche', duplicate: '🔁 Duplicate' }
                  const counts = { matched: matched.length, unmatched: unmatched.length, duplicate: duplicates.length }
                  return (
                    <button key={t} onClick={() => setTab(t)} style={{
                      background: 'transparent', border: 'none', padding: '8px 14px',
                      color: tab === t ? colors.logistica : colors.muted,
                      borderBottom: tab === t ? `2px solid ${colors.logistica}` : '2px solid transparent',
                      cursor: 'pointer', fontSize: 12, fontWeight: 700,
                    }}>{labels[t]} ({counts[t]})</button>
                  )
                })}
              </div>
              
              {/* Tabel */}
              <div style={{ maxHeight: 360, overflow: 'auto', border: `1px solid ${colors.border}`, borderRadius: 6 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                  <thead style={{ background: colors.bg, position: 'sticky', top: 0 }}>
                    <tr>
                      <th style={thS(colors)}>Data</th>
                      <th style={thS(colors)}>{tab === 'unmatched' ? 'Cod/Plăcuță' : 'Utilaj'}</th>
                      <th style={thS(colors)}>Titlu</th>
                      <th style={thS(colors)}>Tip</th>
                      <th style={thS(colors)}>Sumă</th>
                      <th style={thS(colors)}>KM in/out</th>
                      <th style={thS(colors)}>Ore in/out</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(tab === 'matched' ? matched : tab === 'unmatched' ? unmatched : duplicates).slice(0, 200).map((r, i) => (
                      <tr key={i} style={{ borderBottom: `1px solid ${colors.border}` }}>
                        <td style={tdS(colors)}>{r.data_fisei}</td>
                        <td style={tdS(colors)}>
                          {tab === 'unmatched'
                            ? <span style={{ color: colors.orange }}>{r.cod_tst || r.placuta || '—'}</span>
                            : <span>{r.asset?.cod_intern || r.asset?.nr_inmatriculare}<br/><span style={{ fontSize: 9, color: colors.muted }}>{r.asset?.marca} {r.asset?.model}</span></span>
                          }
                        </td>
                        <td style={tdS(colors)}>{r.titlu || <span style={{ color: colors.dim }}>—</span>}</td>
                        <td style={tdS(colors)}>{r.tip || <span style={{ color: colors.dim }}>—</span>}</td>
                        <td style={tdS(colors)}>{r.suma_factura ? `${r.suma_factura.toLocaleString('ro-RO')}` : <span style={{ color: colors.dim }}>—</span>}</td>
                        <td style={tdS(colors)}>{(r.km_intrare || r.km_iesire) ? `${r.km_intrare || '—'} / ${r.km_iesire || '—'}` : <span style={{ color: colors.dim }}>—</span>}</td>
                        <td style={tdS(colors)}>{(r.ore_intrare || r.ore_iesire) ? `${r.ore_intrare || '—'} / ${r.ore_iesire || '—'}` : <span style={{ color: colors.dim }}>—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {(tab === 'matched' ? matched : tab === 'unmatched' ? unmatched : duplicates).length > 200 && (
                  <div style={{ padding: 8, textAlign: 'center', color: colors.muted, fontSize: 10, fontStyle: 'italic' }}>
                    Afișate primele 200 rânduri. Restul vor fi procesate la import.
                  </div>
                )}
              </div>
            </div>
          )}
          
          {step === 'done' && doneStats && (
            <div style={{ textAlign: 'center', padding: 20 }}>
              <div style={{ fontSize: 56, marginBottom: 12 }}>✅</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: colors.green, marginBottom: 14 }}>
                Import finalizat
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginTop: 14 }}>
                <StatBox title="✓ Inserate" value={doneStats.inserted} sub="fișe noi" color={colors.green} colors={colors} />
                <StatBox title="⚠ Nematche" value={doneStats.skipped_unmatched} sub="omise" color={colors.orange} colors={colors} />
                <StatBox title="🔁 Duplicate" value={doneStats.skipped_duplicate} sub="omise" color={colors.muted} colors={colors} />
              </div>
            </div>
          )}
        </div>
        
        {/* Footer */}
        <div style={{
          padding: '12px 18px', borderTop: `1px solid ${colors.border}`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
        }}>
          <div style={{ fontSize: 11, color: colors.muted }}>
            {step === 'preview' && `${matched.length} fișe vor fi importate`}
            {step === 'upload' && file && `📁 ${file.name} (${(file.size / 1024).toFixed(0)} KB)`}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {step === 'preview' && (
              <button onClick={() => { reset() }} style={{ ...S.btnS }}>← Înapoi</button>
            )}
            <button onClick={close} style={{ ...S.btnS }}>
              {step === 'done' ? 'Închide' : 'Anulează'}
            </button>
            {step === 'preview' && matched.length > 0 && (
              <button onClick={executeImport} disabled={importing} style={{
                ...S.btnP, background: colors.green, color: '#000',
                opacity: importing ? 0.5 : 1, cursor: importing ? 'wait' : 'pointer',
              }}>
                {importing ? '⏳ Import în curs...' : `✓ Importă ${matched.length} fișe`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Helpers UI ──────────────────────────────────────────────────────────
function StatBox({ title, value, sub, color, colors }) {
  return (
    <div style={{
      padding: 10, background: colors.bg, border: `1px solid ${colors.border}`,
      borderRadius: 8, borderLeft: `3px solid ${color}`,
    }}>
      <div style={{ fontSize: 10, color: colors.muted, marginBottom: 2 }}>{title}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color }}>{value}</div>
      <div style={{ fontSize: 10, color: colors.muted, marginTop: 2 }}>{sub}</div>
    </div>
  )
}

const thS = (c) => ({ padding: '7px 8px', fontSize: 10, color: c.muted, fontWeight: 700, textAlign: 'left', textTransform: 'uppercase', letterSpacing: '.3px', borderBottom: `1px solid ${c.border}` })
const tdS = (c) => ({ padding: '7px 8px', fontSize: 11, color: c.text, verticalAlign: 'top' })
