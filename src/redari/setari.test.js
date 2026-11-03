import { describe, it, expect } from 'vitest'
import { CAMPURI_PROIECT, CAMPURI_UAT, COL_PROIECT, COL_UAT, normalizeaza, normalizeazaValoare, cheiSchimbate, valideazaUat, valideazaProiect,
  lipsuriUat, rezumatZile, dataValida, conflicteConcurente, contractDinExecutie } from './setari.js'
import { TERMEN_CONVOCARE_ZILE, dataLimitaConvocare, termenAfisare, avertismenteUat } from './setari.js'

const uatBun = () => ({ nume: 'Test UAT', sesiune_zi1: '2026-12-10', program_zi1: '09:00 – 16:00', sesiune_zi2: '2026-12-11', program_zi2: '09:00 – 19:00',
  termen_confirmare: '2026-11-28', afisare_data_start: '2026-11-20', afisare_data_end: '2026-12-12', afisare_ora: '09:30', reprezentant_uat_nume: 'Repr. test' })

describe('setari — normalizare', () => {
  it('trim, gol → null, chei doar din câmpuri', () => {
    expect(normalizeazaValoare('  x ')).toBe('x')
    expect(normalizeazaValoare('   ')).toBeNull()
    expect(normalizeazaValoare(undefined)).toBeNull()
    const n = normalizeaza({ nume: ' A ', judet: '', strain: 'nu', uat3: 'ABC' }, CAMPURI_UAT)
    expect(n.nume).toBe('A')
    expect(n.judet).toBeNull()
    expect('strain' in n).toBe(false)
    expect('uat3' in n).toBe(false)          // uat3 nu se scrie din formular (imuabil după parcele)
    expect(Object.keys(n)).toHaveLength(CAMPURI_UAT.length)
  })
  it('cheiSchimbate tratează null ≡ "" și ignoră spațiile', () => {
    expect(cheiSchimbate({ nume: 'A', judet: null }, { nume: ' A ', judet: '' }, CAMPURI_UAT)).toEqual([])
    expect(cheiSchimbate({ sesiune_zi1: '2026-12-10' }, { sesiune_zi1: '2026-12-11' }, CAMPURI_UAT)).toEqual(['sesiune_zi1'])
  })
  it('select-urile explicite conțin coloanele noi din 20261127a și nu au „*”', () => {
    for (const k of ['reprezentant_uat_telefon', 'termen_confirmare', 'afisare_ora', 'afisare_reprezentant_gazpet', 'adresa_nr', 'adresa_data', 'uat3']) expect(COL_UAT).toContain(k)
    expect(COL_PROIECT).toContain('apm_nume')
    expect(COL_UAT).not.toContain('*')
    expect(new Set(COL_UAT.split(', ')).size).toBe(COL_UAT.split(', ').length)
    expect(new Set(COL_PROIECT.split(', ')).size).toBe(COL_PROIECT.split(', ').length)
  })
  it('link_afisare nu există în câmpuri (decizia 02.11: scos din adresa UAT)', () => {
    expect([...CAMPURI_UAT, ...CAMPURI_PROIECT].some(c => c.cheie === 'link_afisare')).toBe(false)
  })
})

describe('setari — valideazaUat (oglinda CHECK-urilor din BD)', () => {
  it('UAT complet = fără erori', () => { expect(valideazaUat(uatBun())).toEqual([]) })
  it('numele e obligatoriu', () => { expect(valideazaUat({ ...uatBun(), nume: '  ' })).toContain('Nume UAT: obligatoriu') })
  it('zile: zi2 fără zi1, zi3 fără zi2, ordine strictă', () => {
    expect(valideazaUat({ ...uatBun(), sesiune_zi1: '', program_zi1: '' })).toContain('Ziua 2 cere ziua 1')
    expect(valideazaUat({ ...uatBun(), sesiune_zi2: '', program_zi2: '', sesiune_zi3: '2026-12-12' })).toContain('Ziua 3 cere ziua 2')
    expect(valideazaUat({ ...uatBun(), sesiune_zi2: '2026-12-10' })).toContain('Ziua 2 trebuie să fie după ziua 1')
    expect(valideazaUat({ ...uatBun(), sesiune_zi3: '2026-12-11' })).toContain('Ziua 3 trebuie să fie după ziua 2')
    expect(valideazaUat({ nume: 'X', sesiune_zi1: '2026-12-10' })).toEqual([])  // coada NULL e permisă
  })
  it('program fără dată e semnalat', () => {
    expect(valideazaUat({ nume: 'X', program_zi3: '09:00 – 16:00' })).toContain('Program ziua 3 fără dată')
  })
  it('termenul de confirmare e strict înaintea zilei 1', () => {
    expect(valideazaUat({ ...uatBun(), termen_confirmare: '2026-12-10' })).toContain('Termenul de confirmare trebuie să fie înaintea zilei 1')
    expect(valideazaUat({ nume: 'X', termen_confirmare: '2026-12-10' })).toEqual([])  // fără zi1, termenul e liber
  })
  it('afișarea nu se termină înainte să înceapă; ora HH:MM', () => {
    expect(valideazaUat({ ...uatBun(), afisare_data_end: '2026-11-19' })).toContain('Afișarea se termină înainte să înceapă')
    expect(valideazaUat({ ...uatBun(), afisare_ora: '25:00' })).toContain('Ora afișării (HH:MM): format HH:MM (00:00–23:59)')
    expect(valideazaUat({ ...uatBun(), afisare_ora: '9:30' })).toHaveLength(1)
  })
  it('data inexistentă în calendar e respinsă (Jakarinos f2 r1 P3)', () => {
    expect(dataValida('2026-02-30')).toBe(false)
    expect(dataValida('2028-02-29')).toBe(true)
    expect(dataValida('2026-2-03')).toBe(false)
    expect(valideazaUat({ nume: 'X', sesiune_zi1: '2026-02-30' })).toContain('Ziua 1: dată invalidă')
  })
  it('dată invalidă, e-mail invalid, telefon prea lung', () => {
    expect(valideazaUat({ ...uatBun(), sesiune_zi1: '2026-13-40' }).some(e => /Ziua 1: dată invalidă/.test(e))).toBe(true)
    expect(valideazaUat({ ...uatBun(), primarie_email: 'nu-e-mail' })).toContain('E-mail primărie: adresă de e-mail invalidă')
    expect(valideazaUat({ ...uatBun(), reprezentant_uat_telefon: '1'.repeat(41) })).toContain('Telefon reprezentant: maximum 40 caractere')
  })
})

