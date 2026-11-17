// Teste pentru motivul verdictului contrar (runda 3 a PR #1127, verdict P2-4): câmp DISTINCT pe ecran, inclus apoi în observații, fără
// schemă nouă (uscarePasi.js: textTrecere, motivDinObservatii, cuMotivVerdict, formularTerminaEtapa2 cu motiv). Separat de uscarePasi.test.js
// ca acela să poată rula și pe sursele dinaintea rundei (funcțiile de aici nu existau). Valorile așteptate sunt scrise de mână (L25).
import { describe, it, expect } from 'vitest'
import { textTrecere, motivDinObservatii, cuMotivVerdict, formularTerminaEtapa2, PREFIX_MOTIV_VERDICT } from './uscarePasi.js'

const AUTO = 'Trecerea 2 pe acest tronson (trecerea anterioară: raportul din 10.11.2026, ultimul piston nu a ieșit uscat).'
const PREFIX = 'Verdictul diferit de calcul, motivul:'

describe('motivul verdictului contrar (câmp distinct → observații)', () => {
  it('textul automat al trecerii e cel așteptat și NU contează ca motiv; textul scris de om, da', () => {
    expect(PREFIX_MOTIV_VERDICT).toBe(PREFIX)
    expect(textTrecere(2, '10.11.2026')).toBe(AUTO)
    expect(textTrecere(13, null)).toBe('Trecerea 13 pe acest tronson (trecerea anterioară: raportul din fără dată, ultimul piston nu a ieșit uscat).')
    expect(motivDinObservatii(AUTO)).toBe('')
    expect(motivDinObservatii(textTrecere(13, null))).toBe('')
    expect(motivDinObservatii(null)).toBe('')
    expect(motivDinObservatii('   ')).toBe('')
    expect(motivDinObservatii('buretele ud la exterior')).toBe('buretele ud la exterior')
    expect(motivDinObservatii(`${AUTO}\n${PREFIX} apă din primul burete`)).toBe(`${PREFIX} apă din primul burete`)
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
