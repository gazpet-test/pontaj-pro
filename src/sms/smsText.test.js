// Regulile comune de text / telefon (supabase/functions/_shared/smsText.mjs). Cazurile de text și telefon sunt ACELEAȘI ca în DRY-ul SQL
// (supabase/tests/20261130a_sms_mvp_dryrun.sql, TEST3) — paritatea JS ↔ fn_sms_text_final / fn_sms_tel_normalizat. Numere doar fictive (0700…).
import { describe, expect, it } from 'vitest'
import {
  textFinal, lungimeGsm, segmente, nepermise, verificaText, costEstimat, normalizeazaTelefon, telefonNational, mascheazaTelefon,
  clasificaSmslink, egalTimpConstant, codSigur, MAX_GSM, TARIF_EUR, GSM_EXT, SMSLINK_COD_REINCERCABIL, oraBucuresti, inFereastraExterna,
} from '../../supabase/functions/_shared/smsText.mjs'

describe('textFinal (transliterare, ca fn_sms_text_final)', () => {
  const cazuri = [
    ['Ședință mâine la 7:00, țineți „aproape”!', "Sedinta maine la 7:00, tineti 'aproape'!"],
    ['Îți mulțumim — Gazpet', 'Iti multumim - Gazpet'],
    ['  doua   spatii\nrand nou\t ', 'doua spatii rand nou'],
    ['Așa… ok', 'Asa... ok'],
    ['ş ţ Ş Ţ ă Â î', 's t S T a A i'],
  ]
  it.each(cazuri)('%s', (intrare, asteptat) => expect(textFinal(intrare)).toBe(asteptat))
  it('ghilimele și apostrofuri tipografice → apostrof (11 caractere, poziție cu poziție)', () => {
    expect(textFinal('„”“«»"’‘‚`´')).toBe("'".repeat(11))
  })
  it('CR LF TAB NBSP → spațiu; null / undefined → gol', () => {
    expect(textFinal('a\r\nb\u00a0c')).toBe('a b c')
    expect(textFinal(null)).toBe('')
    expect(textFinal(undefined)).toBe('')
  })
  it('alte spații Unicode NU se taie (rămân de raportat ca nepermise, ca în SQL btrim)', () => {
    expect(textFinal('\u2009x')).toBe('\u2009x')
    expect(nepermise(textFinal('\u2009x'))).toEqual(['\u2009'])
  })
})

describe('lungime GSM-7, segmente, caractere nepermise', () => {
  it('extinsele ^ { } [ ~ ] | \\ € se numără dublu', () => {
    expect(lungimeGsm('Pret 5€ [lot]')).toBe(16)
    expect(Array.from(GSM_EXT).every(c => lungimeGsm(c) === 2)).toBe(true)
    expect(lungimeGsm('abc')).toBe(3)
  })
  it('segmente: 160 = 1, 161 = 2 (pas 152), 0 = 0', () => {
    expect(segmente(160)).toBe(1)
    expect(segmente(161)).toBe(2)
    expect(segmente(304)).toBe(2)
    expect(segmente(305)).toBe(3)
    expect(segmente(0)).toBe(0)
  })
  it('emoji și diacritice străine fără echivalent GSM sunt raportate', () => {
    expect(nepermise('Salut 😀')).toEqual(['😀'])
    expect(nepermise('Ł ok é ü')).toEqual(['Ł'])
  })
})

describe('verificaText (previzualizarea din UI)', () => {
  it('text corect: ok, 1 SMS, câte caractere mai rămân', () => {
    const v = verificaText('Ședință mâine')
    expect(v).toMatchObject({ ok: true, text: 'Sedinta maine', lungime: 13, segmente: 1, motiv: null, ramase: MAX_GSM - 13 })
  })
  it('gol / prea lung / caractere nepermise', () => {
    expect(verificaText('   ').motiv).toBe('gol')
    expect(verificaText('a'.repeat(161)).motiv).toBe('prea_lung')
    expect(verificaText('a'.repeat(159) + '€')).toMatchObject({ ok: false, motiv: 'prea_lung', lungime: 161 })
    expect(verificaText('a'.repeat(160)).ok).toBe(true)
    expect(verificaText('Salut 😀').motiv).toBe('caractere_nepermise')
  })
  it('diacriticele nu cresc lungimea (se transliterează înainte de numărare)', () => {
    expect(verificaText('ș'.repeat(160)).ok).toBe(true)
  })
})

