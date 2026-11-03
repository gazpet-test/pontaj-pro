import * as XLSX from 'xlsx-js-style'
import { avertismentExpediere } from './plicuri.js'
import { TERMEN_CONVOCARE_ZILE } from './setari.js'

const text = v => v == null ? '' : String(v).trim()
const simplu = v => text(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const tracking = v => text(v).toUpperCase().replace(/\s/g, '')
const document = v => {
  const s = tracking(v), m = s.match(/^C-?(\d{1,4})$/)
  return m ? `C-${m[1].padStart(4, '0')}` : s
}
const CAMPURI = ['proiect_id', 'lot_id', 'versiune', 'opis_path', 'awb', 'data_expediere', 'data_ar', 'retur', 'retur_data']

// CSV strict: quoted separators/newlines, physical source line numbers, no silent truncation.
function csv(s, sep) {
  const rows = []
  let cells = [], cell = '', quoted = false, closed = false, line = 1, start = 1
  const finish = () => { cells.push(cell.trim()); rows.push({ line: start, cells }); cells = []; cell = ''; closed = false; start = line + 1 }
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++ } else { quoted = false; closed = true }
      } else { cell += c; if (c === '\n') line++ }
    } else if (c === '"') {
      if (cell.trim() || closed) throw new Error('CSV invalid: ghilimele în interiorul celulei.')
      cell = ''; quoted = true
    } else if (c === sep) { cells.push(cell.trim()); cell = ''; closed = false }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++
      finish(); line++; start = line
    } else {
      if (closed && c.trim()) throw new Error('CSV invalid: text după ghilimele.')
      cell += c
    }
  }
  if (quoted) throw new Error('CSV invalid: ghilimele neînchise.')
  if (cells.length || cell || closed) finish()
  return rows
}

export function citesteFisierPostal(arrayBuffer, numeFisier) {
  let date1904 = false
  let rows
  if (/\.csv$/i.test(numeFisier)) {
    const s = new TextDecoder('utf-8', { fatal: true }).decode(arrayBuffer).replace(/^\uFEFF/, '')
    // First nonempty logical record determines delimiter; separators inside quotes do not count.
    const counts = { ';': 0, ',': 0 }
    let q = false, content = false
    for (let i = 0; i < s.length; i++) {
      const c = s[i]
      if (c === '"') { if (q && s[i + 1] === '"') i++; else q = !q }
      if (!q && (c === ';' || c === ',')) counts[c]++
      if (!q && (c === '\n' || c === '\r')) { if (content) break }
      else if (c.trim()) content = true
    }
    rows = csv(s, counts[';'] >= counts[','] ? ';' : ',')
  } else if (/\.xlsx?$/i.test(numeFisier)) {
    const wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: false })
    date1904 = !!wb.Workbook?.WBProps?.date1904   // Copilot f9 r1 P3-01: registrele cu baza 1904 au serialele decalate cu 1462 de zile
    const sh = wb.Sheets[wb.SheetNames[0]]
    if (!sh?.['!ref']) throw new Error('Fișierul nu are date.')
    const range = XLSX.utils.decode_range(sh['!ref'])
    if (range.e.r - range.s.r > 20000 || range.e.c - range.s.c > 1000) throw new Error('Fișier prea mare: maximum 20000 de rânduri și 1001 coloane.')
    rows = XLSX.utils.sheet_to_json(sh, { header: 1, raw: true, defval: '', blankrows: true, range })
      .map((cells, i) => ({ cells, line: range.s.r + i + 1 }))
  } else throw new Error('Alege un fișier XLSX, XLS sau CSV UTF-8.')
  const first = rows.findIndex(r => r.cells.some(v => text(v)))
  if (first < 0) throw new Error('Fișierul nu are antet.')
  const coloane = rows[first].cells.map((v, i) => text(v) || `Coloana ${i + 1}`)
  if (new Set(coloane).size !== coloane.length || coloane.includes('__rand')) throw new Error('Antet duplicat sau rezervat (__rand). Corectează fișierul.')
  const data = rows.slice(first + 1).filter(r => r.cells.some(v => text(v)))
  if (data.length > 20000) throw new Error('Maximum 20000 de rânduri; fișierul nu a fost importat.')
  const randuri = data.map(r => {
    if (r.cells.slice(coloane.length).some(v => text(v))) throw new Error(`Rândul ${r.line}: valori fără antet.`)
    return Object.assign(Object.create(null), Object.fromEntries(coloane.map((c, i) => [c, typeof r.cells[i] === 'string' ? r.cells[i].trim() : r.cells[i] ?? ''])), { __rand: r.line })
  })
  return { coloane, randuri, date1904 }
}

