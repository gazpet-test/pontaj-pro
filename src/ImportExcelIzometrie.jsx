// ===========================================================================
// IMPORT EXCEL IZOMETRIE — Centralizator Transgaz → executie_tevi
// ===========================================================================
// 21.05.2026 — FAZA 2 sub-faza B:
//   • Parser xlsx pentru sheet CENTRALIZATOR (header R12, date R14+)
//   • Detectare automată tip_rand: teava / curba / legare / separator
//   • Normalizare CCC→CIC silent + log în import_metadata JSONB
//   • Sufix R pe sudură → sudura_refacuta=true
//   • Auto-flag sudura_sant_pending din OBS „SUDURA SE REALIZEAZA IN SANT"
//   • Pre-check conflicte serie cross-proiect + sudură cross-tronson
//   • Opțiuni: include separator-urile, APPEND vs REPLACE, override cod pachet
//   • INSERT batched 50 rânduri/batch cu progress bar
// Necesită: xlsx-js-style (deja în deps Gazpet ERP)
// ===========================================================================

import { useState, useRef, useMemo, useEffect } from 'react'
import * as XLSX from 'xlsx-js-style'
import { supabase } from './lib/supabase.js'

// Theme G consistent cu Izometrie.jsx
const G = {
  bg:'#0D1117', surface:'#161B22', card:'#161B22', text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  border:'#30363D', border2:'#21262D',
  blue:'#1F6FEB', green:'#2EA043', yellow:'#D29922', orange:'#F0883E', red:'#F85149',
  purple:'#A371F7',
  purpleDim:'#1F1530', greenDim:'#0F2A1E', redDim:'#3F1A1F', yellowDim:'#332100',
}

const S = {
  input: { width:'100%', background:G.bg, border:`1px solid ${G.border}`, borderRadius:8, padding:'9px 12px', color:G.text, fontSize:13, outline:'none' },
  btnP: { padding:'9px 16px', background:G.purple, color:'#fff', border:'none', borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:600 },
  btnS: { padding:'9px 16px', background:G.surface, color:G.text, border:`1px solid ${G.border}`, borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:500 },
  badge: { display:'inline-block', padding:'2px 8px', borderRadius:6, fontSize:11, fontWeight:600 },
}

// ===========================================================================
// HELPERS PARSER
// ===========================================================================

// Verifică dacă o valoare e „efectiv goală" (null, '', '0', '·')
const isEmpty = (v) => {
  if (v === null || v === undefined) return true
  const s = String(v).trim()
  return s === '' || s === '0' || s === '·'
}

// Detect tip_rand bazat pe pattern celule
function classifyTipRand(serie, tip, cant, sudura) {
  const has_serie = !isEmpty(serie)
  const has_tip = !isEmpty(tip)
  const has_cant = cant != null && Number(cant) > 0
  const has_sudura = !isEmpty(sudura)

  // Total gol = separator (gap mozaic)
  if (!has_serie && !has_tip && !has_cant && !has_sudura) return 'separator'
  // Doar sudura prezent (serie+tip+cant goale) = legare cap-la-cap
  if (!has_serie && !has_tip && !has_cant && has_sudura) return 'legare'
  // Tip ≠ L* = curbă (CIC, CCC)
  if (has_tip && !String(tip).toUpperCase().startsWith('L')) return 'curba'
  return 'teava'
}

// Parse sudură cu sufix R (T7S96R → cod=T7S96, refacuta=true)
function parseSuduraCell(raw) {
  if (isEmpty(raw)) return { cod: null, refacuta: false }
  const s = String(raw).trim()
  if (s.endsWith('R')) return { cod: s.slice(0, -1).trim(), refacuta: true }
  return { cod: s, refacuta: false }
}

// Extract unghi din DIMENSIUNE (suportă ° U+00B0 și ˚ U+02DA)
function extractUnghi(dim) {
  if (isEmpty(dim)) return null
  const m = String(dim).match(/(\d+)\s*[°˚]/)
  return m ? `${m[1]}°` : null
}

// Normalize POZ KM raw (text) → meters integer
function normalizePozKm(raw) {
  if (isEmpty(raw)) return null
  const s = String(raw).trim()
  const m = s.match(/(\d+)\s*\+\s*([\d.]+)/)
  if (m) {
    const km = parseInt(m[1], 10)
    const rest = parseFloat(m[2])
    if (!isNaN(km) && !isNaN(rest)) return Math.round(km * 1000 + rest)
  }
  // Doar număr — interpretat ca metri
  const n = Number(s)
  if (!isNaN(n) && n > 0) return Math.round(n)
  return null
}