describe('setari — conflicte concurente (Copilot f2 r2 P2)', () => {
  it('doar câmpurile schimbate de mine ȘI de altcineva', () => {
    const baza = { contact_email: 'a@x.ro', contact_nume: 'N', denumire: 'D' }
    const proaspat = { contact_email: 'b@x.ro', contact_nume: 'N2', denumire: 'D' }
    expect(conflicteConcurente(baza, proaspat, ['contact_email', 'denumire'])).toEqual(['contact_email'])
    expect(conflicteConcurente(baza, baza, ['contact_email'])).toEqual([])
    expect(conflicteConcurente({ judet: null }, { judet: '' }, ['judet'])).toEqual([])
  })
  it('select-urile citesc versiunea', () => {
    expect(COL_PROIECT.split(', ')).toContain('versiune')
    expect(COL_UAT.split(', ')).toContain('versiune')
  })
})

describe('setari — contractDinExecutie (Copilot f2b r1 P2-2)', () => {
  it('data din sufixul numărului nu se pierde când data_contract lipsește', () => {
    expect(contractDinExecutie({ nr_contract: '30/22.01.2025', data_contract: null, coordonator_transgaz: 'C' }))
      .toEqual({ contract_nr: '30', contract_data: '2025-01-22', reprezentant_tgz_nume: 'C', avertisment: null })
  })
  it('data din Execuție are prioritate și nepotrivirea se semnalează', () => {
    const c = contractDinExecutie({ nr_contract: '30/22.01.2025', data_contract: '2025-01-17' })
    expect(c.contract_data).toBe('2025-01-17')
    expect(c.avertisment).toContain('2025-01-22')
    expect(contractDinExecutie({ nr_contract: '30/22.01.2025', data_contract: '2025-01-22' }).avertisment).toBeNull()
  })
  it('număr fără sufix de dată, sufix invalid, gol', () => {
    expect(contractDinExecutie({ nr_contract: 'ABC-7' })).toMatchObject({ contract_nr: 'ABC-7', contract_data: null })
    expect(contractDinExecutie({ nr_contract: '30/31.02.2025' })).toMatchObject({ contract_nr: '30', contract_data: null })
    expect(contractDinExecutie({ nr_contract: '', data_contract: '' })).toMatchObject({ contract_nr: null, contract_data: null, reprezentant_tgz_nume: null })
  })
})

describe('setari — proiect, lipsuri, rezumat', () => {
  it('textele GDPR / declarație sunt obligatorii', () => {
    const e = valideazaProiect({ text_gdpr: ' ', text_declaratie: 'x' })
    expect(e).toContain('Informare GDPR (convocator + formular public): obligatoriu')
    expect(e).not.toContain('Declarația „nu particip — fără obiecții”: obligatoriu')
  })
  it('e-mailul de contact se validează', () => {
    expect(valideazaProiect({ text_gdpr: 'a', text_declaratie: 'b', contact_email: 'redari@gazpet.ro' })).toEqual([])
    expect(valideazaProiect({ text_gdpr: 'a', text_declaratie: 'b', contact_email: 'redari@' })).toHaveLength(1)
  })
  it('lipsuriUat cere o zi cu program și reprezentantul', () => {
    expect(lipsuriUat(uatBun())).toEqual([])
    expect(lipsuriUat({ sesiune_zi1: '2026-12-10' })).toEqual(['nicio zi de sesiune cu program', 'fără reprezentant nominalizat de primărie'])
  })
  it('rezumatZile', () => {
    expect(rezumatZile(uatBun())).toBe('10.12 · 11.12')
    expect(rezumatZile({})).toBe('-')
  })
})

