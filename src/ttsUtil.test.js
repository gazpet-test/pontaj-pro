import { describe, it, expect } from 'vitest'
import { poateVoce, textPentruVoce, nrCaractere, numeFisierMp3, MAX_CARACTERE, PLAFON_LUNAR } from './ttsUtil.js'

describe('poateVoce', () => {
  it('owner da; modul mesaj_vocal da; altfel nu', () => {
    expect(poateVoce({ is_owner: true })).toBe(true)
    expect(poateVoce({ module_access: ['mesaj_vocal'] })).toBe(true)
    expect(poateVoce({ module_access: ['mesaj_vocal.x'] })).toBe(true)
    expect(poateVoce({ module_access: ['hr', 'mesaj_vocalx'] })).toBe(false)
    expect(poateVoce(null)).toBe(false)
  })
})

describe('textPentruVoce', () => {
  it('scoate markdown, linkuri și emoji, păstrează cuvintele', () => {
    const t = '## Titlu\n**Atenție:** vezi [ghidul](https://x.ro/a) 🚧\n- punct unu\n- punct doi\n1. primul\n`cod` și https://exemplu.ro/b'
    expect(textPentruVoce(t)).toBe('Titlu\nAtenție: vezi ghidul\npunct unu\npunct doi\nprimul\ncod și')
  })
  it('păstrează diacriticele și punctuația', () => {
    expect(textPentruVoce('Bună ziua, ăîșțâ! Ce faci?')).toBe('Bună ziua, ăîșțâ! Ce faci?')
  })
  it('gol / null', () => {
    expect(textPentruVoce(null)).toBe('')
    expect(textPentruVoce('   ')).toBe('')
  })
})

describe('diverse', () => {
  it('caractere = code points', () => { expect(nrCaractere('ăîș')).toBe(3) })
  it('nume fișier', () => { expect(numeFisierMp3(new Date(2026, 9, 7, 15, 3))).toBe('mesaj_vocal_2026-10-07_1503.mp3') })
  it('constante aliniate cu serverul', () => { expect(MAX_CARACTERE).toBe(5000); expect(PLAFON_LUNAR).toBe(950000) })
})
