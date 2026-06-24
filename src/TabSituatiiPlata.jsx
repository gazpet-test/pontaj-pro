// ════════════════════════════════════════════════════════════════
// TabSituatiiPlata.jsx — Modul Execuție · Situații de Plată
// 09.06.2026 v2 — flux XLS borderou + PDF certificat TGZ + emitere factură
//
// Features v2:
// - Upload XLS borderou ajustat → parsare client-side (SheetJS, zero AI cost)
// - Upload PDF Certificat Plată TGZ → Haiku extrage suma aprobată (~3 bani)
// - Comparare XLS vs Certificat → alertă discrepanță dacă TGZ a tăiat
// - Modal EmiteFactura cu articole din linii BD + editabil
// - Buton 📄 Emite direct pe rândul SL aprobată fără factură
// - Linii SL stocate în executie_situatii_plata_linii (sursa xls/manual/ai)
// ════════════════════════════════════════════════════════════════
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { createClient } from '@supabase/supabase-js'
import { useNavigate } from 'react-router-dom'
import * as XLSX from 'xlsx-js-style'

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)

const G = {
  bg:'#0D1117', surface:'#161B22', card:'#1C2128', card2:'#21262D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  border:'#30363D', border2:'#21262D',
  blue:'#58A6FF', green:'#2EA043', greenBg:'#238636',
  yellow:'#D29922', orange:'#F0883E', red:'#F85149',
  purple:'#A371F7', teal:'#2DD4BF', executie:'#58A6FF',
}

const S = {
  input: {
    width:'100%', boxSizing:'border-box', background:G.bg,
    border:`1px solid ${G.border2}`, borderRadius:6,
    padding:'8px 12px', color:G.text, fontSize:13, outline:'none',
  },
  label: {
    display:'block', fontSize:11, color:G.muted, marginBottom:4,
    fontWeight:600, textTransform:'uppercase', letterSpacing:'.3px',
  },
}

const STATUS_SL = {
  in_pregatire: { label:'În pregătire', color:G.muted,   bg:G.border2,       icon:'📝' },
  depusa:       { label:'Depusă',       color:G.yellow,  bg:G.yellow+'22',   icon:'📤' },
  aprobata:     { label:'Aprobată',     color:G.blue,    bg:G.blue+'22',     icon:'✅' },
  facturata:    { label:'Facturată',    color:G.green,   bg:G.greenBg+'44',  icon:'🧾' },
  incasata:     { label:'Încasată',     color:G.teal,    bg:G.teal+'22',     icon:'💰' },
  respinsa:     { label:'Respinsă',     color:G.red,     bg:G.red+'22',      icon:'❌' },
}

const TIP_SL = {
  situatie_plata: { label:'Situație plată', icon:'📊' },
  ncs:            { label:'NCS',             icon:'➕' },
  act_aditional:  { label:'Act adițional',   icon:'📋' },
  avans:          { label:'Avans',           icon:'💵' },
}

const LUNI = ['Ian','Feb','Mar','Apr','Mai','Iun','Iul','Aug','Sep','Oct','Nov','Dec']
const LUNI_FULL = ['Ianuarie','Februarie','Martie','Aprilie','Mai','Iunie','Iulie','August','Septembrie','Octombrie','Noiembrie','Decembrie']

const fmtLei = v => {
  if (!v && v !== 0) return '—'
  return new Intl.NumberFormat('ro-RO', { style:'currency', currency:'RON', minimumFractionDigits:2, maximumFractionDigits:2 }).format(v)
}
const fmtDate = d => d ? new Date(d).toLocaleDateString('ro-RO', {day:'2-digit', month:'short', year:'numeric'}) : '—'
const fmt2 = v => (v||0).toLocaleString('ro-RO', {minimumFractionDigits:2, maximumFractionDigits:2})

function useToast() {
  const [t, setT] = useState(null)
  const show = (msg, kind='ok') => { setT({msg,kind}); setTimeout(()=>setT(null),4000) }
  const Toast = () => t ? (
    <div style={{
      position:'fixed', bottom:24, right:24, padding:'12px 18px',
      background:t.kind==='err'?G.red:G.greenBg, color:'#fff',
      borderRadius:8, fontWeight:600, fontSize:13, zIndex:10000, maxWidth:400,
    }}>{t.msg}</div>
  ) : null
  return { show, Toast }
}

// ══════════════════════════════════════════════════════════
// HELPER: fișier → base64
// ══════════════════════════════════════════════════════════
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result.split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// ══════════════════════════════════════════════════════════
// HELPER: Parsare număr din format românesc (1.234.567,89) sau standard (1234567.89)
// ══════════════════════════════════════════════════════════
function parseRoNum(c) {
  if (typeof c === 'number') return c
  const s = String(c||'').trim().replace(/\s/g,'')
  if (!s || s==='-') return 0
  if (s.includes(',')) return parseFloat(s.replace(/\./g,'').replace(',','.')) || 0
  return parseFloat(s) || 0
}

// ══════════════════════════════════════════════════════════
// HELPER: Parsare XLS borderou/centralizator (client-side, SheetJS)
// Detectează automat:
//   - BORDEROU simplu (3-4 cols, Caldararu): total + ajustare ICC → 1-2 articole
//   - CENTRALIZATOR multi-linii (Prunisor): rânduri C+M+DS+ajustări → N articole
// ══════════════════════════════════════════════════════════

// Borderou simplu Caldararu: COD DEVIZ | DENUMIRE DEVIZ | VALOARE DEVIZ + totaluri jos
function _parseBorderouSimple(rows) {
  let nrSL = null, lunaAn = null, contractNr = null
  let totalBaza = null, totalAjustare = null, coeficient = null
  let totalOS = null, bazaDinFormula = null

  for (const row of rows) {
    const rowText = row.map(c => String(c||'')).join(' ').toLowerCase()
    if (!nrSL) { const m = rowText.match(/situati[ae]\s+de\s+plat[aă]\s+nr\.?\s*(\d+)/i); if(m) nrSL=m[1] }
    if (!lunaAn) { const m = rowText.match(/luna\s+([a-zăâîșț]+\s+\d{4})/i); if(m) lunaAn=m[1].toUpperCase() }
    if (!contractNr) { const m = rowText.match(/contract\s+nr\.?\s*([\d\/\.]+)/i); if(m) contractNr=m[1] }

    // BAZĂ BULLETPROOF: dacă există linia de ajustare cu formula "= <baza> lei x <coef>",
    // baza e exact numărul pe care se aplică coeficientul — nu ghicim ce total general luăm.
    if (!bazaDinFormula) {
      const mf = rowText.match(/=\s*([\d.,]+)\s*lei\s*[x×]\s*1[.,]\d+/i)
      if (mf) { const v = parseRoNum(mf[1]); if (v > 1000) bazaDinFormula = v }
    }

    // Fallback bază: ultimul "TOTAL GENERAL" / "Total valoare conform" fără TVA inclusiv
    // (în borderourile ajustate pot exista subtotaluri obiect + total general final cu OS).
    if ((rowText.includes('total general') || rowText.includes('total valoare conform')) && !rowText.includes('inclusiv')) {
      const nums = row.filter(c => typeof c==='number' && c > 1000)
      if (nums.length) totalBaza = nums[nums.length-1]
    }

    // OS — Organizare de șantier (linie explicită în borderou)
    if (totalOS === null && rowText.includes('organizare') && rowText.includes('santier')) {
      const nums = row.filter(c => typeof c==='number' && c > 0)
      if (nums.length) totalOS = nums[nums.length-1]
    }

    if (!totalAjustare && rowText.includes('total') && rowText.includes('ajustar')) {
      const nums = row.filter(c => typeof c==='number' && c > 0)
      if (nums.length) totalAjustare = nums[nums.length-1]
    }
    if (!coeficient) {
      const m = rowText.match(/=\s*1\.(0\d{3,})\b/)
      if (m) { const c=parseFloat('1.'+m[1]); if(c>1&&c<1.5) coeficient=c }
    }
  }

  // Prioritate bază: formula de ajustare > ultimul total general fără TVA > max numeric
  if (bazaDinFormula) totalBaza = bazaDinFormula
  if (!totalBaza) {
    const allNums = rows.flat().filter(c=>typeof c==='number'&&c>10000)
    if (allNums.length) totalBaza = Math.max(...allNums)
  }
  // Borderou simplu → 1 linie baza + 1 linie ajustare (dacă există)
  const linii = []
  if (totalBaza) linii.push({ denumire:'', valoare:totalBaza, ajustare:0, tip:'lucr_cm' })
  if (totalAjustare) linii.push({ denumire:'', valoare:totalAjustare, ajustare:0, tip:'ajustare', coeficient })
  return { nrSL, lunaAn, contractNr, totalBaza, totalAjustare, coeficient, totalOS, linii, tip:'borderou' }
}

// Centralizator Prunisor: rânduri cu denumire + col_baza + col_ajustare
function _parseCentralizator(rows) {
  let nrSL=null, lunaAn=null, contractNr=null
  let valBazaCol=-1, ajustCol=-1
  let totalBaza=0, totalAjustare=0

  // Pas 1: metadate din header
  for (const row of rows) {
    const txt = row.map(c=>String(c||'')).join(' ').toLowerCase()
    if (!nrSL) { const m=txt.match(/sit(?:uatie)?\s*(?:de\s+lucrar[i]?)?\s*nr\.?\s*(\d+)/i); if(m) nrSL=m[1] }
    if (!lunaAn) { const m=txt.match(/luna\s+([a-z\u0100-\u017F]+\s+\d{4})/i); if(m) lunaAn=m[1].toUpperCase() }
    if (!contractNr) { const m=txt.match(/contract\s+nr\.?\s*([\d\/\.]+)/i); if(m) contractNr=m[1] }
  }

  // Pas 2: detectare coloane din rândul header TGZ (conține etichetele 'a','b','g')
  // Structura standard TGZ: col 'a'=val.estimata (baza), col 'b'=ajustare ICC, col 'g'=total plata
  for (const row of rows) {
    const cells = row.map(c => String(c||'').trim().toLowerCase())
    if (cells.includes('a') && cells.includes('b') && cells.includes('g')) {
      valBazaCol = cells.indexOf('a')   // col 'a' = valoare baza de facturat
      ajustCol   = cells.indexOf('b')   // col 'b' = ajustare ICC
      break
    }
  }
  // Fallback: rândul TOTAL pentru totaluri (dacă nu există header cu etichete)
  if (valBazaCol < 0) {
    for (let i=rows.length-1; i>=0; i--) {
      const row = rows[i]
      const fc = String(row[0]||row[1]||'').trim().toLowerCase()
      if (fc==='total' || fc==='total:') {
        const nums = row.map((c,j)=>({j, v:parseRoNum(c)})).filter(x=>x.v>1000)
        if (nums.length>=1) valBazaCol=nums[0].j
        if (nums.length>=2) ajustCol=nums[1].j
        break
      }
    }
  }
  // Fallback final: structura standard TGZ col 2=baza, col 3=ajustare
  if (valBazaCol < 0) { valBazaCol = 2; ajustCol = 3 }
  
  // Calculează totaluri din rândul TOTAL
  for (let i=rows.length-1; i>=0; i--) {
    const row = rows[i]
    const fc = String(row[0]||row[1]||'').trim().toLowerCase()
    if (fc.startsWith('total')) {
      totalBaza = parseRoNum(row[valBazaCol]) || 0
      if (ajustCol >= 0) totalAjustare = parseRoNum(row[ajustCol]) || 0
      break
    }
  }

  // Pas 3: extrag rânduri de date
  const SKIP = /^(total|recapitu|obiect|organizare|situa|nr\.|cod\s|val|sume|rest|realizari|plati|orice|a\.|b\.|1\.|2\.|luna|beneficiar|investitia|antreprenor|executant|constructor)/i
  const linii = []

  for (const row of rows) {
    const denumire = String(row[0]||row[1]||'').replace(/\n/g,' ').replace(/\s+/g,' ').trim()
    if (denumire.length < 15 || SKIP.test(denumire)) continue
    if (valBazaCol < 0) continue

    const valBaza = parseRoNum(row[valBazaCol])
    const ajust = ajustCol >= 0 ? parseRoNum(row[ajustCol]) : 0

    if (valBaza > 100) {
      linii.push({
        denumire: denumire.slice(0, 200),
        valoare: Math.round(valBaza * 100) / 100,
        ajustare: Math.round(ajust * 100) / 100,
        tip: 'lucr_cm',
      })
    }
  }

  // Fallback total dacă nu am prins rândul TOTAL
  if (totalBaza === 0) totalBaza = linii.reduce((s,l)=>s+l.valoare,0)
  if (totalAjustare === 0) totalAjustare = linii.reduce((s,l)=>s+l.ajustare,0)

  return { nrSL, lunaAn, contractNr, totalBaza, totalAjustare, coeficient:null, linii, tip:'centralizator' }
}

