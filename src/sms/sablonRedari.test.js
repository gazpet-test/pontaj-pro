// Șablonul SMS Redări (20261130c; textul cu „predare”: 20261226b). Cazurile P1–P15 (textele așteptate scrise de mână) stau în
// ./sablonRedari.cazuri.js — ACELAȘI tabel e verificat pe SQL-ul real fn_sms_redari_sablon_calc, după 20261226b, în
// scripts/pglite/test_sms_sablon_predare_local.mjs (paritatea JS <-> SQL, L19). Date fictive.
import { describe, expect, it } from 'vitest'
import { SABLON_REDARI, SABLON_REDARI_VERSIUNE, completeazaSablon, oraStart, telefonContact, ziSesiune, aziBucuresti, oraBucuresti } from './sablonRedari.js'
import { AZI, ORA, T, CAZURI } from './sablonRedari.cazuri.js'

describe('șablonul SMS Redări — completarea', () => {
  it('versiunea textului: provizoriu (neaprobat), aceeași ca fn_sms_redari_sablon_versiune() din 20261226b', () => {
    expect(SABLON_REDARI_VERSIUNE).toBe('provizoriu-2026-11-17')
    expect(SABLON_REDARI_VERSIUNE.startsWith('provizoriu')).toBe(true)
  })
  it('constanta unică (textul provizoriu cu „predare”, înaintea aprobării beneficiarului)', () => {
    expect(SABLON_REDARI).toBe('Gazpet pt Transgaz: sesiune predare teren la Primaria {COMUNA}, {ZI} ora {ORA}. Raspuns si online, cu QR-ul din scrisoare. Tel {TEL}')
  })
  it('un singur segment GSM-7 în aceleași condiții ca textul vechi: cel mai lung caz valid are cel mult 160, P10 rămâne prea lung', () => {
    const valide = CAZURI.filter(c => typeof c[3] === 'string').map(c => c[3].length)
    // numărat pe textul scris de mână al cazului: P1 („Prunisor”, „0700 000 111”) = 140 (cu „redare”: 139); P10 = 199 (era 198)
    expect(Math.max(...valide)).toBe(140)
    expect(Math.max(...valide)).toBeLessThanOrEqual(160)
  })
  for (const [cod, uat, proiect, astept, oraAcum = ORA] of CAZURI) {
    it(`${cod}`, () => {
      const r = completeazaSablon({ uat, proiect, azi: AZI, oraAcum })
      if (typeof astept === 'string') {
        expect(r).toMatchObject({ ok: true, text: astept, lungime: astept.length, lipsuri: [], motiv: null })
        expect(astept.length).toBeLessThanOrEqual(160)
      } else if (Array.isArray(astept)) {
        expect(r.ok).toBe(false)
        expect(r.text).toBeNull()
        expect(r.motiv).toBe('lipsuri')
        expect(r.lipsuri.map(l => l.cod)).toEqual(astept)
        for (const l of r.lipsuri) expect(l.mesaj).toMatch(/Setări (UAT|proiect)/)
      } else {
        expect(astept.prea_lung.length).toBeGreaterThan(160)
        expect(r).toMatchObject({ ok: false, motiv: 'prea_lung', text: astept.prea_lung, lungime: astept.prea_lung.length })
      }
    })
  }
  it('ziua 1 trecută → următoarea zi de sesiune viitoare; ziua de azi contează doar până la ora de început', () => {
    expect(ziSesiune({ sesiune_zi1: '2026-11-09', sesiune_zi2: '2026-11-11', sesiune_zi3: '2026-11-12' }, AZI)).toEqual({ nr: 2, zi: '2026-11-11', ora: null })
    expect(ziSesiune({ sesiune_zi1: '2026-11-10', program_zi1: '09:00' }, AZI, '08:59')).toEqual({ nr: 1, zi: '2026-11-10', ora: '09:00' })
    expect(ziSesiune({ sesiune_zi1: '2026-11-10', program_zi1: '09:00' }, AZI, '09:00')).toBeNull()
    expect(ziSesiune({ sesiune_zi1: '2026-11-10' }, AZI, '23:00')).toEqual({ nr: 1, zi: '2026-11-10', ora: null })
    expect(ziSesiune({ sesiune_zi1: '2026-11-09' }, AZI)).toBeNull()
  })
  it('lipsa programului spune ziua aleasă', () => {
    const r = completeazaSablon({ uat: { nume: 'Test', sesiune_zi1: '2026-11-01', sesiune_zi2: '2026-11-13' }, proiect: { contact_telefon: '0700000130' }, azi: AZI })
    expect(r.lipsuri).toEqual([{ cod: 'program_zi', mesaj: expect.stringContaining('ziua 2 (13.11)') }])
  })
  it('ora și telefonul: ancorate, fără potriviri parțiale', () => {
    expect(oraStart('09:00 – 16:00')).toBe('09:00')
    expect(oraStart('23:59')).toBe('23:59')
    expect(oraStart('program 09:00')).toBeNull()
    expect(oraStart('090:00')).toBeNull()
    expect(oraStart('09:000')).toBeNull()
    expect(telefonContact(' 0700 000 140 ')).toBe('0700 000 140')
    expect(telefonContact('12345')).toBeNull()
    expect(telefonContact('0700000140 int. 3')).toBeNull()
  })
  it('„$&” în numele UAT nu e tipar de înlocuire', () => {
    const r = completeazaSablon({ uat: { nume: 'A$&B', sesiune_zi1: '2026-11-12', program_zi1: '09:00' }, proiect: { contact_telefon: '0700000150' }, azi: AZI })
    expect(r.text).toBe(T('A$&B', '12.11', '09:00', '0700000150'))
  })
  it('azi la București, nu UTC (22:30 UTC pe 09.11 = 10.11 la București)', () => {
    expect(aziBucuresti(Date.UTC(2026, 10, 9, 22, 30))).toBe('2026-11-10')
    expect(aziBucuresti(Date.UTC(2026, 10, 9, 21, 30))).toBe('2026-11-09')
    expect(oraBucuresti(Date.UTC(2026, 10, 9, 22, 30))).toBe('00:30')
    expect(oraBucuresti(Date.UTC(2026, 6, 1, 6, 5))).toBe('09:05')
  })
})
