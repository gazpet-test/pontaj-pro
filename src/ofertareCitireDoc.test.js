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