// Parser principal — primește workbook → returnează { rows, summary }
function parseCentralizator(workbook) {
  const sheet = workbook.Sheets['CENTRALIZATOR']
  if (!sheet) {
    throw new Error('Excel-ul nu conține sheet-ul "CENTRALIZATOR". Verificați formatul.')
  }

  // Determine range
  const ref = sheet['!ref'] || 'A1:O500'
  const range = XLSX.utils.decode_range(ref)

  // Validare header R12 (rândul 12 1-indexed = row 11 zero-indexed)
  const headerR12C1 = sheet['A12']
  const headerR12C7 = sheet['G12']
  if (!headerR12C1 || !String(headerR12C1.v).toUpperCase().includes('POZ')) {
    throw new Error('Header R12 nu corespunde formatului Transgaz (lipsește "POZ." în A12)')
  }
  if (!headerR12C7 || !String(headerR12C7.v).toUpperCase().includes('CANT')) {
    throw new Error('Header R12 nu corespunde formatului Transgaz (lipsește "CANT." în G12)')
  }

  // Citire rânduri R14 → R(maxRow)
  const rows = []
  let lastRealRow = 13 // 0-indexed, deci R14
  const codCounts = {}
  const tronsonCounts = {}
  const cccCorrections = []
  let separatorsCount = 0
  let teavaCount = 0, curbaCount = 0, legareCount = 0, pendingCount = 0
  let totalLungime = 0

  for (let r = 13; r <= range.e.r; r++) { // r=13 → R14
    const get = (c) => {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })]
      return cell ? cell.v : null
    }
    const poz = get(0)
    const lot = get(1)
    const serie = get(2)
    const tipRaw = get(3)
    const dimRaw = get(4)
    const sarja = get(5)
    const cantRaw = get(6)
    const tronsonRaw = get(7)
    const pozKmRaw = get(8)
    const suduraRaw = get(9)
    const pm = get(10)
    const paUt = get(11)
    const ut = get(12)
    const docRaw = get(13)
    const obs = get(14)

    // Verifică dacă rândul are vreo dată reală (orice celulă non-empty)
    const allEmpty = isEmpty(poz) && isEmpty(serie) && isEmpty(tipRaw) && isEmpty(suduraRaw) && isEmpty(obs)

    // Skip rânduri care nu sunt rânduri de date (gap final after R353)
    // Detectăm sfârșit: 5 rânduri consecutive total goale după R14
    if (allEmpty && r > 14) {
      // continuă să citim chiar dacă sunt separator-uri (uneori sunt sute consecutive)
      // dar dacă atingem capătul foii (după rândul 360 nimic), oprim
    }
    if (allEmpty && r > 360) break

    const tipRand = classifyTipRand(serie, tipRaw, cantRaw, suduraRaw)

    if (tipRand === 'separator') {
      separatorsCount++
      rows.push({
        _row: r + 1,
        tip_rand: 'separator',
        lot: null, serie_unica: null, tip: null, dimensiune: null, sarja: null,
        lungime_m: null, sudura_cod: null, sudura_refacuta: false, sudura_sant_pending: false,
        pm_cod: null, pa_ut_cod: null, ut_cod: null,
        observatii: null, unghi_curba: null, import_metadata: null,
        _raw_poz_km: null,
      })
      continue
    }

    lastRealRow = r

    // Counts pe cod doc + tronson
    if (!isEmpty(docRaw)) {
      const d = String(docRaw).trim()
      codCounts[d] = (codCounts[d] || 0) + 1
    }
    if (!isEmpty(tronsonRaw)) {
      // Normalize TR1 → T1
      const t = String(tronsonRaw).trim().replace(/^TR/i, 'T')
      tronsonCounts[t] = (tronsonCounts[t] || 0) + 1
    }

    // Parse sudură + R suffix
    const sudParsed = parseSuduraCell(suduraRaw)

    // Detect pending șanț: serie + lungime > 0 + sudură empty + obs cu „SANT"
    let pending = false
    if (tipRand === 'teava' && !isEmpty(serie) && cantRaw && Number(cantRaw) > 0 && isEmpty(suduraRaw)) {
      const obsUpper = isEmpty(obs) ? '' : String(obs).toUpperCase()
      if (obsUpper.includes('SANT') || obsUpper.includes('ȘANȚ')) {
        pending = true
        pendingCount++
      }
    }

    // Normalize tip (CCC → CIC + log)
    let tip = isEmpty(tipRaw) ? null : String(tipRaw).trim()
    let importMetadata = null
    if (tip === 'CCC') {
      importMetadata = {
        auto_corrections: [{
          field: 'tip',
          original: 'CCC',
          normalized: 'CIC',
          reason: 'Typo Transgaz CCC normalized to CIC (curbă induction confecționare)',
        }]
      }
      tip = 'CIC'
      cccCorrections.push({ row: r + 1, poz })
    }
    // Default tip pentru teava dacă lipsă
    if (tipRand === 'teava' && !tip) tip = 'L360'

    // Dimensiune + unghi curbă
    let dimensiune = isEmpty(dimRaw) ? null : String(dimRaw).trim()
    let unghi = null
    if (tipRand === 'curba' && dimensiune) {
      unghi = extractUnghi(dimensiune)
      // Normalize ˚ → ° pentru consistency
      dimensiune = dimensiune.replace(/˚/g, '°')
    }

    // Lungime
    const lungime_m = cantRaw && Number(cantRaw) > 0 ? Number(Number(cantRaw).toFixed(4)) : null
    if (lungime_m && tipRand !== 'separator' && tipRand !== 'legare') {
      totalLungime += lungime_m
    }

    // Counts pe tip
    if (tipRand === 'teava') teavaCount++
    else if (tipRand === 'curba') curbaCount++
    else if (tipRand === 'legare') legareCount++

    rows.push({
      _row: r + 1,
      tip_rand: tipRand,
      lot: isEmpty(lot) ? null : String(lot).trim(),
      serie_unica: isEmpty(serie) ? null : String(serie).trim(),
      tip,
      dimensiune,
      sarja: isEmpty(sarja) ? null : String(sarja).trim(),
      lungime_m: tipRand === 'separator' || tipRand === 'legare' ? null : lungime_m,
      sudura_cod: sudParsed.cod,
      sudura_refacuta: sudParsed.refacuta,
      sudura_sant_pending: pending,
      pm_cod: isEmpty(pm) ? null : String(pm).trim(),
      pa_ut_cod: isEmpty(paUt) ? null : String(paUt).trim(),
      ut_cod: isEmpty(ut) ? null : String(ut).trim(),
      observatii: isEmpty(obs) ? null : String(obs).trim(),
      unghi_curba: unghi,
      import_metadata: importMetadata,
      _raw_poz_km: pozKmRaw,
    })
  }

  // Majoritary cod + tronson
  const codExcel = Object.entries(codCounts).sort((a,b) => b[1]-a[1])[0]?.[0] || null
  const tronsonExcel = Object.entries(tronsonCounts).sort((a,b) => b[1]-a[1])[0]?.[0] || null

  // Cleanup cod (strip „rev.X" suffix pentru match cu cod_document_full)
  let codClean = codExcel
  let revExcel = null
  if (codExcel) {
    const revMatch = codExcel.match(/rev\.?\s*(\d+)/i)
    if (revMatch) revExcel = parseInt(revMatch[1], 10)
    codClean = codExcel.replace(/\s+rev\.?\s*\d+/i, '').trim()
    // Normalize liniuțe vs underscore (30-GAZ-CTG1-DWG-00027 → 30_GAZ_CTG1_DWG_00027)
    codClean = codClean.replace(/-/g, '_')
  }

  return {
    rows,
    summary: {
      total: rows.length,
      teava: teavaCount,
      curba: curbaCount,
      legare: legareCount,
      separator: separatorsCount,
      pendingSant: pendingCount,
      totalLungime,
      cccCorrections,
      codExcel,
      codClean,
      revExcel,
      tronsonExcel,
      lastRealRow: lastRealRow + 1,
    }
  }
}

