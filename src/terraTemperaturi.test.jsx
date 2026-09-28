import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
vi.mock('./lib/supabase.js', () => ({ supabase: {} }))
vi.mock('./Meteo.jsx', () => ({ MeteoSantier: () => null }))
import { TERRA_PRAGURI, TERRA_TACERE_MS, nivelTerra, terraFaraDate, TerraCard } from './Cladire.jsx'

const sql = readFileSync(new URL('../supabase/migrations/20260927b_iot_terra_temperaturi.sql', import.meta.url), 'utf8')
const acum = Date.parse('2026-09-27T12:00:00Z')
const card = (props = {}) => renderToStaticMarkup(createElement(TerraCard, { acum, ...props }))

describe('Terra: praguri UI și paritate SQL', () => {
  for (const [cheie, [warning, critic]] of Object.entries(TERRA_PRAGURI)) {
    it(`${cheie}: egalitate, warning, critic și null`, () => {
      expect(nivelTerra(cheie, warning)).toBe('ok')
      expect(nivelTerra(cheie, warning + 0.1)).toBe('warning')
      expect(nivelTerra(cheie, critic)).toBe('warning')
      expect(nivelTerra(cheie, critic + 0.1)).toBe('error')
      expect(nivelTerra(cheie, null)).toBe('lipsa')
      expect(nivelTerra(cheie, 0)).toBe('ok')
      const pragSql = sql.match(new RegExp(`\\('${cheie}', '[^']+', (\\d+), (\\d+)\\)`))
      expect(pragSql?.slice(1).map(Number)).toEqual([warning, critic])
    })
  }
  it('tăcere: exact 30 minute rămâne actual, peste 30 expiră, lipsa datei expiră', () => {
    expect(terraFaraDate(new Date(acum - TERRA_TACERE_MS).toISOString(), acum)).toBe(false)
    expect(terraFaraDate(new Date(acum - TERRA_TACERE_MS - 1).toISOString(), acum)).toBe(true)
    expect(terraFaraDate(null, acum)).toBe(true)
    expect(terraFaraDate('invalid', acum)).toBe(true)
    expect(Number(sql.match(/interval '(\d+) minutes'/)[1]) * 60e3).toBe(TERRA_TACERE_MS)
    expect(sql).toContain('valoare > prag.critical')
    expect(sql).toContain('valoare > prag.warning')
  })
})

describe('card Terra', () => {
  it('afișează fiecare disc, temperaturi zero și două grafice', () => {
    const html = card({ dispozitiv: { citit_la: '2026-09-27T11:50:00Z', ultima_citire: { ambient: 0, cpu: 91, nvme_max: 66, disc_max: 51, discuri: [{ dev: '/dev/sda', temp: 46 }, { dev: '/dev/sdb', temp: 51 }] } },
      istoric: [{ valori: { ambient: 0, disc_max: 46 } }, { valori: { ambient: 1, disc_max: 51 } }] })
    expect(html).toContain('acum 10 min')
    expect(html).toContain('/dev/sda')
    expect(html).toContain('/dev/sdb')
    expect(html).toContain('0 °C')
    expect(html).toContain('#3FB950')
    expect(html).toContain('#E3B341')
    expect(html).toContain('#F85149')
    expect(html.match(/<polyline/g)).toHaveLength(2)
  })
  it('datele vechi nu par sănătoase, iar lipsa senzorilor nu devine zero', () => {
    const html = card({ dispozitiv: { citit_la: '2026-09-27T11:00:00Z', ultima_citire: { cpu: 30 } } })
    expect(html).toContain('fără date')
    expect(html).not.toContain('#3FB950')
    expect(html).toContain('— °C')
    expect(card({ dispozitiv: { citit_la: '2026-09-27T11:55:00Z', ultima_citire: {} } })).toContain('Citire goală')
    expect(card()).toContain('fără date')
  })
  it('arată eroarea de citire, fără grafic inventat pentru null', () => {
    const html = card({ eroare: 'Istoricul Terra nu este disponibil.', istoric: [{ valori: { ambient: null } }, { valori: { ambient: null } }] })
    expect(html).toContain('Istoricul Terra nu este disponibil.')
    expect(html).not.toContain('<polyline')
  })
})
