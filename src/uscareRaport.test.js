// HTML-ul raportului de uscare (src/uscareRaport.js): rubricile modelului beneficiarului, în ordinea lui; anexa foto; nimic despre unelte.
import { describe, it, expect } from 'vitest'
import { htmlRaport, htmlAnexa, legendaPoza, ordonPoze, esc } from './uscareRaport.js'

const U = {
  tronson: 'Tr. 2', km_de_la_m: 3200, km_pana_la_m: 3900, lungime_m: 700, data_operatie: '2026-12-08', ora_inceput: '2026-12-08T06:40:00+00:00',
  ora_final: '2026-12-08T09:10:00+00:00', temperatura_c: 7.5, vreme: 'Senin', constructor: 'Constructor <SRL>', utilaje: [{ denumire: 'Compresor', buc: 1 }, { denumire: 'Uscător', buc: 2 }],
  pig_metalic_buc: 1, piston_pu_buc: 0, bureti_buc: 4,
  cantariri: [{ nr: 2, intrare_kg: 2.05, iesire_kg: 2.2 }, { nr: 1, intrare_kg: 2.1, iesire_kg: 2.45 }, { nr: 3, intrare_kg: 2, iesire_kg: 2.01 }, { nr: 4, intrare_kg: 1.9, iesire_kg: 1.95 }],
  punct_roua_c: -20.5, punct_roua_loc: 'capăt aval', presiune_bar: 1.5, timp_deplasare_min: 35, observatii: 'linia 1\nlinia 2', concluzie: 'conform',
  semn_constructor_nume: 'NUME A', semn_constructor_functie: 'șef punct de lucru', semn_beneficiar_nume: null, semn_beneficiar_functie: null,
  stare: 'inchisa', revizie: 0,
}
const text = html => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ')

describe('pagina raportului', () => {
  const h = htmlRaport(U), t = text(h)
  it('rubricile modelului, în ordinea lui', () => {
    const rubrici = ['RAPORT - OPERATIUNE DE USCARE A CONDUCTEI', 'Data operatiune', 'Tronson', 'De la km', 'La km', 'Lungime (m)', 'Temperatura exterioara',
      'Denumire Constructor', 'Utilaje/ Echipamente', 'Perioada', 'Durata (ore)', 'Configuratie ansamblu pistoane', 'Cantarire burete 1', 'Punct de roua',
      'Denumire', 'Nr. Buc.', 'Ora incepere', 'Ora finalizare', 'PIG metalic [buc]', 'Piston poliuretan [buc]', 'Bureti spuma [buc]', 'La intrare [kg]',
      'La iesire [kg]', 'Valoare (°C)', 'Locatie masurare', 'Presiune in spatele buretelui (bar)', 'Timp deplasare (min)', 'Viteza medie (m/s)',
      'Cantarire burete 2', 'Cantarire burete 3', 'OBSERVATII', 'Concluzie pentru tronson:', 'CONFORM', 'NECONFORM', 'CONSTRUCTOR', 'BENEFICIAR', 'NUME/ PRENUME:', 'FUNCTIE:']
    let poz = -1
    for (const r of rubrici) { const i = t.indexOf(r, poz + 1); expect(i, r).toBeGreaterThan(poz); poz = i }
  })
  it('valorile: km, ore în ora României, durata, viteza, bureții 1–3 în ordine, al 4-lea în plus', () => {
    expect(t).toContain('3+200'); expect(t).toContain('3+900')
    expect(t).toContain('08.12.2026 08:40'); expect(t).toContain('08.12.2026 11:10')
    expect(t).toContain(' 2,5 ')                       // durata 2 h 30 min
    expect(t).toContain(' 0,33 ')                      // 700 m / 35 min
    expect(t).toContain('7,5 °C')
    expect(t.indexOf('2,45')).toBeLessThan(t.indexOf('2,2 '))   // buretele 1 (pagina 1) înaintea buretelui 2
    expect(t).toContain('Cantarire burete 4')
  })
  it('concluzia bifată, textul scăpat (HTML), semnatarul lipsă = gol', () => {
    expect(h).toContain('&#9746; CONFORM')
    expect(h).toContain('&#9744; NECONFORM')
    expect(h).toContain('Constructor &lt;SRL&gt;')
    expect(h).not.toContain('<SRL>')
    expect(t).toContain('BENEFICIAR NUME/ PRENUME: FUNCTIE:')
  })
  it('tabelele au colgroup în procente (html2canvas)', () => {
    const cols = [...h.matchAll(/<col style="width:([^"]+)">/g)].map(m => m[1])
    expect(cols.length).toBeGreaterThan(10)
    expect(cols.every(w => /^[\d.]+%$/.test(w))).toBe(true)
  })
  it('ciorna și revizia se văd; raportul închis fără revizie nu are mențiuni', () => {
    expect(text(htmlRaport({ ...U, stare: 'deschisa' }))).toContain('CIORNĂ — raport neînchis')
    expect(text(htmlRaport({ ...U, stare: 'anulata' }))).toContain('CIORNĂ — raport ANULAT')
    expect(text(htmlRaport({ ...U, revizie: 2 }))).toContain('Revizia 2')
    expect(t).not.toMatch(/CIORN|Revizia/)
  })
  it('nicio mențiune despre unelte sau cine a pregătit documentul', () => {
    const tot = (h + htmlAnexa(U, [{ id: 1, categorie: 'manometru', cale: 'x', dataUrl: 'data:image/jpeg;base64,AA', creat_la: '2026-12-08T07:00:00Z' }]).join('')).toLowerCase()
    for (const interzis of ['rocky', 'claude', ' ai ', 'generat', 'pregătit de', 'pregatit de', 'erp', 'aplicați', 'aplicati', 'software', 'xweather', 'paw-data'])
      expect(tot, interzis).not.toContain(interzis)
  })
})

describe('anexa foto', () => {
  const poze = [
    { id: 3, categorie: 'cantar_iesire', burete_nr: 1, legenda: null, cale: 'a', dataUrl: 'data:image/jpeg;base64,AA', creat_la: '2026-12-08T09:00:00Z' },
    { id: 1, categorie: 'altele', cale: 'b', dataUrl: 'data:image/jpeg;base64,AA' },
    { id: 2, categorie: 'manometru', legenda: '1,5 bar', cale: 'c', dataUrl: null, creat_la: '2026-12-08T07:00:00Z' },
  ]
  it('ordinea modelului, 2 poze pe pagină, poza necitită rămâne cu mențiune', () => {
    expect(ordonPoze(poze).map(p => p.id)).toEqual([2, 3, 1])
    const pag = htmlAnexa({ tronson: 'Tr. 2', data_operatie: '2026-12-08' }, poze)
    expect(pag).toHaveLength(2)
    expect(text(pag[0])).toContain('ANEXA FOTO — Raport de uscare, Tr. 2, 08.12.2026')
    expect(text(pag[0])).toContain('Pagina 1 din 2')
    expect(text(pag[0])).toContain('Fotografia nu a putut fi citită la generare (c)')
    expect(text(pag[1])).toContain('Foto 3 — Altele')
  })
  it('legenda', () => {
    expect(legendaPoza(poze[0], 2)).toBe('Foto 2 — Cântar la ieșire, buretele 1 — încărcată la 08.12.2026 11:00')
    expect(legendaPoza(poze[2], 1)).toBe('Foto 1 — Manometru (presiunea) — 1,5 bar — încărcată la 08.12.2026 09:00')
  })
  it('esc', () => { expect(esc(`<a href="x">'&`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;') })
})
