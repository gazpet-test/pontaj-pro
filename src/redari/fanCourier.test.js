// FAN Courier (schelet): construirea AWB-ului dintr-un plic, hash-ul aprobat, interpretarea răspunsului, poarta funcției edge.
// Date fictive. Referința câmpurilor: documentația oficială FAN API (POST /intern-awb), nu codul testat (L25).
import { describe, it, expect, vi } from 'vitest'
vi.mock('../lib/supabase.js', () => ({ supabase: {} }))
import { webcrypto } from 'node:crypto'
import { construiestePlicFan, telefonFan, hashPlicFan, jsonCanonic, interpreteazaRaspunsAwb, rezumatUrmarire, CONFIG_FAN_PLIC }
  from '../../supabase/functions/_shared/redariFan.mjs'
import { raspundeFan, TRANSPORT_REAL_ACTIV } from '../../supabase/functions/_shared/redariFanHandler.mjs'

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
  it('în câmpurile libere intră doar numărul plicului (fără nume / adresă)', () => {
    const s = construiestePlicFan({ plic, contact, proiectCod: 'TEST-RAZVAN' }).shipment
    expect(s.info.content).toBe('PL-TST-0001'); expect(s.info.observation).toBe('PL-TST-0001')
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
  it('configurația implicită e înghețată', () => {
    expect(Object.isFrozen(CONFIG_FAN_PLIC)).toBe(true)
  })
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

describe('interpreteazaRaspunsAwb (exemplul din documentație)', () => {
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
  })
  it('tarif / TVA lipsă → null (cost necunoscut), nu 0 (Jakarinos r1 P2)', () => {
    expect(interpreteazaRaspunsAwb(200, { response: [{ awbNumber: 123456789, tariff: null, vat: undefined }] })).toEqual({ stare: 'generat', awb: '123456789', tarif: null, tva: null })
  })
})

describe('rezumatUrmarire', () => {
  it('C0 = ridicat (data expedierii), S2 = livrat, nume confirmare', () => {
    const r = rezumatUrmarire({ confirmation: { name: 'Fictiv', date: '2026-11-12 10:00' }, events: [
      { id: 'C1', name: 'x', date: '2026-11-11 08:00:00' }, { id: 'C0', name: 'ridicat', date: '2026-11-10 15:00:00' }, { id: 'S2', name: 'Livrat', date: '2026-11-12 10:00:00' }] })
    expect(r).toMatchObject({ ridicat_la: '2026-11-10 15:00:00', livrat_la: '2026-11-12 10:00:00', confirmat_de: 'Fictiv', semnal_retur: false })
    expect(r.ultimul_eveniment.id).toBe('S2')
  })
  it('adresă greșită / retur → semnal pentru om', () => {
    expect(rezumatUrmarire({ events: [{ id: 'S5', date: '2026-11-11' }] }).semnal_retur).toBe(true)
    expect(rezumatUrmarire({ events: [], returnAwbNumber: '123' }).semnal_retur).toBe(true)
    expect(rezumatUrmarire(null)).toMatchObject({ ridicat_la: null, semnal_retur: false })
  })
})

describe('raspundeFan — poarta funcției edge (transport oprit)', () => {
  const LOT = '11111111-2222-4333-8444-555555555555'
  const deps = (o = {}) => ({ getUser: async () => ({ data: { user: { id: 'u' } } }), owner: async () => ({ data: true }), lot: vi.fn(async () => ({ data: { id: LOT } })), ...o })
  it('transportul real e oprit în cod', () => expect(TRANSPORT_REAL_ACTIV).toBe(false))
  it('fără JWT → 401; token respins (4xx) → 401; autentificare indisponibilă → 503 (Jakarinos r1 P2)', async () => {
    expect((await raspundeFan({ jwt: '', corp: {} }, deps())).status).toBe(401)
    expect((await raspundeFan({ jwt: 'x', corp: {} }, deps({ getUser: async () => ({ error: { status: 401 } }) }))).status).toBe(401)
    expect((await raspundeFan({ jwt: 'x', corp: {} }, deps({ getUser: async () => ({ error: { status: 503 } }) }))).body.cod).toBe('autentificare_neconfirmata')
    expect((await raspundeFan({ jwt: 'x', corp: {} }, deps({ getUser: async () => ({ error: {} }) }))).status).toBe(503)
    expect((await raspundeFan({ jwt: 'x', corp: {} }, deps({ getUser: async () => ({ error: { status: 0 } }) }))).status).toBe(503)   // r2 P2: doar 4xx = 401
    expect((await raspundeFan({ jwt: 'x', corp: {} }, deps({ getUser: async () => ({ data: { user: null } }) }))).status).toBe(401)
  })
  it('non-owner → 403; verificarea owner eșuată → 503 (nu „non_owner”)', async () => {
    expect((await raspundeFan({ jwt: 'x', corp: { actiune: 'genereaza', lot_id: LOT } }, deps({ owner: async () => ({ data: false }) }))).status).toBe(403)
    expect((await raspundeFan({ jwt: 'x', corp: { actiune: 'genereaza', lot_id: LOT } }, deps({ owner: async () => ({ error: {} }) }))).body.cod).toBe('autorizare_neconfirmata')
  })
  it('rolul / identitatea din corp sunt ignorate', async () => {
    const r = await raspundeFan({ jwt: 'x', corp: { actiune: 'genereaza', lot_id: LOT, is_owner: true } }, deps({ owner: async () => ({ data: false }) }))
    expect(r.status).toBe(403)
  })
  it('acțiune / lot invalid → 400; lot invizibil → 404', async () => {
    expect((await raspundeFan({ jwt: 'x', corp: { actiune: 'trimite', lot_id: LOT } }, deps())).status).toBe(400)
    expect((await raspundeFan({ jwt: 'x', corp: { actiune: 'genereaza', lot_id: 'x' } }, deps())).status).toBe(400)
    expect((await raspundeFan({ jwt: 'x', corp: { actiune: 'genereaza', lot_id: LOT } }, deps({ lot: async () => ({ data: null }) }))).status).toBe(404)
  })
  it('owner + lot valid → 423 transport_real_oprit, niciun apel de rețea', async () => {
    const fetchSpion = vi.spyOn(globalThis, 'fetch')
    const r = await raspundeFan({ jwt: 'x', corp: { actiune: 'genereaza', lot_id: LOT } }, deps())
    expect(r).toEqual({ status: 423, body: { cod: 'transport_real_oprit' } })
    expect(fetchSpion).not.toHaveBeenCalled()
    fetchSpion.mockRestore()
  })
})

// Previzualizarea din ✉️ Poștă: contactul ales pe plic (primul deținător cu telefon, ordine stabilă)
import { contactPePlic } from './ui/FanAwbPrevizualizare.jsx'
describe('contactPePlic', () => {
  it('ia deținătorul cu telefon; fără convocări → contact null', () => {
    const r = contactPePlic([{ id: 'p1' }, { id: 'p2' }],
      [{ plic_id: 'p1', detinator_id: 'd2' }, { plic_id: 'p1', detinator_id: 'd1' }, { plic_id: null, detinator_id: 'd3' }],
      [{ detinator_id: 'd1', telefon: '' }, { detinator_id: 'd2', telefon: '0700' }, { detinator_id: 'd3', telefon: '0711' }])
    expect(r[0].contact.detinator_id).toBe('d2'); expect(r[1].contact).toBeNull()
  })
})
