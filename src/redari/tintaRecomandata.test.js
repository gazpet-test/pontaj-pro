import { describe, it, expect } from 'vitest'
import { TERMEN_RECOMANDAT_ZILE, MESAJ_TERMEN_RECOMANDAT, dataTintaRecomandata, subTintaRecomandata, termenAfisare, mesajTintaAfisare,
  recomandariUat, avertismenteUat, lipsuriUat, valideazaUat } from './setari.js'
import { textTintaExpediere, recomandareExpediere, avertismentExpediere, textTermenExpediere } from './plicuri.js'
import { propune, confirmariAplicare, reevalueazaTermene } from './importPostal.js'

// juridic#031 (04.11.2026): limita fermă = ziua 1 − 11 (10 zile libere, neschimbată); ținta RECOMANDATĂ = ziua 1 − 15, pentru cele
// 3–5 zile cât livrează poșta. Avertisment NON-blocant, aceeași regulă pentru expediere și pentru începutul afișării.
// Ziua 1 = 10.12.2026 → ținta 25.11.2026, limita 29.11.2026 (numărate în calendar, nu cu funcția testată). Exclusiv date fictive.
const uat = { id: 'uat-fictiv-a', nume: 'Comuna Fictivă', sesiune_zi1: '2026-12-10', program_zi1: '09:00 – 16:00', reprezentant_uat_nume: 'Repr. test' }

describe('ținta recomandată ziua 1 − 15 (juridic#031)', () => {
  it('constanta unică și mesajul', () => {
    expect(TERMEN_RECOMANDAT_ZILE).toBe(15)
    expect(MESAJ_TERMEN_RECOMANDAT).toBe('recomandat cu cel puțin 15 zile înainte, pentru livrarea poștei')
  })
  it('data țintei = ziua 1 minus 15 zile calendaristice; fără ziua 1 validă nu se calculează', () => {
    expect(dataTintaRecomandata('2026-12-10')).toBe('2026-11-25')
    expect(dataTintaRecomandata('2027-01-05')).toBe('2026-12-21')
    expect(dataTintaRecomandata('2028-03-15')).toBe('2028-02-29')
    for (const v of [null, undefined, '', '2026-02-30', '10.12.2026']) expect(dataTintaRecomandata(v)).toBeNull()
  })
  it('„sub țintă” doar între țintă (exclusiv) și limita fermă (inclusiv); după limită vorbește avertismentul de termen', () => {
    expect(subTintaRecomandata('2026-12-10', '2026-11-25')).toBe(false)
    expect(subTintaRecomandata('2026-12-10', '2026-11-20')).toBe(false)
    expect(subTintaRecomandata('2026-12-10', '2026-11-26')).toBe(true)
    expect(subTintaRecomandata('2026-12-10', '2026-11-29')).toBe(true)
    expect(subTintaRecomandata('2026-12-10', '2026-11-30')).toBe(false)
    expect(subTintaRecomandata('2026-12-10', '2026-12-40')).toBe(false)
    expect(subTintaRecomandata(null, '2026-11-27')).toBe(false)
  })
})

describe('afișarea la primărie (UAT): recomandare, nu avertisment de salvare', () => {
  it('termenAfisare expune ținta; mesajul apare doar sub țintă, în limita fermă', () => {
    const t = termenAfisare({ ...uat, afisare_data_start: '2026-11-27' })
    expect(t).toMatchObject({ tinta: '2026-11-25', limita: '2026-11-29', depasit: false, subRecomandat: true })
    expect(mesajTintaAfisare(t)).toBe('Afișarea la primărie începe pe 27.11.2026, după ținta recomandată 25.11.2026 (ziua 1: 10.12.2026) — ' +
      'recomandat cu cel puțin 15 zile înainte, pentru livrarea poștei; limita fermă rămâne 29.11.2026')
    expect(mesajTintaAfisare(termenAfisare({ ...uat, afisare_data_start: '2026-11-25' }))).toBeNull()
    expect(mesajTintaAfisare(termenAfisare({ ...uat, afisare_data_start: '2026-11-30' }))).toBeNull()
  })
  it('non-blocant: nu intră în avertismenteUat (confirmarea la salvare), nici în lipsuriUat („Gata de convocare?” rămâne ✓), nici în valideazaUat', () => {
    const u = { ...uat, afisare_data_start: '2026-11-28' }
    expect(recomandariUat(u)).toHaveLength(1)
    expect(avertismenteUat(u)).toEqual([])
    expect(lipsuriUat(u)).toEqual([])
    expect(valideazaUat(u)).toEqual([])
    // după limita fermă: avertismentul vechi, fără recomandare dublă
    const tarziu = { ...uat, afisare_data_start: '2026-11-30' }
    expect(avertismenteUat(tarziu)).toHaveLength(1)
    expect(recomandariUat(tarziu)).toEqual([])
  })
})

