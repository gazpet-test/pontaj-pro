import { describe, it, expect } from 'vitest'
import { idDecizieDinPrecedent, esteExclusa, domeniuLicitatie, legeLicitatie, avertismente, propuneriDinTipar, paginaDinLoc, formatCitare, frazeDinSemnal, contineFraza, tipareDeclansate, etichetaDecizie } from './ofertareTemeiuri.js'

// Date reale din corpus (05.10.2026): PAT-GAZ-14 și decizia anonimizată BO2022_2473
const D_BO = { id: 'CNSC-BO2022_2473', nr_decizie: 'BO2022_2473 (nr./data anonimizate în BO; contestația 2871/19.10.2022)', buletin_oficial: 'BO2022_2473', data: null, an: 2022, domeniu: 'gaze', lege_aplicabila: 'L98', verificat: true, control_judiciar: null,
  link_sursa: 'http://portal.cnsc.ro/sivadoc/download.aspx?docUID=x', citate_cheie: [{ loc: 'p. 19 (din 24)', text: 'se impunea includerea valorii acestei activități în valoarea estimată a contractului ce urmează a fi încheiat' }, { loc: 'p. 21 (din 24)', text: 'Autoritatea nu este abilitată să introducă cerințe care nu îi servesc la nimic' }] }
const D_NR = { id: 'CNSC-2024-3657', nr_decizie: '3657/C1/4067,4182', buletin_oficial: null, data: '2024-12-23', an: 2024, domeniu: 'distributie', lege_aplicabila: 'L98', verificat: true, control_judiciar: { rezultat: 'mentinuta', instanta: 'CA București', nr_hotarare: '739/2026' }, link_sursa: 'http://portal.cnsc.ro/x', citate_cheie: [{ loc: 'p. 28', text: 'citat exact' }] }
const D_MOD = { id: 'CNSC-BO2026_1073', nr_decizie: '1073/C9/5092', data: '2026-04-03', an: 2026, domeniu: 'gaze', lege_aplicabila: 'L98', verificat: true, control_judiciar: { rezultat: 'modificata', instanta: 'Curtea de Apel Cluj', nr_hotarare: '826/2026' }, link_sursa: 'http://x', citate_cheie: [] }
const D_L99 = { id: 'CNSC-L99', nr_decizie: '10/C2/1', data: '2019-05-05', an: 2019, domeniu: 'gaze', lege_aplicabila: 'L99', verificat: true, control_judiciar: { rezultat: 'necunoscut' }, link_sursa: 'http://x', citate_cheie: [{ loc: 'pag. 3', text: 't' }] }
const D_NEV = { id: 'CNSC-NEV', nr_decizie: '1/1/1', data: '2025-01-01', an: 2025, domeniu: 'gaze', lege_aplicabila: 'L98', verificat: false, control_judiciar: null, link_sursa: 'http://x', citate_cheie: [] }
const MAP = new Map([D_BO, D_NR, D_MOD, D_L99, D_NEV].map(d => [d.id, d]))
const TIPAR = { pattern_id: 'PAT-GAZ-14', titlu: 'Contract doar de execuție, dar CS cere proiectare', confidence: 'medie', requires_human_legal_review: false,
  precedente_cnsc: ['SRC-CNSC-BO2022_2473', 'SRC-CNSC-2024-3657', 'SRC-CNSC-BO2026_1073', 'SRC-CNSC-L99', 'SRC-CNSC-NEV', 'SRC-CNSC-LIPSA'],
  trigger: { tip_detectie: 'cuvant_cheie', unde_cauti: ['caiet_sarcini', 'contract', 'F3'], semnal: 'CS/contract: „executantul va reactualiza proiectul tehnic”, „va elabora detaliile de execuție”, „va reobține avizele expirate”, fără articol în F3 | SAU: PT elaborat pe ATR/avize expirate' },
  intrebare_propusa: 'Obiectul contractului este execuția…' }
const LIC_GAZE_L98 = { segment: 'distributie', regim_achizitie: 'clasic' }
const AZI = new Date('2026-10-05T10:00:00Z')

