import { describe, it, expect } from 'vitest'
import { stariPermise, poateAproba, urmatorul, valideazaCorespondenta, mesajEroareCoresp, etichetaStareCoresp, sesiuneEcran, stariInFormular, stareEfectiva, etichetaRandCoresp, numeAprobator } from './corespondenta.js'

describe('corespondenta de trimis', () => {
  it('trimis / raspuns primit apar doar dupa aprobare; aprobat nu se alege din lista', () => {
    expect(stariPermise({ stare: 'draft' })).toEqual(['draft', 'la_avocat', 'anulat'])
    expect(stariPermise({ stare: 'aprobat', aprobat_la: '2026-11-03T08:00:00Z' })).toEqual(['draft', 'la_avocat', 'trimis', 'raspuns_primit', 'anulat', 'aprobat'])
  })
  it('doar owner-ul aproba si doar din draft / la avocat', () => {
    expect(poateAproba({ stare: 'draft' }, true)).toBe(true)
    expect(poateAproba({ stare: 'la_avocat' }, false)).toBe(false)
    expect(poateAproba({ stare: 'trimis' }, true)).toBe(false)
  })
  it('urmatorul pas = primul rand neincheiat dupa ordine', () => {
    const r = [{ id: 1, cod: 'A1', ordine: 20, stare: 'draft' }, { id: 2, cod: 'A4', ordine: 10, stare: 'trimis' }, { id: 3, cod: 'B1', ordine: 30, stare: 'aprobat' }]
    expect(urmatorul(r).cod).toBe('A1')
    expect(urmatorul([{ id: 2, cod: 'A4', ordine: 10, stare: 'anulat' }])).toBeNull()
  })
  it('validare: cod, ordine, campuri obligatorii, data la trimis, rand nou doar draft / la avocat', () => {
    expect(valideazaCorespondenta({ cod: 'b4', ordine: '35', destinatar: ' ISC ', subiect: 'x', stare: 'draft' }, { nou: true })).toEqual({ erori: [], valori: expect.objectContaining({ cod: 'B4', ordine: 35, destinatar: 'ISC' }) })
    expect(valideazaCorespondenta({ cod: 'BB', ordine: 0, destinatar: '', subiect: '', stare: 'trimis' }, { nou: true }).erori).toHaveLength(6)
    expect(valideazaCorespondenta({ ordine: 1, destinatar: 'a', subiect: 'b', stare: 'trimis', trimis_la: '' }).erori).toEqual(['Pentru „Trimis” completează data trimiterii.'])
  })
  it('mesajele de eroare ale BD sunt traduse', () => {
    expect(mesajEroareCoresp({ code: '42501', message: 'redari: doar Razvan (owner) aproba o corespondenta' })).toMatch(/Doar Răzvan/)
    expect(mesajEroareCoresp({ code: '23514', message: 'redari: o corespondenta se marcheaza trimisa doar dupa aprobarea owner-ului' })).toMatch(/după aprobarea/)
    expect(etichetaStareCoresp('la_avocat')).toBe('La avocat')
    expect(mesajEroareCoresp({ code: '42501', message: 'new row violates row-level security policy' })).toMatch(/Nu ai drept de scriere/)
    expect(mesajEroareCoresp({ code: '23514', message: 'redari: continutul s-a schimbat dupa aprobare; treci randul in draft' })).toMatch(/cere din nou aprobarea/)
  })
  it('sesiunea ecranului: operatia veche expira la A->B->A si la demontare; cea noua nu', () => {
    const ses = sesiuneEcran()
    ses.noua()                           // montare pe A
    const veche = ses.captureaza()       // salvare pornita pe A
    ses.noua(); ses.noua()               // A -> B -> A
    const noua = ses.captureaza()        // formular / salvare noua pe A
    expect(veche()).toBe(true); expect(noua()).toBe(false)
    ses.noua()                           // demontare
    expect(noua()).toBe(true)
  })
  it('formular: rand aprobat cu continut schimbat -> doar draft / la avocat / anulat', () => {
    const r = { stare: 'aprobat', aprobat_la: '2026-11-03T08:00:00Z', destinatar: 'TGZ', subiect: 'x', expeditor: 'C', documente: 'd' }
    expect(stariInFormular(r, { ...r })).toContain('trimis')
    expect(stariInFormular(r, { ...r, destinatar: 'alt' })).toEqual(['draft', 'la_avocat', 'anulat'])
    expect(stariInFormular(null, {})).toEqual(['draft', 'la_avocat'])
  })
  it('stare efectiva: aprobat cu expeditor schimbat -> draft (ce arata lista), nu aprobat (bug B1 04.11)', () => {
    const r = { stare: 'aprobat', aprobat_la: '2026-11-03T08:00:00Z', destinatar: 'ISC', subiect: 'x', expeditor: 'de stabilit', documente: 'd' }
    expect(stareEfectiva(r, { ...r, expeditor: 'Cristina' })).toBe('draft')
    expect(stareEfectiva(r, { ...r, expeditor: 'Cristina', stare: 'la_avocat' })).toBe('la_avocat')
    expect(stareEfectiva(r, { ...r })).toBe('aprobat')
    const { erori, valori } = valideazaCorespondenta({ ...r, cod: 'B1', ordine: 30, expeditor: 'Cristina', stare: stareEfectiva(r, { ...r, expeditor: 'Cristina' }) }, { nou: false })
    expect(erori).toEqual([]); expect(valori.stare).toBe('draft')
  })
})

describe('audit D1: cine a aprobat', () => {
  const nume = { 'u-claude': 'Claude', 'u-owner': 'TRUSU RAZVAN' }
  it('eticheta generică a stării nu mai numește o persoană', () => {
    expect(etichetaStareCoresp('aprobat')).toBe('Aprobat (owner)')
  })
  it('rând aprobat: „Aprobat de {nume}” din aprobat_de; fără nume rezolvat doar „Aprobat”', () => {
    expect(etichetaRandCoresp({ stare: 'aprobat', aprobat_de: 'u-claude' }, nume)).toBe('Aprobat de Claude')
    expect(etichetaRandCoresp({ stare: 'aprobat', aprobat_de: 'u-owner' }, nume)).toBe('Aprobat de TRUSU RAZVAN')
    expect(etichetaRandCoresp({ stare: 'aprobat', aprobat_de: 'u-necunoscut' }, nume)).toBe('Aprobat')
    expect(etichetaRandCoresp({ stare: 'aprobat', aprobat_de: null }, nume)).toBe('Aprobat')
    expect(etichetaRandCoresp({ stare: 'aprobat', aprobat_de: 'u-claude' }, {})).toBe('Aprobat')
    expect(etichetaRandCoresp({ stare: 'aprobat', aprobat_de: 'u-claude' }, { 'u-claude': '  ' })).toBe('Aprobat')
  })
  it('celelalte stări își păstrează eticheta; numeAprobator merge și pe rânduri trimise', () => {
    expect(etichetaRandCoresp({ stare: 'trimis', aprobat_de: 'u-claude' }, nume)).toBe('Trimis')
    expect(etichetaRandCoresp({ stare: 'draft' }, nume)).toBe('Draft')
    expect(numeAprobator({ stare: 'trimis', aprobat_de: 'u-claude' }, nume)).toBe('Claude')
    expect(numeAprobator({ stare: 'trimis' }, nume)).toBe(null)
  })
})
