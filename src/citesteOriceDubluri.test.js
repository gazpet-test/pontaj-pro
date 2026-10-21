import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  dataAIValida, textAIValid, esteDinDrive, cheieDosar, perechiDeVerificat, bucati,
  clasificaDublura, campuriDeCompletat, updateCompletare, fmtZi, liniaObservatii,
  observatiiNoi, analizaDublura, TEXT_AI_MAX, esteActiv, blocheazaInserare, inchidereFaraRezultat,
  texteAltContinut, marime, gardaDocDosar, potrivesteGarda, grupeDupaAngajat, rezultatCautareDosar, mesajEroareCautare,
  gardaFinalaHR, stareInchidere, mesajInchidere, MESAJ_RAND_NEVERIFICAT, MESAJ_RAND_NEINCHIS,
  motivFaraExpirare, stagingSters, MESAJ_STAGING_RAMAS, textConfirmareRespingere, mesajRespingere,
  mesajBlocareHR, dosarInVerificare,
  respingereServer, citireNecesara,
  rezultatProvenienta, provenientaLaAltAngajat, mesajProvenienta, pastreazaEditari, STATUS_COADA,
  MESAJ_RAND_ALTCINEVA, avertizareStaging,
  dinRandul, lipsaMigrareSursa, dublaSursaInbox, rezultatInserareHR, MESAJ_MIGRARE_SURSA,
  refuzSursaInbox, copieDeSters, MESAJ_SURSA_REFUZATA, mesajRefuzSursa, docWizardHR, inchidereWizardHR, decizieWizardHR,
  MESAJ_WIZ_DUBLA, MESAJ_WIZ_REFUZ, MESAJ_WIZ_NEVERIFICAT, mesajWizardInchidere, stergeStagingWizard,
  fisierDinRand, faraMetadateSursa, MESAJ_SURSA_FARA_METADATE, MESAJ_WIZ_FARA_METADATE, refuzFisierSursa,
  MESAJ_SURSA_FISIER, MESAJ_WIZ_FISIER,
} from './citesteOriceDubluri.js'
import * as dubluri from './citesteOriceDubluri.js'

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
  it('HR-1: document marcat „fără expirare" → data expirării nu se propune (restul da)', () => {
    const c = campuriDeCompletat(docDrive({ fara_expirare:true }), rowAI().payload_ai.date_document)
    expect(c.map(x => x.camp)).toEqual(['numar_document', 'emitent'])
    // fara_expirare false / null → se propune ca înainte
    expect(campuriDeCompletat(docDrive({ fara_expirare:false }), rowAI().payload_ai.date_document).map(x => x.camp)).toContain('data_expirare')
    expect(campuriDeCompletat(docDrive({ fara_expirare:null }), rowAI().payload_ai.date_document).map(x => x.camp)).toContain('data_expirare')
  })
  it('HR-1: opts.faraExpirare (tip fără expirare) → data expirării nu se propune', () => {
    const c = campuriDeCompletat(docDrive(), rowAI().payload_ai.date_document, { faraExpirare:true })
    expect(c.map(x => x.camp)).toEqual(['numar_document', 'emitent'])
  })
})

