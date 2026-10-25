import { beforeEach, describe, expect, it, vi } from 'vitest'
import { construiesteAntetSiLinii, construiesteCerere, normalizeazaNumar, validareMarime, validareRepartizare } from './eipIntrareLogica.js'

const harness = vi.hoisted(() => ({ stare: [], cursor: 0, rpc: vi.fn() }))
vi.mock('react', async importa => ({
  ...await importa(),
  // Harness local fara DOM: pastram starea si ref-urile intre randari.
  useState: initial => {
    const i = harness.cursor++
    if (!(i in harness.stare)) harness.stare[i] = typeof initial === 'function' ? initial() : initial
    return [harness.stare[i], v => { harness.stare[i] = typeof v === 'function' ? v(harness.stare[i]) : v }]
  },
  useRef: initial => {
    const i = harness.cursor++
    return harness.stare[i] ||= { current: initial }
  },
  useEffect: () => {},
}))
vi.mock('./lib/supabase.js', () => ({ supabase: { rpc: harness.rpc } }))
import EipIntrareActiune, { EipIntrareModal } from './EipIntrareModal.jsx'

const articol = { id: 7, denumire: 'BOCANCI', tip_marime: 'numar', um: 'pereche', activ: true }
const formular = () => ({ furnizor_cui: ' ro123 ', furnizor_nume: ' Furnizor ', factura_nr: ' F1 ', factura_data: '2026-10-25', linii: [{ articol, cautare: '', cantitate: '3', pe_marimi: [{ marime: '42', cantitate: '1' }, { marime: '43', cantitate: '2' }] }] })

describe('repartizare EIP B2', () => {
  it('accepta suma egala si refuza suma diferita', () => {
    expect(validareRepartizare(3, formular().linii[0].pe_marimi).valid).toBe(true)
    expect(validareRepartizare(4, formular().linii[0].pe_marimi).valid).toBe(false)
  })
  it('refuza marimea lipsa si repartizarea absenta', () => {
    expect(validareRepartizare(1, [{ cantitate: 1 }]).valid).toBe(false)
    expect(validareRepartizare(1, [{ marime: ' ', cantitate: 1 }]).valid).toBe(false)
    expect(validareRepartizare(1, []).valid).toBe(false)
  })
  it.each([0, -1, '', 'abc', NaN, Infinity, '1.000,50', '1e3'])('refuza cantitatea invalida %s', q => {
    expect(validareRepartizare(q, [{ marime: '42', cantitate: q }]).valid).toBe(false)
  })
  it('normalizeaza virgula si punctul si compara zecimalele exact', () => {
    expect(normalizeazaNumar(' 2,5 ')).toBe(2.5)
    expect(normalizeazaNumar('2.5')).toBe(2.5)
    expect(validareRepartizare('0,3', [{ marime: '42', cantitate: '0.1' }, { marime: '43', cantitate: '0,2' }]).valid).toBe(true)
    expect(validareRepartizare('0.3000000001', [{ marime: '42', cantitate: '0.3' }]).valid).toBe(false)
    expect(validareRepartizare(0.0000001, [{ marime: '42', cantitate: '0,0000001' }]).valid).toBe(true)
    expect(normalizeazaNumar('9007199254740990.1')).toBeNaN()
    expect(normalizeazaNumar('0.10000000000000001')).toBeNaN()
  })
  it('refuza duplicatele si cantitatile nule sau negative pe marime', () => {
    expect(validareRepartizare(2, [{ marime: ' xl ', cantitate: 1 }, { marime: 'XL', cantitate: 1 }]).valid).toBe(false)
    for (const q of [0, -1, 'abc']) expect(validareRepartizare(1, [{ marime: '42', cantitate: q }]).valid).toBe(false)
  })
})

