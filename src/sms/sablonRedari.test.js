// Șablonul SMS Redări (20261130c). Textele așteptate sunt scrise de mână (sursă independentă de cod); aceleași cazuri (P1–P15) sunt
// verificate pe oglinda SQL fn_sms_redari_sablon_calc în supabase/tests/20261130c_sms_redari_sablon_dryrun.sql (TEST2). Date fictive.
import { describe, expect, it } from 'vitest'
import { SABLON_REDARI, SABLON_REDARI_VERSIUNE, completeazaSablon, oraStart, telefonContact, ziSesiune, aziBucuresti, oraBucuresti } from './sablonRedari.js'

const AZI = '2026-11-10'
const ORA = '08:00'
const T = (comuna, zi, ora, tel) =>
  `Gazpet pt Transgaz: sesiune redare teren la Primaria ${comuna}, ${zi} ora ${ora}. Raspuns si online, cu QR-ul din scrisoare. Tel ${tel}`
const LUNG = 'Comuna Foarte Lunga De Test Fictiv Cu Nume Compus Din Multe Cuvinte'

// [cod, uat, proiect, așteptat: text | lipsuri | { prea_lung: text }, oraAcum (implicit 08:00)]
export const CAZURI = [
  ['P1', { nume: 'Prunișor', sesiune_zi1: '2026-11-12', program_zi1: '09:00 – 16:00' }, { contact_telefon: '0700 000 111' },
    T('Prunisor', '12.11', '09:00', '0700 000 111')],
  ['P2', { nume: 'Jupa', sesiune_zi1: '2026-11-05', program_zi1: '08:00-12:00', sesiune_zi2: '2026-11-12', program_zi2: '9.30 - 15:00' }, { contact_telefon: '0700000112' },
    T('Jupa', '12.11', '09:30', '0700000112')],
  ['P3', { nume: 'Test', sesiune_zi1: '2026-11-10', program_zi1: '10:00' }, { contact_telefon: '+40 700 000 113' },
    T('Test', '10.11', '10:00', '+40 700 000 113')],
  ['P4', { nume: 'Test', sesiune_zi1: '2026-11-01', program_zi1: '09:00', sesiune_zi2: '2026-11-02', program_zi2: '09:00' }, { contact_telefon: '0700000114' },
    ['zi_sesiune']],
  ['P5', { nume: 'Test', sesiune_zi1: '2026-11-12', program_zi1: null }, { contact_telefon: '0700000115' }, ['program_zi']],
  ['P6', { nume: 'Test', sesiune_zi1: '2026-11-12', program_zi1: '24:00 - 16:00' }, { contact_telefon: '0700000116' }, ['program_zi']],
  ['P7', { nume: 'Test', sesiune_zi1: '2026-11-12', program_zi1: '09:00' }, { contact_telefon: '' }, ['telefon_contact']],
  ['P8', { nume: 'Test', sesiune_zi1: '2026-11-12', program_zi1: '09:00' }, { contact_telefon: 'Ion Test' }, ['telefon_contact']],
  ['P9', { nume: '  ', sesiune_zi1: null }, { contact_telefon: null }, ['uat_nume', 'zi_sesiune', 'telefon_contact']],
  ['P10', { nume: LUNG, sesiune_zi1: '2026-11-12', program_zi1: '09:00' }, { contact_telefon: '0700 000 120' },
    { prea_lung: T(LUNG, '12.11', '09:00', '0700 000 120') }],
  ['P11', { nume: 'Test', sesiune_zi1: '2026-11-12', program_zi1: '  9:05 – 12:00' }, { contact_telefon: '0700000121' },
    T('Test', '12.11', '09:05', '0700000121')],
  ['P12', { nume: 'Test', sesiune_zi1: '2026-11-12', program_zi1: '9 - 16' }, { contact_telefon: '0700000122' }, ['program_zi']],
  // r2 (P2): sesiunea de azi deja începută (10:00 la 10:00) → ziua următoare; încă neîncepută (10:00 la 09:59) → azi; azi fără oră → lipsă
  ['P13', { nume: 'Test', sesiune_zi1: '2026-11-10', program_zi1: '10:00 - 16:00', sesiune_zi2: '2026-11-11', program_zi2: '08:30' }, { contact_telefon: '0700000123' },
    T('Test', '11.11', '08:30', '0700000123'), '10:00'],
  ['P14', { nume: 'Test', sesiune_zi1: '2026-11-10', program_zi1: '10:00 - 16:00', sesiune_zi2: '2026-11-11', program_zi2: '08:30' }, { contact_telefon: '0700000124' },
    T('Test', '10.11', '10:00', '0700000124'), '09:59'],
  ['P15', { nume: 'Test', sesiune_zi1: '2026-11-10', program_zi1: null, sesiune_zi2: '2026-11-11', program_zi2: '08:30' }, { contact_telefon: '0700000125' },
    ['program_zi'], '23:00'],
]

describe('șablonul SMS Redări — completarea', () => {
  it('versiunea textului: provizoriu, aceeași ca fn_sms_redari_sablon_versiune() din DRY (TEST23)', () => {
    expect(SABLON_REDARI_VERSIUNE).toBe('provizoriu-2026-11-03')
  })
  it('constanta unică (textul provizoriu, înaintea formulării Juridicului)', () => {
    expect(SABLON_REDARI).toBe('Gazpet pt Transgaz: sesiune redare teren la Primaria {COMUNA}, {ZI} ora {ORA}. Raspuns si online, cu QR-ul din scrisoare. Tel {TEL}')
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
