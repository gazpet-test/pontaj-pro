import { describe, it, expect } from 'vitest'
import { FARA_CARD, cheieCard, carduriDisponibile, filtreazaAlimentari, selectieMasa, selectiiDeSalvat, luniDin, statiiDin, optiuniFiltru, filtreFaraOptiune, faraSelectiileSalvate } from './alimentariFaraSantierFiltru.js'

// Fixture scrisă de mână (rezultatele așteptate sunt numărate pe fixture, nu din cod).
const ALIM = [
  { id: 1, data_alimentare: '2026-11-03', statie_combustibil: 'Rompetrol Ploiești', card_combustibil: 'GAZPET1', whatsapp_caption: null, logistica_active: { cod_intern: 'NEALOCAT', marca: 'Tehnic' } },
  { id: 2, data_alimentare: '2026-11-05', statie_combustibil: 'Rompetrol Ploiești', card_combustibil: ' GAZPET1 ', whatsapp_caption: 'motorina excavator', logistica_active: { cod_intern: 'NEALOCAT', marca: 'Tehnic' } },
  { id: 3, data_alimentare: '2026-11-07', statie_combustibil: 'Rompetrol Buzău', card_combustibil: 'GAZPET2', whatsapp_caption: null, logistica_active: { cod_intern: 'NEALOCAT', marca: 'Tehnic' } },
  { id: 4, data_alimentare: '2026-10-28', statie_combustibil: 'Rompetrol Ploiești', card_combustibil: 'GAZPET10', whatsapp_caption: null, logistica_active: { cod_intern: 'EXC-07', nr_inmatriculare: 'PH-12-ABC', marca: 'JCB' } },
  { id: 5, data_alimentare: '2026-11-09', statie_combustibil: 'OMV', card_combustibil: null, whatsapp_caption: null, logistica_active: { cod_intern: 'AUTO-3', marca: 'Dacia' } },
  { id: 6, data_alimentare: '2026-11-10', statie_combustibil: 'OMV', card_combustibil: '   ', whatsapp_caption: null, logistica_active: null },
]
const ids = (l) => l.map(a => a.id)

describe('cheieCard', () => {
  it('taie spațiile; gol / null = fără card', () => {
    expect(cheieCard(' GAZPET1 ')).toBe('GAZPET1')
    expect(cheieCard('   ')).toBe(null)
    expect(cheieCard(null)).toBe(null)
    expect(cheieCard(undefined)).toBe(null)
  })
  it('nu confundă carduri cu prefix comun', () => {
    expect(cheieCard('GAZPET10')).not.toBe(cheieCard('GAZPET1'))
  })
})

describe('carduriDisponibile', () => {
  it('listează cardurile distincte (după trim), sortate natural, cu numărul de rânduri', () => {
    const r = carduriDisponibile(ALIM)
    expect(r.carduri).toEqual([
      { card: 'GAZPET1', nr: 2 },
      { card: 'GAZPET2', nr: 1 },
      { card: 'GAZPET10', nr: 1 },
    ])
    expect(r.faraCard).toBe(2)
  })
  it('listă goală / null', () => {
    expect(carduriDisponibile([])).toEqual({ carduri: [], faraCard: 0 })
    expect(carduriDisponibile(null)).toEqual({ carduri: [], faraCard: 0 })
  })
})

describe('filtreazaAlimentari', () => {
  it('fără filtre = toate rândurile', () => {
    expect(ids(filtreazaAlimentari(ALIM))).toEqual([1, 2, 3, 4, 5, 6])
  })
  it('după card: potrivire exactă după trim, fără GAZPET10 la GAZPET1', () => {
    expect(ids(filtreazaAlimentari(ALIM, { card: 'GAZPET1' }))).toEqual([1, 2])
    expect(ids(filtreazaAlimentari(ALIM, { card: 'GAZPET10' }))).toEqual([4])
  })
  it('„fără card” = null sau doar spații', () => {
    expect(ids(filtreazaAlimentari(ALIM, { card: FARA_CARD }))).toEqual([5, 6])
  })
  it('card inexistent în listă = zero rânduri (nu toate)', () => {
    expect(filtreazaAlimentari(ALIM, { card: 'GAZPET99' })).toEqual([])
  })
  it('cardul se combină cu luna, stația, WhatsApp și vehiculul', () => {
    expect(ids(filtreazaAlimentari(ALIM, { card: 'GAZPET1', whatsapp: 'cu_wa' }))).toEqual([2])
    expect(ids(filtreazaAlimentari(ALIM, { card: 'GAZPET1', whatsapp: 'fara_wa' }))).toEqual([1])
    expect(ids(filtreazaAlimentari(ALIM, { card: 'GAZPET10', luna: '2026-11' }))).toEqual([])
    expect(ids(filtreazaAlimentari(ALIM, { luna: '2026-10' }))).toEqual([4])
    expect(ids(filtreazaAlimentari(ALIM, { statie: 'Rompetrol Buzău', card: 'GAZPET2' }))).toEqual([3])
    expect(ids(filtreazaAlimentari(ALIM, { vehicul: ' ph-12 ' }))).toEqual([4])
    expect(ids(filtreazaAlimentari(ALIM, { vehicul: 'nealocat', card: 'GAZPET2' }))).toEqual([3])
  })
})