describe('expedierea plicurilor: ținta lângă limita fermă', () => {
  it('textul țintei și recomandarea non-blocantă', () => {
    expect(textTermenExpediere(uat)).toBe('expediați până la 29.11.2026')
    expect(textTintaExpediere(uat)).toBe('recomandat până la 25.11.2026 (recomandat cu cel puțin 15 zile înainte, pentru livrarea poștei)')
    expect(textTintaExpediere({ nume: 'Fără zile' })).toBe('')
    expect(recomandareExpediere(uat, '2026-11-28')).toBe('Data expedierii (28.11.2026) e după ținta recomandată 25.11.2026 pentru Comuna Fictivă ' +
      '(recomandat cu cel puțin 15 zile înainte, pentru livrarea poștei); limita fermă 29.11.2026 e respectată.')
    expect(recomandareExpediere(uat, '2026-11-25')).toBeNull()
    expect(recomandareExpediere(uat, '2026-12-03')).toBeNull()
    expect(avertismentExpediere(uat, '2026-11-28')).toBeNull()
  })
})

describe('importul poștal: recomandarea nu cere confirmare', () => {
  const mapare = { nr_document: 'doc', nr_tracking: 'awb', data: 'data', eveniment: 'status', motiv: 'motiv' }
  const plic = (extra = {}) => ({ id: 'plic-fictiv-1', proiect_id: 'proiect-fictiv', nr_plic: 'PL-HUS-0001', lot_id: 'lot-fictiv', opis_path: 'plicuri/plic-fictiv-1/opis-1.docx', awb: null,
    data_expediere: null, data_ar: null, retur: null, retur_data: null, stare: 'activ', versiune: 3, uat_id: 'uat-fictiv-a', ...extra })
  const rand = (extra = {}) => ({ doc: 'PL-HUS-0001', awb: 'AB123', data: '20.11.2026', __rand: 2, ...extra })
  const plicuri = [plic({ id: 'p1', nr_plic: 'PL-HUS-0001' }), plic({ id: 'p2', nr_plic: 'PL-HUS-0002' }), plic({ id: 'p3', nr_plic: 'PL-HUS-0003' })]
  const fisier = [rand({ doc: 'PL-HUS-0001', awb: 'AA1', data: '20.11.2026' }), rand({ doc: 'PL-HUS-0002', awb: 'AA2', data: '27.11.2026', __rand: 3 }),
    rand({ doc: 'PL-HUS-0003', awb: 'AA3', data: '02.12.2026', __rand: 4 })]
  it('rândul sub țintă are `recomandare`, rândul tardiv doar `avertisment`; confirmarea numără doar tardivele', () => {
    const r = propune(fisier, mapare, 'expediere', plicuri, { uats: [uat] })
    expect(r.aplicabile.filter(a => a.recomandare).map(a => a.nr_document)).toEqual(['PL-HUS-0002'])
    expect(r.aplicabile.filter(a => a.avertisment).map(a => a.nr_document)).toEqual(['PL-HUS-0003'])
    expect(r.aplicabile.find(a => a.nr_document === 'PL-HUS-0003').recomandare).toBeUndefined()
    const m = confirmariAplicare(r, 'TEST-PR')
    expect(m).toHaveLength(2)
    expect(m[1]).toMatch(/^1 din 3 expedieri/)
    // fără tardive, doar sub țintă: o singură confirmare (cea generală)
    expect(confirmariAplicare(propune([fisier[1]], mapare, 'expediere', plicuri, { uats: [uat] }), 'TEST-PR')).toHaveLength(1)
  })
  it('recitirea recalculează și recomandarea, fără să marcheze `schimbat`', () => {
    const r = propune(fisier, mapare, 'expediere', plicuri, { uats: [uat] })
    // ziua 1 mutată la 15.12 → ținta 30.11, limita 04.12: 27.11 nu mai e sub țintă; 02.12 devine sub țintă (nu mai e tardiv)
    const mutat = reevalueazaTermene(r.aplicabile, [{ ...uat, sesiune_zi1: '2026-12-15' }])
    expect(mutat.aplicabile.filter(a => a.recomandare).map(a => a.nr_document)).toEqual(['PL-HUS-0003'])
    expect(mutat.aplicabile.some(a => a.avertisment)).toBe(false)
    expect(mutat.schimbat).toBe(true)   // a dispărut un avertisment ferm
    const doarTinta = reevalueazaTermene(propune([fisier[0]], mapare, 'expediere', plicuri, { uats: [uat] }).aplicabile, [{ ...uat, sesiune_zi1: '2026-12-04' }])
    // 20.11 cu ziua 1 = 04.12: ținta 19.11, limita 23.11 → doar recomandare, `schimbat` rămâne false
    expect(doarTinta.aplicabile[0].recomandare).toBeTruthy()
    expect(doarTinta.schimbat).toBe(false)
  })
})
