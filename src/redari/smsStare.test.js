// Teste pentru smsStare.js — rândurile au forma reală a RPC-ului fn_red_sms_stare (20261130i); valorile așteptate sunt scrise de mână
// din definițiile din antetul migrării (nu derivate din codul testat).
import { describe, it, expect } from 'vitest'
import { normalizeazaRand, hartaSms, citesteSmsStare, stareSmsPentru, categorieFiltru, potrivesteFiltru, textBadge, rezumatSms, intrariCronologie, csvListaSms, dataSms, FILTRE_SMS } from './smsStare.js'

const ID1 = '11111111-1111-4111-8111-111111111111'
const ID2 = '22222222-2222-4222-8222-222222222222'
const rand = (x = {}) => ({ detinator_id: ID1, nr_trimise: 2, nr_livrate: 1, nr_esuate: 0, nr_in_curs: 0, ultima_stare: 'trimis',
  ultima_trimitere: '2026-11-04T21:30:00+00:00', ultima_livrare: '2026-11-03T10:00:00+00:00', loturi: 2, categorie: 'livrat', ...x })

describe('normalizeazaRand / hartaSms — răspuns stricat = eroare, nu „niciun SMS” (L18)', () => {
  it('acceptă un rând valid', () => {
    expect(normalizeazaRand(rand())).toMatchObject({ detinator_id: ID1, nr_trimise: 2, categorie: 'livrat' })
  })
  it('refuză stări / categorii în afara listei albe', () => {
    expect(() => normalizeazaRand(rand({ ultima_stare: 'necunoscut' }))).toThrow(/necunoscută/)
    expect(() => normalizeazaRand(rand({ categorie: 'anulat' }))).toThrow(/Categorie/)
  })
  it('refuză numere lipsă / negative / zecimale și id invalid', () => {
    expect(() => normalizeazaRand(rand({ nr_trimise: null }))).toThrow()
    expect(() => normalizeazaRand(rand({ nr_esuate: -1 }))).toThrow()
    expect(() => normalizeazaRand(rand({ nr_in_curs: 1.5 }))).toThrow()
    expect(() => normalizeazaRand(rand({ nr_trimise: '2' }))).toThrow()
    expect(() => normalizeazaRand(rand({ detinator_id: 'x' }))).toThrow()
    expect(() => normalizeazaRand(rand({ loturi: 0 }))).toThrow()
    expect(() => normalizeazaRand(rand({ ultima_trimitere: 'ieri' }))).toThrow()
  })
  it('refuză incoerențe: livrate > trimise, categorie livrat fără livrări', () => {
    expect(() => normalizeazaRand(rand({ nr_trimise: 0 }))).toThrow(/livrate/)
    expect(() => normalizeazaRand(rand({ nr_livrate: 0 }))).toThrow(/categoria/)
  })
  it('hartaSms: null / obiect = eroare; listă goală = hartă goală; duplicat = eroare', () => {
    expect(() => hartaSms(null)).toThrow(/listă/)
    expect(() => hartaSms({})).toThrow(/listă/)
    expect(hartaSms([]).size).toBe(0)
    expect(() => hartaSms([rand(), rand()])).toThrow(/duplicat/)
    const h = hartaSms([rand(), rand({ detinator_id: ID2, nr_trimise: 0, nr_livrate: 0, nr_esuate: 1, ultima_stare: 'esuat', ultima_trimitere: null, ultima_livrare: null, loturi: 1, categorie: 'esuat' })])
    expect(stareSmsPentru(h, ID2.toUpperCase()).categorie).toBe('esuat')
    expect(stareSmsPentru(h, '33333333-3333-4333-8333-333333333333')).toBeNull()
  })
})

describe('filtrul SMS', () => {
  const st = (categorie, x = {}) => normalizeazaRand(rand({ categorie, ...(categorie === 'livrat' ? {} : { nr_livrate: 0, ultima_livrare: null }), ...x }))
  it('categorii: fără SMS / livrat / trimis + în curs = nelivrat / eșuat', () => {
    expect(categorieFiltru(null)).toBe('fara')
    expect(categorieFiltru(st('livrat'))).toBe('livrat')
    expect(categorieFiltru(st('trimis'))).toBe('nelivrat')
    expect(categorieFiltru(st('in_curs', { ultima_stare: 'in_curs' }))).toBe('nelivrat')
    expect(categorieFiltru(st('esuat', { ultima_stare: 'esuat' }))).toBe('esuat')
  })
  it('potrivesteFiltru: "" = toate; filtru necunoscut = eroare', () => {
    expect(potrivesteFiltru(null, '')).toBe(true)
    expect(potrivesteFiltru(null, 'fara')).toBe(true)
    expect(potrivesteFiltru(st('livrat'), 'fara')).toBe(false)
    expect(potrivesteFiltru(st('trimis'), 'nelivrat')).toBe(true)
    expect(potrivesteFiltru(st('trimis'), 'livrat')).toBe(false)
    expect(() => potrivesteFiltru(null, 'altceva')).toThrow(/necunoscut/)
    expect(FILTRE_SMS.map(f => f.cod)).toEqual(['', 'fara', 'nelivrat', 'livrat', 'esuat'])
  })
})

