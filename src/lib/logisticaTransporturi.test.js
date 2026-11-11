import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import {
  STATUS_DESCHIS, FILTRU_BLOCATE, adunaZile, esteTransportBlocat, intervalPerioada,
  esteDeschisDinainte, inPerioadaSauDeschis, reunesteTransporturi, filtreazaTransporturi,
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
    // 1, 2, 5, 6, 11 aprobate/programate; 3, 4 în tranzit; 7 livrat, 8 anulat, 10 cerut, 9 fără dată = ascunse
    assert.deepEqual(vazute, [1, 2, 3, 4, 5, 6, 11])
  })
  it('„Azi” arată transporturile de azi + cele deschise rămase din urmă, nu și pe cele viitoare', () => {
    const p = intervalPerioada('azi', AZI)
    assert.deepEqual(cazul.filter(t => inPerioadaSauDeschis(t, p)).map(t => t.id), [1, 2, 3, 4, 5, 11])
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
