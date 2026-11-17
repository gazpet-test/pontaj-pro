// FAN Courier: construirea AWB-ului dintr-un plic, hash-ul aprobat, răspunsurile simulate (creare în loturi de ≤ 100, urmărire,
// confirmări, evenimente, borderou, etichetă A6), poarta funcției edge (transport oprit = 423 fără niciun apel), ecranul (pași, lot de test),
// pachetul de documente pe lot și returul în PV B. Date fictive. Referința formelor: docs/redari/FANCOURIER_INTEGRARE.md §1 (documentația
// FAN), nu codul testat (L25). Unde documentul spune „de citit pe un răspuns real”, testele cer „de verificat de om”, nu succes.
import { describe, it, expect, vi } from 'vitest'
vi.mock('../lib/supabase.js', () => ({ supabase: {} }))
import { webcrypto } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { construiestePlicFan, telefonFan, hashPlicFan, jsonCanonic, interpreteazaRaspunsAwb, interpreteazaRaspunsLot, rezumatUrmarireFan, CONFIG_FAN_PLIC,
  imparteInBucati, MAX_PE_CERERE, FORMAT_ETICHETA, LIMITA_LOT_PILOT_IMPLICITA, interpreteazaUrmarire, interpreteazaConfirmari, comparaEvenimente, cautaInBorderou,
  caleEticheta, caleListaAwb, dataEvenimentFan, EVENIMENTE_FAN, pregatestePlicuriFan, estePdf, inBase64, LIMITE_FAN, contactPePlic } from '../../supabase/functions/_shared/redariFan.mjs'
import { raspundeFan, TRANSPORT_REAL_ACTIV, ACTIUNI_FAN } from '../../supabase/functions/_shared/redariFanHandler.mjs'
import { executaActiuneFan, MAX_BUCATI_PE_APEL, citesteToate } from '../../supabase/functions/_shared/redariFanTransport.mjs'
import { stariPasi, stareMarcaj, PASI_FAN, MESAJ_TRANSPORT_OPRIT, csvBorderouFan, prefixLot, titluLot } from './fanLot.js'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import FanAwbPrevizualizare from './ui/FanAwbPrevizualizare.jsx'
import { planPachetPlicuire, ordineConvocari } from './plicuri.js'
import { genereazaPvB } from './pv.js'

const DOC = readFileSync('docs/redari/FANCOURIER_INTEGRARE.md', 'utf8')
const MIG = readFileSync('supabase/migrations/20261212a_redari_fan_awb.sql', 'utf8')
const plic = { nr_plic: 'PL-TST-0001', destinatar_nume: 'PERSOANA FICTIVA' }
const contact = { telefon: '0700 000 001', adresa_strada: 'Str. Fictivă nr. 1', adresa_sat: 'Sat Fictiv', adresa_comuna: 'Comuna Fictivă', adresa_judet: 'Prahova', cod_postal: '100000' }

describe('construiestePlicFan', () => {
  it('plic complet → câmpurile obligatorii din documentația FAN', () => {
    const r = construiestePlicFan({ plic, contact, proiectCod: 'TEST-RAZVAN' })
    expect(r.ok).toBe(true); expect(r.probleme).toEqual([])
    const s = r.shipment
    expect(s.info).toMatchObject({ service: 'Standard', payment: 'sender', weight: 1, packages: { parcel: 0, envelope: 1 }, costCenter: 'TEST-RAZVAN', options: ['B'] })
    expect(s.info.dimensions).toEqual({ length: 32, width: 24, height: 1 })
    expect(s.recipient).toEqual({ name: 'PERSOANA FICTIVA', contactPerson: 'PERSOANA FICTIVA', phone: '0700000001',
      address: { county: 'Prahova', locality: 'Sat Fictiv', street: 'Str. Fictivă nr. 1', zipCode: '100000' } })
  })
  it('în câmpurile libere intră doar numărul plicului (referința de pe etichetă, fără nume / adresă)', () => {
    const s = construiestePlicFan({ plic, contact, proiectCod: 'TEST-RAZVAN' }).shipment
    expect(s.info.content).toBe('PL-TST-0001'); expect(s.info.observation).toBe('PL-TST-0001')
    expect('PL-TST-0001'.length).toBeLessThanOrEqual(LIMITE_FAN.content)
  })
  it('fără sat → localitatea = comuna', () => {
    expect(construiestePlicFan({ plic, contact: { ...contact, adresa_sat: ' ' }, proiectCod: 'X' }).shipment.recipient.address.locality).toBe('Comuna Fictivă')
  })
  it('telefon lipsă → blocat, cu motiv (obligatoriu la FAN)', () => {
    const r = construiestePlicFan({ plic, contact: { ...contact, telefon: null }, proiectCod: 'X' })
    expect(r.ok).toBe(false); expect(r.probleme.join(' ')).toMatch(/telefonul destinatarului lipsește/)
  })
  it('nume peste 50 de caractere → problemă, nu tăiere tacită', () => {
    const lung = 'A'.repeat(51)
    const r = construiestePlicFan({ plic: { ...plic, destinatar_nume: lung }, contact, proiectCod: 'X' })
    expect(r.ok).toBe(false); expect(r.shipment.recipient.name).toBe(lung)
  })
  it('județ / stradă lipsă, cod poștal greșit, plic invalid → toate numite', () => {
    const r = construiestePlicFan({ plic: { ...plic, nr_plic: 'X' }, contact: { ...contact, adresa_judet: '', adresa_strada: '', cod_postal: '12' }, proiectCod: '' })
    expect(r.probleme).toEqual(expect.arrayContaining(['numărul plicului lipsește sau e invalid', 'județul lipsește', 'strada lipsește', 'codul poștal nu are 6 cifre', 'codul proiectului lipsește']))
  })
  it('cod de proiect peste 40 de caractere → problemă, fără tăiere (Jakarinos r1 P2)', () => {
    const r = construiestePlicFan({ plic, contact, proiectCod: 'X'.repeat(41) })
    expect(r.ok).toBe(false); expect(r.shipment.info.costCenter).toHaveLength(41)
    expect(construiestePlicFan({ plic, contact, proiectCod: 'X'.repeat(40) }).ok).toBe(true)
  })
  it('limitele exacte FAN: nume 50 / telefon 15 cifre trec, 51 nu', () => {
    expect(construiestePlicFan({ plic: { ...plic, destinatar_nume: 'A'.repeat(50) }, contact, proiectCod: 'X' }).ok).toBe(true)
    expect(construiestePlicFan({ plic, contact: { ...contact, telefon: '+' + '4'.repeat(15) }, proiectCod: 'X' }).ok).toBe(true)
  })
  it('configurația implicită e înghețată', () => { expect(Object.isFrozen(CONFIG_FAN_PLIC)).toBe(true) })
})

describe('telefonFan', () => {
  it.each([['0700 000 001', '0700000001'], ['+40-700.000.001', '+40700000001'], ['', null], ['abc', null], ['123', null]])('%s → %s', (v, r) => expect(telefonFan(v)).toBe(r))
})

