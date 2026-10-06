import { describe, it, expect } from 'vitest'
import { mesajEroareCitire, mesajFaraText, MESAJ_TIMEOUT_UI } from './ofertareCitireDoc.js'

describe('mesajEroareCitire — Răcari 06.10.2026', () => {
  it('eroarea de business din corp are prioritate', () => {
    expect(mesajEroareCitire({ message: 'x', context: { status: 504 } }, { error: 'Fișier prea mare' })).toBe('Fișier prea mare')
  })
  it('504 / 546 de la gateway → mesajul de timeout cu calea pe felii', () => {
    expect(mesajEroareCitire({ message: 'Edge Function returned a non-2xx status code', context: { status: 504 } }, null)).toBe(MESAJ_TIMEOUT_UI)
    expect(mesajEroareCitire({ message: 'x', context: { status: 546 } }, null)).toBe(MESAJ_TIMEOUT_UI)
    expect(MESAJ_TIMEOUT_UI).toMatch(/Procesează/)
  })
  it('timeout în mesaj fără status → tot mesajul de timeout', () => {
    expect(mesajEroareCitire({ message: 'request timed out' }, undefined)).toBe(MESAJ_TIMEOUT_UI)
  })
  it('altă eroare → mesajul ei; nimic → „eroare necunoscută”', () => {
    expect(mesajEroareCitire({ message: 'nu ai acces la modulul Ofertare', context: { status: 403 } }, null)).toBe('nu ai acces la modulul Ofertare')
    expect(mesajEroareCitire(null, null)).toBe('eroare necunoscută')
  })
})

describe('mesajFaraText — necitit ≠ scanat', () => {
  it('neprocesat / necunoscut → „Încă necitit”', () => {
    expect(mesajFaraText('neprocesat')).toMatch(/^Încă necitit/)
    expect(mesajFaraText(null)).toMatch(/^Încă necitit/)
  })
  it('procesat fără text → poate e scanat; eroare / ignorat → mesaj propriu', () => {
    expect(mesajFaraText('procesat')).toMatch(/poate e scanat/)
    expect(mesajFaraText('partial')).toMatch(/poate e scanat/)
    expect(mesajFaraText('eroare')).toMatch(/eroare/)
    expect(mesajFaraText('ignorat')).toMatch(/ignorat/)
  })
})

import { citestePeFelii, trebuieCititPeFelii } from './ofertareCitireDoc.js'

describe('citestePeFelii — regula documentației pentru „Citește cu AI”', () => {
  const fara = async () => {}
  it('neprocesat / eroare / necunoscut → pe felii; procesat / partial / ignorat → nu', () => {
    expect(trebuieCititPeFelii('neprocesat')).toBe(true)
    expect(trebuieCititPeFelii('eroare')).toBe(true)
    expect(trebuieCititPeFelii(null)).toBe(true)
    expect(trebuieCititPeFelii('procesat')).toBe(false)
    expect(trebuieCititPeFelii('partial')).toBe(false)
    expect(trebuieCititPeFelii('ignorat')).toBe(false)
  })
  it('rundele continuă cât edge-ul spune continua=true, apoi ok', async () => {
    const raspunsuri = [{ continua: true }, { continua: true }, { continua: false }]
    const apeluri = []
    const invoke = async (fn, { body }) => { apeluri.push([fn, body.doc_id]); return { data: raspunsuri.shift(), error: null } }
    const r = await citestePeFelii(invoke, 1624, { pauza: fara })
    expect(r).toEqual({ ok: true, runde: 3 })
    expect(apeluri.every(([fn, id]) => fn === 'ofertare-ingest-doc' && id === 1624)).toBe(true)
  })
  it('eroare trecătoare: reîncearcă de 2 ori, a 3-a eroare la rând oprește', async () => {
    let n = 0
    const invoke = async () => { n++; return { data: null, error: { message: 'x', context: { status: 500 } } } }
    const r = await citestePeFelii(invoke, 1, { pauza: fara })
    expect(r.ok).toBe(false); expect(n).toBe(3)
  })
  it('poarta pe cheltuială (403) → oprește imediat, fără reîncercări', async () => {
    let n = 0
    const invoke = async () => { n++; return { data: { error: 'Citirea integrală o pornește doar ownerul sau responsabilul licitației (costă).' }, error: null } }
    const r = await citestePeFelii(invoke, 1, { pauza: fara })
    expect(r.ok).toBe(false); expect(r.poarta).toBe(true); expect(n).toBe(1); expect(r.eroare).toMatch(/ownerul sau responsabilul/)
  })
  it('plafonul de runde → eroare care trimite la Documentație', async () => {
    const invoke = async () => ({ data: { continua: true }, error: null })
    const r = await citestePeFelii(invoke, 1, { pauza: fara, maxRunde: 2 })
    expect(r.ok).toBe(false); expect(r.eroare).toMatch(/Procesează/)
  })
})

