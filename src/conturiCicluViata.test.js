import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  COLAB_STARI, ziRomania, ziBaza, esteFostAngajat, valideazaColab, etichetaColab, formatDataRo,
  mesajStareCont, stareContProfil, externExistentDinEroare, poateActivaColaborarea, MESAJ_ACTIVARE_FARA_ACORD,
  cuvinteNume, fostAngajatPotrivit, esteEroareOmonim, esteEroareReangajat, MESAJ_OMONIM_FOST_ANGAJAT, autorJurnalAcord,
} from './conturiCicluViata.js'

const today = '2026-09-29'

describe('esteFostAngajat', () => {
  it('true doar cu dată de încetare <= azi și fișă neactivă', () => {
    expect(esteFostAngajat({ termination_date: '2026-09-25', active: false }, today)).toBe(true)
    expect(esteFostAngajat({ termination_date: today, active: false }, today)).toBe(true)
    expect(esteFostAngajat({ termination_date: '2026-09-25', active: null }, today)).toBe(true)
    expect(esteFostAngajat({ termination_date: '2026-09-25T00:00:00', active: false }, today)).toBe(true)
  })
  it('false pentru fișă inactivă fără dată (ex. import greșit)', () => {
    expect(esteFostAngajat({ termination_date: null, active: false }, today)).toBe(false)
    expect(esteFostAngajat({ active: false }, today)).toBe(false)
  })
  it('false pentru dată în viitor și pentru fișă încă activă', () => {
    expect(esteFostAngajat({ termination_date: '2026-10-01', active: false }, today)).toBe(false)
    expect(esteFostAngajat({ termination_date: '2026-09-25', active: true }, today)).toBe(false)
  })
  it('false pentru intrări lipsă sau invalide', () => {
    expect(esteFostAngajat(null, today)).toBe(false)
    expect(esteFostAngajat({ termination_date: 'ieri', active: false }, today)).toBe(false)
  })
  it('ziua implicită e cea din România (miezul nopții UTC+3)', () => {
    expect(ziRomania(new Date('2026-09-28T21:30:00Z'))).toBe('2026-09-29')
  })
  it('ziBaza = CURRENT_DATE din Postgres (UTC): la 00:30 ora RO e încă ziua precedentă (review: închiderea ratată noaptea)', () => {
    const noapte = new Date('2026-09-29T21:30:00Z')              // 30.09 00:30 în România
    expect(ziRomania(noapte)).toBe('2026-09-30')
    expect(ziBaza(noapte)).toBe('2026-09-29')                     // data implicită a încetării ⇒ <= CURRENT_DATE ⇒ închidere
    expect(ziBaza(new Date('2026-09-30T08:00:00Z'))).toBe('2026-09-30')
  })
})

describe('valideazaColab', () => {
  it('„necunoscut” e valid fără notă', () => {
    expect(valideazaColab('necunoscut', '', null)).toEqual({ ok: true, eroare: null })
  })
  it('accepta / refuza cer notă de minim 5 caractere (după trim) sau document', () => {
    for (const s of ['accepta', 'refuza']) {
      expect(valideazaColab(s, 'A semnat acordul', null).ok).toBe(true)
      expect(valideazaColab(s, '  abcd  ', null).ok).toBe(false)
      expect(valideazaColab(s, '     ', '').ok).toBe(false)
      expect(valideazaColab(s, null, undefined).ok).toBe(false)
      expect(valideazaColab(s, '', 'hr/f2/acord.pdf').ok).toBe(true)
      expect(valideazaColab(s, 'abcde', null).ok).toBe(true)
    }
    expect(valideazaColab('accepta', 'abc', null).eroare).toMatch(/Dovada e obligatorie/)
  })
  it('o stare necunoscută sistemului e invalidă (nu se deduce acord)', () => {
    for (const s of ['poate', 'ACCEPTA', '', null, undefined]) expect(valideazaColab(s, 'Nota destul de lunga', 'doc').ok).toBe(false)
  })
})

