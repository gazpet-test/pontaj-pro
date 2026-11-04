import { describe, it, expect } from 'vitest'
import { afiseazaCadastru, titluCadastru, FARA_CADASTRU } from './cadastru.js'

describe('afiseazaCadastru (audit D2)', () => {
  it('separă după „#” și elimină bucățile goale', () => {
    expect(afiseazaCadastru('52#')).toBe('52')
    expect(afiseazaCadastru('#44#')).toBe('44')
    expect(afiseazaCadastru('123##')).toBe('123')
    expect(afiseazaCadastru('50029#30#')).toBe('50029 / 30')
    expect(afiseazaCadastru('50029#30#A1')).toBe('50029 / 30 / A1')
    expect(afiseazaCadastru(' 7 # 8 #')).toBe('7 / 8')
  })
  it('doar „#” / spații / gol / null → „—”', () => {
    for (const v of ['##', '#', '###', ' # # ', '', '   ', null, undefined]) expect(afiseazaCadastru(v)).toBe(FARA_CADASTRU)
    expect(FARA_CADASTRU).toBe('—')
  })
  it('valori fără „#” rămân neschimbate', () => {
    expect(afiseazaCadastru('123/4')).toBe('123/4')
    expect(afiseazaCadastru('DE')).toBe('DE')
    expect(afiseazaCadastru('-')).toBe('-')
    expect(afiseazaCadastru(52)).toBe('52')
  })
  it('tooltip = valoarea brută doar când diferă de afișare', () => {
    expect(titluCadastru('52#')).toBe('Valoare TGZ: 52#')
    expect(titluCadastru('##')).toBe('Valoare TGZ: ##')
    expect(titluCadastru('123/4')).toBeUndefined()
    expect(titluCadastru(null)).toBeUndefined()
    expect(titluCadastru('')).toBeUndefined()
  })
})