describe('Mass: aplică toate — doar pe rândurile vizibile', () => {
  it('preselectează exact rândurile filtrate', () => {
    const viz = filtreazaAlimentari(ALIM, { card: 'GAZPET1' })
    expect(selectieMasa(viz, '17')).toEqual({ 1: '17', 2: '17' })
  })
  it('fără șantier ales = nimic', () => {
    expect(selectieMasa(ALIM, '')).toEqual({})
  })
  it('la salvare intră doar selecțiile cu șantier ale rândurilor vizibile acum', () => {
    const selectii = { 1: '17', 2: '17', 3: '9', 5: null }
    const viz = filtreazaAlimentari(ALIM, { card: 'GAZPET1' })
    expect(selectiiDeSalvat(selectii, viz)).toEqual([
      { id: 1, site_id: 17 },
      { id: 2, site_id: 17 },
    ])
    // schimbarea filtrului pe alt card nu salvează rândurile ascunse
    const viz2 = filtreazaAlimentari(ALIM, { card: 'GAZPET2' })
    expect(selectiiDeSalvat(selectii, viz2)).toEqual([{ id: 3, site_id: 9 }])
    expect(selectiiDeSalvat(selectii, filtreazaAlimentari(ALIM, { card: FARA_CARD }))).toEqual([])
  })
})

// Review #1184 r2 (P2): un filtru de lună / stație ales pe alt set de rânduri rămâne vizibil ca „fără rezultate”.
describe('opțiunile filtrelor de lună / stație cu valoarea aleasă păstrată', () => {
  it('lunile (cele mai noi întâi) și stațiile (alfabetic) din rândurile încărcate', () => {
    expect(luniDin(ALIM)).toEqual(['2026-11', '2026-10'])
    expect(statiiDin(ALIM)).toEqual(['OMV', 'Rompetrol Buzău', 'Rompetrol Ploiești'])
    expect(luniDin(null)).toEqual([])
  })
  it('valoarea aleasă prezentă = opțiunile neschimbate', () => {
    expect(optiuniFiltru(['2026-11', '2026-10'], '2026-10')).toEqual([
      { valoare: '2026-11', faraRezultate: false },
      { valoare: '2026-10', faraRezultate: false },
    ])
    expect(optiuniFiltru(['2026-11'], 'toate')).toEqual([{ valoare: '2026-11', faraRezultate: false }])
  })
  it('scenariul din verdict: noiembrie pe GAZPET1, apoi GAZPET2 (doar octombrie) → noiembrie rămâne, prima, „fără rezultate”', () => {
    const gazpet2 = [{ id: 7, data_alimentare: '2026-10-02', statie_combustibil: 'OMV', card_combustibil: 'GAZPET2' }]
    expect(optiuniFiltru(luniDin(gazpet2), '2026-11')).toEqual([
      { valoare: '2026-11', faraRezultate: true },
      { valoare: '2026-10', faraRezultate: false },
    ])
    expect(optiuniFiltru(statiiDin(gazpet2), 'Rompetrol Buzău')).toEqual([
      { valoare: 'Rompetrol Buzău', faraRezultate: true },
      { valoare: 'OMV', faraRezultate: false },
    ])
    expect(filtreFaraOptiune(gazpet2, { luna: '2026-11', statie: 'Rompetrol Buzău' })).toEqual(['luna', 'statie'])
    expect(filtreFaraOptiune(gazpet2, { luna: '2026-10', statie: 'toate' })).toEqual([])
    // și lista goală: filtrul ales rămâne vizibil
    expect(optiuniFiltru([], '2026-11')).toEqual([{ valoare: '2026-11', faraRezultate: true }])
  })
})

describe('după o salvare cu conflicte / erori se scot doar selecțiile trimise', () => {
  it('selecțiile făcute între timp (alt card) rămân', () => {
    const prev = { 1: '17', 2: '17', 3: '18' }
    expect(faraSelectiileSalvate(prev, [{ id: 1, site_id: 17 }, { id: 2, site_id: 17 }])).toEqual({ 3: '18' })
    expect(faraSelectiileSalvate(prev, [])).toEqual(prev)
    expect(prev).toEqual({ 1: '17', 2: '17', 3: '18' })   // nu modifică obiectul primit
  })
})