import { citesteCuAi, MESAJ_POARTA } from './ofertareCitireDoc.js'

describe('citesteCuAi — traseul butonului (Copilot P1 06.10: 403 = stop, fără fallback PDF)', () => {
  const fara = async () => {}
  const inregistreaza = (raspunsuri) => {
    const apeluri = []
    const invoke = async (fn, { body }) => { apeluri.push(fn); return raspunsuri[fn](body) }
    return { apeluri, invoke }
  }
  it('poarta pe cheltuială (403 la felii) → eroare pe card, NICIUN apel la ofertare-document-nou-citeste', async () => {
    const { apeluri, invoke } = inregistreaza({
      'ofertare-ingest-doc': () => ({ data: null, error: { message: 'Edge Function returned a non-2xx status code', context: { status: 403 } } }),
      'ofertare-document-nou-citeste': () => ({ data: { ok: true }, error: null }),
    })
    const r = await citesteCuAi(invoke, 1624, 'neprocesat', { pauza: fara })
    expect(r).toEqual({ ok: false, poarta: true, eroare: MESAJ_POARTA })
    expect(apeluri).toEqual(['ofertare-ingest-doc'])
    expect(MESAJ_POARTA).toMatch(/ownerul sau responsabilul/)
  })
  it('poarta recunoscută și după mesaj (corp 200 cu error) → la fel, fără rezumat', async () => {
    const { apeluri, invoke } = inregistreaza({
      'ofertare-ingest-doc': () => ({ data: { error: 'Citirea integrală o pornește doar ownerul sau responsabilul licitației (costă).' }, error: null }),
      'ofertare-document-nou-citeste': () => ({ data: { ok: true }, error: null }),
    })
    const r = await citesteCuAi(invoke, 1, null, { pauza: fara })
    expect(r.poarta).toBe(true); expect(apeluri).not.toContain('ofertare-document-nou-citeste')
  })
  it('necitit, cu drept → felii, apoi rezumatul', async () => {
    const { apeluri, invoke } = inregistreaza({
      'ofertare-ingest-doc': () => ({ data: { continua: false }, error: null }),
      'ofertare-document-nou-citeste': () => ({ data: { ok: true, citire_noi: { rezumat: 'x' } }, error: null }),
    })
    const r = await citesteCuAi(invoke, 1, 'neprocesat', { pauza: fara })
    expect(r.ok).toBe(true); expect(r.data.citire_noi.rezumat).toBe('x')
    expect(apeluri).toEqual(['ofertare-ingest-doc', 'ofertare-document-nou-citeste'])
  })
  it('deja citit (procesat) → doar rezumatul, fără felii (oricine cu acces Ofertare)', async () => {
    const { apeluri, invoke } = inregistreaza({
      'ofertare-ingest-doc': () => { throw new Error('nu trebuia apelat') },
      'ofertare-document-nou-citeste': () => ({ data: { ok: true }, error: null }),
    })
    const r = await citesteCuAi(invoke, 1, 'procesat', { pauza: fara })
    expect(r.ok).toBe(true); expect(apeluri).toEqual(['ofertare-document-nou-citeste'])
  })
  it('felii eșuate (non-poartă) → eroarea feliilor, fără rezumat; rezumat eșuat → mesajEroareCitire (504 → timeout)', async () => {
    const a = inregistreaza({
      'ofertare-ingest-doc': () => ({ data: null, error: { message: 'x', context: { status: 500 } } }),
      'ofertare-document-nou-citeste': () => ({ data: { ok: true }, error: null }),
    })
    const r1 = await citesteCuAi(a.invoke, 1, 'eroare', { pauza: fara })
    expect(r1.ok).toBe(false); expect(r1.poarta).toBeUndefined(); expect(a.apeluri).not.toContain('ofertare-document-nou-citeste')
    const b = inregistreaza({ 'ofertare-document-nou-citeste': () => ({ data: null, error: { message: 'x', context: { status: 504 } } }) })
    const r2 = await citesteCuAi(b.invoke, 1, 'procesat', { pauza: fara })
    expect(r2).toEqual({ ok: false, eroare: MESAJ_TIMEOUT_UI })
  })
})