// ===========================================================================
// MAIN COMPONENT
// ===========================================================================

export default function ImportExcelModal({ pachet, tronson, onClose, onSuccess, onError, onWarn }) {
  const [stage, setStage] = useState('upload') // upload | parsing | preview | importing | done
  const [file, setFile] = useState(null)
  const [parseError, setParseError] = useState(null)
  const [parsed, setParsed] = useState(null) // { rows, summary }
  const [conflicts, setConflicts] = useState({ serie: [], sudura: [] })
  const [existingTeviCount, setExistingTeviCount] = useState(0)
  const [options, setOptions] = useState({
    includeSeparators: false,
    mode: 'append', // 'append' | 'replace'
    skipConflicts: true,
    updateCod: false,
  })
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [result, setResult] = useState(null) // { ok, skipped, errors }
  const fileInputRef = useRef(null)

  // Verifică dacă pachet are rânduri existente
  useEffect(() => {
    async function check() {
      const { count } = await supabase
        .from('executie_tevi')
        .select('id', { count: 'exact', head: true })
        .eq('pachet_id', pachet.id)
      setExistingTeviCount(count || 0)
    }
    check()
  }, [pachet.id])

  // ───────── Upload + parse ─────────
  async function handleFile(f) {
    setParseError(null)
    setFile(f)
    setStage('parsing')
    try {
      const buffer = await f.arrayBuffer()
      const workbook = XLSX.read(buffer, { type: 'array', cellDates: false })
      const { rows, summary } = parseCentralizator(workbook)

      // Pre-check conflicte serie + sudură
      const series = rows.filter(r => r.serie_unica).map(r => r.serie_unica)
      const suduri = rows.filter(r => r.sudura_cod).map(r => r.sudura_cod)
      const conf = { serie: [], sudura: [] }

      if (series.length) {
        // Batch 500 (limit IN clause)
        for (let i = 0; i < series.length; i += 500) {
          const slice = series.slice(i, i + 500)
          const { data } = await supabase
            .from('executie_tevi')
            .select('id, serie_unica, pachet_id, pachet:executie_pachete_lansare!inner(cod_document_full, proiect_id, tronson_id)')
            .in('serie_unica', slice)
            .eq('pachet.proiect_id', pachet.proiect_id)
            .neq('pachet_id', pachet.id) // exclude pachetul actual (pentru reimport)
          if (data) {
            for (const c of data) {
              conf.serie.push({ serie: c.serie_unica, pachet: c.pachet.cod_document_full })
            }
          }
        }
      }
      if (suduri.length) {
        for (let i = 0; i < suduri.length; i += 500) {
          const slice = suduri.slice(i, i + 500)
          const { data } = await supabase
            .from('executie_tevi')
            .select('id, sudura_cod, pachet_id, pachet:executie_pachete_lansare!inner(cod_document_full, tronson_id)')
            .in('sudura_cod', slice)
            .eq('pachet.tronson_id', pachet.tronson_id)
            .neq('pachet_id', pachet.id)
          if (data) {
            for (const c of data) {
              conf.sudura.push({ sudura: c.sudura_cod, pachet: c.pachet.cod_document_full })
            }
          }
        }
      }

      // Decide mode default: REPLACE dacă pachetul are 0-1 rânduri (gol), APPEND altfel
      const defaultMode = existingTeviCount <= 1 ? 'replace' : 'append'
      setOptions(o => ({ ...o, mode: defaultMode }))

      setParsed({ rows, summary })
      setConflicts(conf)
      setStage('preview')
    } catch (err) {
      setParseError(err.message || String(err))
      setStage('upload')
    }
  }

  // ───────── INSERT batched ─────────
  async function doImport() {
    if (!parsed) return
    setStage('importing')
    setProgress({ done: 0, total: 0 })

    // Filter separator (dacă include=false)
    let rowsToInsert = options.includeSeparators
      ? parsed.rows
      : parsed.rows.filter(r => r.tip_rand !== 'separator')

    // Filter conflicte (dacă skipConflicts=true)
    if (options.skipConflicts && (conflicts.serie.length || conflicts.sudura.length)) {
      const conflictSerii = new Set(conflicts.serie.map(c => c.serie))
      const conflictSuduri = new Set(conflicts.sudura.map(c => c.sudura))
      rowsToInsert = rowsToInsert.filter(r => {
        if (r.serie_unica && conflictSerii.has(r.serie_unica)) return false
        if (r.sudura_cod && conflictSuduri.has(r.sudura_cod)) return false
        return true
      })
    }

    // REPLACE: DELETE all existing
    let pozStart = 1
    if (options.mode === 'replace') {
      const { error: delErr } = await supabase
        .from('executie_tevi').delete().eq('pachet_id', pachet.id)
      if (delErr) {
        setResult({ ok: 0, errors: [{ error: 'DELETE eșuat: ' + delErr.message }] })
        setStage('done')
        return
      }
    } else {
      // APPEND: get max poz
      const { data: maxData } = await supabase
        .from('executie_tevi')
        .select('poz_in_pachet')
        .eq('pachet_id', pachet.id)
        .order('poz_in_pachet', { ascending: false })
        .limit(1)
      pozStart = (maxData?.[0]?.poz_in_pachet || 0) + 1
    }

    // Build payloads
    const payloads = rowsToInsert.map((r, idx) => ({
      pachet_id: pachet.id,
      poz_in_pachet: pozStart + idx,
      tip_rand: r.tip_rand,
      lot: r.lot,
      serie_unica: r.serie_unica,
      tip: r.tip,
      dimensiune: r.dimensiune,
      sarja: r.sarja,
      lungime_m: r.lungime_m,
      sudura_cod: r.sudura_cod,
      sudura_refacuta: r.sudura_refacuta,
      sudura_sant_pending: r.sudura_sant_pending,
      pm_cod: r.pm_cod,
      pa_ut_cod: r.pa_ut_cod,
      ut_cod: r.ut_cod,
      observatii: r.observatii,
      unghi_curba: r.unghi_curba,
      import_metadata: r.import_metadata,
    }))

    setProgress({ done: 0, total: payloads.length })

    // Batch INSERT
    const BATCH = 50
    let ok = 0
    const errors = []
    for (let i = 0; i < payloads.length; i += BATCH) {
      const batch = payloads.slice(i, i + BATCH)
      const { error } = await supabase.from('executie_tevi').insert(batch)
      if (error) {
        // Try individual to identify which row failed
        for (const p of batch) {
          const { error: e2 } = await supabase.from('executie_tevi').insert(p)
          if (e2) {
            errors.push({ row: p.poz_in_pachet, serie: p.serie_unica, error: e2.message })
          } else {
            ok++
          }
        }
      } else {
        ok += batch.length
      }
      setProgress({ done: Math.min(i + BATCH, payloads.length), total: payloads.length })
    }

    // Update cod pachet dacă requested
    if (options.updateCod && parsed.summary.codClean) {
      const updates = { cod_document_full: parsed.summary.codClean }
      if (parsed.summary.revExcel != null) updates.revizie = parsed.summary.revExcel
      const { error: updErr } = await supabase
        .from('executie_pachete_lansare')
        .update(updates).eq('id', pachet.id)
      if (updErr) errors.push({ error: 'Update cod pachet eșuat: ' + updErr.message })
    }

    setResult({ ok, skipped: rowsToInsert.length === 0 ? 0 : (parsed.rows.length - rowsToInsert.length), errors })
    setStage('done')
  }

  // ───────── Render ─────────
  return (
    <div
      onClick={onClose}
      style={{
        position:'fixed', inset: 0, background:'rgba(0,0,0,.75)',
        display:'flex', alignItems:'center', justifyContent:'center',
        padding: 20, zIndex: 9100,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: G.card, borderRadius: 12, border: `1px solid ${G.border}`,
          padding: 24, maxWidth: 1100, width:'100%', maxHeight:'92vh', overflow:'auto',
          boxShadow:'0 20px 60px rgba(0,0,0,.7)',
        }}
      >
        {/* HEADER MODAL */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>
              📥 Import Excel — pachet <span style={{ fontFamily:'monospace', color: G.purple }}>{pachet.cod_document_full}</span>
            </div>
            <div style={{ fontSize: 12, color: G.muted }}>
              Tronson <span style={{ color: G.purple, fontWeight: 600 }}>{tronson?.cod || '?'}</span>
              {' · '}{existingTeviCount} rânduri existente în pachet
              {' · '}stage: {stage}
            </div>
          </div>
          <button onClick={onClose} style={{...S.btnS, padding:'6px 12px'}} disabled={stage === 'importing'}>
            ✕ Închide
          </button>
        </div>

        {/* STAGE: UPLOAD */}
        {stage === 'upload' && (
          <div>
            <UploadZone
              onFile={handleFile}
              fileInputRef={fileInputRef}
              error={parseError}
            />
            <div style={{ marginTop: 16, padding: '12px 14px', background: G.purpleDim, borderRadius: 8, fontSize: 12, color: G.muted }}>
              <div style={{ fontWeight: 700, color: G.purple, marginBottom: 6 }}>ℹ Format așteptat</div>
              <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
                <li>Sheet <code style={{ color: G.text }}>CENTRALIZATOR</code> cu header pe rândul 12</li>
                <li>Coloane: POZ. | LOT | SERIE UNICĂ | TIP | DIMENSIUNE | ȘARJĂ | CANT. | TRONSON | POZ. KM | SUDURĂ | PM | PA-UT | UT | DOCUMENT | OBS</li>
                <li>Date pornind de la rândul 14 (TOTAL LANSAT pe R13 e ignorat)</li>
                <li>Auto-detect: țeavă / curbă (CIC/CCC) / legare (sudură singură) / separator (rând gol)</li>
                <li>Normalizări: <code style={{ color: G.orange }}>CCC→CIC</code>, sufix <code style={{ color: G.red }}>R</code> pe sudură, <code style={{ color: G.orange }}>TR1→T1</code></li>
              </ul>
            </div>
          </div>
        )}

        {/* STAGE: PARSING */}
        {stage === 'parsing' && (
          <div style={{ padding: 60, textAlign:'center' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
            <div style={{ fontSize: 14, color: G.muted }}>Parsez Excel-ul...</div>
            {file && <div style={{ fontSize: 11, color: G.dim, marginTop: 6 }}>{file.name} · {(file.size/1024).toFixed(1)} KB</div>}
          </div>
        )}

        {/* STAGE: PREVIEW */}
        {stage === 'preview' && parsed && (
          <PreviewStage
            parsed={parsed}
            conflicts={conflicts}
            options={options}
            setOptions={setOptions}
            pachet={pachet}
            tronson={tronson}
            existingTeviCount={existingTeviCount}
            onCancel={() => setStage('upload')}
            onConfirm={doImport}
          />
        )}

        {/* STAGE: IMPORTING */}
        {stage === 'importing' && (
          <div style={{ padding: 40, textAlign:'center' }}>
            <div style={{ fontSize: 36, marginBottom: 16 }}>📤</div>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>
              Inserare în BD... {progress.done}/{progress.total}
            </div>
            <div style={{ width: '100%', height: 8, background: G.bg, borderRadius: 4, overflow: 'hidden', maxWidth: 420, margin: '0 auto' }}>
              <div style={{
                height: '100%',
                width: progress.total ? `${(progress.done / progress.total) * 100}%` : '0%',
                background: G.purple, transition: 'width .25s',
              }} />
            </div>
            <div style={{ fontSize: 11, color: G.muted, marginTop: 10 }}>
              {progress.total ? `${Math.round((progress.done / progress.total) * 100)}%` : '0%'} · Nu închide modalul
            </div>
          </div>
        )}

        {/* STAGE: DONE */}
        {stage === 'done' && result && (
          <div style={{ padding: 30 }}>
            <div style={{ textAlign:'center', marginBottom: 24 }}>
              <div style={{ fontSize: 48, marginBottom: 8 }}>
                {result.errors.length === 0 ? '✅' : '⚠️'}
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>
                {result.errors.length === 0 ? 'Import complet' : 'Import cu erori parțiale'}
              </div>
              <div style={{ fontSize: 13, color: G.muted }}>
                <span style={{ color: G.green, fontWeight: 600 }}>{result.ok} rânduri inserate</span>
                {result.skipped > 0 && <> · <span style={{ color: G.yellow }}>{result.skipped} skip</span></>}
                {result.errors.length > 0 && <> · <span style={{ color: G.red }}>{result.errors.length} erori</span></>}
              </div>
            </div>
            {result.errors.length > 0 && (
              <div style={{ marginBottom: 16, padding: 12, background: G.redDim+'66', borderRadius: 8, maxHeight: 200, overflow:'auto' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: G.red, marginBottom: 8 }}>Erori detaliate:</div>
                {result.errors.slice(0, 30).map((e, i) => (
                  <div key={i} style={{ fontSize: 11, color: G.text, marginBottom: 4, fontFamily:'monospace' }}>
                    {e.row && `Rând ${e.row} `}{e.serie && `(serie: ${e.serie}) `}— {e.error}
                  </div>
                ))}
                {result.errors.length > 30 && <div style={{ fontSize: 11, color: G.muted, marginTop: 8 }}>...și încă {result.errors.length - 30} erori</div>}
              </div>
            )}
            <div style={{ display:'flex', justifyContent:'flex-end', gap: 8 }}>
              <button style={S.btnP} onClick={() => { onSuccess(`${result.ok} rânduri inserate`); onClose() }}>
                Finalizează
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ===========================================================================
// UPLOAD ZONE — drop file area
// ===========================================================================

function UploadZone({ onFile, fileInputRef, error }) {
  const [dragOver, setDragOver] = useState(false)

  function handleDrop(e) {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files?.[0]
    if (!f) return
    if (!f.name.toLowerCase().endsWith('.xlsx') && !f.name.toLowerCase().endsWith('.xlsm')) {
      alert('Doar fișiere .xlsx sau .xlsm')
      return
    }
    onFile(f)
  }

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        style={{
          border: `2px dashed ${dragOver ? G.purple : G.border}`,
          borderRadius: 12,
          padding: '50px 30px',
          textAlign:'center',
          cursor:'pointer',
          background: dragOver ? G.purpleDim+'66' : G.bg,
          transition:'all .15s ease',
        }}
      >
        <div style={{ fontSize: 42, marginBottom: 12 }}>📂</div>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4, color: dragOver ? G.purple : G.text }}>
          {dragOver ? 'Eliberează fișierul aici' : 'Click sau drag&drop fișier XLSX'}
        </div>
        <div style={{ fontSize: 12, color: G.muted }}>
          Centralizator Transgaz · format .xlsx sau .xlsm
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xlsm"
          style={{ display:'none' }}
          onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
        />
      </div>
      {error && (
        <div style={{ marginTop: 12, padding: '10px 14px', background: G.redDim+'66', border: `1px solid ${G.red}`, borderRadius: 8, color: G.red, fontSize: 13 }}>
          ⚠ {error}
        </div>
      )}
    </div>
  )
}

// ===========================================================================
// PREVIEW STAGE — stats + tabel + opțiuni + conflicte
// ===========================================================================

function PreviewStage({ parsed, conflicts, options, setOptions, pachet, tronson, existingTeviCount, onCancel, onConfirm }) {
  const { rows, summary } = parsed
  const hasConflicts = conflicts.serie.length > 0 || conflicts.sudura.length > 0
  const codMatch = summary.codClean && summary.codClean === pachet.cod_document_full
  const tronsonMatch = !summary.tronsonExcel || summary.tronsonExcel === tronson?.cod

  // Calculează cât va fi efectiv inserat după opțiuni
  const willInsert = useMemo(() => {
    let count = options.includeSeparators ? summary.total : summary.total - summary.separator
    if (options.skipConflicts) {
      const conflictSerii = new Set(conflicts.serie.map(c => c.serie))
      const conflictSuduri = new Set(conflicts.sudura.map(c => c.sudura))
      let skipped = 0
      for (const r of rows) {
        if (!options.includeSeparators && r.tip_rand === 'separator') continue
        if (r.serie_unica && conflictSerii.has(r.serie_unica)) skipped++
        else if (r.sudura_cod && conflictSuduri.has(r.sudura_cod)) skipped++
      }
      count -= skipped
    }
    return count
  }, [rows, summary, options, conflicts])

  return (
    <div>
      {/* STATS */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginBottom: 16 }}>
        <Stat label="Total parse" value={summary.total} color={G.muted} />
        <Stat label="Țevi" value={summary.teava} color={G.blue} />
        <Stat label="Curbe" value={summary.curba} color={G.orange} />
        <Stat label="Legare" value={summary.legare} color={G.green} />
        <Stat label="Separator" value={summary.separator} color={G.dim} />
        <Stat label="Pending șanț" value={summary.pendingSant} color={G.yellow} />
        <Stat label="Lungime m" value={summary.totalLungime.toFixed(2)} color={G.purple} />
      </div>

      {/* AVERTISMENTE */}
      {(!tronsonMatch || !codMatch || summary.cccCorrections.length > 0 || hasConflicts) && (
        <div style={{ marginBottom: 16, padding: '12px 14px', background: G.yellowDim+'88', border: `1px solid ${G.yellow}55`, borderRadius: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: G.yellow, marginBottom: 8 }}>⚠ Atenție</div>
          <div style={{ fontSize: 12, color: G.text, lineHeight: 1.7 }}>
            {!tronsonMatch && (
              <div>
                Tronson Excel <code style={{ color: G.orange }}>{summary.tronsonExcel}</code> ≠ tronson pachet <code style={{ color: G.purple }}>{tronson?.cod}</code>.
                Importul va merge la pachetul curent (recomandă verificare).
              </div>
            )}
            {!codMatch && summary.codClean && (
              <div style={{ display:'flex', alignItems:'center', gap: 8, marginTop: 4, flexWrap:'wrap' }}>
                <span>Cod Excel <code style={{ color: G.orange }}>{summary.codClean}</code>
                  {summary.revExcel != null && <> rev.{summary.revExcel}</>}
                  {' '}≠ cod pachet <code style={{ color: G.purple }}>{pachet.cod_document_full}</code>.</span>
                <label style={{ cursor:'pointer', display:'flex', alignItems:'center', gap: 4 }}>
                  <input
                    type="checkbox"
                    checked={options.updateCod}
                    onChange={e => setOptions({...options, updateCod: e.target.checked})}
                  />
                  <span>Actualizează codul pachetului la cel din Excel</span>
                </label>
              </div>
            )}
            {summary.cccCorrections.length > 0 && (
              <div style={{ marginTop: 4 }}>
                <strong>{summary.cccCorrections.length}</strong> rânduri cu <code style={{ color: G.orange }}>CCC</code> normalizate la <code style={{ color: G.green }}>CIC</code> (log în import_metadata)
              </div>
            )}
            {hasConflicts && (
              <div style={{ marginTop: 6 }}>
                <strong style={{ color: G.red }}>{conflicts.serie.length}</strong> conflicte serie cross-proiect,
                {' '}<strong style={{ color: G.red }}>{conflicts.sudura.length}</strong> conflicte sudură cross-tronson.
                <label style={{ display:'flex', alignItems:'center', gap: 4, marginTop: 4, cursor:'pointer' }}>
                  <input
                    type="checkbox"
                    checked={options.skipConflicts}
                    onChange={e => setOptions({...options, skipConflicts: e.target.checked})}
                  />
                  <span>Skip rândurile în conflict (recomandat — altfel INSERT eșuează pe trigger)</span>
                </label>
              </div>
            )}
          </div>
        </div>
      )}

      {/* CONFLICTE detail */}
      {hasConflicts && (
        <details style={{ marginBottom: 16, background: G.redDim+'44', borderRadius: 8, padding: '8px 12px' }}>
          <summary style={{ cursor:'pointer', fontSize: 12, color: G.red, fontWeight: 600 }}>
            Detalii conflicte ({conflicts.serie.length + conflicts.sudura.length})
          </summary>
          <div style={{ fontSize: 11, color: G.text, marginTop: 8, maxHeight: 160, overflow:'auto' }}>
            {conflicts.serie.slice(0, 20).map((c, i) => (
              <div key={'s'+i} style={{ marginBottom: 3, fontFamily:'monospace' }}>
                <span style={{ color: G.muted }}>serie</span> {c.serie} → există în {c.pachet}
              </div>
            ))}
            {conflicts.sudura.slice(0, 20).map((c, i) => (
              <div key={'w'+i} style={{ marginBottom: 3, fontFamily:'monospace' }}>
                <span style={{ color: G.muted }}>sudură</span> {c.sudura} → există în {c.pachet}
              </div>
            ))}
            {(conflicts.serie.length > 20 || conflicts.sudura.length > 20) && (
              <div style={{ color: G.muted, fontStyle:'italic', marginTop: 6 }}>
                ...și încă {(conflicts.serie.length - 20) + (conflicts.sudura.length - 20)} conflicte
              </div>
            )}
          </div>
        </details>
      )}

      {/* OPȚIUNI */}
      <div style={{ marginBottom: 16, padding: '12px 14px', background: G.bg, border: `1px solid ${G.border}`, borderRadius: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: G.muted, textTransform:'uppercase', letterSpacing:'.5px', marginBottom: 10 }}>Opțiuni import</div>

        <label style={{ display:'flex', alignItems:'center', gap: 8, marginBottom: 8, cursor:'pointer' }}>
          <input
            type="checkbox"
            checked={options.includeSeparators}
            onChange={e => setOptions({...options, includeSeparators: e.target.checked})}
          />
          <span style={{ fontSize: 13, color: G.text }}>
            Include separator-urile (<strong>{summary.separator}</strong> detectate — gap-uri mozaic)
          </span>
        </label>

        {existingTeviCount > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 12, color: G.muted, marginBottom: 6 }}>
              Pachetul are deja <strong style={{ color: G.text }}>{existingTeviCount}</strong> rânduri existente:
            </div>
            <div style={{ display:'flex', gap: 12, flexWrap:'wrap' }}>
              <label style={{ cursor:'pointer', display:'flex', alignItems:'center', gap: 4, fontSize: 13 }}>
                <input
                  type="radio"
                  name="mode"
                  checked={options.mode === 'append'}
                  onChange={() => setOptions({...options, mode: 'append'})}
                />
                <span><strong>APPEND</strong> (păstrează existente + adaugă)</span>
              </label>
              <label style={{ cursor:'pointer', display:'flex', alignItems:'center', gap: 4, fontSize: 13 }}>
                <input
                  type="radio"
                  name="mode"
                  checked={options.mode === 'replace'}
                  onChange={() => setOptions({...options, mode: 'replace'})}
                />
                <span style={{ color: G.red }}><strong>REPLACE</strong> (șterge toate + import)</span>
              </label>
            </div>
          </div>
        )}
      </div>

      {/* PREVIEW TABEL — primele 30 rânduri */}
      <div style={{ marginBottom: 16, fontSize: 12, color: G.muted }}>
        Preview primele 30 rânduri (din {summary.total} parse-uite):
      </div>
      <div style={{ border:`1px solid ${G.border}`, borderRadius: 8, overflow:'hidden', marginBottom: 16, maxHeight: 360, overflowY:'auto' }}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize: 11 }}>
          <thead style={{ position:'sticky', top: 0, background: G.surface, zIndex: 5 }}>
            <tr style={{ borderBottom: `1px solid ${G.border}` }}>
              {['R', 'Tip', 'Serie', 'Tip mat.', 'Dimens.', 'Șarja', 'm', 'Sudură', 'PM', 'Obs'].map(h => (
                <th key={h} style={{ padding:'6px 8px', textAlign:'left', fontWeight: 700, color: G.muted, fontSize: 10, textTransform:'uppercase', letterSpacing:'.5px' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.filter(r => options.includeSeparators || r.tip_rand !== 'separator').slice(0, 30).map((r, i) => {
              const isPending = r.sudura_sant_pending
              const inConflict = (r.serie_unica && conflicts.serie.find(c => c.serie === r.serie_unica))
                              || (r.sudura_cod && conflicts.sudura.find(c => c.sudura === r.sudura_cod))
              const tipColor = { teava: G.blue, curba: G.orange, legare: G.green, separator: G.dim }[r.tip_rand]
              const rowBg = inConflict ? G.redDim+'44' : isPending ? G.yellowDim+'44' : 'transparent'
              return (
                <tr key={i} style={{ background: rowBg, borderBottom: `1px solid ${G.border2}` }}>
                  <td style={{ padding:'4px 8px', color: G.muted, fontFamily:'monospace' }}>{r._row}</td>
                  <td style={{ padding:'4px 8px' }}>
                    <span style={{ ...S.badge, background: tipColor+'22', color: tipColor, fontSize: 10 }}>{r.tip_rand}</span>
                    {isPending && <span style={{ ...S.badge, background: G.orange+'33', color: G.orange, fontSize: 9, marginLeft: 3 }}>🚧</span>}
                    {r.sudura_refacuta && <span style={{ ...S.badge, background: G.red+'33', color: G.red, fontSize: 9, marginLeft: 3 }}>R</span>}
                    {inConflict && <span style={{ ...S.badge, background: G.red, color:'#fff', fontSize: 9, marginLeft: 3 }}>conflict</span>}
                  </td>
                  <td style={{ padding:'4px 8px', fontFamily:'monospace', color: G.text }}>{r.serie_unica || '—'}</td>
                  <td style={{ padding:'4px 8px' }}>
                    {r.tip || '—'}
                    {r.import_metadata?.auto_corrections && <span style={{ color: G.orange, marginLeft: 3 }} title="CCC normalizat la CIC">⚠</span>}
                  </td>
                  <td style={{ padding:'4px 8px', color: G.muted }}>
                    {r.dimensiune || '—'}
                    {r.unghi_curba && <span style={{ color: G.orange, marginLeft: 3 }}>{r.unghi_curba}</span>}
                  </td>
                  <td style={{ padding:'4px 8px', color: G.muted, fontFamily:'monospace', fontSize: 10 }}>{r.sarja || '—'}</td>
                  <td style={{ padding:'4px 8px', textAlign:'right', color: G.muted, fontFamily:'monospace' }}>
                    {r.lungime_m != null ? r.lungime_m.toFixed(2) : '—'}
                  </td>
                  <td style={{ padding:'4px 8px', fontFamily:'monospace', color: G.green }}>{r.sudura_cod || (isPending ? 'pending' : '—')}</td>
                  <td style={{ padding:'4px 8px', color: G.muted, fontSize: 10 }}>{r.pm_cod || '—'}</td>
                  <td style={{ padding:'4px 8px', color: G.muted, fontSize: 10, maxWidth: 180, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }} title={r.observatii}>
                    {r.observatii ? (r.observatii.length > 30 ? r.observatii.slice(0, 30) + '…' : r.observatii) : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* ACȚIUNI */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap: 12 }}>
        <div style={{ fontSize: 13 }}>
          <span style={{ color: G.muted }}>Va insera:</span>{' '}
          <span style={{ color: G.green, fontWeight: 700, fontSize: 15 }}>{willInsert}</span>{' '}
          <span style={{ color: G.muted }}>rânduri</span>
          {options.mode === 'replace' && existingTeviCount > 0 && (
            <span style={{ color: G.red, marginLeft: 8 }}>(va șterge {existingTeviCount} existente)</span>
          )}
        </div>
        <div style={{ display:'flex', gap: 8 }}>
          <button style={S.btnS} onClick={onCancel}>← Înapoi</button>
          <button
            style={{...S.btnP, opacity: willInsert > 0 ? 1 : 0.4, cursor: willInsert > 0 ? 'pointer' : 'not-allowed'}}
            onClick={onConfirm}
            disabled={willInsert === 0}
          >
            ✓ Confirmă import ({willInsert})
          </button>
        </div>
      </div>
    </div>
  )
}

// ===========================================================================
// STAT CARD — număr + label
// ===========================================================================

function Stat({ label, value, color }) {
  return (
    <div style={{ background: G.bg, border: `1px solid ${G.border2}`, borderRadius: 8, padding: '8px 12px' }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: color, fontFamily:'monospace' }}>{value}</div>
      <div style={{ fontSize: 10, color: G.muted, textTransform:'uppercase', letterSpacing:'.5px', marginTop: 2 }}>{label}</div>
    </div>
  )
}
