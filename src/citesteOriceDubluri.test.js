import { describe, it, expect } from 'vitest'
import {
  dataAIValida, textAIValid, esteDinDrive, cheieDosar, perechiDeVerificat, bucati,
  clasificaDublura, campuriDeCompletat, updateCompletare, fmtZi, liniaObservatii,
  observatiiNoi, analizaDublura, TEXT_AI_MAX,
} from './citesteOriceDubluri.js'

const TIPURI = [
  { id:1, cod:'buletin', denumire:'Buletin / CI' },
  { id:2, cod:'cazier_judiciar', denumire:'Cazier judiciar' },
]
const docDrive = (o = {}) => ({
  id:10, employee_id:7, tip_id:1, fisier_nume:'CI.pdf', fisier_size_bytes:1234,
  fisier_path:'7/drive/abc.pdf', drive_file_id:'abc', uploadat_de:null,
  numar_document:null, emitent:null, data_emitere:'2020-05-01', data_expirare:null,
  observatii:'Adus din Drive.', ...o,
})
const rowAI = (o = {}) => ({
  id:501, status:'clasificat', fisier_nume:'CI.pdf', fisier_size_bytes:1234, tip_document:'buletin',
  payload_ai:{ date_document:{ numar:' RX 123456 ', emitent:'SPCLEP Ploiești', data_emitere:'2021-01-02', data_expirare:'2031-01-02' } },
  ...o,
})

describe('dataAIValida', () => {
  it('acceptă YYYY-MM-DD real, inclusiv 29 feb în an bisect', () => {
    expect(dataAIValida('2026-10-21')).toBe('2026-10-21')
    expect(dataAIValida('2024-02-29')).toBe('2024-02-29')
    expect(dataAIValida(' 2030-12-31 ')).toBe('2030-12-31')
  })
  it('respinge date inexistente, alt format, în afara 1900..2100, non-string', () => {
    for (const v of ['2026-02-30', '2025-02-29', '2026-13-01', '2026-04-31', '2026-00-10', '2026-01-00',
      '21.10.2026', '2026-1-5', '2026-10-21T00:00:00', '1899-12-31', '2101-01-01', '', null, undefined, 20261021, {}]) {
      expect(dataAIValida(v)).toBeNull()
    }
    expect(dataAIValida('1900-01-01')).toBe('1900-01-01')
    expect(dataAIValida('2100-12-31')).toBe('2100-12-31')
  })
})

describe('textAIValid', () => {
  it('curăță spațiile, acceptă număr, refuză gol / prea lung / obiecte', () => {
    expect(textAIValid('  AB 12 ')).toBe('AB 12')
    expect(textAIValid(123456)).toBe('123456')
    expect(textAIValid('   ')).toBeNull()
    expect(textAIValid('')).toBeNull()
    expect(textAIValid(null)).toBeNull()
    expect(textAIValid(NaN)).toBeNull()
    expect(textAIValid({ a:1 })).toBeNull()
    expect(textAIValid('x'.repeat(TEXT_AI_MAX))).toHaveLength(TEXT_AI_MAX)
    expect(textAIValid('x'.repeat(TEXT_AI_MAX + 1))).toBeNull()
  })
})

describe('esteDinDrive', () => {
  it('cale /drive/, drive_file_id sau uploadat_de null → Drive', () => {
    expect(esteDinDrive(docDrive())).toBe(true)
    expect(esteDinDrive({ fisier_path:'7/drive/x.pdf', drive_file_id:null, uploadat_de:'u' })).toBe(true)
    expect(esteDinDrive({ fisier_path:'7/a.pdf', drive_file_id:'d', uploadat_de:'u' })).toBe(true)
    expect(esteDinDrive({ fisier_path:'7/a.pdf', drive_file_id:null, uploadat_de:null })).toBe(true)
    expect(esteDinDrive({ fisier_path:'7/aidoc_1.pdf', drive_file_id:null, uploadat_de:'u' })).toBe(false)
    expect(esteDinDrive(null)).toBe(false)
  })
})

