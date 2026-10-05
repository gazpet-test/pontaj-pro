import { describe, it, expect } from 'vitest'
import {
  normalizeaza, potrivesteCautare, fmtData, nrExact, paginaDinLoc, stareJudiciara, eAtacata, referintaScurta, formatCitare,
  filtreazaDecizii, ordoneazaDecizii, filtreazaCerinte, filtreazaTipare, indexDecizii, deciziiPentruTipar, tiparePentruDecizie, valoriDistincte,
  ataseazaImpact,
} from './ofertareBiblioteca.js'

// Forme reale din cnsc_decizii (05.10.2026): 69 cu număr exact, restul anonimizate în BO; loc „p. N (din N)” sau descriptiv
const EXACTA = { id: 'CNSC-BO2024_3657', source_id: 'SRC-CNSC-BO2024_3657', nr_decizie: '3657/C1/4067,4182', data: '2024-12-23', an: 2024,
  buletin_oficial: 'BO2024_3657', link_sursa: 'http://portal.cnsc.ro/x', verificat: true, domeniu: 'gaze', lege_aplicabila: 'L98',
  tema: ['experienta_similara'], sub_prag: false, control_judiciar: null, regula: 'Experiența similară se dovedește cu lucrări recepționate.' }
const ANONIMA = { id: 'CNSC-BO2022_2473', source_id: 'SRC-CNSC-BO2022_2473', nr_decizie: '(anonimizat în BO)', data: null, an: 2022,
  buletin_oficial: 'BO2022_2473', link_sursa: 'http://portal.cnsc.ro/y', verificat: true, domeniu: 'apa_canal', lege_aplicabila: 'L98',
  tema: ['dtac_proiectare'], sub_prag: true, control_judiciar: { gasit: false, rezultat: 'necunoscut' }, problema: 'Proiectarea în contract de execuție' }
const DESFIINTATA = { id: 'CNSC-BO2026_1073', source_id: 'SRC-CNSC-BO2026_1073', nr_decizie: '1073/C9/5092,165,181 (dosare conexate)', data: '2026-04-03', an: 2026,
  buletin_oficial: 'BO2026_1073', link_sursa: 'http://portal.cnsc.ro/z', verificat: true, domeniu: 'gaze', lege_aplicabila: 'L99', tema: ['clarificari_oferta'],
  sub_prag: null, control_judiciar: { gasit: true, rezultat: 'desfiintata', instanta: 'Curtea de Apel Cluj', nr_hotarare: 'Hotărârea nr. 826/2026' } }

describe('normalizare și căutare', () => {
  it('fără diacritice, ambele forme de ș/ț (virgulă și sedilă), fără majuscule', () => {
    expect(normalizeaza('Ștampilă ŞI ţeavă în Țară')).toBe('stampila si teava in tara')
    expect(potrivesteCautare(['Execuția lucrărilor'], 'executia')).toBe(true)
  })
  it('toate cuvintele trebuie să apară; căutarea goală trece', () => {
    expect(potrivesteCautare(['proiectare și execuție', 'avize'], 'proiectare avize')).toBe(true)
    expect(potrivesteCautare(['proiectare și execuție'], 'proiectare avize')).toBe(false)
    expect(potrivesteCautare(['x'], '  ')).toBe(true)
    expect(potrivesteCautare([null, undefined, 'abc'], 'abc')).toBe(true)
  })
  it('fmtData', () => { expect(fmtData('2024-12-23')).toBe('23.12.2024'); expect(fmtData(null)).toBeNull(); expect(fmtData('nu')).toBeNull() })
})

