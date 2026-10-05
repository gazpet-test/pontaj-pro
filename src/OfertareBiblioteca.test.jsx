import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('./lib/supabase.js', () => ({ supabase: {} }))
import OfertareBiblioteca, { BibliotecaVedere } from './OfertareBiblioteca.jsx'

// Date de probă cu formele reale din corpus (05.10.2026)
const DATE = {
  owner: false,
  decizii: [
    { id: 'CNSC-BO2024_3657', source_id: 'SRC-CNSC-BO2024_3657', nr_decizie: '3657/C1/4067,4182', data: '2024-12-23', an: 2024, buletin_oficial: 'BO2024_3657',
      link_sursa: 'http://portal.cnsc.ro/x', verificat: true, domeniu: 'gaze', lege_aplicabila: 'L98', tema: ['experienta_similara'], sub_prag: false,
      regula: 'Regula interpretată', problema: 'Problema', solutie: 'Soluția', cum_ne_ajuta: 'Ne ajută', temei_legal: ['art. 160 L98'],
      comparabilitate: { de_ce_comparabila: 'rețea gaze', nota: 'nu e precedent obligatoriu' },
      citate_cheie: [{ text: 'Citat cu pagină', loc: 'p. 28 (din 32)' }, { text: 'Citat fără pagină', loc: 'analiza cash-flow' }], control_judiciar: null },
    { id: 'CNSC-BO2026_1073', source_id: 'SRC-CNSC-BO2026_1073', nr_decizie: 'BO2026_1073 (nr./data anonimizate în BO)', data: null, an: 2026, buletin_oficial: 'BO2026_1073',
      link_sursa: 'javascript:alert(1)', verificat: true, domeniu: 'gaze', lege_aplicabila: 'L99', tema: [], regula: 'Regula atacată',
      citate_cheie: [{ text: 'x', loc: 'p. 5 (din 7)' }],
      control_judiciar: { gasit: true, rezultat: 'desfiintata', instanta: 'Curtea de Apel Cluj', nr_hotarare: 'Hotărârea nr. 826/2026', nota: 'Motivarea nu e publică' } },
  ],
  cerinte: [{ requirement_id: 'REQ-AD-001', source_id: 'SRC-legea-98-2016', locator: 'art. 160 alin. (1)', cerinta: 'Clarificare prin SEAP', verificat_pe_sursa: true,
    evidenta_ceruta: ['Solicitare transmisă prin SEAP'], prag: { zile: 10 }, domeniu: 'achizitii', faza: 'ofertare' }],
  surse: [{ source_id: 'SRC-legea-98-2016', cod: 'Legea 98/2016', titlu: 'Legea achizițiilor publice', status: 'in_vigoare', url_oficial: 'https://legislatie.just.ro/x' }],
  tipare: [{ pattern_id: 'PAT-GAZ-14', titlu: 'Contract doar de execuție', tip_problema: 'ambiguu', confidence: 'medie', requires_human_legal_review: true,
    trigger: { semnal: 'executantul va reactualiza proiectul', unde_cauti: ['caiet_sarcini', 'F3'], tip_detectie: 'cuvant_cheie' },
    intrebare_propusa: 'Vă rugăm să precizați componenta de proiectare…', precedente_cnsc: ['SRC-CNSC-BO2024_3657', 'SRC-CNSC-BO2099_1'],
    normative_refs: ['REQ-AD-001', 'REQ-LIPSA'], impact_intern: { cost: 'mare' } }],
}
const html = props => renderToStaticMarkup(<BibliotecaVedere date={DATE} {...props} />)

describe('OfertareBiblioteca — randare', () => {
  it('fără date: starea de încărcare (fără rețea la randarea pe server)', () => {
    expect(renderToStaticMarkup(<OfertareBiblioteca />)).toContain('Se încarcă biblioteca juridică')
  })
  it('lista deciziilor: număr exact, BO anonimizat, desființata gri cu ⚠️ și hotărârea instanței', () => {
    const h = html()
    expect(h).toContain('Decizii CNSC (2)')
    expect(h).toContain('nr. 3657/C1/4067,4182 · 23.12.2024')
    expect(h).toContain('BO2026_1073 (nr./data anonimizate)')
    expect(h).toContain('⚠️ desființată în instanță — Curtea de Apel Cluj, Hotărârea nr. 826/2026')
    expect(h).toContain('Alege o decizie din listă.')
  })
  it('fișa deciziei: regula cu „interpretare AI — nu citat”, citarea copiabilă doar cu pagină, tiparul care o citează', () => {
    const h = html({ selInitial: { decizii: 'CNSC-BO2024_3657' } })
    expect(h).toContain('interpretare AI — nu citat')
    expect(h).toContain('title="Decizia CNSC nr. 3657/C1/4067,4182 din 23.12.2024, p. 28 — http://portal.cnsc.ro/x"')
    expect(h).toContain('nu se exportă fără pagină și link')
    expect(h.match(/disabled=""/g)?.length).toBe(1)
    expect(h).toContain('PAT-GAZ-14')
    expect(h).toContain('href="http://portal.cnsc.ro/x"')
  })
  it('fișa unei decizii cu link nesigur: fără href și fără citare exportabilă (doar http/https), control judiciar în roșu', () => {
    const h = html({ selInitial: { decizii: 'CNSC-BO2026_1073' } })
    expect(h).not.toContain('javascript:')
    expect(h).toContain('disabled=""')
    expect(h).toContain('Control judiciar: desființată ⚠️')
    expect(h).toContain('Motivarea nu e publică')
  })
  it('fișa cerinței: sursa cu link oficial, evidența, pragul', () => {
    const h = html({ tabInitial: 'cerinte', selInitial: { cerinte: 'REQ-AD-001' } })
    expect(h).toContain('Legea 98/2016')
    expect(h).toContain('href="https://legislatie.just.ro/x"')
    expect(h).toContain('• Solicitare transmisă prin SEAP')
    expect(h).toContain('&quot;zile&quot;: 10')
  })
  it('fișa tiparului: ciornă, precedente (lipsa marcată), cerințe; impact_intern ascuns pentru non-owner', () => {
    const h = html({ tabInitial: 'tipare', selInitial: { tipare: 'PAT-GAZ-14' } })
    expect(h).toContain('ciornă — se adaptează; nu intră automat în clarificări')
    expect(h).toContain('Copiază întrebarea')
    expect(h).toContain('SRC-CNSC-BO2099_1 — lipsește din corpus')
    expect(h).toContain('REQ-AD-001')
    expect(h).toContain('⚖️ cere review juridic uman')
    expect(h).not.toContain('Impact intern')
    expect(renderToStaticMarkup(<BibliotecaVedere date={{ ...DATE, owner: true }} tabInitial="tipare" selInitial={{ tipare: 'PAT-GAZ-14' }} />)).toContain('Impact intern (doar owner)')
  })
})
