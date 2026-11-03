// Logica pură a ecranului 📱 SMS (smsLogica.js): contor, argumentele RPC, filtre, regulile butoanelor, validări.
import { describe, expect, it } from 'vitest'
import {
  contorText, argumenteIntern, departamente, filtreazaAngajati, zileLaPlafon, poateAproba, poateTrimite, poateAnula,
  motivBlocareRedari, valideazaAutorizare, valideazaPlafoane, motivTrimitere, costEstimat, fmtEur,
} from './smsLogica.js'

describe('contorText', () => {
  it('eticheta și textul trimis (transliterat)', () => {
    const c = contorText('Ședință mâine')
    expect(c.eticheta).toBe('13/160 caractere GSM-7 · 1 SMS')
    expect(c.text).toBe('Sedinta maine')
    expect(c.avertismente.join(' ')).toContain('normalizează automat')
  })
  it('avertismente: caractere nepermise, prea lung; text curat fără avertismente', () => {
    expect(contorText('Salut 😀').avertismente.join(' ')).toContain('😀')
    expect(contorText('a'.repeat(161)).avertismente.join(' ')).toContain('Peste 160')
    expect(contorText('Sedinta la 8').avertismente).toEqual([])
    expect(contorText('').eticheta).toBe('0/160 caractere GSM-7 · 0 SMS')
  })
})

describe('argumenteIntern (nu cade niciodată pe „toți” din greșeală)', () => {
  it('toți / departament / selecție', () => {
    expect(argumenteIntern('toti')).toEqual({ p_departamente: null, p_angajati: null })
    expect(argumenteIntern('departament', { departamente: ['TESA'] })).toEqual({ p_departamente: ['TESA'], p_angajati: null })
    expect(argumenteIntern('selectie', { selectati: ['3', 5] })).toEqual({ p_departamente: null, p_angajati: [3, 5] })
  })
  it('departament sau selecție GOALE → filtru imposibil (BD refuză: niciun angajat), nu „toți”', () => {
    expect(argumenteIntern('departament', { departamente: [] }).p_departamente).toEqual(['__niciunul__'])
    expect(argumenteIntern('selectie', { selectati: [] }).p_angajati).toEqual([-1])
  })
})

describe('lista de angajați', () => {
  const lista = [
    { id: 1, nume: 'TEST UNU', departament: 'TESA', telefon_mascat: '07** *** 001' },
    { id: 2, nume: 'TEST DOI', departament: 'Execuție', telefon_mascat: null },
    { id: 3, nume: 'ALT TREI', departament: 'TESA', telefon_mascat: '07** *** 003', optout: true },
  ]
  it('departamente unice, sortate', () => expect(departamente(lista)).toEqual(['Execuție', 'TESA']))
  it('filtru departament + căutare', () => {
    expect(filtreazaAngajati(lista, { departament: 'TESA' }).map(a => a.id)).toEqual([1, 3])
    expect(filtreazaAngajati(lista, { cauta: ' test ' }).map(a => a.id)).toEqual([1, 2])
    expect(filtreazaAngajati(null)).toEqual([])
  })
})

describe('regulile butoanelor', () => {
  it('aprobare doar pe draft; trimitere doar aprobat / în trimitere ȘI kill-switch oprit; anulare pe stările deschise', () => {
    expect(poateAproba({ stare: 'draft' })).toBe(true)
    expect(poateAproba({ stare: 'aprobat' })).toBe(false)
    expect(poateTrimite({ stare: 'aprobat' }, { kill_switch: false })).toBe(true)
    expect(poateTrimite({ stare: 'in_trimitere' }, { kill_switch: false })).toBe(true)
    expect(poateTrimite({ stare: 'aprobat' }, { kill_switch: true })).toBe(false)
    expect(poateTrimite({ stare: 'aprobat' }, null)).toBe(false)
    expect(poateTrimite({ stare: 'draft' }, { kill_switch: false })).toBe(false)
    expect(['draft', 'aprobat', 'in_trimitere', 'trimis', 'anulat'].map(s => poateAnula({ stare: s }))).toEqual([true, true, true, false, false])
  })
  it('Redări: blocat cu mesajul cerut cât comutatorul e oprit', () => {
    expect(motivBlocareRedari({ redari_autorizat: false })).toBe('Așteaptă autorizarea scrisă Transgaz')
    expect(motivBlocareRedari(null)).toMatch(/verifică/)
    expect(motivBlocareRedari({ redari_autorizat: true })).toBeNull()
  })
})

describe('validări', () => {
  it('autorizarea Redări: nr + dată (nu în viitor) + bifă', () => {
    expect(valideazaAutorizare({ nr: 'TGZ-1', data: '2026-11-03', confirmat: true }, '2026-11-03')).toEqual([])
    expect(valideazaAutorizare({ nr: ' ', data: '', confirmat: false }, '2026-11-03')).toHaveLength(3)
    expect(valideazaAutorizare({ nr: 'TGZ-1', data: '2026-11-04', confirmat: true }, '2026-11-03').join(' ')).toContain('viitor')
    expect(valideazaAutorizare({ nr: 'x'.repeat(101), data: '2026-11-01', confirmat: true }, '2026-11-03')).toHaveLength(1)
  })
  it('plafoane ca în BD', () => {
    expect(valideazaPlafoane('200', '1500')).toBeNull()
    expect(valideazaPlafoane(201, 200)).toMatch(/depăși/)
    expect(valideazaPlafoane(-1, 10)).toMatch(/zilnic/)
    expect(valideazaPlafoane(1, 60000)).toMatch(/lunar/)
    expect(valideazaPlafoane('1.5', 10)).toMatch(/întregi/)
  })
  it('zile la plafon, cost, motive', () => {
    expect(zileLaPlafon(450, 200)).toBe(3)
    expect(zileLaPlafon(0, 200)).toBe(0)
    expect(zileLaPlafon(10, 0)).toBe(Infinity)
    expect(costEstimat(1500)).toBe(73.5)
    expect(fmtEur(4.606)).toContain('EUR')
    expect(motivTrimitere('kill_switch')).toMatch(/OPRITĂ/)
    expect(motivTrimitere('ceva_nou')).toContain('ceva_nou')
  })
})
