// HTML-ul raportului de uscare (src/uscareRaport.js): rubricile modelului beneficiarului (cu diacritice), în ordinea lui; criteriul ultimului
// piston; coordonatele doar la cerere; paginarea pe blocuri (nimic micșorat pe o pagină); anexa foto; nimic despre unelte.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { htmlRaport, htmlRaportBlocuri, aseazaBlocuri, htmlAnexa, legendaPoza, ordonPoze, esc } from './uscareRaport.js'

const U = {
  tronson: 'Tr. 2', km_de_la_m: 3200, km_pana_la_m: 3900, lungime_m: 700, data_operatie: '2026-12-08', ora_inceput: '2026-12-08T06:40:00+00:00',
  ora_final: '2026-12-08T09:10:00+00:00', temperatura_c: 7.5, vreme: 'Senin', constructor: 'Constructor <SRL>', utilaje: [{ denumire: 'Compresor', buc: 1 }, { denumire: 'Uscător', buc: 2 }],
  pig_metalic_buc: 1, piston_pu_buc: 0, bureti_buc: 4,
  cantariri: [{ nr: 2, intrare_kg: 2.05, iesire_kg: 2.2, motiv: null }, { nr: 1, intrare_kg: 2.1, iesire_kg: 2.45, motiv: null }, { nr: 3, intrare_kg: null, iesire_kg: null, motiv: 'pierdut în conductă' }, { nr: 4, intrare_kg: 1.9, iesire_kg: 1.95, motiv: null }],
  punct_roua_c: null, punct_roua_loc: null, presiune_bar: 1.5, timp_deplasare_min: 35, observatii: 'linia 1\nlinia 2', concluzie: 'conform', piston_final_rezultat: 'uscat',
  poz_lat: 44.941234, poz_lng: 22.500001, poz_sursa: 'gps', poz_precizie_m: 4.5,
  semn_constructor_nume: 'NUME A', semn_constructor_functie: 'șef punct de lucru', semn_beneficiar_nume: null, semn_beneficiar_functie: null,
  stare: 'inchisa', revizie: 0,
}
const text = html => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ')

