// Format A4 + fața convocatorului pe o pagină (decizia Răzvan 03.11.2026, „varianta A”; docs/redari/SABLOANE.md §9).
// Se citesc DOCX-urile reale din public/redari/sabloane; valorile așteptate vin din decizie și din șabloanele de dinainte de
// reformatare (amprentele textului de mai jos, calculate pe main @ ac7afa7c), nu din generator.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import JSZip from 'jszip'
import { completeazaDocx, genereazaQr, CHEI_CONVOCATOR } from './docx.js'

// sha256 + lungimea textului concatenat din <w:t> (word/document.xml), ÎNAINTE de trecerea pe A4 (main @ ac7afa7c)
const TEXT_INAINTE = {
  convocator: [3170, '813b018428a753e6faefd6539158151861f83bfdf4f6ea0d40960364816e80c2'],
  pv_a: [3324, 'cb97470bb438245c89401531276b76ba5ab242d1e6f73afc5519cc975af71e9c'],
  pv_b: [4109, '70ab26c04521871f397892d9471a4f21b020a3b0ae40ffb25f4a8605035e2c72'],
  adresa_uat: [4843, '0113e3a3295b35cfec8e0457066b531c6d6c1540799115657d35b41ba189a066'],
  pv_c: [1836, 'e99eb57eb97fdeb57515ce0b9f0fff81145682c26922f54416ed5ef6d5b05a9d'],
}
// A4 în twips (210 × 297 mm; 1 mm = 56,69 twips)
const A4 = { w: 11906, h: 16838 }
const CM = 567

async function citeste(nume) {
  const zip = await JSZip.loadAsync(readFileSync(`public/redari/sabloane/${nume}.docx`))
  return { doc: await zip.file('word/document.xml').async('string'), stiluri: await zip.file('word/styles.xml').async('string') }
}
const textWt = xml => [...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map(m => m[1]).join('')
const atribut = (tag, a) => Number(new RegExp(`w:${a}="(\\d+)"`).exec(tag)?.[1])

describe('șabloanele pe A4', () => {
  it.each(Object.keys(TEXT_INAINTE))('%s: o singură secțiune, pagină A4 portret, tabelele încap între margini (tblW, gridCol, tcW)', async nume => {
    const { doc } = await citeste(nume)
    const sect = doc.match(/<w:sectPr[\s>][\s\S]*?<\/w:sectPr>/g)
    expect(sect).toHaveLength(1)
    const pgSz = /<w:pgSz [^>]*\/>/.exec(sect[0])[0]
    expect([atribut(pgSz, 'w'), atribut(pgSz, 'h')]).toEqual([A4.w, A4.h])
    expect(pgSz).not.toMatch(/orient="landscape"/)
    const pgMar = /<w:pgMar [^>]*\/>/.exec(sect[0])[0]
    const util = A4.w - atribut(pgMar, 'left') - atribut(pgMar, 'right')
    const tabele = [...doc.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>/g)].map(m => m[0])
    expect(tabele.length).toBeGreaterThan(0)
    for (const tbl of tabele) {
      // fără tabele imbricate: rândurile de mai jos aparțin acestui tabel
      expect(tbl.slice(7)).not.toMatch(/<w:tbl>/)
      // w:tblW: auto / nil acceptate; dxa ≤ lățimea utilă; pct ≤ 100% (5000)
      const tblW = /<w:tblW w:w="(\d+)" w:type="(\w+)"\/>/.exec(tbl)
      expect(tblW).not.toBeNull()
      expect(['auto', 'nil', 'dxa', 'pct']).toContain(tblW[2])
      if (tblW[2] === 'dxa') expect(Number(tblW[1])).toBeLessThanOrEqual(util)
      if (tblW[2] === 'pct') expect(Number(tblW[1])).toBeLessThanOrEqual(5000)
      const grid = /<w:tblGrid>([\s\S]*?)<\/w:tblGrid>/.exec(tbl)[1]
      expect([...grid.matchAll(/w:w="(\d+)"/g)].reduce((a, m) => a + Number(m[1]), 0)).toBeLessThanOrEqual(util)
      // fiecare rând: suma w:tcW (toate în dxa) ≤ lățimea utilă
      for (const tr of tbl.matchAll(/<w:tr[\s>][\s\S]*?<\/w:tr>/g)) {
        const tcW = [...tr[0].matchAll(/<w:tcW w:w="(\d+)" w:type="(\w+)"\/>/g)]
        expect(tcW.length).toBeGreaterThan(0)
        expect(tcW.every(m => m[2] === 'dxa')).toBe(true)
        expect(tcW.reduce((a, m) => a + Number(m[1]), 0)).toBeLessThanOrEqual(util)
      }
    }
  })

  it.each(Object.keys(TEXT_INAINTE))('%s: textul din <w:t> e identic cu cel de dinainte de reformatare', async nume => {
    const t = textWt((await citeste(nume)).doc)
    const [lungime, sha] = TEXT_INAINTE[nume]
    expect(t.length).toBe(lungime)
    expect(createHash('sha256').update(t).digest('hex')).toBe(sha)
  })
})

