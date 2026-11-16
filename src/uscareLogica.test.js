// Logica raportului de uscare (src/uscareLogica.js): paritatea listelor cu migrarea 20261225a, calculele, ora României, formularul.
// Valorile așteptate sunt scrise de mână (L25), nu calculate cu codul testat.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  CAMPURI, OBLIGATORII, TRANZITII, CATEGORII, POZE_CERUTE, RPC_USCARE, stareDupa, actiuniPermise,
  oraLocalaDinIso, isoDinOraLocala, ziBucuresti, durataOre, vitezaMedie, diferentaBurete, verificare24h, avertismentMeteo,
  lipsaDinRand, pozeLipsa, formularNou, formularDinRand, payloadDinFormular, areModificari, propunereMeteo, numeFisierRaport, prefixRegistru,
} from './uscareLogica.js'

const SQL = readFileSync(fileURLToPath(new URL('../supabase/migrations/20261225a_executie_uscare.sql', import.meta.url)), 'utf8').replace(/\r/g, '')
const bloc = nume => SQL.slice(SQL.indexOf(`-- ${nume}-START`), SQL.indexOf(`-- ${nume}-END`))

describe('paritatea cu migrarea 20261225a (L19)', () => {
  it('CAMPURI = cheile din blocul CAMPURI (aceeași ordine)', () => {
    expect([...bloc('CAMPURI').matchAll(/\('([a-z_]+)'\)/g)].map(m => m[1])).toEqual(CAMPURI)
    expect(CAMPURI).toHaveLength(31)
  })
  it('lista de tipuri a RPC-ului acoperă exact CAMPURI', () => {
    const i = SQL.indexOf('FOR c IN SELECT * FROM (VALUES'), j = SQL.indexOf(') s(k, tip, mn, mx, z) LOOP', i)
    expect([...SQL.slice(i, j).matchAll(/\('([a-z_]+)', '[a-z]+'/g)].map(m => m[1])).toEqual(CAMPURI)
  })
  it('OBLIGATORII = blocul din fn_executie_uscare_lipsa', () => {
    expect([...bloc('OBLIGATORII').matchAll(/\(\d+, '([a-z_]+)'/g)].map(m => m[1])).toEqual(OBLIGATORII)
  })
  it('TRANZITII = blocul din fn_executie_uscare_tranzitie', () => {
    expect([...bloc('TRANZITII').matchAll(/\('([a-z]+)', '([a-z]+)', '([a-z]+)'\)/g)].map(m => [m[1], m[2], m[3]])).toEqual(TRANZITII)
  })
  it('CATEGORII = CHECK-ul tabelului de poze și lista RPC-ului', () => {
    const lista = s => [...s.matchAll(/'([a-z_]+)'/g)].map(m => m[1])
    expect(lista(bloc('CATEGORII').split('IN (')[1])).toEqual(CATEGORII)
    const rpc = SQL.slice(SQL.indexOf("IF p_categorie NOT IN ("), SQL.indexOf(') THEN', SQL.indexOf("IF p_categorie NOT IN (")))
    expect(lista(rpc)).toEqual(CATEGORII)
    expect(POZE_CERUTE.every(c => CATEGORII.includes(c))).toBe(true)
  })
  it('RPC-urile din registrul local există în migrare cu EXECUTE pentru authenticated', () => {
    for (const f of RPC_USCARE) expect(SQL).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${f}\\([^)]*\\) TO authenticated;`))
    expect(prefixRegistru('u', 7)).toBe('gazpet.uscare.incert.v1:u:7:')
  })
})

describe('stările', () => {
  it('tranzițiile permise', () => {
    expect(stareDupa('deschisa', 'inchide')).toBe('inchisa')
    expect(stareDupa('inchisa', 'redeschide')).toBe('deschisa')
    expect(stareDupa('deschisa', 'anuleaza')).toBe('anulata')
    expect(stareDupa('inchisa', 'anuleaza')).toBe(null)
    expect(stareDupa('anulata', 'redeschide')).toBe(null)
    expect(stareDupa('inchisa', 'inchide')).toBe(null)
    expect(actiuniPermise('deschisa')).toEqual(['inchide', 'anuleaza'])
    expect(actiuniPermise('anulata')).toEqual([])
  })
})

describe('ora României (L17)', () => {
  it('iarna UTC+2, vara UTC+3', () => {
    expect(oraLocalaDinIso('2026-12-08T06:30:00Z')).toBe('2026-12-08T08:30')
    expect(oraLocalaDinIso('2026-07-01T05:30:00.000Z')).toBe('2026-07-01T08:30')
    expect(isoDinOraLocala('2026-12-08T08:30')).toBe('2026-12-08T06:30:00.000Z')
    expect(isoDinOraLocala('2026-07-01T08:30')).toBe('2026-07-01T05:30:00.000Z')
  })
  it('peste miezul nopții și schimbarea orei', () => {
    expect(oraLocalaDinIso('2026-12-07T22:30:00Z')).toBe('2026-12-08T00:30')
    expect(isoDinOraLocala('2026-12-08T00:30')).toBe('2026-12-07T22:30:00.000Z')
    // 29.03.2026: 03:00 -> 04:00, deci 03:30 nu există
    expect(isoDinOraLocala('2026-03-29T03:30')).toBeNaN()
    expect(isoDinOraLocala('2026-03-29T04:30')).toBe('2026-03-29T01:30:00.000Z')
    expect(isoDinOraLocala('2026-03-29T02:30')).toBe('2026-03-29T00:30:00.000Z')
  })
  it('gol / greșit', () => {
    expect(isoDinOraLocala('')).toBe(null)
    expect(isoDinOraLocala('08.12.2026 08:30')).toBeNaN()
    expect(oraLocalaDinIso(null)).toBe('')
    expect(oraLocalaDinIso('nu')).toBe('')
    expect(ziBucuresti(Date.parse('2026-12-07T22:30:00Z'))).toBe('2026-12-08')
  })
})

describe('calculele', () => {
  it('durata în ore', () => {
    expect(durataOre('2026-12-08T06:30:00Z', '2026-12-08T09:15:00Z')).toBe(2.75)
    expect(durataOre('2026-12-08T06:30:00Z', '2026-12-08T06:50:00Z')).toBe(0.33)
    expect(durataOre('2026-12-08T06:30:00Z', '2026-12-08T06:30:00Z')).toBe(null)
    expect(durataOre('2026-12-08T06:30:00Z', null)).toBe(null)
  })
  it('viteza medie = lungime / timp', () => {
    expect(vitezaMedie(700, 35)).toBe(0.33)       // 700 / 2100
    expect(vitezaMedie(1200, 10)).toBe(2)         // 1200 / 600
    expect(vitezaMedie('700', '35')).toBe(0.33)
    expect(vitezaMedie(700, 0)).toBe(null)
    expect(vitezaMedie(null, 35)).toBe(null)
  })
  it('diferența de greutate a buretelui (ieșire − intrare)', () => {
    expect(diferentaBurete({ intrare_kg: 2.1, iesire_kg: 2.45 })).toBe(0.35)
    expect(diferentaBurete({ intrare_kg: 2.05, iesire_kg: 2.05 })).toBe(0)
    expect(diferentaBurete({ intrare_kg: 2.1, iesire_kg: null })).toBe(null)
  })
  it('notificarea cu 24 h înainte, pe momentul exact', () => {
    // anunț 07.12 11:05, început 08.12 08:30 (ora României) = 21 h 25 min
    expect(verificare24h('2026-12-07T09:05:00Z', null, '2026-12-08T06:30:00Z')).toEqual({ stare: 'sub_24h', ore: 21.4, inceput: 'planificat' })
    expect(verificare24h('2026-12-07T06:30:00Z', null, '2026-12-08T06:30:00Z')).toEqual({ stare: 'ok', ore: 24, inceput: 'planificat' })
    expect(verificare24h('2026-12-07T06:30:01Z', null, '2026-12-08T06:30:00Z').stare).toBe('sub_24h')
    // începutul real are întâietate față de cel planificat
    expect(verificare24h('2026-12-07T06:30:00Z', '2026-12-08T05:00:00Z', '2026-12-08T06:30:00Z')).toEqual({ stare: 'sub_24h', ore: 22.5, inceput: 'real' })
    expect(verificare24h(null, null, '2026-12-08T06:30:00Z')).toEqual({ stare: 'necunoscut', ore: null, inceput: 'planificat' })
    expect(verificare24h('2026-12-07T06:30:00Z', null, null)).toEqual({ stare: 'necunoscut', ore: null, inceput: null })
  })
  it('meteo departe de ora de început', () => {
    expect(avertismentMeteo('2026-12-08T06:00:00Z', '2026-12-08T06:30:00Z')).toBe(null)
    expect(avertismentMeteo('2026-12-08T02:00:00Z', '2026-12-08T06:30:00Z')).toMatch(/la 5 h de ora de început/)
    expect(avertismentMeteo(null, '2026-12-08T06:30:00Z')).toBe(null)
  })
  it('propunerea din meteo (o zecimală, ora datelor păstrată)', () => {
    expect(propunereMeteo({ curent: { temp: 7.46, vreme: 'Senin' }, actualizat_la: '2026-12-08T06:00:00Z' }))
      .toEqual({ temperatura_c: '7,5', vreme: 'Senin', meteo_la: '2026-12-08T06:00:00Z' })
    expect(propunereMeteo({ curent: { temp: null }, actualizat_la: 'x' })).toBe(null)
    expect(propunereMeteo(null)).toBe(null)
  })
})

const RAND = {
  id: 5, proiect_id: 1, proba_id: 10, tronson: 'Tr. 2', km_de_la_m: 3200, km_pana_la_m: 3900, lungime_m: 700, inceput_planificat: '2026-12-08T06:30:00+00:00',
  notificare_la: '2026-12-07T09:05:00+00:00', notificare_ref: null, data_operatie: '2026-12-08', ora_inceput: '2026-12-08T06:40:00+00:00',
  ora_final: '2026-12-08T09:10:00+00:00', temperatura_c: 7.5, temperatura_sursa: 'meteo', meteo_la: '2026-12-08T06:00:00+00:00', vreme: 'Senin',
  constructor: 'Constructor SRL', utilaje: [{ denumire: 'Compresor', buc: 1 }], pig_metalic_buc: 1, piston_pu_buc: 0, bureti_buc: 3,
  cantariri: [{ nr: 1, intrare_kg: 2.1, iesire_kg: 2.45 }, { nr: 2, intrare_kg: 2.05, iesire_kg: 2.2 }, { nr: 3, intrare_kg: 2, iesire_kg: 2.01 }],
  punct_roua_c: -20.5, punct_roua_loc: 'capăt aval', presiune_bar: 1.5, timp_deplasare_min: 35, observatii: null, concluzie: 'conform',
  semn_constructor_nume: null, semn_constructor_functie: null, semn_beneficiar_nume: null, semn_beneficiar_functie: null, stare: 'deschisa', revizie: 0, versiune: 3,
}

describe('ce lipsește pentru închidere', () => {
  it('rândul complet: nimic', () => { expect(lipsaDinRand(RAND)).toEqual([]) })
  it('fiecare lipsă, în ordinea modelului', () => {
    expect(lipsaDinRand({ ...RAND, concluzie: null })).toEqual(['concluzie'])
    expect(lipsaDinRand({ ...RAND, piston_pu_buc: null })).toEqual(['pistoane'])
    expect(lipsaDinRand({ ...RAND, utilaje: [] })).toEqual(['utilaje'])
    expect(lipsaDinRand({ ...RAND, cantariri: [{ nr: 1, intrare_kg: 2.1, iesire_kg: null }] })).toEqual(['cantariri'])
    expect(lipsaDinRand({ ...RAND, cantariri: [] })).toEqual(['cantariri'])
    expect(lipsaDinRand({ ...RAND, data_operatie: null, timp_deplasare_min: null })).toEqual(['data_operatie', 'timp_deplasare_min'])
  })
  it('observațiile și semnatarii nu sunt obligatorii; piston 0 e o valoare', () => {
    expect(lipsaDinRand({ ...RAND, observatii: null, semn_beneficiar_nume: null, piston_pu_buc: 0 })).toEqual([])
  })
  it('pozele cerute de beneficiar care lipsesc', () => {
    expect(pozeLipsa([{ categorie: 'manometru' }, { categorie: 'cantar_intrare' }, { categorie: 'altele' }])).toEqual(['temperatura', 'pistoane', 'cantar_iesire'])
    expect(pozeLipsa([])).toEqual(POZE_CERUTE)
  })
})

describe('formularul', () => {
  it('nou, din tronsonul de probă', () => {
    const f = formularNou({ proba: { id: 10, cod: 'P2', denumire: 'Tr. 2', km_de_la_m: 3200, km_pana_la_m: 3900 }, constructor: 'C' })
    expect([f.proba_id, f.tronson, f.km_de_la, f.km_pana_la, f.lungime_m, f.constructor]).toEqual(['10', 'P2 — Tr. 2', '3+200', '3+900', '700', 'C'])
    expect(f.cantariri).toEqual([{ nr: 1, intrare_kg: '', iesire_kg: '' }, { nr: 2, intrare_kg: '', iesire_kg: '' }, { nr: 3, intrare_kg: '', iesire_kg: '' }])
  })
  it('rând -> formular -> payload: aceleași valori, exact cheile contractului', () => {
    const { date, erori } = payloadDinFormular(formularDinRand(RAND))
    expect(erori).toEqual([])
    expect(Object.keys(date)).toEqual(CAMPURI)
    expect(date).toEqual({
      proba_id: 10, tronson: 'Tr. 2', km_de_la_m: 3200, km_pana_la_m: 3900, lungime_m: 700, inceput_planificat: '2026-12-08T06:30:00.000Z',
      notificare_la: '2026-12-07T09:05:00.000Z', notificare_ref: null, data_operatie: '2026-12-08', ora_inceput: '2026-12-08T06:40:00.000Z',
      ora_final: '2026-12-08T09:10:00.000Z', temperatura_c: 7.5, temperatura_sursa: 'meteo', meteo_la: '2026-12-08T06:00:00+00:00', vreme: 'Senin',
      constructor: 'Constructor SRL', utilaje: [{ denumire: 'Compresor', buc: 1 }], pig_metalic_buc: 1, piston_pu_buc: 0, bureti_buc: 3,
      cantariri: [{ nr: 1, intrare_kg: 2.1, iesire_kg: 2.45 }, { nr: 2, intrare_kg: 2.05, iesire_kg: 2.2 }, { nr: 3, intrare_kg: 2, iesire_kg: 2.01 }],
      punct_roua_c: -20.5, punct_roua_loc: 'capăt aval', presiune_bar: 1.5, timp_deplasare_min: 35, observatii: null, concluzie: 'conform',
      semn_constructor_nume: null, semn_constructor_functie: null, semn_beneficiar_nume: null, semn_beneficiar_functie: null,
    })
    expect(areModificari(formularDinRand(RAND), RAND)).toBe(false)
    expect(areModificari({ ...formularDinRand(RAND), presiune_bar: '1,6' }, RAND)).toBe(true)
  })
  it('numerele RO / EN și refuzul zecimalelor în plus (nu rotunjire)', () => {
    const f = { ...formularDinRand(RAND), temperatura_c: '7,45', presiune_bar: '1.5', lungime_m: '1.250,5' }
    const { date, erori } = payloadDinFormular(f)
    expect(date.presiune_bar).toBe(1.5)
    expect(date.lungime_m).toBe(1250.5)
    expect(date.temperatura_c).toBe(null)
    expect(erori).toEqual(['temperatura (°C): număr între -50 și 60, cel mult 1 zecimală'])
  })
  it('temperatura scrisă de om = sursa manual, fără ora meteo', () => {
    const { date } = payloadDinFormular({ ...formularDinRand(RAND), temperatura_sursa: 'manual' })
    expect([date.temperatura_sursa, date.meteo_la]).toEqual(['manual', null])
    const gol = payloadDinFormular({ ...formularDinRand(RAND), temperatura_c: '' }).date
    expect([gol.temperatura_c, gol.temperatura_sursa, gol.meteo_la]).toEqual([null, null, null])
  })
  it('rândurile goale de utilaje se sar; cele pe jumătate sunt erori (nimic pierdut pe tăcute)', () => {
    const base = formularDinRand(RAND)
    expect(payloadDinFormular({ ...base, utilaje: [{ denumire: 'Compresor', buc: '1' }, { denumire: '', buc: '1' }] }).date.utilaje).toEqual([{ denumire: 'Compresor', buc: 1 }])
    expect(payloadDinFormular({ ...base, utilaje: [{ denumire: '', buc: '3' }] }).erori).toEqual(['utilajul 1: denumirea lipsește'])
    expect(payloadDinFormular({ ...base, utilaje: [{ denumire: 'X', buc: '1,5' }] }).erori).toEqual(['utilajul 1: numărul de bucăți (1–99)'])
  })
  it('cântăririle: păstrate pe jumătate (închiderea le cere complete), kg cu 3 zecimale', () => {
    const base = formularDinRand(RAND)
    const r = payloadDinFormular({ ...base, cantariri: [{ nr: 1, intrare_kg: '2,105', iesire_kg: '' }] })
    expect(r.date.cantariri).toEqual([{ nr: 1, intrare_kg: 2.105, iesire_kg: null }])
    expect(r.erori).toEqual([])
    expect(payloadDinFormular({ ...base, cantariri: [{ nr: 1, intrare_kg: '2,1055', iesire_kg: '' }] }).erori).toEqual(['buretele 1 la intrare: kg între 0,001 și 1000, cel mult 3 zecimale'])
  })
  it('km, tronson, ore', () => {
    const base = formularDinRand(RAND)
    expect(payloadDinFormular({ ...base, km_de_la: '3+900', km_pana_la: '3+200' }).erori).toEqual(['intervalul de km: sfârșitul trebuie să fie după început'])
    expect(payloadDinFormular({ ...base, km_de_la: '10,5' }).erori).toEqual(['de la km: „3+200” sau metri întregi'])
    expect(payloadDinFormular({ ...base, tronson: '  ' }).erori).toEqual(['tronsonul e obligatoriu'])
    expect(payloadDinFormular({ ...base, ora_final: '2026-12-08T08:00', ora_inceput: '2026-12-08T09:00' }).erori).toEqual(['ora de final trebuie să fie după ora de început'])
    expect(payloadDinFormular({ ...base, ora_inceput: '2026-03-29T03:30' }).erori).toEqual(['ora de început: oră invalidă'])
  })
  it('numele fișierului', () => {
    expect(numeFisierRaport({ tronson: 'Tr. 2 – Lot A', data_operatie: '2026-12-08', revizie: 0 })).toBe('Raport_uscare_Tr_2_Lot_A_2026-12-08.pdf')
    expect(numeFisierRaport({ tronson: 'Țară', data_operatie: null, revizie: 2 })).toBe('Raport_uscare_Tara_fara_data_rev2.pdf')
  })
})
