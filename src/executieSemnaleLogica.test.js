// Logica ecranului „🔔 Semnale” (Execuție, 20270106a): tranzițiile (aceeași listă ca în BD), filtrele, sortarea, parametrii RPC-ului, validarea.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  TRANZITII, STARI, tranzitiePermisa, stariUrmatoare, motivObligatoriu, dovadaSauActiuneObligatorie, zilePanaLa, filtreaza, sorteaza, rezumat, dovadaText, eLink,
  responsabilText, parametriStare, validareStare, clasificaRaspunsStare, fmtZi,
} from './executieSemnaleLogica.js'
import { PILOT } from '../scripts/pglite/executie_semnale_pilot.mjs'

const S = (id, extra = {}) => ({
  id, proiect_id: 1, proiect_cod: 'P1', flux: 'lipsuri', tip: 'termen_apropiat', obiect: 'contract:termen', gravitate: 'atentie', titlu: `Semnal ${id}`,
  detalii: null, constatare: 'constatat', surse_consultate: [], dovada_sursa: 'camp_erp', dovada_data: '2026-11-21', dovada_fragment: 'data_termen = 2026-12-11',
  dovada_ref: 'executie_proiecte.data_termen', termen: null, termen_baza: null, termen_confirmat: null, propunere: null, responsabil_employee_id: null,
  stare: 'nou', versiune: 1, detectat_la: '2026-11-21T20:00:00+00:00', ...extra,
})

describe('tranzițiile de stare (L19: aceeași listă ca blocul TRANZITII din migrarea 20270106a)', () => {
  it('blocul din migrare = TRANZITII', () => {
    const mig = readFileSync(new URL('../supabase/migrations/20270106a_executie_semnale.sql', import.meta.url), 'utf8').replace(/\r/g, '')
    const bloc = mig.slice(mig.indexOf('-- TRANZITII-START'), mig.indexOf('-- TRANZITII-END'))
    const dinSql = [...bloc.matchAll(/\('(om|agent)', '([a-z_]+)', '([a-z_]+)'\)/g)].map(m => [m[1], m[2], m[3]])
    expect(dinSql).toEqual(TRANZITII)
    expect(dinSql.length).toBe(14)
  })
  it('omul: din nou în orice stare de lucru / finală; din închis doar înapoi în lucru; niciodată „nou”', () => {
    expect(stariUrmatoare('nou')).toEqual(['in_lucru', 'asteapta_informatii', 'rezolvat', 'respins'])
    expect(stariUrmatoare('in_lucru')).toEqual(['asteapta_informatii', 'rezolvat', 'respins'])
    expect(stariUrmatoare('asteapta_informatii')).toEqual(['in_lucru', 'rezolvat', 'respins'])
    expect(stariUrmatoare('rezolvat')).toEqual(['in_lucru'])
    expect(stariUrmatoare('respins')).toEqual(['in_lucru'])
    for (const s of STARI) expect(tranzitiePermisa(s, 'nou', 'om')).toBe(false)
    expect(tranzitiePermisa('respins', 'asteapta_informatii', 'om')).toBe(false)
  })
  it('agentul: doar redeschiderea (închis -> nou)', () => {
    expect(tranzitiePermisa('rezolvat', 'nou', 'agent')).toBe(true)
    expect(tranzitiePermisa('respins', 'nou', 'agent')).toBe(true)
    expect(tranzitiePermisa('nou', 'in_lucru', 'agent')).toBe(false)
    expect(tranzitiePermisa('in_lucru', 'nou', 'agent')).toBe(false)
  })
  it('motivul e obligatoriu la rezolvare / respingere și la redeschidere', () => {
    expect(motivObligatoriu('nou', 'respins')).toBe(true)
    expect(motivObligatoriu('in_lucru', 'rezolvat')).toBe(true)
    expect(motivObligatoriu('respins', 'in_lucru')).toBe(true)
    expect(motivObligatoriu('nou', 'in_lucru')).toBe(false)
    expect(motivObligatoriu('in_lucru', 'in_lucru')).toBe(false)
    expect(motivObligatoriu('respins', 'respins')).toBe(false)   // starea neschimbată: serverul păstrează motivul existent
  })
})