describe('contractul RPC B1', () => {
  it('produce numai campurile acceptate si cate o linie pentru fiecare marime', () => {
    expect(construiesteAntetSiLinii(formular())).toEqual({
      p_antet: { furnizor_cui: 'RO123', furnizor_nume: 'Furnizor', factura_nr: 'F1', factura_data: '2026-10-25' },
      p_linii: [{ articol_id: 7, marime: '42', cantitate: 1 }, { articol_id: 7, marime: '43', cantitate: 2 }],
    })
  })
  it.each(['buc', 'pereche'])('pastreaza cantitatea fara conversie pentru UM %s', um => {
    const f = formular()
    f.linii[0].articol = { ...articol, um }
    expect(construiesteAntetSiLinii(f).p_linii.map(l => l.cantitate)).toEqual([1, 2])
  })
  it('marime unica foloseste NULL; nespecificat este text pentru numar/litera', () => {
    const f = formular()
    f.linii[0] = { articol: { ...articol, tip_marime: 'unica', um: 'buc' }, cantitate: '1,5', pe_marimi: [{ marime: null, cantitate: '1,5' }] }
    expect(construiesteAntetSiLinii(f).p_linii).toEqual([{ articol_id: 7, marime: null, cantitate: 1.5 }])
    f.linii[0].pe_marimi[0].marime = 'nespecificat'
    expect(() => construiesteAntetSiLinii(f)).toThrow('Marimea')
    f.linii[0].articol.tip_marime = 'numar'
    expect(construiesteAntetSiLinii(f).p_linii[0].marime).toBe('NESPECIFICAT')
  })
  it('valideaza tipul marimii', () => {
    expect(validareMarime('numar', 'XL')).toBe(false)
    expect(validareMarime('litera', '42')).toBe(false)
    expect(validareMarime('litera', 'XXL')).toBe(true)
    expect(validareMarime('numar', '42,5')).toBe(true)
    expect(validareMarime('numar', null)).toBe(false)
  })
  it('nu pierde observatii si refuza datele imposibile sau articolul invalid', () => {
    expect(() => construiesteAntetSiLinii({ ...formular(), observatii: 'Nota' })).toThrow('observatii')
    expect(() => construiesteAntetSiLinii({ ...formular(), factura_data: '2026-02-30' })).toThrow('Data')
    expect(() => construiesteAntetSiLinii({ ...formular(), linii: [{ ...formular().linii[0], articol: null }] })).toThrow('articol')
    expect(() => construiesteAntetSiLinii({ ...formular(), linii: [] })).toThrow('articol')
    expect(() => construiesteAntetSiLinii({ ...formular(), furnizor_cui: ' ' })).toThrow('furnizorul')
  })
  it('cheia data de sesiune este stabila la retry', () => {
    const f = formular()
    const cheie = '11111111-1111-4111-8111-111111111111'
    expect(construiesteCerere(f, cheie)).toEqual(construiesteCerere(f, cheie))
    expect(construiesteCerere(f, cheie).p_cheie).toBe(cheie)
    expect(() => construiesteCerere(f, '')).toThrow('Cheia')
  })
})

describe('salvarea din modal, RPC simulat fara BD', () => {
  const randare = props => {
    harness.cursor = 0
    return EipIntrareModal({ cheie: 'cheie-sesiune', G: {}, S: {}, onClose: vi.fn(), onSuccess: vi.fn(), ...props })
  }
  const submit = props => randare(props).props.children.props.onSubmit({ preventDefault() {} })
  beforeEach(() => {
    harness.stare = [formular(), [articol], false]
    harness.cursor = 0
    harness.rpc.mockReset()
  })
  it('blocheaza dublul click si dupa eroare de retea retrimite acelasi payload si aceeasi cheie', async () => {
    let respinge
    harness.rpc.mockImplementationOnce(() => new Promise((_, reject) => { respinge = reject }))
    const prima = submit()
    await submit()
    expect(harness.rpc).toHaveBeenCalledTimes(1)
    respinge(new Error('Failed to fetch'))
    await prima
    const initial = structuredClone(harness.rpc.mock.calls[0][1])
    harness.stare[0] = { ...formular(), factura_nr: 'SCHIMBAT' }
    harness.rpc.mockResolvedValueOnce({ error: null })
    const succes = vi.fn()
    await submit({ onSuccess: succes })
    expect(harness.rpc).toHaveBeenLastCalledWith('fn_eip_intrare_factura', initial)
    expect(initial.p_cheie).toBe('cheie-sesiune')
    expect(succes).toHaveBeenCalledTimes(1)
  })
  it('pastreaza formularul si permite corectarea dupa refuz de drept', async () => {
    const initial = harness.stare[0]
    harness.rpc.mockResolvedValueOnce({ error: { code: '42501', message: 'eip_fara_drept' } })
    const succes = vi.fn()
    await submit({ onSuccess: succes })
    expect(harness.stare[0]).toBe(initial)
    expect(harness.stare[5]).toContain('Nu ai drept')
    expect(harness.stare[7]).toBe(false)
    expect(succes).not.toHaveBeenCalled()
  })
  it('nu salveaza repartizarea invalida', async () => {
    harness.stare[0].linii[0].cantitate = 9
    await submit()
    expect(harness.rpc).not.toHaveBeenCalled()
  })
  it('nu afiseaza butonul fara un drept verificat', () => {
    harness.stare = []
    harness.cursor = 0
    const rezultat = EipIntrareActiune({ G: {}, S: {}, onSuccess: vi.fn() })
    expect(rezultat.props.children[0]).toBe(false)
  })
  it('genereaza UUID doar la deschidere si il pastreaza la rerandare', () => {
    harness.stare = [true]
    const uuid = vi.spyOn(crypto, 'randomUUID').mockReturnValue('11111111-1111-4111-8111-111111111111')
    try {
      const randareActiune = () => {
        harness.cursor = 0
        return EipIntrareActiune({ G: {}, S: {}, onSuccess: vi.fn() })
      }
      randareActiune().props.children[0].props.onClick()
      const modal = randareActiune().props.children[1]
      expect(modal.props.cheie).toBe('11111111-1111-4111-8111-111111111111')
      expect(randareActiune().props.children[1].props.cheie).toBe(modal.props.cheie)
      expect(uuid).toHaveBeenCalledTimes(1)
    } finally { uuid.mockRestore() }
  })
})