describe('nrExact / paginaDinLoc', () => {
  it('numărul exact doar pentru forma N/CN/N(…); anonimizatele → null', () => {
    expect(nrExact('3657/C1/4067,4182')).toBe('3657/C1/4067,4182')
    expect(nrExact('1073/C9/5092,165,181 (dosare conexate)')).toBe('1073/C9/5092,165,181')
    expect(nrExact('123/C2/456/789')).toBe('123/C2/456/789')
    expect(nrExact('12/C4/1, 2, 3')).toBe('12/C4/1, 2, 3')
    expect(nrExact('1237/2026 (BO, nr. complet anonimizat)')).toBeNull()
    expect(nrExact('BO2026_1149 (nr./data anonimizate în BO)')).toBeNull()
    expect(nrExact('(anonimizat în BO)')).toBeNull()
    expect(nrExact('12/C?/...')).toBeNull()
    expect(nrExact(null)).toBeNull()
  })
  it('pagina din „p. N (din N)”, intervalul păstrat; locurile descriptive → null', () => {
    expect(paginaDinLoc('p. 13 (din 19)')).toBe('13')
    expect(paginaDinLoc('p. 13-14 (din 19)')).toBe('13-14')
    expect(paginaDinLoc('p. 7 (din 9) — citat FDA')).toBe('7')
    expect(paginaDinLoc('analiza cash-flow')).toBeNull()
    expect(paginaDinLoc('concluzie')).toBeNull()
    expect(paginaDinLoc('analiza criticii V.4/VI.2')).toBeNull()
    expect(paginaDinLoc(null)).toBeNull()
  })
})

describe('control judiciar', () => {
  it('menținută / modificată / desființată; restul necunoscut', () => {
    expect(stareJudiciara({ rezultat: 'mentinuta' })).toBe('mentinuta')
    expect(stareJudiciara({ rezultat: 'desfiintata' })).toBe('desfiintata')
    expect(stareJudiciara({ rezultat: 'necunoscut', gasit: false })).toBe('necunoscut')
    expect(stareJudiciara(null)).toBe('necunoscut')
    expect(eAtacata(DESFIINTATA.control_judiciar)).toBe(true)
    expect(eAtacata({ rezultat: 'mentinuta' })).toBe(false)
  })
})

describe('formatCitare (§4: un singur format; fără pagină sau link nu se exportă)', () => {
  const citat = { text: 'Ofertantul trebuie să facă dovada…', loc: 'p. 28 (din 32)' }
  it('număr exact + dată → „Decizia CNSC nr. … din …, p. … — link” + citatul + „practică de interpretare, nu normă”', () => {
    const r = formatCitare(EXACTA, citat)
    expect(r.ok).toBe(true)
    expect(r.citare).toBe('Decizia CNSC nr. 3657/C1/4067,4182 din 23.12.2024, p. 28 — http://portal.cnsc.ro/x')
    expect(r.text.split('\n')).toEqual(['„Ofertantul trebuie să facă dovada…”', r.citare, '(practică de interpretare, nu normă)'])
  })
  it('anonimizată → forma cu BO', () => {
    expect(formatCitare(ANONIMA, { text: 'x', loc: 'p. 19 (din 22)' }).citare)
      .toBe('Decizia CNSC publicată în BO nr. BO2022_2473 (nr./data anonimizate), p. 19 — http://portal.cnsc.ro/y')
  })
  it('număr exact fără dată → tot forma cu BO (nu se inventează data)', () => {
    expect(formatCitare({ ...EXACTA, data: null }, citat).citare).toMatch(/^Decizia CNSC publicată în BO nr\. BO2024_3657/)
  })
  it('fără pagină, fără link, fără text, neverificată (inclusiv NULL) sau fără nr+dată și fără BO → dezactivat', () => {
    expect(formatCitare(EXACTA, { text: 'x', loc: 'analiza cash-flow' })).toEqual({ ok: false, motiv: 'nu se exportă fără pagină și link' })
    expect(formatCitare(EXACTA, { text: 'x', loc: null }).ok).toBe(false)
    expect(formatCitare({ ...EXACTA, link_sursa: '' }, citat).motiv).toBe('nu se exportă fără pagină și link')
    expect(formatCitare({ ...EXACTA, link_sursa: 'javascript:alert(1)' }, citat).ok).toBe(false)
    expect(formatCitare({ ...EXACTA, link_sursa: 'Portal instanțe — dosar 493/33/2026' }, citat).ok).toBe(false)
    expect(formatCitare(EXACTA, { text: '  ', loc: 'p. 2' }).motiv).toBe('citat fără text')
    expect(formatCitare({ ...EXACTA, verificat: false }, citat).motiv).toBe('decizie neverificată pe sursă — nu se exportă')
    expect(formatCitare({ ...EXACTA, verificat: null }, citat).ok).toBe(false)
    expect(formatCitare({ ...ANONIMA, buletin_oficial: null }, { text: 'x', loc: 'p. 1' }).ok).toBe(false)
  })
  it('decizie desființată în instanță → avertismentul intră și în textul copiat', () => {
    const r = formatCitare(DESFIINTATA, { text: 'x', loc: 'p. 5 (din 7)' })
    expect(r.citare).toBe('Decizia CNSC nr. 1073/C9/5092,165,181 din 03.04.2026, p. 5 — http://portal.cnsc.ro/z')
    expect(r.text).toMatch(/⚠️ Decizie desființată în control judiciar — Curtea de Apel Cluj, Hotărârea nr\. 826\/2026\./)
  })
  it('referința scurtă din liste', () => {
    expect(referintaScurta(EXACTA)).toBe('nr. 3657/C1/4067,4182 · 23.12.2024')
    expect(referintaScurta(ANONIMA)).toBe('BO2022_2473 (nr./data anonimizate)')
  })
})