describe('id-uri și clasificări', () => {
  it('precedentul SRC-CNSC-X → decizia CNSC-X', () => { expect(idDecizieDinPrecedent('SRC-CNSC-BO2022_2473')).toBe('CNSC-BO2022_2473'); expect(idDecizieDinPrecedent('CNSC-X')).toBe('CNSC-X') })
  it('excluse: modificată, desființată, neverificată; menținută/necunoscut/null nu', () => {
    expect(esteExclusa(D_MOD)).toBe(true); expect(esteExclusa(D_NEV)).toBe(true); expect(esteExclusa({ ...D_NR, control_judiciar: { rezultat: 'desfiintata' } })).toBe(true)
    expect(esteExclusa(D_NR)).toBe(false); expect(esteExclusa(D_BO)).toBe(false); expect(esteExclusa(D_L99)).toBe(false); expect(esteExclusa(null)).toBe(true)
    expect(esteExclusa({ ...D_NR, verificat: null })).toBe(true)   // Copilot r1: verificat NULL = neverificat, fail-closed
  })
  it('domeniul și legea licitației din segment / regim', () => {
    expect(domeniuLicitatie({ segment: 'transgaz' })).toBe('gaze'); expect(domeniuLicitatie({ segment: 'distributie' })).toBe('distributie'); expect(domeniuLicitatie({ segment: 'altele' })).toBeNull()
    expect(legeLicitatie({ regim_achizitie: 'sectorial' })).toBe('L99'); expect(legeLicitatie({ regim_achizitie: 'clasic' })).toBe('L98'); expect(legeLicitatie({})).toBeNull()
  })
  it('avertismente: vechime > 5 ani, L98≠L99, control judiciar necunoscut/neverificat', () => {
    expect(avertismente(D_L99, LIC_GAZE_L98, AZI)).toEqual([expect.stringMatching(/din 2019/), expect.stringMatching(/decizie pe L99, licitația e pe L98/), 'control judiciar necunoscut'])
    expect(avertismente(D_NR, LIC_GAZE_L98, AZI)).toEqual([])
    expect(avertismente(D_BO, LIC_GAZE_L98, AZI)).toEqual(['neverificată în instanță'])
  })
})

describe('propuneriDinTipar (treapta 1, deterministă)', () => {
  const r = propuneriDinTipar(TIPAR, MAP, LIC_GAZE_L98, AZI)
  it('ordonează: domeniu == licitație → lege → control judiciar → an desc; exclude modificată și neverificată; raportează id-urile lipsă', () => {
    expect(r.propuse.map(p => p.decizie.id)).toEqual(['CNSC-2024-3657', 'CNSC-BO2022_2473', 'CNSC-L99'])
    expect(r.excluse.map(e => [e.decizie.id, e.motiv])).toEqual([['CNSC-BO2026_1073', 'modificată în instanță'], ['CNSC-NEV', 'neverificată pe sursă']])
    expect(r.excluse[0].hotarare).toBe('826/2026')
    expect(r.lipsa).toEqual(['CNSC-LIPSA'])
  })
  it('fără licitație (domeniu/lege necunoscute) ordinea cade pe control judiciar și an', () => {
    const r2 = propuneriDinTipar(TIPAR, MAP, null, AZI)
    expect(r2.propuse.map(p => p.decizie.id)).toEqual(['CNSC-2024-3657', 'CNSC-BO2022_2473', 'CNSC-L99'])
  })
  it('licitație sectorială pe gaze: decizia L99 urcă peste cea L98 din același domeniu', () => {
    const r3 = propuneriDinTipar({ ...TIPAR, precedente_cnsc: ['SRC-CNSC-BO2022_2473', 'SRC-CNSC-L99'] }, MAP, { segment: 'transgaz', regim_achizitie: 'sectorial' }, AZI)
    expect(r3.propuse.map(p => p.decizie.id)).toEqual(['CNSC-L99', 'CNSC-BO2022_2473'])
  })
  it('tipar fără precedente → nimic', () => { expect(propuneriDinTipar({ precedente_cnsc: [] }, MAP, LIC_GAZE_L98, AZI)).toEqual({ propuse: [], excluse: [], lipsa: [] }) })
})