describe('etichetaColab', () => {
  it('textele și culorile celor 3 stări', () => {
    expect(COLAB_STARI).toEqual(['necunoscut', 'accepta', 'refuza'])
    expect(etichetaColab('necunoscut')).toMatchObject({ label: 'Necunoscut', culoare: '#D29922' })
    expect(etichetaColab('accepta')).toMatchObject({ label: 'Acceptă', culoare: '#2EA043' })
    expect(etichetaColab('refuza')).toMatchObject({ label: 'Refuză', culoare: '#F85149' })
  })
  it('valorile necunoscute se afișează ca „Necunoscut”, niciodată ca acord', () => {
    expect(etichetaColab(undefined).status).toBe('necunoscut')
    expect(etichetaColab('da').status).toBe('necunoscut')
  })
})

describe('mesajStareCont / stareContProfil', () => {
  it('„Cont închis automat la …” cu data românească', () => {
    expect(mesajStareCont({ stare: 'inchis', inchis_la: '2026-09-29T04:00:12Z' })).toEqual({ text: '🔒 Cont închis automat la 29.09.2026', ton: 'inchis' })
    // 22:30 UTC = a doua zi în România
    expect(mesajStareCont({ stare: 'inchis', inchis_la: '2026-09-28T22:30:00Z' }).text).toContain('29.09.2026')
  })
  it('„Cont încă activ” sau nimic', () => {
    expect(mesajStareCont({ stare: 'activ' })).toEqual({ text: '⚠️ Cont încă activ', ton: 'activ' })
    expect(mesajStareCont(null)).toBeNull()
    expect(mesajStareCont({})).toBeNull()
    expect(mesajStareCont({ stare: 'altceva' })).toBeNull()
  })
  it('ban fără jurnal (închidere manuală neimportată) nu apare ca activ', () => {
    expect(mesajStareCont({ stare: 'blocat' }).ton).toBe('inchis')
  })
  it('coloana Stare din Admin: închis > tip marcat > activ', () => {
    expect(stareContProfil({ tip_cont: 'extern' }, { facut_la: '2026-09-29T04:00:00Z' })).toEqual({ text: '🔒 Închis 29.09.2026', ton: 'inchis' })
    expect(stareContProfil({ tip_cont: 'test' }, null)).toEqual({ text: 'test', ton: 'marcat' })
    expect(stareContProfil({ tip_cont: 'angajat' }, null).text).toBe('Activ')
    expect(stareContProfil({ tip_cont: null }, undefined).text).toBe('Activ')
  })
  it('coloana Stare: ban fără jurnal (Dashboard / închidere manuală neimportată) NU mai apare „Activ” (review)', () => {
    expect(stareContProfil({ tip_cont: null }, null, { stare: 'blocat' })).toEqual({ text: '🔒 Logare blocată (fără jurnal)', ton: 'inchis' })
    expect(stareContProfil({ tip_cont: 'extern' }, null, { stare: 'blocat' }).ton).toBe('inchis')
    expect(stareContProfil({ tip_cont: null }, null, { stare: 'inchis', inchis_la: '2026-09-29T04:00:00Z' }).text).toBe('🔒 Închis 29.09.2026')
    expect(stareContProfil({ tip_cont: null }, null, { stare: 'activ' }).text).toBe('Activ')
  })
  it('formatDataRo acceptă date simple, timestamp și valori invalide', () => {
    expect(formatDataRo('2026-09-25')).toBe('25.09.2026')
    expect(formatDataRo('2026-09-29T08:05:00Z', { cuOra: true })).toMatch(/29\.09\.2026.*11:05/)
    expect(formatDataRo('nu e dată')).toBe('')
    expect(formatDataRo(null)).toBe('')
  })
})