describe('filtre și ordonare', () => {
  const toate = [EXACTA, ANONIMA, DESFIINTATA, { ...ANONIMA, id: 'N1', verificat: false, sub_prag: null }]
  it('decizii: domeniu, temă, lege, an, verificat, control judiciar, sub prag, căutare', () => {
    expect(filtreazaDecizii(toate, { domeniu: 'gaze' }).map(d => d.id)).toEqual(['CNSC-BO2024_3657', 'CNSC-BO2026_1073'])
    expect(filtreazaDecizii(toate, { tema: 'dtac_proiectare' }).length).toBe(2)
    expect(filtreazaDecizii(toate, { lege: 'L99' }).map(d => d.id)).toEqual(['CNSC-BO2026_1073'])
    expect(filtreazaDecizii(toate, { an: '2022' }).length).toBe(2)
    expect(filtreazaDecizii(toate, { verificat: 'nu' }).map(d => d.id)).toEqual(['N1'])
    expect(filtreazaDecizii(toate, { cj: 'desfiintata' }).map(d => d.id)).toEqual(['CNSC-BO2026_1073'])
    expect(filtreazaDecizii(toate, { cj: 'necunoscut' }).length).toBe(3)
    expect(filtreazaDecizii(toate, { subPrag: 'da' }).map(d => d.id)).toEqual(['CNSC-BO2022_2473'])
    expect(filtreazaDecizii(toate, { subPrag: 'necunoscut' }).map(d => d.id)).toEqual(['CNSC-BO2026_1073', 'N1'])
    expect(filtreazaDecizii(toate, { q: 'proiectarea executie' }).length).toBe(2)
    expect(filtreazaDecizii(toate, { q: '3657' }).map(d => d.id)).toEqual(['CNSC-BO2024_3657'])
  })
  it('ordonare: anul cel mai nou, apoi data; fără dată după cele datate din același an', () => {
    expect(ordoneazaDecizii([ANONIMA, EXACTA, DESFIINTATA, { id: 'Z', an: 2026, data: null }]).map(d => d.id))
      .toEqual(['CNSC-BO2026_1073', 'Z', 'CNSC-BO2024_3657', 'CNSC-BO2022_2473'])
  })
  it('cerințe: implicit doar verificate pe sursă; comutatorul le arată pe toate', () => {
    const c = [{ requirement_id: 'REQ-1', cerinta: 'Solicitare de clarificare prin SEAP', verificat_pe_sursa: true, domeniu: 'achizitii' },
      { requirement_id: 'REQ-2', cerinta: 'Probă de presiune', verificat_pe_sursa: false, domeniu: 'gaze' }]
    expect(filtreazaCerinte(c, {}).map(x => x.requirement_id)).toEqual(['REQ-1'])
    expect(filtreazaCerinte(c, { doarVerificate: false }).length).toBe(2)
    expect(filtreazaCerinte(c, { doarVerificate: false, q: 'presiune' }).map(x => x.requirement_id)).toEqual(['REQ-2'])
  })
  it('tipare: căutarea „proiectare” găsește întrebarea propusă; review juridic', () => {
    const t = [{ pattern_id: 'PAT-GAZ-14', titlu: 'Contract doar de execuție', intrebare_propusa: '… componenta de proiectare …', requires_human_legal_review: false, precedente_cnsc: ['SRC-CNSC-BO2022_2473', 'SRC-CNSC-BO2026_1149'] },
      { pattern_id: 'PAT-CAL-01', titlu: 'Autorizare ANRE', intrebare_propusa: 'Ordinul ANRE', requires_human_legal_review: true, precedente_cnsc: [] }]
    expect(filtreazaTipare(t, { q: 'proiectare' }).map(x => x.pattern_id)).toEqual(['PAT-GAZ-14'])
    expect(filtreazaTipare(t, { review: 'da' }).map(x => x.pattern_id)).toEqual(['PAT-CAL-01'])
    const idx = indexDecizii([ANONIMA, EXACTA])
    expect(deciziiPentruTipar(t[0], idx).map(x => [x.ref, x.decizie?.id ?? null])).toEqual([['SRC-CNSC-BO2022_2473', 'CNSC-BO2022_2473'], ['SRC-CNSC-BO2026_1149', null]])
    expect(tiparePentruDecizie(ANONIMA, t).map(x => x.pattern_id)).toEqual(['PAT-GAZ-14'])
    expect(tiparePentruDecizie({ id: 'CNSC-BO2022_2473' }, t).length).toBe(0)
    expect(tiparePentruDecizie({ id: 'SRC-CNSC-BO2026_1149' }, t).length).toBe(1)
  })
  it('valoriDistincte: din liste și scalari, sortate, fără goluri', () => {
    expect(valoriDistincte([{ tema: ['b', 'a'] }, { tema: ['a', null] }, { tema: null }], d => d.tema)).toEqual(['a', 'b'])
    expect(valoriDistincte([{ an: 2024 }, { an: 2020 }, { an: '' }], d => d.an)).toEqual(['2020', '2024'])
  })
})

