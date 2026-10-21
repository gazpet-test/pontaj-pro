import { describe, it, expect } from 'vitest'
import {
  dataAIValida, textAIValid, esteDinDrive, cheieDosar, perechiDeVerificat, bucati,
  clasificaDublura, campuriDeCompletat, updateCompletare, fmtZi, liniaObservatii,
  observatiiNoi, analizaDublura, TEXT_AI_MAX, esteActiv, blocheazaInserare, eroareInchidereRand, inchidereFaraRezultat,
  texteAltContinut, marime, gardaDocDosar, potrivesteGarda, grupeDupaAngajat, rezultatCautareDosar, mesajEroareCautare,
  gardaFinalaHR, randInchisSigur,
} from './citesteOriceDubluri.js'

const TIPURI = [
  { id:1, cod:'buletin', denumire:'Buletin / CI' },
  { id:2, cod:'cazier_judiciar', denumire:'Cazier judiciar' },
]
const docDrive = (o = {}) => ({
  id:10, employee_id:7, tip_id:1, activ:true, fisier_nume:'CI.pdf', fisier_size_bytes:1234,
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
  it('r2: o copie fără mărime + una cu altă mărime → tot necunoscut (copia fără mărime poate fi chiar fișierul)', () => {
    const docs = [docDrive({ id:11, fisier_size_bytes:null }), docDrive({ id:12, fisier_size_bytes:4321 })]
    expect(clasificaDublura(rowAI(), docs, 7)).toMatchObject({ tip:'alt_continut', marimiNecunoscute:true, nrTotal:2 })
    // mărime '' (string gol) = necunoscută
    expect(clasificaDublura(rowAI(), [docDrive({ fisier_size_bytes:'' })], 7).marimiNecunoscute).toBe(true)
    // o copie fără mărime nu ascunde una identică: același fișier rămâne „acelasi"
    expect(clasificaDublura(rowAI(), [docDrive({ id:11, fisier_size_bytes:null }), docDrive({ id:12 })], 7)).toMatchObject({ tip:'acelasi', marimiNecunoscute:false })
  })
  it('r1: copia ACTIVĂ câștigă în fața uneia inactive mai vechi (cazul CI.pdf #12 arhivat + #480 activ)', () => {
    const docs = [docDrive({ id:480 }), docDrive({ id:12, activ:false })]
    const c = clasificaDublura(rowAI(), docs, 7)
    expect(c).toMatchObject({ tip:'acelasi', nrIdentice:2, nrInactive:1, nrTotal:2 })
    expect(c.doc.id).toBe(480)
  })
  it('r1: doar copii inactive → acelasi_inactiv, cea mai veche inactivă', () => {
    const docs = [docDrive({ id:40, activ:false }), docDrive({ id:12, activ:false }), docDrive({ id:5, fisier_size_bytes:1 })]
    const c = clasificaDublura(rowAI(), docs, 7)
    expect(c).toMatchObject({ tip:'acelasi_inactiv', nrIdentice:2, nrInactive:2, nrTotal:3 })
    expect(c.doc.id).toBe(12)
  })
  it('r1: activ null / lipsă = activ (convenția din TabDocumentePersonale)', () => {
    expect(esteActiv({ activ:null })).toBe(true)
    expect(esteActiv({})).toBe(true)
    expect(esteActiv({ activ:false })).toBe(false)
    expect(esteActiv(null)).toBe(false)
    expect(clasificaDublura(rowAI(), [docDrive({ activ:null })], 7).tip).toBe('acelasi')
  })
  it('r1: inactiv cu altă mărime rămâne alt_continut', () => {
    expect(clasificaDublura(rowAI(), [docDrive({ activ:false, fisier_size_bytes:9 })], 7).tip).toBe('alt_continut')
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
  it('r1: doar copie inactivă → nu completez nimic, dar arăt tipul și sursa', () => {
    const a = analizaDublura({ row:rowAI(), docs:[docDrive({ activ:false })], angajatId:7, tipuriFK:TIPURI, tipAI:'buletin' })
    expect(a).toMatchObject({ tip:'acelasi_inactiv', dinDrive:true, tipDiferit:false, campuri:[] })
    expect(a.tipDosar.cod).toBe('buletin')
    const er = analizaDublura({ row:rowAI({ status:'eroare', payload_ai:null }), docs:[docDrive({ activ:false })], angajatId:7, tipuriFK:TIPURI, tipAI:null })
    expect(er).toMatchObject({ tip:'acelasi_inactiv', campuri:[] })
  })
  it('alt conținut / fără dublură trec mai departe neschimbate', () => {
    expect(analizaDublura({ row:rowAI(), docs:[docDrive({ fisier_size_bytes:1 })], angajatId:7, tipuriFK:TIPURI, tipAI:'buletin' }).tip).toBe('alt_continut')
    expect(analizaDublura({ row:rowAI(), docs:[], angajatId:7, tipuriFK:TIPURI, tipAI:'buletin' }).tip).toBeNull()
  })
})

describe('blocheazaInserare (garda din confirmHR)', () => {
  const cls = tip => ({ tip })
  it('nimic în dosar → se poate insera', () => {
    expect(blocheazaInserare(cls(null))).toBeNull()
    expect(blocheazaInserare(null)).toBeNull()
  })
  it('același fișier activ → blochează mereu, indiferent de excepții', () => {
    expect(blocheazaInserare(cls('acelasi'))).toBe('acelasi')
    expect(blocheazaInserare(cls('acelasi'), { faraGardaNume:true, faraGardaInactiv:true })).toBe('acelasi')
  })
  it('alt conținut → trece doar cu faraGardaNume', () => {
    expect(blocheazaInserare(cls('alt_continut'))).toBe('alt_continut')
    expect(blocheazaInserare(cls('alt_continut'), { faraGardaInactiv:true })).toBe('alt_continut')
    expect(blocheazaInserare(cls('alt_continut'), { faraGardaNume:true })).toBeNull()
  })
  it('r2: doar inactiv (același fișier, istoric) → blochează mereu, nu mai există excepție de inserare', () => {
    expect(blocheazaInserare(cls('acelasi_inactiv'))).toBe('acelasi_inactiv')
    expect(blocheazaInserare(cls('acelasi_inactiv'), { faraGardaNume:true })).toBe('acelasi_inactiv')
    expect(blocheazaInserare(cls('acelasi_inactiv'), { faraGardaInactiv:true })).toBe('acelasi_inactiv')   // opțiunea r1 nu mai există
    const c = clasificaDublura(rowAI(), [docDrive({ id:12, activ:false })], 7)
    expect(blocheazaInserare(c, { faraGardaNume:true, marimiComparate:true })).toBe('acelasi_inactiv')
  })
  it('cap-coadă: copia inactivă + una activă identică → blocat', () => {
    const c = clasificaDublura(rowAI(), [docDrive({ id:12, activ:false }), docDrive({ id:480 })], 7)
    expect(blocheazaInserare(c, { faraGardaNume:true })).toBe('acelasi')
  })
  it('r2: omul a confirmat „altă mărime", dar între timp a apărut o copie fără mărime → blochează', () => {
    const cunoscut = clasificaDublura(rowAI(), [docDrive({ fisier_size_bytes:4321 })], 7)
    expect(blocheazaInserare(cunoscut, { faraGardaNume:true, marimiComparate:true })).toBeNull()
    const acum = clasificaDublura(rowAI(), [docDrive({ id:11, fisier_size_bytes:4321 }), docDrive({ id:12, fisier_size_bytes:null })], 7)
    expect(blocheazaInserare(acum, { faraGardaNume:true, marimiComparate:true })).toBe('alt_continut')
    // omul a confirmat deja varianta „nu pot verifica" → trece
    expect(blocheazaInserare(acum, { faraGardaNume:true, marimiComparate:false })).toBeNull()
    expect(blocheazaInserare(acum, { faraGardaNume:true })).toBeNull()
  })
})

describe('eroareInchidereRand (finalizeInbox, toate modulele)', () => {
  it('un rând actualizat → null (închis)', () => {
    expect(eroareInchidereRand({ data:[{ id:1 }], error:null })).toBeNull()
  })
  it('eroare / 0 rânduri / lipsă rezultat → mesaj, fără excepție', () => {
    expect(eroareInchidereRand({ data:null, error:{ message:'rls' } })).toMatch(/salvat, dar rândul din coadă nu s-a putut închide: rls/)
    expect(eroareInchidereRand({ data:[], error:null })).toMatch(/fără drept de modificare/)
    expect(eroareInchidereRand(undefined)).toMatch(/nu s-a putut închide/)
    expect(eroareInchidereRand({ error:new Error('Failed to fetch') })).toMatch(/Failed to fetch/)
  })
})

describe('texteAltContinut (r2: „altă mărime" doar când mărimile s-au comparat)', () => {
  it('mărimi comparate → „alt fișier (altă mărime)", cu numărul de documente', () => {
    const dub = clasificaDublura(rowAI(), [docDrive({ fisier_size_bytes:4321 }), docDrive({ id:11, fisier_size_bytes:9 })], 7)
    const t = texteAltContinut(dub, 'CI.pdf')
    expect(t.necunoscut).toBe(false)
    expect(t.panou).toBe('⚠️ există «CI.pdf» la acest angajat, dar e alt fișier (altă mărime) — 2 documente cu acest nume.')
    expect(t.confirmare).toMatch(/alt fișier \(altă mărime\)\.\n\nÎl adaug ca document NOU/)
    expect(t.garda).toMatch(/alt fișier \(altă mărime\)/)
  })
  it('mărime necunoscută (în dosar sau la rând) → NU spune „alt fișier / altă mărime", trimite la 👁 Vezi', () => {
    for (const dub of [
      clasificaDublura(rowAI(), [docDrive({ fisier_size_bytes:null })], 7),
      clasificaDublura(rowAI({ fisier_size_bytes:null }), [docDrive()], 7),
      clasificaDublura(rowAI(), [docDrive({ id:11, fisier_size_bytes:null }), docDrive({ id:12, fisier_size_bytes:4321 })], 7),
    ]) {
      const t = texteAltContinut(dub, 'CI.pdf')
      expect(t.necunoscut).toBe(true)
      for (const txt of [t.panou, t.confirmare, t.garda]) {
        expect(txt).not.toMatch(/altă mărime/)
        expect(txt).not.toMatch(/e alt fișier/)
        expect(txt).toMatch(/mărime necunoscută/)
      }
      expect(t.panou).toMatch(/👁 Vezi/)
      expect(t.confirmare).toMatch(/poate fi chiar același/)
    }
  })
  it('fără informație → varianta prudentă (necunoscut)', () => {
    expect(texteAltContinut(null, 'x.pdf').necunoscut).toBe(true)
    expect(texteAltContinut({ tip:'alt_continut' }, 'x.pdf').necunoscut).toBe(true)
  })
})

describe('inchidereFaraRezultat (0 rânduri fără eroare = de verificat prin reîncărcare)', () => {
  it('doar 0 rânduri fără eroare', () => {
    expect(inchidereFaraRezultat({ data:[], error:null })).toBe(true)
    expect(inchidereFaraRezultat({ data:[{ id:1 }], error:null })).toBe(false)
    expect(inchidereFaraRezultat({ data:null, error:{ message:'x' } })).toBe(false)
    expect(inchidereFaraRezultat(undefined)).toBe(false)
  })
})

// ─── Review extern (Copilot + Jakarinos, 21.10) ──────────────────────────────
describe('F1/F6 gardaDocDosar — identitatea documentului din dosar', () => {
  const doc = docDrive({ id:12, fara_expirare:true })
  it('doar închidere: id + nesters + activ + angajat + nume + mărime (fără tip / câmpuri)', () => {
    expect(gardaDocDosar({ doc, angajatId:'7', row:rowAI() })).toEqual([
      ['eq', 'id', 12], ['is', 'deleted_at', null], ['is', 'activ', true],
      ['eq', 'employee_id', 7], ['eq', 'fisier_nume', 'CI.pdf'], ['eq', 'fisier_size_bytes', 1234],
    ])
  })
  it('completare: + tip, câmpurile goale, fara_expirare (doar cu data expirării), observații', () => {
    const campuri = [{ camp:'numar_document', val:'X' }, { camp:'data_expirare', val:'2031-01-02' }]
    const g = gardaDocDosar({ doc, angajatId:7, row:rowAI(), campuri })
    expect(g.slice(6)).toEqual([
      ['eq', 'tip_id', 1], ['is', 'numar_document', null], ['is', 'data_expirare', null],
      ['eq', 'fara_expirare', true], ['eq', 'observatii', 'Adus din Drive.'],
    ])
    // fără data expirării → nicio gardă pe fara_expirare
    const g2 = gardaDocDosar({ doc, angajatId:7, row:rowAI(), campuri:[{ camp:'emitent', val:'X' }] })
    expect(g2.some(([, col]) => col === 'fara_expirare')).toBe(false)
  })
  it('F6: fara_expirare false → eq false; null / lipsă → is null', () => {
    const c = [{ camp:'data_expirare', val:'2031-01-02' }]
    expect(gardaDocDosar({ doc:docDrive({ fara_expirare:false }), angajatId:7, row:rowAI(), campuri:c })).toContainEqual(['eq', 'fara_expirare', false])
    expect(gardaDocDosar({ doc:docDrive({ fara_expirare:null }), angajatId:7, row:rowAI(), campuri:c })).toContainEqual(['is', 'fara_expirare', null])
    expect(gardaDocDosar({ doc:docDrive(), angajatId:7, row:rowAI(), campuri:c })).toContainEqual(['is', 'fara_expirare', null])
  })
  it('valori null → is; mărime string (bigint) → număr; activ null rămâne null', () => {
    const g = gardaDocDosar({ doc:docDrive({ activ:null, fisier_size_bytes:'1234', observatii:null, tip_id:null }), angajatId:7, row:rowAI(), campuri:[] })
    expect(g).toContainEqual(['is', 'activ', null])
    expect(g).toContainEqual(['eq', 'fisier_size_bytes', 1234])
    expect(g).toContainEqual(['is', 'tip_id', null])
    expect(g).toContainEqual(['is', 'observatii', null])
  })
  it('potrivesteGarda: același document trece; alt angajat / nume / mărime / șters / alt activ → nu', () => {
    const garda = gardaDocDosar({ doc, angajatId:7, row:rowAI() })
    const citit = { id:12, employee_id:7, fisier_nume:'CI.pdf', fisier_size_bytes:'1234', activ:true, deleted_at:null }
    expect(potrivesteGarda(citit, garda)).toBe(true)
    for (const o of [{ employee_id:8 }, { fisier_nume:'ci.pdf' }, { fisier_size_bytes:999 }, { fisier_size_bytes:null },
      { deleted_at:'2026-10-21' }, { activ:false }, { id:13 }]) {
      expect(potrivesteGarda({ ...citit, ...o }, garda)).toBe(false)
    }
    expect(potrivesteGarda(null, garda)).toBe(false)
    // activ văzut null (= activ) → rândul citit trebuie să aibă tot null
    const gNull = gardaDocDosar({ doc:docDrive({ id:12, activ:null }), angajatId:7, row:rowAI() })
    expect(potrivesteGarda({ ...citit, activ:null }, gNull)).toBe(true)
    expect(potrivesteGarda({ ...citit, activ:true }, gNull)).toBe(false)
  })
  it('marime: număr / string numeric → număr; gol / invalid → null', () => {
    expect(marime('12')).toBe(12)
    expect(marime(0)).toBe(0)
    expect(marime('')).toBeNull()
    expect(marime(null)).toBeNull()
    expect(marime('x')).toBeNull()
  })
})

describe('F4 grupeDupaAngajat — per angajat, nu produs cartezian', () => {
  it('un grup = un angajat + cel mult n nume ale lui', () => {
    const perechi = perechiDeVerificat([
      { fisier_nume:'a.pdf', e:7 }, { fisier_nume:'b.pdf', e:8 }, { fisier_nume:'c.pdf', e:7 }, { fisier_nume:'d.pdf', e:7 },
    ], r => r.e)
    const g = grupeDupaAngajat(perechi, 2)
    expect(g.map(x => [x.emp, x.nume])).toEqual([[7, ['a.pdf', 'c.pdf']], [7, ['d.pdf']], [8, ['b.pdf']]])
    expect(g[0].perechi.map(p => p.k)).toEqual([cheieDosar(7, 'a.pdf'), cheieDosar(7, 'c.pdf')])
    expect(grupeDupaAngajat([], 25)).toEqual([])
    expect(grupeDupaAngajat(null, 25)).toEqual([])
  })
})

describe('F3/F4 rezultatCautareDosar — trunchiat = eroare, nu „liber"', () => {
  it('eroare / fără date → eroare', () => {
    expect(rezultatCautareDosar({ data:null, error:{ message:'x' } })).toEqual({ err:'eroare' })
    expect(rezultatCautareDosar({ data:null, error:null })).toEqual({ err:'eroare' })
    expect(rezultatCautareDosar(undefined)).toEqual({ err:'eroare' })
  })
  it('limita atinsă → trunchiat (F4)', () => {
    expect(rezultatCautareDosar({ data:[1, 2, 3], error:null }, { limita:3 })).toEqual({ err:'trunchiat' })
    expect(rezultatCautareDosar({ data:[1, 2], error:null }, { limita:3 })).toEqual({ docs:[1, 2] })
  })
  it('count > rânduri primite → trunchiat; count cerut dar lipsă → eroare (F3)', () => {
    expect(rezultatCautareDosar({ data:[1, 2], error:null, count:5 }, { limita:500, cuNumar:true })).toEqual({ err:'trunchiat' })
    expect(rezultatCautareDosar({ data:[1, 2], error:null, count:null }, { limita:500, cuNumar:true })).toEqual({ err:'eroare' })
    expect(rezultatCautareDosar({ data:[1, 2], error:null }, { cuNumar:true })).toEqual({ err:'eroare' })
    expect(rezultatCautareDosar({ data:[1, 2], error:null, count:2 }, { limita:500, cuNumar:true })).toEqual({ docs:[1, 2] })
    expect(rezultatCautareDosar({ data:[], error:null, count:0 }, { limita:500, cuNumar:true })).toEqual({ docs:[] })
  })
  it('căutarea exactă (limit 1, fără limita) — un rând găsit nu e „trunchiat"', () => {
    expect(rezultatCautareDosar({ data:[{ id:1 }], error:null })).toEqual({ docs:[{ id:1 }] })
  })
  it('mesajEroareCautare', () => {
    expect(mesajEroareCautare('trunchiat', 'CI.pdf')).toMatch(/prea multe documente „CI\.pdf"/)
    expect(mesajEroareCautare('eroare', 'CI.pdf')).toMatch(/Nu am putut verifica dosarul/)
  })
})

describe('F3 gardaFinalaHR — garda din confirmHR, fail-closed', () => {
  const ok = docs => ({ docs })
  it('căutarea exactă găsește copia → blochează (activ / istoric), fără să mai conteze căutarea pe nume', () => {
    expect(gardaFinalaHR({ row:rowAI(), angajatId:7, exact:ok([docDrive()]), nume:null }).bloc).toBe('acelasi')
    expect(gardaFinalaHR({ row:rowAI(), angajatId:7, exact:ok([docDrive({ activ:false })]), nume:null }).bloc).toBe('acelasi_inactiv')
    expect(gardaFinalaHR({ row:rowAI(), angajatId:7, exact:ok([docDrive()]), nume:null, opts:{ faraGardaNume:true } }).bloc).toBe('acelasi')
  })
  it('căutare picată / trunchiată → err (nu se inserează)', () => {
    expect(gardaFinalaHR({ row:rowAI(), angajatId:7, exact:{ err:'eroare' }, nume:ok([]) })).toEqual({ err:'eroare' })
    expect(gardaFinalaHR({ row:rowAI(), angajatId:7, exact:ok([]), nume:{ err:'trunchiat' } })).toEqual({ err:'trunchiat' })
    expect(gardaFinalaHR({ row:rowAI(), angajatId:7, exact:ok([]), nume:null })).toEqual({ err:'eroare' })
    expect(gardaFinalaHR({ row:rowAI({ fisier_size_bytes:null }), angajatId:7, exact:null, nume:{ err:'eroare' } })).toEqual({ err:'eroare' })
  })
  it('exactă goală → decide căutarea completă pe nume (liber / alt conținut / excepția omului)', () => {
    expect(gardaFinalaHR({ row:rowAI(), angajatId:7, exact:ok([]), nume:ok([]) }).bloc).toBeNull()
    const alt = gardaFinalaHR({ row:rowAI(), angajatId:7, exact:ok([]), nume:ok([docDrive({ fisier_size_bytes:4321 })]) })
    expect(alt.bloc).toBe('alt_continut')
    expect(alt.cls.marimiNecunoscute).toBe(false)
    expect(gardaFinalaHR({ row:rowAI(), angajatId:7, exact:ok([]), nume:ok([docDrive({ fisier_size_bytes:4321 })]),
      opts:{ faraGardaNume:true, marimiComparate:true } }).bloc).toBeNull()
    // cursă: copia identică apare între cele două căutări → căutarea pe nume o prinde
    expect(gardaFinalaHR({ row:rowAI(), angajatId:7, exact:ok([]), nume:ok([docDrive()]), opts:{ faraGardaNume:true } }).bloc).toBe('acelasi')
  })
  it('mărime necunoscută (exact = null) → doar căutarea pe nume', () => {
    const r = gardaFinalaHR({ row:rowAI({ fisier_size_bytes:null }), angajatId:7, exact:null, nume:ok([docDrive()]) })
    expect(r.bloc).toBe('alt_continut')
    expect(r.cls.marimiNecunoscute).toBe(true)
  })
})

describe('F5 randInchisSigur — staging-ul se șterge doar pe rând sigur închis', () => {
  it('UPDATE-ul a întors rândul → închis', () => {
    expect(randInchisSigur({ data:[{ id:5 }], error:null }, null, 5)).toBe(true)
  })
  it('eroare / rezultat lipsă → nu (staging-ul rămâne pentru reîncercare și 👁 Vezi)', () => {
    expect(randInchisSigur({ data:null, error:{ message:'x' } }, [], 5)).toBe(false)
    expect(randInchisSigur({ error:new Error('Failed to fetch') }, [], 5)).toBe(false)
    expect(randInchisSigur(undefined, [], 5)).toBe(false)
  })
  it('0 rânduri fără eroare → închis doar dacă coada reîncărcată nu-l mai conține', () => {
    const zero = { data:[], error:null }
    expect(randInchisSigur(zero, [{ id:6 }], 5)).toBe(true)
    expect(randInchisSigur(zero, [], 5)).toBe(true)
    expect(randInchisSigur(zero, [{ id:5 }], 5)).toBe(false)
    expect(randInchisSigur(zero, null, 5)).toBe(false)   // reîncărcarea a picat → necunoscut
  })
})
