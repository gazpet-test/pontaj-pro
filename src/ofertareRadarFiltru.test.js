import { describe, it, expect } from 'vitest'
import { filtreazaRadar, eExpirat, normCautare } from './ofertareRadarFiltru.js'

// Date inventate. „Acum" = 16.11.2026, 12:00 ora României (10:00 UTC).
const ACUM = Date.UTC(2026, 10, 16, 10, 0, 0)

const R = [
  { id: 1, nr_seap: 'CN0000001', titlu: 'Extindere rețea gaze naturale comuna Exemplu', autoritate: 'COMUNA EXEMPLU, JUDEȚUL IALOMIȚA', cpv: '45231221-0', status: 'nou', scor_potrivire: 85, segment: 'distributie', termen_depunere: '2026-12-01T10:00:00+02:00' },
  { id: 2, nr_seap: 'CN0000002', titlu: 'Interconectare conducte DN800 cu DN400', autoritate: 'OPERATOR TRANSPORT TEST', cpv: '45255121-3', status: 'interesant', scor_potrivire: 62, segment: 'transgaz', termen_depunere: '2026-11-10T10:00:00+02:00' },
  { id: 3, nr_seap: 'SCN0000003', titlu: 'Branșamente gaze cartier Test', autoritate: 'Primăria Ialomiţa Test', cpv: '45231221-0', status: 'ignorat', scor_potrivire: 30, segment: 'distributie', termen_depunere: '2026-12-05T10:00:00+02:00' },
  { id: 4, nr_seap: 'CN0000004', titlu: 'Lucrări sondă', autoritate: 'PRODUCATOR GAZE TEST', cpv: '45255000-7', status: 'preluat', scor_potrivire: 75, segment: 'romgaz', termen_depunere: '2026-11-01T10:00:00+02:00' },
  { id: 5, nr_seap: 'CN0000005', titlu: 'Rețea apă și canalizare', autoritate: 'ORAS TEST', cpv: '45232150-8', status: 'nou', scor_potrivire: null, segment: 'altele', termen_depunere: null },
  { id: 6, nr_seap: 'CN0000006', titlu: 'Conductă țiței', autoritate: 'TRANSPORT TITEI TEST', cpv: '45231113-0', status: 'nou', scor_potrivire: 50, segment: 'conpet', termen_depunere: '2026-11-16' },
  { id: 7, nr_seap: 'CN0000007', titlu: 'Stație de reglare', autoritate: 'DISTRIBUITOR TEST', cpv: '45231223-4', status: 'nou', scor_potrivire: 45, segment: null, termen_depunere: '2026-11-15' },
]
const ids = res => res.lista.map(r => r.id)

describe('normCautare', () => {
  it('scoate diacriticele (virgulă și sedilă) și literele mari', () => {
    expect(normCautare('JUDEȚUL IALOMIȚA')).toBe('judetul ialomita')
    expect(normCautare('Primăria Ialomiţa')).toBe('primaria ialomita')
    expect(normCautare('  Branșamente   gaze ')).toBe('bransamente gaze')
    expect(normCautare(null)).toBe('')
  })
})

describe('eExpirat', () => {
  it('termen cu oră, comparat pe momentul exact', () => {
    expect(eExpirat('2026-11-16T11:59:00+02:00', ACUM)).toBe(true)
    expect(eExpirat('2026-11-16T12:01:00+02:00', ACUM)).toBe(false)
  })
  it('termen doar cu dată: expiră după ce trece ziua în România', () => {
    expect(eExpirat('2026-11-16', ACUM)).toBe(false)
    expect(eExpirat('2026-11-15', ACUM)).toBe(true)
    // 16.11, 23:30 UTC = 17.11, 01:30 în România -> ziua de 16 a trecut
    expect(eExpirat('2026-11-16', Date.UTC(2026, 10, 16, 23, 30))).toBe(true)
  })
  it('fără termen sau termen ilizibil = nu e expirat', () => {
    expect(eExpirat(null, ACUM)).toBe(false)
    expect(eExpirat('', ACUM)).toBe(false)
    expect(eExpirat('nu e dată', ACUM)).toBe(false)
  })
})