describe('filtre, sortare, rezumat', () => {
  const L = [
    S(1, { termen: '2026-12-11', gravitate: 'atentie' }), S(2, { termen: '2026-11-30', gravitate: 'info', flux: 'corespondenta' }),
    S(3, { termen: null, gravitate: 'critic', stare: 'in_lucru', titlu: 'Polița CAR expiră' }), S(4, { termen: '2026-11-30', gravitate: 'critic', stare: 'respins' }),
    S(5, { termen: null, gravitate: 'info', stare: 'rezolvat', detectat_la: '2026-11-22T06:00:00+00:00' }),
  ]
  it('după termen: termenele întâi (cel mai apropiat primul), la egalitate gravitatea, apoi cele fără termen după gravitate', () => {
    expect(sorteaza(L).map(r => r.id)).toEqual([4, 2, 1, 3, 5])
  })
  it('după gravitate: critic > atenție > info, apoi termenul', () => {
    expect(sorteaza(L, 'gravitate').map(r => r.id)).toEqual([4, 3, 1, 2, 5])
  })
  it('doarDeschise ascunde rezolvat / respins; listele goale = toate; textul caută fără diacritice', () => {
    expect(filtreaza(L, { doarDeschise: true }).map(r => r.id).sort()).toEqual([1, 2, 3])
    expect(filtreaza(L, { gravitati: ['critic'] }).map(r => r.id).sort()).toEqual([3, 4])
    expect(filtreaza(L, { stari: ['respins', 'rezolvat'] }).map(r => r.id).sort()).toEqual([4, 5])
    expect(filtreaza(L, { fluxuri: ['corespondenta'] }).map(r => r.id)).toEqual([2])
    expect(filtreaza(L, { text: 'polita car' }).map(r => r.id)).toEqual([3])
    expect(filtreaza(L, { text: 'P1' }).length).toBe(5)
    expect(filtreaza(L, {}).length).toBe(5)
  })
  it('rezumatul numără deschisele pe gravitate și toate pe stare', () => {
    expect(rezumat(L)).toEqual({ total: 5, deschise: 3, critic: 1, atentie: 1, info: 1, stari: { nou: 2, in_lucru: 1, respins: 1, rezolvat: 1 } })
    expect(rezumat([])).toEqual({ total: 0, deschise: 0, critic: 0, atentie: 0, info: 0, stari: {} })
  })
  it('zile până la termen (Europe/Bucharest, pe zile calendaristice)', () => {
    expect(zilePanaLa('2026-12-11', '2026-11-21')).toBe(20)
    expect(zilePanaLa('2026-11-20', '2026-11-21')).toBe(-1)
    expect(zilePanaLa(null, '2026-11-21')).toBeNull()
    expect(fmtZi('2026-12-11')).toBe('11.12.2026')
  })
  it('textul dovezii deosebește „negăsit în surse” (cu OBLIGAȚIA care cere documentul) de „câmp lipsă” și de „constatat”', () => {
    expect(dovadaText(S(1, { constatare: 'negasit_in_surse', surse_consultate: ['NAS', 'mail'], dovada_sursa: 'document', dovada_data: '2026-09-18', dovada_fragment: 'art. 8: GBE în max. 15 zile' })))
      .toBe('Negăsit în sursele consultate: NAS, mail · obligația: document · 18.09.2026 · art. 8: GBE în max. 15 zile')
    expect(dovadaText(S(1, { constatare: 'negasit_in_surse', surse_consultate: ['NAS'], dovada_sursa: null, dovada_data: null, dovada_fragment: null }))).toBe('Negăsit în sursele consultate: NAS · obligația: —')   // rând vechi / incomplet: lipsa se vede
    expect(dovadaText(S(1, { constatare: 'camp_lipsa', dovada_ref: 'executie_proiecte.nr_contract', dovada_data: null, dovada_fragment: null }))).toBe('Câmp gol în ERP: executie_proiecte.nr_contract')
    expect(dovadaText(S(1, { constatare: 'camp_lipsa', dovada_ref: 'sites.proiect_id', dovada_data: '2026-11-22', dovada_fragment: 'niciun șantier legat' }))).toBe('Câmp gol în ERP: sites.proiect_id · 22.11.2026 · niciun șantier legat')
    expect(dovadaText(S(1))).toBe('câmp ERP · 21.11.2026 · data_termen = 2026-12-11')
    expect(eLink('https://x.y/z')).toBe(true); expect(eLink('Z:/Oferte/x.pdf')).toBe(false)
  })
  it('responsabilul: propus de agent / stabilit de om / „fără responsabil” ales de om / nimic decis', () => {
    const nume = { 10: 'POPESCU ION' }
    expect(responsabilText(S(1, { responsabil_employee_id: 10, responsabil_sursa: 'agent' }), nume)).toBe('POPESCU ION (propus de agent)')
    expect(responsabilText(S(1, { responsabil_employee_id: 10, responsabil_sursa: 'om' }), nume)).toBe('POPESCU ION (stabilit de om)')
    expect(responsabilText(S(1, { responsabil_employee_id: 11, responsabil_sursa: 'om' }), nume)).toBe('angajat #11 (stabilit de om)')
    expect(responsabilText(S(1, { responsabil_employee_id: null, responsabil_sursa: 'om' }), nume)).toBe('fără responsabil (stabilit de om)')
    expect(responsabilText(S(1, { responsabil_employee_id: null, responsabil_sursa: null }), nume)).toBe('—')
    expect(responsabilText(null)).toBe('—')
  })
  it('cele 13 semnale ale pilotului (sintetizate) se afișează cu dovada completă: „negăsit” arată și obligația, nu doar sursele', () => {
    const pilot = PILOT(42)
    expect(pilot).toHaveLength(13)
    expect(pilot.map(s => s.constatare).sort()).toEqual(['camp_lipsa', 'camp_lipsa', 'camp_lipsa', 'camp_lipsa', 'camp_lipsa', 'camp_lipsa', 'constatat', 'constatat', 'negasit_in_surse', 'negasit_in_surse', 'negasit_in_surse', 'negasit_in_surse', 'negasit_in_surse'])
    for (const s of pilot) {
      const t = dovadaText({ ...s, id: 1 })
      expect(t).not.toMatch(/—/)                                           // nicio piesă lipsă în afișare
      if (s.constatare === 'negasit_in_surse') { expect(t).toMatch(/^Negăsit în sursele consultate: .+ · obligația: document · \d\d\.\d\d\.\d{4} · .+/); expect(t).toContain(s.dovada_fragment) }
      if (s.constatare === 'camp_lipsa') expect(t).toMatch(/^Câmp gol în ERP: .+ · 22\.11\.2026 · .+/)
      if (s.termen) expect(s.termen_confirmat !== true || !!s.termen_baza).toBe(true)
    }
    // fără date personale / valori: niciun nume de persoană (NUME PRENUME cu majuscule), nicio sumă în lei
    const tot = JSON.stringify(pilot)
    expect(tot).not.toMatch(/\b[A-ZĂÂÎȘȚ]{3,} [A-ZĂÂÎȘȚ][a-zăâîșț]+\b/)
    expect(tot).not.toMatch(/\d[\d.]*,\d\d lei/)
  })
})