describe('hash-ul aprobat', () => {
  it('chei în altă ordine → același JSON canonic și hash; o literă schimbată → alt hash', async () => {
    expect(jsonCanonic({ b: 1, a: { d: 2, c: [1, { f: 1, e: 2 }] } })).toBe(jsonCanonic({ a: { c: [1, { e: 2, f: 1 }], d: 2 }, b: 1 }))
    const s = construiestePlicFan({ plic, contact, proiectCod: 'X' }).shipment
    const h1 = await hashPlicFan(s, webcrypto.subtle)
    expect(h1).toMatch(/^[0-9a-f]{64}$/)
    expect(await hashPlicFan(JSON.parse(JSON.stringify(s)), webcrypto.subtle)).toBe(h1)
    const s2 = construiestePlicFan({ plic, contact: { ...contact, adresa_strada: 'Str. Fictivă nr. 2' }, proiectCod: 'X' }).shipment
    expect(await hashPlicFan(s2, webcrypto.subtle)).not.toBe(h1)
  })
})

describe('limita de 100 pe solicitare (doc §1)', () => {
  it('constanta = cifra din documentație (creare, urmărire, confirmări)', () => {
    expect(DOC).toMatch(/1…100 de expedieri pe solicitare/)
    expect(DOC).toMatch(/maximum 100 de AWB-uri pe solicitare/)
    expect(MAX_PE_CERERE).toBe(100)
  })
  it('250 → 100 + 100 + 50, în ordine; 100 → o bucată; mărime în afara 1..100 = eroare', () => {
    const l = Array.from({ length: 250 }, (_, i) => i)
    const b = imparteInBucati(l)
    expect(b.map(x => x.length)).toEqual([100, 100, 50]); expect(b.flat()).toEqual(l)
    expect(imparteInBucati(l.slice(0, 100)).length).toBe(1)
    expect(() => imparteInBucati(l, 101)).toThrow(); expect(() => imparteInBucati(l, 0)).toThrow()
  })
  it('căile de urmărire / confirmări / etichetă refuză peste 100 de AWB-uri', () => {
    const a = Array.from({ length: 101 }, (_, i) => String(1000000000 + i))
    expect(() => caleListaAwb('/reports/awb/tracking', { clientId: 'C', awbs: a })).toThrow()
    expect(() => caleEticheta({ clientId: 'C', awbs: a })).toThrow()
    expect(() => interpreteazaRaspunsLot(200, {}, 101)).toThrow()
  })
})

describe('interpreteazaRaspunsAwb / interpreteazaRaspunsLot (exemplul din documentație)', () => {
  const ok = { response: [{ awbNumber: 2228300120233, tariff: 29.7, vat: 5.64, packages: 1, errors: null }] }
  it('awbNumber + tarif → generat', () => expect(interpreteazaRaspunsAwb(200, ok)).toEqual({ stare: 'generat', awb: '2228300120233', tarif: 29.7, tva: 5.64 }))
  it('errors fără AWB → eroare (nimic plătit)', () => expect(interpreteazaRaspunsAwb(200, { response: [{ awbNumber: null, errors: { phone: ['invalid'] } }] }).stare).toBe('eroare'))
  it('5xx / timeout (0) / corp neparsabil → necunoscut, fără retry automat (L05)', () => {
    expect(interpreteazaRaspunsAwb(502, null).stare).toBe('necunoscut')
    expect(interpreteazaRaspunsAwb(0, null).stare).toBe('necunoscut')
    expect(interpreteazaRaspunsAwb(200, { status: 'success' }).stare).toBe('necunoscut')
    expect(interpreteazaRaspunsAwb(200, { response: [{ awbNumber: null, errors: null }] }).stare).toBe('necunoscut')
  })
  it('4xx → eroare deterministă', () => expect(interpreteazaRaspunsAwb(422, {}).stare).toBe('eroare'))
  it('Jakarinos r2: AWB numeric nesigur → necunoscut; AWB text lung → ok; costuri invalide → null', () => {
    expect(interpreteazaRaspunsAwb(200, { response: [{ awbNumber: 1234567890123456789 }] }).stare).toBe('necunoscut')
    expect(interpreteazaRaspunsAwb(200, { response: [{ awbNumber: '1234567890123456789', tariff: '29.70', vat: false }] })).toEqual({ stare: 'generat', awb: '1234567890123456789', tarif: 29.7, tva: null })
    expect(interpreteazaRaspunsAwb(200, { response: [{ awbNumber: 123456789, tariff: ' ', vat: [] }] })).toMatchObject({ tarif: null, tva: null })
    expect(interpreteazaRaspunsAwb(200, { response: [{ awbNumber: 123456789, tariff: '9'.repeat(400) }] }).tarif).toBeNull()
  })
  it('tarif / TVA lipsă → null (cost necunoscut), nu 0 (Jakarinos r1 P2)', () => {
    expect(interpreteazaRaspunsAwb(200, { response: [{ awbNumber: 123456789, tariff: null, vat: undefined }] })).toEqual({ stare: 'generat', awb: '123456789', tarif: null, tva: null })
  })
  it('RĂSPUNS PARȚIAL: 3 trimise, al doilea respins → generat / eroare / generat, pe poziție', () => {
    const r = interpreteazaRaspunsLot(200, { response: [{ awbNumber: '1000000001', tariff: 10 }, { awbNumber: null, errors: { phone: ['invalid'] } }, { awbNumber: '1000000003', tariff: 10 }] }, 3)
    expect(r.map(x => x.stare)).toEqual(['generat', 'eroare', 'generat']); expect(r[2].awb).toBe('1000000003')
  })
  it('alt număr de elemente decât cele trimise → TOATE necunoscut (asocierea nu se ghicește)', () => {
    const r = interpreteazaRaspunsLot(200, { response: [{ awbNumber: '1000000001' }, { awbNumber: '1000000002' }] }, 3)
    expect(r.map(x => x.stare)).toEqual(['necunoscut', 'necunoscut', 'necunoscut'])
  })
  it('același AWB pe două elemente → ambele necunoscut', () => {
    expect(interpreteazaRaspunsLot(200, { response: [{ awbNumber: '1000000001' }, { awbNumber: '1000000001' }] }, 2).map(x => x.stare)).toEqual(['necunoscut', 'necunoscut'])
  })
  it('4xx cu număr AWB în răspuns → necunoscut (nu „eroare”, AWB-ul poate exista); 429 → eroare cu motivul', () => {
    expect(interpreteazaRaspunsLot(422, { response: [{ awbNumber: '1000000001' }, { errors: ['x'] }] }, 2).map(x => x.stare)).toEqual(['necunoscut', 'necunoscut'])
    expect(interpreteazaRaspunsLot(429, null, 2)[0]).toMatchObject({ stare: 'eroare', motiv: expect.stringMatching(/429/) })
  })
})

