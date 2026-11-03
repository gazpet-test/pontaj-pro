import JSZip from 'jszip'

// Validat de Juridic (juridic#021, 03.11.2026; validarea finală a formulărilor rămâne la avocat). Textele AR sunt centralizate aici.
// Pe AR apar MEREU: nr. plicului, nr. de convocări (N) și UAT-ul. Numerele convocărilor: până la 6 enumerate, sau ca interval când sunt consecutive;
// altfel trimitere la opis. „pentru S.N.T.G.N. Transgaz S.A.” doar după împuternicire — fără împuternicire NU se generează AR-uri.
export const TEXTE_AR = {
  inceput: 'Conține:', scop: 'pentru constatarea readucerii terenului la starea inițială',
  lucrare: 'conducta Prunișor–Jupa, Lot 1',
  expeditor: 'Expeditor: Gazpet Instal SRL, pentru S.N.T.G.N. Transgaz S.A.',
  maxEnumerate: 6,
  // Copilot f10 UI P3-01: textul (lucrarea, beneficiarul) e validat juridic DOAR pentru aceste proiecte; alt proiect = alt text validat, nu reutilizare
  proiecte: ['LOT1-PRUNISOR-JUPA'],
}
// fn_red_plic_creeaza primește cel mult 200 de convocări și cere TOATE convocările persoanei din UAT într-un singur plic
export const MAX_CONVOCARI_PLIC = 200
export const areImputernicire = proiect => !!(txt(proiect?.imputernicire_nr) && proiect?.imputernicire_data)
const numarConvocare = c => { const m = /^C-(\d{1,6})$/.exec(txt(c.nr_document)); return m ? Number(m[1]) : null }
export function numereConvocari(convocari) {
  const cs = [...convocari].sort((a, b) => (numarConvocare(a) ?? Infinity) - (numarConvocare(b) ?? Infinity) || txt(a.nr_document).localeCompare(txt(b.nr_document)))
  const nr = cs.map(numarConvocare)
  const consecutive = cs.length > 1 && nr.every((n, i) => n != null && (i === 0 || n === nr[i - 1] + 1))
  if (cs.length <= TEXTE_AR.maxEnumerate) return { fel: 'lista', text: cs.map(c => c.nr_document).join(', ') }
  if (consecutive) return { fel: 'interval', text: `${cs[0].nr_document} – ${cs.at(-1).nr_document}` }
  return { fel: 'opis', text: '' }
}
const txt = v => String(v ?? '').trim()
const canon = v => txt(v).replace(/\s+/g, ' ').toLowerCase()
const CAMPURI_ADRESA = ['strada', 'sat', 'comuna', 'judet', 'cod_postal']
export const adresaPlic = a => CAMPURI_ADRESA.map(k => txt(a?.[k])).filter(Boolean).join(', ')
export const dataBucuresti = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const dataText = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '') ? d.split('-').reverse().join('.') : txt(d)

export function grupeazaPentruPlicuri(randuri) {
  const pe = new Map(), fara_adresa = []
  for (const r of randuri) {
    if (r.adresa?.cunoscuta !== true || !CAMPURI_ADRESA.some(k => txt(r.adresa[k]))) { fara_adresa.push(r); continue }
    const cheie = JSON.stringify([r.uat_id, canon(r.nume_normalizat), CAMPURI_ADRESA.map(k => canon(r.adresa[k])).join('|')])
    if (!pe.has(cheie)) pe.set(cheie, { cheie, uat_id: r.uat_id, uat3: r.uat3, destinatar: r.detinator_nume, convocari: [] })
    pe.get(cheie).convocari.push(r)
  }
  const prea_mari = []
  const grupuri = [...pe.values()].sort((a, b) => txt(a.uat3).localeCompare(txt(b.uat3), 'ro') || txt(a.destinatar).localeCompare(txt(b.destinatar), 'ro'))
    .flatMap(g => {
      const conv = [...g.convocari].sort((a, b) => txt(a.nr_document).localeCompare(txt(b.nr_document)) || txt(a.conv_id).localeCompare(txt(b.conv_id)))
      // Copilot f10 UI P2-01: NU se împarte (serverul refuză plicurile parțiale) — peste limită = blocaj explicit, decizie separată
      if (conv.length > MAX_CONVOCARI_PLIC) { prea_mari.push({ ...g, convocari: conv }); return [] }
      return [{ ...g, convocari: conv }]
    })
  return { grupuri, fara_adresa, prea_mari }
}

export function textAR(plic, convocari, { proiect } = {}) {
  if (!areImputernicire(proiect)) throw { code: '23514', message: 'Fără împuternicirea Beneficiarului (nr. + data în Setări proiect) nu se generează AR-uri.' }
  if (!TEXTE_AR.proiecte.includes(proiect?.cod)) throw { code: '23514', message: 'Textul AR nu e validat juridic pentru acest proiect.' }
  if (!convocari.length) throw { code: '23514', message: 'Plicul nu are convocări.' }
  const n = convocari.length, uat = plic.uat_nume || convocari[0]?.uat_nume || ''
  const cuv = n === 1 ? 'convocare' : 'convocări'
  const nr = numereConvocari(convocari)
  if (nr.fel === 'lista') return `${TEXTE_AR.inceput} ${n} ${cuv} (nr. ${nr.text}) ${TEXTE_AR.scop}, UAT ${uat} – ${TEXTE_AR.lucrare}. Plic ${plic.nr_plic}. ${TEXTE_AR.expeditor}`
  if (nr.fel === 'interval') return `${TEXTE_AR.inceput} ${n} ${cuv} (nr. ${nr.text}) ${TEXTE_AR.scop}, UAT ${uat} – ${TEXTE_AR.lucrare}, enumerate în opisul plicului ${plic.nr_plic}. ${TEXTE_AR.expeditor}`
  return `${TEXTE_AR.inceput} ${n} ${cuv} ${TEXTE_AR.scop}, UAT ${uat} – ${TEXTE_AR.lucrare}, enumerate în opisul plicului ${plic.nr_plic}. ${TEXTE_AR.expeditor}`
}