describe('formatCitare (formatul unic §4)', () => {
  it('decizie cu număr și dată', () => {
    expect(formatCitare(D_NR, D_NR.citate_cheie[0])).toEqual({ referinta: 'Decizia CNSC nr. 3657/C1/4067,4182 din 23.12.2024, p. 28 — http://portal.cnsc.ro/x', citat: 'citat exact', nota: 'practică de interpretare, nu normă' })
  })
  it('decizie anonimizată în BO', () => {
    expect(formatCitare(D_BO, D_BO.citate_cheie[1]).referinta).toBe('Decizia CNSC publicată în BO nr. BO2022_2473 (nr./data anonimizate), p. 21 — http://portal.cnsc.ro/sivadoc/download.aspx?docUID=x')
  })
  it('fără pagină sau fără link → null (nu se exportă)', () => {
    expect(formatCitare(D_NR, { loc: 'considerente', text: 'x' })).toBeNull()
    expect(formatCitare({ ...D_NR, link_sursa: null }, D_NR.citate_cheie[0])).toBeNull()
    expect(formatCitare(D_NR, null)).toBeNull()
    expect(paginaDinLoc('pag. 3')).toBe('p. 3'); expect(paginaDinLoc('p.19 (din 24)')).toBe('p. 19'); expect(paginaDinLoc('')).toBeNull()
    expect(paginaDinLoc('cap. 12')).toBeNull(); expect(paginaDinLoc('pagina 7')).toBe('p. 7'); expect(paginaDinLoc('considerente, p. 4')).toBe('p. 4')   // B5 Jakarinos
    expect(formatCitare(D_NR, { loc: 'p. 28', text: '   ' })).toBeNull()                                   // B12: citat gol → nimic
    expect(formatCitare(D_NR, { loc: 'p. 28', text: '  citat exact  ' }).citat).toBe('  citat exact  ')     // B12: textul înghețat nu se modifică
  })
  it('eticheta scurtă pentru chip-uri', () => { expect(etichetaDecizie(D_NR)).toBe('nr. 3657/C1/4067,4182 / 23.12.2024'); expect(etichetaDecizie(D_BO)).toBe('BO BO2022_2473') })
})

describe('tipareDeclansate (cuvinte-cheie, doar fraze între ghilimele, doar în documentele din unde_cauti)', () => {
  it('frazele din semnal sunt doar cele între ghilimele', () => {
    expect(frazeDinSemnal(TIPAR.trigger.semnal)).toEqual(['executantul va reactualiza proiectul tehnic', 'va elabora detaliile de execuție', 'va reobține avizele expirate'])
    expect(frazeDinSemnal('fără ghilimele deloc')).toEqual([])
  })
  it('PAT-GAZ-14 se declanșează pe caietul de sarcini (cu/fără diacritice), nu pe fișa de date; tiparele „judecata_umana” nu se declanșează', () => {
    const docs = [
      { id: 1, nume: 'CS.pdf', tip: 'cs_volum', text: 'Cap. 4: Executantul VA REACTUALIZA proiectul tehnic si va elabora detaliile de executie inainte de inceperea lucrarilor.' },
      { id: 2, nume: 'fisa.pdf', tip: 'fisa_date', text: 'executantul va reactualiza proiectul tehnic' },
      { id: 3, nume: 'F3.pdf', tip: 'lista_cantitati', text: 'nimic relevant' },
    ]
    const r = tipareDeclansate([TIPAR, { pattern_id: 'PAT-AMB-01', trigger: { tip_detectie: 'judecata_umana', semnal: '„executantul va reactualiza proiectul tehnic”', unde_cauti: ['caiet_sarcini'] } }], docs)
    expect(r).toHaveLength(1)
    expect(r[0].pattern_id).toBe('PAT-GAZ-14'); expect(r[0].nr_precedente).toBe(6)
    expect(r[0].potriviri).toEqual([{ doc_id: 1, doc: 'CS.pdf', fraza: 'executantul va reactualiza proiectul tehnic' }, { doc_id: 1, doc: 'CS.pdf', fraza: 'va elabora detaliile de execuție' }])
  })
  it('B8/B9 Jakarinos: un singur cuvânt nu e frază, potrivirea e pe limite de cuvânt, unde_cauti nemapat nu caută peste tot', () => {
    expect(frazeDinSemnal('„avizat” și „      ” și „aviz nou”')).toEqual([])
    expect(frazeDinSemnal('„va reobține avizele expirate”')).toEqual(['va reobține avizele expirate'])
    expect(contineFraza('document neavizat de proiectant', 'avizat')).toBe(false)
    expect(contineFraza('executantul va reactualiza  proiectul tehnic.', 'va reactualiza proiectul tehnic')).toBe(true)
    const t = { pattern_id: 'X', trigger: { tip_detectie: 'cuvant_cheie', semnal: '„proiectare si executie”', unde_cauti: ['necunoscut'] } }
    expect(tipareDeclansate([t], [{ id: 1, tip: 'cs_volum', text: 'proiectare si executie' }])).toEqual([])
  })
  it('fără text sau fără potrivire → listă goală', () => {
    expect(tipareDeclansate([TIPAR], [{ id: 1, tip: 'cs_volum', text: null }])).toEqual([])
    expect(tipareDeclansate([TIPAR], [{ id: 1, tip: 'cs_volum', text: 'contract de executie clasic' }])).toEqual([])
  })
})
