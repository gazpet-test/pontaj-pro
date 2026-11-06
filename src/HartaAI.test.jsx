import { readFileSync } from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import HartaAI, { textScurt } from './HartaAI.jsx'

const exemplu = () => JSON.parse(readFileSync(new URL('../scripts/harta_ai/exemplu.json', import.meta.url), 'utf8'))

describe('Harta AI › desenatorul', () => {
  it('desenează nodurile, grupurile, fluxurile și nota despre secrete', () => {
    const html = renderToStaticMarkup(<HartaAI date={exemplu()} />)
    expect(html).toContain('Worker de citire')
    expect(html).toContain('Servicii externe')
    expect(html).toContain('Document → cerințe')
    expect(html).toContain('Valorile secretelor nu apar niciodată pe hartă')
    expect(html).toContain('harta-sageata-bani')
    expect(html).not.toContain('Harta nu se desenează')
  })
  it('refuză să deseneze un fișier cu ceva care arată a secret și nu afișează valoarea', () => {
    const d = exemplu()
    d.noduri[4].fisa.cont = 'sk-ant-api03-AbCdEfGhIjKlMnOpQr'
    const html = renderToStaticMarkup(<HartaAI date={d} />)
    expect(html).toContain('Harta nu se desenează')
    expect(html).not.toContain('Worker de citire')
    expect(html).not.toContain('sk-ant-api03')
  })
  it('arată bannerul de avertismente, dar desenează harta', () => {
    const d = exemplu()
    d.legaturi[0].ce = ''
    const html = renderToStaticMarkup(<HartaAI date={d} />)
    expect(html).toContain('1 avertismente în fișier')
    expect(html).toContain('Worker de citire')
  })
  it('nodurile neverificate au semnul ?', () => {
    const html = renderToStaticMarkup(<HartaAI date={exemplu()} />)
    expect(html).toMatch(/<text[^>]*>\?<\/text>/)
  })
  it('textScurt taie cu …', () => {
    expect(textScurt('abcdef', 4)).toBe('abc…')
    expect(textScurt('abc', 4)).toBe('abc')
    expect(textScurt(null, 4)).toBe('')
  })
})