describe('urmărire (GET /reports/awb/tracking) și retururi', () => {
  it('dataEvenimentFan: fără fus = ora României; cu Z → convertită; forme necunoscute → null (L17)', () => {
    expect(dataEvenimentFan('2026-11-10 15:00:00')).toEqual({ data: '2026-11-10', local: '2026-11-10 15:00:00' })
    expect(dataEvenimentFan('2026-11-10T22:30:00Z')).toEqual({ data: '2026-11-11', local: '2026-11-11 00:30:00' })   // noiembrie: UTC+2, peste miezul nopții
    expect(dataEvenimentFan('2026-07-10T22:30:00Z')).toEqual({ data: '2026-07-11', local: '2026-07-11 01:30:00' })   // iulie: UTC+3
    for (const v of ['10.11.2026 15:00', '2026-11-10', '2026-02-30 10:00:00', '', null, 123]) expect(dataEvenimentFan(v)).toBeNull()
  })
  it('C0 = ridicare propusă (data), S2 = livrat', () => {
    const r = rezumatUrmarireFan({ events: [{ id: 'C1', date: '2026-11-11 08:00:00' }, { id: 'C0', date: '2026-11-10 15:00:00' }, { id: 'S2', date: '2026-11-12 10:00:00' }] })
    expect(r).toMatchObject({ urmarire_stare: 'livrat', ridicat_propus: '2026-11-10', livrat_la: '2026-11-12 10:00:00', ultim_eveniment: 'S2' })
  })
  it.each([['S6', 'refuz'], ['S4', 'adresa_incompleta'], ['S42', 'adresa_incompleta'], ['S5', 'mutat']])('ultimul eveniment %s → RETUR, propus %s', (cod, motiv) => {
    const r = rezumatUrmarireFan({ events: [{ id: 'C0', date: '2026-11-10 15:00:00' }, { id: cod, date: '2026-11-11 10:00:00' }] })
    expect(r).toMatchObject({ urmarire_stare: 'retur', retur_propus: motiv })
  })
  it('cod de retur (S16) după avizare → retur, propus „avizat neridicat”; returnAwbNumber fără motiv → retur, motiv de ales', () => {
    expect(rezumatUrmarireFan({ events: [{ id: 'S3', date: '2026-11-11 10:00:00' }, { id: 'S16', date: '2026-11-15 10:00:00' }] })).toMatchObject({ urmarire_stare: 'retur', retur_propus: 'avizat_neridicat' })
    expect(rezumatUrmarireFan({ events: [{ id: 'C0', date: '2026-11-10 15:00:00' }], returnAwbNumber: '1000000999' })).toMatchObject({ urmarire_stare: 'retur', retur_propus: null })
  })
  it('adresă greșită, apoi livrat → livrat (semnalul s-a rezolvat)', () => {
    expect(rezumatUrmarireFan({ events: [{ id: 'S4', date: '2026-11-11 10:00:00' }, { id: 'S2', date: '2026-11-12 10:00:00' }] }).urmarire_stare).toBe('livrat')
  })
  it('formă necunoscută / cod necunoscut la final / S50 → de verificat de om (L12), nu succes', () => {
    expect(rezumatUrmarireFan({ events: [{ id: 'C0', date: '10.11.2026' }] }).urmarire_stare).toBe('de_verificat')
    expect(rezumatUrmarireFan({ events: 'x' }).urmarire_stare).toBe('de_verificat')
    expect(rezumatUrmarireFan({ events: [{ id: 'C0', date: '2026-11-10 15:00:00' }, { id: 'X9', date: '2026-11-11 10:00:00' }] }).urmarire_stare).toBe('de_verificat')
    expect(rezumatUrmarireFan({ events: [{ id: 'S2', date: '2026-11-12 10:00:00' }, { id: 'S50', date: '2026-11-12 10:05:00' }] }).urmarire_stare).toBe('de_verificat')
    expect(rezumatUrmarireFan(null).urmarire_stare).toBe('de_verificat')
  })
  it('interpreteazaUrmarire: AWB lipsă din răspuns → de verificat; listă necunoscută → toate de verificat; 5xx → nimic scris', () => {
    const u = interpreteazaUrmarire(200, { data: [{ awbNumber: '1000000001', events: [{ id: 'C0', date: '2026-11-10 15:00:00' }] }, { awbNumber: '9999999999' }] }, ['1000000001', '1000000002'])
    expect(u.ok).toBe(true); expect(u.pe_awb.get('1000000001').urmarire_stare).toBe('ridicat'); expect(u.pe_awb.get('1000000002').urmarire_stare).toBe('de_verificat'); expect(u.necerute).toBe(1)
    expect([...interpreteazaUrmarire(200, { ceva: 1 }, ['1000000001']).pe_awb.values()][0].urmarire_stare).toBe('de_verificat')
    expect(interpreteazaUrmarire(503, null, ['1000000001']).ok).toBe(false)
  })
  it('lista de evenimente: codurile din documentație (doc §1)', () => {
    for (const c of ['C0', 'S2', 'S6', 'S16', 'S33', 'S43', 'S30', 'S50']) expect(DOC).toContain(c)
    expect(EVENIMENTE_FAN.ridicat).toEqual(['C0']); expect(EVENIMENTE_FAN.retur).toEqual(['S16', 'S33', 'S43'])
  })
})

describe('confirmări (GET /reports/awb/confirmations, listă JSON) — forma câmpurilor e întrebare deschisă (doc §8)', () => {
  it('FORMA NECUNOSCUTĂ (nu e listă / element fără AWB) → „forma_necunoscuta” pe toate, niciodată succes', () => {
    for (const corp of [{ ok: true }, 'text', [{ nume: 'x' }], { data: [{ awbNumber: '1000000001' }, { x: 1 }] }]) {
      const c = interpreteazaConfirmari(200, corp, ['1000000001', '1000000002'])
      expect(c.ok).toBe(true); expect([...c.pe_awb.values()]).toEqual(['forma_necunoscuta', 'forma_necunoscuta'])
    }
  })
  it('listă cu AWB-uri → „primită, de verificat de om” / „lipsă”; listă goală → lipsă; HTTP eșuat → nimic scris', () => {
    const c = interpreteazaConfirmari(200, [{ awbNumber: '1000000001', ceva: 'x' }], ['1000000001', '1000000002'])
    expect(Object.fromEntries(c.pe_awb)).toEqual({ '1000000001': 'primita_de_verificat', '1000000002': 'lipsa' })
    expect([...interpreteazaConfirmari(200, [], ['1000000001']).pe_awb.values()]).toEqual(['lipsa'])
    expect(interpreteazaConfirmari(500, null, ['1000000001']).ok).toBe(false)
    expect(MIG).not.toMatch(/confirmare_stare[^;]*'confirmat'/)
  })
})

describe('evenimente (GET /reports/awb-events) și borderou (reconciliere)', () => {
  it('compară lista FAN cu codurile folosite: lipsă la FAN / neclasificate; formă necunoscută → de verificat', () => {
    const c = comparaEvenimente(200, { data: [{ id: 'C0', name: 'Ridicat' }, { id: 'S2', name: 'Livrat' }, { id: 'S99', name: 'Nou' }] })
    expect(c.ok).toBe(true); expect(c.lipsa_la_fan).toContain('S6'); expect(c.neclasificate.map(x => x.cod)).toEqual(['S99'])
    expect(comparaEvenimente(200, { x: 1 }).ok).toBe(false); expect(comparaEvenimente(200, [{ foo: 1 }]).ok).toBe(false)
  })
  it('borderoul: nr_plic EXACT în observație → găsit; dublură → de verificat; necitit complet → nu „lipsă”', () => {
    const pag = [{ data: [{ awbNumber: '1000000001', info: { observation: 'PL-TST-0001' } }, { awbNumber: '1000000002', info: { content: 'PL-TST-0002' } },
      { awbNumber: '1000000003', info: { content: 'PL-TST-0002' } }, { awbNumber: '1000000004', info: { observation: 'PL-TST-00011' } }] }, { data: [] }]
    const g = cautaInBorderou(pag, ['PL-TST-0001', 'PL-TST-0002', 'PL-TST-0003'], { complet: true })
    expect(g.get('PL-TST-0001')).toEqual({ stare: 'gasit', awb: '1000000001' })
    expect(g.get('PL-TST-0002').stare).toBe('de_verificat'); expect(g.get('PL-TST-0003')).toEqual({ stare: 'lipsa' })
    expect(cautaInBorderou(pag, ['PL-TST-0003'], { complet: false }).get('PL-TST-0003').stare).toBe('de_verificat')
    expect(cautaInBorderou([{ x: 1 }], ['PL-TST-0001'], { complet: true }).get('PL-TST-0001').stare).toBe('de_verificat')
  })
})