// Habau IPC (Interim Payment Certificate): foaie "IPC Form", format cumulativ cu rețineri.
// Valoarea lunii = "Total month / Total luna"; rețineri = Retention Money 10% + CAR Insurance 0.3%.
// Returnează linii: 1 brut (TVA 21) + rețineri negative (TVA 0) → factura iese ca GAZ-359.
function _parseHabauIPC(wb) {
  // 1) Foaia IPC Form (sau prima care conține "total month / luna")
  let sheetName = wb.SheetNames.find(n => /ipc\s*form/i.test(n))
  if (!sheetName) {
    sheetName = wb.SheetNames.find(n => {
      const r = XLSX.utils.sheet_to_json(wb.Sheets[n], { header:1, defval:'', raw:true })
      return r.some(row => row.some(c => /total\s*(month|luna)/i.test(String(c||''))))
    })
  }
  if (!sheetName) return null
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header:1, defval:'', raw:true })

  // 2) Detectare coloane din rândurile de header (cu fallback la pozițiile standard E/G/I)
  let colBaza = -1, colCAR = -1, colRetention = -1
  for (const row of rows) {
    row.forEach((c, ci) => {
      const t = String(c || '').toLowerCase()
      if (colBaza < 0 && /total\s*(month|luna)/i.test(t)) colBaza = ci
      if (colCAR < 0 && /car\s*insurance/i.test(t)) colCAR = ci
      if (colRetention < 0 && /retention\s*money/i.test(t)) colRetention = ci
    })
  }
  if (colBaza < 0) colBaza = 4
  if (colCAR < 0) colCAR = 6
  if (colRetention < 0) colRetention = 8

  // 3) Rândul de date: "Subtotal" > "Total" > primul rând cu Nr.crt=1
  let dataRow = rows.find(r => String(r[1] || '').trim().toLowerCase() === 'subtotal')
    || rows.find(r => String(r[1] || '').trim().toLowerCase() === 'total')
    || rows.find(r => parseRoNum(r[0]) === 1 && parseRoNum(r[colBaza]) !== 0)
  if (!dataRow) return null

  const baza = Math.round(parseRoNum(dataRow[colBaza]) * 100) / 100
  let car = Math.round(parseRoNum(dataRow[colCAR]) * 100) / 100
  let retention = Math.round(parseRoNum(dataRow[colRetention]) * 100) / 100
  if (car > 0) car = -car            // reținerile sunt mereu negative pe factură
  if (retention > 0) retention = -retention
  if (!baza) return null

  // 4) Metadate: nr IPC, perioadă (→ lună/an), nr contract
  let ipcNr = '', perioada = '', contractNr = '', luna = null, an = null
  for (const row of rows) {
    const txt = row.map(c => String(c || '')).join(' ')
    if (!ipcNr) { const m = txt.match(/IPC\s*0*(\d+)/i); if (m) ipcNr = m[1] }
    if (!perioada) { const m = txt.match(/(\d{2}\.\d{2}\.\d{4})\s*[-–]\s*(\d{2}\.\d{2}\.\d{4})/); if (m) { perioada = `${m[1]} - ${m[2]}`; luna = parseInt(m[1].split('.')[1]); an = parseInt(m[1].split('.')[2]) } }
    if (!contractNr) { const m = txt.match(/(\d{3}\.\d{2}\.\d{3}-\d{3})/); if (m) contractNr = m[1] }
  }

  // 5) Linii: brut (TVA 21) + rețineri negative (TVA 0)
  const ipcLabel = ipcNr ? `IPC ${String(ipcNr).padStart(2, '0')}` : 'IPC'
  const ctrPart = contractNr ? ` CTR ${contractNr}` : ''
  const perPart = perioada ? ` PERIOADA ${perioada}` : ''
  const linii = [{
    denumire: `PRESTĂRI SERVICII CONFORM ${ipcLabel}${ctrPart}${perPart}`,
    valoare: baza, tva_pct: 21, tip: 'lucr_cm',
  }]
  if (retention) linii.push({ denumire: `Reținere GBE (garanție bună execuție) ${ipcLabel}`, valoare: retention, tva_pct: 0, tip: 'retinere' })
  if (car) linii.push({ denumire: `Reținere CAR 0.3% ${ipcLabel}`, valoare: car, tva_pct: 0, tip: 'retinere' })

  const net = Math.round((baza + retention + car) * 100) / 100
  return {
    nrSL: ipcLabel, lunaAn: perioada, luna, an, contractNr,
    totalBaza: baza, totalAjustare: 0, coeficient: null,
    retinereGBE: retention, retinereCAR: car, net,
    linii, tip: 'habau_ipc',
  }
}

function parseBorderouAjustatXLS(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result)
        const wb = XLSX.read(data, { type:'array', cellText:false, cellNF:true, raw:true, cellFormula:false })

        // Detectare format Habau IPC (foaie "IPC Form" / text "Payment Certificate" / "Total month")
        const isHabau = wb.SheetNames.some(n => /ipc\s*form/i.test(n)) ||
          wb.SheetNames.some(n => {
            const r = XLSX.utils.sheet_to_json(wb.Sheets[n], { header:1, defval:'', raw:true })
            return r.slice(0, 16).some(row => row.some(c => /payment\s*certificate|total\s*month/i.test(String(c||''))))
          })
        if (isHabau) {
          const habau = _parseHabauIPC(wb)
          if (habau && habau.totalBaza) {
            console.log('[XLS Parser] tip: HABAU IPC | baza:', habau.totalBaza, '| rețineri GBE/CAR:', habau.retinereGBE, habau.retinereCAR, '| net:', habau.net)
            return resolve(habau)
          }
        }

        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(ws, { header:1, defval:'', raw:true })

        // Detectare tip: încerc ambele parsere și aleg cel cu mai multe linii
        // _parseCentralizator returnează linii[] dacă găsește rândul TOTAL cu 2+ coloane
        // _parseBorderouSimple returnează 1-2 linii din totaluri jos
        const resultCentralizator = _parseCentralizator(rows)
        const resultBorderoou = _parseBorderouSimple(rows)
        
        // Alegem centralizatorul dacă a găsit ≥ 2 linii de date separate
        const isCentralizator = resultCentralizator.linii && resultCentralizator.linii.length >= 2
        const result = isCentralizator ? resultCentralizator : resultBorderoou
        console.log('[XLS Parser] tip:', isCentralizator ? 'CENTRALIZATOR' : 'BORDEROU', '| linii:', result.linii?.length || 0, '| totalBaza:', result.totalBaza)
        resolve(result)
      } catch(e) {
        reject(e)
      }
    }
    reader.onerror = () => reject(new Error('Eroare citire fișier'))
    reader.readAsArrayBuffer(file)
  })
}

