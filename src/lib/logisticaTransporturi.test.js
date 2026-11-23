import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import {
  STATUS_DESCHIS, FILTRU_BLOCATE, adunaZile, esteTransportBlocat, intervalPerioada,
  esteDeschisDinainte, inPerioadaSauDeschis, reunesteTransporturi, filtreazaTransporturi,
  filtreTransporturi, incarcaTransporturi, citesteCompletDupaId, TRANSPORTURI_INSTABILE,
} from './logisticaTransporturi.js'

// TKT-2026-0356: bannerul „Transporturi blocate” (Active) număra 2 transporturi aprobate, vechi de
// 16 și 6 zile, iar lista din Transporturi nu le arăta. Așteptările de mai jos sunt scrise de mână
// din regula bannerului (L25), nu derivate din codul testat.
const AZI = '2026-10-23'
const T = (id, status, data_transport) => ({ id, status, data_transport })
const cazul = [
  T(1, 'aprobat', '2026-10-07'),     // 16 zile, blocat
  T(2, 'programat', '2026-10-17'),   // 6 zile, statusul vechi afișat tot ca „aprobat” → blocat
  T(3, 'in_tranzit', '2026-10-21'),  // tranzit de 2 zile → blocat
  T(4, 'in_tranzit', '2026-10-22'),  // tranzit de ieri → încă nu
  T(5, 'aprobat', '2026-10-23'),     // azi → nu
  T(6, 'aprobat', '2026-10-30'),     // viitor → nu
  T(7, 'livrat', '2026-10-01'),      // închis → nu
  T(8, 'anulat', '2026-09-01'),      // anulat → nu
  T(9, 'aprobat', null),             // fără dată → nu se poate spune
  T(10, 'cerut', '2026-10-01'),      // încă neaprobat → nu e „blocat”
  T(11, 'aprobat', '2026-08-20'),    // aprobat din august, n-a plecat → blocat
]

describe('esteTransportBlocat — aceeași regulă ca bannerul', () => {
  it('alege exact transporturile blocate din caz', () => {
    assert.deepEqual(cazul.filter(t => esteTransportBlocat(t, AZI)).map(t => t.id), [1, 2, 3, 11])
  })
  it('date invalide / lipsă = nu e blocat (nu ghicește)', () => {
    assert.equal(esteTransportBlocat(T(1, 'aprobat', '07.10.2026'), AZI), false)
    assert.equal(esteTransportBlocat(T(1, 'aprobat', '2026-10-07'), null), false)
    assert.equal(esteTransportBlocat(null, AZI), false)
  })
  it('acceptă timestamp, comparând doar ziua', () => {
    assert.equal(esteTransportBlocat(T(1, 'aprobat', '2026-10-22T23:30:00+03:00'), AZI), true)
  })
  it('tranzit: pragul e ieri, inclusiv peste schimbarea lunii', () => {
    assert.equal(esteTransportBlocat(T(1, 'in_tranzit', '2026-10-30'), '2026-11-01'), true)
    assert.equal(esteTransportBlocat(T(1, 'in_tranzit', '2026-10-31'), '2026-11-01'), false)
  })
})

describe('intervalPerioada + adunaZile', () => {
  it('perioadele listei', () => {
    assert.deepEqual(intervalPerioada('luna', AZI), { start: '2026-10-01', end: null })
    assert.deepEqual(intervalPerioada('sapt', AZI), { start: '2026-10-16', end: null })
    assert.deepEqual(intervalPerioada('azi', AZI), { start: AZI, end: AZI })
    assert.deepEqual(intervalPerioada('tot', AZI), { start: null, end: null })
  })
  it('7 zile peste început de lună / an', () => {
    assert.deepEqual(intervalPerioada('sapt', '2026-03-03'), { start: '2026-02-24', end: null })
    assert.equal(adunaZile('2027-01-01', -1), '2026-12-31')
    assert.equal(adunaZile('nu-e-data', 1), null)
  })
})

