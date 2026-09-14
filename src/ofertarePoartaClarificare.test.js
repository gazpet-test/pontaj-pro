// PR 2 Laza — poarta de clarificare. Fixture: cazul real Râșnița (SCN1176786): oferta depusă
// 10.07.2026, solicitare pe 11.09 cu 11 puncte, termen 1 zi; ATSD (IGSU) din 11.09 = post-depunere.
import { describe, it, expect } from 'vitest'
import { evalueazaPoartaClarificare, ORE_REZERVE } from './ofertarePoarta.js'

const ACUM = new Date('2026-09-11T10:00:00Z')
const BAZA = {
  solicitare_id: 1, licitatie_id: 85, nr: 1, stare: 'deschisa',
  depus_la: '2026-07-10T14:00:00Z', depus_sursa: 'pachet',
  termen_raspuns: '2026-09-12T10:00:00Z',
  puncte: 11, puncte_fara_raspuns: 0, puncte_fara_locator: 0,
  anexe: [
    { id: 1, nume: 'CV Pantea', document_date: '2026-07-01', provenienta: 'pre_depunere', justificata: false },
    { id: 2, nume: 'Formular F3', document_date: '2026-07-09', provenienta: 'retrimis', justificata: false },
  ],
}
const cu = (patch, acum = ACUM) => evalueazaPoartaClarificare({ ...BAZA, ...patch }, acum)

describe('evalueazaPoartaClarificare', () => {
  it('null cat timp se incarca', () => expect(evalueazaPoartaClarificare(null)).toBeNull())
  it('tot in regula -> ok', () => { const ev = cu({}); expect(ev.stare).toBe('ok'); expect(ev.blocaje).toEqual([]); expect(ev.poate_cu_rezerve).toBe(false) })

  it('punct fara raspuns = block', () => expect(cu({ puncte_fara_raspuns: 3 }).blocaje).toContain('puncte'))
  it('niciun punct introdus = block (nu se trimite un raspuns gol)', () => expect(cu({ puncte: 0 }).blocaje).toContain('puncte'))
  it('raspuns fara locator in oferta depusa = warn (Laza: informatia exista, dar nu era localizabila)', () => {
    const ev = cu({ puncte_fara_locator: 2 }); expect(ev.stare).toBe('warn'); expect(ev.blocaje).toEqual([])
  })

  it('ATSD 11.09 (post-depunere) fara justificare = block', () => {
    const ev = cu({ anexe: [...BAZA.anexe, { id: 3, nume: 'ATSD IGSU', document_date: '2026-09-11', provenienta: 'post_depunere', justificata: false }] })
    expect(ev.blocaje).toContain('post_depunere')
    expect(ev.randuri.find(r => r.k === 'post_depunere').detalii).toMatch(/ATSD IGSU/)
  })
  it('post-depunere JUSTIFICAT = warn, nu block (calea onesta ramane deschisa si ramane scrisa)', () => {
    const ev = cu({ anexe: [{ id: 3, nume: 'ATSD IGSU', document_date: '2026-09-11', provenienta: 'post_depunere', justificata: true }] })
    expect(ev.stare).toBe('warn'); expect(ev.blocaje).toEqual([])
    expect(ev.rezerve.join(' ')).toMatch(/ATSD IGSU/)
  })
  it('anexa fara data = warn (provenienta nedemonstrabila)', () => {
    expect(cu({ anexe: [{ id: 9, nume: 'Anexa 5', provenienta: 'fara_data', justificata: false }] }).stare).toBe('warn')
  })
  it('data depunerii luata din termenul licitatiei (fara pachet depus in ERP) = warn', () => {
    expect(cu({ depus_sursa: 'termen_licitatie' }).randuri.find(r => r.k === 'depus_sursa').stare).toBe('warn')
  })

  describe('termenul', () => {
    it('fara termen = warn', () => expect(cu({ termen_raspuns: null }).randuri.find(r => r.k === 'termen').stare).toBe('warn'))
    it('termen depasit = block, fara iesire cu rezerve', () => {
      const ev = cu({}, new Date('2026-09-12T11:00:00Z'))
      expect(ev.blocaje).toContain('termen'); expect(ev.poate_cu_rezerve).toBe(false)
    })
    it(`sub ${ORE_REZERVE} h cu un block = se poate trimite CU REZERVE, iar block-ul ramane scris`, () => {
      const ev = cu({ puncte_fara_raspuns: 1 }, new Date('2026-09-12T04:00:00Z'))
      expect(ev.stare).toBe('block'); expect(ev.poate_cu_rezerve).toBe(true)
      expect(ev.rezerve.join(' ')).toMatch(/1 din 11 fără răspuns/)
    })
    it('cu 24 h inainte, acelasi block NU se poate trimite cu rezerve (e timp sa se repare)', () => {
      expect(cu({ puncte_fara_raspuns: 1 }).poate_cu_rezerve).toBe(false)
    })
    it('niciun punct = nu exista „cu rezerve", oricat de aproape e termenul', () => {
      expect(cu({ puncte: 0, puncte_fara_raspuns: 0 }, new Date('2026-09-12T04:00:00Z')).poate_cu_rezerve).toBe(false)
    })
  })
})