describe('eticheta: format A6 FIX, un PDF pe lot, în ordinea dată', () => {
  it('calea: toate AWB-urile într-un apel, format=A6, pdf=1 (doc §1)', () => {
    expect(FORMAT_ETICHETA).toBe('A6'); expect(DOC).toMatch(/format=A4\\\|A5\\\|A6/)
    const c = caleEticheta({ clientId: 'C1', awbs: ['1000000002', '1000000001'] })
    const q = new URLSearchParams(c.split('?')[1])
    expect(c.startsWith('/awb/label?')).toBe(true); expect(q.getAll('awbs[]')).toEqual(['1000000002', '1000000001']); expect(q.get('format')).toBe('A6'); expect(q.get('pdf')).toBe('1')
  })
  it('PDF adevărat vs HTML de eroare; base64 pe bucăți', () => {
    expect(estePdf(new TextEncoder().encode('%PDF-1.4 x'))).toBe(true); expect(estePdf(new TextEncoder().encode('<html>'))).toBe(false)
    const mare = new Uint8Array(100000).fill(65)
    expect(Buffer.from(inBase64(mare), 'base64').equals(Buffer.from(mare))).toBe(true)
  })
})

// ── calea reală (executaActiuneFan) pe un FAN simulat: niciun apel de rețea real ──
const LOT = { id: '11111111-2222-4333-8444-555555555555', proiect_id: 'p1', nr_lot: 'PP-0001' }
const nr = i => `PL-TST-${String(i).padStart(4, '0')}`
async function fixtura(n) {
  const plicuri = Array.from({ length: n }, (_, i) => ({ id: `pl${i + 1}`, nr_plic: nr(i + 1), destinatar_nume: 'PERSOANA FICTIVA', stare: 'activ' }))
  const convocari = plicuri.map((p, i) => ({ id: `c${i + 1}`, plic_id: p.id, detinator_id: `d${i + 1}` }))
  const contacte = plicuri.map((p, i) => ({ detinator_id: `d${i + 1}`, ...contact }))
  const pr = await pregatestePlicuriFan({ plicuri, convocari, contacte, proiectCod: 'TEST-RAZVAN', subtle: webcrypto.subtle })
  const randuri = pr.map((x, i) => ({ id: `r${String(i + 1).padStart(4, '0')}`, plic_id: x.plic.id, nr_plic: x.plic.nr_plic, stare: 'aprobat', hash_date: x.hash, awb: null }))
  return { plicuri, convocari, contacte, randuri }
}
function fanSimulat(handler) {
  const apeluri = []
  const fetch = vi.fn(async (url, init) => {
    const u = new URL(url)
    apeluri.push({ metoda: init.method, cale: u.pathname, q: u.searchParams, corp: init.body ? JSON.parse(init.body) : undefined, auth: init.headers.Authorization })
    if (u.pathname === '/login') return raspunsJson(200, { status: 'success', data: { token: 'tok-' + apeluri.filter(a => a.cale === '/login').length, expiresAt: '2026-11-18 10:00' } })
    return handler(u, init, apeluri)
  })
  return { fetch, apeluri }
}
const raspunsJson = (status, corp) => ({ status, json: async () => corp, arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(corp)).buffer })
const okPentru = corp => ({ response: corp.shipments.map((s, i) => ({ awbNumber: String(2000000000 + Number(s.info.content.slice(-4))), tariff: 9.5, vat: 1.8, errors: null })) })
function depsFake(fx, fan, o = {}) {
  const jurnal = []
  return { jurnal, deps: {
    secrete: () => ({ username: 'utilizator-fictiv', password: 'parola-fictiva', clientId: 'CLIENT-FICTIV' }),
    randuriLot: async () => ({ data: fx.randuri }),
    proiect: async () => ({ data: { cod: 'TEST-RAZVAN' } }),
    datePlicuri: async () => ({ data: { plicuri: fx.plicuri, convocari: fx.convocari, contacte: fx.contacte } }),
    rpc: vi.fn(async (nume, args) => { jurnal.push({ nume, args }); return nume === 'fn_red_fan_claim_lot' ? { data: '99999999-0000-4000-8000-' + String(jurnal.length).padStart(12, '0') }
      : nume === 'fn_red_fan_urmarire' || nume === 'fn_red_fan_confirmari' ? { data: args.p_randuri.length } : { data: args.p_rezultate?.length ?? null } }),
    fetch: fan.fetch, pauza: vi.fn(async () => {}), subtle: webcrypto.subtle, ...o,
  } }
}

