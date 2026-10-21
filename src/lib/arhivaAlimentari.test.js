import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import {
  citesteArhivaCompleta, citesteOTrecere, filtruDupa, ARHIVA_INSTABILA,
  incarcaNumeAngajati, proprietariDisponibili, numeAngajat,
  proprietarComodatId, esteComodatNeatribuit,
} from './arhivaAlimentari.js'

// Server PostgREST simulat: ordonează (data desc, id desc), aplică filtrul keyset `or=(...)`
// EXACT în sintaxa trimisă de helper, plafonează la `cap` (max-rows) și răspunde la numărarea head.
// `inainte(nrCerere, stare)` rulează înaintea fiecărei cereri → simulează modificări concurente.
const KEYSET = /^data_alimentare\.lt\.(\d{4}-\d{2}-\d{2}),and\(data_alimentare\.eq\.(\d{4}-\d{2}-\d{2}),id\.lt\.(\d+)\)$/
const desc = (a, b) => (a.data_alimentare < b.data_alimentare ? 1 : a.data_alimentare > b.data_alimentare ? -1 : b.id - a.id)
function server(initial, { cap = 1000, inainte = () => {}, transform = x => x } = {}) {
  const stare = { rows: [...initial] }, cereri = []
  const query = optiuni => {
    const q = { optiuni, or: null, ordine: [], limita: null }
    q.or = f => { q.or = f; return q }
    q.order = (col, o) => { q.ordine.push(`${col}.${o.ascending ? 'asc' : 'desc'}`); return q }
    q.limit = n => { q.limita = n; return q }
    q.then = (ok, fail) => Promise.resolve().then(() => {
      const nr = cereri.length
      inainte(nr, stare)
      cereri.push({ optiuni, or: typeof q.or === 'string' ? q.or : null, ordine: q.ordine, limita: q.limita })
      if (optiuni.head) return transform({ data: null, count: stare.rows.length, error: null }, nr)
      let r = [...stare.rows].sort(desc)
      if (typeof q.or === 'string') {
        const m = KEYSET.exec(q.or)
        if (!m || m[1] !== m[2]) throw new Error('filtru keyset nerecunoscut: ' + q.or)
        r = r.filter(x => x.data_alimentare < m[1] || (x.data_alimentare === m[1] && x.id < Number(m[3])))
      }
      return transform({ data: r.slice(0, Math.min(q.limita, cap)), count: optiuni.count === 'exact' ? stare.rows.length : null, error: null }, nr)
    }).then(ok, fail)
    return q
  }
  return { query, cereri, stare }
}
// n alimentări cu câte 7 pe zi (egalități pe dată → testează a doua cheie, id)
const zi = k => new Date(Date.UTC(2026, 0, 1 + k)).toISOString().slice(0, 10)
const alimentari = n => Array.from({ length: n }, (_, i) => ({ id: i + 1, data_alimentare: zi(Math.floor(i / 7)) })).sort(desc)
const pagini = mock => mock.cereri.filter(c => !c.optiuni.head)

