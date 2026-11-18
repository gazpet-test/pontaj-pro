// Terminologia „predare” în șabloane (deciziile Răzvan 17.11.2026; textele din juridic#044 §1, #045 pct. 1, #046 pct. 1).
// Textul se citește din DOCX-urile reale (public/redari/sabloane). Valorile așteptate vin din tabelul Juridicului și din amprentele
// calculate pe main înainte de schimbare (d943e090), nu din generator.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import JSZip from 'jszip'

const RX_P = /<w:p(?:\s[^>]*)?>(?:(?!<w:p[\s>])[\s\S])*?<\/w:p>/g
const RX_T = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g
const decodeaza = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
const sha = b => createHash('sha256').update(b).digest('hex')

async function citeste(nume) {
  const buf = readFileSync(`public/redari/sabloane/${nume}.docx`)
  const zip = await JSZip.loadAsync(buf)
  const xml = await zip.file('word/document.xml').async('string')
  const paragrafe = [...xml.matchAll(RX_P)].map(m => decodeaza([...m[0].matchAll(RX_T)].map(t => t[1]).join(''))).filter(t => t.trim())
  return { buf, xml, paragrafe, text: paragrafe.join('\n'), chei: [...xml.matchAll(/\{\{([A-Za-z0-9_.]+)\}\}/g)].map(m => m[1]) }
}

// [paragraf nou întreg, text vechi care nu mai apare nicăieri]
const SCHIMBATE = {
  convocator: [
    ['CONVOCAREla predarea terenului', 'la constatarea readucerii terenului la starea inițială'],
    ['   ☐ Nu particip. Nu am obiecții privind starea terenului și sunt de acord să primesc procesul-verbal completat, spre semnare, electronic.', 'prin poștă / electronic'],
  ],
  pv_a: [['PROCES-VERBAL DE PREDAREa terenului către proprietar / deținător (tip A)', 'a readucerii terenului la starea inițială (tip A – cu proprietarul / utilizatorul)']],
  pv_b: [
    ['Scrisoare recomandată sau curier, cu confirmare de primire', 'Scrisoare recomandată cu confirmare de primire'],
    ['nr. recomandată / AWB {{conv_nr_tracking}}', 'nr. recomandată {{conv_nr_tracking}}'],
    ['adresa Beneficiar nr. {{reluare_adresa_tgz_nr}} / recomandată sau AWB nr. {{reluare_nr_tracking}}', '/ recomandată nr.'],
  ],
  pv_c: [['PROCES-VERBAL DE FINALIZARE A PREDĂRII TERENURILORpe tronson', 'RECEPȚIE A READUCERII TERENULUI'],
  ],
}
SCHIMBATE.convocator_utilizator = SCHIMBATE.convocator

// Neschimbate intenționat (juridic#044 §1): titlul PV tip B, secțiunile 3 și 5 din PV A, fraza comisiei din PV C
const NESCHIMBATE = {
  pv_a: ['3. Lucrări de readucere executate', '5. Obiecțiile deținătorului privind readucerea terenului'],
  pv_b: ['PROCES-VERBAL DE CONSTATARE TEHNICĂși de consemnare a demersurilor de convocare (tip B – fără deținător)'],
  pv_c: ['Comisia constată că lucrările de readucere a terenului la starea inițială pe tronsonul de mai sus sunt executate'],
}

// Lista ORDONATĂ a placeholder-elor din word/document.xml pe main @ d943e090, înainte de schimbare: [apariții, sha256(join '\n')]
const CHEI_INAINTE = {
  convocator: [37, 'e919c9620b655a33e812bae652eabca9ce021867412310f4b53f81c024e5e89e'],
  convocator_utilizator: [37, 'e919c9620b655a33e812bae652eabca9ce021867412310f4b53f81c024e5e89e'],
  pv_a: [54, 'e6523a5d205e7fa9af6ba4364743bc9c062feb30cc4d761cff6966fe1d6e426a'],
  pv_b: [74, '1bfcfa7ea64e6dfae25a1eb77c4acb3b54b5fccc6d6e4a504d6848c2f5faec15'],
  pv_c: [23, '2a3f707a8ae667075a6fec08831017990c3c3f6701476a6c3320cba8a8716886'],
}
// Neatinse (așteaptă text de la Juridic): fișierul întreg, octet cu octet, ca pe main @ d943e090
const NEATINSE = {
  adresa_uat: '9d0723770020fdbe5194f2683b1ff1b8852ff93cc3c547ed45ccb6f0296d4525',
  cerere_imputernicire: '44545c35df2bb6eb29993643a02a55dd57e6c8c54cbeb2b6ef6ed9f30aa91fb6',
}

