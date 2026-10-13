import { strict as assert } from 'node:assert'
import { acoperaCod, codTip } from '../_shared/echivalenteAnre.ts'
import { aceeasiPersoana, adnoteazaBonus, bonusPersoana, conditieBonusRecunoscuta, coduriAutorizatie, coduriPePersoana, liniiFirma, rezolvaPersoana, selecteazaCriterii, stareDocFirma, valideazaAtestariFirma, verificaAutorizatiiRoluri, type AutPers } from './context.ts'
import { repartizeazaDinMatrice } from './repartizare.ts'

const AZI = '2026-10-13'
const ET13 = { id: 13, denumire: 'Autorizație ET Gazpet (execuție tehnică)', tip: 'Autorizație ET', data_valabilitate: '2027-07-27', fara_expirare: false }
const ISO = { id: 20, denumire: 'Certificat ISO 9001:2015', tip: 'ISO 9001', data_valabilitate: '2028-01-01', fara_expirare: false }

Deno.test('criterii: după nume, fără fișă; fără text și peste plafon raportate, nu pierdute (Jak r1 P1 #8)', () => {
  const docs = [
    { id: 532, nume_original: 'Instructiuni_ofertanti_FisaDate_DF1280841.pdf', are_text: true },
    { id: 522, nume_original: 'Detaliere criteriu de atribuire.docx', are_text: true },
    { id: 600, nume_original: 'Factorii de evaluare.pdf', are_text: false },
    { id: 601, nume_original: 'PT/2_P. Ds. Cond/Plan situatie.pdf', are_text: true },
    { id: 602, nume_original: 'Algoritm_de_calcul.docx', are_text: true },
    { id: 603, nume_original: 'Criterii 2.docx', are_text: true },
    { id: 604, nume_original: 'Criterii 3.docx', are_text: true },
  ]
  assert.deepEqual(selecteazaCriterii(docs, 532), { cu_text: [522, 602, 603], fara_text: [600], peste_plafon: [604] })
})

Deno.test('firmă: stări + linia de context marchează expirarea înainte de termen', () => {
  assert.equal(stareDocFirma(ET13, AZI), 'valabil')
  assert.equal(stareDocFirma({ ...ET13, id: 14, data_valabilitate: null }, AZI), 'valabilitate_necunoscuta')
  assert.equal(stareDocFirma({ ...ET13, data_valabilitate: '2025-01-01' }, AZI), 'expirat')
  const { linii, valabile } = liniiFirma([ET13, { ...ET13, id: 14, data_valabilitate: null }], AZI, '2027-08-01')
  assert.deepEqual([...valabile.keys()], [13])
  assert.ok(linii[0].includes('EXPIRĂ ÎNAINTE DE TERMENUL 2027-08-01'))
  assert.ok(linii[1].includes('VALABILITATE NECUNOSCUTĂ'))
})