describe('un transport deschis nu poate fi ascuns de perioadă', () => {
  it('pe 2 noiembrie, „Luna” păstrează transporturile din octombrie încă neplecate / nelivrate', () => {
    const p = intervalPerioada('luna', '2026-11-02')
    const vazute = cazul.filter(t => inPerioadaSauDeschis(t, p)).map(t => t.id)
    // 1, 2, 5, 6, 11 aprobate/programate; 3, 4 în tranzit; 9 aprobat FĂRĂ dată (r2: vizibil);
    // 7 livrat, 8 anulat, 10 cerut = ascunse
    assert.deepEqual(vazute, [1, 2, 3, 4, 5, 6, 9, 11])
  })
  it('„Azi” arată transporturile de azi + cele deschise rămase din urmă / fără dată, nu și pe cele viitoare', () => {
    const p = intervalPerioada('azi', AZI)
    assert.deepEqual(cazul.filter(t => inPerioadaSauDeschis(t, p)).map(t => t.id), [1, 2, 3, 4, 5, 9, 11])
  })
  it('aprobatul fără dată e vizibil, dar NU e numărat „blocat”', () => {
    assert.equal(inPerioadaSauDeschis(T(9, 'aprobat', null), intervalPerioada('luna', AZI)), true)
    assert.equal(esteTransportBlocat(T(9, 'aprobat', null), AZI), false)
    assert.equal(inPerioadaSauDeschis(T(12, 'cerut', null), intervalPerioada('luna', AZI)), false)
    assert.equal(inPerioadaSauDeschis(T(13, 'livrat', null), intervalPerioada('luna', AZI)), false)
  })
  it('„Toate” arată tot', () => {
    assert.equal(cazul.filter(t => inPerioadaSauDeschis(t, intervalPerioada('tot', AZI))).length, cazul.length)
  })
  it('esteDeschisDinainte: doar statusurile deschise și doar înainte de început', () => {
    assert.deepEqual(STATUS_DESCHIS, ['aprobat', 'programat', 'in_tranzit'])
    assert.equal(esteDeschisDinainte(T(1, 'aprobat', '2026-09-30'), '2026-10-01'), true)
    assert.equal(esteDeschisDinainte(T(1, 'aprobat', '2026-10-01'), '2026-10-01'), false)
    assert.equal(esteDeschisDinainte(T(1, 'livrat', '2026-09-30'), '2026-10-01'), false)
    assert.equal(esteDeschisDinainte(T(1, 'cerut', '2026-09-30'), '2026-10-01'), false)
    assert.equal(esteDeschisDinainte(T(1, 'aprobat', '2026-09-30'), null), false)
    assert.equal(esteDeschisDinainte(T(1, 'programat', null), '2026-10-01'), true)
    assert.equal(esteDeschisDinainte(T(1, 'in_tranzit', null), '2026-10-01'), true)
    assert.equal(esteDeschisDinainte(T(1, 'aprobat', null), null), false)
  })
})

describe('reunesteTransporturi + filtreazaTransporturi', () => {
  it('reuniunea nu dublează rândurile prezente în ambele interogări', () => {
    const r = reunesteTransporturi([T(1, 'aprobat', '2026-10-07'), T(5, 'aprobat', AZI)], [T(1, 'aprobat', '2026-10-07'), T(11, 'aprobat', '2026-08-20')], null)
    assert.deepEqual(r.map(t => t.id), [1, 5, 11])
  })
  it('venit din banner: filtrul „Blocate” arată exact cele din banner, cele mai vechi sus', () => {
    assert.deepEqual(filtreazaTransporturi(cazul, FILTRU_BLOCATE, AZI).map(t => t.id), [11, 1, 2, 3])
  })
  it('„Aprobat” cuprinde și statusul vechi „programat”', () => {
    assert.deepEqual(filtreazaTransporturi(cazul, 'aprobat', AZI).map(t => t.id), [11, 1, 2, 5, 6, 9])
  })
  it('alte statusuri: egalitate; „Toate”: cele recente sus, fără dată la final', () => {
    assert.deepEqual(filtreazaTransporturi(cazul, 'in_tranzit', AZI).map(t => t.id), [4, 3])
    assert.deepEqual(filtreazaTransporturi(cazul, 'Toate', AZI).map(t => t.id), [6, 5, 4, 3, 2, 1, 10, 7, 8, 11, 9])
  })
  it('lista lipsă = listă goală, nu eroare', () => {
    assert.deepEqual(filtreazaTransporturi(null, 'Toate', AZI), [])
  })
})

