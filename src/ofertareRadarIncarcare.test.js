import { describe, it, expect } from 'vitest'
import { incarcaRadarComplet, ordoneazaRadar, creeazaGeneratie, incarcaInGeneratie, stareAfisareRadar, mesajEroareRadar, MESAJ_ANULAT } from './ofertareRadarIncarcare.js'

// Date inventate. Clientul fals imită PostgREST: .from().select().eq().order('id').limit(n)[.gt('id', x)], apoi await → { data, error }.
// plafon = max-rows al serverului (taie orice limit mai mare); esuezaLaCererea = numărul cererii (1, 2, …) care întoarce eroare.
function clientFals(rows, { plafon = 1000, esuezaLaCererea = null } = {}) {
  const cereri = []
  const client = {
    cereri,
    from(tabel) {
      const s = { tabel, filtre: [], dupa: null, limit: null, ordine: null }
      const q = {
        select() { return q },
        eq(c, v) { s.filtre.push([c, v]); return q },
        order(c) { s.ordine = c; return q },
        limit(n) { s.limit = n; return q },
        gt(c, v) { s.dupa = v; return q },
        then(rez, rej) {
          cereri.push({ ...s })
          let r
          if (esuezaLaCererea === cereri.length) r = { data: null, error: { message: 'timeout la server' } }
          else {
            const potrivite = rows.filter(x => s.filtre.every(([c, v]) => x[c] === v)).filter(x => s.dupa == null || x.id > s.dupa)
              .sort((a, b) => a.id - b.id)
            r = { data: potrivite.slice(0, Math.min(s.limit ?? Infinity, plafon)), error: null }
          }
          return Promise.resolve(r).then(rez, rej)
        },
      }
      return q
    },
  }
  return client
}

const rand = id => ({ id, relevant: true, scor_potrivire: 50, termen_depunere: '2026-12-01T10:00:00+02:00', titlu: `Anunț test ${id}` })
const nRanduri = n => Array.from({ length: n }, (_, i) => rand(i + 1))

describe('incarcaRadarComplet', () => {
  it('1001 rânduri cu plafon 1000: le aduce pe toate (3 cereri, ultima goală)', async () => {
    const c = clientFals(nRanduri(1001), { plafon: 1000 })
    const rows = await incarcaRadarComplet(c)
    expect(rows.length).toBe(1001)
    expect(new Set(rows.map(r => r.id)).size).toBe(1001)
    expect(c.cereri.length).toBe(3)
    expect(c.cereri.map(q => q.dupa)).toEqual([null, 1000, 1001])
    expect(c.cereri[0]).toMatchObject({ tabel: 'ofertare_radar', ordine: 'id', limit: 1000, filtre: [['relevant', true]] })
  })

  it('plafon mic (7) sub pas (1000): nu se oprește la prima pagină scurtă, continuă până la pagina goală', async () => {
    const c = clientFals(nRanduri(20), { plafon: 7 })
    const rows = await incarcaRadarComplet(c)
    expect(rows.length).toBe(20)
    expect(c.cereri.map(q => q.dupa)).toEqual([null, 7, 14, 20])
  })

  it('doar rândurile relevante', async () => {
    const c = clientFals([rand(1), { ...rand(2), relevant: false }, rand(3)])
    expect((await incarcaRadarComplet(c)).map(r => r.id)).toEqual([1, 3])
  })

  it('pagină eșuată la mijloc: respinge cu eroarea, fără rezultat parțial, fără alte cereri', async () => {
    const c = clientFals(nRanduri(25), { plafon: 10, esuezaLaCererea: 2 })
    await expect(incarcaRadarComplet(c)).rejects.toMatchObject({ message: 'timeout la server' })
    expect(c.cereri.length).toBe(2)
  })

  it('zero rânduri: listă goală (nu eroare)', async () => {
    const c = clientFals([])
    await expect(incarcaRadarComplet(c)).resolves.toEqual([])
    expect(c.cereri.length).toBe(1)
  })

  it('anulată între pagini: se oprește înaintea paginii următoare', async () => {
    const c = clientFals(nRanduri(30), { plafon: 10 })
    let n = 0
    const viu = () => { if (++n > 2) throw new Error(MESAJ_ANULAT) }
    await expect(incarcaRadarComplet(c, { viu })).rejects.toThrow(MESAJ_ANULAT)
    expect(c.cereri.length).toBe(2)
  })
})

