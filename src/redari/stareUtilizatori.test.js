import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
vi.mock('../lib/supabase.js', () => ({ supabase: {} }))
import { calculeazaStare, stariParcele, centralizatorParcele, STARI_INCHISE } from './stare.js'
import { parcelaAcoperitaA } from './pv.js'
import { centralizeaza, agregaDetinatori, filtreaza } from './notificari.js'
import { aplicaRol, potrivesteRol, calitatiRol } from './rol.js'
import { agregaCentralizator } from './sesiune.js'
import { foaieCentralizator, randuriRegistru } from './exportXlsx.js'
import { citesteDateExport } from './ui/ExportEcran.jsx'

const dry = readFileSync('supabase/tests/20261131d_redari_stare_utilizatori_dryrun.sql', 'utf8')
const cazuri = [...dry.matchAll(/^ \('([a-z_]+)','(\[[^\n]*\])'::jsonb,(\d+),'([A-Z_]+)',(true|false)\)/gm)]
  .map(([, nume, date, observat, stare, acoperita]) => ({ nume, date: JSON.parse(date), observat: Number(observat), stare, acoperita: acoperita === 'true' }))
function fixture(caz) {
  const detinatori = caz.date.map((s, i) => ({ id: 'd' + i, calitate: s.actual ?? s.rol, sters_la: s.sters ? '2026-11-05' : null }))
  const pvs = caz.date.flatMap((s, i) => s.pv ? [{ tip: 'A', stare: s.pv, parcela_id: caz.nume, detinator_id: 'd' + i, calitate_semnatar: s.rol }] : [])
  if (['pv_b', 'pv_b_anulat', 'acoperire_peste_b_vechi'].includes(caz.nume)) pvs.push({ tip: 'B', parcela_id: caz.nume, stare: caz.nume === 'pv_b_anulat' ? 'anulat' : 'generat' })
  const parcela_acoperita_a = parcelaAcoperitaA({ parcela: { id: caz.nume }, detinatori, pvs })
  const randuri = detinatori.flatMap((d, i) => d.sters_la ? [] : [{ ...d, detinator_id: d.id, parcela_id: caz.nume, uat_id: 'uat',
    ...calculeazaStare({ calitate: d.calitate, adresa_cunoscuta: Object.hasOwn(caz.date[i], 'adresa_cunoscuta') ? caz.date[i].adresa_cunoscuta : false, parcela_acoperita_a,
      pvs: pvs.filter(p => p.tip === 'B' || p.detinator_id === d.id),
      raspunsuri: caz.date[i].raspuns ? [{ optiune: caz.date[i].raspuns, data: '2026-11-05T10:00:00Z' }] : [] }) }])
  return { randuri, parcela_acoperita_a }
}
describe('PR2: același tabel de cazuri juridice în SQL DRY și JS (L19/L25)', () => {
  it('18 cazuri independente, inclusiv contact absent null', () => expect(cazuri).toHaveLength(18))
  it.each(cazuri)('$nume => $stare', caz => {
    const { randuri, parcela_acoperita_a } = fixture(caz)
    expect(parcela_acoperita_a).toBe(caz.acoperita)
    expect(randuri.find(r => r.detinator_id === 'd' + caz.observat)?.stare).toBe(caz.stare)
  })
  it('Q5: SQL și JS așteaptă 18 parcele, 9 închise, 50%, cu 34 perechi în registru', () => {
    const randuri = cazuri.flatMap(c => fixture(c).randuri)
    expect(randuri).toHaveLength(34)
    const parcele = stariParcele(randuri)
    expect(parcele).toHaveLength(18)
    expect(parcele.filter(r => STARI_INCHISE.includes(r.stare))).toHaveLength(9)
    const cent = centralizatorParcele(randuri)
    expect(agregaCentralizator(cent).at(-1)).toMatchObject({ total: 18, inchise: 9, procent: 50 })
    expect(foaieCentralizator(cent, [{ id: 'uat', nume: 'FICTIV' }]).at(-1)).toEqual(['% parcele inchise (PV A sau B)', 50, 50])
    expect(centralizeaza(agregaDetinatori({ randuri })).total).toMatchObject({ total: 34, parcele: 18, inchise: 9 })
  })
  it('acoperirea A depășește B vechi, trimiterea și obiecțiile; semnătura proprie rămâne proprie', () => {
    const date = { parcela_acoperita_a: true, pvs: [{ tip: 'B', stare: 'generat' }, { tip: 'A', stare: 'trimis_spre_semnare' }], raspunsuri: [{ optiune: 'constatare_teren' }] }
    expect(calculeazaStare(date)).toEqual({ stare: 'PV_A_ACOPERIT_PARCELA', ordine: 1 })
    expect(calculeazaStare({ ...date, pvs: [{ tip: 'A', stare: 'semnat' }] }).stare).toBe('PV_A_SEMNAT')
    for (const flag of [null, undefined, false, 'true']) expect(calculeazaStare({ parcela_acoperita_a: flag, adresa_cunoscuta: true }).stare).toBe('DE_CONVOCAT')
  })
  it('stări / identități necunoscute nu devin zero sau închise', () => {
    expect(() => stariParcele([{ parcela_id: 'p', uat_id: 'u', stare: 'necunoscut' }])).toThrow('necunoscută')
    expect(() => stariParcele([{ stare: 'DE_CONVOCAT' }])).toThrow('incompletă')
  })
})

