// Teste pentru motivul verdictului contrar (runda 3 a PR #1127, verdict P2-4): câmp DISTINCT pe ecran, inclus apoi în observații, fără
// schemă nouă (uscarePasi.js: textTrecere, motivDinObservatii, cuMotivVerdict, formularTerminaEtapa2 cu motiv). Separat de uscarePasi.test.js
// ca acela să poată rula și pe sursele dinaintea rundei (funcțiile de aici nu existau). Valorile așteptate sunt scrise de mână (L25).
import { describe, it, expect } from 'vitest'
import { textTrecere, motivDinObservatii, cuMotivVerdict, formularTerminaEtapa2, PREFIX_MOTIV_VERDICT, areMotivVerdict } from './uscarePasi.js'

const AUTO = 'Trecerea 2 pe acest tronson (trecerea anterioară: raportul din 10.11.2026, ultimul piston nu a ieșit uscat).'
const PREFIX = 'Verdictul diferit de calcul, motivul:'

describe('motivul verdictului contrar (câmp distinct → observații)', () => {
  it('textul automat al trecerii e cel așteptat și NU contează ca motiv; nici textul liber al observațiilor (17.11.2026); doar ce stă sub etichetă', () => {
    expect(PREFIX_MOTIV_VERDICT).toBe(PREFIX)
    expect(textTrecere(2, '10.11.2026')).toBe(AUTO)
    expect(textTrecere(13, null)).toBe('Trecerea 13 pe acest tronson (trecerea anterioară: raportul din fără dată, ultimul piston nu a ieșit uscat).')
    expect(motivDinObservatii(AUTO)).toBe('')
    expect(motivDinObservatii(textTrecere(13, null))).toBe('')
    expect(motivDinObservatii(null)).toBe('')
    expect(motivDinObservatii('   ')).toBe('')
    expect(motivDinObservatii('buretele ud la exterior')).toBe('')                                  // observație liberă, fără etichetă: nu e motiv
    expect(motivDinObservatii('TEST automat 17.11.2026 noaptea — de ignorat')).toBe('')             // cazul din probă (B1_14)
    expect(motivDinObservatii(`${AUTO}\n${PREFIX} apă din primul burete`)).toBe('apă din primul burete')
    expect(motivDinObservatii(`${PREFIX} apă din primul burete`)).toBe('apă din primul burete')     // raport vechi cu eticheta: recunoscut
    expect(motivDinObservatii(`${PREFIX}   `)).toBe('')                                             // eticheta goală nu e motiv
    expect(motivDinObservatii(`${PREFIX} prima linie\na doua`)).toBe('prima linie\na doua')
    expect(motivDinObservatii(`x\n${PREFIX} a\n${PREFIX} b`)).toBe('a\nb')
    expect(motivDinObservatii(`${AUTO} ${AUTO}`)).toBe('')                                          // de două ori tot automat e
  })
  it('motivul intră în observații cu eticheta lui, sub ce era scris; gol = formularul neschimbat', () => {
    const f = { observatii: AUTO, alt: 1 }
    expect(cuMotivVerdict(f, '  ')).toBe(f)
    expect(cuMotivVerdict(f, null)).toBe(f)
    expect(cuMotivVerdict(f, ' apă din primul burete ')).toEqual({ observatii: `${AUTO}\n${PREFIX} apă din primul burete`, alt: 1 })
    expect(cuMotivVerdict({ observatii: '' }, 'x').observatii).toBe(`${PREFIX} x`)
    expect(cuMotivVerdict({}, 'x').observatii).toBe(`${PREFIX} x`)
  })
  it('„Termină etapa 2” pune motivul în observații (după ora, timpul și concluzia)', () => {
    const f = { ora_inceput: '2026-11-17T10:00', ora_final: '', dst: {}, timp_deplasare_min: '', piston_final_rezultat: 'uscat', concluzie: '', observatii: AUTO }
    const g = formularTerminaEtapa2(f, Date.UTC(2026, 10, 17, 9, 12), 'buretele ud')
    expect(g).toMatchObject({ ora_final: '2026-11-17T11:12', timp_deplasare_min: '72', concluzie: 'conform', observatii: `${AUTO}\n${PREFIX} buretele ud` })
    expect(formularTerminaEtapa2({ ...f, observatii: 'x' }, 0, '').observatii).toBe('x')
    expect(formularTerminaEtapa2({ ...f, observatii: 'x' }, 0).observatii).toBe('x')
  })
})

// P2 din review-ul final al PR #1127: după o salvare nereușită, formularul de pe ecran are deja motivul, iar câmpul distinct îl păstrează;
// reapăsarea „Termină etapa 2” NU trebuie să-l mai adauge o dată (aceeași etichetă + același text = o singură dată)
describe('motivul verdictului: adăugare idempotentă (reîncercări)', () => {
  it('aplicat de oricâte ori pe propriul rezultat, motivul apare o singură dată', () => {
    const f = { observatii: AUTO }
    const o1 = cuMotivVerdict(f, 'buretele ud')
    const o3 = cuMotivVerdict(cuMotivVerdict(o1, 'buretele ud'), ' buretele ud ')
    expect(o3.observatii).toBe(`${AUTO}\n${PREFIX} buretele ud`)
    expect(cuMotivVerdict(o1, 'buretele ud')).toBe(o1)                                               // neschimbat: nimic de adăugat
    const g1 = formularTerminaEtapa2({ ...f, piston_final_rezultat: 'umed' }, 0, 'buretele ud')
    expect(formularTerminaEtapa2(g1, 0, 'buretele ud').observatii).toBe(`${AUTO}\n${PREFIX} buretele ud`)
  })
  it('motiv pe mai multe linii și observații cu CRLF: tot o singură dată', () => {
    const o1 = cuMotivVerdict({ observatii: 'x' }, 'prima linie\na doua')
    expect(o1.observatii).toBe(`x\n${PREFIX} prima linie\na doua`)
    expect(cuMotivVerdict({ observatii: o1.observatii.replace(/\n/g, '\r\n') }, 'prima linie\na doua').observatii).toBe(o1.observatii.replace(/\n/g, '\r\n'))
  })
  it('alt text sau același text fără etichetă = motiv nou (se adaugă)', () => {
    expect(cuMotivVerdict({ observatii: `${PREFIX} buretele ud` }, 'buretele ud la exterior').observatii).toBe(`${PREFIX} buretele ud\n${PREFIX} buretele ud la exterior`)
    expect(cuMotivVerdict({ observatii: `${PREFIX} buretele ud la exterior` }, 'buretele ud').observatii).toBe(`${PREFIX} buretele ud la exterior\n${PREFIX} buretele ud`)
    expect(cuMotivVerdict({ observatii: 'buretele ud' }, 'buretele ud').observatii).toBe(`buretele ud\n${PREFIX} buretele ud`)
  })
  it('areMotivVerdict: rând întreg, cu etichetă; motiv gol = false', () => {
    expect(areMotivVerdict(`${AUTO}\n${PREFIX} buretele ud`, ' buretele ud ')).toBe(true)
    expect(areMotivVerdict(`${PREFIX} buretele ud la exterior`, 'buretele ud')).toBe(false)
    expect(areMotivVerdict('buretele ud', 'buretele ud')).toBe(false)
    expect(areMotivVerdict(`${PREFIX} x`, '  ')).toBe(false)
    expect(areMotivVerdict(null, 'x')).toBe(false)
  })
})