describe('citesteCuAi — poarta pe server și corpul erorilor non-2xx (review ultracode 06.10)', () => {
  const fara = async () => {}
  const raspunsNon2xx = (status, corp) => ({ data: null, error: { message: 'Edge Function returned a non-2xx status code',
    context: { status, clone() { return this }, json: async () => corp } } })
  it('edge-ul de rezumat refuză PDF-ul întreg (403, cod poarta_cheltuiala) → mesajul porții, ca la felii', async () => {
    const invoke = async () => raspunsNon2xx(403, { error: 'x', cod: 'poarta_cheltuiala' })
    const r = await citesteCuAi(invoke, 1, 'ignorat', { pauza: fara })
    expect(r).toEqual({ ok: false, poarta: true, eroare: MESAJ_POARTA })
  })
  it('altă eroare non-2xx cu corp → mesajul de business din corp, nu „non-2xx status code”', async () => {
    const invoke = async () => raspunsNon2xx(409, { error: 'documentul e scris simultan din altă parte' })
    const r = await citesteCuAi(invoke, 1, 'procesat', { pauza: fara })
    expect(r).toEqual({ ok: false, eroare: 'documentul e scris simultan din altă parte' })
  })
  it('corp ilizibil (504 HTML de la gateway) → mesajul de timeout', async () => {
    const invoke = async () => ({ data: null, error: { message: 'x', context: { status: 504, json: async () => { throw new Error('nu e JSON') } } } })
    const r = await citesteCuAi(invoke, 1, 'procesat', { pauza: fara })
    expect(r).toEqual({ ok: false, eroare: MESAJ_TIMEOUT_UI })
  })
})

import { avertismentCitire } from './ofertareCitireDoc.js'
describe('avertismentCitire — citirea pe sursă incompletă nu se arată ca rezultat complet (Copilot conv. 3, P1)', () => {
  it('trunchiat → PARȚIALĂ cu lungimile; pagini necitite → PARȚIALĂ', () => {
    const a = avertismentCitire({ sursa_completa: false, motive_incomplet: ['trunchiat'], lungime_folosita: 400000, lungime_sursa: 900032 })
    expect(a).toMatch(/^Citire PARȚIALĂ/); expect(a).toMatch(/400\.000 din 900\.032/)
    expect(avertismentCitire({ sursa_completa: false, motive_incomplet: ['pagini_necitite'] })).toMatch(/pagini nu au putut fi citite/)
  })
  it('completă sau citire veche fără câmp → fără avertisment', () => {
    expect(avertismentCitire({ sursa_completa: true, motive_incomplet: [] })).toBeNull()
    expect(avertismentCitire({ rezumat: 'vechi' })).toBeNull()
    expect(avertismentCitire(null)).toBeNull()
  })
})

describe('avertismentCitire — și plafonarea rezultatului AI (review ultracode r3)', () => {
  it('lista plafonată / rezumat tăiat / răspuns AI tăiat → PARȚIALĂ, cu totalurile găsite', () => {
    const c = { sursa_completa: true, citire_completa: false, motive_incomplet: ['lista_plafonata', 'rezumat_taiat', 'raspuns_ai_taiat'],
      total_modificari: 120, total_intrebari: 5, modificari: new Array(100).fill({}), intrebari_raspunse: new Array(5).fill({}) }
    const a = avertismentCitire(c)
    expect(a).toMatch(/^Citire PARȚIALĂ/); expect(a).toMatch(/120 modificări/); expect(a).toMatch(/primele 100 \/ 5/)
    expect(a).toMatch(/rezumatul a fost scurtat/); expect(a).toMatch(/limita de lungime/)
  })
})