describe('șabloanele: terminologia „predare” (17.11.2026)', () => {
  it.each(Object.keys(SCHIMBATE))('%s: textul nou e un paragraf întreg, o singură dată; textul vechi nu mai apare', async nume => {
    const { paragrafe, text } = await citeste(nume)
    for (const [nou, vechi] of SCHIMBATE[nume]) {
      expect(paragrafe.filter(p => p === nou), nou).toHaveLength(1)
      expect(text, vechi).not.toContain(vechi)
    }
  })

  it.each(Object.keys(CHEI_INAINTE))('%s: aceeași listă de placeholder-e (ordine și apariții) ca înainte', async nume => {
    const { chei } = await citeste(nume)
    const [n, h] = CHEI_INAINTE[nume]
    expect(chei).toHaveLength(n)
    expect(sha(chei.join('\n'))).toBe(h)
  })

  it.each(Object.keys(NESCHIMBATE))('%s: textele marcate „neschimbat intenționat” rămân', async nume => {
    const { text } = await citeste(nume)
    for (const t of NESCHIMBATE[nume]) expect(text).toContain(t)
  })

  it.each(Object.keys(NEATINSE))('%s: neatins (aceiași octeți ca pe main)', async nume => {
    expect(sha((await citeste(nume)).buf)).toBe(NEATINSE[nume])
  })

  it.each(['convocator', 'convocator_utilizator'])('%s: exact trei opțiuni de răspuns, în ordinea din model; fără „Am următoarele obiecții”', async nume => {
    const { paragrafe, text } = await citeste(nume)
    const optiuni = paragrafe.filter(p => p.trim().startsWith('☐')).map(p => p.trim())
    expect(optiuni).toEqual([
      '☐ Particip la sesiune în ziua ____ / intervalul ________.',
      '☐ Nu particip. Nu am obiecții privind starea terenului și sunt de acord să primesc procesul-verbal completat, spre semnare, electronic.',
      '☐ Contest starea terenului și solicit constatarea pe teren, la data stabilită de comisie.',
    ])
    expect(text).not.toMatch(/Am următoarele obiecții/)
    // QR-ul rămâne imediat înaintea opțiunilor
    expect(paragrafe[paragrafe.indexOf('{{qr}}') + 1].trim()).toBe(optiuni[0])
  })

  it.each(Object.keys(SCHIMBATE))('%s: fiecare parte XML și .rels din arhivă e XML bine format (verificator cu stivă)', async nume => {
    const zip = await JSZip.loadAsync(readFileSync(`public/redari/sabloane/${nume}.docx`))
    const parti = Object.values(zip.files).filter(f => !f.dir && /\.(xml|rels)$/i.test(f.name))
    expect(parti.map(f => f.name)).toEqual(expect.arrayContaining(['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/_rels/document.xml.rels']))
    for (const f of parti) expect(eroareXml(await f.async('string')), f.name).toBeNull()
  })
})

// Verificatorul XML minimal (review #1117 r2, P3) stă în xmlBineFormat.testutil.js (18.11.2026: folosit și de anuntAfisare.test.js);
// mutanții lui rămân aici.
import { eroareXml } from './xmlBineFormat.testutil.js'

describe('verificatorul XML din test (mutanți: trebuie să pice)', () => {
  it('acceptă XML valid mic (prolog, comentariu, CDATA, entități, auto-închis)', () => {
    expect(eroareXml('<?xml version="1.0"?>\n<a x="1" y=\'&amp;&#38;&#x26;\'><!-- c --><b/><c>t &lt; u<![CDATA[<raw>&]]></c></a>\n')).toBeNull()
  })
  it.each([
    ['tag neînchis', '<a><b></a>', /închide/],
    ['închidere lipsă la final', '<a><b></b>', /neînchise/],
    ['ordine greșită', '<a><b><c></b></c></a>', /închide/],
    ['& brut în text', '<a>x & y</a>', /entitate/],
    ['entitate necunoscută', '<a>&nbsp;</a>', /entitate/],
    ['& brut în atribut', '<a h="x&y"/>', /entitate/],
    ['atribut dublu', '<a h="1" h="2"/>', /dublu/],
    ['atribut fără ghilimele', '<a h=1/>', /deschidere invalid/],
    ['două rădăcini', '<a/><b/>', /rădăcină/],
    ['text după rădăcină', '<a/>x', /în afara/],
    ['gol', '', /fără element/],
  ])('%s', (_n, xml, motiv) => { expect(eroareXml(xml)).toMatch(motiv) })
  it('mutanți pe document.xml real (convocator): un tag scos / schimbat / un & brut → pică', async () => {
    const { xml } = await citeste('convocator')
    expect(eroareXml(xml)).toBeNull()
    expect(eroareXml(xml.replace('</w:t>', ''))).not.toBeNull()                 // un tag neînchis
    expect(eroareXml(xml.replace('</w:r>', '</w:p>'))).not.toBeNull()           // perechea greșită
    expect(eroareXml(xml.replace(/<w:t(\s[^>]*)?>/, m => m + '&'))).not.toBeNull() // entitate ruptă
    expect(eroareXml(xml.replace('<w:body>', '<w:body w:x="1" w:x="2">'))).not.toBeNull()
  })
})
