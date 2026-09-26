import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { clasaUnitate, inMetri } from './ofertareUnitati.js'
import { controlTotaluri, TOTAL_DIFERIT, TOTAL_NECOMPARABIL } from './ofertareTotaluri.js'
import { controlCantitatiGrafic, controlFronturiGrafic, fronturiDinCantitati, randuriLipsa } from './ofertareCantitatiAprobare.js'
import { stareBazaCiorna, deExportat } from './ofertareClarificariBaza.js'
import { controlCantitati } from './ofertareControale.js'

// Același set în docs/R5_TESTE_RUNDA9B.md și în testul SQL de paritate.
export const UNITATI = [null, '', ' ', 'm', ' M\u00a0', 'm.', 'metri', 'metru', 'ml', 'ml.', 'm.l.', 'm.l',
  'metri liniari', 'metru liniar', 'km', 'hm', 'mc', 'm cub', 'm3', 'm³', 'mp', 'm2', 'm²', 'ha', 'l', 'litri',
  'buc', 'bucata', 'bucati', 'bucăți', 'buc.', 'bc', 'kg', 't', 'to', 'h', 'ore', 'set', 'cpl', '100 m', 'sute m', 'xyz']
const sql = readFileSync(new URL('../docs/R5_MIGRARE_PROPUSA_cantitati_nevalidate.sql', import.meta.url), 'utf8')
const corp = nume => sql.split(`CREATE OR REPLACE FUNCTION public.${nume}(`)[1].split('END $function$;')[0]
const r = (id, cantitate, extra = {}) => ({ id, licitatie_id: 1, obiect: 'Lot A / etapa I', categorie: 'Conducte', sursa: 'Document #8',
  tip_sursa: 'lista_f3', denumire: 'Tronson A', status: 'validat', um: 'm', cantitate, ...extra })

