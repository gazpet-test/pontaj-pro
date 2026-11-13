// 20261220a — numerele de serviciu în ecranul 📱 SMS: logica pură (argumentele RPC, filtrul, contorul, validarea din Setări) și apelurile API.
// Date fictive. Comportamentul din BD: scripts/pglite/test_sms_numere_serviciu_local.mjs.
import { describe, expect, it, vi } from 'vitest'
import { argumenteIntern, filtreazaNumereServiciu, numarSelectati, valideazaNumarServiciu, mesajDezactivare, filtreazaAngajati } from './smsLogica.js'

const apeluri = []
vi.mock('../lib/supabase.js', () => ({
  supabase: {
    rpc: async (fn, args) => {
      apeluri.push([fn, args])
      if (fn === 'fn_sms_numere_serviciu_lista') return { data: [{ id: 7, denumire: 'Telefon Test', telefon_mascat: '07** *** 201', optout: false }], error: null }
      if (fn === 'fn_sms_numere_serviciu_admin') return { data: null, error: { code: '42501', message: 'sms: doar owner-ul (Razvan) foloseste modulul SMS' } }
      return { data: { ok: true }, error: null }
    },
    from: t => { throw new Error('citire directă interzisă: ' + t) },
  },
}))
const { smsApi } = await import('./smsApi.js')

describe('argumenteIntern — numerele de serviciu doar la selecția manuală', () => {
  it('selecție manuală: numerele bifate pleacă în p_numere_serviciu (numere)', () => {
    expect(argumenteIntern('selectie', { selectati: [1], numereServiciu: ['7', 8] })).toEqual({ p_departamente: null, p_angajati: [1], p_numere_serviciu: [7, 8] })
  })
  it('doar numere, niciun angajat bifat: p_angajati = [-1] (niciun angajat), nu „toți”', () => {
    expect(argumenteIntern('selectie', { selectati: [], numereServiciu: [7] })).toEqual({ p_departamente: null, p_angajati: [-1], p_numere_serviciu: [7] })
  })
  it('fără numere bifate: cheia lipsește (apelul identic cu cel de dinainte de 20261220a)', () => {
    expect(argumenteIntern('selectie', { selectati: [3] })).toEqual({ p_departamente: null, p_angajati: [3] })
    expect(argumenteIntern('selectie', { selectati: [3], numereServiciu: [] })).not.toHaveProperty('p_numere_serviciu')
  })
  it('„toți” și „pe departament” NU trimit numere, chiar dacă au rămas bifate din selecția manuală', () => {
    expect(argumenteIntern('toti', { numereServiciu: [7] })).toEqual({ p_departamente: null, p_angajati: null })
    expect(argumenteIntern('departament', { departamente: ['TESA'], numereServiciu: [7] })).toEqual({ p_departamente: ['TESA'], p_angajati: null })
  })
})

describe('grupul „📞 Numere de serviciu”: căutarea și contorul', () => {
  const numere = [{ id: 7, denumire: 'Telefon Test Depozit' }, { id: 8, denumire: 'Alt Numar' }]
  const angajati = [{ id: 1, nume: 'TEST UNU', departament: 'TESA' }, { id: 2, nume: 'DEPOZIT DOI', departament: 'Logistică' }]
  it('căutarea după nume le prinde (fără diferență de litere mari / mici), la fel ca pe angajați', () => {
    expect(filtreazaNumereServiciu(numere, { cauta: ' depozit ' }).map(n => n.id)).toEqual([7])
    expect(filtreazaAngajati(angajati, { cauta: ' depozit ' }).map(a => a.id)).toEqual([2])
    expect(filtreazaNumereServiciu(numere, {}).map(n => n.id)).toEqual([7, 8])
    expect(filtreazaNumereServiciu(null)).toEqual([])
  })
  it('un filtru de departament le ascunde (nu țin de niciun departament)', () => {
    expect(filtreazaNumereServiciu(numere, { departament: 'TESA' })).toEqual([])
  })
  it('contorul „N selectați” numără angajații + numerele', () => {
    expect(numarSelectati(new Set([1, 2]), new Set([7]))).toBe(3)
    expect(numarSelectati(new Set(), new Set())).toBe(0)
    expect(numarSelectati(null, undefined)).toBe(0)
  })
})

