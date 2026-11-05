import { describe, it, expect } from 'vitest'
import { poateIntreba, caleAtasament, verificaFisier, blocuriMd, bucatiRand } from './intrebariUtil.js'

describe('intrebariUtil', () => {
  it('acces: owner sau cheia exactă', () => {
    expect(poateIntreba(null)).toBe(false)
    expect(poateIntreba({ is_owner: true })).toBe(true)
    expect(poateIntreba({ module_access: ['intrebari_tehnice'] })).toBe(true)
    expect(poateIntreba({ module_access: ['ofertare', 'intrebari'] })).toBe(false)
  })
  it('calea atașamentului are forma din trigger', () => {
    const uid = '9a15808f-1743-40bd-b819-58313b3a0ebf', u = '11111111-2222-3333-4444-555555555555'
    expect(caleAtasament(uid, 'application/pdf', u)).toBe(`${uid}/${u}.pdf`)
    expect(caleAtasament(uid, 'image/jpeg', u)).toBe(`${uid}/${u}.jpg`)
    expect(caleAtasament(uid, 'text/html', u)).toBe(null)
  })
  it('fișiere: tip și mărime', () => {
    expect(verificaFisier({ type: 'application/pdf', size: 1000 })).toBe(null)
    expect(verificaFisier({ type: 'application/zip', size: 1000 })).toMatch(/PDF/)
    expect(verificaFisier({ type: 'image/png', size: 26 * 1024 * 1024 })).toMatch(/MB/)
  })
  it('markdown: titluri, liste, paragrafe, hr', () => {
    const b = blocuriMd('**Pe scurt**\nDa.\n\n## Temei\n- NTPEE\n- I9\n1. unu\n---\ntext')
    expect(b.map(x => x.tip)).toEqual(['p', 'h', 'lista', 'lista', 'hr', 'p'])
    expect(b[2].elemente).toEqual(['NTPEE', 'I9'])
    expect(b[3].ordonata).toBe(true)
  })
  it('rând: bold, italic, cod; HTML rămâne text', () => {
    expect(bucatiRand('a **b** _c_ `d` <script>')).toEqual([
      { t: 'text', v: 'a ' }, { t: 'b', v: 'b' }, { t: 'text', v: ' ' }, { t: 'i', v: 'c' }, { t: 'text', v: ' ' }, { t: 'cod', v: 'd' }, { t: 'text', v: ' <script>' },
    ])
  })
})