describe('generare în loturi de ≤ 100 (POST /intern-awb, simulat)', () => {
  it('250 de plicuri aprobate → 3 solicitări (100 + 100 + 50), claim ÎNAINTE de fiecare, una după alta, cu pauză', async () => {
    const fx = await fixtura(250)
    const fan = fanSimulat((u, init) => raspunsJson(200, okPentru(JSON.parse(init.body))))
    const { deps, jurnal } = depsFake(fx, fan)
    const ordine = []
    deps.rpc.mockImplementation(async (nume, args) => { ordine.push(nume); jurnal.push({ nume, args }); return nume === 'fn_red_fan_claim_lot' ? { data: '99999999-0000-4000-8000-00000000000' + jurnal.length % 10 } : { data: args.p_rezultate.length } })
    fan.fetch.mockClear()
    const r = await executaActiuneFan({ corp: { actiune: 'genereaza' }, lot: LOT }, deps)
    const creari = fan.apeluri.filter(a => a.cale === '/intern-awb')
    expect(creari.map(a => a.corp.shipments.length)).toEqual([100, 100, 50])
    expect(creari.every(a => a.corp.clientId === 'CLIENT-FICTIV' && a.auth === 'Bearer tok-1')).toBe(true)
    expect(creari[0].corp.shipments[0].info.observation).toBe('PL-TST-0001'); expect(creari[2].corp.shipments.at(-1).info.observation).toBe('PL-TST-0250')
    expect(ordine).toEqual(['fn_red_fan_claim_lot', 'fn_red_fan_rezultate', 'fn_red_fan_claim_lot', 'fn_red_fan_rezultate', 'fn_red_fan_claim_lot', 'fn_red_fan_rezultate'])
    expect(jurnal.filter(j => j.nume === 'fn_red_fan_claim_lot').map(j => j.args.p_ids.length)).toEqual([100, 100, 50])
    expect(deps.pauza).toHaveBeenCalledTimes(2)
    expect(r).toMatchObject({ status: 200, body: { cod: 'ok', generat: 250, eroare: 0, necunoscut: 0, solicitari: 3, ramase: 0, oprit: null } })
    expect(fan.apeluri.filter(a => a.cale === '/login')).toHaveLength(1)   // token refolosit (24 h)
  })
  it(`cel mult ${MAX_BUCATI_PE_APEL} solicitări pe apăsare; restul rămâne aprobat pentru următorul apăsat`, async () => {
    const fx = await fixtura(MAX_BUCATI_PE_APEL * 100 + 1)
    const fan = fanSimulat((u, init) => raspunsJson(200, okPentru(JSON.parse(init.body))))
    const r = await executaActiuneFan({ corp: { actiune: 'genereaza' }, lot: LOT }, depsFake(fx, fan).deps)
    expect(fan.apeluri.filter(a => a.cale === '/intern-awb')).toHaveLength(MAX_BUCATI_PE_APEL); expect(r.body.ramase).toBe(1); expect(r.body.oprit).toMatch(/următorul/)
  })
  it('RĂSPUNS PARȚIAL: elementul respins = eroare cu motiv, celelalte generat; scrise ÎMPREUNĂ, cu cheia solicitării', async () => {
    const fx = await fixtura(3)
    const fan = fanSimulat(() => raspunsJson(200, { response: [{ awbNumber: '2000000001' }, { awbNumber: null, errors: { 'recipient.phone': ['invalid'] } }, { awbNumber: '2000000003' }] }))
    const { deps, jurnal } = depsFake(fx, fan)
    const r = await executaActiuneFan({ corp: { actiune: 'genereaza' }, lot: LOT }, deps)
    const w = jurnal.find(j => j.nume === 'fn_red_fan_rezultate')
    expect(w.args.p_cerere).toBe((await deps.rpc.mock.results[0].value).data)   // aceeași cheie ca la claim
    expect(w.args.p_rezultate.map(x => [x.id, x.stare, x.awb])).toEqual([['r0001', 'generat', '2000000001'], ['r0002', 'eroare', null], ['r0003', 'generat', '2000000003']])
    expect(w.args.p_rezultate[1].motiv).toMatch(/recipient\.phone/)
    expect(r.body).toMatchObject({ generat: 2, eroare: 1, necunoscut: 0 })
  })
  it('RĂSPUNS PIERDUT (timeout) → bucata = necunoscut, rularea se OPREȘTE: a doua bucată nu se mai trimite, fără retry (L05)', async () => {
    const fx = await fixtura(150)
    const fan = fanSimulat(u => { if (u.pathname === '/intern-awb') throw new Error('timeout') })
    const { deps, jurnal } = depsFake(fx, fan)
    const r = await executaActiuneFan({ corp: { actiune: 'genereaza' }, lot: LOT }, deps)
    expect(fan.apeluri.filter(a => a.cale === '/intern-awb')).toHaveLength(1)
    expect(jurnal.find(j => j.nume === 'fn_red_fan_rezultate').args.p_rezultate.every(x => x.stare === 'necunoscut' && x.awb === null)).toBe(true)
    expect(jurnal.filter(j => j.nume === 'fn_red_fan_claim_lot')).toHaveLength(1)
    expect(r.body).toMatchObject({ necunoscut: 100, ramase: 50, oprit: expect.stringMatching(/fără retry automat/) })
  })
  it('5xx → necunoscut + oprire; rezultatul nescris în BD → oprire, fără alte apeluri FAN', async () => {
    const fx = await fixtura(150)
    const fan = fanSimulat(() => raspunsJson(502, null))
    expect((await executaActiuneFan({ corp: { actiune: 'genereaza' }, lot: LOT }, depsFake(fx, fan).deps)).body.necunoscut).toBe(100)
    const fan2 = fanSimulat((u, init) => raspunsJson(200, okPentru(JSON.parse(init.body))))
    const d2 = depsFake(fx, fan2)
    d2.deps.rpc.mockImplementation(async nume => nume === 'fn_red_fan_claim_lot' ? { data: '99999999-0000-4000-8000-000000000001' } : { error: { message: 'retea' } })
    const r2 = await executaActiuneFan({ corp: { actiune: 'genereaza' }, lot: LOT }, d2.deps)
    expect(fan2.apeluri.filter(a => a.cale === '/intern-awb')).toHaveLength(1); expect(r2.body.oprit).toMatch(/reconciliază/)
  })
  it('claim refuzat de BD → NICIUN apel plătit', async () => {
    const fx = await fixtura(2)
    const fan = fanSimulat(() => raspunsJson(200, {}))
    const d = depsFake(fx, fan)
    d.deps.rpc.mockImplementation(async () => ({ error: { code: 'P0001' } }))
    const r = await executaActiuneFan({ corp: { actiune: 'genereaza' }, lot: LOT }, d.deps)
    expect(fan.apeluri.filter(a => a.cale === '/intern-awb')).toHaveLength(0); expect(r.body.solicitari).toBe(0)
  })
  it('IDEMPOTENȚĂ: rândurile deja generate / în curs / necunoscute nu se mai trimit; datele schimbate după aprobare = excluse', async () => {
    const fx = await fixtura(4)
    fx.randuri[0].stare = 'generat'; fx.randuri[0].awb = '2000000001'; fx.randuri[1].stare = 'in_curs'; fx.randuri[2].stare = 'necunoscut'
    fx.randuri[3].hash_date = 'f'.repeat(64)
    const fan = fanSimulat(() => raspunsJson(200, {}))
    expect((await executaActiuneFan({ corp: { actiune: 'genereaza' }, lot: LOT }, depsFake(fx, fan).deps)).body.excluse).toEqual([{ nr_plic: 'PL-TST-0004', motiv: expect.stringMatching(/schimbat după aprobare/) }])
    fx.randuri[3].stare = 'generat'
    expect((await executaActiuneFan({ corp: { actiune: 'genereaza' }, lot: LOT }, depsFake(fx, fan).deps)).status).toBe(409)
    expect(fan.apeluri.filter(a => a.cale === '/intern-awb')).toHaveLength(0)
  })
  it('401 → un singur login nou și aceeași solicitare (același claim); parola nu apare în răspuns', async () => {
    const fx = await fixtura(2)
    let n = 0
    const fan = fanSimulat((u, init) => (++n === 1 ? raspunsJson(401, {}) : raspunsJson(200, okPentru(JSON.parse(init.body)))))
    const { deps, jurnal } = depsFake(fx, fan)
    const r = await executaActiuneFan({ corp: { actiune: 'genereaza' }, lot: LOT }, deps)
    expect(fan.apeluri.filter(a => a.cale === '/login')).toHaveLength(2); expect(jurnal.filter(j => j.nume === 'fn_red_fan_claim_lot')).toHaveLength(1)
    expect(r.body.generat).toBe(2); expect(JSON.stringify(r)).not.toMatch(/parola-fictiva|utilizator-fictiv/)
  })
  it('login eșuat → 503 fără apel de creare; secrete lipsă → 503 fără niciun apel (L10)', async () => {
    const fx = await fixtura(1)
    const fan = { fetch: vi.fn(async () => raspunsJson(401, {})) }
    expect((await executaActiuneFan({ corp: { actiune: 'genereaza' }, lot: LOT }, depsFake(fx, fan).deps)).body.cod).toBe('autentificare_fan_neconfirmata')
    expect(fan.fetch).toHaveBeenCalledTimes(1)
    const fan2 = { fetch: vi.fn() }
    expect((await executaActiuneFan({ corp: { actiune: 'genereaza' }, lot: LOT }, depsFake(fx, fan2, { secrete: () => ({ username: 'u' }) }).deps)).body.cod).toBe('transport_neconfigurat')
    expect(fan2.fetch).not.toHaveBeenCalled()
  })
})

