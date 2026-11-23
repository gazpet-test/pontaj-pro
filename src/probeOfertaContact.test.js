// TKT-2026-0374 — contactul la beneficiar pe oferta de probe: logica, compatibilitatea cu migrarea neaplicată, exportul.
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'

vi.mock('./lib/supabase.js', () => ({ supabase: {} }))
vi.mock('./OfertareLicitatii.jsx', () => ({ default: () => null }))
vi.mock('./OfertareBiblioteca.jsx', () => ({ default: () => null }))
// Excel: prindem foaia construită în loc să scriem fișierul
const prins = {}
vi.mock('xlsx-js-style', () => ({
  utils: {
    aoa_to_sheet: rows => { prins.rows = rows; return {} },
    book_new: () => ({}),
    book_append_sheet: (wb, ws) => { prins.ws = ws },
  },
  writeFile: (wb, nume) => { prins.nume = nume },
}))

import { CONTACT_COLOANE, CONTACT_MAX, lipsaColoaneContact, stareContactDinSonda, avertismentTelefon, avertismentEmail,
  depasireLungime, contactPayload, randuriContactExport, esc } from './probeOfertaContact.js'
import { generateOfertaExcel, buildOfertaProbaHtml } from './Ofertare.jsx'

describe('migrarea 20261215b neaplicată / aplicată', () => {
  it('coloană lipsă doar pentru erorile care numesc coloanele noastre', () => {
    expect(lipsaColoaneContact({ code: '42703', message: 'column probe_oferte.client_contact_nume does not exist' })).toBe(true)
    expect(lipsaColoaneContact({ code: 'PGRST204', message: "Could not find the 'client_contact_email' column of 'probe_oferte' in the schema cache" })).toBe(true)
    expect(lipsaColoaneContact({ code: '42703', message: 'column probe_oferte.client does not exist' })).toBe(false)
    expect(lipsaColoaneContact({ code: '42501', message: 'permission denied client_contact_nume' })).toBe(false)
  })
  it('sonda: da / nu / eroare', () => {
    expect(stareContactDinSonda({ data: [], error: null })).toBe('da')
    expect(stareContactDinSonda({ data: null, error: { code: '42703', message: 'column probe_oferte.client_contact_telefon does not exist' } })).toBe('nu')
    expect(stareContactDinSonda({ data: null, error: { code: '', message: 'Failed to fetch' } })).toBe('eroare')
  })
  it('fără migrare, payload-ul ofertei NU primește nicio cheie nouă (salvarea rămâne ca azi)', () => {
    const f = { client_contact_nume: 'Ion', client_contact_telefon: '0722', client_contact_email: 'a@b.ro' }
    expect(contactPayload(f, 'nu')).toEqual({})
    expect(contactPayload(f, 'eroare')).toEqual({})
    expect(contactPayload(f, null)).toEqual({})
  })
  it('cu migrare: valori tăiate, gol = null', () => {
    expect(contactPayload({ client_contact_nume: '  Ion Pop ', client_contact_telefon: '', client_contact_email: '  ' }, 'da'))
      .toEqual({ client_contact_nume: 'Ion Pop', client_contact_telefon: null, client_contact_email: null })
  })
  it('plafoanele de lungime = CHECK-urile din migrare', () => {
    const sql = readFileSync(new URL('../supabase/migrations/20261215b_probe_oferte_contact.sql', import.meta.url), 'utf8')
    for (const k of CONTACT_COLOANE) expect(sql).toContain(`length(${k}) <= ${CONTACT_MAX[k]}`)
    expect(depasireLungime({ client_contact_nume: 'a'.repeat(121) })).toMatch(/maximum 120/)
    expect(depasireLungime({ client_contact_nume: 'a'.repeat(120) })).toBe(null)
  })
})

