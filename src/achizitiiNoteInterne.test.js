// TKT-2026-0361 — notițele interne pe comanda către furnizor: logica + dovada că NU intră în documente.
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'

// Achizitii.jsx aduce clientul Supabase și componente grele; pentru generatoarele HTML nu e nevoie de ele.
vi.mock('./lib/supabase.js', () => ({ supabase: {} }))
vi.mock('./ReceptieBucatiModal.jsx', () => ({ default: () => null }))
vi.mock('./CereriInterneProiect.jsx', () => ({ default: () => null }))
vi.mock('jspdf', () => ({ default: function () {} }))
vi.mock('html2canvas', () => ({ default: async () => null }))

import { NOTE_INTERNE_MAX, lipsaColoanaNote, stareNoteDinSonda, normalizeazaNota, validareNota, notaSchimbata } from './achizitiiNoteInterne.js'
import { buildComandaPdfHtml, buildCerereOfertaHtml, buildPvReceptieHtml, buildPvPredareHtml } from './Achizitii.jsx'
import { buildListaRepereHtml } from './achizitiiListaRepere.js'

// erorile reale PostgREST (forma din citesteOriceDubluri.test.js), pentru coloana noastră
const LIPSA_SELECT = { code: '42703', message: 'column comenzi_furnizor.note_interne does not exist', details: null, hint: null }
const LIPSA_UPDATE = { code: 'PGRST204', message: "Could not find the 'note_interne' column of 'comenzi_furnizor' in the schema cache", details: null, hint: null }

describe('detectarea migrării 20261215a', () => {
  it('coloana lipsă = doar 42703 / PGRST204 care numesc note_interne', () => {
    expect(lipsaColoanaNote(LIPSA_SELECT)).toBe(true)
    expect(lipsaColoanaNote(LIPSA_UPDATE)).toBe(true)
    expect(lipsaColoanaNote({ code: '42703', message: 'column comenzi_furnizor.alta does not exist' })).toBe(false)
    expect(lipsaColoanaNote({ code: '42501', message: 'permission denied for table comenzi_furnizor note_interne' })).toBe(false)
    expect(lipsaColoanaNote({ code: '42703', message: 'column comenzi_furnizor.note_interne_vechi does not exist' })).toBe(false)
    expect(lipsaColoanaNote(null)).toBe(false)
  })
  it('sonda: există / migrarea neaplicată / eroare de altă natură (L18: eroare ≠ lipsă)', () => {
    expect(stareNoteDinSonda({ data: [], error: null })).toBe('da')
    expect(stareNoteDinSonda({ data: [{ note_interne: null }], error: null })).toBe('da')
    expect(stareNoteDinSonda({ data: null, error: LIPSA_SELECT })).toBe('nu')
    expect(stareNoteDinSonda({ data: null, error: { code: '', message: 'Failed to fetch' } })).toBe('eroare')
    expect(stareNoteDinSonda(undefined)).toBe('eroare')
  })
})

describe('textul notiței', () => {
  it('normalizare: capete tăiate, gol = null', () => {
    expect(normalizeazaNota('  sunat furnizor 12.11  ')).toBe('sunat furnizor 12.11')
    expect(normalizeazaNota('   \n ')).toBe(null)
    expect(normalizeazaNota(null)).toBe(null)
  })
  it('limita de caractere (aceeași ca CHECK-ul din migrare)', () => {
    expect(validareNota('a'.repeat(NOTE_INTERNE_MAX))).toBe(null)
    expect(validareNota('a'.repeat(NOTE_INTERNE_MAX + 1))).toMatch(/maximum 4000/)
    expect(validareNota('')).toBe(null)
    const sql = readFileSync(new URL('../supabase/migrations/20261215a_achizitii_note_interne.sql', import.meta.url), 'utf8')
    expect(sql).toMatch(/length\(note_interne\) <= 4000/)
    expect(NOTE_INTERNE_MAX).toBe(4000)
  })
  it('schimbare doar dacă diferă după normalizare', () => {
    expect(notaSchimbata(' x ', 'x')).toBe(false)
    expect(notaSchimbata('', null)).toBe(false)
    expect(notaSchimbata('y', 'x')).toBe(true)
  })
})

describe('notița NU apare în documentele pentru furnizor / magazie', () => {
  const SECRET = 'NOTITA-INTERNA-7f3a: am negociat la telefon -5%'
  const c = {
    id: 1, numar_comanda: 'CF-TEST-1', status: 'emisa', moneda: 'RON', data_emitere: '2026-11-11',
    persoana_contact: 'Contact Test', telefon_contact: '0700000000', livrare_tip: 'sediu',
    observatii: 'Observație publică pentru furnizor', note_interne: SECRET,
    linii: [{ id: 10, denumire: 'Țeavă OL DN100', um: 'm', cantitate: 12, pret_unitar: 100, cantitate_primita: 12, observatii: 'STAS', display_order: 1 }],
    aprobari: [],
  }
  const ctx = { furnizorNume: 'Furnizor Test SRL', furnizorCui: 'RO1', contractNr: '', proiectNume: 'Proiect test', livrareTxt: 'Sediu', semnaturi: [] }
  const documente = {
    'PDF comandă': () => buildComandaPdfHtml(c, ctx),
    'PDF cerere de ofertă': () => buildCerereOfertaHtml(c, ctx, 'Solicitant Test'),
    'PV recepție': () => buildPvReceptieHtml(c, ctx),
    'PV predare magazie': () => buildPvPredareHtml(c, { ...ctx, pozaDataUrl: null }),
    'listă repere primite': () => buildListaRepereHtml(c, ctx, new Date('2026-11-11T10:00:00Z')),
  }
  for (const [nume, gen] of Object.entries(documente)) {
    it(nume, () => {
      const html = gen()
      expect(typeof html).toBe('string')
      expect(html.length).toBeGreaterThan(200)
      // controlul pozitiv: documentul chiar conține datele comenzii (altfel testul ar trece din gol)
      expect(html).toContain('CF-TEST-1')
      expect(html).not.toContain('NOTITA-INTERNA-7f3a')
      expect(html).not.toContain('negociat la telefon')
    })
  }
  it('controlul pozitiv: observațiile publice intră în comandă și în cererea de ofertă', () => {
    expect(buildComandaPdfHtml(c, ctx)).toContain('Observație publică pentru furnizor')
    expect(buildCerereOfertaHtml(c, ctx, 'Solicitant Test')).toContain('Observație publică pentru furnizor')
  })
  it('niciun mail sau funcție edge nu citește note_interne (modulul nu trimite mailuri; garda pe sursă)', () => {
    const src = readFileSync(new URL('./Achizitii.jsx', import.meta.url), 'utf8')
    expect(src).not.toMatch(/functions\.invoke/)
    // note_interne apare doar în sondă, în caseta de notițe și în salvarea ei — nu în generatoarele de documente
    const linii = src.split(/\r?\n/).filter(l => /note_interne/.test(l))
    for (const l of linii) expect(l).toMatch(/TKT-2026-0361|select\('note_interne'\)|comanda\.note_interne|note_interne:normalizeazaNota|note_interne \?\? null/)
  })
})
