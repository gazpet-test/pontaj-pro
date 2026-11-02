import * as XLSX from 'xlsx-js-style'

const text = v => v == null ? '' : String(v).trim()
const simplu = v => text(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const tracking = v => text(v).toUpperCase().replace(/\s/g, '')
const document = v => {
  const s = tracking(v), m = s.match(/^C-?(\d{1,4})$/)
  return m ? `C-${m[1].padStart(4, '0')}` : s
}
const CAMPURI = ['nr_document', 'data_expediere', 'nr_tracking', 'data_confirmare_primire', 'retur', 'retur_data']

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
    nr_document: /convocar|nr\.?\s*doc|referin|nr\.?\s*intern/,
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
  if (/\b(?:retur\w*|returnat\w*|neridicat\w*|refuz\w*|necunoscut\w*|mutat\w*|incomplet\w*)\b/.test(s)) return 'retur'
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

export function propune(randuri, mapare, modImplicit, convocari, { date1904 = false } = {}) {
  if (!['expediere', 'ar', 'retur'].includes(modImplicit)) throw new Error('Mod implicit invalid.')
  if ((!mapare.nr_document && !mapare.nr_tracking) || !mapare.data) throw new Error('Mapează documentul sau tracking-ul și data.')
  const rezultat = { aplicabile: [], deja: [], exceptii: [] }
  const docs = new Map(), tracks = new Map()
  for (const c of convocari) {
    for (const [map, k] of [[docs, document(c.nr_document)], [tracks, tracking(c.nr_tracking)]]) {
      if (k) map.set(k, [...(map.get(k) || []), c])
    }
  }
  // Copilot f9 r1 P2-02: același AWB din fișier pe rânduri cu numere de convocare diferite = contradicție, toate rândurile la excepții
  const docuriPeAwb = new Map()
  for (const r of randuri) {
    const t = tracking(r[mapare.nr_tracking]); if (!t) continue
    const d = document(r[mapare.nr_document]) || '(fără număr)'
    if (!docuriPeAwb.has(t)) docuriPeAwb.set(t, new Set())
    docuriPeAwb.get(t).add(d)   // Copilot f9 r2 P3-01: fără copii repetate ale setului
  }
  const valide = []   // trecerea 1: fiecare rând se evaluează independent; nimic nu „rezervă” convocarea
  randuri.forEach((r, i) => {
    const nr_document = document(r[mapare.nr_document]), nr_tracking = tracking(r[mapare.nr_tracking])
    const baza = { rand: r.__rand ?? i + 2, nr_document, tracking: nr_tracking }
    const exceptie = motiv => rezultat.exceptii.push({ ...baza, motiv })
    if (nr_tracking && docuriPeAwb.get(nr_tracking)?.size > 1) return exceptie('același AWB apare la mai multe convocări în fișier')
    // un nr_document dat explicit, dar inexistent, NU cade pe tracking (Gemini/Copilot f9 r1)
    if (nr_document && !docs.get(nr_document)?.length) return exceptie('convocare inexistentă pentru numărul din fișier')
    const lista = nr_document ? docs.get(nr_document) : (nr_tracking ? tracks.get(nr_tracking) : null)
    if (!lista?.length) return exceptie('fără convocare')
    if (lista.length !== 1) return exceptie('tracking pe mai multe convocări / document ambiguu')
    const c = lista[0], tip = clasificaEveniment(r[mapare.eveniment], modImplicit)
    // Copilot f9 r1 P2-01: numărul și AWB-ul trebuie să indice aceeași convocare
    if (nr_tracking && (tracks.get(nr_tracking) || []).some(x => x.id !== c.id)) return exceptie('AWB-ul aparține altei convocări')
    if (tip !== 'expediere' && nr_tracking && c.nr_tracking && tracking(c.nr_tracking) !== nr_tracking) return exceptie(`tracking diferit de cel al convocării (${c.nr_tracking})`)
    const item = { ...baza, nr_document: c.nr_document, conv_id: c.id, tip }
    const data = parseazaData(r[mapare.data], { date1904 })
    if (!data) return exceptie('dată lipsă sau invalidă (2025–2030)')
    let patch
    if (tip === 'expediere') {
      if (nr_tracking && c.nr_tracking != null && tracking(c.nr_tracking) !== nr_tracking) return exceptie(`conflict: deja expediată la ${c.data_expediere || '-'} / tracking ${c.nr_tracking}`)
      if (c.data_expediere != null) {
        if (c.data_expediere === data && (!nr_tracking || tracking(c.nr_tracking) === nr_tracking)) return valide.push({ fel: 'deja', item, baza })
        return exceptie(`conflict: deja expediată la ${c.data_expediere} / tracking ${c.nr_tracking || '-'}`)
      }
      patch = { data_expediere: data }
      if (nr_tracking && c.nr_tracking == null) patch.nr_tracking = nr_tracking
    } else if (tip === 'ar') {
      if (!c.data_expediere) return exceptie('AR fără expediere')
      if (data < c.data_expediere) return exceptie('AR înainte de expediere')
      if (c.retur) return exceptie('are retur — verifică manual')
      if (c.data_confirmare_primire != null) {
        if (c.data_confirmare_primire === data) return valide.push({ fel: 'deja', item, baza })
        return exceptie('conflict: AR înregistrat la altă dată')
      }
      patch = { data_confirmare_primire: data }
    } else {
      const motiv = motivRetur(r[mapare.motiv])
      if (!motiv) return exceptie('motiv de retur lipsă sau nerecunoscut')
      if (!c.data_expediere) return exceptie('retur fără expediere')
      if (data < c.data_expediere) return exceptie('retur înainte de expediere')
      if (c.data_confirmare_primire) return exceptie('are AR — verifică manual')
      if (c.retur != null || c.retur_data != null) {
        if (c.retur === motiv && c.retur_data === data) return valide.push({ fel: 'deja', item, baza })
        return exceptie('conflict: retur deja înregistrat')
      }
      patch = { retur: motiv, retur_data: data }
    }
    const vechi = Object.fromEntries(Object.keys(patch).map(k => [k, c[k] ?? null]))
    // Snapshot of ALL decision fields protects AR vs retur and concurrent tracking edits.
    const conditii = Object.fromEntries(CAMPURI.map(k => [k, c[k] ?? null]))
    valide.push({ fel: 'aplicabil', item: { ...item, patch, vechi, conditii }, baza })
  })
  // Trecerea 2 (Copilot f9 r1 P3-02): mai multe rânduri valide pe aceeași convocare nu se rezolvă după ordine — toate devin excepții
  const pe = new Map()
  for (const v of valide) pe.set(v.item.conv_id, (pe.get(v.item.conv_id) || 0) + 1)
  for (const v of valide) {
    if (pe.get(v.item.conv_id) > 1) rezultat.exceptii.push({ ...v.baza, motiv: 'mai multe evenimente pentru aceeași convocare în fișier' })
    else if (v.fel === 'deja') rezultat.deja.push(v.item)
    else rezultat.aplicabile.push(v.item)
  }
  rezultat.exceptii.sort((a, b) => a.rand - b.rand)
  return rezultat
}

export async function aplica(supabase, aplicabile, { esteCurent = () => true } = {}) {
  const rezultat = { aplicate: [], conflicte: [], erori: [], neprocesate: [] }
  let consecutive = 0, i = 0
  lots: for (let debut = 0; debut < aplicabile.length; debut += 25) {
    if (!esteCurent() || consecutive >= 5) break
    const fin = Math.min(debut + 25, aplicabile.length)
    for (; i < fin; i++) {
      // Sequential requests; cancellation also stops inside a batch.
      if (!esteCurent() || consecutive >= 5) break lots
      const a = aplicabile[i]
      try {
        // Copilot f9 r2 P2-01: AWB-ul nou se recitește chiar înainte de scriere — dacă între timp a ajuns pe altă convocare (alt import / altă fereastră), conflict.
        // Unicitatea în BD (index) e o decizie de business în așteptare: un plic poate conține legitim mai multe convocări ale aceluiași om.
        if (a.patch.nr_tracking) {
          const { data: alte, error: eT } = await supabase.from('red_convocari').select('id').eq('nr_tracking', a.patch.nr_tracking).neq('id', a.conv_id).limit(1)
          if (eT) { rezultat.erori.push({ ...a, motiv: 'Recitirea AWB-ului a eșuat; nimic nu s-a scris pentru acest rând.' }); consecutive++; continue }   // Copilot f9 r3 P3-02
          if (alte?.length) { rezultat.conflicte.push({ ...a, motiv: 'AWB-ul a fost înregistrat între timp pe altă convocare; verifică manual.' }); consecutive = 0; continue }
        }
        let q = supabase.from('red_convocari').update(a.patch).eq('id', a.conv_id)
          .eq('stare', 'activ').eq('canal', 'posta').is('sters_la', null)
        for (const k of Object.keys(a.patch)) q = q.is(k, null)
        for (const [k, v] of Object.entries(a.conditii || a.vechi || {})) q = v == null ? q.is(k, null) : q.eq(k, v)
        const { data, error } = await q.select('id')
        if (error) throw error
        if (!Array.isArray(data) || data.length > 1) throw new Error('Răspuns de scriere nevalid; rezultat necunoscut.')
        if (data.length) rezultat.aplicate.push(a)
        else rezultat.conflicte.push({ ...a, motiv: 'Modificată între timp sau inaccesibilă; reîncarcă previzualizarea.' })
        consecutive = 0
      } catch {
        rezultat.erori.push({ ...a, motiv: 'Scriere neconfirmată; verifică în Registru înainte de reluare.' })
        consecutive++
      }
    }
  }
  rezultat.neprocesate = aplicabile.slice(i)
  return rezultat
}