describe('urmărire / confirmări / etichete / reconciliere (simulat)', () => {
  const cuAwb = async n => { const fx = await fixtura(n); fx.randuri.forEach((r, i) => { r.stare = 'generat'; r.awb = String(2000000001 + i) }); return fx }
  it('urmărire: 150 AWB-uri → 2 solicitări (100 + 50); returul propus ajunge în BD ca propunere', async () => {
    const fx = await cuAwb(150)
    const fan = fanSimulat(u => raspunsJson(200, { data: u.searchParams.getAll('awb[]').map(a => ({ awbNumber: a, events: [{ id: 'C0', date: '2026-11-10 15:00:00' }, ...(a === '2000000002' ? [{ id: 'S6', date: '2026-11-11 10:00:00' }] : [])] })) }))
    const { deps, jurnal } = depsFake(fx, fan)
    const r = await executaActiuneFan({ corp: { actiune: 'urmarire' }, lot: LOT }, deps)
    expect(fan.apeluri.filter(a => a.cale === '/reports/awb/tracking').map(a => a.q.getAll('awb[]').length)).toEqual([100, 50])
    const p = jurnal.filter(j => j.nume === 'fn_red_fan_urmarire').flatMap(j => j.args.p_randuri)
    expect(p.find(x => x.awb === '2000000002')).toMatchObject({ urmarire_stare: 'retur', retur_propus: 'refuz', ridicat_propus: '2026-11-10' })
    expect(p.find(x => x.awb === '2000000001')).toMatchObject({ urmarire_stare: 'ridicat', retur_propus: null })
    expect(r.body).toMatchObject({ cod: 'ok', scrise: 150 })
    expect(jurnal.some(j => j.nume === 'fn_red_fan_ridicat')).toBe(false)   // ridicarea o confirmă omul
  })
  it('confirmări: formă necunoscută → scrisă ca „forma_necunoscuta”, language=ro, ≤ 100 pe solicitare', async () => {
    const fx = await cuAwb(2)
    const fan = fanSimulat(() => raspunsJson(200, { ceva: 'necunoscut' }))
    const { deps, jurnal } = depsFake(fx, fan)
    await executaActiuneFan({ corp: { actiune: 'confirmari' }, lot: LOT }, deps)
    const a = fan.apeluri.find(x => x.cale === '/reports/awb/confirmations')
    expect(a.q.get('clientId')).toBe('CLIENT-FICTIV'); expect(a.q.get('language')).toBe('ro'); expect(a.q.getAll('awb[]')).toEqual(['2000000001', '2000000002'])
    expect(jurnal.find(j => j.nume === 'fn_red_fan_confirmari').args.p_randuri.map(x => x.confirmare_stare)).toEqual(['forma_necunoscuta', 'forma_necunoscuta'])
  })
  it('etichete: UN PDF, AWB-urile în ordinea numărului de plic, format A6; HTML în loc de PDF → 502', async () => {
    const fx = await cuAwb(3)
    fx.randuri.reverse()
    const pdf = new TextEncoder().encode('%PDF-1.7 fictiv')
    const fan = fanSimulat(() => ({ status: 200, arrayBuffer: async () => pdf.buffer, json: async () => null }))
    const r = await executaActiuneFan({ corp: { actiune: 'eticheta' }, lot: LOT }, depsFake(fx, fan).deps)
    const a = fan.apeluri.find(x => x.cale === '/awb/label')
    expect(a.q.getAll('awbs[]')).toEqual(['2000000001', '2000000002', '2000000003']); expect(a.q.get('format')).toBe('A6')
    expect(r.body).toMatchObject({ cod: 'ok', parte: 1, parti: 1, nr_plicuri: ['PL-TST-0001', 'PL-TST-0002', 'PL-TST-0003'] })
    expect(Buffer.from(r.body.pdf_base64, 'base64').toString()).toBe('%PDF-1.7 fictiv')
    const fan2 = fanSimulat(() => ({ status: 200, arrayBuffer: async () => new TextEncoder().encode('<html>').buffer }))
    expect((await executaActiuneFan({ corp: { actiune: 'eticheta' }, lot: LOT }, depsFake(fx, fan2).deps)).status).toBe(502)
  })
  it('reconciliere: citește borderoul până la pagina goală și doar PROPUNE (nicio scriere)', async () => {
    const fx = await fixtura(2)
    fx.randuri[0].stare = 'necunoscut'; fx.randuri[1].stare = 'in_curs'
    const fan = fanSimulat(u => raspunsJson(200, { data: u.searchParams.get('page') === '1' ? [{ awbNumber: '2000000001', info: { observation: 'PL-TST-0001' } }] : [] }))
    const { deps, jurnal } = depsFake(fx, fan)
    const r = await executaActiuneFan({ corp: { actiune: 'reconciliaza', data: '2026-11-17' }, lot: LOT }, deps)
    expect(r.body.complet).toBe(true); expect(r.body.propuneri.map(p => [p.nr_plic, p.stare, p.awb])).toEqual([['PL-TST-0001', 'gasit', '2000000001'], ['PL-TST-0002', 'lipsa', undefined]])
    expect(jurnal).toHaveLength(0)
    expect((await executaActiuneFan({ corp: { actiune: 'reconciliaza', data: '17.11.2026' }, lot: LOT }, deps)).status).toBe(400)
  })
  it('ștergere AWB: doar generat; 5xx → rămâne generat (necunoscut), fără scriere', async () => {
    const fx = await cuAwb(1)
    const fan = fanSimulat(() => raspunsJson(503, null))
    const { deps, jurnal } = depsFake(fx, fan)
    expect((await executaActiuneFan({ corp: { actiune: 'sterge_awb', rand_id: 'x' }, lot: LOT }, deps)).status).toBe(400)
    expect((await executaActiuneFan({ corp: { actiune: 'sterge_awb', rand_id: '00000000-0000-4000-8000-000000000000' }, lot: LOT }, deps)).status).toBe(404)
    fx.randuri[0].id = '00000000-0000-4000-8000-000000000001'
    expect((await executaActiuneFan({ corp: { actiune: 'sterge_awb', rand_id: fx.randuri[0].id }, lot: LOT }, deps)).body.cod).toBe('stergere_neconfirmata')
    expect(jurnal).toHaveLength(0)
  })
})