// ------------------------------------------------------------
// r2 (Jakarinos #1069): încărcarea reală — interogările compuse și paginarea, pe un server fals
// care aplică filtrele ca PostgREST (NULL nu trece de gte/lt), ordonează, limitează și TAIE la
// plafonul max-rows (implicit 1000). Așteptările sunt numărate de mână din setul construit.
// ------------------------------------------------------------
function serverFals(randuri, { maxRows = 1000, laCerere = null } = {}) {
  const cereri = []
  const tabel = () => {
    const st = { cols: null, opts: {}, filtre: [], order: [], limit: null }
    const pune = op => (c, v) => { st.filtre.push([op, c, v]); return b }
    const b = {
      select(cols, opts = {}) { st.cols = cols; st.opts = opts; return b },
      gte: pune('gte'), lte: pune('lte'), lt: pune('lt'), gt: pune('gt'), in: pune('in'), is: pune('is'),
      or(s) { st.filtre.push(['or', null, s]); return b },
      order(c, o) { st.order.push([c, o?.ascending !== false]); return b },
      limit(n) { st.limit = n; return b },
      then(ok, ko) { return Promise.resolve().then(() => raspunde(st)).then(ok, ko) },
    }
    return b
  }
  const trece = (r, [op, c, v]) => {
    const x = r[c]
    if (op === 'gte') return x != null && x >= v
    if (op === 'lte') return x != null && x <= v
    if (op === 'lt') return x != null && x < v
    if (op === 'gt') return x != null && x > v
    if (op === 'in') return v.includes(x)
    if (op === 'is') return v === null ? x === null : x === v
    if (op === 'or') return v.split(',').some(p => { const [col, o, val] = p.split('.'); return o === 'eq' && String(r[col]) === val })
    throw new Error('operator necunoscut ' + op)
  }
  const raspunde = st => {
    const nr = cereri.push(st) - 1
    const h = laCerere && laCerere(st, nr, randuri)
    if (h && h.error) return { data: null, error: h.error, count: null }
    let rez = randuri.filter(r => st.filtre.every(f => trece(r, f)))
    const count = st.opts.count === 'exact' ? rez.length : null
    if (st.opts.head) return { data: null, error: null, count }
    for (const [c, asc] of [...st.order].reverse()) rez = [...rez].sort((a, b) => (a[c] < b[c] ? -1 : a[c] > b[c] ? 1 : 0) * (asc ? 1 : -1))
    return { data: rez.slice(0, Math.min(st.limit ?? Infinity, maxRows)), error: null, count }
  }
  return { tabel, cereri }
}

