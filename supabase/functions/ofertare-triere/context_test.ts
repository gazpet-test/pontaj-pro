import { strict as assert } from 'node:assert'
import { acoperaCod, codTip } from '../_shared/echivalenteAnre.ts'
import { aceeasiPersoana, aplicaBonusBarem, coduriPePersoana, liniiFirma, selecteazaCriterii, stareDocFirma, valideazaAtestariFirma, verificaAutorizatiiRoluri, type AutPers } from './context.ts'

const AZI = '2026-10-13'

Deno.test('criterii: după nume, fără fișă, doar cu text (Botoșani 522)', () => {
  const docs = [
    { id: 532, nume_original: 'Instructiuni_ofertanti_FisaDate_DF1280841.pdf', are_text: true },
    { id: 522, nume_original: 'Detaliere criteriu de atribuire.docx', are_text: true },
    { id: 600, nume_original: 'Factorii de evaluare.pdf', are_text: false },          // fără text = nu intră
    { id: 601, nume_original: 'PT/2_P. Ds. Cond/Plan situatie.pdf', are_text: true },
  ]
  assert.deepEqual(selecteazaCriterii(docs, 532), [522])
  assert.deepEqual(selecteazaCriterii([{ id: 9, nume_original: 'Algoritm_de_calcul.docx', are_text: true }], 1), [9])
})

Deno.test('firmă: valabil / expirat / valabilitate necunoscută (#14 versiune veche nu se socotește)', () => {
  const docs = [
    { id: 13, denumire: 'Autorizație ET Gazpet (execuție tehnică)', tip: 'Autorizație ET', data_valabilitate: '2027-07-27', fara_expirare: false },
    { id: 14, denumire: 'Autorizație ET+EPI emisă 22.07.2022 (versiune veche)', tip: 'Autorizație ET+EPI (veche 2022)', data_valabilitate: null, fara_expirare: false },
    { id: 7, denumire: 'ISO vechi', tip: 'ISO', data_valabilitate: '2025-01-01', fara_expirare: false },
    { id: 8, denumire: 'Certificat fără termen', tip: 'X', data_valabilitate: null, fara_expirare: true },
  ]
  assert.equal(stareDocFirma(docs[0], AZI), 'valabil')
  assert.equal(stareDocFirma(docs[1], AZI), 'valabilitate_necunoscuta')
  assert.equal(stareDocFirma(docs[2], AZI), 'expirat')
  const { linii, valabile } = liniiFirma(docs, AZI)
  assert.deepEqual([...valabile.keys()].sort((a, b) => a - b), [8, 13])
  assert.ok(linii.some((l) => l.startsWith('- #14') && l.includes('VALABILITATE NECUNOSCUTĂ')))
})