describe('perechiDeVerificat + bucati', () => {
  it('sare rândurile fără angajat, deduplică perechile', () => {
    const rows = [
      { id:1, fisier_nume:'a.pdf', e:7 }, { id:2, fisier_nume:'a.pdf', e:7 },
      { id:3, fisier_nume:'a.pdf', e:8 }, { id:4, fisier_nume:'b.pdf', e:null }, { id:5, fisier_nume:null, e:7 },
    ]
    const p = perechiDeVerificat(rows, r => r.e)
    expect(p.map(x => x.k)).toEqual([cheieDosar(7, 'a.pdf'), cheieDosar(8, 'a.pdf')])
    expect(p[0]).toMatchObject({ emp:7, nume:'a.pdf' })
  })
  it('împarte în bucăți', () => {
    expect(bucati([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(bucati([], 3)).toEqual([])
  })
})

describe('clasificaDublura', () => {
  it('același fișier = nume + mărime egală la același angajat; ia cel mai vechi și numără copiile', () => {
    const docs = [docDrive({ id:30 }), docDrive({ id:12 }), docDrive({ id:20, fisier_size_bytes:999 })]
    const c = clasificaDublura(rowAI(), docs, 7)
    expect(c.tip).toBe('acelasi')
    expect(c.doc.id).toBe(12)
    expect(c.nrIdentice).toBe(2)
    expect(c.nrTotal).toBe(3)
  })
  it('mărimea poate veni ca string (bigint)', () => {
    expect(clasificaDublura(rowAI({ fisier_size_bytes:'1234' }), [docDrive()], 7).tip).toBe('acelasi')
  })
  it('același nume, altă mărime → alt_continut', () => {
    const c = clasificaDublura(rowAI(), [docDrive({ fisier_size_bytes:4321 })], 7)
    expect(c).toMatchObject({ tip:'alt_continut', doc:null, nrTotal:1, marimiNecunoscute:false })
  })
  it('mărimi necunoscute → alt_continut, nu închidere automată', () => {
    expect(clasificaDublura(rowAI({ fisier_size_bytes:null }), [docDrive()], 7)).toMatchObject({ tip:'alt_continut', marimiNecunoscute:true })
    expect(clasificaDublura(rowAI(), [docDrive({ fisier_size_bytes:null })], 7)).toMatchObject({ tip:'alt_continut', marimiNecunoscute:true })
  })
  it('ignoră alți angajați, alte nume, documente șterse', () => {
    const docs = [docDrive({ employee_id:8 }), docDrive({ fisier_nume:'ci.pdf' }), docDrive({ deleted_at:'2026-10-01' })]
    expect(clasificaDublura(rowAI(), docs, 7).tip).toBeNull()
    expect(clasificaDublura(rowAI(), [docDrive()], null).tip).toBeNull()
  })
})

describe('campuriDeCompletat', () => {
  it('doar câmpurile NULL din dosar, doar cu valori AI valide', () => {
    const c = campuriDeCompletat(docDrive(), rowAI().payload_ai.date_document)
    expect(c.map(x => x.camp)).toEqual(['numar_document', 'emitent', 'data_expirare'])   // data_emitere e deja pusă
    expect(c[0].val).toBe('RX 123456')
  })
  it('nu oferă valori invalide și nu atinge textul gol din dosar', () => {
    const c = campuriDeCompletat(docDrive({ emitent:'' }), { numar:'', emitent:'X', data_emitere:'2026-02-30', data_expirare:'2026-02-30' })
    expect(c).toEqual([])
  })
  it('fără date_document → nimic', () => {
    expect(campuriDeCompletat(docDrive(), null)).toEqual([])
    expect(campuriDeCompletat(docDrive(), 'text')).toEqual([])
    expect(campuriDeCompletat(null, {})).toEqual([])
  })
})

describe('observații + update', () => {
  it('linia are inbox-ul, data dd.mm.yyyy și câmpurile', () => {
    const l = liniaObservatii(501, new Date(2026, 9, 21, 15, 0), [{ eticheta:'nr. document' }, { eticheta:'emitent' }])
    expect(l).toBe('Completat din «Citește orice» (inbox #501, 21.10.2026): nr. document, emitent')
    expect(fmtZi(new Date(2026, 0, 5))).toBe('05.01.2026')
  })
  it('păstrează observațiile vechi, separate prin linie nouă', () => {
    expect(observatiiNoi('Adus din Drive.', 'L')).toBe('Adus din Drive.\nL')
    expect(observatiiNoi(null, 'L')).toBe('L')
    expect(observatiiNoi('  ', 'L')).toBe('L')
  })
  it('updateCompletare pune fara_expirare=false doar când intră data expirării', () => {
    const cu = updateCompletare([{ camp:'data_expirare', val:'2031-01-02' }], 'vechi', 'L')
    expect(cu).toEqual({ data_expirare:'2031-01-02', fara_expirare:false, observatii:'vechi\nL' })
    const fara = updateCompletare([{ camp:'emitent', val:'X' }], null, 'L')
    expect(fara).toEqual({ emitent:'X', observatii:'L' })
  })
})

describe('analizaDublura', () => {
  it('același fișier, același tip → câmpurile de completat + Drive', () => {
    const a = analizaDublura({ row:rowAI(), docs:[docDrive()], angajatId:7, tipuriFK:TIPURI, tipAI:'buletin' })
    expect(a).toMatchObject({ tip:'acelasi', dinDrive:true, tipDiferit:false })
    expect(a.tipDosar.cod).toBe('buletin')
    expect(a.campuri.map(x => x.camp)).toEqual(['numar_document', 'emitent', 'data_expirare'])
  })
  it('tip diferit sau necunoscut → nu completez nimic', () => {
    const dif = analizaDublura({ row:rowAI(), docs:[docDrive()], angajatId:7, tipuriFK:TIPURI, tipAI:'cazier_judiciar' })
    expect(dif).toMatchObject({ tip:'acelasi', tipDiferit:true, campuri:[] })
    const necunoscut = analizaDublura({ row:rowAI(), docs:[docDrive({ tip_id:99 })], angajatId:7, tipuriFK:TIPURI, tipAI:'buletin' })
    expect(necunoscut).toMatchObject({ tipDiferit:true, tipDosar:null, campuri:[] })
    const faraTipAI = analizaDublura({ row:rowAI(), docs:[docDrive()], angajatId:7, tipuriFK:TIPURI, tipAI:'' })
    expect(faraTipAI).toMatchObject({ tipDiferit:true, campuri:[] })
  })
  it('rând eroare (AI n-a citit) → doar închidere, fără completare', () => {
    const a = analizaDublura({ row:rowAI({ status:'eroare', payload_ai:null, tip_document:null }), docs:[docDrive()], angajatId:7, tipuriFK:TIPURI, tipAI:null })
    expect(a).toMatchObject({ tip:'acelasi', tipDiferit:false, campuri:[] })
  })
  it('după completare (câmpuri pline) reîncercarea doar închide', () => {
    const plin = docDrive({ numar_document:'RX 123456', emitent:'SPCLEP Ploiești', data_expirare:'2031-01-02' })
    const a = analizaDublura({ row:rowAI(), docs:[plin], angajatId:7, tipuriFK:TIPURI, tipAI:'buletin' })
    expect(a.campuri).toEqual([])
  })
  it('alt conținut / fără dublură trec mai departe neschimbate', () => {
    expect(analizaDublura({ row:rowAI(), docs:[docDrive({ fisier_size_bytes:1 })], angajatId:7, tipuriFK:TIPURI, tipAI:'buletin' }).tip).toBe('alt_continut')
    expect(analizaDublura({ row:rowAI(), docs:[], angajatId:7, tipuriFK:TIPURI, tipAI:'buletin' }).tip).toBeNull()
  })
})