describe('raspundeFan — poarta funcției edge (TRANSPORT_REAL_ACTIV = false)', () => {
  const ID_LOT = '11111111-2222-4333-8444-555555555555'
  const deps = (o = {}) => ({ getUser: async () => ({ data: { user: { id: 'u' } } }), owner: async () => ({ data: true }), lot: vi.fn(async () => ({ data: { id: ID_LOT } })), ...o })
  it('transportul real e oprit în cod; comanda curierului nu e acțiune API (manuală în selfAWB)', () => {
    expect(TRANSPORT_REAL_ACTIV).toBe(false)
    expect(ACTIUNI_FAN).not.toContain('comanda_curier')
  })
  it('fără JWT → 401; token respins (4xx) → 401; autentificare indisponibilă → 503 (Jakarinos r1 P2)', async () => {
    expect((await raspundeFan({ jwt: '', corp: {} }, deps())).status).toBe(401)
    expect((await raspundeFan({ jwt: 'x', corp: {} }, deps({ getUser: async () => ({ error: { status: 401 } }) }))).status).toBe(401)
    expect((await raspundeFan({ jwt: 'x', corp: {} }, deps({ getUser: async () => ({ error: { status: 503 } }) }))).body.cod).toBe('autentificare_neconfirmata')
    expect((await raspundeFan({ jwt: 'x', corp: {} }, deps({ getUser: async () => ({ error: {} }) }))).status).toBe(503)
    expect((await raspundeFan({ jwt: 'x', corp: {} }, deps({ getUser: async () => ({ error: { status: 0 } }) }))).status).toBe(503)
    expect((await raspundeFan({ jwt: 'x', corp: {} }, deps({ getUser: async () => ({ data: { user: null } }) }))).status).toBe(401)
  })
  it('POARTA DE ROL: non-owner → 403 pe ORICE acțiune; verificarea owner eșuată → 503 (nu „non_owner”)', async () => {
    for (const actiune of ACTIUNI_FAN) expect((await raspundeFan({ jwt: 'x', corp: { actiune, lot_id: ID_LOT } }, deps({ owner: async () => ({ data: false }) }))).status).toBe(403)
    expect((await raspundeFan({ jwt: 'x', corp: { actiune: 'genereaza', lot_id: ID_LOT } }, deps({ owner: async () => ({ error: {} }) }))).body.cod).toBe('autorizare_neconfirmata')
  })
  it('rolul / identitatea din corp sunt ignorate', async () => {
    const r = await raspundeFan({ jwt: 'x', corp: { actiune: 'genereaza', lot_id: ID_LOT, is_owner: true } }, deps({ owner: async () => ({ data: false }) }))
    expect(r.status).toBe(403)
  })
  it('acțiune / lot invalid → 400; lot invizibil → 404', async () => {
    expect((await raspundeFan({ jwt: 'x', corp: { actiune: 'trimite', lot_id: ID_LOT } }, deps())).status).toBe(400)
    expect((await raspundeFan({ jwt: 'x', corp: { actiune: 'genereaza', lot_id: 'x' } }, deps())).status).toBe(400)
    expect((await raspundeFan({ jwt: 'x', corp: { actiune: 'genereaza', lot_id: ID_LOT } }, deps({ lot: async () => ({ data: null }) }))).status).toBe(404)
  })
  it('owner + lot valid, ORICE acțiune → 423 transport_real_oprit, fără NICIUN apel (fetch care pică testul, BD, secrete)', async () => {
    const fetchGlobal = vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('APEL DE REȚEA INTERZIS') })
    const interzis = () => { throw new Error('APEL INTERZIS cât transportul e oprit') }
    const spioni = { fetch: vi.fn(interzis), rpc: vi.fn(interzis), secrete: vi.fn(interzis), randuriLot: vi.fn(interzis), datePlicuri: vi.fn(interzis), proiect: vi.fn(interzis), pauza: vi.fn(interzis) }
    for (const actiune of ACTIUNI_FAN) {
      const r = await raspundeFan({ jwt: 'x', corp: { actiune, lot_id: ID_LOT, parte: 1, data: '2026-11-17' } }, deps(spioni))
      expect(r).toEqual({ status: 423, body: { cod: 'transport_real_oprit' } })
    }
    for (const s of Object.values(spioni)) expect(s).not.toHaveBeenCalled()
    expect(fetchGlobal).not.toHaveBeenCalled()
    fetchGlobal.mockRestore()
  })
  it('funcția edge intră DOAR prin poartă: index.ts nu importă calea reală', () => {
    const idx = readFileSync('supabase/functions/redari-fan-awb/index.ts', 'utf8')
    expect(idx).not.toMatch(/executaActiuneFan/); expect(idx).toMatch(/import \{ raspundeFan \} from '\.\.\/_shared\/redariFanHandler\.mjs'/)
    expect(idx).not.toMatch(/SERVICE_ROLE/)
  })
})

describe('contactPePlic (o singură definiție pentru ecran și funcția edge, L19)', () => {
  it('ia deținătorul cu telefon; fără convocări → contact null; ecranul re-exportă aceeași funcție', async () => {
    const r = contactPePlic([{ id: 'p1' }, { id: 'p2' }],
      [{ plic_id: 'p1', detinator_id: 'd2' }, { plic_id: 'p1', detinator_id: 'd1' }, { plic_id: null, detinator_id: 'd3' }],
      [{ detinator_id: 'd1', telefon: '' }, { detinator_id: 'd2', telefon: '0700' }, { detinator_id: 'd3', telefon: '0711' }])
    expect(r[0].contact.detinator_id).toBe('d2'); expect(r[1].contact).toBeNull()
    expect((await import('./ui/FanAwbPrevizualizare.jsx')).contactPePlic).toBe(contactPePlic)
  })
})

describe('citesteToate (keyset, L23)', () => {
  it('pagini până la pagina goală; eroare ≠ gol', async () => {
    const date = Array.from({ length: 2500 }, (_, i) => ({ id: String(i).padStart(5, '0') }))
    const fabrica = () => { let dupa = null; const q = { order: () => q, limit: () => q, gt: (k, v) => { dupa = v; return q },
      then: (rez) => rez({ data: date.filter(d => dupa == null || d.id > dupa).slice(0, 1000), error: null }) }; return q }
    expect((await citesteToate(fabrica, ['x'])).data).toHaveLength(2500)
    const rau = () => { const q = { order: () => q, limit: () => q, gt: () => q, then: rez => rez({ data: null, error: { message: 'x' } }) }; return q }
    expect((await citesteToate(rau, ['x'])).error).toBeTruthy()
  })
})