describe('rol canonic: Registru, Notificări și XLSX', () => {
  it.each(['proprietar', 'coproprietar', 'mostenitor', 'neidentificat', 'utilizator', 'arendas'])('%s: aceleași calități în SQL și filtrarea locală', calitate => {
    const detinator = { calitate }
    const rol = ['utilizator', 'arendas'].includes(calitate) ? 'utilizator' : 'proprietar'
    const q = { in: vi.fn().mockReturnThis() }
    expect(aplicaRol(q, rol)).toBe(q)
    expect(q.in).toHaveBeenCalledWith('calitate', calitatiRol(rol))
    expect(potrivesteRol(detinator, rol)).toBe(true)
    expect(filtreaza([detinator], { rol })).toHaveLength(1)
    expect(randuriRegistru([{ detinator }], { rol })).toHaveLength(1)
    const opus = rol === 'utilizator' ? 'proprietar' : 'utilizator'
    expect(filtreaza([detinator], { rol: opus })).toEqual([])
    expect(randuriRegistru([{ detinator }], { rol: opus })).toEqual([])
  })
  it('rol invalid refuzat; Toți include toate rolurile', () => {
    expect(() => calitatiRol('necunoscut')).toThrow('Rol necunoscut')
    expect(() => filtreaza([], { rol: 'necunoscut' })).toThrow('Rol necunoscut')
    expect(() => randuriRegistru([], { rol: 'necunoscut' })).toThrow('Rol necunoscut')
    expect(potrivesteRol({ calitate: 'utilizator' })).toBe(true)
    const q = { in: vi.fn() }
    expect(aplicaRol(q)).toBe(q)
    expect(q.in).not.toHaveBeenCalled()
  })
})

