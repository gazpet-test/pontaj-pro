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
  caleEticheta, caleListaAwb, dataEvenimentFan, EVENIMENTE_FAN, pregatestePlicuriFan, estePdf, inBase64, LIMITE_FAN, contactPePlic,
  manifestTiparire, destinatarMascat, interpreteazaStergere, campuriEroareFan, cheieTiraj, idTiraj, tirajDin, VERSIUNE_TIRAJ, MESAJ_TIRAJ_SCHIMBAT,
  MESAJ_TIRAJ_OPRIT, ASTEPTARE_DUPA_OPRIRE_S, tirajNeschimbat, refuzTiraj } from '../../supabase/functions/_shared/redariFan.mjs'
import { raspundeFan, TRANSPORT_REAL_ACTIV, DOAR_PROIECTE_TEST, transportPermis, esteProiectTest, ACTIUNI_FAN } from '../../supabase/functions/_shared/redariFanHandler.mjs'
import { executaActiuneFan, MAX_BUCATI_PE_APEL, citesteToate } from '../../supabase/functions/_shared/redariFanTransport.mjs'
import { stariPasi, stareMarcaj, stariOperatii, PASI_FAN, MESAJ_TRANSPORT_OPRIT, csvBorderouFan, prefixLot, titluLot, numeEtichete, numeControl, numeArhiva,
  controlLotFan, pregatestePachetFan, mesajEdgeFan, confirmaTirajFinal, stareOprireTiraj, textFapteUrmarire,
  fapteContrazise, ALEGERI_SOLUTIONARE, optiuniSolutionare, solutioneazaUrmarire, MESAJ_URMARIRE_SCHIMBATA } from './fanLot.js'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import FanAwbPrevizualizare from './ui/FanAwbPrevizualizare.jsx'
import { planPachetPlicuire, ordineConvocari, genereazaPaginaControl, continutPaginaControl, momentBucuresti, docxPaginaControl } from './plicuri.js'
import { createHash } from 'node:crypto'
import { genereazaPvB } from './pv.js'
import { pasiDinDocument, parcurge, butonDin } from './fanProcedura.testutil.js'

