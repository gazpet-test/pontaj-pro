// Ordinul de deplasare din plată (openOrdGen) — varianta 3A, Răzvan 01.10.2026
import { describe, it, expect } from 'vitest'
import { alocaDiurneTransa } from './diurneAlocare.js'
import { zileOrdinDeplasare } from './diurneOrdin.js'

// Septembrie 2026: 22 zile lucrătoare (fără sărbători legale). Angajatul 1:
// CO 21–25.09 (5 zile lucr.) → C = 17; tranșa 1 (01–15) diurnă pe toate 15 zilele (și weekend);
// tranșa 2 (16–30): diurnă 16,17,18,28,29,30 (lucr.) + 19,20 (weekend) = 8.
const zile = (a, b) => { const o = []; for (let i = a; i <= b; i++) o.push(`2026-09-${String(i).padStart(2, '0')}`); return o }
const recs = [
  ...zile(1, 15).map(d => ({ employee_id: 1, date: d, diurna: true, norma: null })),
  ...['16', '17', '18', '19', '20', '28', '29', '30'].map(x => ({ employee_id: 1, date: `2026-09-${x}`, diurna: true, norma: null })),
  ...zile(21, 25).map(d => ({ employee_id: 1, date: d, diurna: false, norma: 'CO' })),
]
const aloca = (df, dt) => alocaDiurneTransa({ recsLuna: recs, df, dt, legalSet: new Set(), diurnaAmt: 50 }).get(1)

describe('zileOrdinDeplasare', () => {
  it('tranșa 2 cu CO + weekend: ordinul are 2 zile (formula veche dădea 6)', () => {
    const a = aloca('2026-09-16', '2026-09-30')
    expect(a.C).toBe(17); expect(a.B).toBe(15); expect(a.N).toBe(8); expect(a.zileDiurna).toBe(2)
    expect(zileOrdinDeplasare(a, 6)).toBe(2) // 6 zile NET lucrătoare în tranșa 2
  })
  it('tranșa 1: plafonat la zilele NET (weekendul consumă plafonul, dar nu intră pe ordin)', () => {
    const a = aloca('2026-09-01', '2026-09-15')
    expect(a.zileDiurna).toBe(15)
    expect(zileOrdinDeplasare(a, 11)).toBe(11)
  })
  it('angajat fără alocare / valori lipsă → 0', () => {
    expect(zileOrdinDeplasare(undefined, 5)).toBe(0)
    expect(zileOrdinDeplasare({ zileDiurna: 3 }, 0)).toBe(0)
  })
})