describe('pagina raportului', () => {
  const h = htmlRaport(U), t = text(h)
  it('rubricile modelului, cu diacritice, în ordinea lui', () => {
    const rubrici = ['RAPORT - OPERAȚIUNE DE USCARE A CONDUCTEI', 'Data operațiune', 'Tronson', 'De la km', 'La km', 'Lungime (m)', 'Temperatura exterioară',
      'Denumire Constructor', 'Utilaje/ Echipamente', 'Perioada', 'Durata (ore)', 'Configurație ansamblu pistoane', 'Cântărire burete 1', 'Punct de rouă',
      'Denumire', 'Nr. Buc.', 'Ora începere', 'Ora finalizare', 'PIG metalic [buc]', 'Piston poliuretan [buc]', 'Bureți spumă [buc]', 'La intrare [kg]',
      'La ieșire [kg]', 'Valoare (°C)', 'Locație măsurare', 'Presiune în spatele buretelui (bar)', 'Timp deplasare (min)', 'Viteza medie (m/s)',
      'Cântărire burete 2', 'Cântărire burete 3', 'OBSERVAȚII', 'Ultimul piston vehiculat iese uscat', 'Concluzie pentru tronson:', 'CONFORM', 'NECONFORM',
      'CONSTRUCTOR', 'BENEFICIAR', 'NUME/ PRENUME:', 'FUNCȚIE:']
    let poz = -1
    for (const r of rubrici) { const i = t.indexOf(r, poz + 1); expect(i, r).toBeGreaterThan(poz); poz = i }
  })
  it('valorile: km, ore în ora României, durata, viteza, bureții 1–3, „nu se aplică”, al 4-lea în plus', () => {
    expect(t).toContain('3+200'); expect(t).toContain('3+900')
    expect(t).toContain('08.12.2026 08:40'); expect(t).toContain('08.12.2026 11:10')
    expect(t).toContain(' 2,5 ')                       // durata 2 h 30 min
    expect(t).toContain(' 0,33 ')                      // 700 m / 35 min
    expect(t).toContain('7,5 °C')
    expect(t).toContain('nu se aplică: pierdut în conductă')
    expect(t).toContain('Cântărire burete 4')
  })
  it('criteriul și concluzia bifate, textul scăpat (HTML), semnatarul lipsă = gol', () => {
    expect(h).toContain('&#9746; DA &nbsp;&nbsp; &#9744; NU')
    expect(h).toContain('&#9746; CONFORM')
    expect(h).toContain('Constructor &lt;SRL&gt;')
    expect(h).not.toContain('<SRL>')
    expect(t).toContain('BENEFICIAR NUME/ PRENUME: FUNCȚIE:')
  })
  it('justificarea fotografiilor lipsă apare în PDF (observația 10 din verdictul r2), scăpată HTML; fără justificare, fără secțiune', () => {
    const cu = htmlRaport({ ...U, poze_justificare: 'manometrul nu s-a putut fotografia <ceață>' })
    expect(text(cu)).toContain('FOTOGRAFII LIPSĂ — JUSTIFICARE manometrul nu s-a putut fotografia &lt;ceață&gt;')
    expect(text(htmlRaport({ ...U, poze_justificare: null }))).not.toContain('FOTOGRAFII LIPSĂ')
  })
  it('coordonatele exacte NU apar implicit; doar cu opțiunea explicită', () => {
    expect(h).not.toContain('44.941234')
    const cu = text(htmlRaport(U, { cuCoordonate: true }))
    expect(cu).toContain('Poziția operațiunii: 44.941234, 22.500001 (GPS din telefon, ±4,5 m)')
  })
  it('tabelele au colgroup în procente (html2canvas)', () => {
    const cols = [...h.matchAll(/<col style="width:([^"]+)">/g)].map(m => m[1])
    expect(cols.length).toBeGreaterThan(10)
    expect(cols.every(w => /^[\d.]+%$/.test(w))).toBe(true)
  })
  it('20 de utilaje: toate pe rânduri proprii (nu înghesuite într-o celulă)', () => {
    const multe = { ...U, utilaje: Array.from({ length: 20 }, (_, i) => ({ denumire: `Utilaj ${i + 1}`, buc: 1 })) }
    const b = htmlRaportBlocuri(multe)[1]
    expect((b.match(/<tr>/g) || []).length).toBe(2 + 20)
    expect(text(b)).toContain('Utilaj 20')
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

describe('paginarea (blocuri pe pagini A4, nimic micșorat)', () => {
  it('blocurile încap: aceeași pagină, unul sub altul', () => {
    expect(aseazaBlocuri([30, 50, 40], { inaltimePagina: 281, sus: 8 })).toEqual([[
      { bloc: 0, y: 8, h: 30, felie: null }, { bloc: 1, y: 38, h: 50, felie: null }, { bloc: 2, y: 88, h: 40, felie: null }]])
  })
  it('un bloc care nu mai încape trece pe pagina următoare', () => {
    const p = aseazaBlocuri([200, 100, 20], { inaltimePagina: 281, sus: 8 })
    expect(p.map(x => x.map(b => b.bloc))).toEqual([[0], [1, 2]])
    expect(p[1][0].y).toBe(8)
  })
  it('un bloc mai înalt decât o pagină (observații lungi) se taie în felii întregi, fără micșorare', () => {
    const p = aseazaBlocuri([50, 600, 10], { inaltimePagina: 281, sus: 8 })
    expect(p.map(x => x.map(b => [b.bloc, b.h, b.felie && b.felie.de_la]))).toEqual([[[0, 50, null]], [[1, 281, 0]], [[1, 281, 281]], [[1, 38, 562], [2, 10, null]]])
  })
})

// Proba pe telefon (17.11.2026): tabelul 2 ieșea din pagină în dreapta. HTML-ul raportului se capturează din documentul aplicației, deci îl
// atinge stilul GLOBAL din App.jsx (th: majuscule, spațiere, gri; td: padding). Regula se citește din App.jsx (sursa independentă), iar
// fiecare celulă a raportului trebuie să-și fixeze singură fiecare proprietate pe care o pune regula globală.
describe('tabelele raportului: neatinse de stilul global al aplicației, lățimi fixe în procente', () => {
  const css = /const css = `([\s\S]*?)`/.exec(readFileSync(new URL('./App.jsx', import.meta.url), 'utf8'))[1]
  const regula = sel => {
    const m = new RegExp(`(?:^|\\n)${sel}\\{([^}]*)\\}`).exec(css)
    return m ? m[1].split(';').map(x => x.split(':')[0].trim()).filter(Boolean) : []
  }
  const U_MULTE = { ...U, utilaje: Array.from({ length: 20 }, (_, i) => ({ denumire: `Utilaj ${i + 1}`, buc: 1 })), punct_roua_c: -20.5, punct_roua_loc: 'capătul de primire', poze_justificare: 'lipsă' }
  const tabele = [U, U_MULTE].flatMap(u => htmlRaportBlocuri(u, { cuCoordonate: true }).flatMap(b => b.match(/<table[\s\S]*?<\/table>/g) || []))
  const stilCelule = (t, tag) => [...t.matchAll(new RegExp(`<${tag}\\b[^>]*style="([^"]*)"`, 'g'))].map(m => m[1])
  it('regula globală din App.jsx există (altfel testul nu mai dovedește nimic) și pune majuscule pe th', () => {
    expect(regula('th')).toEqual(expect.arrayContaining(['text-transform', 'letter-spacing', 'color']))
    expect(regula('td').length).toBeGreaterThan(0)
    expect(tabele.length).toBeGreaterThanOrEqual(10)
  })
  it('fiecare th / td își fixează fiecare proprietate pusă de regula globală; fără majuscule, fără spațiere, text negru', () => {
    for (const [tag, props] of [['th', regula('th')], ['td', regula('td')]]) {
      for (const t of tabele) for (const s of stilCelule(t, tag)) {
        for (const p of props) expect(s.includes(`${p}:`) || (p.startsWith('border') && s.includes('border:')), `${tag} fără ${p}: ${s}`).toBe(true)
        expect(s).toContain('text-transform:none'); expect(s).toContain('letter-spacing:normal'); expect(s).toContain('color:#000')
        expect(s).toContain('overflow-wrap:break-word')                      // un cuvânt prea lung se rupe în coloană, nu împinge tabelul
      }
    }
  })
  it('fiecare tabel: lățimi FIXE (table-layout:fixed, 100%), colgroup în procente cu suma 100, câte o coloană pentru fiecare coloană a grilei', () => {
    for (const t of tabele) {
      const stil = /<table style="([^"]*)"/.exec(t)[1]
      expect(stil).toContain('table-layout:fixed'); expect(stil).toContain('width:100%')
      const cols = [...t.matchAll(/<col style="width:([\d.]+)%">/g)].map(m => Number(m[1]))
      expect([...t.matchAll(/<col\b/g)].length, 'toate coloanele în procente').toBe(cols.length)
      expect(Math.abs(cols.reduce((a, b) => a + b, 0) - 100), t.slice(0, 200)).toBeLessThan(1e-9)
      // grila: primul rând (fără rowspan-uri moștenite) = suma colspan-urilor
      const rand1 = /<tr>([\s\S]*?)<\/tr>/.exec(t)[1]
      const grila = [...rand1.matchAll(/<t[hd]\b([^>]*)>/g)].reduce((a, m) => a + Number((/colspan="(\d+)"/.exec(m[1]) || [0, 1])[1]), 0)
      expect(cols.length, rand1.slice(0, 120)).toBe(grila)
    }
  })
})

describe('anexa foto', () => {
  const poze = [
    { id: 3, categorie: 'cantar_iesire', burete_nr: 1, legenda: null, cale: 'a', dataUrl: 'data:image/jpeg;base64,AA', creat_la: '2026-12-08T09:00:00Z' },
    { id: 1, categorie: 'altele', cale: 'b', dataUrl: 'data:image/jpeg;base64,AA' },
    { id: 2, categorie: 'manometru', legenda: '1,5 bar', cale: 'c', dataUrl: null, creat_la: '2026-12-08T07:00:00Z' },
    { id: 4, categorie: 'piston_final', cale: 'd', dataUrl: 'data:image/jpeg;base64,AA' },
  ]
  it('ordinea modelului (ultimul piston după cântăriri), 2 poze pe pagină, poza necitită rămâne cu mențiune', () => {
    expect(ordonPoze(poze).map(p => p.id)).toEqual([2, 3, 4, 1])
    const pag = htmlAnexa({ tronson: 'Tr. 2', data_operatie: '2026-12-08' }, poze)
    expect(pag).toHaveLength(2)
    expect(text(pag[0])).toContain('ANEXA FOTO — Raport de uscare, Tr. 2, 08.12.2026')
    expect(text(pag[0])).toContain('Pagina 1 din 2')
    expect(text(pag[0])).toContain('Fotografia nu a putut fi citită la generare (c)')
    expect(text(pag[1])).toContain('Foto 3 — Ultimul piston vehiculat')
  })
  it('legenda', () => {
    expect(legendaPoza(poze[0], 2)).toBe('Foto 2 — Cântar la ieșire, buretele 1 — încărcată la 08.12.2026 11:00')
    expect(legendaPoza(poze[2], 1)).toBe('Foto 1 — Manometru (presiunea) — 1,5 bar — încărcată la 08.12.2026 09:00')
  })
  it('esc', () => { expect(esc(`<a href="x">'&`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;') })
})
