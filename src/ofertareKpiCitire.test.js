import { describe, it, expect } from 'vitest'
import { cerinteKpi, acopeririKpi, bucati, BUCATA_ID } from './ofertareKpiCitire.js'

// Server PostgREST simulat, cu plafon de server 1000 (ca în producție, max-rows): filtrează in/is/gt, ordonează după id,
// apoi taie la min(limit, 1000). Cazul real din audit: 2.400 de cerințe → vechea cerere vedea doar 1000.
function server(tabele, plafon = 1000) {
  const cereri = []
  const from = (t) => {
    const f = { t, in: null, gt: null, is: [], lim: Infinity, select: null }
    const b = {
      select(s) { f.select = s; return b },
      in(col, vals) { f.in = [col, vals.map(Number)]; return b },
      is(col, v) { f.is.push([col, v]); return b },
      gt(col, v) { f.gt = [col, v]; return b },
      order() { return b },
      limit(n) { f.lim = n; return b },
      then(res, rej) {
        cereri.push({ t, n: f.in?.[1].length })
        let r = (tabele[t] || []).filter(x => (!f.in || f.in[1].includes(Number(x[f.in[0]])))
          && f.is.every(([c, v]) => (x[c] ?? null) === v) && (!f.gt || x[f.gt[0]] > f.gt[1]))
        r = r.sort((a, b2) => a.id - b2.id).slice(0, Math.min(f.lim, plafon))
        return Promise.resolve({ data: r, error: null }).then(res, rej)
      },
    }
    return b
  }
  return { from, cereri }
}

const genCerinte = (nLic, perLic) => {
  const out = []; let id = 1
  for (let l = 1; l <= nLic; l++) for (let k = 0; k < perLic; k++) out.push({ id: id++, licitatie_id: l, tip: 'eliminatorie', cand_se_prezinta: 'depunere', inlocuita_de: null, duplicat_al: null })
  return out
}

describe('cerinteKpi — peste plafonul de 1000 al serverului', () => {
  it('2.400 cerințe pe 6 licitații → toate 2.400 (vechea cerere vedea 1000)', async () => {
    const sb = server({ ofertare_cerinte: genCerinte(6, 400) })
    const r = await cerinteKpi(sb, [1, 2, 3, 4, 5, 6])
    expect(r.length).toBe(2400)
    expect(new Set(r.map(x => x.licitatie_id)).size).toBe(6)
  })
  it('exclude înlocuitele și duplicatele', async () => {
    const c = genCerinte(1, 5); c[1].inlocuita_de = 99; c[2].duplicat_al = 1
    const r = await cerinteKpi(server({ ofertare_cerinte: c }), [1])
    expect(r.map(x => x.id)).toEqual([1, 4, 5])
  })
  it('eroarea serverului se propagă (nu devine 0 cerințe)', async () => {
    const sb = { from: () => { const b = { select: () => b, in: () => b, is: () => b, order: () => b, limit: () => b, gt: () => b,
      then: (res, rej) => Promise.resolve({ data: null, error: new Error('statement timeout') }).then(res, rej) }; return b } }
    await expect(cerinteKpi(sb, [1])).rejects.toThrow('statement timeout')
  })
})

describe('acopeririKpi — bucăți de id-uri + paginare', () => {
  it('3.000 de cerințe, 2 rânduri de acoperire fiecare → 6.000, în ordinea id-ului; nicio cerere cu peste BUCATA_ID id-uri', async () => {
    const ac = []; let id = 1
    for (let c = 1; c <= 3000; c++) { ac.push({ id: id++, cerinta_id: c, status: 'acoperit' }, { id: id++, cerinta_id: c, status: 'gol' }) }
    const sb = server({ ofertare_acoperire: ac })
    const r = await acopeririKpi(sb, Array.from({ length: 3000 }, (_, i) => i + 1), 'id, cerinta_id, status')
    expect(r.length).toBe(6000)
    expect(r.every((x, i) => i === 0 || r[i - 1].id < x.id)).toBe(true)
    expect(Math.max(...sb.cereri.map(c => c.n))).toBeLessThanOrEqual(BUCATA_ID)
  })
  it('listă goală → nicio cerere', async () => {
    const sb = server({})
    expect(await acopeririKpi(sb, [], 'id')).toEqual([])
    expect(sb.cereri.length).toBe(0)
  })
  it('bucati', () => {
    expect(bucati([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(bucati(null)).toEqual([])
  })
})
