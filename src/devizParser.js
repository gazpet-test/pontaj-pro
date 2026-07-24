// ═══════════════════════════════════════════════════════════════════════════
// devizParser.js — parsează antemăsurătoarea (F3 „Lista cu cantități de lucrări")
// dintr-un deviz românesc și scoate articolele structurate pentru
// proiect_articole. Rulează CLIENT-SIDE (browser) și în Node (test).
//   - .docx: JSZip → word/document.xml → paragrafe → articole
//   - .xls/.xlsx: xlsx-js-style → rânduri → articole (best-effort pe antet)
// Structură articol: {obiect_cod, obiect_nume, deviz_cod, deviz_nume, nr, cod,
//                     denumire, um, cantitate, valoare}
// ═══════════════════════════════════════════════════════════════════════════

const UM = String.raw`(?:100 ?MC\.?|100 ?MP\.?|100 ?M\.?|M\.?C\.?|M\.?P\.?|BUC\.?|HA|TONA|TO\.?|ML|M\.?L\.?|KG|M\.?)`
const UM_RE = new RegExp('(' + UM + ')\\s+([\\d.,]+)')
const ART_RE = /^(\d{3})\s+([A-Z]{2,4}\d[A-Z0-9]*)\s+(.*)$/

const num = (s) => {
  if (s == null || s === '') return null
  const n = parseFloat(String(s).replace(/\s/g, '').replace(/,/g, ''))
  return isNaN(n) ? null : n
}

// ── Core: din paragrafe (deja text plat) → articole ──
export function articoleDinParagrafe(paras) {
  const arts = []
  let obiect = null, deviz = null
  for (let i = 0; i < paras.length; i++) {
    const p = paras[i]
    let m
    if ((m = p.match(/^Obiectul:\s*(\d+)\s+\d+\s+(.*)/))) obiect = { cod: m[1], nume: m[2].trim() }
    if ((m = p.match(/^Deviz oferta\s+(\d+)\s+(.*)/))) deviz = { cod: m[1], nume: m[2].trim() }
    const ma = p.match(ART_RE)
    if (!ma) continue
    const [, nr, cod, rest] = ma
    const mu = rest.match(UM_RE)
    if (!mu) continue // linie fără UM+cantitate = resursă (material/utilaj), o sărim
    const um = mu[1].trim(), cantitate = num(mu[2])
    // denumirea + valoarea (Total=) vin pe următoarele rânduri
    const den = []
    let valoare = null
    for (let j = i + 1; j < paras.length && j < i + 6; j++) {
      const mt = paras[j].match(/Total=\s*([\d.,]+)/)
      if (mt) { valoare = num(mt[1]); break }
      const t = paras[j].replace(/\s+[\d.,]+(\s+[\d.,]+)*$/, '').trim()
      if (/[A-Z]{3,}/.test(t)) den.push(t)
    }
    arts.push({
      obiect_cod: obiect?.cod || '', obiect_nume: obiect?.nume || '',
      deviz_cod: deviz?.cod || '', deviz_nume: deviz?.nume || '',
      nr, cod, denumire: den.join(' ').slice(0, 200).trim(), um, cantitate, valoare,
    })
  }
  return arts
}

// ── .docx: extrage paragrafele din word/document.xml ──
function paragrafeDinDocXml(xml) {
  const paras = []
  const pRe = /<w:p\b[\s\S]*?<\/w:p>/g
  let m
  while ((m = pRe.exec(xml))) {
    const tRe = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g
    let tm, txt = ''
    while ((tm = tRe.exec(m[0]))) txt += tm[1]
    txt = txt.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/\s+/g, ' ').trim()
    if (txt) paras.push(txt)
  }
  return paras
}

export async function parseDevizDocx(arrayBuffer) {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(arrayBuffer)
  const f = zip.file('word/document.xml')
  if (!f) throw new Error('document.xml lipsă din .docx')
  const xml = await f.async('string')
  return articoleDinParagrafe(paragrafeDinDocXml(xml))
}

// ── .xls/.xlsx: best-effort pe antet (Nr, Cod/Simbol, Denumire, UM, Cantitate) ──
export async function parseDevizExcel(arrayBuffer) {
  const XLSX = await import('xlsx-js-style')
  const wb = XLSX.read(arrayBuffer, { type: 'array' })
  const out = []
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, blankrows: false, defval: '' })
    // caută rândul de antet
    let hdr = -1, col = {}
    for (let r = 0; r < Math.min(rows.length, 30); r++) {
      const cells = rows[r].map(c => String(c).toLowerCase())
      const find = (kw) => cells.findIndex(c => kw.some(k => c.includes(k)))
      const ic = find(['cantitat']), iu = find(['u.m', 'um', 'unitat']), id = find(['denumire', 'articol', 'lucrar'])
      if (ic >= 0 && iu >= 0) { hdr = r; col = { cant: ic, um: iu, den: id >= 0 ? id : 1, cod: find(['simbol', 'cod', 'indicativ']) }; break }
    }
    if (hdr < 0) continue
    for (let r = hdr + 1; r < rows.length; r++) {
      const row = rows[r]
      const cant = num(row[col.cant]), um = String(row[col.um] || '').trim()
      const den = String(row[col.den] || '').trim()
      if (cant == null || !um || !den) continue
      out.push({ obiect_cod: '', obiect_nume: name, deviz_cod: '', deviz_nume: '', nr: String(r), cod: col.cod >= 0 ? String(row[col.cod] || '').trim() : '', denumire: den.slice(0, 200), um, cantitate: cant, valoare: null })
    }
  }
  return out
}

// ── Dispatcher pe tip fișier ──
export async function parseDeviz(file) {
  const buf = await file.arrayBuffer()
  const nume = (file.name || '').toLowerCase()
  if (nume.endsWith('.docx')) return parseDevizDocx(buf)
  if (nume.endsWith('.xls') || nume.endsWith('.xlsx')) return parseDevizExcel(buf)
  // fallback: încearcă docx (zip) apoi excel
  try { return await parseDevizDocx(buf) } catch (_) { return parseDevizExcel(buf) }
}