describe('filtreazaRadar fără căutare', () => {
  it('implicit (Noi + interesante): ascunde expiratele, arată anunțul fără termen', () => {
    const res = filtreazaRadar(R, { stare: 'activ', acumMs: ACUM })
    expect(ids(res)).toEqual([1, 5, 6])
    expect(res.total).toBe(7)
    expect(res.ascunsePeScorSegment).toBe(0)
  })
  it('„Arată și expirate" le aduce înapoi', () => {
    expect(ids(filtreazaRadar(R, { stare: 'activ', cuExpirate: true, acumMs: ACUM }))).toEqual([1, 2, 5, 6, 7])
  })
  it('stare „toate", cu și fără expirate', () => {
    expect(ids(filtreazaRadar(R, { stare: 'toate', acumMs: ACUM }))).toEqual([1, 3, 5, 6])
    expect(ids(filtreazaRadar(R, { stare: 'toate', cuExpirate: true, acumMs: ACUM }))).toEqual([1, 2, 3, 4, 5, 6, 7])
  })
  it('stări individuale', () => {
    expect(ids(filtreazaRadar(R, { stare: 'preluat', cuExpirate: true, acumMs: ACUM }))).toEqual([4])
    expect(ids(filtreazaRadar(R, { stare: 'preluat', acumMs: ACUM }))).toEqual([])
    expect(ids(filtreazaRadar(R, { stare: 'ignorat', acumMs: ACUM }))).toEqual([3])
    expect(ids(filtreazaRadar(R, { stare: 'interesant', cuExpirate: true, acumMs: ACUM }))).toEqual([2])
  })
  it('scor minim: fără scor nu trece', () => {
    expect(ids(filtreazaRadar(R, { stare: 'toate', cuExpirate: true, scorMin: 70, acumMs: ACUM }))).toEqual([1, 4])
    expect(ids(filtreazaRadar(R, { stare: 'toate', cuExpirate: true, scorMin: 40, acumMs: ACUM }))).toEqual([1, 2, 4, 6, 7])
  })
  it('segment: exact pe cele trei, „altele" = restul (conpet, fără segment, altele)', () => {
    const f = s => ids(filtreazaRadar(R, { stare: 'toate', cuExpirate: true, segment: s, acumMs: ACUM }))
    expect(f('distributie')).toEqual([1, 3])
    expect(f('transgaz')).toEqual([2])
    expect(f('romgaz')).toEqual([4])
    expect(f('altele')).toEqual([5, 6, 7])
    expect(f('')).toEqual([1, 2, 3, 4, 5, 6, 7])
  })
  it('combinație stare + scor + segment', () => {
    expect(ids(filtreazaRadar(R, { stare: 'activ', scorMin: 40, segment: 'distributie', acumMs: ACUM }))).toEqual([1])
    expect(ids(filtreazaRadar(R, { stare: 'activ', scorMin: 40, segment: 'altele', cuExpirate: true, acumMs: ACUM }))).toEqual([6, 7])
  })
})

describe('filtreazaRadar cu căutare', () => {
  it('fără diacritice găsește textul cu diacritice (virgulă și sedilă), oricare stare și expirat', () => {
    // 1 = nou, 3 = ignorat (autoritate cu ţ sedilă)
    expect(ids(filtreazaRadar(R, { cautare: 'ialomita', stare: 'activ', acumMs: ACUM }))).toEqual([1, 3])
  })
  it('cu diacritice și litere mari găsește la fel', () => {
    expect(ids(filtreazaRadar(R, { cautare: 'IALOMIȚA', stare: 'activ', acumMs: ACUM }))).toEqual([1, 3])
  })
  it('număr parțial, chiar dacă anunțul e preluat și expirat', () => {
    const res = filtreazaRadar(R, { cautare: '0000004', stare: 'activ', acumMs: ACUM })
    expect(ids(res)).toEqual([4])
    // „cn000000" se regăsește și în SCN0000003 (ignorat): căutarea trece peste stare
    expect(ids(filtreazaRadar(R, { cautare: 'cn000000', stare: 'activ', acumMs: ACUM }))).toEqual([1, 2, 3, 4, 5, 6, 7])
  })
  it('după CPV și după titlu cu diacritice', () => {
    expect(ids(filtreazaRadar(R, { cautare: '45255', stare: 'activ', acumMs: ACUM }))).toEqual([2, 4])
    expect(ids(filtreazaRadar(R, { cautare: 'bransamente', stare: 'activ', acumMs: ACUM }))).toEqual([3])
    expect(ids(filtreazaRadar(R, { cautare: 'conducta titei', stare: 'activ', acumMs: ACUM }))).toEqual([6])
  })
  it('mai multe cuvinte = toate trebuie să apară', () => {
    expect(ids(filtreazaRadar(R, { cautare: 'gaze ialomita', stare: 'activ', acumMs: ACUM }))).toEqual([1, 3])
    expect(ids(filtreazaRadar(R, { cautare: 'gaze inexistent', stare: 'activ', acumMs: ACUM }))).toEqual([])
  })
  it('scorul și segmentul rămân aplicate, iar ce ascund ele se numără', () => {
    const res = filtreazaRadar(R, { cautare: 'ialomita', stare: 'activ', scorMin: 40, acumMs: ACUM })
    expect(ids(res)).toEqual([1])
    expect(res.ascunsePeScorSegment).toBe(1)
    const res2 = filtreazaRadar(R, { cautare: '45255', segment: 'transgaz', acumMs: ACUM })
    expect(ids(res2)).toEqual([2])
    expect(res2.ascunsePeScorSegment).toBe(1)
  })
  it('căutare goală / doar spații = fără căutare', () => {
    expect(ids(filtreazaRadar(R, { cautare: '   ', stare: 'activ', acumMs: ACUM }))).toEqual([1, 5, 6])
  })
  it('intrare lipsă', () => {
    expect(filtreazaRadar(null, {})).toEqual({ lista: [], total: 0, ascunsePeScorSegment: 0 })
  })
})