describe('Externi: coliziune pe nume și activarea colaborării', () => {
  it('extrage id-ul externului existent din HINT-ul erorii 23505', () => {
    expect(externExistentDinEroare({ code: '23505', hint: 'Există deja externul Fost Coliziune (#17): leagă-l explicit' })).toBe(17)
    expect(externExistentDinEroare({ code: '23505', hint: null })).toBeNull()
    expect(externExistentDinEroare({ code: '42501', hint: '(#17)' })).toBeNull()
    expect(externExistentDinEroare(null)).toBeNull()
  })
  it('un extern legat se activează doar cu acordul „accepta”; cei nelegați nu sunt afectați', () => {
    expect(poateActivaColaborarea({ fost_angajat_employee_id: 5 }, 'necunoscut')).toBe(false)
    expect(poateActivaColaborarea({ fost_angajat_employee_id: 5 }, 'refuza')).toBe(false)
    expect(poateActivaColaborarea({ fost_angajat_employee_id: 5 }, 'accepta')).toBe(true)
    expect(poateActivaColaborarea({ fost_angajat_employee_id: null }, undefined)).toBe(true)
    expect(poateActivaColaborarea({}, undefined)).toBe(true)
    expect(MESAJ_ACTIVARE_FARA_ACORD).toContain('HR → Foști angajați')
  })
  it('un extern legat de o fișă REACTIVATĂ nu se activează nici cu „accepta” (review)', () => {
    expect(poateActivaColaborarea({ fost_angajat_employee_id: 5 }, 'accepta', false)).toBe(false)
    expect(poateActivaColaborarea({ fost_angajat_employee_id: 5 }, 'accepta', true)).toBe(true)
  })
})

describe('Omonimie extern nelegat ↔ fost angajat (aceeași regulă ca în BD)', () => {
  const fosti = [
    { id: 9201, name: 'STEFANESCU ION', email: 'stefanescu.ion@yahoo.com', termination_date: '2026-09-20', active: false },
    { id: 9202, name: 'RADU MIHAI', email: null, termination_date: '2026-09-20', active: false },
    { id: 9203, name: 'VIITOR PLECAT', email: null, termination_date: '2026-12-31', active: true },
  ]
  it('cuvinteNume: fără diacritice (virgulă și sedilă), distincte, sortate', () => {
    expect(cuvinteNume('Ștefănescu Ion-Şerban')).toEqual(['ION', 'SERBAN', 'STEFANESCU'])
    expect(cuvinteNume('  ţuţu  ')).toEqual(['TUTU'])
    expect(cuvinteNume(null)).toEqual([])
  })
  it('potrivire pe nume (orice ordine, cu/fără diacritice, prenume în plus) și pe email', () => {
    expect(fostAngajatPotrivit({ nume: 'Radu Mihai' }, fosti, today)?.id).toBe(9202)
    expect(fostAngajatPotrivit({ nume: 'Ștefănescu Ion' }, fosti, today)?.id).toBe(9201)
    expect(fostAngajatPotrivit({ nume: 'Ion Stefanescu Marian' }, fosti, today)?.id).toBe(9201)
    expect(fostAngajatPotrivit({ nume: 'Alt Nume', email: ' Stefanescu.Ion@yahoo.com ' }, fosti, today)?.id).toBe(9201)
  })
  it('fără potrivire: alt prenume, fără numele de familie, un singur cuvânt, fișă încă activă, rând deja legat', () => {
    expect(fostAngajatPotrivit({ nume: 'Radu Mihaela' }, fosti, today)).toBeNull()
    expect(fostAngajatPotrivit({ nume: 'Mihai' }, fosti, today)).toBeNull()
    expect(fostAngajatPotrivit({ nume: 'Ion Marian' }, fosti, today)).toBeNull()
    expect(fostAngajatPotrivit({ nume: 'Viitor Plecat' }, fosti, today)).toBeNull()
    expect(fostAngajatPotrivit({ nume: 'Radu Mihai', fost_angajat_employee_id: 9202 }, fosti, today)).toBeNull()
    expect(fostAngajatPotrivit(null, fosti, today)).toBeNull()
  })
  it('erorile BD se recunosc; mesajul trimite la HR → Foști angajați', () => {
    expect(esteEroareOmonim({ code: '23514', message: 'E fost angajat Gazpet (fișa #9202 RADU MIHAI): colaborarea se trece prin HR → Foști angajați, cu acordul lui' })).toBe(true)
    expect(esteEroareOmonim({ code: '23514', message: 'Colaborarea poate fi activă doar dacă fostul angajat a acceptat' })).toBe(false)
    expect(esteEroareReangajat({ code: '23514', message: 'Colaborarea externă poate fi activă doar pentru un fost angajat: fișa #5 e din nou activă' })).toBe(true)
    expect(esteEroareOmonim(null)).toBe(false)
    expect(MESAJ_OMONIM_FOST_ANGAJAT).toContain('HR → Foști angajați')
  })
  it('jurnalul acordului: resetul automat se afișează ca „sistem”', () => {
    expect(autorJurnalAcord({ sursa: 'reset_automat', facut_de: 'u1' }, 'Natalia')).toBe('sistem (reset automat) · declanșat de Natalia')
    expect(autorJurnalAcord({ sursa: 'reset_automat', facut_de: null }, undefined)).toBe('sistem (reset automat)')
    expect(autorJurnalAcord({ sursa: 'manual', facut_de: 'u1' }, 'Natalia')).toBe('Natalia')
  })
})