// Copilot f10 UI P3-02: caracterele de control interzise în XML 1.0 se elimină (altfel DOCX-ul devine invalid)
const xml = v => String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]))
const paragraf = s => `<w:p><w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="22"/></w:rPr><w:t xml:space="preserve">${xml(s)}</w:t></w:r></w:p>`
export async function docxSimplu({ titlu, paragrafe = [], tabel, semnaturi = [] }) {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
  const borduri = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(k => `<w:${k} w:val="single" w:sz="4" w:color="000000"/>`).join('')
  const grid = tabel ? `<w:tblGrid>${tabel.cap.map(() => '<w:gridCol w:w="1500"/>').join('')}</w:tblGrid>` : ''
  const tabelXml = tabel ? `<w:tbl><w:tblPr><w:tblBorders>${borduri}</w:tblBorders></w:tblPr>${grid}${[tabel.cap, ...tabel.randuri].map(r => `<w:tr>${r.map(c => `<w:tc>${paragraf(c)}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>` : ''
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${[titlu, ...paragrafe].map(paragraf).join('')}${tabelXml}${semnaturi.map(paragraf).join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:bottom="1134" w:left="1134" w:right="1134"/></w:sectPr></w:body></w:document>`)
  const bytes = await zip.generateAsync({ type: 'uint8array' })
  return new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
}

export function genereazaOpis(plic, convocari, { proiect, uat, contact } = {}) {
  return docxSimplu({ titlu: `Opis - plicul ${plic.nr_plic}`, paragrafe: [
    `Data: ${dataText(dataBucuresti())}`, `Destinatar: ${plic.destinatar_nume}`, `Adresa: ${adresaPlic(contact || convocari[0]?.adresa)}`,
    `UAT: ${uat?.nume || plic.uat_nume || ''}`, `Proiect: ${proiect?.denumire || proiect?.cod || ''}`,
  ], tabel: { cap: ['Nr. crt.', 'Nr. convocare', 'ID parcelă', 'Tarla', 'Nr. cadastral', 'Poziție HG'],
    randuri: convocari.map((c, i) => [i + 1, c.nr_document, c.id_parcela, c.tarla, c.nr_cadastral, c.poz_hg]) },
  semnaturi: [`Plicul conține ${convocari.length} convocări. Fiecare convocare are atașat formularul de răspuns (cod QR personal).`,
    'Informarea privind datele personale se află pe verso-ul fiecărei convocări.',   // juridic#021 pct. 3
    'Întocmit: Gazpet Instal SRL'] })
}

export function genereazaPvPlicuire(lot, plicuri, convocariPePlic, { proiect } = {}) {
  const anulate = plicuri.filter(p => p.stare === 'anulat')
  return docxSimplu({ titlu: `Proces-verbal de plicuire nr. ${lot.nr_lot} din ${dataText(lot.data_plicuire)}`,
    paragrafe: [`Proiect: ${proiect?.denumire || proiect?.cod || ''}`, ...(anulate.length ? [`Plicuri anulate, excluse de la expediere: ${anulate.map(p => p.nr_plic).join(', ')}.`] : [])],
    tabel: { cap: ['Nr. crt.', 'Nr. plic', 'Destinatar', 'Nr. convocări', 'Numerele convocărilor', 'AWB'], randuri: plicuri.filter(p => p.stare !== 'anulat').map((p, i) => {
      const cs = convocariPePlic[p.id] || []
      return [i + 1, p.nr_plic, p.destinatar_nume, cs.length, cs.map(c => c.nr_document).join(', '), p.awb || '']
    }) }, semnaturi: ['Subsemnații am verificat că fiecare plic conține convocările și opisul de mai sus și că pe cartonașul AR este pretipărit conținutul.',
      `1. Nume (plicuiește): ${lot.semnatar1_nume || '________________'}; funcție: ________________; semnătură: ________________`,
      `2. Nume (verifică): ${lot.semnatar2_nume || '________________'}; funcție: ________________; semnătură: ________________`] })
}

export function csvEtichete(plicuri, convocariPePlic) {
  const celula = v => { const s = String(v ?? ''); return `"${(/^[\s]*[=+@-]/.test(s) ? "'" : '') + s.replace(/"/g, '""')}"` }
  return '\uFEFF' + [['Nr. plic', 'Destinatar', 'Adresă', 'UAT', 'Text AR'], ...plicuri.map(p => {
    const cs = convocariPePlic[p.id] || []
    return [p.nr_plic, p.destinatar_nume, adresaPlic(cs[0]?.adresa), p.uat_nume || cs[0]?.uat_nume, textAR(p, cs, { proiect: p.proiect })]   // fără împuternicire -> excepție (nu se generează)
  })].map(r => r.map(celula).join(';')).join('\r\n')
}