Deno.test('atestări de firmă: documentul trebuie să ACOPERE codul cerut (Jak r1 P1 #1)', () => {
  assert.deepEqual([...coduriAutorizatie('Autorizație ANRE tip ET pentru executarea sistemelor de transport (Ordin ANRE 132/2021)')], ['ET'])
  assert.deepEqual([...coduriAutorizatie('ISO 9001:2015')], ['ISO9001'])
  const { valabile } = liniiFirma([ET13, ISO], AZI)
  const p: any = { atestari_firma: [
    { cerinta: 'Autorizație ANRE tip ET', document_firma_id: 13 },
    { cerinta: 'Autorizație ANRE tip ET', document_firma_id: 20 },          // id valabil, dar ISO nu acoperă ET
    { cerinta: 'Certificat sistem de management al calității', document_firma_id: 20 },   // fără cod = neconfirmată
  ] }
  const rez = valideazaAtestariFirma(p, valabile, '2027-01-01')
  assert.deepEqual(p.atestari_firma.map((a: any) => a.status), ['indeplinita', 'neacoperita', 'neconfirmata'])
  assert.match(p.atestari_firma[0].sursa, /documente_firma #13 .*până 2027-07-27/)
  assert.equal(rez.neacoperite.length, 1); assert.equal(rez.neconfirmate.length, 1); assert.equal(rez.expira.length, 0)
})

Deno.test('atestări de firmă: expiră înainte de termen = nu verde (Jak r1 P1 #2); text fără listă = neconfirmat (P1 #4)', () => {
  const { valabile } = liniiFirma([ET13], AZI)
  const p: any = { atestari_firma: [{ cerinta: 'Autorizație ANRE ET', document_firma_id: 13 }] }
  const rez = valideazaAtestariFirma(p, valabile, '2027-08-01')
  assert.equal(p.atestari_firma[0].status, 'expira_inainte_de_termen')
  assert.equal(rez.expira.length, 1)
  const q: any = { atestari: 'ANRE ET obligatorie', atestari_firma: [] }
  assert.equal(valideazaAtestariFirma(q, valabile, null).neconfirmate.length, 1)
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
  { cine: 'POPESCU ION', tip: 'EGT - Executant Gaze Transport', valabil: true },
  { cine: 'POPESCU ION VASILE', tip: 'EGD - Executant Gaze Distribuție', valabil: true },
  { cine: 'VECHI EXPIRAT', tip: 'EGT - Executant Gaze Transport', valabil: false },
  { cine: 'DADULESCU COSMIN GRIGORAS', tip: 'Certificat absolvire curs Manager de proiect', valabil: true },
]

Deno.test('nume: exact întâi, prefix doar cu un singur candidat (Jak r1 P1 #5)', () => {
  const chei = coduriPePersoana(aut)
  assert.equal(rezolvaPersoana('POPESCU ION', chei), 'popescu ion')                 // exact, nu „POPESCU ION VASILE”
  assert.equal(rezolvaPersoana('POPESCU ION VASILE', chei), 'popescu ion vasile')
  assert.equal(rezolvaPersoana('POPESCU', chei), null)                             // ambiguu
  assert.equal(rezolvaPersoana('TRUSU RAZVAN', chei), 'trusu razvan mihail')       // unic
  const p: any = { roluri: [{ rol: 'EGT', autorizatie_ceruta: 'EGT', propunere: 'POPESCU ION VASILE', puncte_conditionat: 1 }] }
  verificaAutorizatiiRoluri(p, coduriPePersoana(aut), {})
  assert.equal(p.roluri[0].validare_autorizatie, 'echivalenta_nevalidata')          // nu împrumută EGT de la „POPESCU ION”
})

Deno.test('roluri: preferința pe EGT, codul literal, nevalidată = problemă raportată (Jak r1 P1 #3)', () => {
  const p: any = { roluri: [
    { rol: 'Persoană EGT', autorizatie_ceruta: 'EGT', propunere: 'TOMA LIVIU', motiv: 'AI' },
    { rol: 'Persoană EGD', autorizatie_ceruta: 'EGD', propunere: 'TOMA LIVIU', motiv: 'AI' },
  ] }
  const probleme = verificaAutorizatiiRoluri(p, coduriPePersoana(aut))
  assert.ok(aceeasiPersoana(p.roluri[0].propunere, 'TRUSU RAZVAN'))
  assert.match(p.roluri[0].motiv, /Preferință Răzvan pe EGT.*în locul propunerii AI \(TOMA LIVIU\)/)
  assert.equal(p.roluri[0].validare_autorizatie, 'cod_literal')
  assert.equal(p.roluri[1].validare_autorizatie, 'echivalenta_nevalidata')
  assert.deepEqual(probleme, ['Persoană EGD: TOMA LIVIU fără EGD'])
})

Deno.test('roluri: preferința nu creează cumul — persoana preferată e deja pe alt rol (Jak r1 P1 #6)', () => {
  const p: any = { roluri: [
    { rol: 'Manager Proiect', propunere: 'TRUSU RAZVAN MIHAIL', puncte_conditionat: 9 },
    { rol: 'Responsabil EGT', autorizatie_ceruta: 'EGT', propunere: 'TOMA LIVIU' },
  ] }
  verificaAutorizatiiRoluri(p, coduriPePersoana(aut), { EGT: ['TRUSU RAZVAN'] })
  assert.equal(p.roluri[1].propunere, 'TOMA LIVIU')
  assert.match(p.roluri[1].motiv, /NU s-a aplicat: persoana e deja propusă pe alt rol/)
  assert.equal(p.roluri[1].validare_autorizatie, 'cod_literal')
})

Deno.test('roluri: cod de persoană doar în textul cerinței = neconfirmat, nu sărit (Jak r1 P1 #4)', () => {
  const p: any = { roluri: [{ rol: 'Responsabil', cerinte: 'legitimație ANRE EGD valabilă', propunere: 'TOMA LIVIU' }] }
  const probleme = verificaAutorizatiiRoluri(p, coduriPePersoana(aut), {})
  assert.equal(p.roluri[0].validare_autorizatie, 'neconfirmata')
  assert.equal(probleme.length, 2)   // nestructurat + fără EGD
})

Deno.test('bonus: doar pe condiția recunoscută explicit (Jak r1 P1 #7)', () => {
  const r = (conditie: string) => ({ rol: 'Manager', rol_canonic: 'manager_proiect', barem: { bonus: { puncte: 2, conditie } } })
  assert.equal(bonusPersoana(r('certificat de curs Manager de proiect'), 'DADULESCU COSMIN GRIGORAS', aut), 2)
  assert.equal(bonusPersoana(r('certificat BIM'), 'DADULESCU COSMIN GRIGORAS', aut), 0)          // rolul nu înlocuiește condiția
  assert.equal(bonusPersoana(r('certificat de curs Manager de proiect'), 'TOMA LIVIU', aut), 0)
  const p: any = { roluri: [{ ...r('certificat BIM'), propunere: 'DADULESCU COSMIN GRIGORAS' }] }
  adnoteazaBonus(p, aut)
  assert.equal(p.roluri[0].bonus.acordat, false)
  assert.match(p.roluri[0].motiv, /condiție nerecunoscută de cod/)
})

Deno.test('bonus în OPTIMIZARE: la punctaj egal pe barem, câștigă cel cu certificat, iar totalul îl include (Jak r1 P1 #8)', () => {
  // Botoșani factor 2: 2=1, 3=5, 4=9, ≥5=13, +2 certificat. A are 9 proiecte (13 p), B are 6 (13 p) + certificat → B = 15 p.
  const rol = { rol: 'Manager Proiect', rol_canonic: 'manager_proiect', propunere: null as any, cerinte: '',
    barem: { minim: 2, unitate: 'proiecte', trepte: [{ de_la: 2, puncte: 1 }, { de_la: 3, puncte: 5 }, { de_la: 4, puncte: 9 }, { de_la: 5, puncte: 13 }], bonus: { puncte: 2, conditie: 'certificat de curs Manager de proiect' } } }
  const parsed: any = { roluri: [rol], matrice_experti: [
    { persoana: 'TOMA LIVIU', rol: 'Manager Proiect', proiecte: 9, verificate: 9, proiecte_conditionate: 0, verificate_conditionate: 0 },
    { persoana: 'DADULESCU COSMIN GRIGORAS', rol: 'Manager Proiect', proiecte: 6, verificate: 6, proiecte_conditionate: 0, verificate_conditionate: 0 },
  ] }
  repartizeazaDinMatrice(parsed, (r, p) => bonusPersoana(r, p, aut))
  assert.equal(parsed.roluri[0].propunere, 'DADULESCU COSMIN GRIGORAS')
  assert.equal(parsed.roluri[0].puncte_conditionat, 15)
  assert.equal(parsed.repartizare_calculata.total_puncte, 15)
  // fără bonus, marja decide: A (9 proiecte)
  const fara: any = JSON.parse(JSON.stringify({ ...parsed, roluri: [{ ...rol, barem: { ...rol.barem, bonus: null } }] }))
  repartizeazaDinMatrice(fara)
  assert.equal(fara.roluri[0].propunere, 'TOMA LIVIU')
  assert.equal(fara.repartizare_calculata.total_puncte, 13)
})

// ── runda 2 (Jakarinos r2 NO-GO + Copilot r1 NO-GO) ─────────────────────────────────────────────────────
Deno.test('r2 criterii: JS = SQL (ilike cu %) — „Factori evaluare”, „Algoritm calcul” nu mai dispar (Copilot r1 P1)', () => {
  const r = selecteazaCriterii([{ id: 1, nume_original: 'Factori evaluare.pdf', are_text: true }, { id: 2, nume_original: 'Algoritm calcul punctaj.docx', are_text: true }], 99)
  assert.deepEqual(r.cu_text, [1, 2])
})

Deno.test('r2 atestări: completitudinea față de textul „atestari” (Copilot r1 P1 #2, Jakarinos r2 P1 #1)', () => {
  const { valabile } = liniiFirma([ET13, ISO], AZI)
  const partial: any = { atestari: 'ANRE ET și ISO 9001', atestari_firma: [{ cerinta: 'Autorizație ANRE ET', document_firma_id: 13 }] }
  const r1 = valideazaAtestariFirma(partial, valabile, '2027-01-01')
  assert.equal(partial.atestari_firma[0].status, 'indeplinita')
  assert.equal(r1.neconfirmate.length, 1); assert.match(r1.neconfirmate[0], /ISO9001.*lipsă din verificarea structurată/)
  const faraCod: any = { atestari: 'Certificat de management al calității obligatoriu', atestari_firma: [] }
  assert.equal(valideazaAtestariFirma(faraCod, valabile, null).neconfirmate.length, 1)
  const nimic: any = { atestari: 'null', atestari_firma: [] }
  assert.equal(valideazaAtestariFirma(nimic, valabile, null).neconfirmate.length, 0)
  const multe: any = { atestari_firma: Array.from({ length: 22 }, () => ({ cerinta: 'Autorizație ANRE ET', document_firma_id: 13 })) }
  assert.match(valideazaAtestariFirma(multe, valabile, null).neconfirmate[0], /2 cerințe de firmă peste plafonul de 20/)
})

Deno.test('r2 roluri: autorizație cerută fără persoană = problemă (Jakarinos r2 P1 #3, Copilot r1 P1 #3)', () => {
  const p: any = { roluri: [{ rol: 'Expert EGD', autorizatie_ceruta: 'EGD', propunere: null }] }
  const probleme = verificaAutorizatiiRoluri(p, coduriPePersoana(aut), {})
  assert.equal(p.roluri[0].validare_autorizatie, 'fara_persoana')
  assert.deepEqual(probleme, ['Expert EGD: nimeni propus pentru EGD'])
  // EGT doar în textul cerinței, propunere inițial nulă: preferința completează, dar rămâne neconfirmat structural
  const q: any = { roluri: [{ rol: 'Responsabil', cerinte: 'legitimație ANRE EGT', propunere: null }] }
  const pq = verificaAutorizatiiRoluri(q, coduriPePersoana(aut))
  assert.ok(aceeasiPersoana(q.roluri[0].propunere, 'TRUSU RAZVAN'))
  assert.equal(q.roluri[0].validare_autorizatie, 'neconfirmata')
  assert.deepEqual(pq, ['Responsabil: EGT necompletat structurat'])
})

Deno.test('r2 omonimi: același nume, titulari diferiți = ambiguu, fără comasarea codurilor (Copilot r1 P1 #4)', () => {
  const om: AutPers[] = [
    { cine: 'ION POPESCU', tip: 'EGT - Executant Gaze Transport', valabil: true, titular: 'e1' },
    { cine: 'ION POPESCU', tip: 'EGD - Executant Gaze Distribuție', valabil: true, titular: 'e2' },
  ]
  const pers = coduriPePersoana(om)
  assert.equal(rezolvaPersoana('ION POPESCU', pers), null)
  const p: any = { roluri: [{ rol: 'EGT', autorizatie_ceruta: 'EGT', propunere: 'ION POPESCU', puncte_conditionat: 1 }] }
  const probleme = verificaAutorizatiiRoluri(p, pers, {})
  assert.equal(p.roluri[0].validare_autorizatie, 'persoana_nerezolvata')
  assert.equal(probleme.length, 1)
})

Deno.test('r2 bonus: condiția simplă recunoscută; alt certificat / cumulativă = nu (Jakarinos r2 P1 #2)', () => {
  assert.equal(conditieBonusRecunoscuta('certificat eliberat de un furnizor de formare profesională acreditat care atestă că acesta a urmat cursuri de specializare pentru ocupația de Manager de proiect'), 'cert_manager_proiect')
  assert.equal(conditieBonusRecunoscuta('certificat de curs Manager de proiect'), 'cert_manager_proiect')
  assert.equal(conditieBonusRecunoscuta('certificat BIM pentru manager de proiect'), null)
  assert.equal(conditieBonusRecunoscuta('certificat de curs Manager de proiect și certificat BIM'), null)
  assert.equal(conditieBonusRecunoscuta('certificat PMP manager de proiect'), null)
})

Deno.test('r2 bonus: „acordat” doar dacă a intrat în punctaj; condiția nerecunoscută = problemă (Jakarinos r2 P2, Copilot r1 P2)', () => {
  const bonus = { puncte: 2, conditie: 'certificat de curs Manager de proiect' }
  const p: any = { roluri: [
    { rol: 'Manager', propunere: 'DADULESCU COSMIN GRIGORAS', puncte_conditionat: 0, barem: { bonus } },
    { rol: 'Manager 2', propunere: 'DADULESCU COSMIN GRIGORAS', barem: { bonus } },
    { rol: 'Manager 3', propunere: 'DADULESCU COSMIN GRIGORAS', puncte_conditionat: 15, barem: { bonus } },
    { rol: 'Manager BIM', propunere: 'DADULESCU COSMIN GRIGORAS', puncte_conditionat: 5, barem: { bonus: { puncte: 2, conditie: 'certificat BIM' } } },
  ] }
  const probleme = adnoteazaBonus(p, aut)
  assert.deepEqual(p.roluri.map((r: any) => r.bonus.acordat), [false, false, true, false])
  assert.equal(probleme.length, 1); assert.match(probleme[0], /Manager BIM.*nerecunoscută/)
})
