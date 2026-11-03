// Șabloanele refăcute din modelele Final_v2 ale juristului (03.11.2026): conținutul cerut de deciziile juridic#028 + #029.
// Textul se citește direct din DOCX-urile reale (public/redari/sabloane), independent de generatoare.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import JSZip from 'jszip'
import { TERMEN_CONVOCARE_ZILE } from './setari.js'

const SABLOANE = ['convocator', 'pv_a', 'pv_b', 'adresa_uat', 'pv_c']
const RX_P = /<w:p(?:\s[^>]*)?>(?:(?!<w:p[\s>])[\s\S])*?<\/w:p>/g
const RX_T = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g
const decodeaza = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

async function citeste(nume) {
  const zip = await JSZip.loadAsync(readFileSync(`public/redari/sabloane/${nume}.docx`))
  const xml = await zip.file('word/document.xml').async('string')
  const paragrafe = [...xml.matchAll(RX_P)].map(m => decodeaza([...m[0].matchAll(RX_T)].map(t => t[1]).join(''))).filter(Boolean)
  return { zip, xml, paragrafe, text: paragrafe.join('\n') }
}

describe('șabloanele Final_v2', () => {
  it.each(SABLOANE)('%s: fără linia „MODEL – DRAFT INTERN”, fără miniatură și fără numele ultimului editor', async nume => {
    const { zip, text } = await citeste(nume)
    expect(text).not.toMatch(/DRAFT/)
    expect(zip.file('docProps/thumbnail.jpeg')).toBeNull()
    expect(await zip.file('docProps/core.xml').async('string')).toMatch(/<cp:lastModifiedBy><\/cp:lastModifiedBy>|<cp:lastModifiedBy\/>|^(?![\s\S]*lastModifiedBy)/)
  })

  it.each(SABLOANE)('%s: lipsa răspunsului nu e marcată nicăieri ca acord', async nume => {
    const { text } = await citeste(nume)
    expect(text).not.toMatch(/acord tacit|acceptare tacit|(consider|interpret|valoreaz)\S*\s+(ca\s+)?acord|lipsa (oricărui )?răspuns\S*\s+(se|valorează|înseamnă)/i)
    // singura mențiune admisă a „tacitului” o neagă (Model_4, Anexa 2: „nu reprezintă acceptarea tacită”)
    const tacit = [...text.matchAll(/[^.\n]*tacit[^.\n]*/gi)].map(m => m[0])
    for (const fraza of tacit) expect(fraza).toMatch(/nu reprezintă acceptarea tacită/)
  })

  it('PV A: semnează și Antreprenorul (3 semnatari), fără fotografii', async () => {
    const { paragrafe, text } = await citeste('pv_a')
    expect(paragrafe).toEqual(expect.arrayContaining(['Deținătorul terenului', 'S.N.T.G.N. TRANSGAZ S.A. – Beneficiar', 'GAZPET INSTAL S.R.L. – Antreprenor']))
    expect(paragrafe.slice(-3)).toEqual(['{{semnatar_detinator}}', '{{semnatar_tgz}}', '{{semnatar_gazpet}}'])
    expect(text).not.toMatch(/fotograf|foto_nr|bifa_foto/i)
    expect(text).toContain('Plan de situație anexat: {{bifa_plan_da}} DA {{bifa_plan_nu}} NU.')
  })

  it('PV B: fără fotografii, topo / plan de situație și jurnal de șantier; trimiterea la PV A rămâne', async () => {
    const { paragrafe, text } = await citeste('pv_b')
    expect(text).not.toMatch(/fotograf|topo|plan de situa|jurnal|bifa_plan|bifa_foto/i)
    expect(paragrafe).toContain('{{pv_a_referinta}}')
    expect(paragrafe[paragrafe.indexOf('{{pv_a_referinta}}') - 1]).toMatch(/^Nume: \{\{nume\}\}/)
    expect(text).toContain('{{bifa_fara_raspuns}} fără răspuns')
  })

  it('convocator: „Date personale” + {{text_gdpr}} pe tot paragraful, {{qr}} singur, lipsa răspunsului duce la constatarea tehnică', async () => {
    const { paragrafe } = await citeste('convocator')
    expect(paragrafe[paragrafe.indexOf('Date personale') + 1]).toBe('{{text_gdpr}}')
    expect(paragrafe).toContain('{{qr}}')
    expect(paragrafe).toContain('În lipsa participării sau a unui răspuns, reprezentanții Beneficiarului, ai Antreprenorului și ai Primăriei pot efectua o constatare tehnică documentată a stării terenului.')
  })

  it('adresa UAT: termenul din text = TERMEN_CONVOCARE_ZILE, un singur rând-șablon, fără antet și fără „online”', async () => {
    const { xml, text } = await citeste('adresa_uat')
    expect(text).toContain(`(cu cel puțin ${TERMEN_CONVOCARE_ZILE} zile înainte de prima sesiune)`)
    expect(xml.match(/\{\{rand\.nr\}\}/g)).toHaveLength(1)
    expect(text).not.toMatch(/contract_nr|proiect_denumire|online la/)
    expect(text).toContain('GAZPET INSTAL S.R.L. – {{reprezentant_gazpet}}')
  })
})