const DOC = readFileSync('docs/redari/FANCOURIER_INTEGRARE.md', 'utf8')
const PASI_DOC = readFileSync('docs/redari/FAN_TEST1_PASI.md', 'utf8')
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
      { awbNumber: '1000000003', info: { content: 'PL-TST-0002' } }, { awbNumber: '1000000004', info: { observation: 'ACTE TGZ' } }] }, { data: [] }]
    const g = cautaInBorderou(pag, ['PL-TST-0001', 'PL-TST-0002', 'PL-TST-0003'], { complet: true })
    expect(g.get('PL-TST-0001')).toEqual({ stare: 'gasit', awb: '1000000001' })
    expect(g.get('PL-TST-0002').stare).toBe('de_verificat'); expect(g.get('PL-TST-0003')).toEqual({ stare: 'lipsa' })
    expect(g.neinterpretabile).toBe(0)
    expect(cautaInBorderou(pag, ['PL-TST-0003'], { complet: false }).get('PL-TST-0003').stare).toBe('de_verificat')
    expect(cautaInBorderou([{ x: 1 }], ['PL-TST-0001'], { complet: true }).get('PL-TST-0001').stare).toBe('de_verificat')
  })
  // Jakarinos #1118 r1 P1: un singur element neînțeles (în ORICE pagină) = nicio concluzie automată, nici „lipsă”, nici „găsit”
  it('borderoul cu un element NEINTERPRETABIL (referința în câmp necunoscut / lipsă / AWB invalid / număr inclus) → TOT „de verificat”, niciodată „lipsă”', () => {
    const bun = { awbNumber: '1000000001', info: { observation: 'PL-TST-0001' } }
    for (const rau of [{ awbNumber: '1000000009', reference: 'PL-TST-0002' }, { awbNumber: '1000000009' }, { info: { observation: 'PL-TST-0002' } },
      { awbNumber: 'X1', info: { observation: 'PL-TST-0002' } }, { awbNumber: '1000000009', info: { observation: 'PL-TST-0002 bis' } }, 'text', null]) {
      for (const pag of [[{ data: [bun, rau] }, { data: [] }], [{ data: [bun] }, { data: [rau] }, { data: [] }]]) {
        const g = cautaInBorderou(pag, ['PL-TST-0001', 'PL-TST-0002'], { complet: true })
        expect([g.get('PL-TST-0001').stare, g.get('PL-TST-0002').stare]).toEqual(['de_verificat', 'de_verificat'])
        expect(g.get('PL-TST-0002').motiv).toMatch(/neinterpretabil/); expect(g.neinterpretabile).toBe(1)
      }
    }
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
// fn_red_fan_tiraj / fn_red_fan_tiraj_opreste SIMULATE după contractul din migrare (semantica SQL reală e probată pe PGlite). Descărcare
// (p_inlocuieste null): oprit → RD021; fără tiraj → începe; aceeași cheie → același; altă cheie → RD020. Înlocuire: CAS pe cheia veche (RD020),
// aceeași cheie → același, altfel cere oprirea de ≥ 30 s (RD022). `stare` se poate împărți între descărcări ca rândul din BD; `stare.acum` = ceasul.
function tirajSimulat(stare = { cheie: null, nr: 0, la: null }) {
  const acum = () => stare.acum ?? Date.now()
  const rasp = s => ({ data: { stare: s, cheie: stare.cheie, nr: stare.nr, inceput_la: stare.la, oprit_la: stare.oprit_la ?? null } })
  const rd = (code, message) => ({ error: { code, message } })
  const schimbat = () => rd('RD020', `redari fan: tirajul s-a schimbat (tirajul nr. ${stare.nr} a inceput cu alt continut); retipareste tot lotul`)
  const f = args => {
    if (args.p_inlocuieste == null) {
      if (stare.oprit_la) return rd('RD021', `redari fan: descarcarile tirajului nr. ${stare.nr} sunt oprite (inlocuire in curs); nimic descarcat`)
      if (stare.cheie && stare.cheie === args.p_cheie) return rasp('acelasi')
      if (stare.cheie == null) { Object.assign(stare, { cheie: args.p_cheie, nr: stare.nr + 1, la: '2026-11-17T16:05:00+00:00' }); return rasp('inceput') }
      return schimbat()
    }
    if (args.p_inlocuieste !== stare.cheie) return schimbat()
    if (args.p_cheie === stare.cheie) return rasp('acelasi')
    if (!stare.oprit_la || acum() - Date.parse(stare.oprit_la) < ASTEPTARE_DUPA_OPRIRE_S * 1000) return rd('RD022', 'redari fan: opreste intai descarcarile si asteapta 30 de secunde')
    Object.assign(stare, { cheie: args.p_cheie, nr: stare.nr + 1, la: '2026-11-17T16:05:00+00:00', oprit_la: null })
    return rasp('inlocuit')
  }
  f.opreste = args => {
    if (args.p_cheie !== stare.cheie) return schimbat()
    stare.oprit_la = args.p_opreste ? (stare.oprit_la || new Date(acum()).toISOString()) : null
    return { data: { stare: stare.oprit_la ? 'oprit' : 'reluat', cheie: stare.cheie, nr: stare.nr, oprit_la: stare.oprit_la } }
  }
  return f
}
// rpc-ul simulat al unui ecran / al funcției edge peste același rând de tiraj (ambele funcții)
const rpcTiraj = sim => async (n, x) => (n === 'fn_red_fan_tiraj_opreste' ? sim.opreste(x) : sim(x))
function depsFake(fx, fan, o = {}) {
  const jurnal = []
  const tiraj = tirajSimulat(o.stareTiraj)
  return { jurnal, deps: {
    secrete: () => ({ username: 'utilizator-fictiv', password: 'parola-fictiva', clientId: 'CLIENT-FICTIV' }),
    randuriLot: async () => ({ data: fx.randuri }),
    proiect: async () => ({ data: { cod: 'TEST-RAZVAN' } }),
    datePlicuri: async () => ({ data: { plicuri: fx.plicuri, convocari: fx.convocari, contacte: fx.contacte } }),
    plicuriLot: async () => ({ data: fx.plicuri }),
    rpc: vi.fn(async (nume, args) => { jurnal.push({ nume, args }); return nume === 'fn_red_fan_claim_lot' ? { data: '99999999-0000-4000-8000-' + String(jurnal.length).padStart(12, '0') }
      : nume === 'fn_red_fan_tiraj' ? tiraj(args) : nume === 'fn_red_fan_tiraj_opreste' ? tiraj.opreste(args)
      : nume === 'fn_red_fan_urmarire' ? { data: { scrise: args.p_randuri.length, pastrate: 0, depasite: 0 } }
      : nume === 'fn_red_fan_confirmari' ? { data: { scrise: args.p_randuri.length, depasite: 0 } } : { data: args.p_rezultate?.length ?? null } }),
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
    expect(w.args.p_rezultate[1].motiv).toBe('FAN a respins expedierea; câmpuri semnalate: phone, recipient (detaliile în selfAWB)')   // fără textul FAN (PII)
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
    const cheie = manifestTiparire({ randuri: fx.randuri, plicuri: fx.plicuri }).cheie
    expect(cheie).toBe('1:PL-TST-0001:2000000001|2:PL-TST-0002:2000000002|3:PL-TST-0003:2000000003')
    const r = await executaActiuneFan({ corp: { actiune: 'eticheta', manifest_cheie: cheie }, lot: LOT }, depsFake(fx, fan).deps)
    const a = fan.apeluri.find(x => x.cale === '/awb/label')
    expect(a.q.getAll('awbs[]')).toEqual(['2000000001', '2000000002', '2000000003']); expect(a.q.get('format')).toBe('A6')
    expect(r.body).toMatchObject({ cod: 'ok', parte: 1, parti: 1, nr_plicuri: ['PL-TST-0001', 'PL-TST-0002', 'PL-TST-0003'], pozitii: [1, 2, 3], ramase: [] })
    expect(Buffer.from(r.body.pdf_base64, 'base64').toString()).toBe('%PDF-1.7 fictiv')
    const fan2 = fanSimulat(() => ({ status: 200, arrayBuffer: async () => new TextEncoder().encode('<html>').buffer }))
    expect((await executaActiuneFan({ corp: { actiune: 'eticheta', manifest_cheie: cheie }, lot: LOT }, depsFake(fx, fan2).deps)).status).toBe(502)
    // manifestul văzut de om (cheia) diferă de evidența de acum → 409, NICIUN apel de etichetă; fără cheie → 400
    const fan3 = fanSimulat(() => ({ status: 200, arrayBuffer: async () => pdf.buffer }))
    expect((await executaActiuneFan({ corp: { actiune: 'eticheta', manifest_cheie: '1:PL-TST-0001:2000000001' }, lot: LOT }, depsFake(fx, fan3).deps)).body.cod).toBe('manifest_schimbat')
    expect((await executaActiuneFan({ corp: { actiune: 'eticheta' }, lot: LOT }, depsFake(fx, fan3).deps)).status).toBe(400)
    expect(fan3.apeluri.filter(x => x.cale === '/awb/label')).toHaveLength(0)
  })
  it('MANIFEST COMUN: plicurile 1-2-3 cu 2 respins → etichetele și documentele = 1, 3 (pozițiile 1, 2); 2 numit „rămas” (Jakarinos #1118 r1 P1)', async () => {
    const fx = await cuAwb(3)
    fx.randuri[1].stare = 'eroare'; fx.randuri[1].awb = null
    const m = manifestTiparire({ randuri: fx.randuri, plicuri: fx.plicuri })
    expect(m.tiparite.map(t => [t.pozitie, t.nr_plic, t.awb])).toEqual([[1, 'PL-TST-0001', '2000000001'], [2, 'PL-TST-0003', '2000000003']])
    expect(m.ramase).toEqual([{ plic_id: 'pl2', nr_plic: 'PL-TST-0002', motiv: 'fără AWB FAN' }])
    const pdf = new TextEncoder().encode('%PDF-1.7 fictiv')
    const fan = fanSimulat(() => ({ status: 200, arrayBuffer: async () => pdf.buffer }))
    const r = await executaActiuneFan({ corp: { actiune: 'eticheta', manifest_cheie: m.cheie }, lot: LOT }, depsFake(fx, fan).deps)
    expect(fan.apeluri.find(x => x.cale === '/awb/label').q.getAll('awbs[]')).toEqual(['2000000001', '2000000003'])
    expect(r.body).toMatchObject({ pozitii: [1, 2], nr_plicuri: ['PL-TST-0001', 'PL-TST-0003'], ramase: ['PL-TST-0002'] })
    const pl = fx.plicuri.map(p => ({ ...p, opis_path: `o/${p.id}` }))
    const cv = Object.fromEntries(pl.map(p => [p.id, [{ conv_id: `c${p.id}`, nr_document: 'C-000001', fisier_convocator_path: `c/${p.id}` }]]))
    const z = planPachetPlicuire(pl, cv, { manifest: m, prefix: 'TEST_' })
    expect(z.fisiere.map(f => f.nume)).toEqual(['TEST_0001_PL-TST-0001_000_opis.docx', 'TEST_0001_PL-TST-0001_001_C-000001.docx', 'TEST_0002_PL-TST-0003_000_opis.docx', 'TEST_0002_PL-TST-0003_001_C-000001.docx'])
    expect(z.plicuri.map(p => [p.pozitie, p.nr_plic, p.documente])).toEqual([[1, 'PL-TST-0001', 2], [2, 'PL-TST-0003', 2]])
    // AWB viu pe un plic anulat între timp: nu se tipărește, e numit
    const m2 = manifestTiparire({ randuri: fx.randuri, plicuri: fx.plicuri.map(p => p.id === 'pl3' ? { ...p, stare: 'anulat' } : p) })
    expect(m2.tiparite.map(t => t.nr_plic)).toEqual(['PL-TST-0001']); expect(m2.ramase.map(r => r.nr_plic)).toEqual(['PL-TST-0002', 'PL-TST-0003'])
    // pagina de control: un DOCX, destinatarul mascat
    expect(destinatarMascat('POPESCU ION')).toBe('PO***** IO*'); expect(destinatarMascat('')).toBe('')
    const b = await genereazaPaginaControl({ lot: { nr_lot: 'PP-0001' }, test: true, randuri: m.tiparite.map(t => ({ ...t, destinatar: 'PO*****', documente: 2 })), ramase: m.ramase })
    expect(b.size).toBeGreaterThan(500)
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
  it('ștergere AWB (Jakarinos #1118 r1 P2): DOAR forma de succes recunoscută anulează; 200 cu eroare / gol / altă formă / 204 → AWB păstrat', async () => {
    expect(interpreteazaStergere(200, { status: 'success' })).toEqual({ rezultat: 'sters' })
    for (const [st, corp] of [[200, { status: 'error', message: 'AWB inexistent' }], [200, null], [200, { status: 'success', errors: ['x'] }], [200, []], [204, null], [201, { status: 'success' }], [0, null], [502, null]])
      expect(interpreteazaStergere(st, corp).rezultat).toBe('necunoscut')
    expect(interpreteazaStergere(404, { status: 'error' }).rezultat).toBe('refuzat')
    const fx = await cuAwb(1)
    fx.randuri[0].id = '00000000-0000-4000-8000-000000000001'
    for (const [corp, codAsteptat, anulat] of [[{ status: 'error' }, 'stergere_neconfirmata', false], [{ ceva: 1 }, 'stergere_neconfirmata', false], [{ status: 'success' }, 'ok', true]]) {
      const { deps, jurnal } = depsFake(fx, fanSimulat(() => raspunsJson(200, corp)))
      expect((await executaActiuneFan({ corp: { actiune: 'sterge_awb', rand_id: fx.randuri[0].id }, lot: LOT }, deps)).body.cod).toBe(codAsteptat)
      expect(jurnal.some(j => j.nume === 'fn_red_fan_anulat')).toBe(anulat)
    }
  })
  it('reconcilierea prin funcția edge: mutantul recenzentului (AWB valid, referința în câmp necunoscut, apoi pagina goală) → „de verificat”, nu „lipsă”', async () => {
    const fx = await fixtura(1)
    fx.randuri[0].stare = 'necunoscut'
    const fan = fanSimulat(u => raspunsJson(200, { data: u.searchParams.get('page') === '1' ? [{ awbNumber: '2000000001', reference: 'PL-TST-0001' }] : [] }))
    const r = await executaActiuneFan({ corp: { actiune: 'reconciliaza', data: '2026-11-17' }, lot: LOT }, depsFake(fx, fan).deps)
    expect(r.body).toMatchObject({ complet: true, neinterpretabile: 1 }); expect(r.body.propuneri[0].stare).toBe('de_verificat')
  })
  it('motivul unui refuz FAN: doar câmpuri din lista albă, fără mesajele / valorile FAN (Jakarinos #1118 r1 P2)', () => {
    expect(campuriEroareFan({ 'recipient.phone': ['Telefonul 0712345678 e invalid'], 'shipments[0].info.weight': 'prea mic', 'Str. Exemplu 5': 'x' })).toEqual(['info', 'phone', 'recipient', 'shipments', 'weight'])
    expect(campuriEroareFan(['Adresa Str. X 5 nu există'])).toEqual([])
    const r = interpreteazaRaspunsLot(200, { response: [{ awbNumber: null, errors: ['Telefonul 0712345678 e invalid'] }] }, 1)[0]
    expect(r).toEqual({ stare: 'eroare', motiv: 'FAN a respins expedierea (fără câmp recunoscut; detaliile în selfAWB)' })
  })
  it('asocierea rezultatelor: referința pe element (dacă FAN o întoarce) trebuie să fie plicul de pe poziție; altfel toată bucata „necunoscut”', async () => {
    const fx = await fixtura(2)
    const fan = fanSimulat(() => raspunsJson(200, { response: [{ awbNumber: '2000000002', info: { observation: 'PL-TST-0002' } }, { awbNumber: '2000000001', info: { observation: 'PL-TST-0001' } }] }))
    const { deps, jurnal } = depsFake(fx, fan)
    const r = await executaActiuneFan({ corp: { actiune: 'genereaza' }, lot: LOT }, deps)
    expect(jurnal.find(j => j.nume === 'fn_red_fan_rezultate').args.p_rezultate.map(x => x.stare)).toEqual(['necunoscut', 'necunoscut'])
    expect(r.body.oprit).toMatch(/neconfirmat/)
    // claim-ul a primit amprenta surselor (aceeași funcție ca fn_red_fan_surse), câte una pe rând
    expect(jurnal.find(j => j.nume === 'fn_red_fan_claim_lot').args.p_surse).toHaveLength(2)
    // fără referință în răspuns: asociere pe poziție, numărată în raport (presupunere de confirmat)
    const fan2 = fanSimulat((u, init) => raspunsJson(200, okPentru(JSON.parse(init.body))))
    expect((await executaActiuneFan({ corp: { actiune: 'genereaza' }, lot: LOT }, depsFake(await fixtura(2), fan2).deps)).body).toMatchObject({ generat: 2, asociere_pe_pozitie: 2 })
  })
})

describe('raspundeFan — poarta funcției edge (ACTIVARE Testul 1: TRANSPORT_REAL_ACTIV = true, DOAR_PROIECTE_TEST = true)', () => {
  const ID_LOT = '11111111-2222-4333-8444-555555555555'
  // implicit: lotul e al unui proiect de TEST și e marcat TEST (garda „doar TEST” trece); testele gărzii suprascriu proiect / fanLot
  const deps = (o = {}) => ({ getUser: async () => ({ data: { user: { id: 'u' } } }), owner: async () => ({ data: true }), lot: vi.fn(async () => ({ data: { id: ID_LOT, proiect_id: 'p1' } })),
    proiect: vi.fn(async () => ({ data: { id: 'p1', cod: 'TEST-RAZVAN' } })), fanLot: vi.fn(async () => ({ data: { lot_id: ID_LOT, test: true, prima_aprobare_la: null } })), ...o })
  it('ACTIVARE Testul 1: transportul real e pornit în cod DOAR pentru proiecte de TEST; comanda curierului nu e acțiune API (manuală în selfAWB)', () => {
    expect(TRANSPORT_REAL_ACTIV).toBe(true)
    expect(DOAR_PROIECTE_TEST).toBe(true)
    expect(ACTIUNI_FAN).not.toContain('comanda_curier')
  })
  it('garda „doar TEST” (o singură definiție, L19): proiect „TEST-…” + lot marcat TEST; marcajul cere doar proiectul', () => {
    expect(esteProiectTest('TEST-RAZVAN')).toBe(true)
    for (const c of ['LOT1-PRUNISOR-JUPA', 'test-razvan', ' TEST-X', 'TESTARE', '', null, undefined, 7]) expect([c, esteProiectTest(c)]).toEqual([c, false])
    expect(transportPermis({ proiectCod: 'TEST-RAZVAN', fanLot: { test: true } })).toEqual({ ok: true, cod: null, motiv: '' })
    expect(transportPermis({ proiectCod: 'LOT1-X', fanLot: { test: true } })).toMatchObject({ ok: false, cod: 'transport_real_doar_test', motiv: expect.stringMatching(/proiecte de TEST/) })
    for (const fanLot of [null, undefined, {}, { test: false }, { test: 'true' }, { test: 1 }])
      expect(transportPermis({ proiectCod: 'TEST-RAZVAN', fanLot })).toMatchObject({ ok: false, cod: 'transport_real_doar_test', motiv: expect.stringMatching(/marcate TEST/) })
    expect(transportPermis({ proiectCod: 'TEST-RAZVAN', fanLot: null, cereMarcaj: false }).ok).toBe(true)
    expect(transportPermis({ proiectCod: 'LOT1-X', fanLot: null, cereMarcaj: false }).ok).toBe(false)
    expect(transportPermis({ proiectCod: 'TEST-RAZVAN', fanLot: { test: true }, transportActiv: false })).toMatchObject({ ok: false, cod: 'transport_real_oprit' })
    expect(transportPermis({ proiectCod: 'LOT1-X', fanLot: { test: false }, doarTest: false }).ok).toBe(true)   // forma Testului 2 (PR separat)
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
  it('GARDA „doar TEST”: owner + lot al unui proiect REAL, ORICE acțiune → 423 transport_real_doar_test, fără NICIUN apel (fetch care pică testul, BD, secrete)', async () => {
    const fetchGlobal = vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('APEL DE REȚEA INTERZIS') })
    const interzis = () => { throw new Error('APEL INTERZIS pe un proiect real') }
    const spioni = { fetch: vi.fn(interzis), rpc: vi.fn(interzis), secrete: vi.fn(interzis), randuriLot: vi.fn(interzis), datePlicuri: vi.fn(interzis), plicuriLot: vi.fn(interzis), pauza: vi.fn(interzis) }
    // (a) proiect real, chiar cu lotul marcat TEST
    for (const actiune of ACTIUNI_FAN) {
      const r = await raspundeFan({ jwt: 'x', corp: { actiune, lot_id: ID_LOT, parte: 1, data: '2026-11-18' } }, deps({ ...spioni, proiect: async () => ({ data: { id: 'p1', cod: 'LOT1-PRUNISOR-JUPA' } }) }))
      expect(r).toMatchObject({ status: 423, body: { cod: 'transport_real_doar_test' } })
    }
    // (b) proiect de TEST, dar lotul NEmarcat sau marcat REAL
    for (const fl of [null, { lot_id: ID_LOT, test: false, prima_aprobare_la: null }]) for (const actiune of ACTIUNI_FAN) {
      const r = await raspundeFan({ jwt: 'x', corp: { actiune, lot_id: ID_LOT, parte: 1, data: '2026-11-18' } }, deps({ ...spioni, fanLot: async () => ({ data: fl }) }))
      expect(r).toMatchObject({ status: 423, body: { cod: 'transport_real_doar_test' } })
    }
    // (c) proiectul invizibil (RLS) sau fără cod = nu e dovedit de test → 423; eroarea de citire ≠ „nu e de test” → 503 (L18)
    expect((await raspundeFan({ jwt: 'x', corp: { actiune: 'evenimente', lot_id: ID_LOT } }, deps({ ...spioni, proiect: async () => ({ data: null }) }))).body.cod).toBe('transport_real_doar_test')
    expect((await raspundeFan({ jwt: 'x', corp: { actiune: 'evenimente', lot_id: ID_LOT } }, deps({ ...spioni, proiect: async () => ({ error: { message: 'x' } }) }))).body.cod).toBe('citire_neconfirmata')
    expect((await raspundeFan({ jwt: 'x', corp: { actiune: 'evenimente', lot_id: ID_LOT } }, deps({ ...spioni, fanLot: async () => ({ error: { message: 'x' } }) }))).body.cod).toBe('citire_neconfirmata')
    for (const s of Object.values(spioni)) expect(s).not.toHaveBeenCalled()
    expect(fetchGlobal).not.toHaveBeenCalled()
    fetchGlobal.mockRestore()
  })
  it('garda „doar TEST” lasă să treacă DOAR proiectul de TEST cu lotul marcat TEST: calea reală începe (secretele se citesc; lipsă = 503 transport_neconfigurat, fără rețea)', async () => {
    const fetchGlobal = vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('APEL DE REȚEA INTERZIS') })
    const secrete = vi.fn(() => null), fetch = vi.fn(() => { throw new Error('APEL INTERZIS fără secrete') })
    for (const actiune of ACTIUNI_FAN) {
      const r = await raspundeFan({ jwt: 'x', corp: { actiune, lot_id: ID_LOT, parte: 1, data: '2026-11-18' } }, deps({ secrete, fetch }))
      expect(r).toEqual({ status: 503, body: { cod: 'transport_neconfigurat' } })
    }
    expect(secrete).toHaveBeenCalledTimes(ACTIUNI_FAN.length)
    expect(fetch).not.toHaveBeenCalled(); expect(fetchGlobal).not.toHaveBeenCalled()
    fetchGlobal.mockRestore()
  })
  it('garda „doar TEST” vine după poarta owner și după lot (un non-owner nu află nimic despre proiect / marcaj)', async () => {
    const proiect = vi.fn(async () => ({ data: { cod: 'TEST-RAZVAN' } })), fanLot = vi.fn(async () => ({ data: { test: true } }))
    expect((await raspundeFan({ jwt: 'x', corp: { actiune: 'evenimente', lot_id: ID_LOT } }, deps({ owner: async () => ({ data: false }), proiect, fanLot }))).status).toBe(403)
    expect((await raspundeFan({ jwt: 'x', corp: { actiune: 'evenimente', lot_id: ID_LOT } }, deps({ lot: async () => ({ data: null }), proiect, fanLot }))).status).toBe(404)
    expect(proiect).not.toHaveBeenCalled(); expect(fanLot).not.toHaveBeenCalled()
  })
  it('funcția edge citește marcajul lotului cu JWT-ul omului (red_fan_loturi, RLS), nu din corp', () => {
    const idx = readFileSync('supabase/functions/redari-fan-awb/index.ts', 'utf8')
    expect(idx).toMatch(/fanLot: \(id: string\) => uc\.from\('red_fan_loturi'\)\.select\('lot_id, test, prima_aprobare_la'\)\.eq\('lot_id', id\)\.maybeSingle\(\)/)
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
  const TEST = { proiectCod: 'TEST-RAZVAN', fanLot: { test: true } }   // lotul pe care garda „doar TEST” îl lasă să treacă
  it('TRANSPORT OPRIT → TOȚI pașii dezactivați, cu „transport oprit” (chiar și pentru owner, cu evidența instalată, pe un lot de TEST)', () => {
    const p = stariPasi({ transportActiv: false, evidentaInstalata: true, esteOwner: true, poateScrie: true, ...TEST, randuri: awb, gataDePropus: 3 })
    expect(p.map(x => x.cheie)).toEqual(['propune', 'aproba', 'genereaza', 'etichete', 'curier', 'urmarire', 'confirmari'])
    expect(p.every(x => x.activ === false && x.motiv === MESAJ_TRANSPORT_OPRIT)).toBe(true)
    expect(stariPasi({}).every(x => !x.activ)).toBe(true)   // implicit = flag-ul din cod + garda „doar TEST” fără proiect → nimic activ
  })
  it('ACTIVARE Testul 1: pe un proiect REAL sau pe un lot nemarcat TEST, TOȚI pașii și TOATE operațiile rămân dezactivate, cu motivul gărzii', () => {
    const baza = { transportActiv: true, evidentaInstalata: true, esteOwner: true, esteAdmin: true, poateScrie: true, randuri: awb, gataDePropus: 3 }
    for (const [caz, re] of [[{ proiectCod: 'LOT1-PRUNISOR-JUPA', fanLot: { test: true } }, /proiecte de TEST/], [{ proiectCod: 'TEST-RAZVAN', fanLot: null }, /marcate TEST/],
      [{ proiectCod: 'TEST-RAZVAN', fanLot: { test: false } }, /marcate TEST/], [{ fanLot: { test: true } }, /proiecte de TEST/]]) {
      expect(stariPasi({ ...baza, ...caz }).every(x => !x.activ && re.test(x.motiv))).toBe(true)
      expect(stariOperatii({ ...baza, ...caz }).every(x => !x.activ && re.test(x.motiv))).toBe(true)
    }
    // marcajul: cere proiectul de TEST, nu și lotul deja marcat (altfel n-ar putea fi marcat niciodată)
    expect(stareMarcaj({ ...baza, proiectCod: 'TEST-RAZVAN', fanLot: null, randuri: [{ stare: 'propus' }] }).activ).toBe(true)
    expect(stareMarcaj({ ...baza, proiectCod: 'LOT1-X', fanLot: null, randuri: [{ stare: 'propus' }] })).toMatchObject({ activ: false, motiv: expect.stringMatching(/proiecte de TEST/) })
    // implicit (flag-ul din cod = pornit) pe un lot de TEST: pașii owner-ului sunt activi
    expect(stariPasi({ evidentaInstalata: true, esteOwner: true, poateScrie: true, ...TEST, randuri: awb, gataDePropus: 3 }).filter(x => x.activ).map(x => x.cheie))
      .toEqual(['propune', 'aproba', 'genereaza', 'etichete', 'curier', 'urmarire', 'confirmari'])
  })
  it('transport pornit (lot de TEST): editorul doar propune; owner-ul aprobă doar după marcajul test / real', () => {
    const ed = stariPasi({ transportActiv: true, evidentaInstalata: true, poateScrie: true, ...TEST, randuri: awb, gataDePropus: 1 })
    expect(ed.filter(x => x.activ).map(x => x.cheie)).toEqual(['propune', 'curier'])
    const ow = stariPasi({ transportActiv: true, evidentaInstalata: true, esteOwner: true, poateScrie: true, proiectCod: 'TEST-RAZVAN', fanLot: null, randuri: awb, gataDePropus: 1 })
    expect(ow.find(x => x.cheie === 'aproba')).toMatchObject({ activ: false, motiv: expect.stringMatching(/marcate TEST/) })   // activare: garda vine înaintea condiției pasului
    expect(stariPasi({ transportActiv: true, evidentaInstalata: false, esteOwner: true, ...TEST }).every(x => /neaplicată/.test(x.motiv))).toBe(true)
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
    expect(stareMarcaj({ transportActiv: false, evidentaInstalata: true, esteOwner: true, ...TEST })).toEqual({ activ: false, motiv: MESAJ_TRANSPORT_OPRIT })
    expect(stareMarcaj({ transportActiv: true, evidentaInstalata: true, esteOwner: true, proiectCod: 'TEST-RAZVAN', randuri: [{ stare: 'propus' }] }).activ).toBe(true)
    expect(stareMarcaj({ transportActiv: true, evidentaInstalata: true, esteOwner: true, proiectCod: 'TEST-RAZVAN', randuri: [{ stare: 'aprobat' }] }).activ).toBe(false)
    expect(stareMarcaj({ transportActiv: true, evidentaInstalata: true, esteOwner: false, proiectCod: 'TEST-RAZVAN' }).activ).toBe(false)
    // Jakarinos #1118 r1 P2: după PRIMA aprobare (istoric), chiar dacă rândurile au redevenit „propus”
    expect(stareMarcaj({ transportActiv: true, evidentaInstalata: true, esteOwner: true, proiectCod: 'TEST-RAZVAN', randuri: [{ stare: 'propus' }], fanLot: { test: true, prima_aprobare_la: '2026-11-17T08:00:00Z' } }))
      .toEqual({ activ: false, motiv: expect.stringMatching(/aprobat o dată/) })
    expect(MIG).toMatch(/IF v_vechi\.prima_aprobare_la IS NOT NULL OR EXISTS/)
  })
  it('ecranul randat (owner, admin) pe un lot NEmarcat (evidența necitită încă): banner-ul activării de TEST și TOATE butoanele de pas dezactivate', () => {
    const html = renderToStaticMarkup(React.createElement(FanAwbPrevizualizare, { proiect: { cod: 'TEST-RAZVAN' }, lot: { id: 'l1', nr_lot: 'PP-0001' }, plicuri: [], esteOwner: true, poateScrie: true, onClose: () => {} }))
    expect(html).toMatch(/Activare de TEST \(Testul 1\)/); expect(html).not.toMatch(/TRANSPORT REAL PORNIT/)
    const butoane = [...html.matchAll(/<button[^>]*>([^<]*(?:<[^/][^>]*>[^<]*)*)<\/button>/g)].filter(m => /^\s*(1\.|2a\.|2b\.|2c\.|3\.|4\.|6\.|6b\.|7\.)/.test(m[1].replace(/<[^>]+>/g, '')))
    expect(butoane.length).toBe(9)
    expect(butoane.every(m => /disabled=""/.test(m[0]))).toBe(true)
    expect((html.match(/marcate TEST/g) || []).length).toBeGreaterThanOrEqual(PASI_FAN.length)
    // proiect real: motivul gărzii pe fiecare pas, și nimic activ
    const real = renderToStaticMarkup(React.createElement(FanAwbPrevizualizare, { proiect: { cod: 'LOT1-PRUNISOR-JUPA' }, lot: { id: 'l1', nr_lot: 'PP-0001' }, plicuri: [], esteOwner: true, poateScrie: true, onClose: () => {} }))
    expect((real.match(/proiecte de TEST/g) || []).length).toBeGreaterThanOrEqual(PASI_FAN.length)
    expect([...real.matchAll(/<button[^>]*>/g)].filter(m => !/disabled=""/.test(m[0])).length).toBeLessThanOrEqual(1)   // doar „închide” din Modal
  })
  it('operațiile procedurii (Jakarinos #1118 r1 P2): reconciliere, plafon, anulare, evenimente — vizibile, dezactivate cu transportul oprit', () => {
    expect(stariOperatii({ transportActiv: false, evidentaInstalata: true, esteOwner: true, ...TEST, randuri: [{ stare: 'necunoscut' }, { stare: 'generat' }] }).every(o => !o.activ && o.motiv === MESAJ_TRANSPORT_OPRIT)).toBe(true)
    const on = stariOperatii({ transportActiv: true, evidentaInstalata: true, esteOwner: true, ...TEST, randuri: [{ stare: 'generat' }] })
    expect(on.filter(o => o.activ).map(o => o.cheie)).toEqual(['plafon', 'anulare', 'evenimente', 'tiraj'])
    expect(stariOperatii({ transportActiv: true, evidentaInstalata: true, esteOwner: false, ...TEST, randuri: [{ stare: 'necunoscut' }] }).every(o => !o.activ)).toBe(true)
    const html = renderToStaticMarkup(React.createElement(FanAwbPrevizualizare, { proiect: { cod: 'TEST-RAZVAN' }, lot: { id: 'l1', nr_lot: 'PP-0001' }, plicuri: [], esteOwner: true, poateScrie: true, onClose: () => {} }))
    for (const t of ['Reconciliază (borderoul zilei)', 'Schimbă plafonul', 'Șterge la FAN', 'Marchează anulat', 'Lista de evenimente FAN', 'Tiraj nou — 1. Oprește descărcările',
      '2. Înlocuiește tirajul', 'Reia descărcările (fără tiraj nou)']) {
      const b = [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].find(m => m[1].includes(t))
      expect([t, !!b && /disabled=""/.test(b[0])]).toEqual([t, true])
    }
    expect(html).toMatch(/Pagina de control/)
    expect(numeEtichete({ lot: { nr_lot: 'PP-0001' }, fanLot: { test: true }, parte: 2, parti: 3, format: 'A6' })).toBe('TEST_PP-0001_etichete_A6_partea02din03.pdf')
  })
  it('L24 în ecran: acțiunile au generația lor, verificată înaintea FIECĂRUI apel din bucle și în catch / finally', () => {
    const src = readFileSync('src/redari/ui/FanAwbPrevizualizare.jsx', 'utf8')
    expect(src).toMatch(/for \(const x of lista\) \{\s*if \(!curent\(\)\) return/)
    expect(src).toMatch(/catch \(e\) \{ if \(curent\(\)\) setMesaj/); expect(src).toMatch(/finally \{ if \(curent\(\)\) \{ ocupat\.current = false/)
    expect(src).not.toMatch(/for \(const r of randuri\.filter\(x => x\.ok\)\)/)   // vechea buclă de propunere, fără gardă
  })
  it('PASI_FAN acoperă exact pașii ceruți, în ordine', () => {
    expect(PASI_FAN.map(p => p.titlu)).toEqual(['1. Propune', '2. Aprobă', '3. Generează AWB', '4. Etichete A6', '5. Comandă curier', '6. Urmărire', '7. Confirmări / retururi'])
  })
})

// Runda 2 (verdictul Jakarinos pe PR #1130, P2 1): procedura zilei trebuie să fie EXECUTABILĂ din ecran, în ordinea scrisă în document.
// Simulatorul (fanProcedura.testutil.js) pornește de la LOT GOL și apasă, pas cu pas, doar butoanele pe care stariPasi / stareMarcaj /
// stariOperatii le dau active; ordinea din 9ceea228 (plafon înaintea marcajului, „Propune” înaintea „Marchează TEST”) pică aici (dovada: fanCourierMutanti.test.js).
describe('procedura Testului 1 din document (FAN_TEST1_PASI.md §5–§8), executabilă din ecran de la lot gol până la prima generare', () => {
  const FN = { stariPasi, stareMarcaj, stariOperatii }
  const pasi = pasiDinDocument(PASI_DOC, '## 5.', '## 9.')
  it('documentul are pașii cu butoane, în ordinea: marcaj TEST → lista de evenimente → plafon 1 → propune → aprobă → generează → etichete', () => {
    expect(pasi.filter(p => p.buton).map(p => p.buton.cheie)).toEqual(['marcaj_test', 'evenimente', 'plafon', 'propune', 'aproba', 'genereaza', 'etichete', 'etichete'])
    expect(pasi.find(p => p.buton?.cheie === 'plafon').buton.valoare).toBe(1)
    // butoanele din document sunt cele din ecran (textele exacte ale lui FanAwbPrevizualizare.jsx)
    const src = readFileSync('src/redari/ui/FanAwbPrevizualizare.jsx', 'utf8')
    for (const t of ['2a. Marchează TEST', 'Lista de evenimente FAN', 'Schimbă plafonul', '1. Propune', '2c. Aprobă', 'Etichete']) expect(src).toContain(t)
    expect(butonDin('selfAWB (contul de TEST) → AWB-urile zilei')).toBeNull(); expect(butonDin('ERP: rândul FAN al plicului')).toBeNull()
  })
  it('fiecare pas e activ în ecran în momentul lui; starea butoanelor după fiecare pas, scrisă de mână (L25)', () => {
    const { lot, jurnal } = parcurge(pasi, FN)
    const dupa = k => jurnal.find(j => j.buton === k)
    // lot gol, nemarcat, un plic complet: SINGURUL buton activ e marcajul (nici „Propune”, nici plafonul — garda „doar TEST”)
    expect(dupa('marcaj_test').inainte).toEqual(['marcaj_test'])
    expect(dupa('marcaj_test').dupa).toEqual(['evenimente', 'marcaj_test', 'plafon', 'propune'])   // după marcaj: propunerea, plafonul, lista; aprobarea încă nu (niciun plic propus)
    expect(dupa('plafon').inainte).toContain('plafon'); expect(dupa('plafon').inainte).not.toContain('aproba')
    expect(dupa('propune').dupa).toEqual(['aproba', 'evenimente', 'marcaj_test', 'plafon', 'propune'])   // după propunere: aprobarea; marcajul încă se poate schimba
    expect(dupa('aproba').dupa).toEqual(['evenimente', 'genereaza', 'plafon', 'propune'])   // după aprobare: generarea; marcajul e fixat (prima aprobare)
    expect(dupa('genereaza').dupa).toEqual(['anulare', 'confirmari', 'curier', 'etichete', 'evenimente', 'plafon', 'propune', 'tiraj', 'urmarire'])
    expect(lot.randuri).toEqual([{ id: 'r1', stare: 'generat', awb: '3000000001' }]); expect(lot.limita).toBe(1); expect(lot.fanLot.test).toBe(true)
  })
  it('o ordine imposibilă e prinsă: „Propune” sau plafonul înaintea marcajului, aprobarea fără propunere, generarea fără aprobare', () => {
    const pas = (nr, cine, text) => ({ nr, cine, text, buton: butonDin(text) })
    expect(() => parcurge([pas('1', 'admin / editor Redări (sau owner-ul)', '„1. Propune 1 plicuri”')], FN)).toThrow(/pasul 1: .*nu e activ.*marcate TEST/)
    expect(() => parcurge([pas('1', 'owner', 'caseta „Plafonul lotului pilot” → `1` → „Schimbă plafonul”')], FN)).toThrow(/pasul 1: .*marcate TEST/)
    expect(() => parcurge([pas('1', 'owner', '„2a. Marchează TEST”'), pas('2', 'owner', '„2c. Aprobă”')], FN)).toThrow(/pasul 2: .*niciun plic propus/)
    expect(() => parcurge([pas('1', 'owner', '„2a. Marchează TEST”'), pas('2', 'owner', '„1. Propune 1 plicuri”'), pas('3', 'owner', '„3. Generează AWB”')], FN)).toThrow(/pasul 3: .*niciun plic aprobat/)
    // regula BD simulată după fn_red_fan_aproba: plafonul 1 refuză lotul de 3 (aprobarea nu se face); plafonul 3 îl lasă
    const trei = [pas('1', 'owner', '„2a. Marchează TEST”'), pas('2', 'owner', '`1` → „Schimbă plafonul”'), pas('3', 'owner', '„1. Propune 3 plicuri”'), pas('4', 'owner', '„2c. Aprobă”')]
    expect(() => parcurge(trei, FN, { plicuri: 3 })).toThrow(/pasul 4: 3 plicuri peste plafonul 1/)
    expect(parcurge([trei[0], pas('2', 'owner', '`3` → „Schimbă plafonul”'), ...trei.slice(2)], FN, { plicuri: 3 }).lot.randuri.every(r => r.stare === 'aprobat')).toBe(true)
    // un proiect real: nici marcajul nu e activ (nimic nu se poate începe)
    expect(() => parcurge([pas('1', 'owner', '„2a. Marchează TEST”')], FN, { proiectCod: 'LOT1-PRUNISOR-JUPA' })).toThrow(/proiecte de TEST/)
  })
  it('documentul: opririle cerute de secțiunea Testul 1 (tarif gol / diferit, referința absentă de pe etichetă), derogarea doar a proprietarului, plafonul 20 spus o singură dată', () => {
    const d = PASI_DOC.replace(/\r/g, '')
    expect(d).toMatch(/Tarif \*\*gol sau diferit = OPRIRE\*\*/); expect(d).toMatch(/\*\*NU = OPRIRE\*\*/); expect(d).toMatch(/scrierea de mână pe plic NU e procedura/)
    expect(d).not.toMatch(/se scrie de mână pe plic\b(?! NU)/); expect(d).not.toMatch(/sau gol = „necunoscut”, de notat/)
    expect(d).toMatch(/Derogări\*\*: orice continuare .* o decide DOAR proprietarul, explicit, scrisă în jurnal/)
    // plafonul 20: un singur moment (încheierea Testului 1), spus în §6 și referit din §12
    expect((d.match(/\*\*20\*\* la\s+încheierea Testului 1/g) || []).length).toBe(1); expect(d).not.toMatch(/înapoi la \*\*20\*\* după Testul 2/)
    expect(d).toMatch(/calendarul din §6: 20 la încheierea Testului 1/)
    // oprirea de urgență: ce oprește și ce nu; cererile în curs; jurnalul nu arată apelurile ieșite
    expect(d).toMatch(/\*\*o cerere deja începută\*\*: continuă cu secretele capturate/); expect(d).not.toMatch(/orice apel\s+răspunde 503 `transport_neconfigurat`, fără niciun apel la curier \(secretele se citesc la fiecare cerere\)/)
    expect(d).toMatch(/absența unei linii `POST \/login`\s+nu dovedește nimic\*\* singură/); expect(d).toMatch(/fără reapăsare\*\* pe nimic/)
    // lista omului din ziua testului (verdict): ID-uri, fără redenumiri, commit-ul, probele pe versiunea inertă, contul / clientId / costuri, asocierea, oprirea, anularea
    for (const t of ['ID-ul proiectului', 'ID-ul lotului', 'nu se redenumesc proiecte și nu se schimbă marcaje de lot', 'commit-ul publicat', 'versiunea INERTĂ', 'contul de TEST al curierului, `clientId`-ul lui și costurile',
      'asocierea AWB ↔ plic verificată în selfAWB', 'oprire la orice rezultat ambiguu', 'anularea AWB-ului înainte de ridicare']) expect(d).toContain(t)
    // aliniat cu documentul de proiectare: ordinea 4a și deschisa 12 fără „se scrie de mână” ca procedură
    const doc = DOC.replace(/\r/g, '')
    expect(doc).toMatch(/\| 4a \| \*\*\(runda 3, BLOCANT[^\n]*„Marchează TEST”[^\n]*plafonul[^\n]*„Propune”[^\n]*„Aprobă”[^\n]*„Generează AWB”/)
    expect(doc).toMatch(/\| 2 \| Owner: „Marchează TEST”/); expect(doc).toMatch(/\| 3 \| Admin\/editor: „Propune 3 plicuri”; apoi owner: „Aprobă”/)
    expect(doc).not.toMatch(/altfel numărul plicului se scrie de mână pe plic/); expect(doc).toMatch(/lipsa lui = OPRIRE la Testul 1/)
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
    // Jakarinos #1118 r1 P2: plicul pe 4 cifre, documentul pe 3 (opisul = 000) → sortarea lexicală a numelor = ordinea de tipărire
    expect(p.fisiere.map(f => f.nume)).toEqual(['0001_PL-TST-0001_000_opis.docx', '0001_PL-TST-0001_001_C-000002.docx', '0001_PL-TST-0001_002_C-000010.docx', '0002_PL-TST-0002_000_opis.docx', '0002_PL-TST-0002_001_C-000003.docx'])
    expect(planPachetPlicuire(pl, cv, { prefix: 'TEST_' }).fisiere[0].nume).toBe('TEST_0001_PL-TST-0001_000_opis.docx')
  })
  it('numele din arhivă: 12 convocări într-un plic și 12 plicuri → sortarea lexicală = ordinea inserării (convocarea 10 după 9, plicul 10 după 9)', () => {
    const pl12 = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, nr_plic: `PL-TST-${String(i + 1).padStart(4, '0')}`, stare: 'activ', opis_path: `o${i}` }))
    const cv12 = Object.fromEntries(pl12.map((p, i) => [p.id, Array.from({ length: i === 0 ? 12 : 1 }, (_, k) => ({ conv_id: `c${i}_${k}`, nr_document: `C-${String(k + 1).padStart(6, '0')}`, fisier_convocator_path: `f${i}_${k}` }))]))
    const nume = planPachetPlicuire(pl12, cv12).fisiere.map(f => f.nume)
    expect([...nume].sort()).toEqual(nume)
    expect(nume).toContain('0001_PL-TST-0001_012_C-000012.docx'); expect(nume).toContain('0012_PL-TST-0012_000_opis.docx')
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

// ── runda 3 (verdictul Jakarinos #1118 r2): tirajul, pagina de control identică, urmărirea fără evenimente ──
describe('runda 3: TIRAJUL — aceeași cheie de manifest pentru toate descărcările unui lot (r2 P1)', () => {
  const pdf = new TextEncoder().encode('%PDF-1.7 fictiv')
  const eticheta = () => ({ status: 200, arrayBuffer: async () => pdf.buffer, json: async () => null })
  const cuAwb = async n => { const fx = await fixtura(n); fx.randuri.forEach((r, i) => { r.stare = 'generat'; r.awb = String(2000000001 + i) }); return fx }
  it('cheia tirajului: sha256 pe manifest, în ordine; id = primele 8 caractere; manifest gol = fără tiraj', async () => {
    const fx = await cuAwb(3)
    const m = manifestTiparire({ randuri: fx.randuri, plicuri: fx.plicuri })
    const k = await cheieTiraj(m, webcrypto.subtle)
    // valoarea așteptată calculată independent (node:crypto), pe textul documentat: versiune | cheia manifestului
    expect(k).toBe(createHash('sha256').update(`${VERSIUNE_TIRAJ}|1:PL-TST-0001:2000000001|2:PL-TST-0002:2000000002|3:PL-TST-0003:2000000003`).digest('hex'))
    expect(idTiraj(k)).toBe(k.slice(0, 8).toUpperCase()); expect(idTiraj('xyz')).toBe(null)
    const fx2 = await cuAwb(3); fx2.randuri[1].stare = 'eroare'; fx2.randuri[1].awb = null
    expect(await cheieTiraj(manifestTiparire({ randuri: fx2.randuri, plicuri: fx2.plicuri }), webcrypto.subtle)).not.toBe(k)
    await expect(cheieTiraj({ tiparite: [], cheie: '' }, webcrypto.subtle)).rejects.toThrow(/nu există tiraj/)
  })
  it('tirajDin: DOAR forma exactă și cheia cerută (L18): altă cheie / nr lipsă / stare necunoscută / moment invalid = neconfirmat', () => {
    const k = 'a'.repeat(64), bun = { stare: 'inceput', cheie: k, nr: 1, inceput_la: '2026-11-17T16:05:00+00:00' }
    expect(tirajDin(bun, k)).toEqual({ stare: 'inceput', cheie: k, id: 'AAAAAAAA', nr: 1, inceput_la: bun.inceput_la })
    for (const rau of [null, [], { ...bun, cheie: 'b'.repeat(64) }, { ...bun, nr: 0 }, { ...bun, nr: '1' }, { ...bun, stare: 'ok' }, { ...bun, inceput_la: 'ieri' }, { ...bun, inceput_la: null }])
      expect(tirajDin(rau, k)).toBe(null)
  })
  it('SCENARIUL RECENZENTULUI: etichete 1, 3 (2 respins) → tirajul începe; 2 rezolvat → arhiva ȘI o parte nouă de etichete = refuz; „Tiraj nou” (owner, CAS) → toate trec', async () => {
    const stare = { cheie: null, nr: 0, la: null }
    const fx = await cuAwb(3); fx.randuri[1].stare = 'eroare'; fx.randuri[1].awb = null
    const m13 = manifestTiparire({ randuri: fx.randuri, plicuri: fx.plicuri })
    const fan = fanSimulat(eticheta)
    const d = depsFake(fx, fan, { stareTiraj: stare })
    const a = await executaActiuneFan({ corp: { actiune: 'eticheta', manifest_cheie: m13.cheie }, lot: LOT }, d.deps)
    const k13 = await cheieTiraj(m13, webcrypto.subtle)
    expect(a.body).toMatchObject({ cod: 'ok', pozitii: [1, 2], tiraj: { id: idTiraj(k13), cheie: k13, nr: 1 } })
    expect(d.jurnal.find(j => j.nume === 'fn_red_fan_tiraj').args).toEqual({ p_lot_id: LOT.id, p_cheie: k13, p_inlocuieste: null })
    // arhiva documentelor în ACEEAȘI stare: același tiraj, documentele cu identificatorul lui
    const pl = fx.plicuri.map(p => ({ ...p, opis_path: `o/${p.id}` }))
    const cv = Object.fromEntries(pl.map(p => [p.id, [{ conv_id: `c${p.id}`, nr_document: 'C-000001', fisier_convocator_path: `c/${p.id}` }]]))
    const sim = tirajSimulat(stare), rpc = async (n, x) => sim(x)
    const arh = await pregatestePachetFan({ rpc, lot: LOT, fanLot: { test: true }, randuriFan: fx.randuri, plicuri: pl, convocariPePlic: cv, subtle: webcrypto.subtle })
    expect(arh.tiraj.id).toBe(idTiraj(k13))
    expect(arh.plan.fisiere.map(f => f.nume)).toEqual([`TEST_0001_PL-TST-0001_000_opis_T${idTiraj(k13)}.docx`, `TEST_0001_PL-TST-0001_001_C-000001_T${idTiraj(k13)}.docx`,
      `TEST_0002_PL-TST-0003_000_opis_T${idTiraj(k13)}.docx`, `TEST_0002_PL-TST-0003_001_C-000001_T${idTiraj(k13)}.docx`])
    // plicul 2 rezolvat (AWB generat): manifestul 1, 2, 3
    fx.randuri[1].stare = 'generat'; fx.randuri[1].awb = '2000000002'
    const m123 = manifestTiparire({ randuri: fx.randuri, plicuri: fx.plicuri })
    await expect(pregatestePachetFan({ rpc, lot: LOT, fanLot: { test: true }, randuriFan: fx.randuri, plicuri: pl, convocariPePlic: cv, subtle: webcrypto.subtle }))
      .rejects.toMatchObject({ code: 'RD020', message: MESAJ_TIRAJ_SCHIMBAT })
    const fan2 = fanSimulat(eticheta)
    const b = await executaActiuneFan({ corp: { actiune: 'eticheta', manifest_cheie: m123.cheie }, lot: LOT }, depsFake(fx, fan2, { stareTiraj: stare }).deps)
    expect(b).toMatchObject({ status: 409, body: { cod: 'tiraj_schimbat', motiv: MESAJ_TIRAJ_SCHIMBAT } })
    expect(fan2.apeluri.filter(x => x.cale === '/awb/label')).toHaveLength(0)   // nimic cerut de la FAN
    expect(mesajEdgeFan({ data: b.body })).toMatch(/retipărește tot lotul/)
    // „Tiraj nou” (owner, CAS pe cheia veche): după el etichetele ȘI arhiva trec, cu identificatorul nou
    const k123 = await cheieTiraj(m123, webcrypto.subtle)
    expect(sim({ p_lot_id: LOT.id, p_cheie: k123, p_inlocuieste: 'f'.repeat(64) }).error.code).toBe('RD020')
    // runda 4: înlocuirea cere întâi OPRIREA descărcărilor și cele 30 s (RD022 altfel), apoi trece
    expect(sim({ p_lot_id: LOT.id, p_cheie: k123, p_inlocuieste: k13 }).error.code).toBe('RD022')
    stare.acum = Date.parse('2026-11-17T17:00:00Z')
    expect(sim.opreste({ p_lot_id: LOT.id, p_cheie: k13, p_opreste: true }).data).toMatchObject({ stare: 'oprit' })
    expect(sim({ p_lot_id: LOT.id, p_cheie: k123, p_inlocuieste: k13 }).error.code).toBe('RD022')
    stare.acum += ASTEPTARE_DUPA_OPRIRE_S * 1000
    expect(sim({ p_lot_id: LOT.id, p_cheie: k123, p_inlocuieste: k13 }).data).toMatchObject({ stare: 'inlocuit', nr: 2, oprit_la: null })
    const c = await executaActiuneFan({ corp: { actiune: 'eticheta', manifest_cheie: m123.cheie }, lot: LOT }, depsFake(fx, fanSimulat(eticheta), { stareTiraj: stare }).deps)
    expect(c.body).toMatchObject({ cod: 'ok', pozitii: [1, 2, 3], tiraj: { id: idTiraj(k123), nr: 2 } })
    expect((await pregatestePachetFan({ rpc, lot: LOT, fanLot: { test: true }, randuriFan: fx.randuri, plicuri: pl, convocariPePlic: cv, subtle: webcrypto.subtle })).tiraj.nr).toBe(2)
  })
  it('PĂRȚILE etichetelor: fiecare parte cere tirajul; o schimbare între partea 1 și partea 2 = refuz la partea 2, nimic tipărit', async () => {
    const stare = { cheie: null, nr: 0, la: null }
    const fx = await cuAwb(150)
    const m = manifestTiparire({ randuri: fx.randuri, plicuri: fx.plicuri })
    const p1 = await executaActiuneFan({ corp: { actiune: 'eticheta', parte: 1, manifest_cheie: m.cheie }, lot: LOT }, depsFake(fx, fanSimulat(eticheta), { stareTiraj: stare }).deps)
    expect(p1.body).toMatchObject({ cod: 'ok', parte: 1, parti: 2 })
    fx.randuri[149].stare = 'anulat'
    const m2 = manifestTiparire({ randuri: fx.randuri, plicuri: fx.plicuri })
    const fan = fanSimulat(eticheta)
    const p2 = await executaActiuneFan({ corp: { actiune: 'eticheta', parte: 2, manifest_cheie: m2.cheie }, lot: LOT }, depsFake(fx, fan, { stareTiraj: stare }).deps)
    expect(p2.body.cod).toBe('tiraj_schimbat'); expect(fan.apeluri.filter(x => x.cale === '/awb/label')).toHaveLength(0)
  })
  it('tirajul neconfirmat (eroare de BD ≠ RD020, formă greșită, altă cheie) → 503, nicio etichetă cerută (L18)', async () => {
    const fx = await cuAwb(2)
    const m = manifestTiparire({ randuri: fx.randuri, plicuri: fx.plicuri })
    for (const raspuns of [{ error: { code: '57014', message: 'timeout' } }, { data: null }, { data: { stare: 'inceput', cheie: 'e'.repeat(64), nr: 1, inceput_la: '2026-11-17T16:05:00Z' } }]) {
      const fan = fanSimulat(eticheta)
      const d = depsFake(fx, fan)
      d.deps.rpc.mockImplementation(async nume => (nume === 'fn_red_fan_tiraj' ? raspuns : { data: null }))
      const r = await executaActiuneFan({ corp: { actiune: 'eticheta', manifest_cheie: m.cheie }, lot: LOT }, d.deps)
      expect([r.status, r.body.cod]).toEqual([503, 'tiraj_neconfirmat']); expect(fan.apeluri.filter(x => x.cale === '/awb/label')).toHaveLength(0)
    }
  })
  it('arhiva: lipsurile se raportează ÎNAINTE de tiraj (nu începe un tiraj pentru o arhivă care nu se poate face); eroarea BD ≠ RD020 se propagă', async () => {
    const fx = await cuAwb(2)
    const rpc = vi.fn(async () => ({ data: null }))
    await expect(pregatestePachetFan({ rpc, lot: LOT, fanLot: { test: false }, randuriFan: fx.randuri, plicuri: fx.plicuri, convocariPePlic: {}, subtle: webcrypto.subtle }))
      .rejects.toMatchObject({ code: '23514' })
    expect(rpc).not.toHaveBeenCalled()
    const pl = fx.plicuri.map(p => ({ ...p, opis_path: `o/${p.id}` }))
    const cv = Object.fromEntries(pl.map(p => [p.id, [{ conv_id: `c${p.id}`, nr_document: 'C-000001', fisier_convocator_path: `c/${p.id}` }]]))
    await expect(pregatestePachetFan({ rpc: async () => ({ error: { code: '42501', message: 'fara drept' } }), lot: LOT, fanLot: { test: false }, randuriFan: fx.randuri, plicuri: pl, convocariPePlic: cv, subtle: webcrypto.subtle }))
      .rejects.toMatchObject({ code: '42501' })
    await expect(pregatestePachetFan({ rpc: async () => ({ data: { stare: 'ok' } }), lot: LOT, fanLot: { test: false }, randuriFan: fx.randuri, plicuri: pl, convocariPePlic: cv, subtle: webcrypto.subtle }))
      .rejects.toThrow(/nu s-a putut verifica/)
  })
})

describe('runda 3: pagina de control IDENTICĂ în etichete și în arhivă (r2 P1 + L24)', () => {
  it('aceeași funcție, aceleași intrări → același conținut (inclusiv numărul documentelor), tirajul în loc de data zilei, numele cu tirajul', async () => {
    const fx = await fixtura(3)
    fx.randuri.forEach((r, i) => { r.stare = i === 1 ? 'eroare' : 'generat'; r.awb = i === 1 ? null : String(2000000001 + i) })
    const pl = fx.plicuri.map(p => ({ ...p, opis_path: `o/${p.id}` }))
    const cv = { pl1: [{ conv_id: 'c1', nr_document: 'C-000001', fisier_convocator_path: 'f1' }, { conv_id: 'c2', nr_document: 'C-000002', fisier_convocator_path: 'f2' }],
      pl2: [{ conv_id: 'c3', nr_document: 'C-000003', fisier_convocator_path: 'f3' }], pl3: [{ conv_id: 'c4', nr_document: 'C-000004', fisier_convocator_path: 'f4' }] }
    const stare = { cheie: null, nr: 0, la: null }, sim = tirajSimulat(stare)
    const arh = await pregatestePachetFan({ rpc: async (n, x) => sim(x), lot: LOT, fanLot: { test: false }, randuriFan: fx.randuri, plicuri: pl, convocariPePlic: cv, subtle: webcrypto.subtle })
    const dinEtichete = controlLotFan({ lot: LOT, fanLot: { test: false }, manifest: manifestTiparire({ randuri: fx.randuri, plicuri: pl }), plicuri: pl, convocariPePlic: cv,
      tiraj: { id: arh.tiraj.id, cheie: arh.tiraj.cheie, nr: 1, inceput_la: '2026-11-17T16:05:00+00:00' } }).continut
    expect(dinEtichete).toEqual(arh.continut)
    expect(arh.continut.tabel.randuri).toEqual([['0001', 'PL-TST-0001', '2000000001', 'PE****** FI*****', 3, '☐'], ['0002', 'PL-TST-0003', '2000000003', 'PE****** FI*****', 2, '☐']])
    expect(arh.continut.titlu).toBe(`Pagina de control - lotul PP-0001 - tirajul ${arh.tiraj.id}`)
    expect(arh.continut.paragrafe[0]).toMatch(new RegExp(`^Tirajul ${arh.tiraj.id} \\(nr\\. 1 al lotului\\), început la 17\\.11\\.2026 18:05\\.`))
    expect(arh.continut.paragrafe.some(p => p.startsWith('Data:'))).toBe(false)
    expect(arh.continut.paragrafe.join(' ')).toMatch(/PL-TST-0002 \(fără AWB FAN\)/)
    const t = arh.tiraj
    expect(numeEtichete({ lot: LOT, fanLot: { test: false }, parte: 1, parti: 2, format: 'A6', tiraj: t })).toBe(`PP-0001_tiraj-${t.id}_etichete_A6_partea01din02.pdf`)
    expect(numeControl({ lot: LOT, fanLot: { test: true }, tiraj: t })).toBe(`TEST_PP-0001_tiraj-${t.id}_pagina_de_control.docx`)
    expect(numeControl({ lot: LOT, fanLot: { test: true }, tiraj: t, inArhiva: true })).toBe(`TEST_0000_tiraj-${t.id}_pagina_de_control.docx`)
    expect(numeArhiva({ lot: LOT, fanLot: { test: false }, tiraj: t })).toBe(`PP-0001_tiraj-${t.id}_documente_in_ordinea_plicurilor.zip`)
    // fără tiraj (lot de Poștă): numele și pagina de dinainte (data zilei)
    expect(numeArhiva({ lot: LOT, fanLot: null })).toBe('PP-0001_documente_in_ordinea_plicurilor.zip')
    expect(continutPaginaControl({ lot: LOT, randuri: [] }).paragrafe[0]).toMatch(/^Data: /)
    expect((await docxPaginaControl(arh.continut)).size).toBeGreaterThan(500)
  })
  it('momentBucuresti: ora României (iarna UTC+2, vara UTC+3), formă necunoscută = textul (L17)', () => {
    expect(momentBucuresti('2026-11-17T16:05:00+00:00')).toBe('17.11.2026 18:05'); expect(momentBucuresti('2026-07-01T10:00:00Z')).toBe('01.07.2026 13:00')
    expect(momentBucuresti('ieri')).toBe('ieri')
  })
  it('ecranele folosesc funcția comună: etichetele trimit convocările pe plic, arhiva trece prin pregatestePachetFan, evidența citește tirajul', () => {
    const fan = readFileSync('src/redari/ui/FanAwbPrevizualizare.jsx', 'utf8'), pe = readFileSync('src/redari/ui/PlicuriEcran.jsx', 'utf8')
    expect(fan).toMatch(/docxPaginaControl\(controlLotFan\(\{ lot, fanLot: fan\?\.fanLot, manifest, plicuri, convocariPePlic, tiraj \}\)\.continut\)/)
    expect(fan).toMatch(/select\('lot_id,test,prima_aprobare_la,tiraj_cheie,tiraj_nr,tiraj_la,tiraj_oprit_la'\)/)
    expect(pe).toMatch(/<FanAwbPrevizualizare proiect=\{proiect\} lot=\{fanLot\} plicuri=\{[^\n]*\} convocariPePlic=\{pePlic\}/)
    expect(pe).toMatch(/const control = await docxPaginaControl\(continut\)\s*\n\s*if \(!curent\(\)\) return/)
    expect(pe).toMatch(/pregatestePachetFan\(\{ rpc: \(n, a\) => supabase\.rpc\(n, a\), lot: rand, fanLot: ev\.fanLot, randuriFan: ev\.randuri, plicuri: lista, convocariPePlic: pePlic \}\)\s*\n\s*if \(!curent\(\)\) return/)
    expect(pe).not.toMatch(/manifestTiparire\(/)   // arhiva nu-și mai construiește singură manifestul
  })
  it('L24 (r2): descărcarea paginii de control se face DOAR după reverificarea generației, după await; tirajul din răspuns = manifestul afișat', () => {
    const src = readFileSync('src/redari/ui/FanAwbPrevizualizare.jsx', 'utf8')
    expect(src).toMatch(/control = await paginaControl\(tiraj\); if \(!curent\(\)\) return OPRIT \}/)
    const i = src.indexOf('control = await paginaControl(tiraj)'), j = src.indexOf("descarcaBlob(new Blob([bytes], { type: 'application/pdf' })")
    expect(i).toBeGreaterThan(0); expect(j).toBeGreaterThan(i)   // nimic descărcat înaintea reverificării
    expect(src).toMatch(/corp\.manifest_cheie === manifest\.cheie && cheieAcum \?/)
  })
})

describe('runda 3: urmărirea nu șterge un eveniment cunoscut (r2 P2)', () => {
  it('parserul: lista lipsă ≠ listă goală; `events: []` = fără evenimente, fără cronologie (ultim_eveniment_la null)', () => {
    expect(rezumatUrmarireFan({ awbNumber: '2000000001' })).toMatchObject({ urmarire_stare: 'de_verificat', motiv: 'elementul de urmărire nu are lista de evenimente' })
    expect(rezumatUrmarireFan({ awbNumber: '2000000001', events: null }).urmarire_stare).toBe('de_verificat')
    expect(rezumatUrmarireFan({ awbNumber: '2000000001', events: [] })).toEqual({ urmarire_stare: 'fara_evenimente', ultim_eveniment: null, ultim_eveniment_la: null,
      ridicat_propus: null, livrat_la: null, retur_propus: null })
  })
  it('funcția edge: răspunsul `events: []` ajunge în BD fără cronologie; „păstrate” raportate; forma veche {scrise, depasite} = scriere neconfirmată', async () => {
    const fx = await fixtura(2); fx.randuri.forEach((r, i) => { r.stare = 'generat'; r.awb = String(2000000001 + i); r.versiune_urmarire = 4 })
    const fan = fanSimulat(u => raspunsJson(200, { data: u.searchParams.getAll('awb[]').map(a => ({ awbNumber: a, events: [] })) }))
    const d = depsFake(fx, fan)
    d.deps.rpc.mockImplementation(async (nume, args) => { d.jurnal.push({ nume, args }); return { data: { scrise: 0, pastrate: 2, depasite: 0 } } })
    const r = await executaActiuneFan({ corp: { actiune: 'urmarire' }, lot: LOT }, d.deps)
    expect(r.body).toMatchObject({ cod: 'ok', scrise: 0, pastrate: 2, depasite: 0 })
    expect(d.jurnal[0].args.p_randuri.map(x => [x.versiune, x.urmarire_stare, x.ultim_eveniment_la, x.ridicat_propus])).toEqual([[4, 'fara_evenimente', null, null], [4, 'fara_evenimente', null, null]])
    d.deps.rpc.mockImplementation(async () => ({ data: { scrise: 2, depasite: 0 } }))
    expect((await executaActiuneFan({ corp: { actiune: 'urmarire' }, lot: LOT }, d.deps)).body.cod).toBe('scriere_neconfirmata')
    d.deps.rpc.mockImplementation(async () => ({ data: { scrise: 1, pastrate: 0, depasite: 0 } }))   // suma ≠ rândurile trimise
    expect((await executaActiuneFan({ corp: { actiune: 'urmarire' }, lot: LOT }, d.deps)).body.cod).toBe('scriere_neconfirmata')
  })
  it('documentul (runda 3): garanția rezervării, presupunerea neconfirmată + pasul blocant, tirajul, istoricul livrării, fixture-ul', () => {
    expect(DOC).toMatch(/NU se garantează „datele sunt actuale la COMMIT \/ la POST”/)
    expect(DOC).toMatch(/PRESUPUNERE NECONFIRMATĂ/); expect(DOC).toMatch(/\*\*4a\. BLOCANT: confirmarea asocierii/)   // runda 4: §10 în ordinea recenzentului (fost 8a)
    expect(DOC).toMatch(/\| 4a \| \*\*\(runda 3, BLOCANT/); expect(DOC).toMatch(/tirajul s-a schimbat; retipărește tot lotul/)
    expect(DOC).toMatch(/Identificatorul tirajului pe ETICHETĂ: nu se poate/)
    expect(DOC).toMatch(/Istoricul livrării la reaplicarea de TEST după revenire/); expect(DOC).toMatch(/Versiunea `20261212120000` e mai VECHE/)
    expect(DOC).toMatch(/--cu-fixture/); for (const s of ['S2a', 'S2b', 'S2c', 'U2', 'T1']) expect(DOC).toContain(`| ${s} |`)
    expect(MIG).toMatch(/NU se garantează „datele sunt actuale la COMMIT \/ la POST”/)
  })
  it('migrarea: garda „fără cronologie” și FAPTELE păstrate (cunoscut, apoi nou) sunt în fn_red_fan_urmarire (proba semantică: PGlite)', () => {
    const m = MIG.replace(/\r/g, '')
    expect(m).toMatch(/AND a\.ultim_eveniment_la IS NOT NULL AND u\.ultim_eveniment_la IS NULL;/)
    // runda 4 (r3 P2): faptul CUNOSCUT are întâietate (coalesce(b.…, nou)); retur_propus nu se mai scrie direct din răspuns
    expect(m).toMatch(/coalesce\(b\.ridicat_propus, n\.rid\) AS ridicat, coalesce\(b\.livrat_la, n\.liv\) AS livrat, coalesce\(b\.retur_propus, u\.retur_propus\) AS motiv/)
    expect(m).not.toMatch(/retur_propus = u\.retur_propus/)   // forma fdaa0496
    expect(m).not.toMatch(/OR u\.ultim_eveniment_la IS NULL OR \(u\.ultim_eveniment_la::timestamp/)   // forma 0716f5b3
  })
})

describe('runda 4: înlocuirea tirajului nu lasă să treacă o descărcare începută (r3 P1)', () => {
  const pdf = new TextEncoder().encode('%PDF-1.7 fictiv')
  const etichetaPdf = () => ({ status: 200, arrayBuffer: async () => pdf.buffer, json: async () => null })
  const cuAwb = async n => { const fx = await fixtura(n); fx.randuri.forEach((r, i) => { r.stare = 'generat'; r.awb = String(2000000001 + i) }); return fx }
  // FAN răspunde la /awb/label abia DUPĂ ce „altă sesiune” (owner-ul) a schimbat tirajul: cârligul rulează în timpul cererii
  const fanCuSchimbare = carlig => fanSimulat(async u => { if (u.pathname === '/awb/label') carlig(); return etichetaPdf() })
  const T0 = Date.parse('2026-11-17T17:00:00Z')

  it('SCENARIUL RECENZENTULUI: partea 2 cerută pe K1; owner-ul oprește + înlocuiește cu K2 cât FAN răspunde → 409, nimic livrat (fdaa0496: 200 ok, tirajul nr. 1)', async () => {
    const stare = { cheie: null, nr: 0, la: null }
    const fx = await cuAwb(150)
    const m = manifestTiparire({ randuri: fx.randuri, plicuri: fx.plicuri })
    const p1 = await executaActiuneFan({ corp: { actiune: 'eticheta', parte: 1, manifest_cheie: m.cheie }, lot: LOT }, depsFake(fx, fanSimulat(etichetaPdf), { stareTiraj: stare }).deps)
    expect(p1.body).toMatchObject({ cod: 'ok', parte: 1, tiraj: { nr: 1 } })
    const k1 = stare.cheie, k2 = 'b'.repeat(64), sim = tirajSimulat(stare)
    const fan = fanCuSchimbare(() => {
      stare.acum = T0
      sim.opreste({ p_lot_id: LOT.id, p_cheie: k1, p_opreste: true })
      stare.acum = T0 + ASTEPTARE_DUPA_OPRIRE_S * 1000
      sim({ p_lot_id: LOT.id, p_cheie: k2, p_inlocuieste: k1 })
    })
    const d = depsFake(fx, fan, { stareTiraj: stare })
    const p2 = await executaActiuneFan({ corp: { actiune: 'eticheta', parte: 2, manifest_cheie: m.cheie }, lot: LOT }, d.deps)
    expect([stare.cheie, stare.nr]).toEqual([k2, 2])                              // înlocuirea a avut loc în timpul cererii
    expect(fan.apeluri.filter(x => x.cale === '/awb/label')).toHaveLength(1)      // PDF-ul a fost cerut…
    expect([p2.status, p2.body.cod, p2.body.pdf_base64, p2.body.tiraj]).toEqual([409, 'tiraj_schimbat', undefined, undefined])   // …dar NU livrat
    expect(d.jurnal.filter(j => j.nume === 'fn_red_fan_tiraj').map(j => j.args)).toEqual([   // verificarea + reverificarea FINALĂ, aceeași cheie
      { p_lot_id: LOT.id, p_cheie: k1, p_inlocuieste: null }, { p_lot_id: LOT.id, p_cheie: k1, p_inlocuieste: null }])
  })
  it('oprirea singură în timpul cererii → 409 „tiraj_oprit”, nimic livrat; o descărcare nouă cât e oprit → refuz ÎNAINTE de FAN; reluarea → trece', async () => {
    const stare = { cheie: null, nr: 0, la: null }
    const fx = await cuAwb(2)
    const m = manifestTiparire({ randuri: fx.randuri, plicuri: fx.plicuri })
    await executaActiuneFan({ corp: { actiune: 'eticheta', manifest_cheie: m.cheie }, lot: LOT }, depsFake(fx, fanSimulat(etichetaPdf), { stareTiraj: stare }).deps)
    const k1 = stare.cheie, sim = tirajSimulat(stare)
    const a = await executaActiuneFan({ corp: { actiune: 'eticheta', manifest_cheie: m.cheie }, lot: LOT },
      depsFake(fx, fanCuSchimbare(() => sim.opreste({ p_lot_id: LOT.id, p_cheie: k1, p_opreste: true })), { stareTiraj: stare }).deps)
    expect([a.status, a.body.cod, a.body.pdf_base64]).toEqual([409, 'tiraj_oprit', undefined])
    expect(mesajEdgeFan({ data: a.body })).toBe(MESAJ_TIRAJ_OPRIT)
    const fan = fanSimulat(etichetaPdf)
    const b = await executaActiuneFan({ corp: { actiune: 'eticheta', manifest_cheie: m.cheie }, lot: LOT }, depsFake(fx, fan, { stareTiraj: stare }).deps)
    expect([b.status, b.body.cod]).toEqual([409, 'tiraj_oprit']); expect(fan.apeluri.filter(x => x.cale === '/awb/label')).toHaveLength(0)
    sim.opreste({ p_lot_id: LOT.id, p_cheie: k1, p_opreste: false })
    const c = await executaActiuneFan({ corp: { actiune: 'eticheta', manifest_cheie: m.cheie }, lot: LOT }, depsFake(fx, fanSimulat(etichetaPdf), { stareTiraj: stare }).deps)
    expect(c.body).toMatchObject({ cod: 'ok', tiraj: { nr: 1 } })
  })
  it('reverificarea finală neconfirmată (eroare BD, formă greșită, același cheie dar ALT nr.) → 503, nimic livrat (L18)', async () => {
    const fx = await cuAwb(2)
    const m = manifestTiparire({ randuri: fx.randuri, plicuri: fx.plicuri })
    const k = await cheieTiraj(m, webcrypto.subtle)
    const prim = { data: { stare: 'inceput', cheie: k, nr: 1, inceput_la: '2026-11-17T16:05:00Z' } }
    for (const al2lea of [{ error: { code: '57014', message: 'timeout' } }, { data: null }, { data: { stare: 'acelasi', cheie: k, nr: 3, inceput_la: '2026-11-17T16:05:00Z' } }]) {
      const d = depsFake(fx, fanSimulat(etichetaPdf))
      let n = 0
      d.deps.rpc.mockImplementation(async nume => (nume === 'fn_red_fan_tiraj' ? (++n === 1 ? prim : al2lea) : { data: null }))
      const r = await executaActiuneFan({ corp: { actiune: 'eticheta', manifest_cheie: m.cheie }, lot: LOT }, d.deps)
      expect([r.status, r.body.cod, r.body.pdf_base64]).toEqual([503, 'tiraj_neconfirmat', undefined])
    }
  })
  it('ecranul: confirmaTirajFinal — neschimbat = trece; oprit (RD021) / înlocuit (RD020) / aceeași cheie cu ALT nr. / eroare BD = refuz, nimic salvat', async () => {
    const fx = await cuAwb(2)
    const pl = fx.plicuri.map(p => ({ ...p, opis_path: `o/${p.id}` }))
    const cv = Object.fromEntries(pl.map(p => [p.id, [{ conv_id: `c${p.id}`, nr_document: 'C-000001', fisier_convocator_path: `c/${p.id}` }]]))
    const stare = { cheie: null, nr: 0, la: null, acum: T0 }, sim = tirajSimulat(stare), rpc = rpcTiraj(sim)
    const arh = await pregatestePachetFan({ rpc, lot: LOT, fanLot: { test: true }, randuriFan: fx.randuri, plicuri: pl, convocariPePlic: cv, subtle: webcrypto.subtle })
    await expect(confirmaTirajFinal({ rpc, lot: LOT, tiraj: arh.tiraj })).resolves.toBe(true)
    await rpc('fn_red_fan_tiraj_opreste', { p_lot_id: LOT.id, p_cheie: arh.tiraj.cheie, p_opreste: true })
    await expect(confirmaTirajFinal({ rpc, lot: LOT, tiraj: arh.tiraj })).rejects.toMatchObject({ code: 'RD021', message: MESAJ_TIRAJ_OPRIT })
    await expect(pregatestePachetFan({ rpc, lot: LOT, fanLot: { test: true }, randuriFan: fx.randuri, plicuri: pl, convocariPePlic: cv, subtle: webcrypto.subtle }))
      .rejects.toMatchObject({ code: 'RD021' })
    stare.acum += ASTEPTARE_DUPA_OPRIRE_S * 1000
    expect((await rpc('fn_red_fan_tiraj', { p_lot_id: LOT.id, p_cheie: 'c'.repeat(64), p_inlocuieste: arh.tiraj.cheie })).data.nr).toBe(2)
    await expect(confirmaTirajFinal({ rpc, lot: LOT, tiraj: arh.tiraj })).rejects.toMatchObject({ code: 'RD020', message: MESAJ_TIRAJ_SCHIMBAT })
    // înapoi la aceeași cheie (manifestul revenit), dar tirajul nr. 3: o descărcare a tirajului nr. 1 tot nu trece
    await rpc('fn_red_fan_tiraj_opreste', { p_lot_id: LOT.id, p_cheie: 'c'.repeat(64), p_opreste: true }); stare.acum += ASTEPTARE_DUPA_OPRIRE_S * 1000
    expect((await rpc('fn_red_fan_tiraj', { p_lot_id: LOT.id, p_cheie: arh.tiraj.cheie, p_inlocuieste: 'c'.repeat(64) })).data.nr).toBe(3)
    await expect(confirmaTirajFinal({ rpc, lot: LOT, tiraj: arh.tiraj })).rejects.toThrow(/nu s-a putut reverifica/)
    await expect(confirmaTirajFinal({ rpc: async () => ({ error: { code: '57014', message: 'timeout' } }), lot: LOT, tiraj: arh.tiraj })).rejects.toMatchObject({ code: '57014' })
  })
  it('sursele ecranelor: reverificarea finală stă DUPĂ pregătire și ÎNAINTEA salvării (arhiva și fiecare parte a etichetelor)', () => {
    const pe = readFileSync('src/redari/ui/PlicuriEcran.jsx', 'utf8'), fan = readFileSync('src/redari/ui/FanAwbPrevizualizare.jsx', 'utf8')
    const a = pe.indexOf("await zip.generateAsync({ type: 'blob' })"), b = pe.indexOf('await confirmaTirajFinal({ rpc: (n, a) => supabase.rpc(n, a), lot: rand, tiraj })'), c = pe.indexOf('descarcaBlob(blob, numeArhiva(')
    expect(a > 0 && b > a && c > b).toBe(true)
    const x = fan.indexOf('control = await paginaControl(tiraj)'), y = fan.indexOf('await confirmaTirajFinal({ rpc: (n, a) => supabase.rpc(n, a), lot, tiraj })'), z = fan.indexOf("descarcaBlob(new Blob([bytes], { type: 'application/pdf' })")
    expect(x > 0 && y > x && z > y).toBe(true)
    expect(fan).toMatch(/await confirmaTirajFinal\(\{ rpc: \(n, a\) => supabase\.rpc\(n, a\), lot, tiraj \}\)\s*\n\s*if \(!curent\(\)\) return OPRIT/)   // L24 după await
    // înlocuirea din ecran: oprire → 30 s → înlocuire; confirmarea owner-ului spune exact pașii
    expect(fan).toMatch(/fn_red_fan_tiraj_opreste', \{ p_lot_id: lot\.id, p_cheie: tirajInceput\.cheie, p_opreste: true \}/)
    expect(fan).toMatch(/am adunat și am DISTRUS toate foile tirajului/); expect(fan).toMatch(/am ȘTERS fișierele lui descărcate, inclusiv cele primite după oprire/)
  })
  it('tirajNeschimbat / refuzTiraj: același tiraj = aceeași cheie ȘI același nr.; RD020 / RD021 recunoscute, restul = neconfirmat', () => {
    const k = 'a'.repeat(64), t = { cheie: k, nr: 2 }, d = { stare: 'acelasi', cheie: k, nr: 2, inceput_la: '2026-11-17T16:05:00Z' }
    expect(tirajNeschimbat(d, t)).toMatchObject({ nr: 2, cheie: k })
    for (const rau of [{ ...d, nr: 3 }, { ...d, stare: 'inceput' }, { ...d, cheie: 'b'.repeat(64) }, null]) expect(tirajNeschimbat(rau, t)).toBe(null)
    expect([refuzTiraj({ code: 'RD020' }), refuzTiraj({ code: 'RD021' }), refuzTiraj({ code: 'RD022' }), refuzTiraj(null)]).toEqual(['tiraj_schimbat', 'tiraj_oprit', null, null])
  })
  it('stareOprireTiraj: oprit + secundele rămase din 30, după ceasul injectat (BD-ul impune; ecranul doar afișează)', () => {
    const fl = { tiraj_cheie: 'a'.repeat(64), tiraj_oprit_la: '2026-11-17T17:00:00Z' }
    expect(stareOprireTiraj(fl, T0 + 10000)).toEqual({ oprit: true, opritLa: fl.tiraj_oprit_la, gataDeInlocuit: false, secundeRamase: 20 })
    expect(stareOprireTiraj(fl, T0 + ASTEPTARE_DUPA_OPRIRE_S * 1000).gataDeInlocuit).toBe(true)
    expect(stareOprireTiraj({ ...fl, tiraj_oprit_la: null }, T0).oprit).toBe(false); expect(stareOprireTiraj(null).oprit).toBe(false)
  })
  it('paritate JS = SQL (L19): cele 30 s, codurile RD021 / RD022 și evidența în red_jurnal sunt în migrare', () => {
    const m = MIG.replace(/\r/g, '')
    // runda 5 (r4 P1): cele 30 s pe CEASUL EFECTIV (clock_timestamp, sub lock), oprirea scrisă cu momentul luat după lock-uri — nimic cu now()
    expect(Number((m.match(/v_fl\.tiraj_oprit_la > clock_timestamp\(\) - interval '(\d+) seconds'/) || [])[1])).toBe(ASTEPTARE_DUPA_OPRIRE_S)
    expect(m).not.toMatch(/tiraj_oprit_la > now\(\)/); expect(m).not.toMatch(/tiraj_oprit_la = now\(\)/)
    expect(m).toMatch(/v_la := clock_timestamp\(\);[^\n]*\n  IF p_opreste AND v_fl\.tiraj_oprit_la IS NULL THEN\n    UPDATE public\.red_fan_loturi SET tiraj_oprit_la = v_la,/)
    expect(m).toMatch(/USING ERRCODE = 'RD021'/); expect(m).toMatch(/USING ERRCODE = 'RD022'/)
    expect(m).toMatch(/CREATE FUNCTION public\.fn_red_fan_tiraj_opreste\(p_lot_id uuid, p_cheie text, p_opreste boolean\) RETURNS jsonb/)
    // trei scrieri în jurnal: tirajul, oprirea / reluarea, soluționarea urmăririi (runda 5)
    expect((m.match(/INSERT INTO public\.red_jurnal \(tabela, inregistrare_id, actiune, date_vechi, date_noi, user_id\)/g) || []).length).toBe(3)
  })
})

describe('runda 5: soluționarea contradicțiilor urmăririi (Jakarinos #1118 r4 P2)', () => {
  const rand = (x = {}) => ({ id: 'r1', nr_plic: 'PL-TST-0001', awb: '1000000001', versiune_urmarire: 3, ridicat_propus: '2026-11-10', ridicat_contrazis: '2026-11-11',
    livrat_la: null, livrat_contrazis: null, retur_cunoscut: false, retur_propus: null, retur_contrazis: null, ...x })
  const rpcCu = rasp => { const apeluri = []; return { apeluri, rpc: async (n, a) => { apeluri.push([n, a]); return rasp(a) } } }
  it('fapteContrazise: aceeași listă și ordine ca fn_red_fan_urmarire_solutioneaza (ridicat, livrat, retur, livrat_retur); fără contradicție = []', () => {
    expect(fapteContrazise(rand()).map(f => f.cheie)).toEqual(['ridicat'])
    const toate = rand({ livrat_la: '2026-11-12T11:00:00Z', livrat_contrazis: '2026-11-12T12:00:00Z', retur_cunoscut: true, retur_propus: 'refuz', retur_contrazis: 'mutat' })
    expect(fapteContrazise(toate).map(f => f.cheie)).toEqual(['ridicat', 'livrat', 'retur', 'livrat_retur'])
    expect(fapteContrazise(rand({ ridicat_contrazis: null }))).toEqual([]); expect(fapteContrazise(null)).toEqual([])
    // ordinea SQL: aceleași patru verificări, în aceeași ordine, în migrare
    const m = MIG.replace(/\r/g, '')
    const i = ['ridicat_contrazis IS NOT NULL THEN v_cer', 'livrat_contrazis IS NOT NULL THEN v_cer', 'retur_contrazis IS NOT NULL THEN v_cer', 'v_r.livrat_la IS NOT NULL AND v_r.retur_cunoscut THEN v_cer'].map(s => m.indexOf(s))
    expect(i.every(x => x > 0)).toBe(true); expect([...i].sort((a, b) => a - b)).toEqual(i)
    expect(Object.keys(ALEGERI_SOLUTIONARE)).toEqual(['ridicat', 'livrat', 'retur', 'livrat_retur'])
    expect(m).toMatch(/\(e\.key = 'livrat_retur' AND \(e\.value #>> '\{\}'\) NOT IN \('livrat', 'retur'\)\)/)
    expect(m).toMatch(/\(e\.key <> 'livrat_retur' AND \(e\.value #>> '\{\}'\) NOT IN \('cunoscut', 'nou'\)\)/)
  })
  it('optiuniSolutionare: AMBELE valori pe fiecare fapt, în ora / ziua României (L17)', () => {
    const o = optiuniSolutionare(rand({ livrat_la: '2026-11-12T07:00:00Z', retur_cunoscut: true, retur_propus: 'refuz' }), { refuz: 'Refuz' })
    expect(o.map(x => x.cheie)).toEqual(['ridicat', 'livrat_retur'])
    expect(o[0].optiuni).toEqual([{ valoare: 'cunoscut', text: '10.11.2026 (cunoscută)' }, { valoare: 'nou', text: '11.11.2026 (FAN, mai nou)' }])
    expect(o[1].optiuni.map(x => x.text)).toEqual(['livrat 12.11.2026 09:00 (returul se scoate)', 'retur (Refuz) (livrarea se scoate)'])
  })
  it('solutioneazaUrmarire: alegeri incomplete / nepermise / în plus, motiv gol sau peste 500, versiune lipsă = NIMIC trimis', async () => {
    const { apeluri, rpc } = rpcCu(() => ({ data: { stare: 'ridicat', versiune: 4 }, error: null }))
    for (const [alegeri, motiv, r] of [[{}, 'ok', rand()], [{ ridicat: 'altceva' }, 'ok', rand()], [{ ridicat: 'cunoscut', livrat: 'nou' }, 'ok', rand()],
      [{ ridicat: 'cunoscut' }, '   ', rand()], [{ ridicat: 'cunoscut' }, 'x'.repeat(501), rand()], [{ ridicat: 'cunoscut' }, 'ok', rand({ versiune_urmarire: null })],
      [{ ridicat: 'cunoscut' }, 'ok', rand({ ridicat_contrazis: null })]]) {
      await expect(solutioneazaUrmarire({ rpc, rand: r, alegeri, motiv })).rejects.toThrow()
    }
    expect(apeluri).toEqual([])
  })
  it('solutioneazaUrmarire: trimite VERSIUNEA citită (CAS) și motivul curățat; RD023 = mesajul „s-a schimbat între timp”; rezultat fără versiunea + 1 = neconfirmat', async () => {
    const a = rpcCu(() => ({ data: { stare: 'ridicat', versiune: 4, solutionate: ['ridicat'] }, error: null }))
    expect(await solutioneazaUrmarire({ rpc: a.rpc, rand: rand(), alegeri: { ridicat: 'cunoscut' }, motiv: '  verificat  ' })).toMatchObject({ stare: 'ridicat', versiune: 4 })
    expect(a.apeluri).toEqual([['fn_red_fan_urmarire_solutioneaza', { p_id: 'r1', p_versiune: 3, p_alegeri: { ridicat: 'cunoscut' }, p_motiv: 'verificat' }]])
    const b = rpcCu(() => ({ data: null, error: { code: 'RD023', message: 'redari fan: urmarirea s-a schimbat intre timp' } }))
    await expect(solutioneazaUrmarire({ rpc: b.rpc, rand: rand(), alegeri: { ridicat: 'nou' }, motiv: 'x' })).rejects.toMatchObject({ code: 'RD023', message: MESAJ_URMARIRE_SCHIMBATA })
    const c = rpcCu(() => ({ data: null, error: { code: '42501', message: 'redari fan: doar owner-ul sau un admin Redari solutioneaza urmarirea' } }))
    await expect(solutioneazaUrmarire({ rpc: c.rpc, rand: rand(), alegeri: { ridicat: 'nou' }, motiv: 'x' })).rejects.toMatchObject({ code: '42501' })
    const d = rpcCu(() => ({ data: { stare: 'ridicat', versiune: 3 }, error: null }))
    await expect(solutioneazaUrmarire({ rpc: d.rpc, rand: rand(), alegeri: { ridicat: 'nou' }, motiv: 'x' })).rejects.toThrow('rezultat neconfirmat')
  })
  it('operația „solutionare”: owner SAU admin Redări, doar cu o contradicție; dezactivată cât transportul e oprit', () => {
    const cu = [rand({ stare: 'generat' })], fara = [rand({ stare: 'generat', ridicat_contrazis: null })]
    const s = o => stariOperatii({ transportActiv: true, evidentaInstalata: true, proiectCod: 'TEST-RAZVAN', fanLot: { test: true }, ...o }).find(x => x.cheie === 'solutionare')
    expect([s({ esteOwner: true, randuri: cu }).activ, s({ esteAdmin: true, randuri: cu }).activ, s({ randuri: cu }).activ, s({ esteOwner: true, randuri: fara }).activ]).toEqual([true, true, false, false])
    expect(stariOperatii({ transportActiv: false, evidentaInstalata: true, esteOwner: true, proiectCod: 'TEST-RAZVAN', fanLot: { test: true }, randuri: cu }).find(x => x.cheie === 'solutionare')).toMatchObject({ activ: false, motiv: MESAJ_TRANSPORT_OPRIT })
  })
  it('ecranul: acțiunea în caseta „de verificat de om”, cu ambele valori și motivul; garda de generație (executa) și dublu-click; citește versiunea', () => {
    const src = readFileSync('src/redari/ui/FanAwbPrevizualizare.jsx', 'utf8').replace(/\r/g, '')
    expect(src).toMatch(/confirmare_stare,versiune_urmarire'/)
    expect(src).toMatch(/const solutioneaza = \(\) => executa\('solutionare', async curent => \{/)
    expect(src).toMatch(/if \(!curent\(\)\) return OPRIT\n    let d\n/)
    expect(src).toMatch(/solutioneazaUrmarire\(\{ rpc: \(n, a\) => supabase\.rpc\(n, a\), rand: r, alegeri, motiv \}\)/)
    expect(src).toMatch(/optiuniSolutionare\(sol\.rand, ETICHETE_RETUR\)/); expect(src).toMatch(/Motivul soluționării/)
    expect(src).toMatch(/if \(ocupat\.current \|\| !pas\(cheiePas\)\?\.activ\) return/)
    const casuta = src.slice(src.indexOf('Urmărire de verificat de om'), src.indexOf('{randuri && <>'))
    expect(casuta).toMatch(/Soluționează…/); expect(casuta).toMatch(/Confirmă soluționarea/)
    expect(readFileSync('src/redari/ui/PlicuriEcran.jsx', 'utf8')).toMatch(/esteAdmin=\{nivel === 'admin'\}/)
  })
  it('migrarea: funcția nouă cu poarta de rol în corp, CAS, motiv obligatoriu, jurnal; drepturi doar authenticated; 19 funcții; revenirea o scoate', () => {
    const m = MIG.replace(/\r/g, '')
    const f = m.slice(m.indexOf('CREATE FUNCTION public.fn_red_fan_urmarire_solutioneaza'), m.indexOf('END $fn$;', m.indexOf('CREATE FUNCTION public.fn_red_fan_urmarire_solutioneaza')))
    expect(f).toMatch(/IF auth\.uid\(\) IS NULL OR NOT \(public\.fn_red_fan_e_owner\(\) OR coalesce\(public\.fn_red_nivel\(\), ''\) = 'admin'\) THEN/)
    expect(f).toMatch(/IF v_r\.versiune_urmarire IS DISTINCT FROM p_versiune THEN/); expect(f).toMatch(/USING ERRCODE = 'RD023'/)
    expect(f).toMatch(/v_motiv IS NULL OR v_motiv !~ '\[\^\[:space:\]\]' OR length\(v_motiv\) > 500/)
    expect(f).toMatch(/INSERT INTO public\.red_jurnal/); expect(f).toMatch(/'eveniment', 'urmarire_solutionata'/)
    expect(m).toMatch(/p\.proname LIKE 'fn\\_red\\_fan\\_%'\) <> 19 THEN/)
    expect(m).toMatch(/GRANT EXECUTE ON FUNCTION [^;]*public\.fn_red_fan_urmarire_solutioneaza\(uuid, integer, jsonb, text\)[^;]*TO authenticated;/)
    expect(m).toMatch(/CONSTRAINT red_fan_awb_contradictii CHECK/)
    const r = readFileSync('supabase/revenire/20261212a_redari_fan_awb_ROLLBACK.sql', 'utf8').replace(/\r/g, '')
    expect(r).toMatch(/'fn_red_fan_urmarire_solutioneaza\(uuid,integer,jsonb,text\)'\];/); expect(r).toMatch(/DROP FUNCTION public\.fn_red_fan_urmarire_solutioneaza\(uuid, integer, jsonb, text\);/)
  })
})

describe('runda 4: urmărirea păstrează FAPTELE; contradicțiile sunt vizibile (r3 P2)', () => {
  const ev = (id, date) => ({ id, date })
  it('reproducerea recenzentului, partea de parser: S6 → S43 dă retur „refuz”; răspunsul ulterior DOAR cu S43 (aceeași dată) dă motivul null — BD-ul îl păstrează (PGlite)', () => {
    const a = rezumatUrmarireFan({ awbNumber: '2000000001', events: [ev('S6', '2026-11-10 15:00:00'), ev('S43', '2026-11-11 09:00:00')] })
    const b = rezumatUrmarireFan({ awbNumber: '2000000001', events: [ev('S43', '2026-11-11 09:00:00')] })
    expect([a.urmarire_stare, a.retur_propus, a.ultim_eveniment_la]).toEqual(['retur', 'refuz', '2026-11-11 09:00:00'])
    expect([b.urmarire_stare, b.retur_propus, b.ultim_eveniment_la]).toEqual(['retur', null, '2026-11-11 09:00:00'])
  })
  it('textFapteUrmarire: faptele cunoscute și, la contradicție, AMBELE valori (cunoscută și nouă)', () => {
    const et = { refuz: 'Refuz', mutat: 'Mutat' }
    expect(textFapteUrmarire({ ridicat_propus: '2026-11-09', livrat_la: null, retur_cunoscut: true, retur_propus: 'refuz' }, et)).toBe('fapte: ridicat 09.11.2026, retur (Refuz)')
    const t = textFapteUrmarire({ ridicat_propus: '2026-11-09', ridicat_contrazis: '2026-11-10', retur_cunoscut: true, retur_propus: 'refuz', retur_contrazis: 'mutat',
      livrat_la: '2026-11-11T07:00:00Z' }, et)
    expect(t).toMatch(/CONTRADICȚIE de verificat de om: ridicare 09\.11\.2026 \(cunoscută\) ≠ 10\.11\.2026 \(FAN, mai nou\); motiv de retur Refuz \(cunoscut\) ≠ Mutat \(FAN, mai nou\); livrat ȘI retur/)
    expect(t).toMatch(/livrat 11\.11\.2026 09:00/)   // ora României (L17)
    expect(textFapteUrmarire({})).toBe(''); expect(textFapteUrmarire(null)).toBe('')
  })
  it('documentul (runda 4, r3 P3): deciziile din 17.11.2026 consemnate, lista de activare în ordinea recenzentului, arhiva descrisă exact', () => {
    const d = DOC.replace(/\r/g, '')
    expect(d).not.toMatch(/NEDECISE/); expect(d).not.toMatch(/expedieri fizice PLĂTITE/); expect(d).not.toMatch(/sandbox sau expedieri reale/)
    expect(d).toMatch(/contul de TEST FAN — DECIS de proprietar \(17\.11\.2026\)/); expect(d).toMatch(/costurile se lămuresc pe acel cont/)
    expect(d).toMatch(/Numărul plicului apare și pe convocator — DECIS/); expect(d).toMatch(/felie separată, după publicarea terminologiei/)
    expect(d).toMatch(/amprenta documentelor în tiraj/)
    expect(d).toMatch(/Documentele unui lot se descarcă într-o ARHIVĂ \(ZIP\) — DECIS/); expect(d).toMatch(/un plic\s+cu două convocări = trei fișiere DOCX/)
    expect(d).toMatch(/Un singur document pe plic NU se poate face simplu și sigur/); expect(d).not.toMatch(/un fișier pe plic\b(?! NU)(?!, varianta)/i)
    // §10: cei 5 pași, în ordinea recenzentului
    const s10 = d.slice(d.indexOf('## 10. Lista de activare'), d.indexOf('## 11.'))
    const pasi = ['1. **Concurența tirajului', '2. **Precondițiile fixture-ului', '3. ⚑ **Baseline L15 revizuit', '4. ⚑ **Confirmările FAN pe contul de TEST', '5. ⚑ **Numai după acceptarea Testului 1']
    const poz = pasi.map(p => s10.indexOf(p))
    expect(poz.every(x => x >= 0)).toBe(true); expect([...poz].sort((a, b) => a - b)).toEqual(poz)
    for (const s of ['T2', 'T2b', 'L1b', 'F1']) expect(d).toContain(`| ${s} |`)
    for (const c of ['FX001', 'FX002', 'FX003']) expect(d).toContain(`\`${c}\``)
    expect(d).toMatch(/--migrare fan/); expect(d).toMatch(/Tirajul înlocuit cât o descărcare e ÎN CURS/); expect(d).toMatch(/Ce rămâne procedural:/)
  })
  it('ecranul: ridicarea contrazisă nu intră în „Confirmă ridicarea”; caseta „de verificat de om” arată faptele; evidența citește coloanele faptelor', () => {
    const src = readFileSync('src/redari/ui/FanAwbPrevizualizare.jsx', 'utf8')
    expect(src).toMatch(/r\.stare === 'generat' && r\.ridicat_propus && !r\.ridicat_contrazis/)
    expect(src).toMatch(/retur_cunoscut,ridicat_contrazis,livrat_contrazis,retur_contrazis/)
    expect(src).toMatch(/Urmărire de verificat de om/)
  })
})
