import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { citesteArhivaCompleta, proprietarComodatId, esteComodatNeatribuit } from './arhivaAlimentari.js'

function server(rows, cap = 1000, transform = x => x) {
  const ranges = []
  return {
    ranges,
    query: () => ({ range: async (from, to) => {
      ranges.push([from, to])
      return transform({ data: rows.slice(from, Math.min(to + 1, from + cap)), count: rows.length, error: null }, from)
    } }),
  }
}
const rows = n => Array.from({ length: n }, (_, i) => ({ id: n - i }))

describe('TKT-2026-0339: arhivă completă', () => {
  it('citește peste 2000 de alimentări, păstrând ordinea pentru tabel și export', async () => {
    const data = rows(2347), mock = server(data)
    assert.deepEqual(await citesteArhivaCompleta(mock.query), data)
    assert.equal(mock.ranges.length, 5)
  })
  it('continuă când serverul plafonează pagina sub dimensiunea cerută', async () => {
    const data = rows(1201), mock = server(data, 100)
    assert.deepEqual(await citesteArhivaCompleta(mock.query), data)
    assert.deepEqual(mock.ranges[1], [100, 599])
  })
  it('acceptă perioada fără alimentări și un multiplu exact de pagină', async () => {
    assert.deepEqual(await citesteArhivaCompleta(server([]).query), [])
    assert.deepEqual(await citesteArhivaCompleta(server(rows(1000)).query), rows(1000))
  })
  it('refuză un rezultat trunchiat, fără să publice rândurile parțiale', async () => {
    const mock = server(rows(1200), 500, (res, from) => from >= 1000 ? { ...res, data: [] } : res)
    await assert.rejects(citesteArhivaCompleta(mock.query), /incompletă: 1000 din 1200/)
  })
  it('propagă eroarea unei pagini ulterioare', async () => {
    const mock = server(rows(1200), 500, (res, from) => from ? { error: new Error('pagina 2') } : res)
    await assert.rejects(citesteArhivaCompleta(mock.query), /pagina 2/)
  })
  it('refuză pagini repetate și modificări ale totalului în timpul citirii', async () => {
    const mock = server(rows(1200), 500, res => ({ ...res, data: rows(500) }))
    await assert.rejects(citesteArhivaCompleta(mock.query), /duplicate/)
    const changed = server(rows(1200), 500, (res, from) => from ? { ...res, count: 1201 } : res)
    await assert.rejects(citesteArhivaCompleta(changed.query), /s-au schimbat/)
  })
  it('cere count exact pentru a putea confirma completitudinea', async () => {
    const mock = server(rows(10), 500, res => ({ ...res, count: null }))
    await assert.rejects(citesteArhivaCompleta(mock.query), /numărul total/)
  })
})

describe('TKT-2026-0340: proprietar comodat', () => {
  const comodat = (employee, start = '2026-01-01', sfarsit = null) =>
    ({ tip_proprietate: 'comodat', comodat_employee_id: employee, comodat_data_start: start, comodat_data_sfarsit: sfarsit })
  it('adună vehicule diferite ale aceleiași persoane, independent de operator', () => {
    const data = [
      { id: 1, active_id: 10, data_alimentare: '2026-09-02', created_by: 'operator-a', cantitate_litri: 20, pret_total: 140, logistica_active: comodat(7) },
      { id: 2, active_id: 11, data_alimentare: '2026-09-03', created_by: 'operator-b', cantitate_litri: 30, pret_total: 210, logistica_active: comodat(7, '2026-06-15') },
      { id: 3, active_id: 12, data_alimentare: '2026-09-03', logistica_active: comodat(8) },
      { id: 4, data_alimentare: '2026-09-03', logistica_active: null },
    ]
    const selected = data.filter(a => proprietarComodatId(a) === '7')
    assert.deepEqual(selected.map(a => a.id), [1, 2])
    assert.equal(selected.reduce((s, a) => s + Number(a.cantitate_litri || 0), 0), 50)
    assert.equal(selected.reduce((s, a) => s + Number(a.pret_total || 0), 0), 350)
  })
  it('nu confundă firma, operatorul sau o legătură absentă cu proprietarul', () => {
    assert.equal(proprietarComodatId({ created_by: '7', data_alimentare: '2026-09-02' }), null)
    assert.equal(proprietarComodatId({ data_alimentare: '2026-09-02', logistica_active: { ...comodat(7), tip_proprietate: 'firma' } }), null)
    assert.equal(proprietarComodatId({ data_alimentare: '2026-09-02', logistica_active: comodat(null) }), null)
  })
  it('vehicul trecut de la A la B pe 01.09: alimentările din iulie–august NU se creditează lui B', () => {
    const activB = comodat(9, '2026-09-01')
    const data = [
      { id: 1, data_alimentare: '2026-07-15', logistica_active: activB },
      { id: 2, data_alimentare: '2026-08-31', logistica_active: activB },
      { id: 3, data_alimentare: '2026-09-01', logistica_active: activB },
      { id: 4, data_alimentare: '2026-10-20', logistica_active: activB },
    ]
    assert.deepEqual(data.filter(a => proprietarComodatId(a) === '9').map(a => a.id), [3, 4])
    assert.deepEqual(data.filter(esteComodatNeatribuit).map(a => a.id), [1, 2])
  })
  it('după data de sfârșit a contractului alimentarea rămâne neatribuită (ziua de sfârșit inclusă)', () => {
    const activ = comodat(7, '2026-01-01', '2026-06-30')
    assert.equal(proprietarComodatId({ data_alimentare: '2026-06-30', logistica_active: activ }), '7')
    assert.equal(proprietarComodatId({ data_alimentare: '2026-07-01', logistica_active: activ }), null)
    assert.equal(esteComodatNeatribuit({ data_alimentare: '2026-07-01', logistica_active: activ }), true)
  })
  it('contract fără dată de start sau alimentare fără dată: neatribuit', () => {
    assert.equal(proprietarComodatId({ data_alimentare: '2026-09-02', logistica_active: comodat(7, null) }), null)
    assert.equal(esteComodatNeatribuit({ data_alimentare: '2026-09-02', logistica_active: comodat(7, null) }), true)
    assert.equal(proprietarComodatId({ data_alimentare: null, logistica_active: comodat(7) }), null)
  })
  it('acceptă și valori timestamp, comparând doar ziua', () => {
    const activ = comodat(7, '2026-09-01T00:00:00', '2026-09-30T00:00:00+03:00')
    assert.equal(proprietarComodatId({ data_alimentare: '2026-09-30T18:00:00', logistica_active: activ }), '7')
    assert.equal(proprietarComodatId({ data_alimentare: '2026-10-01', logistica_active: activ }), null)
  })
  it('vehiculele care nu sunt în comodat nu apar ca „neatribuite”', () => {
    assert.equal(esteComodatNeatribuit({ data_alimentare: '2026-09-02', logistica_active: { tip_proprietate: 'firma' } }), false)
    assert.equal(esteComodatNeatribuit({ data_alimentare: '2026-09-02', logistica_active: null }), false)
    assert.equal(esteComodatNeatribuit({ data_alimentare: '2026-09-02', logistica_active: comodat(7) }), false)
  })
})
