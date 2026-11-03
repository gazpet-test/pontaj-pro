import { describe, it, expect } from 'vitest'
import { stariPermise, poateAproba, urmatorul, valideazaCorespondenta, mesajEroareCoresp, etichetaStareCoresp } from './corespondenta.js'

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
})
