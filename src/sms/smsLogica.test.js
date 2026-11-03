// Logica pură a ecranului 📱 SMS (smsLogica.js): contor, argumentele RPC, filtre, regulile butoanelor, validări.
import { describe, expect, it } from 'vitest'
import {
  contorText, argumenteIntern, departamente, filtreazaAngajati, zileLaPlafon, poateAproba, poateTrimite, poateAnula,
  motivBlocareRedari, valideazaAutorizare, valideazaPlafoane, motivTrimitere, costEstimat, fmtEur, rezumatMesaje, mesajAnulare, STARI_LOT,
  poateActiona, areModulSms, notaNivel, NIVELURI, MAX_TEST,
} from './smsLogica.js'

describe('lotul nu are stare „trimis” (Copilot r1 P2-01)', () => {
  it('coada golită + rezultatul pe mesaje', () => {
    expect(STARI_LOT.trimis).toBeUndefined()
    expect(STARI_LOT.coada_golita[0]).toMatch(/Coada golită/)
    expect(rezumatMesaje({ n_livrat: 5, n_esuat: 1, n_necunoscut: 2, n_anulat: 1, n_trimis: 0, n_in_coada: 0 }))
      .toBe('livrat 5 · eșuat 1 · necunoscut 2 · anulat 1')
    expect(rezumatMesaje({ n_livrat: 0, n_trimis: 3, n_in_coada: 4 })).toBe('livrat 0 · eșuat 0 · necunoscut 0 · anulat 0 · predat, fără raport încă 3 · în coadă 4')
    expect(motivTrimitere('lot_coada_golita')).toMatch(/goală/)
    expect(motivTrimitere('gata')).toMatch(/pe mesaje/)
  })
  it('anularea separă ce nu mai pleacă de ce era deja predat (Copilot r1 P3-02)', () => {
    expect(mesajAnulare({ mesaje_anulate: 4, deja_predate: 0 })).toBe('Lot anulat: 4 mesaje scoase din coadă (nu mai pleacă).')
    const m = mesajAnulare({ mesaje_anulate: 2, deja_predate: 3, deja_rezervate_necunoscut: 1, deja_trimise: 1, deja_livrate: 1, deja_esuate: 0 })
    expect(m).toContain('2 mesaje scoase din coadă')
    expect(m).toContain('3 erau deja predate furnizorului și NU se pot opri')
    expect(m).toContain('necunoscut 1 · trimis 1 · livrat 1 · eșuat 0')
  })
})

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
    expect(motivBlocareRedari({ nivel: 'owner', redari_autorizat: false })).toBe('Așteaptă autorizarea scrisă Transgaz')
    expect(motivBlocareRedari(null)).toMatch(/verifică/)
    expect(motivBlocareRedari({ nivel: 'owner', redari_autorizat: true })).toBeNull()
    expect(motivBlocareRedari({ nivel: 'utilizator', redari_modul: true, redari_autorizat: true })).toBeNull()
  })
  it('Redări (20261130b): contul de test nu face Redări; utilizatorul cere și modulul Redări; fără nivel = blocat', () => {
    expect(motivBlocareRedari({ nivel: 'test', redari_autorizat: true })).toMatch(/test/)
    expect(motivBlocareRedari({ nivel: 'utilizator', redari_modul: false, redari_autorizat: true })).toMatch(/modulul Redări/)
    expect(motivBlocareRedari({ redari_autorizat: true })).toMatch(/modulul Redări/)
  })
})

describe('niveluri SMS (20261130b) — oglinda lui fn_sms_lot_permis', () => {
  const intern = n => ({ categorie: 'intern', nr_destinatari: n })
  const redari = { categorie: 'redari', nr_destinatari: 2 }
  it('owner: tot', () => {
    expect(poateActiona(intern(5000), { nivel: 'owner' })).toBe(true)
    expect(poateActiona(redari, { nivel: 'owner' })).toBe(true)
  })
  it('utilizator: intern fără limită; Redări doar cu modulul Redări', () => {
    expect(poateActiona(intern(800), { nivel: 'utilizator' })).toBe(true)
    expect(poateActiona(redari, { nivel: 'utilizator', redari_modul: false })).toBe(false)
    expect(poateActiona(redari, { nivel: 'utilizator', redari_modul: true })).toBe(true)
  })
  it('test: acțiuni doar pe interne de 1–5; vede orice intern; niciodată Redări', () => {
    expect([0, 1, 5, 6].map(n => poateActiona(intern(n), { nivel: 'test' }))).toEqual([false, true, true, false])
    expect(poateActiona(intern(6), { nivel: 'test' }, false)).toBe(true)
    expect(poateActiona(redari, { nivel: 'test', redari_modul: true })).toBe(false)
    expect(poateActiona(redari, { nivel: 'test', redari_modul: true }, false)).toBe(false)
    expect(MAX_TEST).toBe(5)
  })
  it('fără nivel / nivel necunoscut: nimic', () => {
    expect(poateActiona(intern(1), null)).toBe(false)
    expect(poateActiona(intern(1), { nivel: 'admin' })).toBe(false)
  })
  it('meniul: owner sau modulul sms (și sub-chei sms.*)', () => {
    expect(areModulSms({ is_owner: true })).toBe(true)
    expect(areModulSms({ is_owner: false, module_access: ['sms'] })).toBe(true)
    expect(areModulSms({ is_owner: false, module_access: ['smsx', 'redari'] })).toBe(false)
    expect(areModulSms(null)).toBe(false)
  })
  it('nota pe nivel și motivul de refuz al trimiterii', () => {
    expect(notaNivel({ nivel: 'test' })).toMatch(/maximum 5 destinatari/)
    expect(notaNivel({ nivel: 'test' })).toMatch(/fără Redări/)
    expect(notaNivel({ nivel: 'utilizator' })).toMatch(/owner/)
    expect(notaNivel({ nivel: 'owner' })).toBeNull()
    expect(NIVELURI.test).toMatch(/test/)
    expect(motivTrimitere('acces_refuzat')).toMatch(/maximum 5/)
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
