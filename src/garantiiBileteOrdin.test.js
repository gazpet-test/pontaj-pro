// Bilete la ordin ca garanție la polițe (claude_context #1544, 02.10.2026) — logica pură
import { describe, it, expect } from 'vitest'
import { zilePanaLaScadenta, eScadent, eDepasit, etichetaScadenta, valideazaBO, normalizeazaBO, rezumatBOPeGarantie,
  caleScanBO, verificaScan, laSchimbareStare, formularGol, formularDinBO, laNumar, mesajEroareSalvare, aziISO,
  PRAG_SCADENT_ZILE, STARI_BO } from './garantiiBileteOrdin.js'

const AZI = '2026-10-02'
const bo = (x = {}) => ({ id: 1, garantie_id: 7, serie: 'BO', numar: '123', suma: 10000, moneda: 'RON', data_emitere: '2026-09-01', data_scadenta: '2026-10-10', stare: 'emis', ...x })

describe('zile și praguri', () => {
  it('zile până la scadență: azi = 0, viitor pozitiv, trecut negativ, lipsă null', () => {
    expect(zilePanaLaScadenta('2026-10-02', AZI)).toBe(0)
    expect(zilePanaLaScadenta('2026-10-16', AZI)).toBe(14)
    expect(zilePanaLaScadenta('2026-09-29', AZI)).toBe(-3)
    expect(zilePanaLaScadenta('2027-03-01T00:00:00+00:00', AZI)).toBe(150)
    expect(zilePanaLaScadenta(null, AZI)).toBeNull()
    expect(zilePanaLaScadenta('', AZI)).toBeNull()
    expect(zilePanaLaScadenta('abc', AZI)).toBeNull()
  })
  it('scadent = emis și ≤ 14 zile (inclusiv depășit); restituit/executat nu', () => {
    expect(PRAG_SCADENT_ZILE).toBe(14)
    expect(eScadent(bo({ data_scadenta: '2026-10-16' }), AZI)).toBe(true)
    expect(eScadent(bo({ data_scadenta: '2026-10-17' }), AZI)).toBe(false)
    expect(eScadent(bo({ data_scadenta: '2026-09-01' }), AZI)).toBe(true)
    expect(eScadent(bo({ data_scadenta: null }), AZI)).toBe(false)
    expect(eScadent(bo({ stare: 'restituit', data_scadenta: '2026-09-01' }), AZI)).toBe(false)
    expect(eScadent(bo({ stare: 'executat', data_scadenta: '2026-09-01' }), AZI)).toBe(false)
    expect(eDepasit(bo({ data_scadenta: '2026-10-01' }), AZI)).toBe(true)
    expect(eDepasit(bo({ data_scadenta: '2026-10-02' }), AZI)).toBe(false)
    expect(eDepasit(bo({ stare: 'restituit', data_scadenta: '2026-09-01' }), AZI)).toBe(false)
  })
  it('eticheta scadenței', () => {
    expect(etichetaScadenta(bo({ data_scadenta: '2026-10-02' }), AZI)).toBe('scadent azi')
    expect(etichetaScadenta(bo({ data_scadenta: '2026-10-03' }), AZI)).toBe('1 zi')
    expect(etichetaScadenta(bo({ data_scadenta: '2026-10-12' }), AZI)).toBe('10 zile')
    expect(etichetaScadenta(bo({ data_scadenta: '2026-10-01' }), AZI)).toBe('depășită de 1 zi')
    expect(etichetaScadenta(bo({ data_scadenta: '2026-09-20' }), AZI)).toBe('depășită de 12 zile')
    expect(etichetaScadenta(bo({ data_scadenta: '2026-12-01' }), AZI)).toBe('')
    expect(etichetaScadenta(bo({ stare: 'restituit', data_scadenta: '2026-09-20' }), AZI)).toBe('')
  })
  it('aziISO e în ora locală, format AAAA-LL-ZZ', () => {
    expect(aziISO(new Date(2026, 9, 2, 23, 30))).toBe('2026-10-02')
    expect(aziISO(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})

describe('validare și normalizare', () => {
  const ok = { serie: ' BO ', numar: ' 123 ', suma: '10000', moneda: 'RON', data_emitere: '2026-09-01', data_scadenta: '2026-12-01', stare: 'emis', restituit_la: '', observatii: ' x ' }
  it('formular valid → fără erori', () => {
    expect(valideazaBO(ok)).toEqual([])
    expect(valideazaBO({ ...ok, data_scadenta: '' })).toEqual([])
    expect(valideazaBO({ ...ok, data_scadenta: '2026-09-01' })).toEqual([])   // scadența = emiterea e permisă
  })
  it('număr obligatoriu, sumă > 0, emitere obligatorie, scadență ≥ emitere, moneda', () => {
    expect(valideazaBO({ ...ok, numar: '  ' })).toEqual(['numărul biletului e obligatoriu'])
    expect(valideazaBO({ ...ok, suma: '0' })).toEqual(['suma trebuie să fie un număr mai mare decât 0'])
    expect(valideazaBO({ ...ok, suma: '-5' })).toEqual(['suma trebuie să fie un număr mai mare decât 0'])
    expect(valideazaBO({ ...ok, suma: 'abc' })).toEqual(['suma trebuie să fie un număr mai mare decât 0'])
    expect(valideazaBO({ ...ok, data_emitere: '' })).toEqual(['data emiterii e obligatorie'])
    expect(valideazaBO({ ...ok, data_scadenta: '2026-08-31' })).toEqual(['scadența nu poate fi înaintea emiterii'])
    expect(valideazaBO({ ...ok, data_scadenta: '31.08.2026' })).toEqual(['data scadenței nu e validă'])
    expect(valideazaBO({ ...ok, moneda: 'USD' })).toEqual(['moneda trebuie să fie RON sau EUR'])
    expect(valideazaBO({ ...ok, stare: 'pierdut' })).toEqual(['stare necunoscută'])
    expect(valideazaBO({})).toContain('numărul biletului e obligatoriu')
    expect(valideazaBO(null).length).toBeGreaterThan(0)
  })
  it('restituit cere data restituirii (≥ emitere)', () => {
    expect(valideazaBO({ ...ok, stare: 'restituit' })).toEqual(['la „restituit” trebuie data restituirii'])
    expect(valideazaBO({ ...ok, stare: 'restituit', restituit_la: '2026-08-01' })).toEqual(['restituirea nu poate fi înaintea emiterii'])
    expect(valideazaBO({ ...ok, stare: 'restituit', restituit_la: '2026-11-15' })).toEqual([])
  })
  it('normalizarea: trim, serie goală = null, sumă numerică (și cu virgulă), restituit_la doar la restituit', () => {
    expect(normalizeazaBO(ok, 7)).toEqual({ garantie_id: 7, serie: 'BO', numar: '123', suma: 10000, moneda: 'RON', data_emitere: '2026-09-01',
      data_scadenta: '2026-12-01', stare: 'emis', restituit_la: null, document_path: null, observatii: 'x' })
    expect(normalizeazaBO({ ...ok, serie: '', suma: '1.234,56', observatii: '', restituit_la: '2026-10-01' }, 7)).toMatchObject({ serie: null, suma: 1234.56, observatii: null, restituit_la: null })
    expect(normalizeazaBO({ ...ok, stare: 'restituit', restituit_la: '2026-10-01', document_path: 'garantii/bo/7/x.pdf' }, 7)).toMatchObject({ stare: 'restituit', restituit_la: '2026-10-01', document_path: 'garantii/bo/7/x.pdf' })
    expect(normalizeazaBO({ ...ok, stare: 'altceva', moneda: 'USD' }, 7)).toMatchObject({ stare: 'emis', moneda: 'RON' })
    expect(laNumar('12,5')).toBe(12.5); expect(laNumar('1 000')).toBe(1000); expect(laNumar('')).toBeNull(); expect(laNumar('x')).toBeNull()
  })
  it('formularul gol / din rând și schimbarea stării', () => {
    expect(formularGol(AZI)).toMatchObject({ stare: 'emis', moneda: 'RON', data_emitere: AZI, restituit_la: '', document_path: null })
    const f = formularDinBO(bo({ serie: null, observatii: null, document_path: 'garantii/bo/7/a.pdf' }), AZI)
    expect(f).toMatchObject({ id: 1, serie: '', numar: '123', suma: 10000, data_emitere: '2026-09-01', data_scadenta: '2026-10-10', stare: 'emis', observatii: '', document_path: 'garantii/bo/7/a.pdf' })
    expect(laSchimbareStare(f, 'restituit', AZI)).toMatchObject({ stare: 'restituit', restituit_la: AZI })
    expect(laSchimbareStare({ ...f, restituit_la: '2026-09-30' }, 'restituit', AZI).restituit_la).toBe('2026-09-30')
    expect(laSchimbareStare({ ...f, stare: 'restituit', restituit_la: AZI }, 'emis', AZI)).toMatchObject({ stare: 'emis', restituit_la: '' })
    expect(Object.keys(STARI_BO)).toEqual(['emis', 'restituit', 'executat'])
    expect(STARI_BO.emis.culoare).toBe('yellow'); expect(STARI_BO.restituit.culoare).toBe('green'); expect(STARI_BO.executat.culoare).toBe('red')
  })
})

describe('rezumat pe garanție, scan, erori', () => {
  it('rezumatul numără total / emise / scadente / depășite per garanție, dintr-un singur set de rânduri', () => {
    const r = rezumatBOPeGarantie([
      bo({ id: 1, garantie_id: 7, data_scadenta: '2026-10-10' }),
      bo({ id: 2, garantie_id: 7, data_scadenta: '2026-09-30' }),
      bo({ id: 3, garantie_id: 7, data_scadenta: '2027-01-01' }),
      bo({ id: 4, garantie_id: 7, stare: 'restituit', data_scadenta: '2026-09-01' }),
      bo({ id: 5, garantie_id: 9, stare: 'executat' }),
    ], AZI)
    expect(r['7']).toEqual({ total: 4, emise: 3, scadente: 2, depasite: 1 })
    expect(r['9']).toEqual({ total: 1, emise: 0, scadente: 0, depasite: 0 })
    expect(r['8']).toBeUndefined()
    expect(rezumatBOPeGarantie(null)).toEqual({})
  })
  it('calea scanului și verificarea fișierului', () => {
    expect(caleScanBO(7, 'abc-123', 'scan.PDF')).toBe('garantii/bo/7/abc-123.pdf')
    expect(caleScanBO(7, 'abc-123')).toBe('garantii/bo/7/abc-123.pdf')
    expect(verificaScan(null)).toBeNull()
    expect(verificaScan({ name: 'bo.pdf', type: 'application/pdf', size: 1000 })).toBeNull()
    expect(verificaScan({ name: 'bo.PDF', type: '', size: 1000 })).toBeNull()
    expect(verificaScan({ name: 'bo.jpg', type: 'image/jpeg', size: 1000 })).toMatch(/PDF/)
    expect(verificaScan({ name: 'bo.pdf', type: 'application/pdf', size: 51 * 1024 * 1024 })).toMatch(/50 MB/)
  })
  it('mesajele de eroare BD', () => {
    expect(mesajEroareSalvare({ code: '23505', message: 'duplicate key value violates unique constraint "garantii_bo_serie_numar_uidx"' })).toMatch(/serie și număr/)
    expect(mesajEroareSalvare({ code: '42501', message: 'new row violates row-level security policy' })).toMatch(/drept de scriere/)
    expect(mesajEroareSalvare({ code: 'PGRST205', message: "Could not find the table 'public.garantii_bilete_ordin' in the schema cache" })).toMatch(/20261003a/)
    expect(mesajEroareSalvare({ message: 'altceva' })).toBe('altceva')
    expect(mesajEroareSalvare(null)).toBe('eroare necunoscută')
  })
})
