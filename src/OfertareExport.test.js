// Proba H-109: documentatia cere numerotarea FIECAREI file. Testul nu se uita la obiectul din
// memorie, ci impacheteaza DOCX-ul si citeste XML-ul subsolului — adica exact ce ajunge in Word.
import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { Packer } from 'docx'
import { construiestePropunere, construiesteBorderou, numeFisier, etichetaCapitol } from './OfertareExport.js'

const LIC = { obiect: 'Extindere retea gaze', nr_anunt: 'CN1054321' }
const CAP = [
  { nr: 1, eticheta: 'Cap. I', titlu: 'Rezumat', sectiune: 'A', continut: 'Un paragraf.\n\nAl doilea.' },
  { nr: 2, eticheta: 'Anexa 7', titlu: 'Grafic', sectiune: 'B', continut: '' },
]

const subsoluri = async (doc) => {
  const zip = await JSZip.loadAsync(await Packer.toBuffer(doc))
  const cai = Object.keys(zip.files).filter(f => /^word\/footer\d*\.xml$/.test(f))
  return Promise.all(cai.map(c => zip.file(c).async('string')))
}

describe('H-109 numerotarea filelor — subsolul chiar ajunge in DOCX', () => {
  it('propunerea are subsol cu campurile PAGE si NUMPAGES', async () => {
    const f = await subsoluri(construiestePropunere({ licitatie: LIC, capitole: CAP }))
    expect(f.length).toBeGreaterThan(0)
    const tot = f.join('')
    expect(tot).toMatch(/\bPAGE\b/); expect(tot).toMatch(/NUMPAGES/); expect(tot).toMatch(/Pagina/)
  })
  it('borderoul are acelasi subsol', async () => {
    const tot = (await subsoluri(construiesteBorderou({ licitatie: LIC, capitole: CAP }))).join('')
    expect(tot).toMatch(/\bPAGE\b/); expect(tot).toMatch(/NUMPAGES/)
  })
  it('capitolul necompletat lasa avertismentul in document, nu trece tacut', async () => {
    const zip = await JSZip.loadAsync(await Packer.toBuffer(construiestePropunere({ licitatie: LIC, capitole: CAP })))
    expect(await zip.file('word/document.xml').async('string')).toMatch(/CAPITOL NECOMPLETAT/)
  })
  it('numeFisier scoate diacriticele si spatiile', () =>
    expect(numeFisier('Propunere', { nr_anunt: 'CN 105/4321 — Mânăstirea' })).toBe('Propunere_CN_105_4321_Manastirea.docx'))
  it('eticheta din opis bate nr-ul de ordine', () => {
    expect(etichetaCapitol({ nr: 2, eticheta: 'Anexa 7' })).toBe('Anexa 7')
    expect(etichetaCapitol({ nr: 2, eticheta: null })).toBe('2.')
  })
})
