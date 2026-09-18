// Proba H-109: documentatia cere numerotarea FIECAREI file. Testul nu se uita la obiectul din
// memorie, ci impacheteaza DOCX-ul si citeste XML-ul subsolului — adica exact ce ajunge in Word.
import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { Packer } from 'docx'
import { construiestePropunere, construiesteBorderou, construiesteF23, numeFisier, etichetaCapitol } from './OfertareExport.js'

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

// Formularul 23 — lista de dotări. Probele se uită la XML-ul din DOCX, nu la obiectul din
// memorie: ce contează e ce vede comisia în Word.
describe('Formularul 23 — declarația privind utilajele', () => {
  const DOT = [
    { denumire: 'HITACHI EXCAVATOR ZX 210', um: 'buc', proprietate: 3, chirie: null, contract: null },
    { denumire: 'WEDA ELECTROPOMPA D30L', um: 'buc', proprietate: null, chirie: 2, contract: null },
    { denumire: 'SC UNIVTEH — laborator încercări', um: 'contract', proprietate: null, chirie: null, contract: 1 },
  ]
  const xml = async (doc) => {
    const zip = await JSZip.loadAsync(await Packer.toBuffer(doc))
    return zip.file('word/document.xml').async('string')
  }

  it('cantitatea intra pe coloana formei de detinere, si totalul le insumeaza', async () => {
    const t = await xml(construiesteF23({ licitatie: LIC, dotari: DOT }))
    expect(t).toMatch(/Proprietate/); expect(t).toMatch(/În chirie/)
    expect(t).toMatch(/Contract prestări servicii/)
    expect(t).toMatch(/HITACHI EXCAVATOR ZX 210/)
    expect(t).toMatch(/WEDA ELECTROPOMPA D30L/)
  })

  it('sediul autoritatii NU se inventeaza cand lipseste din licitatie', async () => {
    const t = await xml(construiesteF23({ licitatie: LIC, dotari: DOT }))
    expect(t).toMatch(/DE COMPLETAT: sediul autorității contractante/)
  })

  it('cand licitatia are autoritatea si sediul, apar in declaratie', async () => {
    const t = await xml(construiesteF23({
      licitatie: { ...LIC, autoritate: 'UAT COMUNA DOMNEȘTI', autoritate_sediu: 'Sos. Alexandru Ioan Cuza nr. 25-27' },
      dotari: DOT,
    }))
    expect(t).toMatch(/UAT COMUNA DOMNEȘTI/)
    expect(t).toMatch(/Alexandru Ioan Cuza/)
    expect(t).not.toMatch(/DE COMPLETAT: sediul/)
  })

  it('are acelasi subsol cu numerotarea filelor ca restul documentelor casei', async () => {
    const tot = (await subsoluri(construiesteF23({ licitatie: LIC, dotari: DOT }))).join('')
    expect(tot).toMatch(/\bPAGE\b/); expect(tot).toMatch(/NUMPAGES/)
  })

  it('lista goala nu arunca — iese formularul fara randuri, nu o eroare', async () => {
    const t = await xml(construiesteF23({ licitatie: LIC, dotari: [] }))
    expect(t).toMatch(/LISTĂ UTILAJE, INSTALAȚII ȘI ECHIPAMENTE TEHNICE/)
  })
})