describe('formularul de stare → RPC', () => {
  const r = S(7, { stare: 'in_lucru', versiune: 3, responsabil_employee_id: 11 })
  it('parametrii: id + versiunea rândului (CAS), textele curățate, responsabilul doar cu bifa', () => {
    expect(parametriStare(r, { stare: 'respins', motiv: '  nu e cazul ', dovada: '', actiuneRef: ' TKT-1 ', responsabil: '14', schimbaResponsabil: false })).toEqual({
      p_id: 7, p_versiune: 3, p_stare: 'respins', p_motiv: 'nu e cazul', p_dovada: null, p_actiune_ref: 'TKT-1', p_responsabil: null, p_schimba_responsabil: false,
    })
    expect(parametriStare(r, { stare: '', motiv: '', dovada: '', actiuneRef: '', responsabil: '14', schimbaResponsabil: true })).toMatchObject({ p_stare: null, p_responsabil: 14, p_schimba_responsabil: true })
    expect(parametriStare(r, { stare: 'in_lucru', motiv: '' })).toMatchObject({ p_stare: null, p_motiv: null })   // aceeași stare = NULL (serverul o păstrează)
    expect(parametriStare(r, { stare: null, responsabil: '', schimbaResponsabil: true })).toMatchObject({ p_responsabil: null, p_schimba_responsabil: true })
  })
  it('validarea: tranziție nepermisă, motiv lipsă, rezolvare fără dovadă / acțiune, responsabil invalid', () => {
    expect(validareStare(r, { stare: 'nou' })).toMatch(/nu se poate trece/)
    expect(validareStare(r, { stare: 'respins', motiv: '  ' })).toMatch(/Motivul e obligatoriu/)
    expect(validareStare(r, { stare: 'respins', motiv: 'x' })).toBeNull()
    expect(validareStare(r, { stare: 'asteapta_informatii' })).toBeNull()
    expect(validareStare(r, { stare: 'in_lucru', schimbaResponsabil: true, responsabil: 'abc' })).toMatch(/angajat/)
    expect(validareStare(S(8, { stare: 'respins' }), { stare: 'in_lucru' })).toMatch(/Motivul e obligatoriu/)
    // rezolvarea: motiv + dovada SAU acțiunea (aceeași regulă ca RPC-ul / CHECK-ul)
    expect(dovadaSauActiuneObligatorie('in_lucru', 'rezolvat')).toBe(true)
    expect(dovadaSauActiuneObligatorie('rezolvat', 'rezolvat')).toBe(false)   // starea neschimbată: serverul păstrează dovada existentă
    expect(dovadaSauActiuneObligatorie('in_lucru', 'respins')).toBe(false)
    expect(validareStare(r, { stare: 'rezolvat', motiv: 'gata' })).toMatch(/dovada rezolvării/)
    expect(validareStare(r, { stare: 'rezolvat', motiv: 'gata', dovada: '  ', actiuneRef: ' ' })).toMatch(/dovada rezolvării/)
    expect(validareStare(r, { stare: 'rezolvat', motiv: 'gata', dovada: 'AA 3' })).toBeNull()
    expect(validareStare(r, { stare: 'rezolvat', motiv: 'gata', actiuneRef: 'TKT-1' })).toBeNull()
    expect(validareStare(r, { stare: 'respins', motiv: 'nu e cazul' })).toBeNull()
    // confirmarea aceluiași responsabil e o cerere validă (nu „nimic de schimbat” local)
    expect(validareStare(r, { stare: 'in_lucru', schimbaResponsabil: true, responsabil: '11' })).toBeNull()
    expect(validareStare(r, { stare: 'in_lucru', schimbaResponsabil: true, responsabil: '' })).toBeNull()
  })
})