describe('cost estimat', () => {
  it('0,049 EUR / SMS, rotunjit la 3 zecimale', () => {
    expect(TARIF_EUR).toBe(0.049)
    expect(costEstimat(94)).toBe(4.606)
    expect(costEstimat(1)).toBe(0.049)
    expect(costEstimat(0)).toBe(0)
    expect(costEstimat(10, 2)).toBe(0.98)
    expect(costEstimat('x')).toBe(0)
  })
})

describe('telefon (ca fn_sms_tel_normalizat)', () => {
  it.each(['0700 000 001', '+40 700-000-001', '0040700000001', '700000001', '(0700) 000.001', '40700000001'])('%s → +40700000001', t => {
    expect(normalizeazaTelefon(t)).toBe('+40700000001')
  })
  it.each(['0210000000', '07000', '+40800000000', '', '070000000012', '07OO000001', null, undefined])('invalid: %s', t => {
    expect(normalizeazaTelefon(t)).toBeNull()
  })
  it('național pentru SMSLink și mascare pentru ecran', () => {
    expect(telefonNational('+40700000001')).toBe('0700000001')
    expect(telefonNational('0700000001')).toBeNull()
    expect(mascheazaTelefon('0700 000 123')).toBe('07** *** 123')
    expect(mascheazaTelefon('021')).toBeNull()
  })
})

describe('clasificarea erorilor SMSLink', () => {
  it('permanent / config / credit; tranzitoriu = DOAR codul 16', () => {
    for (const c of [1, 9, 10, 11, 12, 13, 14, 15, 17]) expect(clasificaSmslink(c)).toBe('permanent')
    for (const c of [2, 3, 4, 5, 6, 7]) expect(clasificaSmslink(c)).toBe('config')
    expect(clasificaSmslink(8)).toBe('credit')
    expect(clasificaSmslink(16)).toBe('tranzitoriu')
    expect(SMSLINK_COD_REINCERCABIL).toBe(16)
    expect(clasificaSmslink('7')).toBe('config')
  })
  it('orice cod nou / nedocumentat = necunoscut (fără reîncercare: poate a plecat)', () => {
    for (const c of [0, 18, 99, 500, 'x', null]) expect(clasificaSmslink(c)).toBe('necunoscut')
  })
})

describe('fereastra externă 08–20 (ora României)', () => {
  it('iarna (UTC+2) și vara (UTC+3)', () => {
    expect(oraBucuresti(Date.parse('2026-11-03T06:00:00Z'))).toBe(8)
    expect(inFereastraExterna(Date.parse('2026-11-03T05:59:00Z'))).toBe(false)
    expect(inFereastraExterna(Date.parse('2026-11-03T06:00:00Z'))).toBe(true)
    expect(inFereastraExterna(Date.parse('2026-11-03T17:59:59Z'))).toBe(true)
    expect(inFereastraExterna(Date.parse('2026-11-03T18:00:00Z'))).toBe(false)
    expect(inFereastraExterna(Date.parse('2026-07-01T05:00:00Z'))).toBe(true)
    expect(inFereastraExterna(Date.parse('2026-07-01T17:00:00Z'))).toBe(false)
    expect(oraBucuresti(Date.parse('2026-11-03T22:30:00Z'))).toBe(0)
  })
})

describe('egalTimpConstant / codSigur', () => {
  it('egal doar pe identic; gol → false', () => {
    const s = 'a'.repeat(40)
    expect(egalTimpConstant(s, s)).toBe(true)
    expect(egalTimpConstant(s + 'b', s)).toBe(false)
    expect(egalTimpConstant('b' + s.slice(1), s)).toBe(false)
    expect(egalTimpConstant('', '')).toBe(false)
    expect(egalTimpConstant(null, s)).toBe(false)
  })
  it('codul salvat e doar [a-z0-9_] — textul unei erori (ex. cu parolă) nu trece nemodificat', () => {
    expect(codSigur('smslink_7')).toBe('smslink_7')
    expect(codSigur("Password 'x' is not approved!")).toMatch(/^[a-z0-9_]{1,40}$/)
    expect(codSigur('')).toBe('eroare')
  })
})