describe('TKT-2026-0339: arhivă completă (keyset + verificare)', () => {
  it('citește peste 2000 de alimentări o singură dată fiecare, în ordinea tabelului și exportului', async () => {
    const data = alimentari(2347), mock = server(data)
    assert.deepEqual(await citesteArhivaCompleta(mock.query), data)
    const p = pagini(mock)
    assert.equal(p.length, 5)
    assert.deepEqual(p[0].optiuni, { count: 'exact' })           // count exact doar pe prima pagină
    assert.ok(p.slice(1).every(c => c.optiuni.count === undefined))
    assert.ok(p.every(c => c.limita === 500 && c.ordine.join() === 'data_alimentare.desc,id.desc'))
    assert.deepEqual(mock.cereri.at(-1).optiuni, { count: 'exact', head: true }) // numărare finală
  })
  it('continuarea keyset pe aceeași zi folosește și id-ul (egalitate pe dată)', async () => {
    const data = [5, 4, 3, 2, 1].map(id => ({ id, data_alimentare: '2026-09-03' })).concat([{ id: 9, data_alimentare: '2026-09-02' }])
    const mock = server(data)
    assert.deepEqual(await citesteArhivaCompleta(mock.query, { pagina: 2 }), data)
    assert.deepEqual(pagini(mock).map(c => c.or), [
      null,
      'data_alimentare.lt.2026-09-03,and(data_alimentare.eq.2026-09-03,id.lt.4)',
      'data_alimentare.lt.2026-09-03,and(data_alimentare.eq.2026-09-03,id.lt.2)',
      'data_alimentare.lt.2026-09-02,and(data_alimentare.eq.2026-09-02,id.lt.9)', // pagina goală = sfârșit
    ])
    assert.equal(filtruDupa({ data: '2026-09-03', id: 1 }), 'data_alimentare.lt.2026-09-03,and(data_alimentare.eq.2026-09-03,id.lt.1)')
  })
  it('continuă când serverul plafonează pagina sub dimensiunea cerută (max-rows)', async () => {
    const data = alimentari(1201), mock = server(data, { cap: 100 })
    assert.deepEqual(await citesteArhivaCompleta(mock.query), data)
    assert.equal(pagini(mock).length, 13) // 12 pagini pline de 100 + 1 scurtă care atinge totalul
  })
  it('acceptă perioada fără alimentări și un multiplu exact de pagină', async () => {
    assert.deepEqual(await citesteArhivaCompleta(server([]).query), [])
    const mock = server(alimentari(1000))
    assert.deepEqual(await citesteArhivaCompleta(mock.query), alimentari(1000))
    assert.equal(pagini(mock).length, 3) // 500 + 500 + pagina goală care confirmă sfârșitul
  })

  // Scenariul Copilot (review r1 #827): A,B,C,D; după prima pagină se șterge A (deja citit)
  // și se inserează X între C și D (zonă necitită). Offset-ul sărea C și păstra A cu totalul neschimbat.
  const ABCD = [
    { id: 4, data_alimentare: '2026-09-04', n: 'A' }, { id: 3, data_alimentare: '2026-09-03', n: 'B' },
    { id: 2, data_alimentare: '2026-09-02', n: 'C' }, { id: 1, data_alimentare: '2026-09-01', n: 'D' },
  ]
  const X = { id: 5, data_alimentare: '2026-09-01', n: 'X' } // aceeași zi cu D, id mai mare → între C și D
  const stergeAInsereazaX = (o = { gata: false }) => (nr, stare) => {
    if (nr === 1 && !o.gata) { o.gata = true; stare.rows = stare.rows.filter(r => r.n !== 'A').concat(X) }
  }
  it('Copilot: o trecere keyset NU sare peste C; A apare doar pentru că exista când a fost citit — și e semnalat', async () => {
    const r = await citesteOTrecere(server(ABCD, { inainte: stergeAInsereazaX() }).query, 2)
    assert.deepEqual(r.rows.map(x => x.n), ['A', 'B', 'C', 'X', 'D'])
    assert.match(r.anomalie, /noi în timpul citirii \(5 față de 4\)/)
  })
  it('Copilot: citirea completă reîncearcă și întoarce starea curentă, fără A și fără să sară C', async () => {
    const mock = server(ABCD, { inainte: stergeAInsereazaX() })
    const rows = await citesteArhivaCompleta(mock.query, { pagina: 2 })
    assert.deepEqual(rows.map(x => x.n), ['B', 'C', 'X', 'D'])
    assert.equal(mock.cereri.filter(c => c.optiuni.count === 'exact' && !c.optiuni.head).length, 2) // 2 treceri
  })
  it('ștergere în zona necitită: numărul final diferă → reîncercare', async () => {
    let gata = false
    const mock = server(ABCD, { inainte: (nr, s) => { if (nr === 1 && !gata) { gata = true; s.rows = s.rows.filter(r => r.n !== 'D') } } })
    assert.deepEqual((await citesteArhivaCompleta(mock.query, { pagina: 2 })).map(x => x.n), ['A', 'B', 'C'])
    assert.equal(mock.cereri.filter(c => c.optiuni.head).length, 2)
  })
  it('inserare după ultima pagină, înainte de numărarea finală → reîncercare', async () => {
    let gata = false
    const mock = server(ABCD, {
      inainte: (nr, s) => { if (nr === 3 && !gata) { gata = true; s.rows = s.rows.concat({ id: 6, data_alimentare: '2026-09-05', n: 'Y' }) } },
    })
    assert.deepEqual((await citesteArhivaCompleta(mock.query, { pagina: 2 })).map(x => x.n), ['Y', 'A', 'B', 'C', 'D'])
  })
  it('alimentare mutată pe altă dată în timpul citirii (ID repetat) → reîncercare', async () => {
    let gata = false
    const mock = server(ABCD, {
      inainte: (nr, s) => { if (nr === 1 && !gata) { gata = true; s.rows = s.rows.map(r => r.n === 'A' ? { ...r, data_alimentare: '2026-08-31' } : r) } },
    })
    const r = await citesteOTrecere(server(ABCD, {
      inainte: (nr, s) => { if (nr === 1) s.rows = s.rows.map(x => x.n === 'A' ? { ...x, data_alimentare: '2026-08-31' } : x) },
    }).query, 2)
    assert.match(r.anomalie, /#4 a apărut de două ori/)
    assert.deepEqual((await citesteArhivaCompleta(mock.query, { pagina: 2 })).map(x => x.n), ['B', 'C', 'D', 'A'])
  })
  it('date instabile la fiecare încercare → eroare arhiva_instabila după 3 treceri', async () => {
    let next = 100
    const mock = server(ABCD, {
      inainte: (nr, s) => { if (nr > 0) s.rows = s.rows.concat({ id: next++, data_alimentare: '2026-08-01' }) },
    })
    await assert.rejects(citesteArhivaCompleta(mock.query, { pagina: 2 }), e => {
      assert.equal(e.code, ARHIVA_INSTABILA)
      assert.match(e.message, /la 3 încercări consecutive/)
      return true
    })
    assert.equal(mock.cereri.filter(c => c.optiuni.count === 'exact' && !c.optiuni.head).length, 3)
  })
  it('proprietate keyset sub modificări aleatoare: niciun rând existent pe toată durata nu e sărit sau dublat', async () => {
    for (let seed = 1; seed <= 40; seed++) {
      let s = seed, nextId = 10000
      const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648
      const start = alimentari(60), sterse = new Set()
      const mock = server(start, {
        inainte: (nr, st) => {
          if (rnd() < 0.5 && st.rows.length) { const v = st.rows[Math.floor(rnd() * st.rows.length)]; sterse.add(v.id); st.rows = st.rows.filter(x => x !== v) }
          if (rnd() < 0.5) st.rows = st.rows.concat({ id: nextId++, data_alimentare: zi(Math.floor(rnd() * 9)) })
        },
      })
      const { rows, anomalie } = await citesteOTrecere(mock.query, 7)
      const ids = rows.map(r => r.id), ultim = rows.at(-1)
      // trecere completă (fără oprire timpurie) → toate; altfel, cele până la ultima cheie citită
      const completa = !anomalie || /numărul s-a modificat/.test(anomalie)
      assert.equal(new Set(ids).size, ids.length, `seed ${seed}: dublură`)
      for (const r of start) {
        if (sterse.has(r.id) || (!completa && desc(r, ultim) > 0)) continue
        assert.ok(ids.includes(r.id), `seed ${seed}: sărit #${r.id}`)
      }
      for (let i = 1; i < rows.length; i++) assert.equal(desc(rows[i - 1], rows[i]) < 0, true, `seed ${seed}: ordine`)
    }
  })

  it('propagă eroarea unei pagini ulterioare, fără reîncercare', async () => {
    const mock = server(alimentari(1200), { transform: (res, nr) => nr === 1 ? { error: new Error('pagina 2') } : res })
    await assert.rejects(citesteArhivaCompleta(mock.query), /pagina 2/)
    assert.equal(mock.cereri.length, 2)
  })
  it('cere count exact pe prima pagină și la numărarea finală', async () => {
    await assert.rejects(citesteArhivaCompleta(server(alimentari(10), { transform: res => ({ ...res, count: null }) }).query), /numărul total/)
    const faraFinal = server(alimentari(10), { transform: (res, nr) => nr === 1 ? { ...res, count: undefined } : res })
    await assert.rejects(citesteArhivaCompleta(faraFinal.query), /numărul total/)
  })
  it('refuză rânduri fără cheie validă sau în altă ordine decât cea cerută', async () => {
    const faraId = server([{ id: null, data_alimentare: '2026-09-01' }])
    await assert.rejects(citesteArhivaCompleta(faraId.query), /fără dată sau ID valid/)
    const dataRea = server([{ id: 1, data_alimentare: '2026-09-01),or(id.gt.0' }])
    await assert.rejects(citesteArhivaCompleta(dataRea.query), /fără dată sau ID valid/)
    const neordonat = server(alimentari(10), { transform: res => res.data ? { ...res, data: [...res.data].reverse() } : res })
    await assert.rejects(citesteArhivaCompleta(neordonat.query), /altă ordine/)
  })
})

describe('TKT-2026-0339: numele angajaților sunt auxiliare', () => {
  const arhiva = [
    { id: 1, data_alimentare: '2026-09-02', logistica_active: { tip_proprietate: 'comodat', comodat_employee_id: 7, comodat_data_start: '2026-01-01' } },
    { id: 2, data_alimentare: '2026-09-03', logistica_active: { tip_proprietate: 'comodat', comodat_employee_id: 8, comodat_data_start: '2026-01-01' } },
  ]
  it('eroarea la angajați nu aruncă: avertisment + fallback „Angajat #id”, arhiva rămâne întreagă', async () => {
    const r = await incarcaNumeAngajati(async () => ({ data: null, error: new Error('permission denied for table employees') }))
    assert.equal(r.nume.size, 0)
    assert.match(r.avertisment, /nu s-au putut încărca \(permission denied/)
    assert.deepEqual(proprietariDisponibili(arhiva, r.nume), [{ id: '7', name: 'Angajat #7' }, { id: '8', name: 'Angajat #8' }])
    assert.equal(arhiva.filter(a => proprietarComodatId(a) === '7').length, 1)
    const aruncat = await incarcaNumeAngajati(() => { throw new Error('rețea') })
    assert.match(aruncat.avertisment, /rețea/)
  })
  it('folosește numele încărcate și semnalează o listă parțială', async () => {
    const r = await incarcaNumeAngajati(async () => ({ data: [{ id: 8, name: 'ANDREI ION' }], count: 2, error: null }))
    assert.match(r.avertisment, /doar 1 din 2/)
    assert.deepEqual(proprietariDisponibili(arhiva, r.nume), [{ id: '8', name: 'ANDREI ION' }, { id: '7', name: 'Angajat #7' }])
    assert.equal(numeAngajat(r.nume, 8), 'ANDREI ION')
    const complet = await incarcaNumeAngajati(async () => ({ data: [{ id: 7, name: 'B' }, { id: 8, name: 'A' }], count: 2, error: null }))
    assert.equal(complet.avertisment, '')
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