describe('felia 2: legătură Execuție și URL GDPR', () => {
  it('coloanele noi intră în proiecție și patch', () => {
    expect(COL_PROIECT.split(', ')).toContain('executie_proiect_id')
    expect(COL_PROIECT.split(', ')).toContain('link_informare_gdpr')
    expect(CAMPURI_PROIECT.find(c => c.cheie === 'link_informare_gdpr').tip).toBe('url')
    const n = normalizeaza({ executie_proiect_id: 12, link_informare_gdpr: ' https://example.invalid ' }, CAMPURI_PROIECT)
    expect(n.executie_proiect_id).toBe(12)
    expect(n.link_informare_gdpr).toBe('https://example.invalid')
  })
  it.each([null, '', 'https://example.invalid', 'https://' + 'x'.repeat(292)])('URL legitim %s', url => {
    expect(valideazaProiect({ text_gdpr: 'Test', text_declaratie: 'Test', link_informare_gdpr: url })).toEqual([])
  })
  it.each(['http://x', 'HTTPS://x', 'https://' + 'x'.repeat(293)])('URL refuzat %s', url => {
    expect(valideazaProiect({ text_gdpr: 'Test', text_declaratie: 'Test', link_informare_gdpr: url })).toContain('Informarea GDPR completă (HTTPS, opțional): începe cu https://, maximum 300 caractere')
  })
})

// Plan de verificare A1 rev49 (03.11.2026), pct. 4.2 și 4.3: expediere + afișare „cu cel puțin 10 zile înainte de prima zi de sesiune”.
// Datele așteptate sunt numărate în calendar, nu calculate cu funcția testată.
describe('termenul de 10 zile (plan pct. 4.2 și 4.3)', () => {
  it('data-limită = ziua 1 minus 10 zile calendaristice, peste lună, an, 29 februarie și schimbarea orei', () => {
    expect(TERMEN_CONVOCARE_ZILE).toBe(10)
    expect(dataLimitaConvocare('2026-12-10')).toBe('2026-11-30')
    expect(dataLimitaConvocare('2026-12-05')).toBe('2026-11-25')
    expect(dataLimitaConvocare('2027-01-05')).toBe('2026-12-26')
    expect(dataLimitaConvocare('2028-03-05')).toBe('2028-02-24')
    expect(dataLimitaConvocare('2026-04-02')).toBe('2026-03-23')
    expect(dataLimitaConvocare('2026-11-01')).toBe('2026-10-22')
    expect(dataLimitaConvocare(' 2026-12-10 ')).toBe('2026-11-30')
    for (const v of [null, undefined, '', '  ', '2026-02-30', '10.12.2026', '2026-12-1']) expect(dataLimitaConvocare(v)).toBeNull()
  })
  it('afișarea: pe data-limită sau înainte = în termen; o zi după = depășit; fără una dintre date nu se judecă', () => {
    const u = { sesiune_zi1: '2026-12-10' }
    expect(termenAfisare({ ...u, afisare_data_start: '2026-11-30' })).toMatchObject({ depasit: false, limita: '2026-11-30' })
    expect(termenAfisare({ ...u, afisare_data_start: '2026-11-20' }).depasit).toBe(false)
    expect(termenAfisare({ ...u, afisare_data_start: '2026-12-01' })).toMatchObject({ depasit: true, limita: '2026-11-30' })
    expect(termenAfisare({ ...u, afisare_data_start: '2026-12-10' }).depasit).toBe(true)
    expect(termenAfisare(u).depasit).toBe(false)
    expect(termenAfisare({ afisare_data_start: '2026-12-01' })).toMatchObject({ depasit: false, limita: null })
    expect(termenAfisare({ ...u, afisare_data_start: '2026-12-40' }).depasit).toBe(false)
    expect(termenAfisare(null).depasit).toBe(false)
  })
  it('avertisment, NU eroare: salvarea nu se blochează (valideazaUat rămâne oglinda CHECK-urilor din BD)', () => {
    const tarziu = { ...uatBun(), afisare_data_start: '2026-12-01' }
    expect(valideazaUat(tarziu)).toEqual([])
    expect(avertismenteUat(tarziu)).toEqual(['Afișarea la primărie începe pe 01.12.2026, sub 10 zile înainte de ziua 1 (10.12.2026): trebuie să înceapă cel târziu pe 30.11.2026 (plan pct. 4.3)'])
    expect(avertismenteUat(uatBun())).toEqual([])
    expect(avertismenteUat({})).toEqual([])
  })
  it('lista „Gata de convocare?” arată termenul depășit', () => {
    expect(lipsuriUat({ ...uatBun(), afisare_data_start: '2026-12-01' })).toEqual(['afișarea începe după 30.11.2026 (sub 10 zile înainte de ziua 1)'])
    expect(lipsuriUat({ ...uatBun(), afisare_data_start: '2026-11-30' })).toEqual([])
  })
})