describe('ataseazaImpact (impact_intern owner-only pe server, 20261015a)', () => {
  const T = [{ pattern_id: 'PAT-1', titlu: 'a' }, { pattern_id: 'PAT-2', titlu: 'b' }]
  it('lipește impactul după pattern_id, fără să atingă restul și fără să modifice intrarea', () => {
    const r = ataseazaImpact(T, [{ pattern_id: 'PAT-2', impact_intern: { cost: 'mare' } }, { pattern_id: 'PAT-X', impact_intern: { cost: 'mic' } }])
    expect(r).toEqual([{ pattern_id: 'PAT-1', titlu: 'a' }, { pattern_id: 'PAT-2', titlu: 'b', impact_intern: { cost: 'mare' } }])
    expect(T[1].impact_intern).toBeUndefined()
  })
  it('non-owner / eroare (listă goală sau null) → tiparele rămân fără impact', () => {
    expect(ataseazaImpact(T, [])).toEqual(T)
    expect(ataseazaImpact(T, null)).toEqual(T)
    expect(ataseazaImpact(null, [{ pattern_id: 'PAT-1', impact_intern: {} }])).toEqual([])
    expect(ataseazaImpact(T, [{ pattern_id: 'PAT-1', impact_intern: null }, { impact_intern: { x: 1 } }])).toEqual(T)
  })
})