describe('ordoneazaRadar', () => {
  it('scor desc (fără scor la final), apoi termen asc (fără termen la final), apoi id', () => {
    const rows = [
      { id: 1, scor_potrivire: null, termen_depunere: '2026-12-01' },
      { id: 2, scor_potrivire: 40, termen_depunere: '2026-12-05T10:00:00+02:00' },
      { id: 3, scor_potrivire: 85, termen_depunere: null },
      { id: 4, scor_potrivire: 85, termen_depunere: '2026-11-20T10:00:00+02:00' },
      { id: 5, scor_potrivire: 40, termen_depunere: '2026-12-02' },
      { id: 6, scor_potrivire: 40, termen_depunere: '2026-12-02' },
      { id: 7, scor_potrivire: 85, termen_depunere: 'ilizibil' },
    ]
    expect(ordoneazaRadar(rows).map(r => r.id)).toEqual([4, 3, 7, 5, 6, 2, 1])
    expect(rows.map(r => r.id)).toEqual([1, 2, 3, 4, 5, 6, 7]) // intrarea neschimbată
  })
})

// Promisiune rezolvată din afară, ca să controlăm ordinea în care sosesc răspunsurile
const amanat = () => { let rez, rej; const p = new Promise((a, b) => { rez = a; rej = b }); return { p, rez, rej } }

describe('incarcaInGeneratie', () => {
  it('răspuns vechi sosit după unul nou: se aplică doar cel nou', async () => {
    const gen = creeazaGeneratie()
    const aplicat = [], finaluri = []
    const a = amanat(), b = amanat()
    const p1 = incarcaInGeneratie(gen, () => a.p, { laSucces: r => aplicat.push(r), laFinal: () => finaluri.push(1) })
    const p2 = incarcaInGeneratie(gen, () => b.p, { laSucces: r => aplicat.push(r), laFinal: () => finaluri.push(2) })
    b.rez(['nou'])
    await p2
    a.rez(['vechi'])
    await p1
    expect(aplicat).toEqual([['nou']])
    expect(finaluri).toEqual([2])
  })

  it('eroarea unei încărcări vechi nu acoperă lista nouă', async () => {
    const gen = creeazaGeneratie()
    const erori = [], aplicat = []
    const a = amanat(), b = amanat()
    const p1 = incarcaInGeneratie(gen, () => a.p, { laSucces: r => aplicat.push(r), laEroare: e => erori.push(e.message) })
    const p2 = incarcaInGeneratie(gen, () => b.p, { laSucces: r => aplicat.push(r), laEroare: e => erori.push(e.message) })
    b.rez(['nou']); await p2
    a.rej(new Error('vechi picat')); await p1
    expect(aplicat).toEqual([['nou']])
    expect(erori).toEqual([])
  })

  it('anulată la închiderea ecranului: nimic aplicat, bucla de pagini oprită', async () => {
    const gen = creeazaGeneratie()
    const c = clientFals(nRanduri(30), { plafon: 10 })
    const aplicat = [], erori = []
    const p = incarcaInGeneratie(gen, viu => incarcaRadarComplet(c, { viu }), { laSucces: r => aplicat.push(r), laEroare: e => erori.push(e) })
    gen.anuleaza()
    await p
    expect(aplicat).toEqual([])
    expect(erori).toEqual([])
    expect(c.cereri.length).toBeLessThanOrEqual(1)
  })

  it('eroare curentă: ajunge la laEroare, nu la laSucces', async () => {
    const gen = creeazaGeneratie()
    const c = clientFals(nRanduri(25), { plafon: 10, esuezaLaCererea: 2 })
    const aplicat = [], erori = []
    await incarcaInGeneratie(gen, viu => incarcaRadarComplet(c, { viu }), { laSucces: r => aplicat.push(r), laEroare: e => erori.push(e.message) })
    expect(aplicat).toEqual([])
    expect(erori).toEqual(['timeout la server'])
  })
})

describe('stareAfisareRadar — eroare vs listă goală', () => {
  it('eroarea are prioritate, chiar cu zero rânduri afișate', () => {
    expect(stareAfisareRadar({ loading: false, eroare: 'x', nrAfisate: 0 })).toBe('eroare')
    expect(stareAfisareRadar({ loading: true, eroare: 'x', nrAfisate: 0 })).toBe('eroare')
  })
  it('zero rezultate fără eroare = gol; în timpul încărcării = încărcare', () => {
    expect(stareAfisareRadar({ loading: false, eroare: null, nrAfisate: 0 })).toBe('gol')
    expect(stareAfisareRadar({ loading: true, eroare: null, nrAfisate: 0 })).toBe('incarcare')
  })
  it('cu rânduri = listă', () => {
    expect(stareAfisareRadar({ loading: false, eroare: null, nrAfisate: 3 })).toBe('lista')
    expect(stareAfisareRadar({ loading: true, eroare: null, nrAfisate: 3 })).toBe('lista')
  })
  it('mesajul de eroare e text simplu', () => {
    expect(mesajEroareRadar({ message: 'timeout la server' })).toBe('Radarul nu s-a putut încărca: timeout la server')
    expect(mesajEroareRadar(null)).toBe('Radarul nu s-a putut încărca.')
  })
})