describe('formatare', () => {
  it('data în ziua din București (21:30 UTC pe 04.11 = 23:30 la București, aceeași zi; 22:30 UTC = 05.11)', () => {
    expect(dataSms('2026-11-04T21:30:00Z')).toBe('04.11.2026')
    expect(dataSms('2026-11-04T22:30:00Z')).toBe('05.11.2026')
    expect(dataSms(null)).toBe('')
  })
  it('badge: ultima stare + ×N doar la N>1 + data ultimei trimiteri; „—” fără SMS', () => {
    expect(textBadge(null)).toBe('—')
    expect(textBadge(normalizeazaRand(rand()))).toBe('📤 trimis ×2 · 04.11.2026')
    expect(textBadge(normalizeazaRand(rand({ nr_trimise: 1, ultima_stare: 'livrat', loturi: 1 })))).toBe('✅ livrat · 04.11.2026')
    expect(textBadge(normalizeazaRand(rand({ nr_trimise: 0, nr_livrate: 0, nr_esuate: 1, ultima_stare: 'esuat', ultima_trimitere: null, ultima_livrare: null, loturi: 1, categorie: 'esuat' })))).toBe('❌ eșuat')
  })
  it('rezumat și cronologie din agregate (doar ultima trimitere / livrare)', () => {
    const s = normalizeazaRand(rand({ nr_in_curs: 1 }))
    expect(rezumatSms(s)).toBe('trimise 2 · livrate 1 · eșuate 0 · în curs 1 · loturi 2 (ultima trimitere 04.11.2026, ultima livrare 03.11.2026)')
    expect(rezumatSms(null)).toBe('niciun SMS')
    expect(intrariCronologie(s).map(x => x.eticheta)).toEqual(['📤 SMS trimis (ultimul din 2)', '✅ SMS livrat'])
    expect(intrariCronologie(null)).toEqual([])
  })
})

describe('citesteSmsStare — keyset pe detinator_id până la pagina goală (L23), eroare != gol (L18)', () => {
  // client fals cu forma supabase-js: rpc(nume, args).order().gt().limit() → { data, error }; păstrează apelurile
  const client = (randuri, { eroare, faraLista } = {}) => {
    const apeluri = []
    return { apeluri, rpc(nume, args) {
      const st = { nume, args, gt: null }
      const q = { order(c) { st.order = c; return q }, gt(c, v) { st.gt = v; return q },
        async limit(n) { apeluri.push({ ...st, n }); if (eroare) return { data: null, error: eroare }; if (faraLista) return { data: {}, error: null }
          return { data: randuri.filter(r => !st.gt || r.detinator_id > st.gt).slice(0, n), error: null } } }
      return q
    } }
  }
  const id = (i) => `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`
  it('citește peste o pagină (1201 rânduri → 3 pagini + pagina goală), fără trunchiere', async () => {
    const rs = Array.from({ length: 1201 }, (_, i) => rand({ detinator_id: id(i + 1) }))
    const c = client(rs)
    const h = await citesteSmsStare(c, 'P1')
    expect(h.size).toBe(1201)
    expect(c.apeluri.map(a => a.gt)).toEqual([null, id(500), id(1000), id(1201)])
    expect(c.apeluri.every(a => a.nume === 'fn_red_sms_stare' && a.args.p_proiect_id === 'P1' && a.order === 'detinator_id')).toBe(true)
  })
  it('eroarea RPC (ex. 42501 / funcție lipsă) se propagă — nu devine hartă goală', async () => {
    await expect(citesteSmsStare(client([], { eroare: { message: 'redari: acces refuzat', code: '42501' } }), 'P1')).rejects.toMatchObject({ code: '42501' })
    await expect(citesteSmsStare(client([], { faraLista: true }), 'P1')).rejects.toThrow(/listă/)
  })
  it('proiect schimbat între timp → abandon (eroare), nu rezultat parțial', async () => {
    let n = 0
    await expect(citesteSmsStare(client([rand()]), 'P1', () => n++ < 1)).rejects.toThrow(/abandonat/)
  })
})

describe('CSV „Lista SMS” (intern)', () => {
  it('antet fix, fără telefon; rând fără SMS = 0 + „fără SMS”; anti formula-injection; ghilimele', () => {
    const h = hartaSms([rand()])
    const csv = csvListaSms([
      { detinator_id: ID1, id_parcela: 'TST-0001', uat3: 'TST', nume: 'POPESCU; ION' },
      { detinator_id: ID2, id_parcela: 'TST-0002', uat3: 'TST', nume: '=HYPERLINK("x")' },
    ], h)
    expect(csv.startsWith('﻿')).toBe(true)
    const linii = csv.slice(1).trim().split('\r\n')
    expect(linii[0]).toBe('ID parcelă;UAT;Deținător;SMS trimise;SMS livrate;SMS eșuate;SMS în curs;Ultima stare;Ultima trimitere;Ultima livrare')
    expect(linii[1]).toBe('TST-0001;TST;"POPESCU; ION";2;1;0;0;trimis;04.11.2026;03.11.2026')
    expect(linii[2]).toBe(`TST-0002;TST;"'=HYPERLINK(""x"")";0;0;0;0;fără SMS;;`)
    expect(csv.toLowerCase()).not.toContain('telefon')
  })
})
