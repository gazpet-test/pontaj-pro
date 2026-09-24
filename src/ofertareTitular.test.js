import { describe, it, expect } from 'vitest'
import { titularVizat, ordoneazaPeTitular } from './ofertareTitular.js'

// Texte reale, licitația 100 (Ulmeni)
describe('titularVizat', () => {
  it('EDSB cerută ofertantului → firma (#16, #37, #38)', () => {
    expect(titularVizat('Autorizație tip EDSB (sau echivalent) ANRE pentru execuția sistemelor de distribuție gaze naturale, valabilă la data deschiderii ofertelor.')).toBe('operator_economic')
    expect(titularVizat('Deținerea Autorizației ANRE de tip EDSB pentru sisteme de distribuție gaze naturale, conform Ordinului ANRE nr. 132/2021.')).toBe('operator_economic')
    expect(titularVizat('Ofertantul trebuie sa detina Autorizatie ANRE de tip EDSB, valabila la momentul prezentarii.')).toBe('operator_economic')
  })
  it('autorizare ANRE a șefului de șantier → persoana (#149, #211, #420)', () => {
    expect(titularVizat('E2 Șef de Șantier: studii tehnice și Autorizație ANRE tip EDSB/EGD valabilă (Execuție Distribuție Gaze).')).toBe('persoana_fizica')
    expect(titularVizat('Șef de Șantier: studii tehnice și Autorizație ANRE tip EDSB/EGD (execuție sisteme distribuție gaze naturale) în termen de valabilitate.')).toBe('persoana_fizica')
  })
  it('echipe de instalatori / sudori → persoana (#445)', () => {
    expect(titularVizat('Executantul va asigura echipe autorizate ANRE EGD/EDSB și aparate de sudură electrofuziune pentru branșamente și posturi PRM.')).toBe('persoana_fizica')
    expect(titularVizat('Minim 2 instalatori autorizați ANRE în domeniul EGD')).toBe('persoana_fizica')
  })
  it('ISO al ofertantului → firma', () => {
    expect(titularVizat('Ofertantul prezintă certificat ISO 9001 valabil')).toBe('operator_economic')
  })
  it('formulare negativă → nedeterminat (nu inventăm obligația)', () => {
    expect(titularVizat('Nu se solicită autorizație ANRE tip EDSB pentru acest lot.')).toBe(null)
    expect(titularVizat('Certificatul ISO 9001 nu este obligatoriu.')).toBe(null)
  })
  it('simplul cuvânt ANRE nu decide titularul', () => {
    expect(titularVizat('Lucrările se execută conform reglementărilor ANRE în vigoare.')).toBe(null)
  })
  it('asociat cu autorizație → tot operator economic', () => {
    expect(titularVizat('Fiecare asociat care execută lucrări de gaze trebuie să dețină autorizație ANRE tip EDSB.')).toBe('operator_economic')
  })
  it('fără indicii → null', () => {
    expect(titularVizat('Contractantul întocmește procesul verbal al ședinței de demarare')).toBe(null)
    expect(titularVizat('')).toBe(null)
    expect(titularVizat(null)).toBe(null)
  })
})

describe('ordoneazaPeTitular', () => {
  const c = [{ sursa: 'autorizatie', id: 1 }, { sursa: 'firma', id: 2 }, { sursa: 'partener', id: 3 }]
  it('firma → documentele firmei întâi', () => {
    expect(ordoneazaPeTitular(c, 'operator_economic').map(x => x.id)).toEqual([2, 3, 1])
  })
  it('altfel → ordinea neschimbată', () => {
    expect(ordoneazaPeTitular(c, 'persoana_fizica')).toBe(c)
    expect(ordoneazaPeTitular(c, null)).toBe(c)
  })
})