describe('avertismentCitire — tăietură nesigură între felii / termene diferite (Copilot conv. 3, NO-GO pe d459447)', () => {
  it('granita_nesigura → PARȚIALĂ, cu numărul de felii', () => {
    const a = avertismentCitire({ sursa_completa: true, citire_completa: false, motive_incomplet: ['granita_nesigura'], felii: 5 })
    expect(a).toMatch(/^Citire PARȚIALĂ/); expect(a).toMatch(/pe 5 felii/); expect(a).toMatch(/poate fi ruptă/)
  })
  it('doar conflict_termen → „De verificat”, cu termenele în ordinea documentului; nu alege unul', () => {
    const a = avertismentCitire({ sursa_completa: true, citire_completa: false, motive_incomplet: ['conflict_termen'], termen_nou: null, felii: 3,
      termene: [{ data: '2026-10-30', felie: 1 }, { data: '2026-10-25', felie: 3 }] })
    expect(a).toMatch(/^De verificat:/); expect(a).toMatch(/30\.10\.2026 — felia 1, 25\.10\.2026 — felia 3/)
    expect(a).not.toMatch(/PARȚIALĂ/)
  })
  it('n = 1 (aceeași felie): fără „felia”, cu citatul scurt din document', () => {
    const a = avertismentCitire({ citire_completa: false, motive_incomplet: ['conflict_termen'], felii: 1,
      termene: [{ data: '2026-10-30', felie: 1, citat: 'Termenul se prelungește la 30.10.2026.' }, { data: '2026-10-25', felie: 1, citat: 'x'.repeat(200) }] })
    expect(a).toMatch(/30\.10\.2026 «Termenul se prelungește la 30\.10\.2026\.», 25\.10\.2026 «x{89}…»/)
    expect(a).not.toMatch(/felia/)
  })
  it('termen neverificat / neinterpretabil → „De verificat”, cu data, marcajul și forma brută', () => {
    const a = avertismentCitire({ citire_completa: false, motive_incomplet: ['termen_neverificat', 'termen_neinterpretabil'], felii: 1, termen_nou: null,
      termene: [{ data: '2026-10-30', citat: '', verificat: false }, { data: null, data_bruta: 'în 30 de zile de la publicare', citat: 'Termenul se prelungește cu 30 de zile.', verificat: false }] })
    expect(a).toMatch(/^De verificat:/); expect(a).toMatch(/30\.10\.2026 \(neverificat\)\) nu are o dovadă verificabilă/)
    expect(a).toMatch(/nu l-am putut citi ca dată \(„în 30 de zile de la publicare” «Termenul se prelungește cu 30 de zile\.»\)/)
  })
  it('conflict_termen împreună cu alt motiv → PARȚIALĂ (motivul cel mai grav decide eticheta)', () => {
    const a = avertismentCitire({ citire_completa: false, motive_incomplet: ['granita_nesigura', 'conflict_termen'], felii: 3, termene: [{ data: '2026-10-30', felie: 1 }, { data: '2026-11-02', felie: 2 }] })
    expect(a).toMatch(/^Citire PARȚIALĂ/); expect(a).toMatch(/termene diferite \(30\.10\.2026 — felia 1, 02\.11\.2026 — felia 2\)/)
  })
})