describe('convocatorul: fața pe o pagină A4', () => {
  it('margini 1,27 cm sus/jos și 1,5 cm stânga/dreapta (nu mai mici de 1 cm)', async () => {
    const pgMar = /<w:pgMar [^>]*\/>/.exec((await citeste('convocator')).doc)[0]
    expect({ sus: atribut(pgMar, 'top'), jos: atribut(pgMar, 'bottom'), stanga: atribut(pgMar, 'left'), dreapta: atribut(pgMar, 'right') })
      .toEqual({ sus: 720, jos: 720, stanga: 850, dreapta: 850 })
    for (const v of ['top', 'bottom', 'left', 'right']) expect(atribut(pgMar, v)).toBeGreaterThanOrEqual(CM)
  })

  it('corpul de literă: Normal 9,5 pt; sub 9,5 pt doar antetul firmei și blocul „Date personale”, ca în model', async () => {
    const { doc, stiluri } = await citeste('convocator')
    const normal = /<w:style w:type="paragraph" w:default="1" w:styleId="Normal">[\s\S]*?<\/w:style>/.exec(stiluri)[0]
    expect(atribut(/<w:sz [^>]*\/>/.exec(normal)[0], 'val')).toBe(19)
    const def = /<w:pPrDefault>[\s\S]*?<\/w:pPrDefault>/.exec(stiluri)[0]
    expect(def).toContain('<w:spacing w:after="0" w:line="240" w:lineRule="auto"/>')
    // run-urile cu text: mărimea explicită (sau Normal) ≥ 19 jumătăți de punct, cu excepțiile mici din model
    const mici = []
    for (const r of doc.matchAll(/<w:r[\s>][\s\S]*?<\/w:r>/g)) {
      const text = textWt(r[0])
      if (!text.trim()) continue
      const sz = Number(/<w:rPr>[\s\S]*?<w:sz w:val="(\d+)"/.exec(r[0])?.[1] ?? 19)
      if (sz < 19) mici.push([sz, text.slice(0, 20)])
    }
    expect(mici).toEqual([
      [16, 'GAZPET INSTAL S.R.L.'], [16, 'Lider al Asocierii G'], [18, 'Date personale'], [17, '{{text_gdpr}}'],
    ])
    // titlul rămâne 13 pt
    expect(doc).toMatch(/<w:sz w:val="26"\/><w:lang w:val="it-IT"\/><\/w:rPr><w:t>CONVOCARE<\/w:t>/)
  })

  it('QR: paragraful {{qr}} e singur, într-un cadru de 3,2 cm aliniat la dreapta (imaginea rămâne 3 cm, docx.js)', async () => {
    const { doc } = await citeste('convocator')
    const p = [...doc.matchAll(/<w:p(?:\s[^>]*)?>(?:(?!<w:p[\s>])[\s\S])*?<\/w:p>/g)].map(m => m[0]).filter(x => x.includes('{{qr}}'))
    expect(p).toHaveLength(1)
    expect(textWt(p[0])).toBe('{{qr}}')
    const cadru = /<w:framePr [^>]*\/>/.exec(p[0])[0]
    expect(cadru).toMatch(/w:xAlign="right"/)
    expect(cadru).toMatch(/w:wrap="around"/)
    expect(atribut(cadru, 'w')).toBeGreaterThanOrEqual(3 * CM)
    expect(readFileSync('src/redari/docx.js', 'utf8')).toMatch(/const QR_CM = 3\b/)
  })

  it('convocatorul completat (completeazaDocx, strict, date fictive): cadrul rămâne, QR-ul e desen inline cu relație validă, fără placeholder-e', async () => {
    const campuri = Object.fromEntries(CHEI_CONVOCATOR.filter(k => k !== 'qr').map(k => [k, `TEST ${k}`]))
    const qr = await genereazaQr('https://example.invalid/redari/raspuns/TEST0000fictiv')
    const blob = await completeazaDocx(readFileSync('public/redari/sabloane/convocator.docx'), campuri, { imagini: { qr }, strict: true })
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    const doc = await zip.file('word/document.xml').async('string')
    const cuDesen = [...doc.matchAll(/<w:p(?:\s[^>]*)?>(?:(?!<w:p[\s>])[\s\S])*?<\/w:p>/g)].map(m => m[0]).filter(p => p.includes('<w:drawing>'))
    expect(cuDesen).toHaveLength(1)
    // cadrul din șablon rămâne pe paragraful imaginii
    expect(cuDesen[0]).toMatch(/<w:pPr><w:framePr [^>]*w:xAlign="right"[^>]*\/>/)
    // desen inline (nu ancorat), 3 cm × 3 cm
    expect(cuDesen[0]).toMatch(/<wp:inline[\s>]/)
    expect(cuDesen[0]).not.toMatch(/<wp:anchor[\s>]/)
    expect(cuDesen[0]).toContain('<wp:extent cx="1080000" cy="1080000"/>')
    // relația imaginii: r:embed → word/_rels/document.xml.rels → media/qr.png, fișier prezent în zip
    const rId = /r:embed="([^"]+)"/.exec(cuDesen[0])[1]
    const rels = await zip.file('word/_rels/document.xml.rels').async('string')
    const rel = new RegExp(`<Relationship [^>]*Id="${rId}"[^>]*/>`).exec(rels)?.[0]
    expect(rel).toMatch(/Target="media\/qr\.png"/)
    expect(rel).toMatch(/relationships\/image"/)
    expect(zip.file('word/media/qr.png')).not.toBeNull()
    // niciun placeholder rămas
    expect(textWt(doc)).not.toMatch(/\{\{|\}\}/)
    expect(textWt(doc)).toContain('TEST nr_document')
  })

  it('fără marcajul de pagină vechi (lastRenderedPageBreak) și fără sfârșit de pagină forțat pe față', async () => {
    const { doc } = await citeste('convocator')
    expect(doc).not.toMatch(/lastRenderedPageBreak|<w:br w:type="page"\/>|pageBreakBefore/)
  })
})