export function ghicesteMaparea(coloane) {
  const reguli = {
    nr_document: /plic|convocar|nr\.?\s*doc|referin|nr\.?\s*intern/,
    nr_tracking: /awb|tracking|recomandat|cod\s*(trimitere|bare)|nr\.?\s*expedi/,
    data: /data|date/, eveniment: /stare|status|eveniment/, motiv: /motiv|observ/,
  }
  return Object.fromEntries(Object.entries(reguli).map(([k, re]) => [k, coloane.find(c => re.test(simplu(c))) || '']))
}

export function parseazaData(v, { date1904 = false } = {}) {
  let y, m, d
  if (typeof v === 'number' && Number.isFinite(v)) {
    const dt = XLSX.SSF.parse_date_code(date1904 ? v + 1462 : v)
    if (!dt) return null
    ;({ y, m, d } = dt)
  } else if (v instanceof Date && !isNaN(v)) {
    y = v.getFullYear(); m = v.getMonth() + 1; d = v.getDate()
  } else {
    const s = text(v)
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/)
    const ro = s.match(/^(\d{2})([./])(\d{2})\2(\d{4})(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/)
    if (iso) { y = Number(iso[1]); m = Number(iso[2]); d = Number(iso[3]) }
    else if (ro) { y = Number(ro[4]); m = Number(ro[3]); d = Number(ro[1]) }
    else return null
    const time = s.match(/[ T](\d{2}):(\d{2})(?::(\d{2}))?/)
    if (time && (Number(time[1]) > 23 || Number(time[2]) > 59 || Number(time[3] || 0) > 59)) return null
  }
  if (y < 2025 || y > 2030 || m < 1 || m > 12 || d < 1) return null
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)
  if (d > [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export function clasificaEveniment(v, modImplicit) {
  const s = simplu(v)
  if (/\b(?:retur\w*|returnat\w*|neridicat\w*|refuz\w*|necunoscut\w*|mutat\w*|incomplet\w*|decedat\w*)\b/.test(s)) return 'retur'
  if (/\bpredat la posta\b/.test(s)) return 'expediere'
  if (/\b(?:livrat\w*|predat\w*|primit\w*|confirmat\w*|ar)\b/.test(s)) return 'ar'
  if (/\b(?:expediat\w*|depus\w*|preluat\w*)\b/.test(s)) return 'expediere'
  return modImplicit
}

export function motivRetur(v) {
  const s = simplu(v)
  if (/necunoscut/.test(s)) return 'destinatar_necunoscut'
  if (/mutat|plecat/.test(s)) return 'mutat'
  if (/avizat|neridicat|expirat/.test(s)) return 'avizat_neridicat'
  if (/refuz/.test(s)) return 'refuz'
  if (/incomplet|insuficient|gresit/.test(s)) return 'adresa_incompleta'
  return null
}

// Gemini f10 r1 P2: aceleași precondiții ca BD și ca ecranul Plicuri — împuternicirea proiectului și opisul de la dosar (altfel excepții clare, nu erori la aplicare)
// Copilot f-v2 r3 P2-01: `uats` (id, nume, sesiune_zi1) → expedierea după termenul de 10 zile primește `avertisment` (rândul NU se refuză:
// data expedierii e un fapt); aceeași funcție ca ecranul Plicuri (avertismentExpediere). UAT necunoscut / fără ziua 1 = termen nejudecat.
export function propune(randuri, mapare, modImplicit, plicuri, { date1904 = false, imputernicire = true, uats = [] } = {}) {
  if (!['expediere', 'ar', 'retur'].includes(modImplicit)) throw new Error('Mod implicit invalid.')
  if ((!mapare.nr_document && !mapare.nr_tracking) || !mapare.data) throw new Error('Mapează numărul plicului sau AWB-ul și data.')
  const rezultat = { aplicabile: [], deja: [], exceptii: [] }, docs = new Map(), tracks = new Map()
  const uatPe = new Map((uats || []).map(u => [u.id, u]))
  for (const p of plicuri) {
    for (const [map, k] of [[docs, document(p.nr_plic)], [tracks, tracking(p.awb)]]) {
      if (k) map.set(k, [...(map.get(k) || []), p])
    }
  }
  const docuriPeAwb = new Map()
  for (const r of randuri) {
    const t = tracking(r[mapare.nr_tracking]); if (!t) continue
    if (!docuriPeAwb.has(t)) docuriPeAwb.set(t, new Set())
    docuriPeAwb.get(t).add(document(r[mapare.nr_document]) || '(fără număr)')
  }
  const valide = []
  randuri.forEach((r, i) => {
    const nr_document = document(r[mapare.nr_document]), nr_tracking = tracking(r[mapare.nr_tracking])
    const baza = { rand: r.__rand ?? i + 2, nr_document, tracking: nr_tracking }
    const exceptie = motiv => rezultat.exceptii.push({ ...baza, motiv })
    const tip = clasificaEveniment(r[mapare.eveniment], modImplicit)
    if (tip !== 'expediere') return exceptie('Se înregistrează pe plic, cu scanul (Plicuri -> AR / Retur).')
    if (nr_tracking && docuriPeAwb.get(nr_tracking)?.size > 1) return exceptie('același AWB apare la mai multe plicuri în fișier')
    if (nr_document && !docs.get(nr_document)?.length) return exceptie('plic inexistent pentru numărul din fișier')
    const lista = nr_document ? docs.get(nr_document) : tracks.get(nr_tracking)
    if (!lista?.length) return exceptie('fără plic')
    if (lista.length !== 1) return exceptie('AWB pe mai multe plicuri / număr ambiguu')
    const p = lista[0]
    if (p.stare !== 'activ') return exceptie('plic anulat')
    if (nr_tracking && (tracks.get(nr_tracking) || []).some(x => x.id !== p.id)) return exceptie('AWB-ul aparține altui plic')
    if (!p.lot_id) return exceptie('plicul nu are PV de plicuire (lot)')
    if (!imputernicire) return exceptie('proiectul nu are încă împuternicirea Beneficiarului; plicurile nu pleacă')
    if (!p.opis_path) return exceptie('plicul nu are opisul atașat la dosar (Plicuri → Opis)')
    const data = parseazaData(r[mapare.data], { date1904 })
    if (!data) return exceptie('dată lipsă sau invalidă (2025–2030)')
    const awb = nr_tracking || tracking(p.awb)
    if (!awb) return exceptie('AWB obligatoriu pentru expediere')
    const item = { ...baza, nr_document: p.nr_plic, plic_id: p.id, uat_id: p.uat_id ?? null, tip }
    if (p.data_expediere != null) {
      if (p.data_expediere === data && tracking(p.awb) === awb) return valide.push({ fel: 'deja', item, baza })
      return exceptie('conflict: plic deja expediat cu altă dată sau alt AWB')
    }
    // Contractul cere AMBELE câmpuri NULL: un AWB izolat necesită reconciliere, nu suprascriere.
    if (p.awb != null) return exceptie('conflict: AWB existent fără expediere; verifică plicul')
    if (p.data_ar != null || p.retur != null || p.retur_data != null) return exceptie('conflict: plic cu AR sau retur')
    if (p.versiune == null || !p.proiect_id) return exceptie('snapshot incomplet; reîncarcă plicurile')
    const patch = { awb, data_expediere: data }
    const conditii = Object.fromEntries(CAMPURI.map(k => [k, p[k] ?? null]))
    const avertisment = avertismentExpediere(uatPe.get(p.uat_id), data)
    valide.push({ fel: 'aplicabil', item: { ...item, patch, conditii, ...(avertisment ? { avertisment } : {}) }, baza })
  })
  // Două treceri: un rând invalid nu rezervă plicul; toate evenimentele valide duplicate devin excepții.
  const pe = new Map()
  for (const v of valide) pe.set(v.item.plic_id, (pe.get(v.item.plic_id) || 0) + 1)
  for (const v of valide) {
    if (pe.get(v.item.plic_id) > 1) rezultat.exceptii.push({ ...v.baza, motiv: 'mai multe evenimente pentru același plic în fișier' })
    else if (v.fel === 'deja') rezultat.deja.push(v.item)
    else rezultat.aplicabile.push(v.item)
  }
  rezultat.exceptii.sort((a, b) => a.rand - b.rand)
  return rezultat
}

/** Confirmările cerute înainte de „Aplică”, în ordine; oricare refuzată = nu se aplică nimic. A doua numără expedierile tardive. */
export function confirmariAplicare(preview, proiectCod) {
  const tardive = (preview?.aplicabile || []).filter(a => a.avertisment)
  const mesaje = [`Aplică ${preview.aplicabile.length} modificări poștale în proiectul ${proiectCod}?\nDeja: ${preview.deja.length}. Excepții: ${preview.exceptii.length}.\nConflictele rămân pentru verificare manuală în Plicuri.`]
  if (tardive.length) {
    mesaje.push(`${tardive.length} din ${preview.aplicabile.length} expedieri sunt DUPĂ termenul de convocare (cu cel puțin ${TERMEN_CONVOCARE_ZILE} zile înainte de ziua 1, plan pct. 4.2): ` +
      `${tardive.map(a => a.nr_document).join(', ')}.\nSe înregistrează cu data reală, dar termenul nu e respectat. Le înregistrezi totuși?`)
  }
  return mesaje
}

/** Copilot f-v2 r4 P2: avertismentele de termen recalculate pe UAT-urile recitite din BD imediat înainte de aplicare (alt admin poate
 *  fi mutat ziua 1 după previzualizare). `schimbat` = cel puțin un rând are alt avertisment decât în previzualizare; un UAT implicat
 *  care lipsește din recitire = eroare (nu se judecă pe date necunoscute, nu se aplică nimic). */
export function reevalueazaTermene(aplicabile, uats) {
  const uatPe = new Map((uats || []).map(u => [u.id, u]))
  if (aplicabile.some(a => a.uat_id != null && !uatPe.has(a.uat_id))) throw new Error('UAT-urile plicurilor nu au putut fi recitite integral; nu s-a aplicat nimic. Reîncearcă.')
  let schimbat = false
  const noi = aplicabile.map(a => {
    const avertisment = avertismentExpediere(uatPe.get(a.uat_id), a.patch?.data_expediere)
    if ((avertisment || null) !== (a.avertisment || null)) schimbat = true
    const rest = { ...a }
    delete rest.avertisment
    return avertisment ? { ...rest, avertisment } : rest
  })
  return { aplicabile: noi, schimbat }
}

/** Confirmarea cerută când recitirea a schimbat termenele: se judecă pe valorile de ACUM. */
export function confirmareTermeneSchimbate(aplicabile) {
  const tardive = aplicabile.filter(a => a.avertisment)
  return `Ziua 1 de sesiune s-a schimbat între timp pentru UAT-urile acestor plicuri. Pe valorile de acum, ${tardive.length} din ${aplicabile.length} expedieri ` +
    `sunt DUPĂ termenul de convocare (cu cel puțin ${TERMEN_CONVOCARE_ZILE} zile înainte de ziua 1, plan pct. 4.2)${tardive.length ? `: ${tardive.map(a => a.nr_document).join(', ')}` : ''}.` +
    `\n${tardive.map(a => a.avertisment).join('\n')}\n\nAplici totuși?`
}

export async function aplica(supabase, aplicabile, { esteCurent = () => true } = {}) {
  const rezultat = { aplicate: [], conflicte: [], erori: [], neprocesate: [] }
  let consecutive = 0, i = 0
  for (; i < aplicabile.length && consecutive < 5 && esteCurent(); i++) {
    const a = aplicabile[i]
    try {
      if (a.tip !== 'expediere' || !a.patch?.awb || !a.patch?.data_expediere || !a.conditii?.lot_id || !a.conditii.opis_path || a.conditii.versiune == null || !a.conditii.proiect_id) throw new Error('Propunere nevalidă.')
      const { data: alte, error: eT } = await supabase.from('red_plicuri').select('id').eq('awb', a.patch.awb).neq('id', a.plic_id).limit(1)
      if (eT || !Array.isArray(alte)) throw new Error('Recitire AWB eșuată.')
      if (!esteCurent()) break
      if (alte.length) { rezultat.conflicte.push({ ...a, motiv: 'AWB-ul există pe alt plic; verifică manual.' }); consecutive = 0; continue }
      let q = supabase.from('red_plicuri').update(a.patch).eq('id', a.plic_id).eq('stare', 'activ').is('awb', null).is('data_expediere', null)
      for (const [k, v] of Object.entries(a.conditii)) q = v == null ? q.is(k, null) : q.eq(k, v)
      const { data, error } = await q.select('id')
      if (error) throw error
      if (!Array.isArray(data) || data.length > 1) throw new Error('Rezultat necunoscut.')
      if (data.length) rezultat.aplicate.push(a)
      else rezultat.conflicte.push({ ...a, motiv: 'Modificat între timp sau inaccesibil; reîncarcă previzualizarea.' })
      consecutive = 0
    } catch (e) {
      // Jakarinos + Copilot f10 UI P2: codul BD rămâne vizibil — 55P03 = operație concurentă (reîncearcă), 23514 / P0001 = refuz cu motiv
      const motiv = e?.code === '55P03' ? 'Operație concurentă în același UAT; reîncarcă și reîncearcă peste câteva secunde (rândurile deja aplicate se recunosc).'
        : (e?.code === '23514' || e?.code === 'P0001') ? `Refuzat: ${String(e?.message || '').replace(/^redari:\s*/, '')}`
        : e?.code === '42501' ? 'Acces de scriere refuzat.' : 'Scriere neconfirmată; verifică în Plicuri înainte de reluare.'
      rezultat.erori.push({ ...a, motiv, cod: e?.code || null }); consecutive++
    }
  }
  rezultat.neprocesate = aplicabile.slice(i)
  return rezultat
}
