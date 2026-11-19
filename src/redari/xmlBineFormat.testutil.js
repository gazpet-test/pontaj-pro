// Verificator XML minimal pentru teste, fără librării (review #1117 r2, P3; extras din sabloanePredare.test.js la 18.11.2026 ca să fie
// folosit și de anuntAfisare.test.js): prolog / PI, comentarii, CDATA, taguri cu atribute între ghilimele (nume unice), entități (doar
// cele 5 predefinite și referințe numerice), o singură rădăcină, fără text în afara ei; perechile de taguri se verifică cu o stivă.
// Întoarce null dacă documentul e bine format, altfel motivul. (DOCX-ul nu are DTD: <!DOCTYPE = refuz.)
const NUME = '[A-Za-z_][A-Za-z0-9_.:-]*'
const RX_DESCHIDE = new RegExp(`<(${NUME})((?:\\s+${NUME}\\s*=\\s*(?:"[^"<]*"|'[^'<]*'))*)\\s*(/?)>`, 'y')
const RX_INCHIDE = new RegExp(`</(${NUME})\\s*>`, 'y')
const RX_ATRIBUT = new RegExp(`(${NUME})\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'g')
const RX_ENTITATE = /&(?:amp|lt|gt|quot|apos|#[0-9]+|#x[0-9A-Fa-f]+);/y
function entitateInvalida(t) {
  for (let k = t.indexOf('&'); k >= 0; k = t.indexOf('&', k + 1)) { RX_ENTITATE.lastIndex = k; if (!RX_ENTITATE.test(t)) return true }
  return false
}
export function eroareXml(s) {
  const stiva = []
  let radacini = 0, i = s.charCodeAt(0) === 0xFEFF ? 1 : 0
  while (i < s.length) {
    const lt = s.indexOf('<', i)
    const text = s.slice(i, lt < 0 ? s.length : lt)
    if (text) {
      if (!stiva.length && text.trim()) return 'text în afara rădăcinii'
      if (entitateInvalida(text)) return 'entitate invalidă în text'
      if (text.includes(']]>')) return '„]]>” în text'
    }
    if (lt < 0) break
    if (s.startsWith('<?', lt)) { const f = s.indexOf('?>', lt + 2); if (f < 0) return 'instrucțiune <? neînchisă'; i = f + 2; continue }
    if (s.startsWith('<!--', lt)) { const f = s.indexOf('-->', lt + 4); if (f < 0) return 'comentariu neînchis'; i = f + 3; continue }
    if (s.startsWith('<![CDATA[', lt)) { if (!stiva.length) return 'CDATA în afara rădăcinii'; const f = s.indexOf(']]>', lt); if (f < 0) return 'CDATA neînchis'; i = f + 3; continue }
    if (s.startsWith('<!', lt)) return 'declarație <! neașteptată'
    if (s[lt + 1] === '/') {
      RX_INCHIDE.lastIndex = lt
      const r = RX_INCHIDE.exec(s)
      if (!r) return `tag de închidere invalid la ${lt}`
      const sus = stiva.pop()
      if (sus !== r[1]) return `</${r[1]}> închide <${sus ?? 'nimic'}>`
      i = RX_INCHIDE.lastIndex
      continue
    }
    RX_DESCHIDE.lastIndex = lt
    const r = RX_DESCHIDE.exec(s)
    if (!r) return `tag de deschidere invalid la ${lt}`
    const nume = new Set()
    for (const a of r[2].matchAll(RX_ATRIBUT)) {
      if (nume.has(a[1])) return `atribut dublu ${a[1]}`
      nume.add(a[1])
      if (entitateInvalida(a[2] ?? a[3])) return `entitate invalidă în atributul ${a[1]}`
    }
    if (!stiva.length && radacini++) return 'mai multe elemente rădăcină'
    if (!r[3]) stiva.push(r[1])
    i = RX_DESCHIDE.lastIndex
  }
  if (stiva.length) return `taguri neînchise: ${stiva.slice(-3).join(' > ')}`
  if (!radacini) return 'fără element rădăcină'
  return null
}

/** Toate părțile .xml / .rels ale unei arhive DOCX (JSZip) → [{ nume, eroare }] (eroare null = bine format). */
export async function partiXmlDocx(zip) {
  const parti = Object.values(zip.files).filter(f => !f.dir && /\.(xml|rels)$/i.test(f.name))
  return Promise.all(parti.map(async f => ({ nume: f.name, eroare: eroareXml(await f.async('string')) })))
}