import { rezumaPeFelii, textProgres } from './ofertareCitireDoc.js'
describe('rezumaPeFelii — rezumatul pe felii (Răcari 06.10, varianta A)', () => {
  const fara = async () => {}
  const seq = (raspunsuri) => { const apeluri = []; return { apeluri, invoke: async (fn, { body }) => { apeluri.push([fn, body.document_id]); return raspunsuri.shift() } } }
  it('cheamă edge-ul cât timp întoarce continua=true, raportează progresul, apoi întoarce citirea finală', async () => {
    const { apeluri, invoke } = seq([
      { data: { ok: true, continua: true, felie: 1, din: 3 }, error: null },
      { data: { ok: true, continua: true, felie: 2, din: 3 }, error: null },
      { data: { ok: true, continua: true, felie: 3, din: 3 }, error: null },
      { data: { ok: true, citire_noi: { rezumat: 'gata', felii: 3 } }, error: null },
    ])
    const progres = []
    const r = await rezumaPeFelii(invoke, 1624, { pauza: fara, onRunda: d => progres.push(textProgres(d)) })
    expect(r.ok).toBe(true); expect(r.data.citire_noi.rezumat).toBe('gata')
    expect(apeluri.length).toBe(4); expect(apeluri.every(([fn, id]) => fn === 'ofertare-document-nou-citeste' && id === 1624)).toBe(true)
    expect(progres).toEqual(['⏳ rezumat felia 2/3…', '⏳ rezumat felia 3/3…', '⏳ rezumat 3/3 — sinteză…'])
  })
  it('o felie care depășește timpul se reia (starea rămâne pe server), apoi continuă', async () => {
    const { apeluri, invoke } = seq([
      { data: { ok: true, continua: true, felie: 1, din: 2 }, error: null },
      { data: { error: 'O felie a rezumatului a depășit timpul.', cod: 'timeout_citire' }, error: null },
      { data: { ok: true, continua: true, felie: 2, din: 2 }, error: null },
      { data: { ok: true, citire_noi: { rezumat: 'gata' } }, error: null },
    ])
    const r = await rezumaPeFelii(invoke, 1, { pauza: fara })
    expect(r.ok).toBe(true); expect(apeluri.length).toBe(4)
  })
  it('trei erori la rând → se oprește cu mesajul ultimei erori', async () => {
    let n = 0
    const invoke = async () => { n++; return { data: { error: 'Claude: overloaded' }, error: null } }
    const r = await rezumaPeFelii(invoke, 1, { pauza: fara })
    expect(r).toEqual({ ok: false, eroare: 'Claude: overloaded' }); expect(n).toBe(3)
  })
  it('sursă schimbată / citit între timp / 403 → terminal, fără reîncercări', async () => {
    for (const cod of ['sursa_schimbata', 'citit_intre_timp']) {
      let n = 0
      const invoke = async () => { n++; return { data: null, error: { message: 'x', context: { status: 409, clone() { return this }, json: async () => ({ error: 'm-' + cod, cod }) } } } }
      const r = await rezumaPeFelii(invoke, 1, { pauza: fara })
      expect(r).toEqual({ ok: false, eroare: 'm-' + cod }); expect(n).toBe(1)
    }
    let n = 0
    const invoke = async () => { n++; return { data: null, error: { message: 'nu ai acces', context: { status: 403, json: async () => { throw new Error('x') } } } } }
    const r = await rezumaPeFelii(invoke, 1, { pauza: fara })
    expect(r.ok).toBe(false); expect(n).toBe(1)
  })
  it('plafonul de runde → mesaj care spune că apăsarea din nou continuă de unde a rămas', async () => {
    const invoke = async () => ({ data: { ok: true, continua: true, felie: 1, din: 50 }, error: null })
    const r = await rezumaPeFelii(invoke, 1, { pauza: fara, maxRunde: 3 })
    expect(r.ok).toBe(false); expect(r.eroare).toMatch(/continuă de unde a rămas/)
  })
  it('citesteCuAi raportează progresul ambelor faze (citire pe felii, apoi rezumat pe felii)', async () => {
    const raspunsuri = {
      'ofertare-ingest-doc': [{ data: { continua: true }, error: null }, { data: { continua: false }, error: null }],
      'ofertare-document-nou-citeste': [{ data: { ok: true, continua: true, felie: 1, din: 2 }, error: null }, { data: { ok: true, citire_noi: { rezumat: 'r' } }, error: null }],
    }
    const invoke = async (fn) => raspunsuri[fn].shift()
    const progres = []
    const r = await citesteCuAi(invoke, 1, 'neprocesat', { pauza: fara, onProgres: t => progres.push(t) })
    expect(r.ok).toBe(true)
    expect(progres).toEqual(['⏳ citesc pe felii (1)…', '⏳ citesc pe felii (2)…', '⏳ rezumat felia 2/2…'])
  })
})