// 12.11.2026, perioada implicită „Luna” (de la 01.11): 1001 transporturi APROBATE din octombrie
// (n-au plecat), 3 din noiembrie, 1 aprobat fără dată, 1 în tranzit fără dată, plus zgomot care
// NU trebuie să apară: 50 livrate din octombrie, 1 cerut fără dată, 1 anulat din septembrie.
const AZI_R2 = '2026-11-12'
function setMare() {
  const r = []
  let id = 1
  for (let i = 0; i < 1001; i++) r.push({ id: id++, status: 'aprobat', data_transport: `2026-10-${String(1 + (i % 31)).padStart(2, '0')}`, solicitant_id: i % 2 ? 'u1' : 'u2' })
  for (let i = 0; i < 50; i++) r.push({ id: id++, status: 'livrat', data_transport: '2026-10-15', solicitant_id: 'u1' })
  r.push({ id: id++, status: 'aprobat', data_transport: '2026-11-03', solicitant_id: 'u1' })
  r.push({ id: id++, status: 'livrat', data_transport: '2026-11-05', solicitant_id: 'u2' })
  r.push({ id: id++, status: 'cerut', data_transport: '2026-11-20', solicitant_id: 'u1' })
  r.push({ id: id++, status: 'aprobat', data_transport: null, solicitant_id: 'u1' })   // 1055
  r.push({ id: id++, status: 'in_tranzit', data_transport: null, solicitant_id: 'u2' }) // 1056
  r.push({ id: id++, status: 'cerut', data_transport: null, solicitant_id: 'u1' })
  r.push({ id: id++, status: 'anulat', data_transport: '2026-09-01', solicitant_id: 'u1' })
  return r
}
const ids = l => l.map(t => t.id).sort((a, b) => a - b)
const interval = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i)

describe('incarcaTransporturi — citire completă peste plafonul serverului', () => {
  it('serverul fals taie într-adevăr la 1000 (o singură citire, ca înainte, ar pierde rânduri)', async () => {
    const { tabel } = serverFals(setMare())
    const r = await tabel().select('*').in('status', STATUS_DESCHIS).lt('data_transport', '2026-11-01')
    assert.equal(r.data.length, 1000)
  })
  it('„Luna”: toate cele 1001 aprobate vechi + cele 3 din noiembrie + cele 2 deschise fără dată', async () => {
    const { tabel } = serverFals(setMare())
    const rows = await incarcaTransporturi(tabel, { select: '*', perioada: 'luna', azi: AZI_R2 })
    // 1..1001 aprobate oct; 1052..1054 din noiembrie (aprobat, livrat, cerut); 1055 aprobat fără dată, 1056 tranzit fără dată
    assert.deepEqual(ids(rows), [...interval(1, 1001), 1052, 1053, 1054, 1055, 1056])
    assert.equal(rows.length, 1006)
  })
  it('plafonul serverului sub pagina cerută (300 < 500) nu oprește citirea', async () => {
    const { tabel } = serverFals(setMare(), { maxRows: 300 })
    const rows = await incarcaTransporturi(tabel, { select: '*', perioada: 'luna', azi: AZI_R2 })
    assert.equal(rows.length, 1006)
  })
  it('„Toate”: o singură citire (fără filtre), inclusiv rândurile fără dată, toate 1058', async () => {
    const { tabel, cereri } = serverFals(setMare())
    const rows = await incarcaTransporturi(tabel, { select: '*', perioada: 'tot', azi: AZI_R2 })
    assert.deepEqual(ids(rows), interval(1, 1058))
    assert.ok(cereri.every(c => c.filtre.every(([op]) => op === 'gt')), 'la „Toate” singurul filtru e cheia de paginare')
  })
  it('„Doar ale mele” se aplică pe FIECARE citire, inclusiv numărările', async () => {
    const { tabel, cereri } = serverFals(setMare())
    const rows = await incarcaTransporturi(tabel, { select: '*', perioada: 'luna', azi: AZI_R2, meleId: 'u1' })
    assert.ok(cereri.length > 0 && cereri.every(c => c.filtre.some(([op, , v]) => op === 'or' && v.includes('solicitant_id.eq.u1'))))
    // u1 = aprobatele oct cu index impar (500), 1052 aprobat, 1054 cerut, 1055 aprobat fără dată
    assert.equal(rows.length, 503)
    assert.ok(rows.every(t => t.solicitant_id === 'u1'))
  })
  it('paginile cer ordine stabilă pe cheie unică (id crescător) și continuă de la ultimul id', async () => {
    const { tabel, cereri } = serverFals(setMare())
    await incarcaTransporturi(tabel, { select: '*', perioada: 'luna', azi: AZI_R2 })
    const pagini = cereri.filter(c => !c.opts.head)
    assert.ok(pagini.every(c => c.order.length === 1 && c.order[0][0] === 'id' && c.order[0][1] === true && c.limit === 500))
    assert.ok(pagini.some(c => c.filtre.some(([op, col, v]) => op === 'gt' && col === 'id' && v === 500)))
  })
  it('o eroare pe o pagină = excepție, nu listă parțială', async () => {
    const { tabel } = serverFals(setMare(), { laCerere: (st, nr) => (nr === 3 ? { error: new Error('timeout') } : null) })
    await assert.rejects(incarcaTransporturi(tabel, { select: '*', perioada: 'luna', azi: AZI_R2 }), /timeout/)
  })
  it('lista care se schimbă la fiecare încercare = eroare „instabilă” după 3 încercări', async () => {
    let id = 9000
    const { tabel } = serverFals(setMare(), {
      // la fiecare pagină de după prima apare un transport aprobat nou din octombrie
      laCerere: (st, nr, randuri) => { if (!st.opts.count && !st.opts.head) randuri.push({ id: id++, status: 'aprobat', data_transport: '2026-10-02' }) },
    })
    await assert.rejects(incarcaTransporturi(tabel, { select: '*', perioada: 'luna', azi: AZI_R2 }), e => e.code === TRANSPORTURI_INSTABILE)
  })
  it('id lipsă / neordonat de la server = eroare', async () => {
    const pagini = [[{ id: 2 }, { id: 1 }]]
    const fals = () => {
      const b = { gt: () => b, order: () => b, limit: () => b, then: (ok) => Promise.resolve({ data: pagini[0], error: null, count: 2 }).then(ok) }
      return b
    }
    await assert.rejects(citesteCompletDupaId(fals), /altă ordine/)
  })
})