describe('R9b — unități explicite', () => {
  it.each(UNITATI)('contract JS ↔ maparea SQL: %s', um => {
    // Verifică tabelul efectiv din SQL; executarea SQL/normalizarea PostgreSQL se verifică separat pe PGlite.
    const f = corp('ofertare_clasa_unitate').split('$function$;')[0]
    const reguli = [...f.matchAll(/WHEN u (?:IN \(([^)]+)\)|= '([^']+)') THEN jsonb_build_object\('tip','([^']+)'(?:,'factor',(\d+))?\)/g)]
    expect(reguli.length).toBe(4)
    const u = String(um ?? '').trim().toLowerCase()
    const gasita = reguli.find(x => (x[1] ? [...x[1].matchAll(/'([^']+)'/g)].map(m => m[1]) : [x[2]]).includes(u))
    expect(clasaUnitate(um)).toEqual(gasita ? { tip: gasita[3], ...(gasita[4] ? { factor: Number(gasita[4]) } : {}) } : { tip: 'de_verificat' })
  })
  it('hm și km se convertesc în fronturi; unitățile incerte blochează și după validare', () => {
    const rows = [r(1, 2, { um: 'hm' }), r(2, 0.8, { um: 'km' }), r(3, 40, { um: 'm.l' })]
    const f = fronturiDinCantitati(rows, '').fronturi
    expect(f.map(x => x.lungime_m)).toEqual([200, 800, 40])
    expect(controlFronturiGrafic({ fronturi: f }, rows).stare).toBe('ok')
    for (const um of [null, '100 m', 'xyz']) {
      const toate = [...rows, r(4, 7, { um })]
      expect(randuriLipsa(toate, '').lipsa).toContainEqual(expect.objectContaining({ id: 4, motiv: 'unitate de verificat' }))
      expect(controlCantitatiGrafic(toate, '').stare).toBe('block')
    }
    expect(inMetri(r(1, 8, { um: 'mc' }))).toBeNull()
  })
  it('o bază planșă lipsă nu este înlocuită tacit cu cantitatea financiară', () => {
    expect(fronturiDinCantitati([r(1, 100)], 'plansa').fronturi).toEqual([])
    expect(controlCantitatiGrafic([r(1, 100)], 'plansa').stare).toBe('block')
  })
})

describe('R9b — TOTAL versus detalii', () => {
  const rows = [r(1, 1200, { denumire: 'TOTAL' }), r(2, 1, { um: 'km' }), r(3, 2, { um: 'hm' })]
  it('același perimetru și bază: conversie fără adunarea TOTAL peste detalii', () => {
    expect(controlTotaluri(rows)[0]).toMatchObject({ declarat: 1200, suma_detalii: 1200, stare: 'ok' })
    expect(fronturiDinCantitati(rows, '').fronturi).toHaveLength(2)
  })
  it('diferența exactă rămâne vizibilă, ambele valori păstrate, fără referință aleasă automat', () => {
    const diferite = rows.map(x => x.id === 1 ? { ...x, cantitate: 1200.1 } : x)
    expect(controlTotaluri(diferite)[0]).toMatchObject({ declarat: 1200.1, suma_detalii: 1200, stare: 'diferit', text: TOTAL_DIFERIT })
    expect(controlCantitatiGrafic(diferite, '').stare).toBe('warn')
    expect(controlFronturiGrafic({ fronturi: fronturiDinCantitati(diferite, '').fronturi }, diferite)).toMatchObject({ ref: null, stare: 'warn' })
    expect(controlCantitati({ totaluri_control: controlTotaluri(diferite) }).stare).toBe('warn')
  })
  it.each([{ cantitate: null }, { status: 'extras' }, { um: '100 m' }, { sursa: 'Document #9' }, { obiect: 'Lot B' }])('detaliu incomparabil: %o', patch => {
    const rezultat = controlTotaluri(rows.map(x => x.id === 3 ? { ...x, ...patch } : x))[0]
    // Alt perimetru este exclus; suma rămasă diferă și nu devine automat valoarea aleasă.
    expect(rezultat.stare).not.toBe('ok')
    expect([TOTAL_NECOMPARABIL, TOTAL_DIFERIT]).toContain(rezultat.text)
  })
  it('TOTAL multiplu, fără detalii și perimetru nedemonstrabil: necomparabile', () => {
    expect(controlTotaluri([...rows, r(4, 1200, { denumire: 'TOTAL' })]).every(x => x.stare === 'necomparabil')).toBe(true)
    expect(controlTotaluri([rows[0]])[0].stare).toBe('necomparabil')
    expect(controlTotaluri(rows.map(x => ({ ...x, obiect: null })))[0].stare).toBe('necomparabil')
    expect(controlTotaluri(rows, 'cantitate_plansa')[0].stare).toBe('necomparabil')
  })
})

describe('R9b — review și ieșiri controlate', () => {
  const q = { id: 1, cheie: 'auto_planse_1', status: 'de_trimis', intrebare: 'Omul cere 123 m.' }
  it.each(['schimbata', 'necesita_review', 'indisponibila', 'luat_act', 'nou_necunoscut'])('%s nu este aprobare', stare => {
    expect(stareBazaCiorna(q, new Map([[1, { id: 1, stare }]]), null).blocheaza).toBe(true)
    expect(deExportat([q], [{ id: 1, stare }], null).incluse).toEqual([])
  })
  it('modificarea locală a textului nu moștenește starea ok', () => {
    expect(stareBazaCiorna({ ...q, _mod: true }, new Map([[1, { stare: 'ok' }]]), null).blocheaza).toBe(true)
    expect(stareBazaCiorna(q, null, 'control indisponibil').blocheaza).toBe(true)
  })
  it('proza automată nu interpolează suma, contoare sau textul intern de review', () => {
    const generator = corp('ofertare_clarificare_planse_auto')
    const proza = generator.split('  v_text :=')[1].split('  v_baza_gen :=')[0]
    expect(proza).not.toMatch(/v_f3|v_baza\s*->|cardinality|v_ilizibile\s*\|\||v_fara_date\s*\|\|/)
    expect(proza).toContain('corespondența')
    expect(sql).not.toContain('CREATE OR REPLACE FUNCTION public.ofertare_clarificare_mod_text')
    expect(sql).not.toContain('CREATE TRIGGER trg_zzz_ofertare_cantitati_clar_baza')
  })
})
