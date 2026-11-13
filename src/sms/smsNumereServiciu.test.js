// 20261220a — numerele de serviciu în ecranul 📱 SMS: logica pură (argumentele RPC, filtrul, contorul, validarea din Setări) și apelurile API.
// Date fictive. Comportamentul din BD: scripts/pglite/test_sms_numere_serviciu_local.mjs.
import { describe, expect, it, vi } from 'vitest'
import { argumenteIntern, filtreazaNumereServiciu, numarSelectati, valideazaNumarServiciu, mesajDezactivare, filtreazaAngajati,
  lipsaRpcNumereServiciu, listaNumereDinRaspuns, incarcaNumereServiciu, reconciliazaNumereAlese, mesajScoaseDinSelectie, MAX_NUMERE_SERVICIU } from './smsLogica.js'
import { readFileSync } from 'node:fs'

const apeluri = []
vi.mock('../lib/supabase.js', () => ({
  supabase: {
    rpc: async (fn, args) => {
      apeluri.push([fn, args])
      if (fn === 'fn_sms_numere_serviciu_lista') return { data: { total: 1, numere: [{ id: 7, denumire: 'Telefon Test', telefon_mascat: '07** *** 201', optout: false }] }, error: null }
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

// r2 (P1): migrarea neaplicată = funcția NOASTRĂ lipsește (forma reală a erorii PostgREST); orice altceva = eroare (L18)
const LIPSA_LISTA = { code: 'PGRST202', message: 'Could not find the function public.fn_sms_numere_serviciu_lista without parameters in the schema cache',
  details: 'Searched for the function public.fn_sms_numere_serviciu_lista without parameters or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache.',
  hint: 'Perhaps you meant to call the function public.fn_sms_angajati_lista' }
const LIPSA_ADMIN = { code: 'PGRST202', message: 'Could not find the function public.fn_sms_numere_serviciu_admin without parameters in the schema cache', details: null, hint: null }
describe('r2 — detectarea migrării 20261220a neaplicate (sonda)', () => {
  it('lipsă = doar PGRST202 / 42883 care numesc o funcție 20261220a', () => {
    expect(lipsaRpcNumereServiciu(LIPSA_LISTA)).toBe(true)
    expect(lipsaRpcNumereServiciu(LIPSA_ADMIN)).toBe(true)
    expect(lipsaRpcNumereServiciu({ code: '42883', message: 'function public.fn_sms_numere_serviciu_lista() does not exist' })).toBe(true)
    expect(lipsaRpcNumereServiciu({ code: '42501', message: 'sms: nu ai acces la modulul SMS fn_sms_numere_serviciu_lista' })).toBe(false)
    expect(lipsaRpcNumereServiciu({ code: 'PGRST202', message: 'Could not find the function public.fn_alta without parameters in the schema cache' })).toBe(false)
    expect(lipsaRpcNumereServiciu({ code: '', message: 'Failed to fetch' })).toBe(false)
    expect(lipsaRpcNumereServiciu(null)).toBe(false)
    expect(lipsaRpcNumereServiciu('fn_sms_numere_serviciu_lista does not exist')).toBe(false)
  })
  it('„Perhaps you meant” către o funcție 20261220a = migrarea E acolo, contractul diferă → eroare, nu lipsă', () => {
    expect(lipsaRpcNumereServiciu({ ...LIPSA_ADMIN, hint: 'Perhaps you meant to call the function public.fn_sms_numere_serviciu_lista' })).toBe(false)
    expect(lipsaRpcNumereServiciu({ code: 'PGRST202', message: 'Could not find the function public.fn_sms_numar_serviciu_salveaza(p_id, p_denumire) in the schema cache',
      hint: 'Perhaps you meant to call the function public.fn_sms_numar_serviciu_salveaza(p_denumire, p_id, p_nota, p_responsabil_employee_id, p_telefon, p_versiune)' })).toBe(false)
  })
  it('încărcarea: da / lipsa (doar la sondă) / eroare; nu aruncă', async () => {
    const api = (r) => ({ numereServiciu: async () => { if (r?.code) throw r; return r } })
    expect(await incarcaNumereServiciu(api([{ id: 7 }]))).toEqual({ stare: 'da', numere: [{ id: 7 }], err: null })
    expect(await incarcaNumereServiciu(api(LIPSA_LISTA))).toEqual({ stare: 'lipsa', numere: [], err: null })
    // după o listă primită, funcția care dispare e eroare (nu ascundem nimic în tăcere)
    expect(await incarcaNumereServiciu(api(LIPSA_LISTA), { sonda: false })).toMatchObject({ stare: 'eroare', numere: null, err: LIPSA_LISTA })
    const drept = { code: '42501', message: 'sms: nu ai acces la modulul SMS' }
    expect(await incarcaNumereServiciu(api(drept))).toMatchObject({ stare: 'eroare', err: drept })
  })
})

// r2 (L23): lista vine ca UN obiect {total, numere}; trunchierea nu trece drept listă scurtă
describe('r2 — lista numerelor: total verificat, limita de active', () => {
  it('numere.length = total → lista; altfel eroare vizibilă', () => {
    expect(listaNumereDinRaspuns({ total: 0, numere: [] })).toEqual([])
    expect(listaNumereDinRaspuns({ total: 2, numere: [{ id: 1 }, { id: 2 }] })).toHaveLength(2)
    expect(() => listaNumereDinRaspuns({ total: 3, numere: [{ id: 1 }, { id: 2 }] })).toThrow(/incompletă \(2 din 3\)/)
    expect(() => listaNumereDinRaspuns([{ id: 1 }])).toThrow(/formă neașteptată/)
    expect(() => listaNumereDinRaspuns(null)).toThrow(/formă neașteptată/)
    expect(() => listaNumereDinRaspuns({ total: -1, numere: [] })).toThrow()
  })
  it('limita din interfață = cea din migrare (100 de numere active)', () => {
    const mig = readFileSync(new URL('../../supabase/migrations/20261220a_sms_numere_serviciu.sql', import.meta.url), 'utf8')
    expect(MAX_NUMERE_SERVICIU).toBe(100)
    expect(mig).toContain(`WHERE s.activ) >= ${MAX_NUMERE_SERVICIU} THEN`)
  })
})

// r2 (P2): după reîncărcare, selecția păstrează doar numerele încă active și fără opt-out; ce iese e anunțat cu denumirea
describe('r2 — reconcilierea selecției cu lista reîncărcată', () => {
  const vechi = [{ id: 7, denumire: 'Telefon Depozit' }, { id: 8, denumire: 'Telefon Birou' }, { id: 9, denumire: 'Telefon Santier' }]
  it('dezactivat (lipsă din listă) / opt-out = scos; activ = păstrat', () => {
    const noua = [{ id: 7, denumire: 'Telefon Depozit', optout: false }, { id: 9, denumire: 'Telefon Santier', optout: true }]
    const r = reconciliazaNumereAlese(new Set([7, 8, 9]), noua, vechi)
    expect([...r.alese]).toEqual([7])
    expect(r.scoase).toEqual([{ id: 8, denumire: 'Telefon Birou', motiv: 'inactiv' }, { id: 9, denumire: 'Telefon Santier', motiv: 'optout' }])
  })
  it('nimic schimbat = nimic scos; id necunoscut = „numărul #id”', () => {
    expect(reconciliazaNumereAlese(new Set([7]), vechi, vechi)).toEqual({ alese: new Set([7]), scoase: [] })
    expect(reconciliazaNumereAlese(new Set([42]), [], []).scoase).toEqual([{ id: 42, denumire: 'numărul #42', motiv: 'inactiv' }])
    expect(reconciliazaNumereAlese(null, null).alese.size).toBe(0)
  })
  it('mesajul pentru om', () => {
    expect(mesajScoaseDinSelectie([{ id: 8, denumire: 'Telefon Birou', motiv: 'inactiv' }]))
      .toBe('Numărul de serviciu „Telefon Birou” nu mai e activ și a fost scos din selecție. Verifică destinatarii și previzualizează din nou.')
    expect(mesajScoaseDinSelectie([{ id: 8, denumire: 'A', motiv: 'inactiv' }, { id: 9, denumire: 'B', motiv: 'inactiv' }])).toContain('„A”, „B” nu mai sunt active și au fost scoase')
    expect(mesajScoaseDinSelectie([{ id: 9, denumire: 'B', motiv: 'optout' }])).toContain('„B” are opt-out și a fost scos din selecție.')
    expect(mesajScoaseDinSelectie([])).toBe('')
  })
})