Deno.test('atestări de firmă: id verificat de cod, nu crezut pe cuvânt; expiră înainte de termen = atenție', () => {
  const { valabile } = liniiFirma([
    { id: 13, denumire: 'Autorizație ET Gazpet (execuție tehnică)', tip: 'Autorizație ET', data_valabilitate: '2027-07-27', fara_expirare: false },
    { id: 14, denumire: 'ET+EPI veche', tip: 'veche', data_valabilitate: null, fara_expirare: false },
  ], AZI)
  const p: any = { atestari_firma: [
    { cerinta: 'Autorizație ANRE tip ET', document_firma_id: 13 },
    { cerinta: 'Autorizație ANRE ET (cu versiunea veche)', document_firma_id: 14 },
    { cerinta: 'ISO 9001', document_firma_id: 999 },
  ] }
  const neacoperite = valideazaAtestariFirma(p, valabile, '2027-08-01')
  assert.equal(p.atestari_firma[0].status, 'indeplinita')
  assert.match(p.atestari_firma[0].sursa, /documente_firma #13 .*până 2027-07-27.*expiră înainte de 2027-08-01/)
  assert.equal(p.atestari_firma[1].status, 'neacoperita')
  assert.equal(p.atestari_firma[2].status, 'neacoperita')
  assert.equal(neacoperite.length, 2)
})

Deno.test('echivalențe ANRE (D4): literal, sau cod vechi cu aceeași clasă ca un cod NOU confirmat; altfel nu', () => {
  assert.equal(codTip('EGT - Executant Gaze Transport [nomenclatură veche, pre-Ordin 132/2021]'), 'EGT')
  assert.equal(codTip('Responsabil Tehnic cu Execuția (RTE)'), null)
  assert.deepEqual(acoperaCod(['EGT'], 'EGT'), { acoperit: true, prin: 'literal', cod: 'EGT' })
  assert.equal(acoperaCod(['EGT'], 'XYZ').acoperit, false)                                        // cod nou neconfirmat = nu
  const noi = { XT: { fel: 'executie' as const, domeniu: 'transport' as const }, XPD: { fel: 'proiectare' as const, domeniu: 'distributie' as const } }
  assert.deepEqual(acoperaCod(['EGT'], 'XT', noi), { acoperit: true, prin: 'echivalenta', cod: 'EGT' })
  assert.equal(acoperaCod(['EGD'], 'XT', noi).acoperit, false)                                    // distribuție → transport = nu
  assert.equal(acoperaCod(['PGT'], 'XT', noi).acoperit, false)                                    // proiectare → execuție = nu
  assert.deepEqual(acoperaCod(['EGD', 'PGD'], 'XPD', noi), { acoperit: true, prin: 'echivalenta', cod: 'PGD' })
})

const aut: AutPers[] = [
  { cine: 'TRUSU RAZVAN MIHAIL', tip: 'EGT - Executant Gaze Transport [nomenclatură veche]', valabil: true },
  { cine: 'STANESCU SILVIU', tip: 'EGT - Executant Gaze Transport [nomenclatură veche]', valabil: true },
  { cine: 'TOMA LIVIU', tip: 'EGT - Executant Gaze Transport [nomenclatură veche]', valabil: true },
  { cine: 'POPESCU ION', tip: 'EGD - Executant Gaze Distribuție [nomenclatură veche]', valabil: true },
  { cine: 'VECHI EXPIRAT', tip: 'EGT - Executant Gaze Transport', valabil: false },
  { cine: 'DADULESCU COSMIN GRIGORAS', tip: 'Certificat absolvire curs Manager de proiect', valabil: true },
]

Deno.test('roluri: preferința pe EGT, codul literal, echivalență nevalidată marcată', () => {
  const p: any = { roluri: [
    { rol: 'Persoană EGT', autorizatie_ceruta: 'EGT', propunere: 'TOMA LIVIU', motiv: 'AI' },
    { rol: 'Persoană EGD', autorizatie_ceruta: 'EGD', propunere: 'TOMA LIVIU', motiv: 'AI' },
    { rol: 'Fără cod', autorizatie_ceruta: null, propunere: 'X' },
  ] }
  verificaAutorizatiiRoluri(p, coduriPePersoana(aut))
  assert.ok(aceeasiPersoana(p.roluri[0].propunere, 'TRUSU RAZVAN'))
  assert.match(p.roluri[0].motiv, /Preferință Răzvan pe EGT.*în locul propunerii AI \(TOMA LIVIU\)/)
  assert.equal(p.roluri[0].validare_autorizatie, 'cod_literal')
  assert.equal(p.roluri[1].validare_autorizatie, 'echivalenta_nevalidata')                       // Toma n-are EGD
  assert.match(p.roluri[1].motiv, /^ATENȚIE: TOMA LIVIU nu are în platformă autorizația EGD/)
  assert.equal(p.roluri[2].validare_autorizatie, undefined)
})

Deno.test('roluri: o propunere deja preferată rămâne; repartizarea din matrice nu se schimbă', () => {
  const p: any = { roluri: [
    { rol: 'EGT', autorizatie_ceruta: 'EGT', propunere: 'STANESCU SILVIU' },
    { rol: 'Manager', autorizatie_ceruta: 'EGT', propunere: 'TOMA LIVIU', puncte_conditionat: 9 },
  ] }
  verificaAutorizatiiRoluri(p, coduriPePersoana(aut))
  assert.equal(p.roluri[0].propunere, 'STANESCU SILVIU')
  assert.equal(p.roluri[1].propunere, 'TOMA LIVIU')
  assert.equal(p.roluri[1].validare_autorizatie, 'cod_literal')
})

Deno.test('barem: bonusul +2 pentru certificatul de manager de proiect — acordat doar cu certificat în platformă', () => {
  const p: any = { roluri: [
    { rol: 'Manager Proiect', rol_canonic: 'manager_proiect', propunere: 'DADULESCU COSMIN GRIGORAS', barem: { bonus: { puncte: 2, conditie: 'certificat de curs Manager de proiect' } } },
    { rol: 'Manager Proiect 2', rol_canonic: 'manager_proiect', propunere: 'TOMA LIVIU', barem: { bonus: { puncte: 2, conditie: 'certificat de curs Manager de proiect' } } },
  ], repartizare_calculata: { total_puncte: 13 } }
  aplicaBonusBarem(p, aut)
  assert.equal(p.roluri[0].puncte_bonus, 2)
  assert.equal(p.roluri[0].bonus.acordat, true)
  assert.equal(p.roluri[1].bonus.acordat, false)
  assert.match(p.roluri[1].motiv, /POSIBIL dacă TOMA LIVIU prezintă/)
  assert.equal(p.repartizare_calculata.bonus_puncte, 2)
})