describe('HR-1 motivFaraExpirare', () => {
  it('dosar „fără expirare" are prioritate; apoi tipul fără expirare; altfel null', () => {
    expect(motivFaraExpirare({ fara_expirare:true }, { are_expirare:true })).toBe('dosar')
    expect(motivFaraExpirare({ fara_expirare:false }, { are_expirare:false })).toBe('tip')
    expect(motivFaraExpirare({ fara_expirare:null }, { are_expirare:true })).toBeNull()
    expect(motivFaraExpirare({}, null)).toBeNull()
    expect(motivFaraExpirare(null, { are_expirare:null })).toBeNull()   // are_expirare necunoscut ≠ fără expirare
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
  it('HR-1: dosar „fără expirare" → nu completez data expirării și spun de ce', () => {
    const a = analizaDublura({ row:rowAI(), docs:[docDrive({ fara_expirare:true })], angajatId:7, tipuriFK:TIPURI, tipAI:'buletin' })
    expect(a.campuri.map(x => x.camp)).toEqual(['numar_document', 'emitent'])
    expect(a.expirareOmisa).toEqual({ motiv:'dosar', val:'2031-01-02' })
  })
  it('HR-1: tipul din dosar n-are expirare → nu completez data expirării', () => {
    const tipuri = [{ id:1, cod:'buletin', denumire:'Buletin / CI', are_expirare:false }]
    const a = analizaDublura({ row:rowAI(), docs:[docDrive()], angajatId:7, tipuriFK:tipuri, tipAI:'buletin' })
    expect(a.campuri.map(x => x.camp)).toEqual(['numar_document', 'emitent'])
    expect(a.expirareOmisa).toEqual({ motiv:'tip', val:'2031-01-02' })
  })
  it('HR-1: fără notă când nu e cazul (expirare normală, dată deja pusă, AI fără dată validă, tip diferit, rând eroare)', () => {
    const an = o => analizaDublura({ row:rowAI(), docs:[docDrive()], angajatId:7, tipuriFK:TIPURI, tipAI:'buletin', ...o })
    expect(an().expirareOmisa).toBeNull()
    expect(an({ docs:[docDrive({ fara_expirare:true, data_expirare:'2030-01-01' })] }).expirareOmisa).toBeNull()
    expect(an({ row:rowAI({ payload_ai:{ date_document:{ data_expirare:'2026-02-30' } } }), docs:[docDrive({ fara_expirare:true })] }).expirareOmisa).toBeNull()
    expect(an({ docs:[docDrive({ fara_expirare:true })], tipAI:'cazier_judiciar' }).expirareOmisa).toBeNull()
    const er = analizaDublura({ row:rowAI({ status:'eroare' }), docs:[docDrive({ fara_expirare:true })], angajatId:7, tipuriFK:TIPURI, tipAI:'buletin' })
    expect(er.expirareOmisa).toBeNull()
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

describe('inchidereFaraRezultat (0 rânduri fără eroare = de verificat prin citirea directă a rândului)', () => {
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
    const g = gardaDocDosar({ doc:docDrive({ id:12, fara_expirare:false }), angajatId:7, row:rowAI(), campuri })
    expect(g.slice(6)).toEqual([
      ['eq', 'tip_id', 1], ['is', 'numar_document', null], ['is', 'data_expirare', null],
      ['eq', 'fara_expirare', false], ['eq', 'observatii', 'Adus din Drive.'],
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
  it('HR-1: garda nu acceptă niciodată fara_expirare = true (o alegere „fără expirare" nu se calcă)', () => {
    const g = gardaDocDosar({ doc, angajatId:7, row:rowAI(), campuri:[{ camp:'data_expirare', val:'2031-01-02' }] })
    expect(g).toContainEqual(['is', 'fara_expirare', null])
    expect(g).not.toContainEqual(['eq', 'fara_expirare', true])
    expect(potrivesteGarda({ ...doc, numar_document:null }, g)).toBe(false)   // rândul cu fara_expirare true nu trece
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
  it('C1: cu count, decide count > rânduri primite — exact 500 din 500 NU e trunchiat', () => {
    const r500 = Array.from({ length:500 }, (_, i) => ({ id:i + 1 }))
    expect(rezultatCautareDosar({ data:r500, error:null, count:500 }, { limita:500, cuNumar:true })).toEqual({ docs:r500 })
    expect(rezultatCautareDosar({ data:r500, error:null, count:501 }, { limita:500, cuNumar:true })).toEqual({ err:'trunchiat' })
    // max-rows al serverului sub limita cerută: mai puține rânduri, count mai mare → trunchiat
    expect(rezultatCautareDosar({ data:[1, 2], error:null, count:3 }, { limita:500, cuNumar:true })).toEqual({ err:'trunchiat' })
    // fără count → abia atunci contează limita atinsă
    expect(rezultatCautareDosar({ data:r500, error:null, count:null }, { limita:500, cuNumar:true })).toEqual({ err:'trunchiat' })
    expect(rezultatCautareDosar({ data:r500, error:null }, { limita:500 })).toEqual({ err:'trunchiat' })
    expect(rezultatCautareDosar({ data:r500.slice(0, 499), error:null }, { limita:500 })).toEqual({ docs:r500.slice(0, 499) })
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

describe('r4 stareInchidere — nu din coada modulului (F5 rezidual)', () => {
  const zero = { data:[], error:null }
  it('UPDATE cu rând întors → inchis; refuz sigur al serverului (4xx) → deschis, fără citire', () => {
    expect(stareInchidere({ data:[{ id:5 }], error:null, status:200 }, null)).toBe('inchis')
    expect(stareInchidere({ data:null, error:{ code:'42501', message:'new row violates row-level security policy' }, status:403 }, null)).toBe('deschis')
    expect(stareInchidere({ data:null, error:{ code:'23514', message:'check' }, status:400 }, null)).toBe('deschis')
    // refuz sigur: chiar dacă o citire ar arăta altceva, nu contează (UPDATE-ul nu s-a aplicat)
    expect(stareInchidere({ data:null, error:{ code:'42501' }, status:403 }, { data:{ id:5, status:'confirmat' }, error:null })).toBe('deschis')
  })
  it('J2: eroare fără răspuns HTTP / 5xx / fără răspuns → NU „deschis" orbește: fără citire = necunoscut', () => {
    expect(stareInchidere({ error:new Error('Failed to fetch') }, null)).toBe('necunoscut')
    expect(stareInchidere({ data:null, error:{ message:'TypeError: Failed to fetch', code:'' }, status:0 }, null)).toBe('necunoscut')
    expect(stareInchidere({ data:null, error:{ message:'gateway' }, status:504 }, null)).toBe('necunoscut')
    expect(stareInchidere({ data:null, error:{ code:'42501', message:'rls' } }, null)).toBe('necunoscut')   // fără status = nu e refuz sigur
    expect(stareInchidere(undefined, null)).toBe('necunoscut')
  })
  it('J2: UPDATE intrat + răspuns pierdut („Failed to fetch") + citirea arată statusul țintă → inchis', () => {
    const pierdut = { data:null, error:{ message:'TypeError: Failed to fetch', details:'', hint:'', code:'' }, count:null, status:0, statusText:'' }
    expect(citireNecesara(pierdut)).toBe(true)
    expect(stareInchidere(pierdut, { data:{ id:5, status:'confirmat' }, error:null })).toBe('inchis')
    expect(stareInchidere(pierdut, { data:{ id:5, status:'clasificat' }, error:null })).toBe('deschis')   // vizibil, alt status
    expect(stareInchidere(pierdut, { data:null, error:null })).toBe('necunoscut')                          // invizibil
    expect(stareInchidere(pierdut, { data:null, error:{ message:'Failed to fetch' } })).toBe('necunoscut')  // citirea a picat
    expect(stareInchidere({ error:new Error('timeout') }, { data:{ id:5, status:'confirmat' }, error:null })).toBe('inchis')   // excepție prinsă
    expect(stareInchidere({ data:null, error:{ message:'bad gateway' }, status:502 }, { data:{ id:5, status:'confirmat' }, error:null })).toBe('inchis')
  })
  it('rând mutat în alt modul, invizibil pentru cel care confirmă → necunoscut (NU închis)', () => {
    // coada HR reîncărcată nu-l mai conține — vechiul criteriu ar fi spus „închis"
    expect(stareInchidere(zero, { data:null, error:null })).toBe('necunoscut')
  })
  it('vizibil și deschis → deschis; vizibil și confirmat → inchis', () => {
    expect(stareInchidere(zero, { data:{ id:5, status:'clasificat' }, error:null })).toBe('deschis')
    expect(stareInchidere(zero, { data:{ id:5, status:'eroare' }, error:null })).toBe('deschis')
    expect(stareInchidere(zero, { data:{ id:5, status:'confirmat' }, error:null })).toBe('inchis')
  })
  it('NH-2: statusTinta „respins" (✕ Respinge) — aceeași logică', () => {
    expect(stareInchidere({ data:[{ id:5 }], error:null }, null, 'respins')).toBe('inchis')
    expect(stareInchidere(zero, { data:{ id:5, status:'respins' }, error:null }, 'respins')).toBe('inchis')
    // F2 (r6): confirmat între timp de altcineva = închis, dar nu de ✕ Respinge → 'altcineva' (nu „încearcă din nou")
    expect(stareInchidere(zero, { data:{ id:5, status:'confirmat' }, error:null }, 'respins')).toBe('altcineva')
    expect(stareInchidere({ data:null, error:{ code:'42501', message:'rls' }, status:403 }, null, 'respins')).toBe('deschis')
  })
  it('J2 + NH-2: ✕ Respinge cu răspuns pierdut — citirea decide (respins → inchis; alt status → deschis; invizibil → necunoscut)', () => {
    const pierdut = { data:null, error:{ message:'TypeError: Failed to fetch', code:'' }, status:0 }
    expect(stareInchidere(pierdut, { data:{ id:5, status:'respins' }, error:null }, 'respins')).toBe('inchis')
    expect(stareInchidere(pierdut, { data:{ id:5, status:'clasificat' }, error:null }, 'respins')).toBe('deschis')
    expect(stareInchidere(pierdut, { data:null, error:null }, 'respins')).toBe('necunoscut')
    expect(mesajRespingere(stareInchidere(pierdut, { data:{ id:5, status:'respins' }, error:null }, 'respins'), pierdut.error)).toEqual({ tip:'ok', msg:'Respins.' })
  })
  it('citire picată / lipsă → necunoscut; răspuns ciudat (fără rânduri, fără eroare) → decide citirea', () => {
    expect(stareInchidere(zero, { data:null, error:{ message:'timeout' } })).toBe('necunoscut')
    expect(stareInchidere(zero, null)).toBe('necunoscut')
    expect(stareInchidere({ data:null, error:null }, null)).toBe('necunoscut')
    expect(stareInchidere({ data:null, error:null }, { data:{ id:5, status:'confirmat' } })).toBe('inchis')
  })
})

describe('J2 respingereServer / citireNecesara', () => {
  it('refuz sigur doar cu eroare + status HTTP 4xx', () => {
    expect(respingereServer({ error:{ code:'42501' }, status:403 })).toBe(true)
    expect(respingereServer({ error:{ code:'PGRST204' }, status:400 })).toBe(true)
    expect(respingereServer({ error:{ message:'conflict' }, status:409 })).toBe(true)
    expect(respingereServer({ error:{ message:'Failed to fetch' }, status:0 })).toBe(false)
    expect(respingereServer({ error:{ message:'x' }, status:500 })).toBe(false)
    expect(respingereServer({ error:{ message:'x' }, status:503 })).toBe(false)
    expect(respingereServer({ error:new Error('x') })).toBe(false)
    expect(respingereServer({ data:[], error:null, status:404 })).toBe(false)   // fără eroare
    expect(respingereServer(undefined)).toBe(false)
  })
  it('citire după UPDATE: da la 0 rânduri / transport / 5xx / fără răspuns; nu la rând întors sau refuz sigur', () => {
    expect(citireNecesara({ data:[{ id:1 }], error:null, status:200 })).toBe(false)
    expect(citireNecesara({ data:null, error:{ code:'42501' }, status:403 })).toBe(false)
    expect(citireNecesara({ data:[], error:null, status:200 })).toBe(true)
    expect(citireNecesara({ data:null, error:{ message:'Failed to fetch' }, status:0 })).toBe(true)
    expect(citireNecesara({ data:null, error:{ message:'x' }, status:504 })).toBe(true)
    expect(citireNecesara({ error:new Error('x') })).toBe(true)
    expect(citireNecesara(undefined)).toBe(true)
  })
})

describe('r4 mesajInchidere', () => {
  it('închis → ok cu mesajul modulului; necunoscut → warn neutru; deschis → err', () => {
    expect(mesajInchidere('inchis', 'Gata ✓')).toEqual({ tip:'ok', msg:'Gata ✓' })
    expect(mesajInchidere('necunoscut', 'Gata ✓')).toEqual({ tip:'warn', msg:MESAJ_RAND_NEVERIFICAT })
    expect(MESAJ_RAND_NEVERIFICAT).toMatch(/salvat/)
    expect(MESAJ_RAND_NEVERIFICAT).not.toMatch(/✓/)
    expect(mesajInchidere('deschis', 'Gata ✓')).toEqual({ tip:'err', msg:MESAJ_RAND_NEINCHIS })
    expect(mesajInchidere(undefined, 'Gata ✓').tip).toBe('err')
  })
  it('HR-2: rândul neînchis se scoate cu butonul roșu al cardului — «✕ Respinge» sau «✕ Scoate din coadă» (card „eroare")', () => {
    expect(MESAJ_RAND_NEINCHIS).toBe('Documentul e salvat, dar rândul din coadă nu s-a putut închide — nu-l confirma din nou; scoate-l cu «✕ Respinge» / «✕ Scoate din coadă» (rândul apare ca respins, documentul rămâne salvat).')
    for (const m of [MESAJ_RAND_NEINCHIS, MESAJ_RAND_NEVERIFICAT]) {
      expect(m).toMatch(/«✕ Respinge»/)
      expect(m).toMatch(/«✕ Scoate din coadă»/)
      expect(m).toMatch(/apare ca respins/)   // NH-2: omul află că rândul va figura ca respins
      expect(m).toMatch(/nu-l confirma din nou/)
      expect(m).not.toMatch(/Reîncearcă/)
    }
  })
  it('NH-1: fișierul din staging nerămas șters → avertisment explicit că încă un Confirmă ar salva a doua oară', () => {
    expect(mesajInchidere('deschis', 'Gata ✓', { stagingRamas:true })).toEqual({ tip:'err', msg:MESAJ_RAND_NEINCHIS + MESAJ_STAGING_RAMAS })
    expect(mesajInchidere('necunoscut', 'Gata ✓', { stagingRamas:true })).toEqual({ tip:'warn', msg:MESAJ_RAND_NEVERIFICAT + MESAJ_STAGING_RAMAS })
    expect(mesajInchidere('inchis', 'Gata ✓', { stagingRamas:true })).toEqual({ tip:'ok', msg:'Gata ✓' })   // rând închis → nu se mai confirmă
    expect(MESAJ_STAGING_RAMAS).toMatch(/a doua oară/)
    expect(mesajInchidere('deschis', 'Gata ✓', { stagingRamas:false }).msg).toBe(MESAJ_RAND_NEINCHIS)
  })
})

describe('NH-1 stagingSters (storage-js nu aruncă la remove)', () => {
  it('sigur șters doar fără eroare și cu fișierul întors', () => {
    expect(stagingSters({ data:[{ name:'x.pdf' }], error:null })).toBe(true)
    expect(stagingSters({ data:null, error:{ message:'Failed to fetch' } })).toBe(false)   // rețea / server
    expect(stagingSters({ data:[], error:null })).toBe(false)   // nimic șters (fără drept / cale lipsă)
    expect(stagingSters({ data:null, error:new Error('x') })).toBe(false)   // interogheaza după o excepție
    expect(stagingSters(undefined)).toBe(false)
  })
})

describe('RB2 / NH-2 ✕ Respinge', () => {
  it('confirmarea e neutră: nu afirmă ca sigur „nu intră în sistem" — documentul deja salvat rămâne salvat', () => {
    const t = textConfirmareRespingere('CI.pdf')
    expect(t).toMatch(/„CI\.pdf"/)
    expect(t).toMatch(/rămâne salvat/)
    expect(t).toMatch(/apare ca respins/)
    expect(t).toMatch(/Altfel nu intră în sistem/)
  })
  it('rezultatul verificat: închis → Respins.; deschis → eroare cu motivul; necunoscut → avertisment', () => {
    expect(mesajRespingere('inchis', null)).toEqual({ tip:'ok', msg:'Respins.' })
    const err = mesajRespingere('deschis', { message:'new row violates row-level security policy' })
    expect(err.tip).toBe('err')
    expect(err.msg).toMatch(/NU a ieșit din coadă: new row violates/)
    expect(mesajRespingere('deschis', null).msg).toBe('Rândul NU a ieșit din coadă — încearcă din nou.')
    expect(mesajRespingere('necunoscut', null).tip).toBe('warn')
    expect(mesajRespingere(undefined, null).tip).toBe('err')
  })
})

// ─── Review final (Jakarinos P1, 21.10) → proveniență structurală (decizia owner 21.10, varianta A, 20261103a) ──
describe('J1 proveniența structurală sursa_inbox_id', () => {
  it('eticheta din observații a dispărut: nimic nu mai scrie / citește „[Citește orice #N]"', () => {
    for (const n of ['tagProvenienta', 'areTagProvenienta', 'observatiiInserareHR']) expect(dubluri[n]).toBeUndefined()
    // un text de etichetă rămas în observațiile unui document vechi nu mai face nimic
    expect(clasificaDublura(rowAI({ fisier_size_bytes:null }), [docDrive({ id:900, fisier_size_bytes:null, observatii:'[Citește orice #501]' })], 7))
      .toMatchObject({ tip:'alt_continut', dinRand:false })
  })
  it('dinRandul: același id (număr sau text), nimic la NULL / lipsă; #12 ≠ #123 ≠ #1', () => {
    expect(dinRandul({ sursa_inbox_id:501 }, { id:501 })).toBe(true)
    expect(dinRandul({ sursa_inbox_id:'501' }, { id:501 })).toBe(true)   // bigint ca text
    expect(dinRandul({ sursa_inbox_id:12 }, { id:123 })).toBe(false)
    expect(dinRandul({ sursa_inbox_id:123 }, { id:12 })).toBe(false)
    expect(dinRandul({ sursa_inbox_id:12 }, { id:1 })).toBe(false)
    expect(dinRandul({ sursa_inbox_id:null }, { id:501 })).toBe(false)
    expect(dinRandul({}, { id:501 })).toBe(false)
    expect(dinRandul({ sursa_inbox_id:501 }, { id:null })).toBe(false)
    expect(dinRandul(null, { id:501 })).toBe(false)
    expect(dinRandul({ sursa_inbox_id:501 }, null)).toBe(false)
  })
  it('observațiile editate liber din dosar nu mai pierd proveniența (motivul variantei A)', () => {
    const editat = docDrive({ id:900, fisier_size_bytes:999, observatii:'notă HR, eticheta ștearsă', sursa_inbox_id:501 })
    expect(clasificaDublura(rowAI(), [editat], 7)).toMatchObject({ tip:'acelasi', dinRand:true })
    expect(clasificaDublura(rowAI(), [{ ...editat, observatii:null }], 7)).toMatchObject({ tip:'acelasi', dinRand:true })
  })
  it('clasificare: documentul salvat din ACEST rând = acelasi oricare i-ar fi mărimea (necunoscută / diferită)', () => {
    const tag = { sursa_inbox_id:501 }
    // mărime necunoscută la rând și în dosar
    expect(clasificaDublura(rowAI({ fisier_size_bytes:null }), [docDrive({ id:900, fisier_size_bytes:null, ...tag })], 7))
      .toMatchObject({ tip:'acelasi', dinRand:true, nrIdentice:1, marimiNecunoscute:false })
    // mărime diferită
    const c = clasificaDublura(rowAI(), [docDrive({ id:900, fisier_size_bytes:999, ...tag })], 7)
    expect(c).toMatchObject({ tip:'acelasi', dinRand:true })
    expect(c.doc.id).toBe(900)
    // salvat din ALT rând → ca înainte (alt conținut, mărime necunoscută)
    expect(clasificaDublura(rowAI({ id:50, fisier_size_bytes:null }), [docDrive({ id:900, fisier_size_bytes:null, ...tag })], 7))
      .toMatchObject({ tip:'alt_continut', dinRand:false, marimiNecunoscute:true })
    expect(clasificaDublura(rowAI({ id:5012, fisier_size_bytes:null }), [docDrive({ id:900, fisier_size_bytes:null, ...tag })], 7).tip).toBe('alt_continut')
    // alt angajat / șters → nu contează
    expect(clasificaDublura(rowAI({ fisier_size_bytes:null }), [docDrive({ employee_id:8, ...tag }), docDrive({ deleted_at:'2026-10-21', ...tag })], 7).tip).toBeNull()
  })
  it('clasificare: cel salvat din rând (activ) câștigă în fața unei copii identice mai vechi; activ înaintea celui salvat din rând inactiv', () => {
    const tag = { sursa_inbox_id:501 }
    const a = clasificaDublura(rowAI(), [docDrive({ id:12 }), docDrive({ id:900, ...tag })], 7)
    expect(a).toMatchObject({ tip:'acelasi', dinRand:true, nrIdentice:2 })
    expect(a.doc.id).toBe(900)
    const b = clasificaDublura(rowAI(), [docDrive({ id:12 }), docDrive({ id:900, activ:false, ...tag })], 7)
    expect(b).toMatchObject({ tip:'acelasi', dinRand:false, nrIdentice:2, nrInactive:1 })
    expect(b.doc.id).toBe(12)
    const c = clasificaDublura(rowAI({ fisier_size_bytes:null }), [docDrive({ id:900, activ:false, ...tag })], 7)
    expect(c).toMatchObject({ tip:'acelasi_inactiv', dinRand:true })
  })
  it('analiza: salvat deja din rând → doar închidere (nimic de completat, fără „tip diferit")', () => {
    const doc = docDrive({ id:900, fisier_size_bytes:null, numar_document:null, emitent:null, sursa_inbox_id:501 })
    const a = analizaDublura({ row:rowAI({ fisier_size_bytes:null }), docs:[doc], angajatId:7, tipuriFK:TIPURI, tipAI:'cazier_judiciar' })
    expect(a).toMatchObject({ tip:'acelasi', dinRand:true, tipDiferit:false, campuri:[], expirareOmisa:null })
    expect(a.doc.id).toBe(900)
  })
  it('REPRO: mărime necunoscută + închiderea a picat + staging păstrat → reîncercarea NU mai poate insera', () => {
    const row = rowAI({ id:501, fisier_size_bytes:null, payload_ai:{ titlu_scurt:'CI Popescu', date_document:{} } })
    const exact = null   // mărime necunoscută → fără căutarea exactă
    const opts = { faraGardaNume:true, marimiComparate:false }   // „Adaugă ca document nou" după „nu pot verifica"
    // 1. prima apăsare: în dosar e doar o copie mai veche fără mărime → omul confirmă documentul nou → se inserează
    const vechi = docDrive({ id:12, fisier_size_bytes:null })
    expect(gardaFinalaHR({ row, angajatId:7, exact, nume:{ docs:[vechi] }, opts }).bloc).toBeNull()
    const salvat = { id:900, employee_id:7, fisier_nume:row.fisier_nume, fisier_size_bytes:row.fisier_size_bytes,
      activ:true, deleted_at:null, observatii:'CI Popescu', sursa_inbox_id:row.id }
    // 2. închiderea rândului pică (rețea) și ștergerea din staging pică → rândul rămâne în coadă, fișierul în staging
    const stare = stareInchidere({ data:null, error:{ message:'TypeError: Failed to fetch' }, status:0 }, { data:null, error:{ message:'Failed to fetch' } })
    expect(stare).toBe('necunoscut')
    expect(stagingSters({ data:null, error:{ message:'Failed to fetch' } })).toBe(false)
    // 3. reîncercare cu aceeași excepție: fără proveniență (vechiul comportament) trecea → a doua copie (exact bug-ul)
    const fara = gardaFinalaHR({ row, angajatId:7, exact, nume:{ docs:[vechi, { ...salvat, sursa_inbox_id:null }] }, opts })
    expect(fara.bloc).toBeNull()
    const g = gardaFinalaHR({ row, angajatId:7, exact, nume:{ docs:[vechi, salvat] }, opts })
    expect(g.bloc).toBe('acelasi')
    expect(g.cls).toMatchObject({ dinRand:true })
    expect(g.cls.doc.id).toBe(900)
    expect(mesajBlocareHR(g.bloc, g.cls, row.fisier_nume)).toMatch(/deja salvat în dosar din acest rând \(#900\)/)
    // 4. panoul oferă doar închiderea legată de documentul salvat
    const a = analizaDublura({ row, docs:[vechi, salvat], angajatId:7, tipuriFK:TIPURI, tipAI:'buletin' })
    expect(a).toMatchObject({ tip:'acelasi', dinRand:true, campuri:[] })
    expect(a.doc.id).toBe(900)
    // garda „doar închidere" se potrivește pe documentul salvat (mărime null → is null)
    const garda = gardaDocDosar({ doc:a.doc, angajatId:7, row })
    expect(garda).toContainEqual(['is', 'fisier_size_bytes', null])
    expect(potrivesteGarda(salvat, garda)).toBe(true)
  })
  it('REPRO (mărime cunoscută, dar diferită în dosar): căutarea exactă goală, cea pe nume prinde proveniența', () => {
    const row = rowAI({ id:501 })
    const salvat = docDrive({ id:900, fisier_size_bytes:4321, sursa_inbox_id:row.id })
    const g = gardaFinalaHR({ row, angajatId:7, exact:{ docs:[] }, nume:{ docs:[salvat] }, opts:{ faraGardaNume:true, marimiComparate:true } })
    expect(g.bloc).toBe('acelasi')
    expect(g.cls.dinRand).toBe(true)
  })
})

describe('mesajBlocareHR', () => {
  it('mesaje pe tipul blocării', () => {
    expect(mesajBlocareHR('acelasi', { tip:'acelasi', dinRand:false, doc:{ id:3 } }, 'CI.pdf')).toBe('E deja în dosar — folosește «Închide» sau «Completează și închide».')
    expect(mesajBlocareHR('acelasi_inactiv', { tip:'acelasi_inactiv', dinRand:true, doc:{ id:3 } }, 'CI.pdf')).toMatch(/INACTIV/)
    const alt = clasificaDublura(rowAI(), [docDrive({ fisier_size_bytes:4321 })], 7)
    expect(mesajBlocareHR('alt_continut', alt, 'CI.pdf')).toBe(texteAltContinut(alt, 'CI.pdf').garda)
  })
})

// ─── Review final (Copilot P2, 21.10) ────────────────────────────────────────
describe('C2 dosarInVerificare — reverificarea nu mai arată rezultatul vechi', () => {
  it('scoate cheile reverificate, le păstrează pe celelalte; fără chei de scos → același obiect', () => {
    const kA = cheieDosar(7, 'CI.pdf'), kB = cheieDosar(8, 'CI.pdf')
    const d = { [kA]:{ docs:[] }, [kB]:{ docs:[docDrive()] } }
    // A→B→A: la revenirea pe A, cheia A trece în „verific" (lipsă) până vine răspunsul nou
    const n = dosarInVerificare(d, [kA])
    expect(n).toEqual({ [kB]:{ docs:[docDrive()] } })
    expect(d[kA]).toEqual({ docs:[] })   // obiectul vechi nu se modifică
    expect(dosarInVerificare(d, [cheieDosar(9, 'x.pdf')])).toBe(d)
    expect(dosarInVerificare(d, [])).toBe(d)
    expect(dosarInVerificare(null, [kA])).toEqual({})
  })
})

// ─── Verificare r6 (21.10) ───────────────────────────────────────────────────
describe('F1 (r6) proveniența rândului căutată în tot dosarul HR', () => {
  const nume = id => ({ 7:'POPESCU ION', 8:'IONESCU ANA' })[id] || null
  it('rezultatProvenienta: căutare picată / răspuns ciudat → eroare (fail-closed); altfel toate, INCLUSIV cele șterse logic', () => {
    expect(rezultatProvenienta({ data:null, error:{ message:'Failed to fetch' } })).toEqual({ err:'eroare' })
    expect(rezultatProvenienta({ data:null, error:null })).toEqual({ err:'eroare' })
    expect(rezultatProvenienta(undefined)).toEqual({ err:'eroare' })
    expect(rezultatProvenienta({ data:[], error:null })).toEqual({ docs:[] })
    // 20261103a: copia ștearsă logic rămâne (indexul unic o numără — din rândul ei nu se mai salvează alt document)
    expect(rezultatProvenienta({ data:[{ id:900, employee_id:8 }, null, { id:901, employee_id:7, deleted_at:'2026-10-21' }], error:null }))
      .toEqual({ docs:[{ id:900, employee_id:8 }, { id:901, employee_id:7, deleted_at:'2026-10-21' }] })
  })
  it('provenientaLaAltAngajat: doar documentul NESTERS de la alt angajat decât cel ales', () => {
    const docs = [{ id:900, employee_id:7 }, { id:901, employee_id:'8' }]
    expect(provenientaLaAltAngajat(docs, 7)).toEqual({ id:901, employee_id:'8' })
    expect(provenientaLaAltAngajat(docs.slice(0, 1), '7')).toBeNull()
    expect(provenientaLaAltAngajat([], 7)).toBeNull()
    expect(provenientaLaAltAngajat(null, 7)).toBeNull()
    // salvat greșit la 8, șters de acolo → nu mai oprește «Închide» la 7 (documentul identic de aici)
    expect(provenientaLaAltAngajat([{ id:901, employee_id:8, deleted_at:'2026-10-21' }], 7)).toBeNull()
  })
  it('mesajProvenienta: copia ștearsă logic → nu se salvează altul din rând; Coș / fișier urcat din nou / ✕ Respinge', () => {
    const m = mesajProvenienta([{ id:901, employee_id:8, deleted_at:'2026-10-21' }], 7, nume)
    expect(m).toMatch(/#901, la «IONESCU ANA»\) a fost șters din dosar/)
    expect(m).toMatch(/din același rând nu se mai salvează altul/)
    expect(m).toMatch(/🗑 Coș/)
    expect(m).toMatch(/urcă fișierul încă o dată/)
    expect(m).toMatch(/«✕ Respinge»/)
    expect(mesajProvenienta([{ id:901, employee_id:99, deleted_at:'x' }], 7)).toMatch(/la alt angajat \(#99\)\) a fost șters/)
    // unul șters + unul viu → contează cel viu
    expect(mesajProvenienta([{ id:901, employee_id:8, deleted_at:'x' }, { id:902, employee_id:7 }], 7, nume)).toMatch(/deja salvat în dosar din acest rând \(#902\)/)
    // 23505 pe un rând pe care nu-l văd (căutarea goală / picată) → tot „salvat deja", fără a doua inserare
    expect(mesajProvenienta([], 7, nume)).toMatch(/deja salvat din acest rând.*nu-l mai adaug/)
  })
  it('mesajProvenienta: la angajatul ales → «Închide»; la altul → îl numește (sau #id) și nu face nimic aici', () => {
    expect(mesajProvenienta([{ id:900, employee_id:7 }], 7, nume)).toMatch(/deja salvat în dosar din acest rând \(#900\).*«Închide \(e deja în dosar\)».*«✕ Respinge»/)
    // un document și aici, și la alt angajat → mesajul pentru cel de aici (are «Închide» pe card)
    expect(mesajProvenienta([{ id:901, employee_id:8 }, { id:900, employee_id:7 }], 7, nume)).toMatch(/#900/)
    const m = mesajProvenienta([{ id:901, employee_id:8 }], 7, nume)
    expect(m).toMatch(/la «IONESCU ANA» \(document #901\)/)
    expect(m).toMatch(/nu fac nimic la angajatul ales acum/)
    expect(m).toMatch(/«✕ Respinge»/)
    expect(mesajProvenienta([{ id:901, employee_id:99 }], 7, nume)).toMatch(/alt angajat \(#99\) \(document #901\)/)
    expect(mesajProvenienta([{ id:901, employee_id:99 }], 7)).toMatch(/alt angajat \(#99\)/)
  })
  it('REPRO: AI → A, omul corectează pe B, documentul intră la B, rândul rămâne deschis; reîncărcarea readuce A', () => {
    const A = 7, B = 8
    const row = rowAI({ id:77, entitate_id:A, entitate_match_confidence:90 })
    const D1 = docDrive({ id:900, employee_id:B, fisier_path:`${B}/aidoc_1.pdf`, drive_file_id:null, uploadat_de:'u1', sursa_inbox_id:row.id })
    // garda veche (pe angajat) pentru A: nimic → s-ar insera a doua copie la A (bug-ul)
    expect(gardaFinalaHR({ row, angajatId:A, exact:{ docs:[] }, nume:{ docs:[] } }).bloc).toBeNull()
    expect(gardaFinalaHR({ row, angajatId:B, exact:{ docs:[D1] }, nume:null }).bloc).toBe('acelasi')
    // garda nouă: proveniența rândului (sursa_inbox_id), fără filtru pe angajat → găsește D1 la B → nu se inserează la A
    const prov = rezultatProvenienta({ data:[{ id:D1.id, employee_id:D1.employee_id, activ:true, deleted_at:null, sursa_inbox_id:row.id }], error:null })
    expect(prov.docs.length).toBe(1)
    expect(provenientaLaAltAngajat(prov.docs, A)).toMatchObject({ id:900 })   // și «Închide» la A e oprit
    expect(provenientaLaAltAngajat(prov.docs, B)).toBeNull()                 // la B: închiderea legată de D1 merge
    expect(mesajProvenienta(prov.docs, A, nume)).toMatch(/IONESCU ANA.*#900/)
    // reîncărcarea cozii nu mai pierde corecția: alegerea rămâne B
    const peCard = { ...row, _editEntitate:B }
    const [proaspat] = pastreazaEditari([{ ...row }], [peCard])
    expect(proaspat._editEntitate).toBe(B)
    expect(cheieDosar(proaspat._editEntitate, proaspat.fisier_nume)).toBe(cheieDosar(B, 'CI.pdf'))
  })
})

describe('F1 (r6) pastreazaEditari — coada reîncărcată păstrează corecțiile de pe card', () => {
  it('cheile „_" trec pe rândul proaspăt (inclusiv alegerea goală), câmpurile din BD vin proaspete', () => {
    const vechi = [
      { id:1, status:'clasificat', entitate_id:7, _editEntitate:8, _editTip:'cazier_judiciar' },
      { id:2, status:'clasificat', entitate_id:7, _editEntitate:null },
      { id:3, status:'clasificat', _scrieDate:false, _editValoare:'12.5', _editLuna:'2026-09' },
      { id:4, status:'clasificat' },
      { id:9, status:'clasificat', _editEntitate:5 },   // ieșit din coadă → nu reapare
    ]
    const noi = [
      { id:1, status:'clasificat', entitate_id:7, payload_ai:{ titlu_scurt:'nou' } },
      { id:2, status:'eroare', entitate_id:7 },
      { id:3, status:'clasificat' },
      { id:4, status:'clasificat' },
      { id:5, status:'clasificat' },
    ]
    const r = pastreazaEditari(noi, vechi)
    expect(r.map(x => x.id)).toEqual([1, 2, 3, 4, 5])
    expect(r[0]).toEqual({ id:1, status:'clasificat', entitate_id:7, payload_ai:{ titlu_scurt:'nou' }, _editEntitate:8, _editTip:'cazier_judiciar' })
    expect(r[1]).toEqual({ id:2, status:'eroare', entitate_id:7, _editEntitate:null })
    expect('_editEntitate' in r[1]).toBe(true)
    expect(r[2]).toMatchObject({ _scrieDate:false, _editValoare:'12.5', _editLuna:'2026-09' })
    expect(r[3]).toBe(noi[3])   // fără corecții → același obiect
    expect(r[4]).toBe(noi[4])
    expect(pastreazaEditari(null, vechi)).toEqual([])
    expect(pastreazaEditari(noi, null)).toEqual(noi)
  })
})

describe('F2 (r6) rândul închis între timp de altcineva', () => {
  const zero = { data:[], error:null }
  it('UPDATE-ul atinge doar rândurile din coadă (aceleași statusuri ca loadQueue)', () => {
    expect(STATUS_COADA).toEqual(['clasificat', 'eroare'])
  })
  it('citirea compară și documentul legat: același → inchis; altul → altcineva; încă deschis → deschis', () => {
    expect(stareInchidere(zero, { data:{ id:5, status:'confirmat', confirmat_ref_id:900 }, error:null }, 'confirmat', 900)).toBe('inchis')
    expect(stareInchidere(zero, { data:{ id:5, status:'confirmat', confirmat_ref_id:'900' }, error:null }, 'confirmat', 900)).toBe('inchis')
    expect(stareInchidere(zero, { data:{ id:5, status:'confirmat', confirmat_ref_id:901 }, error:null }, 'confirmat', 900)).toBe('altcineva')
    expect(stareInchidere(zero, { data:{ id:5, status:'confirmat', confirmat_ref_id:null }, error:null }, 'confirmat', 900)).toBe('altcineva')
    expect(stareInchidere(zero, { data:{ id:5, status:'respins', confirmat_ref_id:null }, error:null }, 'confirmat', 900)).toBe('altcineva')
    expect(stareInchidere(zero, { data:{ id:5, status:'clasificat', confirmat_ref_id:null }, error:null }, 'confirmat', 900)).toBe('deschis')
    expect(stareInchidere(zero, { data:{ id:5, status:'eroare' }, error:null }, 'confirmat', 900)).toBe('deschis')
    // răspuns pierdut, dar UPDATE-ul NOSTRU a intrat → citirea arată documentul nostru → inchis (J2 neschimbat)
    const pierdut = { data:null, error:{ message:'TypeError: Failed to fetch', code:'' }, status:0 }
    expect(stareInchidere(pierdut, { data:{ id:5, status:'confirmat', confirmat_ref_id:900 }, error:null }, 'confirmat', 900)).toBe('inchis')
    expect(stareInchidere(pierdut, { data:{ id:5, status:'confirmat', confirmat_ref_id:901 }, error:null }, 'confirmat', 900)).toBe('altcineva')
    // UPDATE cu rând întors / refuz sigur: neschimbat
    expect(stareInchidere({ data:[{ id:5 }], error:null }, null, 'confirmat', 900)).toBe('inchis')
    expect(stareInchidere({ data:null, error:{ code:'42501' }, status:403 }, null, 'confirmat', 900)).toBe('deschis')
  })
  it('mesajele: altcineva = avertisment, fără „scoate-l" / staging (rândul nu mai e în coadă)', () => {
    expect(mesajInchidere('altcineva', 'Gata ✓', { stagingRamas:true })).toEqual({ tip:'warn', msg:MESAJ_RAND_ALTCINEVA })
    expect(MESAJ_RAND_ALTCINEVA).toMatch(/fusese deja închis/)
    expect(MESAJ_RAND_ALTCINEVA).toMatch(/copie în plus/)
    expect(MESAJ_RAND_ALTCINEVA).not.toMatch(/✓/)
    const r = mesajRespingere('altcineva', null)
    expect(r.tip).toBe('warn')
    expect(r.msg).toMatch(/fusese deja închis/)
  })
})

describe('R1 (r6) avertismentul de staging doar unde e adevărat', () => {
  const sters = { data:[{ name:'x.pdf' }], error:null }
  const lipsa = { data:[], error:null }   // remove() pe un fișier deja șters (sau fără drept de ștergere)
  const picat = { data:null, error:{ message:'Failed to fetch' } }
  it('HR: niciodată — proveniența rândului (sursa_inbox_id, unică) oprește o nouă confirmare; „Închide" repetat nu mai minte', () => {
    for (const rm of [sters, lipsa, picat, undefined]) expect(avertizareStaging('hr', rm)).toBe(false)
    // „Închide (e deja în dosar)" după o închidere care a șters deja fișierul: UPDATE refuzat din nou, remove → []
    const stare = stareInchidere({ data:null, error:{ code:'42501', message:'rls' }, status:403 }, null)
    expect(mesajInchidere(stare, 'Era deja în dosar — închis.', { stagingRamas:avertizareStaging('hr', lipsa) }))
      .toEqual({ tip:'err', msg:MESAJ_RAND_NEINCHIS })
  })
  it('celelalte module: ca înainte (nesters sigur → avertisment)', () => {
    for (const m of ['executie', 'logistica', 'financiar', 'upa']) {
      expect(avertizareStaging(m, sters)).toBe(false)
      expect(avertizareStaging(m, lipsa)).toBe(true)
      expect(avertizareStaging(m, picat)).toBe(true)
    }
  })
})

// ─── Proveniență structurală (decizia owner 21.10, varianta A, migrarea 20261103a) ───────────
describe('20261103a sursa_inbox_id: 23505 pe index = „deja salvat"; coloana lipsă = blocant', () => {
  // formele reale PostgREST / postgrest-js
  const lipsaSelect = { code:'42703', message:'column hr_documente_personale.sursa_inbox_id does not exist', details:null, hint:null }
  const lipsaInsert = { code:'PGRST204', message:"Could not find the 'sursa_inbox_id' column of 'hr_documente_personale' in the schema cache", details:null, hint:null }
  const dubla = { code:'23505', message:'duplicate key value violates unique constraint "hr_documente_personale_sursa_inbox_unic"', details:'Key (sursa_inbox_id)=(501) already exists.', hint:null }
  it('lipsaMigrareSursa: doar 42703 / PGRST204 care numesc coloana', () => {
    expect(lipsaMigrareSursa(lipsaSelect)).toBe(true)
    expect(lipsaMigrareSursa(lipsaInsert)).toBe(true)
    expect(lipsaMigrareSursa({ code:'42703', message:'column hr_documente_personale.alta does not exist' })).toBe(false)
    expect(lipsaMigrareSursa({ code:'PGRST204', message:"Could not find the 'alta' column" })).toBe(false)
    expect(lipsaMigrareSursa({ code:'42501', message:'sursa_inbox_id rls' })).toBe(false)
    expect(lipsaMigrareSursa(null)).toBe(false)
    expect(lipsaMigrareSursa(new Error('Failed to fetch'))).toBe(false)
  })
  it('dublaSursaInbox: doar 23505 pe indexul / cheia sursa_inbox_id', () => {
    expect(dublaSursaInbox(dubla)).toBe(true)
    expect(dublaSursaInbox({ code:'23505', message:'duplicate key', details:'Key (sursa_inbox_id)=(7) already exists.' })).toBe(true)
    expect(dublaSursaInbox({ code:'23505', message:'duplicate key value violates unique constraint "alt_index"', details:'Key (x)=(1) already exists.' })).toBe(false)
    expect(dublaSursaInbox({ code:'23514', message:'sursa_inbox_id e nemodificabilă' })).toBe(false)
    expect(dublaSursaInbox(undefined)).toBe(false)
  })
  it('rezultatInserareHR: ok / dubla (doar închidere, NICIODATĂ a doua inserare) / migrare / eroare', () => {
    expect(rezultatInserareHR({ data:{ id:900 }, error:null, status:201 })).toBe('ok')
    expect(rezultatInserareHR({ data:null, error:dubla, status:409 })).toBe('dubla')
    expect(rezultatInserareHR({ data:null, error:lipsaInsert, status:400 })).toBe('migrare')
    expect(rezultatInserareHR({ data:null, error:{ code:'42501', message:'rls' }, status:403 })).toBe('eroare')
    expect(rezultatInserareHR({ data:null, error:new Error('Failed to fetch') })).toBe('eroare')   // poate fi intrat: reîncercarea îl găsește
    expect(rezultatInserareHR({ data:null, error:null })).toBe('eroare')
    expect(rezultatInserareHR(undefined)).toBe('eroare')
  })
  it('căutările cu sursa_inbox_id pe o bază fără migrare → err:migrare → mesajul blocant (fără inserare fără proveniență)', () => {
    expect(rezultatProvenienta({ data:null, error:lipsaSelect, status:400 })).toEqual({ err:'migrare' })
    expect(rezultatCautareDosar({ data:null, error:lipsaSelect, status:400 }, { limita:500, cuNumar:true })).toEqual({ err:'migrare' })
    expect(rezultatCautareDosar({ data:null, error:{ code:'42703', message:'column x.alta does not exist' } })).toEqual({ err:'eroare' })
    expect(mesajEroareCautare('migrare', 'CI.pdf')).toBe(MESAJ_MIGRARE_SURSA)
    expect(MESAJ_MIGRARE_SURSA).toMatch(/migrarea pentru sursa_inbox_id nu e aplicată — anunță administratorul/)
    // garda finală din confirmHR: migrarea lipsă = err, nu „liber"
    expect(gardaFinalaHR({ row:rowAI(), angajatId:7, exact:{ err:'migrare' }, nume:null })).toEqual({ err:'migrare' })
    expect(gardaFinalaHR({ row:rowAI({ fisier_size_bytes:null }), angajatId:7, exact:null, nume:{ err:'migrare' } })).toEqual({ err:'migrare' })
  })
  it('REPRO două taburi: ambele trec garda (nimic salvat încă), primul INSERT intră, al doilea = 23505 → doar închidere', () => {
    const row = rowAI({ id:501 })
    // ambele taburi: proveniența goală, garda pe nume + mărime goală → amândouă copiază fișierul și inserează
    expect(rezultatProvenienta({ data:[], error:null })).toEqual({ docs:[] })
    expect(gardaFinalaHR({ row, angajatId:7, exact:{ docs:[] }, nume:{ docs:[] } }).bloc).toBeNull()
    // tabul 2: indexul unic refuză → 'dubla' (copia lui se șterge, NU se reîncearcă inserarea)
    expect(rezultatInserareHR({ data:null, error:dubla, status:409 })).toBe('dubla')
    // căutarea după proveniență găsește documentul tabului 1 la același angajat → mesajul + panoul cu «Închide»
    const salvat = docDrive({ id:900, fisier_path:'7/aidoc_1.pdf', drive_file_id:null, uploadat_de:'u1', observatii:null, sursa_inbox_id:501 })
    const prov = rezultatProvenienta({ data:[salvat], error:null })
    expect(mesajProvenienta(prov.docs, 7)).toMatch(/deja salvat în dosar din acest rând \(#900\).*«Închide \(e deja în dosar\)»/)
    const a = analizaDublura({ row, docs:[salvat], angajatId:7, tipuriFK:TIPURI, tipAI:'buletin' })
    expect(a).toMatchObject({ tip:'acelasi', dinRand:true, campuri:[] })
    expect(a.doc.id).toBe(900)
  })
})

// ─── Review extern #821: garda BD de la INSERT (F2) + wizard-ul „Angajat nou” cu proveniență (F1) ───────────
describe('#821 F2 garda de la INSERT (trg_hr_docp_sursa_inbox_verifica) = refuz sigur, nu „eroare”', () => {
  // forma reală PostgREST a RAISE-ului din migrare (23514 + mesaj + hint)
  const refuz = motiv => ({ code:'23514', message:`hr_documente_personale: sursa_inbox_id = 501 refuzată la INSERT — ${motiv}`, details:null,
    hint:'sursa_inbox_id = rândul HR deschis (clasificat / eroare) din «Citește orice», cu același fisier_nume; NULL pentru Drive / încărcări manuale.' })
  const imutabil = { code:'23514', message:'hr_documente_personale #9: sursa_inbox_id e nemodificabilă (501 → 502) — se pune doar la INSERT', details:null, hint:null }
  it('refuzSursaInbox: doar mesajul gărzii de INSERT (toate motivele); nu nemodificabila, nu alt 23514 / 23505', () => {
    for (const m of ['rândul nu există în coadă (sau nu îl vezi)', 'rândul nu e în coada HR', 'rândul nu mai e deschis în coadă (status confirmat)',
      'fișierul documentului nu e cel din rândul din coadă']) expect(refuzSursaInbox(refuz(m))).toBe(true)
    expect(refuzSursaInbox(imutabil)).toBe(false)
    expect(refuzSursaInbox({ code:'23514', message:'new row violates check constraint "x_chk"' })).toBe(false)
    expect(refuzSursaInbox({ ...refuz('x'), code:'23505' })).toBe(false)
    expect(refuzSursaInbox(null)).toBe(false)
    expect(refuzSursaInbox(new Error('Failed to fetch'))).toBe(false)
  })
  it("rezultatInserareHR: 'refuzata' pentru gardă; copia urcată se șterge la dubla / refuzata / migrare, nu la eroare / ok", () => {
    expect(rezultatInserareHR({ data:null, error:refuz('rândul nu e în coada HR'), status:400 })).toBe('refuzata')
    expect(rezultatInserareHR({ data:null, error:imutabil, status:400 })).toBe('eroare')
    for (const r of ['dubla', 'refuzata', 'migrare']) expect(copieDeSters(r)).toBe(true)
    for (const r of ['ok', 'eroare', undefined]) expect(copieDeSters(r)).toBe(false)
  })
  it('panou: refuzată + proveniența găsită → rând deja închis (dispare din listă): fără «Închide» / «✕ Respinge»; fără document → „nu mai e deschis”', () => {
    const salvat = docDrive({ id:900, employee_id:50, drive_file_id:null, uploadat_de:'u1', sursa_inbox_id:501 })
    const nume = id => (id === 50 ? 'POPESCU ION' : null)
    // R1 (verificare #821): după loadQueue rândul nu mai e în listă → nicio acțiune pe rând, nu mesajul pentru rând deschis
    for (const docs of [[salvat], [{ ...salvat, employee_id:7 }], [{ ...salvat, deleted_at:'2026-10-21' }]]) {
      const m = mesajRefuzSursa(docs, 7, nume)
      expect(m).not.toBe(mesajProvenienta(docs, 7, nume))
      expect(m).toMatch(/fusese deja închis între timp.*nu am salvat nimic, am reîncărcat lista/)
      expect(m).not.toMatch(/«Închide|«✕ Respinge»|alege-l din listă/)
    }
    // la alt angajat: îl numește (sau #id) și spune că se corectează din dosar, nu din coadă
    expect(mesajRefuzSursa([salvat], 7, nume)).toMatch(/salvat la «POPESCU ION» \(document #900\).*în dosarul lui, nu în coadă/)
    expect(mesajRefuzSursa([salvat], 7, () => null)).toMatch(/alt angajat \(#50\) \(document #900\)/)
    expect(mesajRefuzSursa([salvat], 7)).toMatch(/alt angajat \(#50\)/)
    // la angajatul ales: e deja la el, nimic de corectat
    expect(mesajRefuzSursa([{ ...salvat, employee_id:7 }], 7, nume)).toMatch(/deja în dosarul angajatului ales \(#900\)/)
    // nesters la alt angajat are prioritate față de copia ștearsă logic (ordinea mesajProvenienta)
    expect(mesajRefuzSursa([{ ...salvat, id:899, deleted_at:'x' }, salvat], 7, nume)).toMatch(/document #900/)
    // doar șters logic → Coș / fișierul urcat din nou
    expect(mesajRefuzSursa([{ ...salvat, deleted_at:'x' }], 7, nume)).toMatch(/\(#900, la «POPESCU ION»\) a fost șters din dosar.*🗑 Coș.*urcă fișierul încă o dată/)
    expect(mesajRefuzSursa([null, undefined], 7)).toBe(MESAJ_SURSA_REFUZATA)
    expect(mesajRefuzSursa([], 7)).toBe(MESAJ_SURSA_REFUZATA)
    expect(mesajRefuzSursa(null, 7)).toBe(MESAJ_SURSA_REFUZATA)
    expect(MESAJ_SURSA_REFUZATA).toMatch(/nu am salvat nimic/)
  })
})

describe('#821 F1 wizard „Angajat nou”: proveniența rândului din coadă', () => {
  // = rândul întors de INSERT-ul wizard-ului în coadă (select … fisier_size_bytes, fisier_mime — Jakarinos r2 P1) + metadatele locale
  const d = (o = {}) => ({ id:701, status:'clasificat', modul_tinta:'hr', fisier_nume:'POPESCU ION - CI.pdf', fisier_path:'wizard-angajare/1_a/CI.pdf',
    fisier_size_bytes:2048, fisier_mime:'application/pdf',
    tip_id:1, tip_document:'buletin', payload_ai:{ date_document:{ numar:'RX 1', data_emitere:'2021-01-02', data_expirare:'2031-01-02' } }, ...o })
  const dubla = { code:'23505', message:'duplicate key value violates unique constraint "hr_documente_personale_sursa_inbox_unic"', details:'Key (sursa_inbox_id)=(701) already exists.' }
  const garda = { code:'23514', message:'hr_documente_personale: sursa_inbox_id = 701 refuzată la INSERT — rândul nu mai e deschis în coadă (status confirmat)' }
  const lipsa = { code:'PGRST204', message:"Could not find the 'sursa_inbox_id' column of 'hr_documente_personale' in the schema cache" }
  it('docWizardHR: sursa_inbox_id = rândul, nume / mărime / tip = ale rândului, exact (garda BD); restul câmpurilor ca înainte', () => {
    const tip = { id:1, cod:'buletin', are_expirare:true }
    expect(docWizardHR({ d:d(), empId:50, tip, destPath:'50/x.pdf', uploadatDe:'u1' })).toEqual({
      employee_id:50, tip_id:1, numar_document:'RX 1', data_emitere:'2021-01-02', data_expirare:'2031-01-02', fara_expirare:false,
      fisier_path:'50/x.pdf', fisier_nume:'POPESCU ION - CI.pdf', fisier_size_bytes:2048, fisier_mime:'application/pdf',
      activ:true, uploadat_de:'u1', sursa_inbox_id:701,
    })
    // copie exactă: 0 rămâne 0 (nu NULL, ca la vechiul `|| null`), tipul nu se ghicește; lipsa rămâne NULL (garda o refuză)
    expect(docWizardHR({ d:d({ fisier_size_bytes:0, fisier_mime:'image/png' }), empId:50, tip, destPath:'p' }))
      .toMatchObject({ fisier_size_bytes:0, fisier_mime:'image/png' })
    expect(docWizardHR({ d:d({ fisier_size_bytes:undefined, fisier_mime:undefined }), empId:50, tip, destPath:'p' }))
      .toMatchObject({ fisier_size_bytes:null, fisier_mime:null })
    // corecțiile de pe card câștigă; tip fără expirare + fără dată → fara_expirare
    const r = docWizardHR({ d:d({ _numar:'AB 2', _expira:'2030-05-05' }), empId:50, tip, destPath:'p' })
    expect(r).toMatchObject({ numar_document:'AB 2', data_expirare:'2030-05-05', uploadat_de:null })
    const fara = docWizardHR({ d:d({ payload_ai:null }), empId:50, tip:{ are_expirare:false }, destPath:'p' })
    expect(fara).toMatchObject({ numar_document:null, data_emitere:null, data_expirare:null, fara_expirare:true, sursa_inbox_id:701 })
  })
  it('inchidereWizardHR: aceeași închidere ca înainte, legată de documentul ales', () => {
    expect(inchidereWizardHR({ d:d(), tip:{ cod:'buletin' }, empId:50, docId:900, profilId:'u1', acum:new Date('2026-10-21T10:00:00Z') })).toEqual({
      status:'confirmat', modul_tinta:'hr', tip_document:'buletin', entitate_tip:'angajat', entitate_id:50,
      destinatie_tabel:'hr_documente_personale', confirmat_de:'u1', confirmat_la:'2026-10-21T10:00:00.000Z', confirmat_ref_id:900,
    })
    expect(inchidereWizardHR({ d:d({ tip_document:'altul' }), tip:null, empId:50, docId:1 }).tip_document).toBe('altul')
    expect(STATUS_COADA).toEqual(['clasificat', 'eroare'])   // filtrul UPDATE-ului de închidere (.in('status', STATUS_COADA))
  })
  it('decizieWizardHR: inserat → închide; 23505 / garda → caută proveniența, NICIODATĂ a doua inserare', () => {
    expect(decizieWizardHR({ data:{ id:900 }, error:null }, null, 50)).toEqual({ pas:'inchide', docId:900, nou:true })
    // salvat deja din rând tot la angajatul nou (alt tab / răspuns pierdut) → doar închiderea, legată de el
    const aici = { id:901, employee_id:50, deleted_at:null, sursa_inbox_id:701 }
    expect(decizieWizardHR({ data:null, error:dubla }, { docs:[aici] }, 50)).toEqual({ pas:'inchide', docId:901, nou:false })
    expect(decizieWizardHR({ data:null, error:garda }, { docs:[aici] }, '50')).toEqual({ pas:'inchide', docId:901, nou:false })
    // panoul l-a salvat la ALT angajat → nimic aici, mesaj cu documentul
    const strain = { id:902, employee_id:7, deleted_at:null, sursa_inbox_id:701 }
    expect(decizieWizardHR({ data:null, error:garda }, { docs:[strain] }, 50)).toMatchObject({ pas:'esec' })
    expect(decizieWizardHR({ data:null, error:garda }, { docs:[strain] }, 50).msg).toMatch(/alt angajat \(#7, document #902\)/)
    // copia salvată din rând e în Coș → nu se salvează alta
    const sters = { id:903, employee_id:50, deleted_at:'2026-10-20', sursa_inbox_id:701 }
    expect(decizieWizardHR({ data:null, error:dubla }, { docs:[sters] }, 50).msg).toMatch(/#903.*șters din dosar.*Coș/)
    // nimic vizibil: 23505 = „deja salvat”; garda = rând închis / mutat
    expect(decizieWizardHR({ data:null, error:dubla }, { docs:[] }, 50)).toEqual({ pas:'esec', msg:MESAJ_WIZ_DUBLA })
    expect(decizieWizardHR({ data:null, error:garda }, { docs:[] }, 50)).toEqual({ pas:'esec', msg:MESAJ_WIZ_REFUZ })
    // căutarea de proveniență picată / lipsă → fail-closed, fără închidere
    expect(decizieWizardHR({ data:null, error:dubla }, { err:'eroare' }, 50)).toEqual({ pas:'esec', msg:MESAJ_WIZ_DUBLA })
    expect(decizieWizardHR({ data:null, error:garda }, { err:'eroare' }, 50)).toEqual({ pas:'esec', msg:MESAJ_WIZ_NEVERIFICAT })
    expect(decizieWizardHR({ data:null, error:garda }, null, 50)).toEqual({ pas:'esec', msg:MESAJ_WIZ_NEVERIFICAT })
    expect(decizieWizardHR({ data:null, error:garda }, { err:'migrare' }, 50)).toEqual({ pas:'esec', msg:MESAJ_MIGRARE_SURSA })
  })
  it('decizieWizardHR: migrarea lipsă = blocant (fără inserare fără proveniență); altă eroare = mesajul ei', () => {
    expect(decizieWizardHR({ data:null, error:lipsa }, null, 50)).toEqual({ pas:'esec', msg:MESAJ_MIGRARE_SURSA })
    expect(decizieWizardHR({ data:null, error:{ code:'42501', message:'new row violates row-level security policy' } }, null, 50))
      .toEqual({ pas:'esec', msg:'Insert document HR: new row violates row-level security policy' })
    expect(decizieWizardHR({ data:null, error:null }, null, 50).msg).toMatch(/fără răspuns de la server/)
    expect(decizieWizardHR(undefined, null, 50).pas).toBe('esec')
  })
  it('închiderea: rândul închis de panou între timp nu se rescrie și nu i se șterge fișierul; restul → avertisment', () => {
    // UPDATE-ul (filtrat pe STATUS_COADA) a întors rândul → închis
    expect(stareInchidere({ data:[{ id:701 }], error:null }, null, 'confirmat', 900)).toBe('inchis')
    expect(mesajWizardInchidere('inchis')).toBeNull()
    // 0 rânduri: citirea arată rândul confirmat de panou cu ALT document → altcineva (nu rescris, staging păstrat)
    const alt = stareInchidere({ data:[], error:null }, { data:{ id:701, status:'confirmat', confirmat_ref_id:902 }, error:null }, 'confirmat', 900)
    expect(alt).toBe('altcineva')
    expect(mesajWizardInchidere(alt)).toMatch(/fusese deja închis.*nu l-am modificat/)
    expect(stergeStagingWizard(alt)).toBe(false)
    // 0 rânduri, dar legat deja de ACELAȘI document (panoul a închis rândul pe documentul găsit după proveniență) → închis
    expect(stareInchidere({ data:[], error:null }, { data:{ id:701, status:'confirmat', confirmat_ref_id:901 }, error:null }, 'confirmat', 901)).toBe('inchis')
    // respins între timp → altcineva
    expect(stareInchidere({ data:[], error:null }, { data:{ id:701, status:'respins', confirmat_ref_id:null }, error:null }, 'confirmat', 900)).toBe('altcineva')
    for (const s of ['deschis', 'necunoscut']) {
      expect(mesajWizardInchidere(s)).toMatch(/salvat în dosar/)
      expect(stergeStagingWizard(s)).toBe(true)   // ca înainte: documentul are copia lui; panoul închide rândul fără fișier
    }
    expect(stergeStagingWizard('inchis')).toBe(true)
  })
  it('REPRO (Jakarinos P1): panoul salvează din rândul wizard-ului, apoi Finish → fără al doilea document', () => {
    // rândul 701 urcat de wizard apare și în coada HR; panoul îl salvează la angajatul 7 (potrivit de AI) și îl închide.
    // Wizard-ul (starea lui locală: tot 'clasificat') inserează cu sursa_inbox_id = 701 → garda BD: rândul e confirmat
    const ins = { data:null, error:garda, status:400 }
    expect(rezultatInserareHR(ins)).toBe('refuzata')
    expect(copieDeSters('refuzata')).toBe(true)   // copia urcată de wizard se șterge
    const prov = rezultatProvenienta({ data:[{ id:902, employee_id:7, deleted_at:null, sursa_inbox_id:701 }], error:null })
    const dec = decizieWizardHR(ins, prov, 50)
    expect(dec.pas).toBe('esec')                   // nimic de închis, nicio a doua inserare
    expect(dec.msg).toMatch(/alt angajat \(#7, document #902\)/)
    // invers: wizard-ul salvează primul → panoul găsește proveniența (la angajatul nou) și nu mai inserează
    const dinWizard = docDrive({ id:900, employee_id:50, fisier_nume:'POPESCU ION - CI.pdf', drive_file_id:null, uploadat_de:'u1', sursa_inbox_id:701 })
    expect(mesajProvenienta([dinWizard], 7, id => (id === 50 ? 'POPESCU ION' : null))).toMatch(/la «POPESCU ION» \(document #900\)/)
  })
})

// ─── Jakarinos r2 P1: garda BD de la INSERT cere și mărimea + tipul MIME ale rândului (ne-NULL) ───────────────────────────
describe('Jakarinos r2 P1: documentul copiază exact nume / mărime / tip din rândul din coadă', () => {
  const MIGRARE = readFileSync(new URL('../supabase/migrations/20261103a_hr_doc_sursa_inbox.sql', import.meta.url), 'utf8')
  const PANOU = readFileSync(new URL('./CitesteOricePanel.jsx', import.meta.url), 'utf8')
  const WIZARD = readFileSync(new URL('./HrAngajatNouWizard.jsx', import.meta.url), 'utf8')
  const refuz = motiv => ({ code:'23514', message:`hr_documente_personale: sursa_inbox_id = 501 refuzată la INSERT — ${motiv}`, details:null,
    hint:'sursa_inbox_id = rândul HR deschis (clasificat / eroare) din «Citește orice», cu același fisier_nume, fisier_size_bytes și fisier_mime (ne-NULL); NULL pentru Drive / încărcări manuale.' })
  // motivele EXACTE din funcția gărzii (migrarea), ca mesajele UI să nu se desincronizeze de BD
  const motive = [...MIGRARE.matchAll(/v_motiv := '([^']+)'/g)].map(m => m[1])
  const deFisier = motive.filter(m => m.startsWith('fișierul documentului nu e cel din rândul din coadă'))

  it('fisierDinRand: copie exactă (fără fallback application/pdf, 0 rămâne 0, lipsa = NULL)', () => {
    expect(fisierDinRand(rowAI({ fisier_mime:'application/pdf' }))).toEqual({ fisier_nume:'CI.pdf', fisier_size_bytes:1234, fisier_mime:'application/pdf' })
    expect(fisierDinRand(rowAI({ fisier_mime:null }))).toEqual({ fisier_nume:'CI.pdf', fisier_size_bytes:1234, fisier_mime:null })
    expect(fisierDinRand(rowAI({ fisier_size_bytes:0, fisier_mime:'image/jpeg' }))).toMatchObject({ fisier_size_bytes:0, fisier_mime:'image/jpeg' })
    expect(fisierDinRand(rowAI({ fisier_size_bytes:undefined }))).toMatchObject({ fisier_size_bytes:null })
    expect(fisierDinRand(null)).toEqual({ fisier_nume:null, fisier_size_bytes:null, fisier_mime:null })
  })
  it('faraMetadateSursa: aceeași regulă ca garda (NULL pe mărime sau tip → nu se poate lega)', () => {
    expect(faraMetadateSursa(rowAI({ fisier_mime:'application/pdf' }))).toBe(false)
    expect(faraMetadateSursa(rowAI({ fisier_size_bytes:0, fisier_mime:'application/pdf' }))).toBe(false)
    expect(faraMetadateSursa(rowAI({ fisier_mime:null }))).toBe(true)
    expect(faraMetadateSursa(rowAI())).toBe(true)                        // rowAI fără fisier_mime
    expect(faraMetadateSursa(rowAI({ fisier_size_bytes:null, fisier_mime:'application/pdf' }))).toBe(true)
    expect(faraMetadateSursa(null)).toBe(true)
    expect(MESAJ_SURSA_FARA_METADATE).toMatch(/nu am salvat nimic.*urcă fișierul încă o dată/)
    expect(MESAJ_WIZ_FARA_METADATE).toMatch(/nu l-am salvat.*urcă fișierul încă o dată/)
  })
  it('motivele gărzii din migrare: 4 de fișier (nume / lipsă în document / lipsă în rând / diferite) + 3 de rând', () => {
    expect(MIGRARE).toContain("RAISE EXCEPTION 'hr_documente_personale: sursa_inbox_id = % refuzată la INSERT — %'")
    expect(deFisier).toEqual([
      'fișierul documentului nu e cel din rândul din coadă',
      'fișierul documentului nu e cel din rândul din coadă (mărimea / tipul lipsesc din document)',
      'fișierul documentului nu e cel din rândul din coadă (rândul din coadă nu are mărimea / tipul)',
      'fișierul documentului nu e cel din rândul din coadă (mărime / tip diferite)',
    ])
    expect(motive.length - deFisier.length).toBe(3)
    for (const m of motive) {
      expect(refuzSursaInbox(refuz(m))).toBe(true)                      // toate = 'refuzata' (copia se șterge, fără a doua inserare)
      expect(rezultatInserareHR({ data:null, error:refuz(m) })).toBe('refuzata')
      expect(refuzFisierSursa(refuz(m))).toBe(deFisier.includes(m))     // doar cele de fișier au mesajul propriu
    }
    expect(refuzFisierSursa(refuz('rândul nu mai e deschis în coadă (status confirmat)'))).toBe(false)
    expect(refuzFisierSursa({ ...refuz(deFisier[3]), code:'23505' })).toBe(false)
    expect(refuzFisierSursa(null)).toBe(false)
  })
  it('panou: refuz pe fișier fără document găsit → MESAJ_SURSA_FISIER, nu „rândul nu mai e deschis”; documentul găsit decide ca înainte', () => {
    expect(mesajRefuzSursa([], 7, () => null, refuz(deFisier[3]))).toBe(MESAJ_SURSA_FISIER)
    expect(mesajRefuzSursa([], 7, () => null, refuz('rândul nu e în coada HR'))).toBe(MESAJ_SURSA_REFUZATA)
    expect(mesajRefuzSursa([], 7)).toBe(MESAJ_SURSA_REFUZATA)            // apelurile vechi (fără eroare) — neschimbat
    const salvat = docDrive({ id:900, employee_id:7, drive_file_id:null, uploadat_de:'u1', sursa_inbox_id:501 })
    expect(mesajRefuzSursa([salvat], 7, () => null, refuz(deFisier[3]))).toMatch(/deja în dosarul angajatului ales \(#900\)/)
    expect(MESAJ_SURSA_FISIER).toMatch(/nu am salvat nimic/)
  })
  it('wizard: refuz pe fișier → MESAJ_WIZ_FISIER (nu „închis între timp”); salvat deja la angajatul nou → doar închidere', () => {
    expect(decizieWizardHR({ data:null, error:refuz(deFisier[1]) }, { docs:[] }, 50)).toEqual({ pas:'esec', msg:MESAJ_WIZ_FISIER })
    expect(decizieWizardHR({ data:null, error:refuz('rândul nu mai e deschis în coadă (status confirmat)') }, { docs:[] }, 50))
      .toEqual({ pas:'esec', msg:MESAJ_WIZ_REFUZ })
    expect(decizieWizardHR({ data:null, error:refuz(deFisier[3]) }, { docs:[{ id:901, employee_id:50, deleted_at:null, sursa_inbox_id:501 }] }, 50))
      .toEqual({ pas:'inchide', docId:901, nou:false })
  })
  it('sursele: panoul și wizard-ul trimit metadatele rândului și se opresc înainte de copie când lipsesc', () => {
    // panou (confirmHR): INSERT-ul HR = fisierDinRand(row), fără fallback-ul vechi; oprirea e înainte de mutaFisier
    const insHR = PANOU.slice(PANOU.indexOf("supabase.from('hr_documente_personale').insert({"), PANOU.indexOf('sursa_inbox_id: row.id,'))
    expect(insHR).toContain('...fisierDinRand(row)')
    expect(insHR).not.toMatch(/fisier_mime:|fisier_size_bytes:|fisier_nume:/)
    const confirmHR = PANOU.slice(PANOU.indexOf('async function confirmHR('), PANOU.indexOf('async function inchideDublura('))
    expect(confirmHR.indexOf('faraMetadateSursa(row)')).toBeGreaterThan(0)
    expect(confirmHR.indexOf('faraMetadateSursa(row)')).toBeLessThan(confirmHR.indexOf('await mutaFisier(row, cfg.bucket'))
    expect(confirmHR).toContain('mesajRefuzSursa(docs, angajatId, numeAngajat, ins.error)')
    // wizard: INSERT-ul în coadă întoarce mărimea / tipul (altfel docWizardHR trimitea NULL) și oprirea e înainte de download
    expect(WIZARD).toMatch(/\.select\('id,status,modul_tinta,fisier_nume,fisier_path,fisier_size_bytes,fisier_mime'\)/)
    const fin = WIZARD.slice(WIZARD.indexOf('async function finish('))
    expect(fin.indexOf('faraMetadateSursa(d)')).toBeGreaterThan(0)
    expect(fin.indexOf('faraMetadateSursa(d)')).toBeLessThan(fin.indexOf('.download(d.fisier_path)'))
  })
})