describe('validare ușoară (avertizează, nu blochează)', () => {
  it('telefon', () => {
    expect(avertismentTelefon('0722 123 456')).toBe(null)
    expect(avertismentTelefon('+40 722-123-456')).toBe(null)
    expect(avertismentTelefon('(0244) 123.456')).toBe(null)
    expect(avertismentTelefon('0722 12')).toMatch(/cifre/)
    expect(avertismentTelefon('sună-l pe Ion')).toMatch(/neobișnuite/)
    expect(avertismentTelefon('')).toBe(null)
  })
  it('e-mail', () => {
    expect(avertismentEmail('ion.pop@firma.ro')).toBe(null)
    expect(avertismentEmail('ion.pop@firma')).toMatch(/nu pare/)
    expect(avertismentEmail('ion pop@firma.ro')).toMatch(/nu pare/)
    expect(avertismentEmail('')).toBe(null)
  })
})

const baza = {
  nr_oferta: 'PP-2026-001', data_oferta: '2026-11-11', client: 'Client Test', localitate: 'Ploiești', distanta_km: 10,
  transport_lei: 100, proba_lei: 1000, stat_dispozitie_lei: 0, extra_lei: 0, discount_pct: 0, discountProba: 0,
  inc_pistonare: false, inc_uscare: false, inc_calibrare: false, totalFaraTva: 1100, tva: 231, totalCuTva: 1331,
  calc: { tip_fluid: 'aer', lungime_m: 100, presiune_bar: 6, durata_total_h: 2, probe_diametre: { dn_label: 'DN100' }, probe_configuratii: { denumire: 'C1' } },
  client_contact_nume: '', client_contact_telefon: '', client_contact_email: '',
}

describe('exportul ofertei', () => {
  it('rândurile de contact doar dacă sunt completate', () => {
    expect(randuriContactExport(baza)).toEqual([])
    expect(randuriContactExport({ ...baza, client_contact_telefon: ' 0722 123 456 ' })).toEqual([['Telefon', '0722 123 456']])
  })
  it('Excel fără contact = exact structura de azi (antetele îmbinate pe rândurile 8 și 16)', async () => {
    await generateOfertaExcel(baza)
    expect(prins.rows.some(r => r[0]?.v === 'Persoană de contact')).toBe(false)
    expect(prins.ws['!merges']).toEqual([{ s: { r: 8, c: 0 }, e: { r: 8, c: 1 } }, { s: { r: 16, c: 0 }, e: { r: 16, c: 1 } }])
    expect(prins.rows[8][0].v).toBe('PARAMETRI TEHNICI')
  })
  it('Excel cu contact: rândurile după Client, îmbinările mutate odată cu antetele', async () => {
    await generateOfertaExcel({ ...baza, client_contact_nume: 'Ion Pop', client_contact_email: 'ion@firma.ro' })
    const et = prins.rows.map(r => r[0]?.v)
    expect(et.slice(4, 8)).toEqual(['Client', 'Persoană de contact', 'E-mail', 'Localitate'])
    expect(prins.rows[5][1].v).toBe('Ion Pop')
    const iParam = et.indexOf('PARAMETRI TEHNICI'), iCost = et.indexOf('DETALIERE COSTURI')
    expect([iParam, iCost]).toEqual([10, 18])
    expect(prins.ws['!merges']).toEqual([{ s: { r: 10, c: 0 }, e: { r: 10, c: 1 } }, { s: { r: 18, c: 0 }, e: { r: 18, c: 1 } }])
  })
  it('PDF: fără contact nu apare nimic nou; cu contact apar valorile, scăpate HTML', () => {
    const fara = buildOfertaProbaHtml(baza)
    expect(fara).not.toContain('Persoană de contact')
    expect(fara).toContain('PP-2026-001')
    const cu = buildOfertaProbaHtml({ ...baza, client_contact_nume: 'Ion <img src=x onerror=alert(1)>', client_contact_telefon: '0722 123 456' })
    expect(cu).toContain('Persoană de contact')
    expect(cu).toContain('0722 123 456')
    expect(cu).not.toContain('<img src=x')
    expect(cu).toContain(esc('<img src=x onerror=alert(1)>'))
  })
})