// Query builder cu filtre reale, liste fictive și paginare până la gol (fără rețea).
function client(tabele) {
  const apeluri = []
  return { apeluri, from(t) {
    let filtre = [], cursor = false
    const q = {}
    for (const op of ['select', 'eq', 'is', 'not', 'neq', 'in', 'order', 'or']) q[op] = (...args) => {
      apeluri.push([t, op, ...args])
      if (op === 'eq' || op === 'is') filtre.push(r => (r[args[0]] ?? null) === args[1])
      if (op === 'neq') filtre.push(r => r[args[0]] !== args[1])
      if (op === 'in') filtre.push(r => args[1].includes(r[args[0]]))
      if (op === 'or') cursor = true
      return q
    }
    q.range = async () => ({ data: cursor ? [] : (tabele[t] || []).filter(r => filtre.every(f => f(r))), error: null })
    return q
  } }
}
function exportFixture() {
  const randuri = [
    { parcela_id: 'p', detinator_id: 'd1', uat_id: 'u', calitate: 'proprietar', stare: 'PV_A_ACOPERIT_PARCELA' },
    { parcela_id: 'p', detinator_id: 'd2', uat_id: 'u', calitate: 'utilizator', stare: 'PV_A_SEMNAT' },
    { parcela_id: 'q', detinator_id: 'd3', uat_id: 'u', calitate: 'arendas', stare: 'DE_CONVOCAT' },
  ].map(r => ({ ...r, proiect_id: 'proiect' }))
  return { red_uat: [{ id: 'u', nume: 'FICTIV', proiect_id: 'proiect' }],
    red_v_stare_parcela: randuri, red_v_centralizator_uat: centralizatorParcele(randuri),
    red_v_parcele: [{ id: 'p', uat_id: 'u', proiect_id: 'proiect' }, { id: 'q', uat_id: 'u', proiect_id: 'proiect' }],
    red_detinatori: randuri.map(r => ({ id: r.detinator_id, parcela_id: r.parcela_id, calitate: r.calitate, nume: 'FICTIV ' + r.detinator_id })),
  }
}
it.each([['toti', 3, 2, 50], ['proprietar', 1, 1, 100], ['utilizator', 2, 2, 50]])('XLSX %s: filtrare reală și centralizator pe parcele', async (rol, perechi, parcele, procent) => {
  const c = client(exportFixture())
  const r = await citesteDateExport(c, 'proiect', 'TGZ', () => true, rol)
  expect(r.numar).toBe(perechi)
  expect(r.centralizator.at(-2)).toEqual(['TOTAL parcele', parcele, parcele])
  expect(r.centralizator.at(-1)).toEqual(['% parcele inchise (PV A sau B)', procent, procent])
  const a = await citesteDateExport(client(exportFixture()), 'proiect', 'centralizator', () => true, rol)
  expect(a.centralizator).toEqual(r.centralizator)
  expect(a).not.toHaveProperty('registru')
})
it('XLSX refuză rol schimbat între citirea deținătorilor și stări', async () => {
  const tabele = exportFixture()
  tabele.red_detinatori[0].calitate = 'utilizator'
  await expect(citesteDateExport(client(tabele), 'proiect', 'intern', () => true)).rejects.toThrow('schimbat')
})
it('Q5: filtrul nu închide parcela dacă ascunde coproprietarul încă nesemnat (inclusiv rol schimbat)', async () => {
  const randuri = [
    { parcela_id: 'p', detinator_id: 'd1', uat_id: 'u', calitate: 'utilizator', stare: 'PV_A_SEMNAT' },
    { parcela_id: 'p', detinator_id: 'd2', uat_id: 'u', calitate: 'coproprietar', stare: 'DE_CONVOCAT' },
  ].map(r => ({ ...r, proiect_id: 'proiect' }))
  const agregate = agregaDetinatori({ randuri })
  const filtrate = filtreaza(agregate, { rol: 'utilizator' })
  expect(filtrate).toHaveLength(1)
  expect(centralizeaza(filtrate).total).toMatchObject({ parcele: 1, inchise: 0, procent_inchise: 0 })
  const tabele = exportFixture()
  tabele.red_v_stare_parcela = randuri
  tabele.red_v_centralizator_uat = centralizatorParcele(randuri)
  tabele.red_v_parcele = tabele.red_v_parcele.slice(0, 1)
  tabele.red_detinatori = randuri.map(r => ({ id: r.detinator_id, parcela_id: 'p', calitate: r.calitate, nume: 'FICTIV' }))
  const r = await citesteDateExport(client(tabele), 'proiect', 'TGZ', () => true, 'utilizator')
  expect(r.centralizator.at(-1)).toEqual(['% parcele inchise (PV A sau B)', 0, 0])
})

it.each([[null, 'FARA_ADRESA_AFISARE'], [undefined, 'FARA_ADRESA_AFISARE'], [false, 'FARA_ADRESA_AFISARE'], [true, 'DE_CONVOCAT']])('contact %s: paritate cu coalesce SQL', (adresa_cunoscuta, stare) => {
  expect(calculeazaStare({ calitate: 'proprietar', adresa_cunoscuta })).toEqual({ stare, ordine: stare === 'DE_CONVOCAT' ? 12 : 11 })
  expect(calculeazaStare({ calitate: 'neidentificat', adresa_cunoscuta }).stare).toBe('NEIDENTIFICAT_AFISARE')
  expect(calculeazaStare({ adresa_cunoscuta, pvs: [{ tip: 'A', stare: 'semnat' }] }).stare).toBe('PV_A_SEMNAT')
})