describe('Gărzi statice (fără scrieri directe ale acordului / contului)', () => {
  const citeste = f => readFileSync(new URL(f, import.meta.url), 'utf8')
  it('HrFostiAngajati.jsx nu scrie direct în employees; acordul trece doar prin RPC', () => {
    const src = citeste('./HrFostiAngajati.jsx')
    expect(src).not.toMatch(/\.from\(\s*['"]employees['"]\s*\)\s*\.update\(/)
    expect(src).not.toMatch(/\.from\(\s*['"]employees['"]\s*\)[\s\S]{0,80}\.(insert|upsert|delete)\(/)
    expect(src).toContain("rpc('fn_colaborare_externa_seteaza'")
    expect(src).toContain("rpc('fn_fost_angajat_leaga_extern'")
  })
  it('HrFostiAngajati.jsx: controlul de acord e permis doar owner / can_modify_employees', () => {
    expect(citeste('./HrFostiAngajati.jsx')).toContain('profile?.is_owner === true || profile?.can_modify_employees === true')
  })
  it('App.jsx: data implicită a încetării la „Dezact.” e ziua BD (ziBaza), nu ziua RO (review)', () => {
    const app = citeste('./App.jsx')
    const toggle = app.slice(app.indexOf('const toggleEmp=async'), app.indexOf('const openEditEmp=async'))
    expect(toggle).toContain('const azi=ziBaza()')
    expect(toggle).not.toContain('ziRomania(')
  })
  it('App.jsx: pe un cont închis se oferă „Reaplică închiderea” lângă „Restaurează” (review: alertele critice)', () => {
    const app = citeste('./App.jsx')
    const bloc = app.slice(app.indexOf('🔒 Cont închis automat la {formatDataRo(inch.facut_la'), app.indexOf('🔒 Închide contul acum</button>'))
    expect(bloc).toContain('onClick={inchideContAcum}')
    expect(bloc).toContain('🔒 Reaplică închiderea')
    expect(bloc).toContain('↩ Restaurează din jurnal')
  })
  it('App.jsx: legarea la cerere nu se face fără previzualizare + confirmare (p_simulare:true înainte de false)', () => {
    const app = citeste('./App.jsx')
    const lega = app.slice(app.indexOf('const legaAutomat=async'), app.indexOf('// Save date firmă'))
    expect(lega.indexOf("p_simulare:true")).toBeGreaterThan(-1)
    expect(lega.indexOf("p_simulare:true")).toBeLessThan(lega.indexOf('window.confirm'))
    expect(lega.indexOf('window.confirm')).toBeLessThan(lega.indexOf("p_simulare:false"))
  })
  it('HrFostiAngajati.jsx: „Trece ca extern” nu e oferit celor care au refuzat; dovada se poate actualiza', () => {
    const src = citeste('./HrFostiAngajati.jsx')
    expect(src).toContain("status === 'refuza' ? (")
    expect(src.indexOf("status === 'refuza' ? (")).toBeLessThan(src.indexOf('🤝 Trece ca extern'))
    expect(src).toContain('Actualizează dovada')
  })
  it('funcțiile pure nu importă Supabase', () => {
    expect(citeste('./conturiCicluViata.js')).not.toMatch(/from ['"][^'"]*supabase/)
  })
})