describe('Setări → Numere de serviciu: validarea formularului (oglinda regulilor din BD)', () => {
  it('adăugare: denumire 2–60, telefon mobil RO obligatoriu', () => {
    expect(valideazaNumarServiciu({ denumire: 'Telefon Test', telefon: '0700 000 201' })).toEqual([])
    expect(valideazaNumarServiciu({ denumire: 'X', telefon: '0700000201' }).join(' ')).toContain('între 2 și 60')
    expect(valideazaNumarServiciu({ denumire: 'a'.repeat(61), telefon: '0700000201' }).join(' ')).toContain('între 2 și 60')
    expect(valideazaNumarServiciu({ denumire: 'Telefon Test', telefon: '' }).join(' ')).toContain('obligatoriu')
    expect(valideazaNumarServiciu({ denumire: 'Telefon Test', telefon: '0210000000' }).join(' ')).toContain('mobil românesc')
    expect(valideazaNumarServiciu({ denumire: 'Telefon Test', telefon: '0700000201', nota: 'n'.repeat(301) }).join(' ')).toContain('300')
  })
  it('modificare: telefonul gol = rămâne cel salvat; unul nou trebuie să fie valid', () => {
    expect(valideazaNumarServiciu({ denumire: 'Telefon Test', telefon: '' }, { nou: false })).toEqual([])
    expect(valideazaNumarServiciu({ denumire: 'Telefon Test', telefon: '12' }, { nou: false }).join(' ')).toContain('mobil românesc')
  })
  it('dezactivarea spune câte loturi active îl mai au (lista e fixată la creare)', () => {
    expect(mesajDezactivare({ denumire: 'Telefon Test', loturi_active: 0 })).toBe('„Telefon Test” e dezactivat: nu mai apare în „Compune”.')
    expect(mesajDezactivare({ denumire: 'Telefon Test', loturi_active: 1 })).toContain('Un lot activ îl mai are în coadă')
    expect(mesajDezactivare({ denumire: 'Telefon Test', loturi_active: 3 })).toContain('3 loturi active îl mai au')
  })
})

describe('smsApi — numerele de serviciu', () => {
  it('crearea lotului: p_numere_serviciu doar când e bifat vreunul', async () => {
    apeluri.length = 0
    await smsApi.creeazaIntern({ text: 'T', p_departamente: null, p_angajati: [1], preview: true })
    await smsApi.creeazaIntern({ text: 'T', p_departamente: null, p_angajati: [-1], p_numere_serviciu: [7], preview: false })
    expect(apeluri).toEqual([
      ['fn_sms_lot_intern_creeaza', { p_text: 'T', p_departamente: null, p_angajati: [1], p_doar_preview: true }],
      ['fn_sms_lot_intern_creeaza', { p_text: 'T', p_departamente: null, p_angajati: [-1], p_doar_preview: false, p_numere_serviciu: [7] }],
    ])
  })
  it('lista pentru „Compune” prin RPC (telefon mascat), niciodată din tabel', async () => {
    const l = await smsApi.numereServiciu()
    expect(l).toEqual([{ id: 7, denumire: 'Telefon Test', telefon_mascat: '07** *** 201', optout: false }])
    expect(JSON.stringify(l)).not.toMatch(/\+407/)
  })
  it('administrarea: argumentele exacte; refuzul BD (non-owner) ajunge la apelant, nu listă goală (L18)', async () => {
    apeluri.length = 0
    await smsApi.salveazaNumarServiciu({ id: null, denumire: 'Telefon Test', telefon: '0700 000 201', responsabilId: 8, nota: '', versiune: null })
    await smsApi.salveazaNumarServiciu({ id: 7, denumire: 'Telefon Test', telefon: '', responsabilId: null, nota: 'x', versiune: 2 })
    await smsApi.dezactiveazaNumarServiciu(7, 3)
    expect(apeluri).toEqual([
      ['fn_sms_numar_serviciu_salveaza', { p_id: null, p_denumire: 'Telefon Test', p_telefon: '0700 000 201', p_responsabil_employee_id: 8, p_nota: null, p_versiune: null }],
      ['fn_sms_numar_serviciu_salveaza', { p_id: 7, p_denumire: 'Telefon Test', p_telefon: null, p_responsabil_employee_id: null, p_nota: 'x', p_versiune: 2 }],
      ['fn_sms_numar_serviciu_dezactiveaza', { p_id: 7, p_versiune: 3 }],
    ])
    await expect(smsApi.numereServiciuAdmin()).rejects.toMatchObject({ code: '42501' })
  })
})