// ══════════════════════════════════════════════════════════
// MODAL EMITERE FACTURĂ DIN SL
// ══════════════════════════════════════════════════════════
function EmiteFacturaModal({ sl, proiectDate, onClose, onSuccess, showToast }) {
  const [benef, setBenef] = useState(null)
  const [loadingBenef, setLoadingBenef] = useState(true)
  const [linii, setLinii] = useState([])
  const [loadingLinii, setLoadingLinii] = useState(true)
  const [serie, setSerie] = useState('GAZ')
  const [dataFact, setDataFact] = useState(new Date().toISOString().slice(0,10))
  const [termen, setTermen] = useState(30)
  const [emiting, setEmiting] = useState(false)

  const luna = sl.luna ? LUNI_FULL[sl.luna-1] : ''
  const an = sl.an || ''

  // Fetch beneficiar din proiect → contract → beneficiari
  useEffect(() => {
    const fetchBenef = async () => {
      setLoadingBenef(true)
      try {
        if (proiectDate?.contract_id) {
          const { data } = await supabase.from('contracte_terti')
            .select('termen_plata_zile, beneficiar_id, beneficiari!inner(id,nume,cif,iban_principal,banca,sediu)')
            .eq('id', proiectDate.contract_id).single()
          if (data) {
            setBenef(data.beneficiari)
            if (data.termen_plata_zile) setTermen(data.termen_plata_zile)
          }
        } else if (proiectDate?.beneficiar) {
          setBenef({ id: null, nume: proiectDate.beneficiar, cif: null, iban_principal: null, banca: null, sediu: null })
        }
      } catch(e) { console.error('fetchBenef', e) }
      finally { setLoadingBenef(false) }
    }
    fetchBenef()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch linii din BD sau auto-generate din SL
  useEffect(() => {
    const fetchLinii = async () => {
      setLoadingLinii(true)
      try {
        const { data } = await supabase.from('executie_situatii_plata_linii')
          .select('*').eq('sl_id', sl.id).order('ord')

        if (data && data.length > 0) {
          setLinii(data.map(l => ({
            ...l,
            denumire: l.denumire,
            valoare: parseFloat(l.valoare),
            tva_pct: parseFloat(l.tva_pct || 21),
          })))
        } else {
          // Auto-generate din câmpurile SL
          const autoLinii = []
          const valBaza = parseFloat(sl.valoare_baza_lei || 0)
          const valAj = parseFloat(sl.valoare_ajustare_lei || 0)
          const certVal = parseFloat(sl.certificat_plata_valoare || 0)
          const nr = proiectDate?.nr_contract ? ` nr. ${proiectDate.nr_contract}` : ''
          const lunaSuffix = luna ? ` — ${luna} ${an}` : ''

          // 1 articol baza + 1 articol ajustare (fallback când nu există linii detaliate în BD)
          const valoareBazaFact = certVal > 0 ? certVal - valAj : valBaza
          if (valoareBazaFact > 0) {
            autoLinii.push({
              ord: 1, tip: 'lucr_cm',
              denumire: `${proiectDate?.beneficiar || 'Lucrări construcții'} — ${sl.nr_situatie}${lunaSuffix} — conf. contract${nr}`,
              valoare: valoareBazaFact, um: 'buc', cantitate: 1, tva_pct: 21,
            })
          }
          if (valAj > 0) {
            autoLinii.push({
              ord: 2, tip: 'ajustare',
              denumire: `Valoare ajustare conf. contract${nr} la ${sl.nr_situatie}${lunaSuffix}`,
              valoare: valAj, um: 'buc', cantitate: 1, tva_pct: 21,
            })
          }
          setLinii(autoLinii)
        }
      } catch(e) { console.error('fetchLinii', e) }
      finally { setLoadingLinii(false) }
    }
    fetchLinii()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const totals = useMemo(() => {
    const neta = linii.reduce((s,l) => s + (parseFloat(l.valoare)||0), 0)
    const tva = linii.reduce((s,l) => {
      const val = parseFloat(l.valoare) || 0
      const pct = parseFloat(l.tva_pct) || 21
      return s + val * pct / 100
    }, 0)
    return { neta, tva, total: neta + tva }
  }, [linii])

  const updateLinie = (idx, field, val) => {
    setLinii(prev => {
      const arr = [...prev]
      arr[idx] = { ...arr[idx], [field]: val }
      return arr
    })
  }

  const addLinie = () => {
    setLinii(prev => [...prev, {
      ord: prev.length + 1, tip: 'alte',
      denumire: '', valoare: 0, um: 'buc', cantitate: 1, tva_pct: 21,
    }])
  }

  const removeLinie = (idx) => {
    setLinii(prev => prev.filter((_,i) => i !== idx).map((l,i) => ({...l, ord:i+1})))
  }

  const handleEmite = async () => {
    if (!benef?.nume && !proiectDate?.beneficiar) {
      showToast('Beneficiarul lipsește — adaugă un contract proiectului', 'err'); return
    }
    if (linii.length === 0) { showToast('Adaugă cel puțin un articol', 'err'); return }
    if (linii.some(l => !l.denumire.trim())) { showToast('Completează denumirea tuturor articolelor', 'err'); return }

    setEmiting(true)
    try {
      // 1. Nr factură atomic
      const { data: nrFinal, error: errNr } = await supabase.rpc('fn_get_next_nr_factura', { p_serie: serie })
      if (errNr) throw errNr
      const nr_complet = `${serie} ${nrFinal}`

      // 2. Articole pentru facturi_emise
      const articole = linii.map((l, i) => ({
        nr: i + 1,
        denumire: l.denumire.trim(),
        um: l.um || 'buc',
        cantitate: parseFloat(l.cantitate) || 1,
        pret_unitar: parseFloat(l.valoare),
        valoare: parseFloat(l.valoare),
        tva_pct: parseFloat(l.tva_pct) || 21,
      }))

      // 3. INSERT factură
      const payload = {
        // nr_complet + an sunt GENERATED ALWAYS in BD → nu se includ in payload
        serie, nr: parseInt(nrFinal),
        data: dataFact,
        beneficiar_id: benef?.id ? parseInt(benef.id) : null,
        beneficiar_nume: benef?.nume || proiectDate?.beneficiar || '',
        beneficiar_cif: benef?.cif || null,
        beneficiar_iban: benef?.iban_principal || null,
        beneficiar_banca: benef?.banca || null,
        beneficiar_sediu: benef?.sediu || null,
        articole,
        tva_pct: 21,
        valoare_neta: totals.neta,
        tva: totals.tva,
        total: totals.total,
        mod_plata: 'OP',
        termen_plata_zile: parseInt(termen),
        proiect_id: proiectDate?.id ? parseInt(proiectDate.id) : null,
        situatie_plata_ids: [sl.id],
        status: 'in_pregatire',
        titlu_scurt: sl.nr_situatie,
      }

      const { data: factData, error: errFact } = await supabase
        .from('facturi_emise').insert(payload).select('id').single()
      if (errFact) throw errFact

      // 4. UPDATE SL
      const { error: errSL } = await supabase.from('executie_situatii_plata')
        .update({
          status: 'facturata',
          nr_factura: `${serie}-${nrFinal}`,
          data_factura: dataFact,
          updated_at: new Date().toISOString(),
        }).eq('id', sl.id)
      if (errSL) throw errSL

      // 5. Salvează linii în BD dacă nu existau deja
      if (linii.length > 0 && !linii[0].id) {
        await supabase.from('executie_situatii_plata_linii').insert(
          linii.map((l, i) => ({
            sl_id: sl.id, ord: i + 1, tip: l.tip || 'lucr_cm',
            denumire: l.denumire.trim(), valoare: parseFloat(l.valoare),
            um: l.um || 'buc', cantitate: 1, tva_pct: parseFloat(l.tva_pct) || 21,
            sl_ref_nr: l.sl_ref_nr || null, sursa: 'manual',
          }))
        )
      }

      showToast(`✅ Factura ${nr_complet} emisă!`, 'ok')
      onSuccess(nr_complet)
    } catch(e) {
      showToast('Eroare: ' + e.message, 'err')
    } finally {
      setEmiting(false)
    }
  }

  if (loadingBenef || loadingLinii) {
    return (
      <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.85)',zIndex:1030,display:'flex',alignItems:'center',justifyContent:'center'}}>
        <div style={{background:G.surface,borderRadius:14,padding:40,color:G.muted}}>⏳ Se încarcă...</div>
      </div>
    )
  }

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.88)',zIndex:1030,
      display:'flex',alignItems:'center',justifyContent:'center',padding:16,overflowY:'auto'}}
      onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{background:G.surface,border:`1px solid ${G.green}`,borderRadius:14,
        width:'100%',maxWidth:760,maxHeight:'92vh',overflow:'auto'}}>

        {/* Header */}
        <div style={{padding:'16px 22px',borderBottom:`1px solid ${G.border}`,
          display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <div>
            <div style={{fontSize:16,fontWeight:800}}>📄 Emite factură — {sl.nr_situatie}</div>
            <div style={{fontSize:12,color:G.muted,marginTop:2}}>
              {luna} {an} · {proiectDate?.cod_intern || proiectDate?.beneficiar || ''}
            </div>
          </div>
          <button onClick={onClose} style={{background:'transparent',border:'none',color:G.muted,fontSize:22,cursor:'pointer'}}>×</button>
        </div>

        <div style={{padding:'18px 22px',display:'flex',flexDirection:'column',gap:14}}>

          {/* Discrepanță certificat */}
          {sl.discrepanta_lei && parseFloat(sl.discrepanta_lei) < -1 && (
            <div style={{background:G.yellow+'11',border:`1px solid ${G.yellow}44`,
              borderRadius:8,padding:'10px 14px',fontSize:13}}>
              <span style={{color:G.yellow,fontWeight:700}}>⚠️ Beneficiarul a tăiat {fmtLei(Math.abs(sl.discrepanta_lei))} față de suma din XLS</span>
              <span style={{color:G.muted,marginLeft:8}}>Suma facturată va fi cea din certificat</span>
            </div>
          )}

          {/* Beneficiar + Serie + Data */}
          <div style={{display:'grid',gridTemplateColumns:'1fr auto auto',gap:12,alignItems:'end'}}>
            <div>
              <label style={S.label}>Beneficiar</label>
              <div style={{...S.input,background:G.card,cursor:'default',color:benef?.nume?G.text:G.dim}}>
                {benef?.nume || '— lipsă beneficiar (adaugă contract proiectului)'}
              </div>
            </div>
            <div style={{width:90}}>
              <label style={S.label}>Serie</label>
              <select value={serie} onChange={e=>setSerie(e.target.value)} style={S.input}>
                {['GAZ','PH','PX'].map(s=><option key={s}>{s}</option>)}
              </select>
            </div>
            <div style={{width:140}}>
              <label style={S.label}>Data facturii</label>
              <input type="date" value={dataFact} onChange={e=>setDataFact(e.target.value)} style={S.input}/>
            </div>
          </div>

          {/* Termen plată */}
          <div style={{display:'grid',gridTemplateColumns:'auto 1fr',gap:12,alignItems:'end'}}>
            <div style={{width:160}}>
              <label style={S.label}>Termen plată (zile)</label>
              <input type="number" value={termen} onChange={e=>setTermen(e.target.value)}
                style={S.input} min={1} max={365}/>
            </div>
            {benef?.cif && (
              <div style={{fontSize:12,color:G.muted,paddingBottom:10}}>
                {benef.cif} · {benef.banca || ''}
              </div>
            )}
          </div>

          {/* Articole */}
          <div>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
              <label style={S.label}>Articole factură</label>
              <button onClick={addLinie} style={{
                padding:'4px 10px',background:G.border2,border:'none',
                borderRadius:6,color:G.muted,cursor:'pointer',fontSize:12
              }}>＋ Adaugă</button>
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:6}}>
              {linii.map((l,i) => (
                <div key={i} style={{background:G.card,borderRadius:8,padding:'10px 12px',
                  display:'flex',flexDirection:'column',gap:6}}>
                  <div style={{display:'flex',gap:8,alignItems:'flex-start'}}>
                    <div style={{flex:1}}>
                      <input
                        value={l.denumire}
                        onChange={e=>updateLinie(i,'denumire',e.target.value)}
                        style={{...S.input,fontSize:12}}
                        placeholder="Denumire articol..."
                      />
                    </div>
                    <button onClick={()=>removeLinie(i)} style={{
                      padding:'8px',background:G.red+'22',border:'none',
                      borderRadius:6,color:G.red,cursor:'pointer',fontSize:12,flexShrink:0
                    }}>🗑</button>
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 80px 80px',gap:8}}>
                    <div>
                      <input
                        type="number"
                        value={l.valoare}
                        onChange={e=>updateLinie(i,'valoare',parseFloat(e.target.value)||0)}
                        style={{...S.input,fontSize:12,textAlign:'right'}}
                        placeholder="Valoare RON"
                        step="0.01"
                      />
                    </div>
                    <div>
                      <select value={l.tva_pct} onChange={e=>updateLinie(i,'tva_pct',parseFloat(e.target.value))}
                        style={{...S.input,fontSize:12}}>
                        <option value={21}>21% TVA</option>
                        <option value={0}>0% TVA</option>
                        <option value={5}>5% TVA</option>
                      </select>
                    </div>
                    <div style={{fontSize:11,color:G.dim,display:'flex',alignItems:'center',justifyContent:'flex-end'}}>
                      {fmtLei(parseFloat(l.valoare)||0)}
                    </div>
                  </div>
                  {/* Ref SL pentru ajustări */}
                  {l.tip === 'ajustare' && (
                    <div style={{display:'flex',gap:8,alignItems:'center'}}>
                      <label style={{...S.label,marginBottom:0,flexShrink:0}}>Ref. SL:</label>
                      <input value={l.sl_ref_nr||''} onChange={e=>updateLinie(i,'sl_ref_nr',e.target.value)}
                        style={{...S.input,width:100,fontSize:11}} placeholder="ex: SL3"/>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Totaluri */}
          <div style={{background:G.card,borderRadius:8,padding:'12px 16px',
            display:'flex',flexDirection:'column',gap:4}}>
            {[
              {label:'Valoare netă', value:totals.neta, color:G.text},
              {label:'TVA 21%', value:totals.tva, color:G.muted},
              {label:'TOTAL de plată', value:totals.total, color:G.green, bold:true},
            ].map((r,i)=>(
              <div key={i} style={{display:'flex',justifyContent:'space-between',
                fontSize:r.bold?15:13,fontWeight:r.bold?800:400,color:r.color}}>
                <span>{r.label}</span>
                <span style={{fontFamily:'monospace'}}>{fmtLei(r.value)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div style={{padding:'14px 22px',borderTop:`1px solid ${G.border}`,
          display:'flex',gap:10,justifyContent:'flex-end',background:G.bg,borderRadius:'0 0 14px 14px'}}>
          <button onClick={onClose} style={{
            padding:'9px 18px',background:G.border,border:'none',
            borderRadius:7,color:G.text,cursor:'pointer',fontSize:13
          }}>Anulează</button>
          <button onClick={handleEmite} disabled={emiting||!benef?.nume} style={{
            padding:'9px 22px',
            background:emiting||!benef?.nume?G.muted:G.green,
            border:'none',borderRadius:7,color:'#0D1117',
            fontSize:13,cursor:emiting||!benef?.nume?'not-allowed':'pointer',fontWeight:800,
          }}>
            {emiting ? '⏳ Se emite...' : `📄 Emite ${serie} ${fmtLei(totals.total)}`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════
// MODAL ACT ADIȚIONAL
// ══════════════════════════════════════════════════════════
function AAModal({ sl, onClose, onSaved, showToast }) {
  const [form, setForm] = useState({
    act_aditional_nr:   sl.act_aditional_nr   || '',
    act_aditional_data: sl.act_aditional_data  || '',
  })
  const [saving, setSaving] = useState(false)
  const set = (k,v) => setForm(f=>({...f,[k]:v}))

  const handleSave = async () => {
    if (!form.act_aditional_nr.trim()) { showToast('Numărul AA este obligatoriu', 'err'); return }
    setSaving(true)
    try {
      const { error } = await supabase.from('executie_situatii_plata')
        .update({
          act_aditional_nr:   form.act_aditional_nr.trim().toUpperCase(),
          act_aditional_data: form.act_aditional_data || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', sl.id)
      if (error) throw error
      showToast(`Act Adițional ${form.act_aditional_nr} salvat! ✅`, 'ok')
      onSaved()
    } catch(e) {
      showToast('Eroare: ' + e.message, 'err')
    } finally { setSaving(false) }
  }

  return (
    <div style={{
      position:'fixed', inset:0, background:'rgba(0,0,0,.85)', zIndex:1020,
      display:'flex', alignItems:'center', justifyContent:'center', padding:24,
    }} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{
        background:G.surface, border:`1px solid ${G.orange}`, borderRadius:14,
        width:'100%', maxWidth:420,
      }}>
        <div style={{padding:'16px 20px', borderBottom:`1px solid ${G.border}`, display:'flex', alignItems:'center', justifyContent:'space-between'}}>
          <div>
            <div style={{fontSize:15, fontWeight:700}}>⚠️ Act Adițional — {sl.nr_situatie}</div>
            <div style={{fontSize:12, color:G.muted, marginTop:2}}>
              Ajustare inflație: <span style={{color:G.orange, fontWeight:600}}>{fmtLei(sl.valoare_ajustare_lei)}</span> neacoperită
            </div>
          </div>
          <button onClick={onClose} style={{background:'transparent', border:'none', color:G.muted, fontSize:22, cursor:'pointer'}}>×</button>
        </div>
        <div style={{padding:'18px 20px', display:'flex', flexDirection:'column', gap:12}}>
          <div>
            <label style={S.label}>Număr Act Adițional *</label>
            <input value={form.act_aditional_nr} onChange={e=>set('act_aditional_nr',e.target.value)}
              style={S.input} placeholder="ex: AA1, AA2" autoFocus />
          </div>
          <div>
            <label style={S.label}>Data semnării</label>
            <input type="date" value={form.act_aditional_data} onChange={e=>set('act_aditional_data',e.target.value)} style={S.input} />
          </div>
          <div style={{
            background:G.orange+'11', border:`1px solid ${G.orange}33`,
            borderRadius:8, padding:'10px 12px', fontSize:12, color:G.muted,
          }}>
            După salvare, alerta dispare automat pentru <strong style={{color:G.text}}>{sl.nr_situatie}</strong>.
          </div>
        </div>
        <div style={{padding:'12px 20px', borderTop:`1px solid ${G.border}`, display:'flex', gap:10, justifyContent:'flex-end', background:G.bg, borderRadius:'0 0 14px 14px'}}>
          <button onClick={onClose} style={{padding:'9px 16px', background:G.border, border:'none', borderRadius:7, color:G.text, cursor:'pointer', fontSize:13}}>Anulează</button>
          <button onClick={handleSave} disabled={saving} style={{
            padding:'9px 18px', background:saving?G.muted:G.orange, border:'none',
            borderRadius:7, color:'#0D1117', fontSize:13, cursor:saving?'not-allowed':'pointer', fontWeight:700,
          }}>{saving ? 'Se salvează...' : '✅ Salvează AA'}</button>
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════
// MODAL ADAUGARE / EDITARE SL (extins cu upload XLS + PDF)
// ══════════════════════════════════════════════════════════
function SLModal({ item, proiectId, proiectDate, onClose, onSaved, showToast }) {
  const isNew = !item?.id
  const [form, setForm] = useState({
    nr_situatie:        item?.nr_situatie || '',
    tip:                item?.tip || 'situatie_plata',
    luna:               item?.luna || '',
    an:                 item?.an || new Date().getFullYear(),
    data_depunere:      item?.data_depunere || '',
    valoare_baza_lei:   item?.valoare_baza_lei || '',
    coeficient_ajustare: item?.coeficient_ajustare || '1.000000',
    status:             item?.status || 'in_pregatire',
    nr_factura:         item?.nr_factura || '',
    data_factura:       item?.data_factura || '',
    observatii:         item?.observatii || '',
    certificat_plata_nr:   item?.certificat_plata_nr || '',
    certificat_plata_data: item?.certificat_plata_data || '',
  })
  const [saving, setSaving] = useState(false)
  const [xlsFile, setXlsFile] = useState(null)
  const [xlsResult, setXlsResult] = useState(null)
  const [xlsParsing, setXlsParsing] = useState(false)
  const [pdfFile, setPdfFile] = useState(null)
  const [pdfParsing, setPdfParsing] = useState(false)
  const [pdfResult, setPdfResult] = useState(null)
  const [discrepanta, setDiscrepanta] = useState(null)
  const xlsRef = useRef()
  const pdfRef = useRef()
  const set = (k,v) => setForm(f=>({...f,[k]:v}))

  // ── Ajustări retroactive: SL anterioare recuperate în ACEASTĂ situație ──
  const [slAnterioare, setSlAnterioare] = useState([]) // SL-urile proiectului (pentru dropdown)
  const [ajustari, setAjustari] = useState([])         // [{ sl_ajustata_id, sl_ajustata_nr, valoare_ajustare_lei, coeficient, observatii, xlsFile, xlsPath, parsing }]

  // Încarcă SL-urile proiectului + (la edit) ajustările deja salvate
  useEffect(() => {
    let cancel = false
    const load = async () => {
      // SL-urile aceluiași proiect, fără cea curentă (candidate pentru recuperare)
      const { data: sls } = await supabase
        .from('executie_situatii_plata')
        .select('id, nr_situatie, luna, an, valoare_ajustare_lei, ajustare_recuperata, ajustare_recuperata_in_sl')
        .eq('proiect_id', proiectId)
        .order('an', { ascending: true }).order('luna', { ascending: true })
      if (cancel) return
      setSlAnterioare((sls || []).filter(s => s.id !== item?.id))

      // La editare: trag ajustările existente
      if (item?.id) {
        const { data: ajs } = await supabase
          .from('executie_sl_ajustari')
          .select('*').eq('sl_id', item.id).order('id', { ascending: true })
        if (cancel) return
        setAjustari((ajs || []).map(a => ({
          sl_ajustata_id: a.sl_ajustata_id ? String(a.sl_ajustata_id) : '',
          sl_ajustata_nr: a.sl_ajustata_nr || '',
          valoare_ajustare_lei: a.valoare_ajustare_lei != null ? String(a.valoare_ajustare_lei) : '',
          coeficient: a.coeficient != null ? String(a.coeficient) : '',
          observatii: a.observatii || '',
          centralizator_xls_path: a.centralizator_xls_path || null,
          xlsFile: null, xlsPath: a.centralizator_xls_path || null, parsing: false,
        })))
      }
    }
    load()
    return () => { cancel = true }
  }, [proiectId, item?.id])

  const addAjustare = () => setAjustari(a => [...a, {
    sl_ajustata_id:'', sl_ajustata_nr:'', valoare_ajustare_lei:'', coeficient:'',
    observatii:'', xlsFile:null, xlsPath:null, parsing:false,
  }])
  const removeAjustare = (idx) => setAjustari(a => a.filter((_,i) => i !== idx))
  const updateAjustare = (idx, key, val) => setAjustari(a => a.map((row,i) => {
    if (i !== idx) return row
    const next = { ...row, [key]: val }
    // Când selectezi SL anterioară, auto-completează nr_situatie (editabil)
    if (key === 'sl_ajustata_id') {
      const sel = slAnterioare.find(s => String(s.id) === String(val))
      if (sel) next.sl_ajustata_nr = sel.nr_situatie
    }
    return next
  }))

  // Parsare XLS borderou de ajustare → completează valoare + coeficient (editabile)
  const parseAjustareXls = async (idx, file) => {
    if (!file) return
    setAjustari(a => a.map((r,i) => i===idx ? {...r, xlsFile:file, parsing:true} : r))
    try {
      const result = await parseBorderouAjustatXLS(file)
      const val = (result.totalAjustare && result.totalAjustare > 0) ? result.totalAjustare : result.totalBaza
      setAjustari(a => a.map((r,i) => i===idx ? {
        ...r,
        valoare_ajustare_lei: val ? String(val) : r.valoare_ajustare_lei,
        coeficient: result.coeficient ? String(result.coeficient) : r.coeficient,
        parsing:false,
      } : r))
    } catch(e) {
      showToast('Eroare parsare XLS ajustare: ' + e.message, 'err')
      setAjustari(a => a.map((r,i) => i===idx ? {...r, parsing:false} : r))
    }
  }

  const totalAjustariRetro = useMemo(
    () => ajustari.reduce((s,a) => s + (parseFloat(a.valoare_ajustare_lei) || 0), 0),
    [ajustari]
  )

  const valAjustata = useMemo(() => {
    const b = parseFloat(form.valoare_baza_lei)
    const c = parseFloat(form.coeficient_ajustare)
    if (isNaN(b) || isNaN(c)) return null
    return Math.round((b * c - b) * 100) / 100
  }, [form.valoare_baza_lei, form.coeficient_ajustare])

  // Parsare XLS borderou ajustat
  const handleXlsParse = async (file) => {
    if (!file) return
    setXlsParsing(true)
    try {
      const result = await parseBorderouAjustatXLS(file)
      setXlsResult(result)
      // Auto-completare câmpuri formular
      if (result.totalBaza) set('valoare_baza_lei', String(result.totalBaza))
      if (result.coeficient) set('coeficient_ajustare', String(result.coeficient))
      if (result.nrSL && !form.nr_situatie) set('nr_situatie', result.tip === 'habau_ipc' ? result.nrSL : `SL${result.nrSL}`)
      // Habau IPC: pre-completează luna/an din perioada certificatului
      if (result.tip === 'habau_ipc') {
        if (result.luna && form.luna === '') set('luna', String(result.luna))
        if (result.an) set('an', String(result.an))
      }
      // Recalculează discrepanță dacă există deja PDF
      if (pdfResult?.valoare_totala_fara_tva && result.totalBaza) {
        const ajust = result.totalAjustare || 0
        const certTotal = parseFloat(pdfResult.valoare_totala_fara_tva)
        setDiscrepanta(certTotal - (result.totalBaza + ajust))
      }
    } catch(e) {
      showToast('Eroare parsare XLS: ' + e.message, 'err')
    } finally { setXlsParsing(false) }
  }

  // Parsare PDF Certificat TGZ via edge function
  const handlePdfParse = async (file) => {
    if (!file) return
    setPdfParsing(true)
    try {
      const base64 = await fileToBase64(file)
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/parse-certificat-plata`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({ pdf_base64: base64, media_type: file.type || 'application/pdf' }),
        }
      )
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Eroare edge function')
      setPdfResult(result)
      // Auto-completare certificat
      if (result.nr_certificat) set('certificat_plata_nr', result.nr_certificat)
      if (result.data_certificat) set('certificat_plata_data', result.data_certificat)
      // Calculează discrepanță față de XLS
      if (xlsResult?.totalBaza && result.valoare_totala_fara_tva) {
        const totalXLS = (xlsResult.totalBaza || 0) + (xlsResult.totalAjustare || 0)
        const disc = parseFloat(result.valoare_totala_fara_tva) - totalXLS
        setDiscrepanta(disc)
      }
    } catch(e) {
      showToast('Eroare parsare PDF: ' + e.message, 'err')
    } finally { setPdfParsing(false) }
  }

  const handleSave = async () => {
    if (!form.nr_situatie.trim()) { showToast('Numărul situației este obligatoriu', 'err'); return }
    setSaving(true)
    try {
      const slNrClean = form.nr_situatie.toLowerCase().replace(/[^a-z0-9]/g, '_')
      const xlsPath = xlsFile ? `sl_${proiectId}/${slNrClean}_borderou.xls` : item?.centralizator_xls_path
      const pdfPath = pdfFile ? `sl_${proiectId}/${slNrClean}_certificat.pdf` : item?.certificat_pdf_path

      // Upload XLS/PDF (silentios la eroare — parsarea e client-side, storage e doar arhivare)
      if (xlsFile && xlsPath) {
        try { await supabase.storage.from('executie-borderouri').upload(xlsPath, xlsFile, { upsert: true, contentType: xlsFile.type || 'application/vnd.ms-excel' }) } catch(e) { console.warn('Upload XLS skip:', e.message) }
      }
      if (pdfFile && pdfPath) {
        try { await supabase.storage.from('executie-borderouri').upload(pdfPath, pdfFile, { upsert: true, contentType: pdfFile.type || 'application/pdf' }) } catch(e) { console.warn('Upload PDF skip:', e.message) }
      }

      const valBaza = xlsResult?.totalBaza || (form.valoare_baza_lei !== '' ? parseFloat(form.valoare_baza_lei) : null)
      const valAj   = xlsResult?.totalAjustare || (() => {
        const b = parseFloat(form.valoare_baza_lei)
        const c = parseFloat(form.coeficient_ajustare)
        if (isNaN(b) || isNaN(c) || c === 1) return 0
        return Math.round((b * c - b) * 100) / 100
      })()
      const certVal = pdfResult?.valoare_totala_fara_tva || null

      // Determină status automat
      let statusAuto = form.status
      if (pdfResult && certVal) {
        const disc = certVal - ((valBaza||0) + (valAj||0))
        if (Math.abs(disc) <= 1 || disc > -50000) {
          // Certificat primit și valoare OK sau discrepanță acceptabilă
          statusAuto = 'aprobata'
        }
      }

      const payload = {
        proiect_id:              proiectId,
        nr_situatie:             form.nr_situatie.trim().toUpperCase(),
        tip:                     form.tip,
        luna:                    form.luna !== '' ? parseInt(form.luna) : null,
        an:                      form.an ? parseInt(form.an) : null,
        data_depunere:           form.data_depunere || null,
        valoare_baza_lei:        valBaza,
        coeficient_ajustare:     parseFloat(form.coeficient_ajustare) || 1,
        valoare_ajustare_lei:    valAj,
        // valoare_ajustata_lei e GENERATED ALWAYS in BD — nu se include in payload
        status:                  statusAuto,
        nr_factura:              form.nr_factura.trim() || null,
        data_factura:            form.data_factura || null,
        observatii:              form.observatii.trim() || null,
        // Câmpuri noi
        certificat_plata_nr:     form.certificat_plata_nr.trim() || null,
        certificat_plata_data:   form.certificat_plata_data || null,
        certificat_plata_valoare: certVal,
        centralizator_xls_path:  xlsPath || null,
        certificat_pdf_path:     pdfPath || null,
        discrepanta_lei:         discrepanta,
        updated_at:              new Date().toISOString(),
      }

      let slIdSaved = item?.id
      if (isNew) {
        const { data: insertData, error } = await supabase
          .from('executie_situatii_plata').insert(payload).select('id').single()
        if (error) throw error
        slIdSaved = insertData?.id
      } else {
        const { error } = await supabase.from('executie_situatii_plata').update(payload).eq('id', item.id)
        if (error) throw error
      }

      // Salvează linii din XLS în BD — suportă centralizator multi-linii (Prunisor) + borderou simplu (Caldararu)
      if (xlsResult && slIdSaved) {
        // Ștergem linii existente la update (re-parsare XLS)
        await supabase.from('executie_situatii_plata_linii').delete().eq('sl_id', slIdSaved)
        {
          const slId = slIdSaved
          const nr = proiectDate?.nr_contract ? ` conf. contract nr. ${proiectDate.nr_contract}` : ''
          const lunaStr = xlsResult.lunaAn ? ` / ${xlsResult.lunaAn}` : ''
          const bdLinii = []

          if (xlsResult.tip === 'habau_ipc' && xlsResult.linii?.length > 0) {
            // HABAU IPC: linie brută (TVA 21) + rețineri negative (TVA 0), exact ca pe factura GAZ-359
            let ord = 1
            for (const linie of xlsResult.linii) {
              bdLinii.push({
                sl_id: slId, ord: ord++, tip: linie.tip || 'lucr_cm',
                denumire: linie.denumire,
                valoare: linie.valoare,
                tva_pct: linie.tva_pct != null ? linie.tva_pct : 21,
                sursa: 'xls',
              })
            }
          } else if (xlsResult.tip === 'centralizator' && xlsResult.linii?.length > 0) {
            // CENTRALIZATOR (Prunisor): rânduri separate + ajustări per linie
            let ord = 1
            for (const linie of xlsResult.linii) {
              if (linie.valoare > 0) {
                bdLinii.push({
                  sl_id: slId, ord: ord++, tip: 'lucr_cm',
                  denumire: linie.denumire || `Lucrări${nr}`,
                  valoare: linie.valoare, tva_pct: 21, sursa: 'xls',
                })
              }
            }
            for (const linie of xlsResult.linii) {
              if (linie.ajustare > 0) {
                bdLinii.push({
                  sl_id: slId, ord: ord++, tip: 'ajustare',
                  denumire: `Ajustare ICC — ${linie.denumire.slice(0, 80) || payload.nr_situatie}`,
                  valoare: linie.ajustare, tva_pct: 21, sursa: 'xls',
                })
              }
            }
          } else {
            // BORDEROU simplu (Caldararu): 1 total + 1 ajustare
            if (xlsResult.totalBaza) {
              bdLinii.push({
                sl_id: slId, ord: 1, tip: 'lucr_cm',
                denumire: `Lucrări C+M — ${payload.nr_situatie}${lunaStr}${nr}`,
                valoare: xlsResult.totalBaza, tva_pct: 21, sursa: 'xls',
              })
            }
            if (xlsResult.totalAjustare) {
              bdLinii.push({
                sl_id: slId, ord: 2, tip: 'ajustare',
                denumire: `Ajustare ICC${xlsResult.coeficient ? ' ×' + xlsResult.coeficient : ''} — ${payload.nr_situatie}`,
                valoare: xlsResult.totalAjustare, tva_pct: 21,
                coeficient_ajustare: xlsResult.coeficient, sursa: 'xls',
              })
            }
          }

          if (bdLinii.length > 0) {
            await supabase.from('executie_situatii_plata_linii').insert(bdLinii)
          }
        }
      }

      // ── Ajustări retroactive: salvare one-to-many + marcaj SL recuperate ──
      if (slIdSaved) {
        // 1) Reset: dez-marchează SL-urile care erau recuperate de ACEASTĂ SL (curat la re-editare)
        await supabase.from('executie_situatii_plata')
          .update({ ajustare_recuperata:false, ajustare_recuperata_in_sl:null })
          .eq('ajustare_recuperata_in_sl', slIdSaved)
        // 2) Șterge ajustările vechi ale acestei SL (re-inserăm starea curentă)
        await supabase.from('executie_sl_ajustari').delete().eq('sl_id', slIdSaved)

        // 3) Upload XLS borderou per ajustare (silent la eroare — arhivare) + construiește rândurile
        const slNrClean2 = form.nr_situatie.toLowerCase().replace(/[^a-z0-9]/g, '_')
        const ajRows = []
        for (let i = 0; i < ajustari.length; i++) {
          const a = ajustari[i]
          const val = parseFloat(a.valoare_ajustare_lei)
          if (isNaN(val) || val <= 0) continue
          let ajPath = a.xlsPath || null
          if (a.xlsFile) {
            ajPath = `sl_${proiectId}/${slNrClean2}_ajustare_${i + 1}.xls`
            try { await supabase.storage.from('executie-borderouri').upload(ajPath, a.xlsFile, { upsert:true, contentType:a.xlsFile.type || 'application/vnd.ms-excel' }) } catch(e) { console.warn('Upload XLS ajustare skip:', e.message) }
          }
          ajRows.push({
            sl_id: slIdSaved,
            sl_ajustata_id: a.sl_ajustata_id ? parseInt(a.sl_ajustata_id) : null,
            sl_ajustata_nr: a.sl_ajustata_nr?.trim() || null,
            valoare_ajustare_lei: Math.round(val * 100) / 100,
            coeficient: (a.coeficient !== '' && a.coeficient != null && !isNaN(parseFloat(a.coeficient))) ? parseFloat(a.coeficient) : null,
            centralizator_xls_path: ajPath,
            observatii: a.observatii?.trim() || null,
          })
        }

        // 4) Inserează ajustările noi
        if (ajRows.length > 0) {
          const { error: ajErr } = await supabase.from('executie_sl_ajustari').insert(ajRows)
          if (ajErr) throw ajErr
          // 5) Marchează SL-urile anterioare ca recuperate în SL curentă
          const recIds = [...new Set(ajRows.filter(r => r.sl_ajustata_id).map(r => r.sl_ajustata_id))]
          if (recIds.length > 0) {
            await supabase.from('executie_situatii_plata')
              .update({ ajustare_recuperata:true, ajustare_recuperata_in_sl: slIdSaved })
              .in('id', recIds)
          }
        }
      }

      showToast(isNew ? 'Situație adăugată!' : 'Situație actualizată!', 'ok')
      onSaved()
    } catch(e) {
      showToast('Eroare: ' + e.message, 'err')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{
      position:'fixed', inset:0, background:'rgba(0,0,0,.8)', zIndex:1010,
      display:'flex', alignItems:'center', justifyContent:'center', padding:16,
    }} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{
        background:G.surface, border:`1px solid ${G.border}`, borderRadius:14,
        width:'100%', maxWidth:620, maxHeight:'92vh', overflow:'auto',
      }}>
        <div style={{padding:'18px 24px', borderBottom:`1px solid ${G.border}`, display:'flex', alignItems:'center', justifyContent:'space-between'}}>
          <div style={{fontSize:16, fontWeight:700}}>{isNew ? '＋ Situație nouă' : `✏️ ${item.nr_situatie}`}</div>
          <button onClick={onClose} style={{background:'transparent', border:'none', color:G.muted, fontSize:22, cursor:'pointer'}}>×</button>
        </div>

        <div style={{padding:'20px 24px', display:'flex', flexDirection:'column', gap:14}}>
          {/* Date de baza */}
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12}}>
            <div>
              <label style={S.label}>Număr situație *</label>
              <input value={form.nr_situatie} onChange={e=>set('nr_situatie',e.target.value)} style={S.input} placeholder="SL1, SL2, NCS..." />
            </div>
            <div>
              <label style={S.label}>Tip</label>
              <select value={form.tip} onChange={e=>set('tip',e.target.value)} style={S.input}>
                {Object.entries(TIP_SL).map(([k,v])=>(
                  <option key={k} value={k}>{v.icon} {v.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12}}>
            <div>
              <label style={S.label}>Luna</label>
              <select value={form.luna} onChange={e=>set('luna',e.target.value)} style={S.input}>
                <option value="">—</option>
                {LUNI.map((l,i)=><option key={i} value={i+1}>{l}</option>)}
              </select>
            </div>
            <div>
              <label style={S.label}>Anul</label>
              <input type="number" value={form.an} onChange={e=>set('an',e.target.value)} style={S.input} min="2020" max="2030" />
            </div>
            <div>
              <label style={S.label}>Data depunere</label>
              <input type="date" value={form.data_depunere} onChange={e=>set('data_depunere',e.target.value)} style={S.input} />
            </div>
          </div>

          {/* Separator Upload documente */}
          <div style={{borderTop:`1px solid ${G.border}`, paddingTop:14}}>
            <div style={{fontSize:13, fontWeight:700, color:G.blue, marginBottom:10}}>
              📎 Documente borderou
            </div>

            {/* XLS Upload */}
            <div style={{marginBottom:10}}>
              <label style={S.label}>📊 XLS Centralizator / Borderou Ajustat</label>
              <div style={{display:'flex', gap:8, alignItems:'center'}}>
                <button onClick={()=>xlsRef.current?.click()} style={{
                  padding:'8px 14px', background:G.border2, border:`1px dashed ${G.border}`,
                  borderRadius:7, color:G.muted, cursor:'pointer', fontSize:12, flexShrink:0,
                }}>
                  {xlsFile ? `✅ ${xlsFile.name}` : '📂 Centralizator sau Borderou (.xlsx/.xls)...'}
                </button>
                {xlsFile && !xlsResult && !xlsParsing && (
                  <button onClick={()=>handleXlsParse(xlsFile)} style={{
                    padding:'8px 14px', background:G.blue+'22', border:`1px solid ${G.blue}44`,
                    borderRadius:7, color:G.blue, cursor:'pointer', fontSize:12,
                  }}>🔍 Parsează</button>
                )}
                {xlsParsing && <span style={{color:G.muted, fontSize:12}}>⏳ Se parsează...</span>}
                <input ref={xlsRef} type="file" accept=".xls,.xlsx" style={{display:'none'}}
                  onChange={e=>{const f=e.target.files?.[0]; if(f){setXlsFile(f); setXlsResult(null); handleXlsParse(f)}}}/>
              </div>
              {xlsResult && (
                <div style={{marginTop:8, background:G.blue+'0D', border:`1px solid ${G.blue}33`,
                  borderRadius:7, padding:'8px 12px', fontSize:12}}>
                  <div style={{color:G.blue, fontWeight:700, marginBottom:4}}>✅ XLS parsat</div>
                  {xlsResult.totalBaza && <div style={{color:G.muted}}>{xlsResult.tip === 'habau_ipc' ? 'Valoare lună (brut)' : 'Total devize (bază)'}: <span style={{color:G.text, fontFamily:'monospace'}}>{fmtLei(xlsResult.totalBaza)}</span></div>}
                  {xlsResult.totalOS != null && xlsResult.totalOS > 0 && <div style={{color:G.muted}}>din care OS (organizare șantier): <span style={{color:G.text, fontFamily:'monospace'}}>{fmtLei(xlsResult.totalOS)}</span></div>}
                  {xlsResult.totalAjustare && <div style={{color:G.muted}}>Ajustare ICC: <span style={{color:G.yellow, fontFamily:'monospace'}}>{fmtLei(xlsResult.totalAjustare)}</span>{xlsResult.coeficient && ` (×${xlsResult.coeficient})`}</div>}
                  {xlsResult.tip === 'habau_ipc' && (xlsResult.retinereGBE || xlsResult.retinereCAR) && (
                    <>
                      {xlsResult.retinereGBE ? <div style={{color:G.muted}}>Reținere GBE (10%): <span style={{color:G.red, fontFamily:'monospace'}}>{fmtLei(xlsResult.retinereGBE)}</span></div> : null}
                      {xlsResult.retinereCAR ? <div style={{color:G.muted}}>Reținere CAR (0.3%): <span style={{color:G.red, fontFamily:'monospace'}}>{fmtLei(xlsResult.retinereCAR)}</span></div> : null}
                      <div style={{color:G.muted}}>Net de plată: <span style={{color:G.green, fontFamily:'monospace', fontWeight:700}}>{fmtLei(xlsResult.net)}</span></div>
                    </>
                  )}
                  {xlsResult.tip !== 'habau_ipc' && (xlsResult.totalBaza || 0) + (xlsResult.totalAjustare || 0) > 0 && (
                    <div style={{color:G.muted}}>Total ajustat: <span style={{color:G.green, fontFamily:'monospace', fontWeight:700}}>
                      {fmtLei((xlsResult.totalBaza||0) + (xlsResult.totalAjustare||0))}
                    </span></div>
                  )}
                </div>
              )}
            </div>

            {/* PDF Certificat */}
            <div>
              <label style={S.label}>📜 PDF Certificat Plată TGZ</label>
              <div style={{display:'flex', gap:8, alignItems:'center'}}>
                <button onClick={()=>pdfRef.current?.click()} style={{
                  padding:'8px 14px', background:G.border2, border:`1px dashed ${G.border}`,
                  borderRadius:7, color:G.muted, cursor:'pointer', fontSize:12, flexShrink:0,
                }}>
                  {pdfFile ? `✅ ${pdfFile.name}` : '📂 Alege PDF...'}
                </button>
                {pdfParsing && <span style={{color:G.muted, fontSize:12}}>⏳ Haiku citește suma... (~3 bani)</span>}
                <input ref={pdfRef} type="file" accept=".pdf,image/jpeg,image/png" style={{display:'none'}}
                  onChange={e=>{const f=e.target.files?.[0]; if(f){setPdfFile(f); setPdfResult(null); handlePdfParse(f)}}}/>
              </div>
              {pdfResult && (
                <div style={{marginTop:8, background:G.green+'0D', border:`1px solid ${G.green}33`,
                  borderRadius:7, padding:'8px 12px', fontSize:12}}>
                  <div style={{color:G.green, fontWeight:700, marginBottom:4}}>✅ Certificat parsat</div>
                  <div style={{color:G.muted}}>Nr: <span style={{color:G.text}}>{pdfResult.nr_certificat || '—'}</span></div>
                  <div style={{color:G.muted}}>Suma aprobată TGZ: <span style={{color:G.green, fontFamily:'monospace', fontWeight:700}}>
                    {fmtLei(pdfResult.valoare_totala_fara_tva)}
                  </span></div>
                  {pdfResult.confidence < 0.7 && (
                    <div style={{color:G.yellow, marginTop:4}}>⚠️ Confidence scăzut ({Math.round(pdfResult.confidence*100)}%) — verifică manual</div>
                  )}
                </div>
              )}

              {/* Discrepanță */}
              {discrepanta !== null && Math.abs(discrepanta) > 1 && (
                <div style={{marginTop:8, background:discrepanta < 0 ? G.yellow+'11' : G.green+'0D',
                  border:`1px solid ${discrepanta < 0 ? G.yellow : G.green}44`,
                  borderRadius:7, padding:'8px 12px', fontSize:12}}>
                  {discrepanta < 0
                    ? <><span style={{color:G.yellow, fontWeight:700}}>⚠️ TGZ a tăiat {fmtLei(Math.abs(discrepanta))}</span>
                       <span style={{color:G.muted}}> față de suma din XLS. Factura se va emite cu suma certificat.</span></>
                    : <><span style={{color:G.green, fontWeight:700}}>✅ Sume corespund</span>
                       <span style={{color:G.muted}}> (diferență {fmtLei(Math.abs(discrepanta))} — rotunjiri)</span></>
                  }
                </div>
              )}
              {discrepanta !== null && Math.abs(discrepanta) <= 1 && (
                <div style={{marginTop:8, fontSize:12, color:G.green}}>✅ XLS = Certificat (diferență {fmtLei(Math.abs(discrepanta))})</div>
              )}
            </div>
          </div>

          {/* Valori manuale (dacă nu s-a uploadat XLS) */}
          {!xlsResult && (
            <>
              <div style={{borderTop:`1px solid ${G.border}`, paddingTop:14}}>
                <div style={{fontSize:12, color:G.muted, marginBottom:10}}>Sau completează manual:</div>
                <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12}}>
                  <div>
                    <label style={S.label}>Valoare bază (RON)</label>
                    <input type="number" value={form.valoare_baza_lei} onChange={e=>set('valoare_baza_lei',e.target.value)}
                      style={S.input} placeholder="0.00" step="0.01" min="0" />
                  </div>
                  <div>
                    <label style={S.label}>Coeficient ajustare</label>
                    <input type="number" value={form.coeficient_ajustare} onChange={e=>set('coeficient_ajustare',e.target.value)}
                      style={S.input} placeholder="1.000000" step="0.000001" />
                  </div>
                </div>
                {valAjustata !== null && (
                  <div style={{
                    marginTop:8, background:G.green+'11', border:`1px solid ${G.green}33`, borderRadius:8,
                    padding:'10px 14px', display:'flex', justifyContent:'space-between', alignItems:'center',
                  }}>
                    <span style={{fontSize:13, color:G.muted}}>Diferență ajustare ICC:</span>
                    <span style={{fontSize:15, fontWeight:800, color:G.green}}>{fmtLei(valAjustata)}</span>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Certificat manual dacă nu s-a uploadat PDF */}
          {!pdfResult && (
            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12}}>
              <div>
                <label style={S.label}>Nr. Certificat Plată</label>
                <input value={form.certificat_plata_nr} onChange={e=>set('certificat_plata_nr',e.target.value)}
                  style={S.input} placeholder="ex: 10/29.05.2026"/>
              </div>
              <div>
                <label style={S.label}>Data Certificat</label>
                <input type="date" value={form.certificat_plata_data} onChange={e=>set('certificat_plata_data',e.target.value)} style={S.input}/>
              </div>
            </div>
          )}

          {/* ── Ajustări retroactive SL anterioare ── */}
          <div style={{borderTop:`1px solid ${G.border}`, paddingTop:14}}>
            <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:4}}>
              <div style={{fontSize:13, fontWeight:700, color:G.orange}}>🔄 Ajustări retroactive SL anterioare</div>
              {totalAjustariRetro > 0 && (
                <span style={{fontSize:12, color:G.orange, fontFamily:'monospace', fontWeight:700}}>+{fmtLei(totalAjustariRetro)}</span>
              )}
            </div>
            <div style={{fontSize:11, color:G.muted, marginBottom:10}}>
              Recuperări de indice publicat ulterior, facturate odată cu această SL. Fiecare SL anterioară recuperată se marchează automat „ajustare recuperată".
            </div>

            {ajustari.map((a, idx) => {
              const slSel = slAnterioare.find(s => String(s.id) === String(a.sl_ajustata_id))
              const dejaRecAltundeva = slSel && slSel.ajustare_recuperata && String(slSel.ajustare_recuperata_in_sl) !== String(item?.id)
              return (
                <div key={idx} style={{
                  border:`1px solid ${G.orange}33`, background:G.orange+'08', borderRadius:9,
                  padding:'10px 12px', marginBottom:8,
                }}>
                  <div style={{display:'grid', gridTemplateColumns:'1.4fr 1fr 32px', gap:8, alignItems:'end'}}>
                    <div>
                      <label style={{...S.label, fontSize:11}}>SL anterioară recuperată</label>
                      <select value={a.sl_ajustata_id} onChange={e=>updateAjustare(idx,'sl_ajustata_id',e.target.value)} style={{...S.input, padding:'7px 9px', fontSize:12}}>
                        <option value="">— alege SL —</option>
                        {slAnterioare.map(s => (
                          <option key={s.id} value={s.id}>
                            {s.nr_situatie}{s.luna&&s.an?` · ${LUNI[s.luna-1]} ${s.an}`:''}{s.ajustare_recuperata && String(s.ajustare_recuperata_in_sl)!==String(item?.id) ? ' ⚠ deja recuperată' : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label style={{...S.label, fontSize:11}}>Valoare ajustare (RON)</label>
                      <input type="number" value={a.valoare_ajustare_lei} onChange={e=>updateAjustare(idx,'valoare_ajustare_lei',e.target.value)}
                        style={{...S.input, padding:'7px 9px', fontSize:12}} placeholder="0.00" step="0.01" min="0" />
                    </div>
                    <button onClick={()=>removeAjustare(idx)} title="Șterge ajustarea" style={{
                      padding:'7px 0', background:G.red+'18', border:`1px solid ${G.red}44`, borderRadius:7,
                      color:G.red, cursor:'pointer', fontSize:14, height:34,
                    }}>🗑</button>
                  </div>

                  <div style={{display:'grid', gridTemplateColumns:'1fr 1.4fr', gap:8, marginTop:8, alignItems:'end'}}>
                    <div>
                      <label style={{...S.label, fontSize:11}}>Coeficient (opțional)</label>
                      <input type="number" value={a.coeficient} onChange={e=>updateAjustare(idx,'coeficient',e.target.value)}
                        style={{...S.input, padding:'7px 9px', fontSize:12}} placeholder="ex: 1.063390" step="0.000001" />
                    </div>
                    <div>
                      <label style={{...S.label, fontSize:11}}>Borderou ajustare (XLS, opțional)</label>
                      <div style={{display:'flex', gap:6, alignItems:'center'}}>
                        <label style={{
                          padding:'7px 10px', background:G.border2, border:`1px dashed ${G.border}`, borderRadius:7,
                          color:G.muted, cursor:'pointer', fontSize:11, flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
                        }}>
                          {a.parsing ? '⏳ parsez...' : (a.xlsFile ? `✅ ${a.xlsFile.name}` : (a.xlsPath ? '✅ borderou salvat' : '📂 alege XLS...'))}
                          <input type="file" accept=".xls,.xlsx" style={{display:'none'}}
                            onChange={e=>{const f=e.target.files?.[0]; if(f) parseAjustareXls(idx,f)}} />
                        </label>
                      </div>
                    </div>
                  </div>

                  <div style={{marginTop:8}}>
                    <input value={a.observatii} onChange={e=>updateAjustare(idx,'observatii',e.target.value)}
                      style={{...S.input, padding:'7px 9px', fontSize:12}} placeholder="Observații (ex: I0=aug2024=140,4; In=mai2025=149,3)" />
                  </div>

                  {dejaRecAltundeva && (
                    <div style={{marginTop:6, fontSize:11, color:G.yellow}}>
                      ⚠️ {slSel.nr_situatie} e deja marcată ca recuperată în altă SL — verifică să nu dublezi facturarea.
                    </div>
                  )}
                </div>
              )
            })}

            <button onClick={addAjustare} style={{
              padding:'8px 14px', background:G.orange+'14', border:`1px dashed ${G.orange}55`,
              borderRadius:7, color:G.orange, cursor:'pointer', fontSize:12, fontWeight:600,
            }}>＋ Adaugă ajustare SL anterioară</button>
          </div>

          {/* Status + Factura */}
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12}}>
            <div>
              <label style={S.label}>Status</label>
              <select value={form.status} onChange={e=>set('status',e.target.value)} style={S.input}>
                {Object.entries(STATUS_SL).map(([k,v])=>(
                  <option key={k} value={k}>{v.icon} {v.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={S.label}>Nr. factură</label>
              <input value={form.nr_factura} onChange={e=>set('nr_factura',e.target.value)} style={S.input} placeholder="ex: GAZ-288" />
            </div>
          </div>

          {(form.status === 'facturata' || form.status === 'incasata') && (
            <div>
              <label style={S.label}>Data factură</label>
              <input type="date" value={form.data_factura} onChange={e=>set('data_factura',e.target.value)} style={S.input} />
            </div>
          )}

          <div>
            <label style={S.label}>Observații</label>
            <textarea value={form.observatii} onChange={e=>set('observatii',e.target.value)}
              style={{...S.input, resize:'vertical', minHeight:60}}
              placeholder="Note, referințe, detalii..." />
          </div>
        </div>

        <div style={{
          padding:'14px 24px', borderTop:`1px solid ${G.border}`,
          display:'flex', gap:10, justifyContent:'flex-end', background:G.bg,
        }}>
          <button onClick={onClose} style={{padding:'9px 18px', background:G.border, border:'none', borderRadius:7, color:G.text, cursor:'pointer', fontSize:13}}>Anulează</button>
          <button onClick={handleSave} disabled={saving} style={{
            padding:'9px 18px', background:saving?G.muted:G.executie, border:'none',
            borderRadius:7, color:'#0D1117', fontSize:13, cursor:saving?'not-allowed':'pointer', fontWeight:700,
          }}>{saving ? 'Se salvează...' : isNew ? '＋ Adaugă' : '💾 Salvează'}</button>
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════
export default function TabSituatiiPlata({ proiectId: proiectIdProp }) {
  const [proiecte, setProiecte]   = useState([])
  const [proiectId, setProiectId] = useState(proiectIdProp ? String(proiectIdProp) : '')
  const [lista, setLista]         = useState([])
  const [profile, setProfile]     = useState(null)
  const [loading, setLoading]     = useState(false)
  const [editItem, setEditItem]   = useState(null)
  const [deleteConf, setDeleteConf] = useState(null)
  const [aaModal, setAaModal]     = useState(null)
  const [emiteModal, setEmiteModal] = useState(null) // SL pentru emitere factură
  const [proiectDate, setProiectDate] = useState(null) // date complete proiect curent
  const { show: showToast, Toast } = useToast()

  useEffect(() => {
    const init = async () => {
      const { data:{user} } = await supabase.auth.getUser()
      if (user) {
        const { data:prof } = await supabase.from('profiles').select('id,is_owner,role,can_access_salarii').eq('id',user.id).single()
        setProfile(prof)
      }
      if (!proiectIdProp) {
        const { data } = await supabase.from('executie_proiecte')
          .select('id,cod_intern,nume,valoare_lei,activ,contract_id,beneficiar,nr_contract')
          .eq('activ',true).order('cod_intern')
        setProiecte(data || [])
        if (data?.length) setProiectId(String(data[0].id))
      }
    }
    init()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Sync cu prop
  useEffect(() => {
    if (proiectIdProp) setProiectId(String(proiectIdProp))
  }, [proiectIdProp])

  // Fetch date proiect curent
  useEffect(() => {
    if (!proiectId) return
    supabase.from('executie_proiecte')
      .select('id,cod_intern,beneficiar,nr_contract,contract_id')
      .eq('id', proiectId).single()
      .then(({ data }) => setProiectDate(data || null))
  }, [proiectId])

  const loadLista = useCallback(async () => {
    if (!proiectId) return
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('executie_situatii_plata')
        .select('*')
        .eq('proiect_id', proiectId)
        .order('an').order('luna').order('nr_situatie')
      if (error) throw error
      setLista(data || [])
    } catch(e) {
      showToast('Eroare: ' + e.message, 'err')
    } finally {
      setLoading(false)
    }
  }, [proiectId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadLista() }, [loadLista])

  const isOwner   = profile?.is_owner === true
  const canEdit   = isOwner || ['superadmin','manager_santier'].includes(profile?.role)
  const showValori = isOwner || profile?.can_access_salarii

  const nav = useNavigate()
  const [slFaraFactura, setSlFaraFactura] = useState([])
  useEffect(() => {
    if (!proiectId) return
    supabase.from('v_sl_fara_factura').select('id,nr_situatie,luna,an').eq('proiect_id', proiectId)
      .then(({ data }) => setSlFaraFactura(data || []))
  }, [proiectId, lista]) // eslint-disable-line react-hooks/exhaustive-deps

  const kpi = useMemo(() => {
    const sitPlata  = lista.filter(s=>s.tip==='situatie_plata')
    const totalBaza = lista.reduce((a,s)=>a+(parseFloat(s.valoare_baza_lei)||0),0)
    const totalAj   = lista.reduce((a,s)=>a+(parseFloat(s.valoare_ajustata_lei)||0),0)
    const facturate = lista.filter(s=>['facturata','incasata'].includes(s.status)).reduce((a,s)=>a+(parseFloat(s.valoare_ajustata_lei)||0),0)
    const inPreg    = lista.filter(s=>s.status==='in_pregatire').length
    const aprobate  = lista.filter(s=>['aprobata','facturata','incasata'].includes(s.status)).length
    const alerteAA  = lista.filter(s=>parseFloat(s.valoare_ajustare_lei||0)>0 && !s.act_aditional_nr).length
    const deFacturat = lista.filter(s=>s.status==='aprobata' && !s.nr_factura).length
    return { totalBaza, totalAj, facturate, inPreg, aprobate, nrSL: sitPlata.length, total: lista.length, alerteAA, deFacturat }
  }, [lista])

  const proiectCurent = proiecte.find(p=>String(p.id)===proiectId)

  const handleDelete = async (id) => {
    try {
      const { error } = await supabase.from('executie_situatii_plata').delete().eq('id', id)
      if (error) throw error
      showToast('Situație ștearsă', 'ok')
      loadLista()
    } catch(e) {
      showToast('Eroare: ' + e.message, 'err')
    } finally {
      setDeleteConf(null)
    }
  }

  return (
    <div style={{padding:'24px 28px', maxWidth:1400, margin:'0 auto'}}>
      <Toast />

      {/* ─── ALERTĂ SL fără factură ─── */}
      {kpi.deFacturat > 0 && (
        <div style={{
          background:G.green+'0D', border:`1px solid ${G.green}44`,
          borderRadius:8, padding:'10px 14px', marginBottom:16,
          display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, flexWrap:'wrap',
        }}>
          <div style={{display:'flex',alignItems:'center',gap:8,fontSize:13}}>
            <span style={{color:G.green}}>📄</span>
            <span style={{color:G.green,fontWeight:700}}>
              {kpi.deFacturat === 1
                ? '1 situație aprobată gata de facturat'
                : `${kpi.deFacturat} situații aprobate gata de facturat`}
            </span>
          </div>
          <span style={{color:G.muted,fontSize:12}}>Apasă 📄 pe rândul dorit ↓</span>
        </div>
      )}
      {slFaraFactura.length > 0 && kpi.deFacturat === 0 && (
        <div style={{
          background:G.orange+'0D', border:`1px solid ${G.orange}44`,
          borderRadius:8, padding:'10px 14px', marginBottom:16,
          display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, flexWrap:'wrap',
        }}>
          <div style={{display:'flex',alignItems:'center',gap:8,fontSize:13}}>
            <span style={{color:G.orange}}>⚠️</span>
            <span style={{color:G.orange,fontWeight:700}}>
              {slFaraFactura.map(s=>s.nr_situatie).join(', ')} — aprobate dar fără factură
            </span>
          </div>
        </div>
      )}

      {/* ─── HEADER ─── */}
      <div style={{display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:20, gap:16, flexWrap:'wrap'}}>
        <div>
          <h2 style={{margin:0, fontSize:22, fontWeight:800}}>💰 Situații de Plată</h2>
          <div style={{color:G.muted, fontSize:13, marginTop:4}}>SL · NCS · Acte adiționale · XLS borderou + PDF certificat TGZ → factură</div>
        </div>
        <div style={{display:'flex', gap:10, alignItems:'center', flexWrap:'wrap'}}>
          {!proiectIdProp && (
            <select value={proiectId} onChange={e=>setProiectId(e.target.value)} style={{...S.input, width:300, background:G.surface}}>
              {proiecte.map(p=>(
                <option key={p.id} value={p.id}>{p.cod_intern} — {p.nume?.slice(0,50)}</option>
              ))}
            </select>
          )}
          {canEdit && (
            <button onClick={()=>setEditItem({})} style={{
              padding:'9px 16px', background:G.executie, border:'none',
              borderRadius:8, color:'#0D1117', fontWeight:700, fontSize:13, cursor:'pointer',
            }}>＋ Situație</button>
          )}
        </div>
      </div>

      {/* ─── KPI ─── */}
      <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(160px,1fr))', gap:12, marginBottom:24}}>
        {[
          {label:'Situații totale',    value:kpi.total,                   icon:'📋', color:G.executie},
          {label:'Situații plată',     value:kpi.nrSL,                    icon:'📊', color:G.blue},
          {label:'Aprobate/Facturate', value:kpi.aprobate,                icon:'✅', color:G.green},
          {label:'De facturat',        value:kpi.deFacturat,              icon:'📄', color:kpi.deFacturat>0?G.orange:G.muted},
          {label:'În pregătire',       value:kpi.inPreg,                  icon:'📝', color:kpi.inPreg>0?G.yellow:G.muted},
          ...(showValori ? [
            {label:'Total bază',       value:fmtLei(kpi.totalBaza),       icon:'💵', color:G.teal},
            {label:'Total ajustat',    value:fmtLei(kpi.totalAj),         icon:'💰', color:G.orange},
            {label:'Facturat/Încasat', value:fmtLei(kpi.facturate),       icon:'🧾', color:G.purple},
          ] : []),
        ].map((k,i)=>(
          <div key={i} style={{
            background:G.surface, border:`1px solid ${G.border}`, borderRadius:10,
            padding:'12px 16px', display:'flex', alignItems:'center', gap:12,
          }}>
            <div style={{
              width:36, height:36, borderRadius:8,
              background:k.color+'22', display:'flex', alignItems:'center',
              justifyContent:'center', fontSize:17, flexShrink:0, color:k.color,
            }}>{k.icon}</div>
            <div>
              <div style={{fontSize:11, color:G.muted, marginBottom:2}}>{k.label}</div>
              <div style={{fontSize:16, fontWeight:700, color:k.color}}>{k.value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ─── TIMELINE ─── */}
      {lista.filter(s=>s.tip==='situatie_plata').length > 0 && (
        <div style={{
          background:G.surface, border:`1px solid ${G.border}`, borderRadius:10,
          padding:'14px 18px', marginBottom:20,
        }}>
          <div style={{fontSize:12, color:G.muted, marginBottom:10, fontWeight:600, textTransform:'uppercase', letterSpacing:'.3px'}}>
            Timeline situații
          </div>
          <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
            {lista.filter(s=>s.tip==='situatie_plata').map(s=>{
              const si = STATUS_SL[s.status] || STATUS_SL.in_pregatire
              const tip = TIP_SL[s.tip] || TIP_SL.situatie_plata
              return (
                <div key={s.id} style={{
                  background:si.bg, border:`1.5px solid ${si.color}44`,
                  borderRadius:10, padding:'10px 14px', minWidth:110,
                  cursor:'pointer', transition:'transform .1s',
                }} onClick={()=>canEdit && setEditItem(s)}
                  onMouseEnter={e=>e.currentTarget.style.transform='translateY(-2px)'}
                  onMouseLeave={e=>e.currentTarget.style.transform='none'}
                >
                  <div style={{fontSize:18, marginBottom:4}}>{si.icon}</div>
                  <div style={{fontWeight:800, fontSize:14, color:si.color}}>{s.nr_situatie}</div>
                  <div style={{fontSize:11, color:G.muted, marginTop:2}}>{tip.icon} {tip.label}</div>
                  {s.luna && <div style={{fontSize:11, color:G.dim, marginTop:2}}>{LUNI[s.luna-1]} {s.an}</div>}
                  {showValori && s.valoare_ajustata_lei && (
                    <div style={{fontSize:11, fontWeight:600, color:si.color, marginTop:4}}>
                      {fmtLei(s.valoare_ajustata_lei)}
                    </div>
                  )}
                  {s.nr_factura && (
                    <div style={{fontSize:10, color:G.dim, marginTop:2}}>🧾 {s.nr_factura}</div>
                  )}
                  {s.certificat_plata_nr && (
                    <div style={{fontSize:10, color:G.teal, marginTop:2}}>📜 {s.certificat_plata_nr}</div>
                  )}
                  {parseFloat(s.valoare_ajustare_lei||0)>0 && !s.act_aditional_nr && (
                    <div
                      onClick={e=>{e.stopPropagation(); setAaModal(s)}}
                      title="Ajustare fără Act Adițional"
                      style={{
                        marginTop:6, fontSize:10, fontWeight:700,
                        color:G.orange, cursor:'pointer',
                        background:G.orange+'22', borderRadius:4,
                        padding:'2px 6px', display:'inline-block',
                      }}
                    >⚠️ Lipsă AA</div>
                  )}
                  {s.act_aditional_nr && (
                    <div style={{fontSize:10, color:G.teal, marginTop:4}}>✅ {s.act_aditional_nr}</div>
                  )}
                  {s.discrepanta_lei && parseFloat(s.discrepanta_lei) < -1 && (
                    <div style={{fontSize:10, color:G.yellow, marginTop:4}}>✂️ -{fmtLei(Math.abs(s.discrepanta_lei))}</div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ─── TABEL ─── */}
      {loading ? (
        <div style={{textAlign:'center', padding:'60px 0', color:G.muted}}>⏳ Se încarcă...</div>
      ) : lista.length === 0 ? (
        <div style={{
          background:G.surface, border:`1px solid ${G.border}`, borderRadius:12,
          padding:'60px 40px', textAlign:'center',
        }}>
          <div style={{fontSize:48, marginBottom:12, opacity:.4}}>💰</div>
          <div style={{fontSize:16, fontWeight:600, marginBottom:8}}>Nicio situație de plată</div>
          <div style={{color:G.muted, fontSize:13, marginBottom:16}}>
            Adaugă prima situație și încarcă XLS borderou + PDF certificat TGZ
          </div>
          {canEdit && (
            <button onClick={()=>setEditItem({})} style={{
              marginTop:8, padding:'10px 20px', background:G.executie, border:'none',
              borderRadius:8, color:'#0D1117', fontWeight:700, fontSize:13, cursor:'pointer',
            }}>＋ Adaugă situație</button>
          )}
        </div>
      ) : (
        <div style={{overflowX:'auto'}}>
          <table style={{width:'100%', borderCollapse:'collapse', fontSize:13}}>
            <thead>
              <tr style={{background:G.surface, borderBottom:`1px solid ${G.border}`}}>
                {['Nr.','Tip','Luna/An','Data dep.', ...(showValori ? ['Val. bază','Coef.','Val. ajustată'] : []),'Certificat','Status','Factură',''].map((h,i)=>(
                  <th key={i} style={{
                    padding:'10px 12px', textAlign:'left', fontWeight:600,
                    color:G.muted, fontSize:11, textTransform:'uppercase', letterSpacing:'.3px', whiteSpace:'nowrap',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lista.map((s,idx)=>{
                const si  = STATUS_SL[s.status] || STATUS_SL.in_pregatire
                const tip = TIP_SL[s.tip] || TIP_SL.situatie_plata
                const poateEmite = s.status === 'aprobata' && !s.nr_factura
                return (
                  <tr key={s.id} style={{
                    borderBottom:`1px solid ${G.border2}`,
                    background:idx%2===0?'transparent':G.bg+'88',
                  }}
                    onMouseEnter={e=>e.currentTarget.style.background=G.surface}
                    onMouseLeave={e=>e.currentTarget.style.background=idx%2===0?'transparent':G.bg+'88'}
                  >
                    <td style={{padding:'10px 12px', fontWeight:800, color:G.executie}}>{s.nr_situatie}</td>
                    <td style={{padding:'10px 12px', whiteSpace:'nowrap'}}>
                      <span style={{fontSize:12}}>{tip.icon} {tip.label}</span>
                    </td>
                    <td style={{padding:'10px 12px', color:G.muted, whiteSpace:'nowrap'}}>
                      {s.luna && s.an ? `${LUNI[s.luna-1]} ${s.an}` : '—'}
                    </td>
                    <td style={{padding:'10px 12px', color:G.muted, whiteSpace:'nowrap', fontSize:12}}>{fmtDate(s.data_depunere)}</td>
                    {showValori && <>
                      <td style={{padding:'10px 12px', textAlign:'right', whiteSpace:'nowrap', fontFamily:'monospace'}}>
                        {s.valoare_baza_lei ? fmtLei(s.valoare_baza_lei) : '—'}
                      </td>
                      <td style={{padding:'10px 12px', textAlign:'center', color:G.dim, fontSize:12}}>
                        {parseFloat(s.coeficient_ajustare)!==1 ? (
                          <span style={{color:G.yellow, fontWeight:600}}>×{parseFloat(s.coeficient_ajustare).toFixed(4)}</span>
                        ) : '×1'}
                      </td>
                      <td style={{padding:'10px 12px', textAlign:'right', fontWeight:700, whiteSpace:'nowrap', fontFamily:'monospace', color:G.green}}>
                        {s.valoare_ajustata_lei ? fmtLei(s.valoare_ajustata_lei) : '—'}
                      </td>
                    </>}
                    {/* Certificat TGZ */}
                    <td style={{padding:'10px 12px', whiteSpace:'nowrap', fontSize:12}}>
                      {s.certificat_plata_nr ? (
                        <span style={{color:G.teal}}>📜 {s.certificat_plata_nr}</span>
                      ) : (
                        <span style={{color:G.dim}}>—</span>
                      )}
                      {s.discrepanta_lei && parseFloat(s.discrepanta_lei) < -1 && (
                        <div style={{color:G.yellow, fontSize:11}}>✂️ {fmtLei(Math.abs(s.discrepanta_lei))}</div>
                      )}
                    </td>
                    <td style={{padding:'10px 12px'}}>
                      <span style={{
                        padding:'3px 10px', borderRadius:12, fontSize:12, fontWeight:600,
                        background:si.bg, color:si.color, whiteSpace:'nowrap',
                      }}>{si.icon} {si.label}</span>
                    </td>
                    <td style={{padding:'10px 12px', color:s.nr_factura?G.text:G.dim, fontSize:12, whiteSpace:'nowrap'}}>
                      {s.nr_factura || (s.factura_cumulata ? <span style={{color:G.muted, fontSize:11}}>📎 {s.cumulata_cu_sl}</span> : '—')}
                    </td>
                    <td style={{padding:'10px 12px'}}>
                      <div style={{display:'flex', gap:6, alignItems:'center'}}>
                        {/* Buton Emite factură */}
                        {poateEmite && showValori && (
                          <button
                            onClick={()=>setEmiteModal(s)}
                            title="Emite factură din această SL"
                            style={{
                              padding:'5px 10px', background:G.green+'22',
                              border:`1px solid ${G.green}55`, borderRadius:6,
                              color:G.green, cursor:'pointer', fontSize:11, fontWeight:700, whiteSpace:'nowrap',
                            }}>📄 Emite</button>
                        )}
                        {parseFloat(s.valoare_ajustare_lei||0)>0 && (
                          s.act_aditional_nr ? (
                            <span style={{fontSize:11, color:G.teal, fontWeight:600, whiteSpace:'nowrap'}}>✅ {s.act_aditional_nr}</span>
                          ) : (
                            <button onClick={()=>setAaModal(s)} title="Completează Act Adițional" style={{
                              padding:'4px 8px', background:G.orange+'22',
                              border:`1px solid ${G.orange}55`, borderRadius:6,
                              color:G.orange, cursor:'pointer', fontSize:11, fontWeight:700, whiteSpace:'nowrap',
                            }}>⚠️ AA lipsă</button>
                          )
                        )}
                        {canEdit && (
                          <button onClick={()=>setEditItem(s)} style={{
                            padding:'5px 10px', background:G.border2, border:'none',
                            borderRadius:6, color:G.muted, cursor:'pointer', fontSize:12,
                          }}>✏️</button>
                        )}
                        {isOwner && (
                          <button onClick={()=>setDeleteConf(s)} style={{
                            padding:'5px 10px', background:G.red+'22', border:'none',
                            borderRadius:6, color:G.red, cursor:'pointer', fontSize:12,
                          }}>🗑</button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            {showValori && lista.length > 0 && (
              <tfoot>
                <tr style={{borderTop:`2px solid ${G.border}`, background:G.surface}}>
                  <td colSpan={4} style={{padding:'10px 12px', fontWeight:700, color:G.muted, fontSize:12}}>TOTAL</td>
                  <td style={{padding:'10px 12px', textAlign:'right', fontWeight:800, fontFamily:'monospace', color:G.teal}}>{fmtLei(kpi.totalBaza)}</td>
                  <td/>
                  <td style={{padding:'10px 12px', textAlign:'right', fontWeight:800, fontFamily:'monospace', color:G.orange}}>{fmtLei(kpi.totalAj)}</td>
                  <td colSpan={4}/>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {/* ─── MODALE ─── */}
      {editItem !== null && (
        <SLModal
          item={editItem?.id ? editItem : null}
          proiectId={parseInt(proiectId)}
          proiectDate={proiectDate}
          onClose={()=>setEditItem(null)}
          onSaved={()=>{ setEditItem(null); loadLista() }}
          showToast={showToast}
        />
      )}

      {aaModal && (
        <AAModal
          sl={aaModal}
          onClose={()=>setAaModal(null)}
          onSaved={()=>{ setAaModal(null); loadLista() }}
          showToast={showToast}
        />
      )}

      {emiteModal && (
        <EmiteFacturaModal
          sl={emiteModal}
          proiectDate={proiectDate}
          onClose={()=>setEmiteModal(null)}
          onSuccess={(nrFactura)=>{ setEmiteModal(null); loadLista(); showToast(`✅ Factură ${nrFactura} emisă și salvată!`, 'ok') }}
          showToast={showToast}
        />
      )}

      {deleteConf && (
        <div style={{position:'fixed', inset:0, background:'rgba(0,0,0,.8)', zIndex:1020, display:'flex', alignItems:'center', justifyContent:'center'}}>
          <div style={{background:G.surface, border:`1px solid ${G.red}`, borderRadius:12, padding:28, maxWidth:380, width:'90%', textAlign:'center'}}>
            <div style={{fontSize:32, marginBottom:12}}>🗑</div>
            <div style={{fontSize:15, fontWeight:700, marginBottom:8}}>Ștergi <span style={{color:G.red}}>{deleteConf.nr_situatie}</span>?</div>
            <div style={{color:G.muted, fontSize:13, marginBottom:20}}>Ireversibil. Liniile și documentele asociate se șterg.</div>
            <div style={{display:'flex', gap:10, justifyContent:'center'}}>
              <button onClick={()=>setDeleteConf(null)} style={{padding:'9px 18px', background:G.border, border:'none', borderRadius:7, color:G.text, cursor:'pointer'}}>Anulează</button>
              <button onClick={()=>handleDelete(deleteConf.id)} style={{padding:'9px 18px', background:G.red, border:'none', borderRadius:7, color:'#fff', fontWeight:700, cursor:'pointer'}}>Șterge</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
