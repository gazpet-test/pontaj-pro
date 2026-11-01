import { describe, it, expect } from 'vitest'
import { calculeazaStare, STARI, etichetaStare, culoareStare, ultimulRaspuns } from '../stare.js'

const conv = (extra = {}) => ({ stare: 'activ', canal: 'posta', data_expediere: '2026-11-10', ...extra })
const rasp = (optiune, data = '2026-11-20T10:00:00Z') => ({ optiune, data })
const pv = (tip, stare, extra = {}) => ({ tip, stare, sters_la: null, ...extra })
const baza = { calitate: 'proprietar', adresa_cunoscuta: true }

describe('STARI — lista ordonată', () => {
  it('are exact cele 12 stări din contract, în ordine', () => {
    expect(STARI.map(s => s.cod)).toEqual([
      'PV_A_SEMNAT', 'PV_B_CONSTATARE', 'PV_TRIMIS_SPRE_SEMNARE', 'OBIECTII_DE_TRATAT', 'A_RASPUNS_FARA_OBIECTII',
      'A_RASPUNS_PARTICIPA', 'CONVOCARE_RETURNATA', 'CONVOCAT_FARA_RASPUNS', 'EXPEDIAT_ASTEPTAM_AR',
      'NEIDENTIFICAT_AFISARE', 'FARA_ADRESA_AFISARE', 'DE_CONVOCAT',
    ])
    STARI.forEach((s, i) => {
      expect(s.ordine).toBe(i + 1)
      expect(s.eticheta).toBeTruthy()
      expect(s.culoare).toMatch(/^#[0-9a-f]{6}$/i)
    })
  })
  it('etichetaStare / culoareStare', () => {
    expect(etichetaStare('PV_A_SEMNAT')).toBe('PV A semnat')
    expect(etichetaStare('DE_CONVOCAT')).toBe('De convocat')
    expect(etichetaStare('INEXISTENT')).toBe('INEXISTENT')
    expect(culoareStare('OBIECTII_DE_TRATAT')).toBe('#dc2626')
    expect(culoareStare('DE_CONVOCAT')).toBe('#6b7280')
  })
})

describe('calculeazaStare — un caz minim per stare', () => {
  it('12 DE_CONVOCAT — nimic', () => {
    expect(calculeazaStare(baza)).toEqual({ stare: 'DE_CONVOCAT', ordine: 12 })
    expect(calculeazaStare()).toEqual({ stare: 'DE_CONVOCAT', ordine: 12 })
  })
  it('11 FARA_ADRESA_AFISARE — adresa_cunoscuta=false', () => {
    expect(calculeazaStare({ calitate: 'proprietar', adresa_cunoscuta: false })).toEqual({ stare: 'FARA_ADRESA_AFISARE', ordine: 11 })
  })
  it('10 NEIDENTIFICAT_AFISARE — calitate neidentificat (bate lipsa adresei)', () => {
    expect(calculeazaStare({ calitate: 'neidentificat', adresa_cunoscuta: false })).toEqual({ stare: 'NEIDENTIFICAT_AFISARE', ordine: 10 })
  })
  it('9 EXPEDIAT_ASTEPTAM_AR — convocare expediată, fără AR, fără retur', () => {
    expect(calculeazaStare({ ...baza, convocari: [conv()] })).toEqual({ stare: 'EXPEDIAT_ASTEPTAM_AR', ordine: 9 })
  })
  it('8 CONVOCAT_FARA_RASPUNS — AR primit, niciun răspuns', () => {
    expect(calculeazaStare({ ...baza, convocari: [conv({ data_confirmare_primire: '2026-11-14' })] })).toEqual({ stare: 'CONVOCAT_FARA_RASPUNS', ordine: 8 })
  })
  it('7 CONVOCARE_RETURNATA — retur fără confirmare ulterioară', () => {
    expect(calculeazaStare({ ...baza, convocari: [conv({ retur: 'mutat', retur_data: '2026-11-15' })] })).toEqual({ stare: 'CONVOCARE_RETURNATA', ordine: 7 })
  })
  it('6 A_RASPUNS_PARTICIPA', () => {
    expect(calculeazaStare({ ...baza, convocari: [conv()], raspunsuri: [rasp('particip')] })).toEqual({ stare: 'A_RASPUNS_PARTICIPA', ordine: 6 })
  })
  it('5 A_RASPUNS_FARA_OBIECTII', () => {
    expect(calculeazaStare({ ...baza, raspunsuri: [rasp('nu_particip_fara_obiectii')] })).toEqual({ stare: 'A_RASPUNS_FARA_OBIECTII', ordine: 5 })
  })
  it('4 OBIECTII_DE_TRATAT — nu_particip_cu_obiectii sau constatare_teren', () => {
    expect(calculeazaStare({ ...baza, raspunsuri: [rasp('nu_particip_cu_obiectii')] })).toEqual({ stare: 'OBIECTII_DE_TRATAT', ordine: 4 })
    expect(calculeazaStare({ ...baza, raspunsuri: [rasp('constatare_teren')] })).toEqual({ stare: 'OBIECTII_DE_TRATAT', ordine: 4 })
  })
  it('3 PV_TRIMIS_SPRE_SEMNARE', () => {
    expect(calculeazaStare({ ...baza, pvs: [pv('A', 'trimis_spre_semnare')] })).toEqual({ stare: 'PV_TRIMIS_SPRE_SEMNARE', ordine: 3 })
  })
  it('2 PV_B_CONSTATARE — PV B generat (stare ≠ anulat)', () => {
    expect(calculeazaStare({ ...baza, pvs: [pv('B', 'generat')] })).toEqual({ stare: 'PV_B_CONSTATARE', ordine: 2 })
  })
  it('1 PV_A_SEMNAT', () => {
    expect(calculeazaStare({ ...baza, pvs: [pv('A', 'semnat')] })).toEqual({ stare: 'PV_A_SEMNAT', ordine: 1 })
  })
})

describe('calculeazaStare — prioritate și reguli fine', () => {
  it('retur + răspuns ulterior → răspunsul câștigă', () => {
    const r = calculeazaStare({ ...baza, convocari: [conv({ retur: 'mutat', retur_data: '2026-11-15' })], raspunsuri: [rasp('particip', '2026-11-18T09:00:00Z')] })
    expect(r.stare).toBe('A_RASPUNS_PARTICIPA')
  })
  it('retur, apoi a doua convocare confirmată ulterior → nu mai e CONVOCARE_RETURNATA (e CONVOCAT_FARA_RASPUNS)', () => {
    const r = calculeazaStare({ ...baza, convocari: [
      conv({ nr_document: 'C-0001', retur: 'destinatar_necunoscut', retur_data: '2026-11-15' }),
      conv({ nr_document: 'C-0002', data_expediere: '2026-11-16', data_confirmare_primire: '2026-11-19' }),
    ] })
    expect(r.stare).toBe('CONVOCAT_FARA_RASPUNS')
  })
  it('P2-10: aceeași convocare cu retur ȘI AR primit ulterior returului = confirmată, nu returnată', () => {
    const r = calculeazaStare({ ...baza, convocari: [conv({ retur: 'avizat_neridicat', retur_data: '2026-11-15', data_confirmare_primire: '2026-11-18' })] })
    expect(r.stare).toBe('CONVOCAT_FARA_RASPUNS')
    // fără retur_data, referința e data_expediere
    const r2 = calculeazaStare({ ...baza, convocari: [conv({ data_expediere: '2026-11-10', retur: 'mutat', retur_data: null, data_confirmare_primire: '2026-11-12' })] })
    expect(r2.stare).toBe('CONVOCAT_FARA_RASPUNS')
    // AR înainte de retur → returul rămâne
    const r3 = calculeazaStare({ ...baza, convocari: [conv({ retur: 'refuz', retur_data: '2026-11-15', data_confirmare_primire: '2026-11-12' })] })
    expect(r3.stare).toBe('CONVOCARE_RETURNATA')
  })
  it('convocare confirmată ÎNAINTE de retur nu anulează returul', () => {
    const r = calculeazaStare({ ...baza, convocari: [
      conv({ data_expediere: '2026-10-01', data_confirmare_primire: '2026-10-05' }),
      conv({ data_expediere: '2026-11-10', retur: 'refuz', retur_data: '2026-11-15' }),
    ] })
    expect(r.stare).toBe('CONVOCARE_RETURNATA')
  })
  it('convocarea anulată nu contează (stare ≠ activ)', () => {
    expect(calculeazaStare({ ...baza, convocari: [conv({ stare: 'anulat', retur: 'mutat' })] }).stare).toBe('DE_CONVOCAT')
    expect(calculeazaStare({ ...baza, convocari: [conv({ stare: 'anulat' })] }).stare).toBe('DE_CONVOCAT')
  })
  it('ultimul răspuns după dată, nu după poziția în listă', () => {
    const r = calculeazaStare({ ...baza, raspunsuri: [rasp('nu_particip_cu_obiectii', '2026-11-25T10:00:00Z'), rasp('particip', '2026-11-20T10:00:00Z')] })
    expect(r.stare).toBe('OBIECTII_DE_TRATAT')
    const r2 = calculeazaStare({ ...baza, raspunsuri: [rasp('nu_particip_cu_obiectii', '2026-11-20T10:00:00Z'), rasp('nu_particip_fara_obiectii', '2026-11-25T10:00:00Z')] })
    expect(r2.stare).toBe('A_RASPUNS_FARA_OBIECTII')
  })
  it('răspunsuri fără dată: câștigă ultimul din listă', () => {
    expect(ultimulRaspuns([{ optiune: 'particip' }, { optiune: 'constatare_teren' }]).optiune).toBe('constatare_teren')
    expect(ultimulRaspuns([])).toBeNull()
    expect(ultimulRaspuns(null)).toBeNull()
  })
  it('PV B peste PV A trimis → PV_B_CONSTATARE', () => {
    expect(calculeazaStare({ ...baza, pvs: [pv('A', 'trimis_spre_semnare'), pv('B', 'generat')] }).stare).toBe('PV_B_CONSTATARE')
  })
  it('PV A semnat peste PV B → PV_A_SEMNAT', () => {
    expect(calculeazaStare({ ...baza, pvs: [pv('B', 'semnat'), pv('A', 'semnat')] }).stare).toBe('PV_A_SEMNAT')
  })
  it('PV anulat sau șters nu contează', () => {
    expect(calculeazaStare({ ...baza, pvs: [pv('A', 'anulat')] }).stare).toBe('DE_CONVOCAT')
    expect(calculeazaStare({ ...baza, pvs: [pv('B', 'anulat')] }).stare).toBe('DE_CONVOCAT')
    expect(calculeazaStare({ ...baza, pvs: [pv('A', 'semnat', { sters_la: '2026-11-30T00:00:00Z' })] }).stare).toBe('DE_CONVOCAT')
    expect(calculeazaStare({ ...baza, raspunsuri: [rasp('particip')], pvs: [pv('A', 'semnat', { sters_la: '2026-11-30T00:00:00Z' })] }).stare).toBe('A_RASPUNS_PARTICIPA')
  })
  it('PV A generat (nici trimis, nici semnat) nu schimbă starea — răspunsul rămâne', () => {
    expect(calculeazaStare({ ...baza, raspunsuri: [rasp('nu_particip_fara_obiectii')], pvs: [pv('A', 'generat')] }).stare).toBe('A_RASPUNS_FARA_OBIECTII')
  })
  it('obiecții + PV A semnat → PV_A_SEMNAT (obiecțiile nu mai sunt „de tratat”)', () => {
    expect(calculeazaStare({ ...baza, raspunsuri: [rasp('constatare_teren')], pvs: [pv('A', 'semnat')] }).stare).toBe('PV_A_SEMNAT')
  })
  it('neidentificat cu convocare prin afișare expediată → EXPEDIAT_ASTEPTAM_AR (convocarea bate afișarea)', () => {
    expect(calculeazaStare({ calitate: 'neidentificat', adresa_cunoscuta: false, convocari: [conv({ canal: 'afisare' })] }).stare).toBe('EXPEDIAT_ASTEPTAM_AR')
  })
  it('convocare activă fără data_expediere (doar generată) → DE_CONVOCAT', () => {
    expect(calculeazaStare({ ...baza, convocari: [conv({ data_expediere: null })] }).stare).toBe('DE_CONVOCAT')
  })
})
