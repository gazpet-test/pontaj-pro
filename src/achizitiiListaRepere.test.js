import { describe, it, expect } from 'vitest'
import { liniiPrimite, esc, buildListaRepereHtml } from './achizitiiListaRepere.js'

const COMANDA = {
  numar_comanda: 'CMD-2026-0412',
  linii: [
    { denumire: 'Țeavă PE100 SDR11 Ø63', um: 'm', cantitate: 120, cantitate_primita: 100, pret_unitar: 17.45, observatii: 'colac 100 m' },
    { denumire: 'Robinet <sferic> DN50 & mufe', um: 'buc', cantitate: 4, pret_unitar: 312.9 },
    { denumire: 'Teu electrofuziune 63', um: 'buc', cantitate: 6, cantitate_primita: 0, pret_unitar: 41 },  // anulat de furnizor
    { denumire: '', um: 'buc', cantitate: 3 },
  ],
}

describe('liniiPrimite', () => {
  it('cantitatea efectivă: recepția pe repere primează, reperele anulate (0) și fără denumire ies', () => {
    expect(liniiPrimite(COMANDA.linii)).toEqual([
      { denumire: 'Țeavă PE100 SDR11 Ø63', um: 'm', cantitate: 100, observatii: 'colac 100 m' },
      { denumire: 'Robinet <sferic> DN50 & mufe', um: 'buc', cantitate: 4, observatii: '' },
    ])
    expect(liniiPrimite(null)).toEqual([])
  })
})

describe('buildListaRepereHtml', () => {
  const html = buildListaRepereHtml(COMANDA, { furnizorNume: 'Valrom <SRL>', proiectNume: '[P93] Jilava', livrareTxt: 'Sediu Gazpet Instal (Ploiești)' }, new Date('2026-10-05T10:00:00Z'))
  it('fără prețuri: nici prețul unitar, nici valori', () => {
    expect(html).not.toMatch(/17[,.]45|312[,.]9|pret|preț unitar|valoare|lei/i)
    expect(html).toContain('fără prețuri')
  })
  it('repere + cantități primite + coloane de bifat și loc depozitare; escapare HTML', () => {
    expect(html).toContain('Țeavă PE100 SDR11 Ø63')
    expect(html).toContain('<b>100</b>')
    expect(html).toContain('Robinet &lt;sferic&gt; DN50 &amp; mufe')
    expect(html).toContain('Valrom &lt;SRL&gt;')
    expect(html).not.toContain('Teu electrofuziune')
    expect(html).toContain('<th>Loc depozitare</th>')
    expect(html).toContain('2 repere')
    expect(html).toContain('05.10.2026')
  })
  it('comandă fără repere primite → mesaj, nu tabel gol', () => {
    expect(buildListaRepereHtml({ numar_comanda: 'X', linii: [] })).toContain('Nu există repere primite')
  })
  it('esc', () => { expect(esc(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;'); expect(esc(null)).toBe('') })
})