describe('răspunsul RPC-ului clasificat (L05: doar 4xx = eșec sigur; restul = necunoscut, se reîncarcă)', () => {
  const sem = { id: 7, stare: 'in_lucru', versiune: 4 }
  it('ok / conflict', () => {
    expect(clasificaRaspunsStare({ data: { ok: true, semnal: sem }, error: null, status: 200 })).toEqual({ tip: 'ok', semnal: sem })
    expect(clasificaRaspunsStare({ data: { ok: false, motiv: 'conflict', semnal: sem }, error: null, status: 200 })).toEqual({ tip: 'conflict', semnal: sem })
  })
  it('refuz SIGUR doar cu status 4xx (fără 408)', () => {
    const e = { code: '42501', message: 'semnale: nu ai drept' }
    expect(clasificaRaspunsStare({ data: null, error: e, status: 403 })).toEqual({ tip: 'refuz', eroare: e })
    expect(clasificaRaspunsStare({ data: null, error: { code: '22023', message: 'cere un motiv' }, status: 400 }).tip).toBe('refuz')
    expect(clasificaRaspunsStare({ data: null, error: e, status: 408 }).tip).toBe('necunoscut')
  })
  it('necunoscut: rețea (status 0), 5xx, status lipsă, corp neașteptat, fără răspuns', () => {
    expect(clasificaRaspunsStare({ data: null, error: { message: 'TypeError: Failed to fetch' }, status: 0 })).toMatchObject({ tip: 'necunoscut', detaliu: 'status 0' })
    expect(clasificaRaspunsStare({ data: null, error: { message: 'gateway' }, status: 503 })).toMatchObject({ tip: 'necunoscut', detaliu: 'status 503' })
    expect(clasificaRaspunsStare({ data: null, error: { code: '42501', message: 'x' } })).toMatchObject({ tip: 'necunoscut', detaliu: 'status lipsă' })   // fără status = nu e refuz sigur
    expect(clasificaRaspunsStare({ data: { ceva: 1 }, error: null, status: 200 }).tip).toBe('necunoscut')
    expect(clasificaRaspunsStare({ data: { ok: true }, error: null, status: 200 }).tip).toBe('necunoscut')      // ok fără semnal
    expect(clasificaRaspunsStare({ data: null, error: null, status: 200 }).tip).toBe('necunoscut')
    expect(clasificaRaspunsStare(undefined).tip).toBe('necunoscut')
  })
})
