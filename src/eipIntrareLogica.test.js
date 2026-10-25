import { beforeEach, describe, expect, it, vi } from 'vitest'
import { canonicalMarime, construiesteAntetSiLinii, construiesteCerere, normalizeazaNumar, validareMarime, validareRepartizare } from './eipIntrareLogica.js'

const harness = vi.hoisted(() => ({ stare: [], cursor: 0, rpc: vi.fn(), getUser: vi.fn() }))
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
vi.mock('./lib/supabase.js', () => ({ supabase: { rpc: harness.rpc, auth: { getUser: harness.getUser } } }))
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
    return EipIntrareModal({ cheie: 'cheie-sesiune', uid: 'u1', G: {}, S: {}, onClose: vi.fn(), onSuccess: vi.fn(), ...props })
  }
  const submit = props => randare(props).props.children.props.onSubmit({ preventDefault() {} })
  const stocare = {}
  beforeEach(() => {
    for (const k of Object.keys(stocare)) delete stocare[k]
    vi.stubGlobal('localStorage', { getItem: k => stocare[k] ?? null, setItem: (k, v) => { stocare[k] = v }, removeItem: k => { delete stocare[k] } })
    harness.stare = [formular(), [articol], false]
    harness.cursor = 0
    harness.rpc.mockReset()
    harness.getUser.mockReset()
    harness.getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
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
    harness.stare = [true, null, '', null, 'u1']
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

describe('remedieri review Jakarinos r1', () => {
  it('P2: aceeasi marime numerica are o singura forma si e detectata ca duplicat', () => {
    expect(['42', '042', '42.0', '42,00'].map(canonicalMarime)).toEqual(['42', '42', '42', '42'])
    expect(canonicalMarime('42,5')).toBe('42.5')
    expect(canonicalMarime(' xl ')).toBe('XL')
    expect(validareRepartizare(2, [{ marime: '42', cantitate: 1 }, { marime: '42.0', cantitate: 1 }]).valid).toBe(false)
    const f = formular()
    f.linii[0].pe_marimi = [{ marime: '042', cantitate: '1' }, { marime: '43,0', cantitate: '2' }]
    expect(construiesteAntetSiLinii(f).p_linii.map(l => l.marime)).toEqual(['42', '43'])
  })
  it('P3: totalul afisat vine din suma zecimala exacta', () => {
    expect(validareRepartizare('0.3', [{ marime: '42', cantitate: '0.1' }, { marime: '43', cantitate: '0.2' }]).suma).toBe('0.3')
    expect(validareRepartizare('3', [{ marime: '42', cantitate: '1' }, { marime: '43', cantitate: '2' }]).suma).toBe('3')
    expect(validareRepartizare('10', [{ marime: '42', cantitate: '4' }, { marime: '43', cantitate: '6' }]).suma).toBe('10')
  })
  it('P1: modalul ramane montat cat timp exista cheie, chiar daca dreptul se reverifica', () => {
    harness.stare.length = 0
    harness.cursor = 0
    harness.stare[0] = false
    harness.stare[1] = 'cheie-deschisa'
    const arbore = EipIntrareActiune({ G: {}, S: {}, onSuccess: vi.fn() })
    expect(arbore.props.children[1].props.cheie).toBe('cheie-deschisa')
  })
})

describe('remedieri review Copilot r1: retry dupa inchidere/refresh', () => {
  const mem = {}
  const randare = props => {
    harness.cursor = 0
    return EipIntrareModal({ cheie: 'cheie-p', uid: 'u1', G: {}, S: {}, onClose: vi.fn(), onSuccess: vi.fn(), ...props })
  }
  const submit = props => randare(props).props.children.props.onSubmit({ preventDefault() {} })
  beforeEach(() => {
    for (const k of Object.keys(mem)) delete mem[k]
    vi.stubGlobal('localStorage', { getItem: k => mem[k] ?? null, setItem: (k, v) => { mem[k] = v }, removeItem: k => { delete mem[k] } })
    harness.stare = [formular(), [articol], false]
    harness.cursor = 0
    harness.rpc.mockReset()
    harness.getUser.mockReset()
    harness.getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
  })
  it('rezultat incert: cheia si payload-ul raman in stocare; succesul la retrimitere le sterge', async () => {
    harness.rpc.mockRejectedValueOnce(new Error('Failed to fetch'))
    await submit()
    const salvat = JSON.parse(mem['eip_intrare_pending_v1:u1'])
    expect(salvat.cheie).toBe('cheie-p')
    expect(salvat.cerere.p_cheie).toBe('cheie-p')
    // simulam inchiderea/refresh: modal nou, doar cu pending, formular gol
    harness.stare = [{ furnizor_cui: '', furnizor_nume: '', factura_nr: '', factura_data: '2026-10-25', observatii: '', linii: [] }, [], false]
    harness.rpc.mockResolvedValueOnce({ error: null })
    const succes = vi.fn()
    await submit({ pending: salvat, onSuccess: succes })
    expect(harness.rpc).toHaveBeenLastCalledWith('fn_eip_intrare_factura', salvat.cerere)
    expect(succes).toHaveBeenCalledTimes(1)
    expect(mem['eip_intrare_pending_v1:u1']).toBeUndefined()
  })
  it('respingere definitiva: pending-ul se sterge si formularul se poate corecta', async () => {
    harness.rpc.mockResolvedValueOnce({ error: { code: 'P0001', message: 'eip_linie_invalida' } })
    await submit()
    expect(mem['eip_intrare_pending_v1:u1']).toBeUndefined()
  })
  it('butonul de deschidere reia receptia pastrata, cu aceeasi cheie', () => {
    mem['eip_intrare_pending_v1:u1'] = JSON.stringify({ cheie: 'cheie-veche', cerere: construiesteCerere(formular(), 'cheie-veche') })
    harness.stare = [true, null, '', null, 'u1']
    harness.cursor = 0
    let arbore = EipIntrareActiune({ G: {}, S: {}, onSuccess: vi.fn() })
    arbore.props.children[0].props.onClick()
    harness.cursor = 0
    arbore = EipIntrareActiune({ G: {}, S: {}, onSuccess: vi.fn() })
    expect(arbore.props.children[1].props.cheie).toBe('cheie-veche')
    expect(arbore.props.children[1].props.pending.cerere.p_cheie).toBe('cheie-veche')
  })
  it('fail-closed: daca stocarea locala nu poate pastra receptia, RPC-ul NU porneste', async () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError') }, removeItem: () => {} })
    await submit()
    expect(harness.rpc).not.toHaveBeenCalled()
    vi.stubGlobal('localStorage', { getItem: () => 'altceva', setItem: () => {}, removeItem: () => {} })
    await submit()
    expect(harness.rpc).not.toHaveBeenCalled()
    await submit({ uid: null })
    expect(harness.rpc).not.toHaveBeenCalled()
  })
  it('pending-ul e separat pe utilizator: B nu vede receptia lui A', () => {
    mem['eip_intrare_pending_v1:u1'] = JSON.stringify({ cheie: 'cheie-A', cerere: construiesteCerere(formular(), 'cheie-A') })
    harness.stare = [true, null, '', null, 'u2']
    harness.cursor = 0
    let arbore = EipIntrareActiune({ G: {}, S: {}, onSuccess: vi.fn() })
    arbore.props.children[0].props.onClick()
    harness.cursor = 0
    arbore = EipIntrareActiune({ G: {}, S: {}, onSuccess: vi.fn() })
    expect(arbore.props.children[1].props.cheie).not.toBe('cheie-A')
    expect(arbore.props.children[1].props.pending).toBe(null)
  })
  it('reverifica identitatea la trimitere: alt utilizator sau sesiune necitibila => RPC-ul NU porneste', async () => {
    harness.getUser.mockResolvedValue({ data: { user: { id: 'u2' } } })
    await submit()
    expect(harness.rpc).not.toHaveBeenCalled()
    harness.getUser.mockResolvedValue({ data: { user: null } })
    await submit()
    expect(harness.rpc).not.toHaveBeenCalled()
    harness.getUser.mockRejectedValue(new Error('retea'))
    await submit()
    expect(harness.rpc).not.toHaveBeenCalled()
    expect(mem['eip_intrare_pending_v1:u1']).toBeUndefined()
    harness.getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    harness.rpc.mockResolvedValueOnce({ error: null })
    await submit()
    expect(harness.rpc).toHaveBeenCalledTimes(1)
  })
  it('abandonarea reverifica identitatea: alt utilizator/eroare => pending-ul NU se sterge', async () => {
    const salvat = { cheie: 'cheie-p', cerere: construiesteCerere(formular(), 'cheie-p') }
    mem['eip_intrare_pending_v1:u1'] = JSON.stringify(salvat)
    vi.stubGlobal('window', { confirm: () => true })
    const buton = arbore => {
      const gasit = []
      const umbla = n => { if (!n || typeof n !== 'object') return; if (Array.isArray(n)) return n.forEach(umbla); if (n.props?.children?.[0] === 'Abandoneaza receptia' || n.props?.children === 'Abandoneaza receptia') gasit.push(n); umbla(n.props?.children) }
      umbla(arbore)
      return gasit[0]
    }
    harness.stare = [{ furnizor_cui: '', furnizor_nume: '', factura_nr: '', factura_data: '2026-10-25', observatii: '', linii: [] }, [], false]
    harness.cursor = 0
    const arbore = EipIntrareModal({ cheie: 'cheie-p', uid: 'u1', pending: salvat, G: {}, S: {}, onClose: vi.fn(), onSuccess: vi.fn() })
    const b = buton(arbore)
    expect(b).toBeTruthy()
    harness.getUser.mockResolvedValue({ data: { user: { id: 'u2' } } })
    await b.props.onClick()
    expect(mem['eip_intrare_pending_v1:u1']).toBeDefined()
    harness.getUser.mockRejectedValue(new Error('retea'))
    await b.props.onClick()
    expect(mem['eip_intrare_pending_v1:u1']).toBeDefined()
    harness.getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    await b.props.onClick()
    expect(mem['eip_intrare_pending_v1:u1']).toBeUndefined()
    vi.unstubAllGlobals()
  })
})

