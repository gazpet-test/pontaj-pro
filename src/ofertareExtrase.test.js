import { describe, it, expect } from 'vitest'
import { esteExtras, primiteVizibile, rezumatExtrase } from './ofertareExtrase.js'

const D = (id, nume_original, tip = 'alta') => ({ id, nume_original, tip })
// forma Mânăstirea / lic. 3: arhiva #1305 publicată ca „clarificare” + 159 de fișiere extrase
const docs = [
  D(1305, 'DOC_F1_F6_C1_C9.rar', 'raspuns_clarificare'),
  D(1624, 'Raspuns clarificari 2.pdf', 'raspuns_clarificare'),
  ...Array.from({ length: 70 }, (_, i) => D(2000 + i, `DOC_F1_F6_C1_C9 (#1305)/C6_${i}.pdf`, 'formular')),
  ...Array.from({ length: 48 }, (_, i) => D(3000 + i, `DOC_F1_F6_C1_C9 (#1305)/F3_${i}.pdf`, 'lista_cantitati')),
  ...Array.from({ length: 32 }, (_, i) => D(4000 + i, `DOC_F1_F6_C1_C9 (#1305)/${i}. Detaliu.pdf`, 'plansa')),
  ...Array.from({ length: 9 }, (_, i) => D(5000 + i, `DOC_F1_F6_C1_C9 (#1305)/${32 + i}. ATR.pdf`, 'alta')),
]

describe('fișierele extrase din arhive în listele „primite”', () => {
  it('lista rămâne cu arhiva și răspunsurile, nu cu cele 159 de fișiere', () => {
    expect(primiteVizibile(docs).map(d => d.id)).toEqual([1305, 1624])
  })
  it('un extras care e el însuși răspuns la clarificare rămâne vizibil', () => {
    const cu = [...docs, D(6000, 'DOC_F1_F6_C1_C9 (#1305)/Clarificare_Oficiu.pdf', 'raspuns_clarificare')]
    expect(primiteVizibile(cu).map(d => d.id)).toEqual([1305, 1624, 6000])
  })
  it('rezumatul arhivei, pe tip, descrescător', () => {
    const r = rezumatExtrase(1305, docs)
    expect(r.n).toBe(159)
    expect(r.text).toBe('📦 159 fișiere extrase din arhivă: 70 formulare, 48 liste de cantități, 32 planșe, 9 alte — sunt în Documentație')
  })
  it('descendenții la orice adâncime; #13 nu e #1305', () => {
    const imb = [D(1, 'A.zip'), D(2, 'A (#1)/B.zip'), D(3, 'A (#1)_B (#2)/x.pdf', 'formular'), D(13, 'C (#13)/y.pdf')]
    expect(rezumatExtrase(1, imb).n).toBe(2)
    expect(rezumatExtrase(2, imb).n).toBe(1)
    expect(rezumatExtrase(130, imb)).toBeNull()
    expect(primiteVizibile(imb).map(d => d.id)).toEqual([1])
  })
  it('arhivele extrase rămase nedespachetate (volume / adâncime / respinse) rămân vizibile și sunt numărate', () => {
    const cu = [D(900, 'Raspuns clarificari.zip', 'raspuns_clarificare'),
      { ...D(901, 'Raspuns clarificari (#900)/PT revizuit.part1.rar', 'alta'), eroare: 'Despachetare manuală necesară: arhivă în volume' },
      { ...D(902, 'Raspuns clarificari (#900)/Caiet revizuit.zip', 'alta'), eroare: 'Despachetare RESPINSĂ de controalele de siguranță' },
      { ...D(903, 'Raspuns clarificari (#900)/Bun.zip', 'alta'), eroare: '📦 Arhivă despachetată pe Terra: 2 fișiere noi' },
      D(904, 'Raspuns clarificari (#900)/In curs.zip', 'alta'),
      D(905, 'Raspuns clarificari (#900)/Formular.pdf', 'formular')]
    expect(primiteVizibile(cu).map(d => d.id)).toEqual([900, 901, 902])
    const r = rezumatExtrase(900, cu)
    expect(r.blocate).toBe(2)
    expect(r.text).toContain('⚠ 2 arhive interioare de despachetat manual')
  })
  it('esteExtras', () => {
    expect(esteExtras(D(1, 'A (#1)/x.pdf'))).toBe(true)
    expect(esteExtras(D(1, 'Raspuns (#1).pdf'))).toBe(false)
    expect(esteExtras(null)).toBe(false)
  })
})