describe('ecranul: pașii, lotul de test, lotul pilot', () => {
  const awb = [{ stare: 'propus' }, { stare: 'aprobat' }, { stare: 'generat', awb: '2000000001' }]
  it('TRANSPORT OPRIT → TOȚI pașii dezactivați, cu „transport oprit” (chiar și pentru owner, cu evidența instalată)', () => {
    const p = stariPasi({ transportActiv: false, evidentaInstalata: true, esteOwner: true, poateScrie: true, fanLot: { test: true }, randuri: awb, gataDePropus: 3 })
    expect(p.map(x => x.cheie)).toEqual(['propune', 'aproba', 'genereaza', 'etichete', 'curier', 'urmarire', 'confirmari'])
    expect(p.every(x => x.activ === false && x.motiv === MESAJ_TRANSPORT_OPRIT)).toBe(true)
    expect(stariPasi({}).every(x => !x.activ)).toBe(true)   // implicit = flag-ul din cod (false)
  })
  it('transport pornit: editorul doar propune; owner-ul aprobă doar după marcajul test / real', () => {
    const ed = stariPasi({ transportActiv: true, evidentaInstalata: true, poateScrie: true, randuri: awb, gataDePropus: 1 })
    expect(ed.filter(x => x.activ).map(x => x.cheie)).toEqual(['propune', 'curier'])
    const ow = stariPasi({ transportActiv: true, evidentaInstalata: true, esteOwner: true, poateScrie: true, fanLot: null, randuri: awb, gataDePropus: 1 })
    expect(ow.find(x => x.cheie === 'aproba')).toMatchObject({ activ: false, motiv: expect.stringMatching(/TEST sau lot real/) })
    expect(stariPasi({ transportActiv: true, evidentaInstalata: false, esteOwner: true }).every(x => /neaplicată/.test(x.motiv))).toBe(true)
  })
  it('LOT DE TEST: titlul, prefixul fișierelor și borderoul îl arată; borderoul fără nume / adrese / telefoane', () => {
    const lot = { nr_lot: 'PP-0001' }
    expect(titluLot(lot, { test: true })).toMatch(/^LOT DE TEST/); expect(titluLot(lot, { test: false })).toMatch(/^Lot real/); expect(prefixLot({ test: true })).toBe('TEST_'); expect(prefixLot({ test: false })).toBe('')
    const csv = csvBorderouFan({ lot, fanLot: { test: true }, randuri: [{ nr_plic: 'PL-TST-0002', awb: '2000000002', stare: 'generat', urmarire_stare: 'retur', retur_propus: 'refuz', confirmare_stare: 'lipsa' }, { nr_plic: 'PL-TST-0001', stare: 'eroare' }] })
    const linii = csv.slice(1).split('\r\n')
    expect(linii[0]).toMatch(/^"LOT DE TEST/); expect(linii[3]).toMatch(/^"PL-TST-0001"/); expect(linii[4]).toMatch(/"RETUR"/)
    expect(csvBorderouFan({ lot, fanLot: { test: false }, randuri: [] }).slice(1)).not.toMatch(/TEST/)
    expect(csv).not.toMatch(/PERSOANA|Str\.|0700/)
  })
  it('plafonul lotului pilot: aceeași valoare implicită în cod și în migrare (L19), mică', () => {
    expect(LIMITA_LOT_PILOT_IMPLICITA).toBe(20)
    expect(MIG).toMatch(/limita_lot integer NOT NULL DEFAULT 20 CHECK/)
    expect(MIG).toMatch(/\(SELECT limita_lot FROM public\.red_fan_setari\) <> 20 THEN RAISE EXCEPTION '20261212a: setarile implicite lipsesc'/)
  })
  it('marcajul TEST / real: owner, înainte de aprobare; transport oprit → dezactivat', () => {
    expect(stareMarcaj({ transportActiv: false, evidentaInstalata: true, esteOwner: true })).toEqual({ activ: false, motiv: MESAJ_TRANSPORT_OPRIT })
    expect(stareMarcaj({ transportActiv: true, evidentaInstalata: true, esteOwner: true, randuri: [{ stare: 'propus' }] }).activ).toBe(true)
    expect(stareMarcaj({ transportActiv: true, evidentaInstalata: true, esteOwner: true, randuri: [{ stare: 'aprobat' }] }).activ).toBe(false)
    expect(stareMarcaj({ transportActiv: true, evidentaInstalata: true, esteOwner: false }).activ).toBe(false)
  })
  it('ecranul randat (owner, admin): banner „Transport oprit” și TOATE butoanele de pas dezactivate', () => {
    const html = renderToStaticMarkup(React.createElement(FanAwbPrevizualizare, { proiect: { cod: 'TEST-RAZVAN' }, lot: { id: 'l1', nr_lot: 'PP-0001' }, plicuri: [], esteOwner: true, poateScrie: true, onClose: () => {} }))
    expect(html).toMatch(/Transport oprit/)
    const butoane = [...html.matchAll(/<button[^>]*>([^<]*(?:<[^/][^>]*>[^<]*)*)<\/button>/g)].filter(m => /^\s*(1\.|2a\.|2b\.|2c\.|3\.|4\.|6\.|6b\.|7\.)/.test(m[1].replace(/<[^>]+>/g, '')))
    expect(butoane.length).toBe(9)
    expect(butoane.every(m => /disabled=""/.test(m[0]))).toBe(true)
    expect((html.match(/transport oprit/g) || []).length).toBeGreaterThanOrEqual(PASI_FAN.length)
  })
  it('PASI_FAN acoperă exact pașii ceruți, în ordine', () => {
    expect(PASI_FAN.map(p => p.titlu)).toEqual(['1. Propune', '2. Aprobă', '3. Generează AWB', '4. Etichete A6', '5. Comandă curier', '6. Urmărire', '7. Confirmări / retururi'])
  })
})

describe('pachetul de documente pe lot (ordinea plicurilor) și opisul', () => {
  const pl = [{ id: 'b', nr_plic: 'PL-TST-0002', stare: 'activ', opis_path: 'plicuri/b/opis.docx' }, { id: 'a', nr_plic: 'PL-TST-0001', stare: 'activ', opis_path: 'plicuri/a/opis.docx' },
    { id: 'z', nr_plic: 'PL-TST-0000', stare: 'anulat', opis_path: null }]
  const cv = { a: [{ conv_id: 'c2', nr_document: 'C-000010', fisier_convocator_path: 'conv/10.docx' }, { conv_id: 'c1', nr_document: 'C-000002', fisier_convocator_path: 'conv/2.docx' }],
    b: [{ conv_id: 'c3', nr_document: 'C-000003', fisier_convocator_path: 'conv/3.docx' }] }
  it('ordinea: plicul 0001 întâi; în plic opisul primul, apoi convocările în ordinea numărului (C-000002 înaintea C-000010); anulatele excluse', () => {
    const p = planPachetPlicuire(pl, cv)
    expect(p.lipsuri).toEqual([])
    expect(p.fisiere.map(f => f.nume)).toEqual(['001_PL-TST-0001_0_opis.docx', '001_PL-TST-0001_1_C-000002.docx', '001_PL-TST-0001_2_C-000010.docx', '002_PL-TST-0002_0_opis.docx', '002_PL-TST-0002_1_C-000003.docx'])
    expect(planPachetPlicuire(pl, cv, { prefix: 'TEST_' }).fisiere[0].nume).toBe('TEST_001_PL-TST-0001_0_opis.docx')
  })
  it('orice document lipsă = lipsă numită (nu se sare tacit, L12)', () => {
    const p = planPachetPlicuire([{ ...pl[1], opis_path: null }], { a: [{ ...cv.a[0], fisier_convocator_path: null }] })
    expect(p.lipsuri).toEqual([expect.stringMatching(/PL-TST-0001: opisul nu e atașat/), expect.stringMatching(/C-000010 nu are fișierul arhivat/)])
  })
  it('ordineConvocari = aceeași ordine ca în opis (numeric, nu alfabetic pe text)', () => {
    expect(ordineConvocari([{ nr_document: 'C-10' }, { nr_document: 'C-9' }, { nr_document: 'X' }]).map(c => c.nr_document)).toEqual(['C-9', 'C-10', 'X'])
  })
})

describe('returul FAN ajunge în PV B la „Demersurile de convocare” (după înregistrarea de către om)', () => {
  it('convocare expediată prin FAN (AWB numeric) cu retur „refuz” → AWB-ul, data și returul în câmpurile PV B', async () => {
    const d = {
      proiect: { contract_nr: 'CTR', contract_data: '2026-11-02', denumire: 'Test', reprezentant_gazpet_nume: 'FICTIV G', reprezentant_tgz_nume: 'FICTIV T' },
      uat: { nume: 'UAT TEST', reprezentant_uat_nume: 'FICTIV U' }, parcela: { tronson: 3, categoria_folosinta: 'Arabil', verificare_de_gazpet: 'G', verificare_de_tgz: 'T', verificare_data: '2026-11-01' },
      pv: { nr_pv: 'PVB-ZZZ-0001', data_pv: '2026-11-02', locul: 'Test', motiv_pv_b: 'refuz' }, detinatori: [{ id: 'd1', nume: 'FICTIV UNU' }],
      convocari: [{ id: 'c1', detinator_id: 'd1', canal: 'posta', stare: 'activ', sters_la: null, created_at: '2026-11-01', data_expediere: '2026-11-10', nr_tracking: '2228300120233', retur: 'refuz' }],
      raspunsuri: [], strict: false, templateArrayBuffer: readFileSync('public/redari/sabloane/pv_b.docx'),
    }
    const { campuri } = await genereazaPvB(d)
    expect(campuri.conv_nr_tracking).toBe('2228300120233'); expect(campuri.conv_data_expediere).toBe('10.11.2026'); expect(campuri.conv_retur).toBe('refuz')
    expect(campuri.bifa_conv_returnata).toBe('☒')
  })
})