describe('filtreTransporturi — ce interogări se compun', () => {
  const inregistreaza = aplica => {
    const ops = []
    const b = new Proxy({}, { get: (_, op) => (...a) => { ops.push([op, ...a]); return b } })
    aplica(b)
    return ops
  }
  it('„Luna”: perioada + deschise dinainte + deschise fără dată', () => {
    const { filtre } = filtreTransporturi({ perioada: 'luna', azi: AZI_R2 })
    assert.deepEqual(filtre.map(f => f.nume), ['perioada', 'deschise_dinainte', 'deschise_fara_data'])
    assert.deepEqual(inregistreaza(filtre[0].aplica), [['gte', 'data_transport', '2026-11-01']])
    assert.deepEqual(inregistreaza(filtre[1].aplica), [['in', 'status', ['aprobat', 'programat', 'in_tranzit']], ['lt', 'data_transport', '2026-11-01']])
    assert.deepEqual(inregistreaza(filtre[2].aplica), [['in', 'status', ['aprobat', 'programat', 'in_tranzit']], ['is', 'data_transport', null]])
  })
  it('„Azi”: perioada închisă pe ziua de azi', () => {
    const { filtre } = filtreTransporturi({ perioada: 'azi', azi: AZI_R2 })
    assert.deepEqual(inregistreaza(filtre[0].aplica), [['gte', 'data_transport', AZI_R2], ['lte', 'data_transport', AZI_R2]])
    assert.equal(filtre.length, 3)
  })
  it('„Toate”: o singură interogare, fără filtre', () => {
    const { filtre } = filtreTransporturi({ perioada: 'tot', azi: AZI_R2 })
    assert.equal(filtre.length, 1)
    assert.deepEqual(inregistreaza(filtre[0].aplica), [])
  })
})
