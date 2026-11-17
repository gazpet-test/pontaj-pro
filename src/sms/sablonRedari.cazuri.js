// Cazurile de paritate ale șablonului SMS Redări (P1–P15), UN singur tabel (L19): folosit de vitest (src/sms/sablonRedari.test.js, JS) și de
// proba PGlite a migrării 20261226b (scripts/pglite/test_sms_sablon_predare_local.mjs, SQL-ul real fn_sms_redari_sablon_calc). Textele așteptate
// sunt scrise de mână (sursă independentă de cod), cu „predare” (terminologia din 17.11.2026). Date fictive. Modul pur, fără vitest.
export const AZI = '2026-11-10'
export const ORA = '08:00'
export const T = (comuna, zi, ora, tel) =>
  `Gazpet pt Transgaz: sesiune predare teren la Primaria ${comuna}, ${zi} ora ${ora}. Raspuns si online, cu QR-ul din scrisoare. Tel ${tel}`
export const LUNG = 'Comuna Foarte Lunga De Test Fictiv Cu Nume Compus Din Multe Cuvinte'

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
