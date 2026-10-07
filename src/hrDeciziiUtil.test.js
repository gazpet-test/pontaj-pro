import { describe, it, expect } from 'vitest'
import { nrAfisat, stareRol, inVigoare, alteRteInVigoare, esc, renderDecizieHtml, asezareA4, dimensiuniCanvas, alegeFont, estePdf, numeScan, CALE_FISIER_RE, PAGINA, INALTIME_CORP } from './hrDeciziiUtil.js'

const CONT = {
  titlu: 'DECIZIA NR', nr: '916/28.09.2026', previzualizare: false,
  preambul: 'D-nul TRUSU RAZVAN MIHAIL, reprezentant legal al S.C. GAZPET INSTAL SRL;',
  decide: 'DECIDE:',
  articole: [
    { nr: 1, text: 'Incepand cu data de 29.09.2026 , Dl. POPESCU ION se numeste in functia de RTE.' },
    { nr: 2, text: 'Atributiile legate de aceasta functie sunt cele prevazute in Fisa Postului.' },
  ],
  bloc_semnatura: 'Administrator\nTrusu Razvan,',
  luare_la_cunostinta: 'ANGAJAT,\nam luat la cunostinta',
}

describe('esc', () => {
  it('escapează cele 5 caractere și tratează null', () => {
    expect(esc(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;')
    expect(esc(null)).toBe('')
    expect(esc(0)).toBe('0')
  })
})

describe('renderDecizieHtml', () => {
  it('pagina are exact 794×1123 cu overflow ascuns (C18)', () => {
    const h = renderDecizieHtml(CONT)
    expect(h).toContain(`width:${PAGINA.w}px;height:${PAGINA.h}px;overflow:hidden`)
  })
  it('blocurile în ordinea F1: titlu, preambul, DECIDE, articole, semnătură, luare la cunoștință', () => {
    const h = renderDecizieHtml(CONT)
    const poz = ['DECIZIA NR 916/28.09.2026', 'D-nul TRUSU', 'DECIDE:', '<b>Art.1</b>', '<b>Art.2</b>', 'Administrator<br/>Trusu Razvan,', 'ANGAJAT,<br/>am luat la cunostinta']
      .map(s => h.indexOf(s))
    poz.forEach(p => expect(p).toBeGreaterThan(-1))
    expect([...poz].sort((a, b) => a - b)).toEqual(poz)
  })
  it('testul 69: temei/proiect ostile apar ca text, fără element nou în HTML', () => {
    const rau = { ...CONT, articole: [{ nr: 1, text: 'conform <img src=x onerror=alert(1)> in cadrul proiectului „A & B "C"” {aut_nr}' }],
      preambul: '<script>alert(1)</script>', bloc_semnatura: '"><svg onload=alert(1)>' }
    const h = renderDecizieHtml(rau, { cod_verificare: '<b>x</b>' })
    expect(h).not.toMatch(/<img src=x/i)
    expect(h).not.toMatch(/<script/i)
    expect(h).not.toMatch(/<svg/i)
    expect(h).not.toContain('<b>x</b>')
    expect(h).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(h).toContain('A &amp; B &quot;C&quot;')
    expect(h).toContain('{aut_nr}')               // substituția e pe server, nerecursivă; aici rămâne literal
  })
  it('logo doar ca data URL de imagine validă; altceva e ignorat', () => {
    expect(renderDecizieHtml(CONT, { logo: 'data:image/jpeg;base64,AAAA' })).toContain('<img src="data:image/jpeg;base64,AAAA"')
    expect(renderDecizieHtml(CONT, { logo: 'javascript:alert(1)' })).not.toContain('<img')
    expect(renderDecizieHtml(CONT, { logo: 'data:image/jpeg;base64,AA" onerror="x' })).not.toContain('<img')
  })
  it('previzualizare: rezerva 99999-bis păstrează lățimea, se afișează ____', () => {
    const h = renderDecizieHtml({ ...CONT, nr: '99999-bis/28.09.2026', previzualizare: true })
    expect(h).toContain('visibility:hidden">99999-bis</span>')
    expect(h).toContain('>____</span>')
    expect(h).toContain('PREVIZUALIZARE')
  })
  it('subsolul are codul de verificare la 9pt, monospace, gri închis (VA28)', () => {
    const h = renderDecizieHtml(CONT, { cod_verificare: 'D42-a1b2c3d4' })
    expect(h).toMatch(/monospace;font-size:9pt;color:#4a4a4a">Cod verificare D42-a1b2c3d4 · generat din PontajPRO/)
  })
  it('fontul: 12 implicit, 11 la cerere, altceva → 12', () => {
    expect(renderDecizieHtml(CONT)).toContain('font-size:12pt')
    expect(renderDecizieHtml(CONT, { fontPt: 11 })).toContain('font-size:11pt')
    expect(renderDecizieHtml(CONT, { fontPt: 10 })).toContain('font-size:12pt')
  })
  it('continut gol nu aruncă', () => {
    expect(() => renderDecizieHtml(null)).not.toThrow()
  })
  it('titlul și DECIDE vin doar din continut (P8-3), escapate', () => {
    const h = renderDecizieHtml({ ...CONT, titlu: 'DECIZIA <NR>', decide: 'HOTARASTE:' })
    expect(h).toContain('DECIZIA &lt;NR&gt; 916/28.09.2026')
    expect(h).toContain('>HOTARASTE:</div>')
    expect(h).not.toContain('DECIDE:')
  })
  it('blocurile de text rup șirurile lungi și sunt marcate pentru verificarea de lățime (J8-1)', () => {
    const h = renderDecizieHtml({ ...CONT, articole: [{ nr: 1, text: 'Conform ' + 'W'.repeat(160) }] })
    const blocuri = h.match(/class="hrdec-t" style="overflow-wrap:anywhere;word-break:break-word;/g) || []
    expect(blocuri.length).toBe(6)              // titlu, preambul, DECIDE, 1 articol, 2 celule de semnătură
  })
})

describe('asezareA4', () => {
  it('portret: poză 3000×4000 umple lățimea sau înălțimea, centrat, fără deformare', () => {
    const a = asezareA4(3000, 4000)
    expect(a.orientare).toBe('p')
    expect([a.pagW, a.pagH]).toEqual([210, 297])
    expect(a.l / a.h).toBeCloseTo(3000 / 4000, 6)
    expect(a.l).toBeCloseTo(210, 6)
    expect(a.x).toBeCloseTo(0, 6)
    expect(a.y).toBeCloseTo((297 - a.h) / 2, 6)
  })
  it('peisaj: poză 4000×3000 → pagină A4 peisaj', () => {
    const a = asezareA4(4000, 3000)
    expect(a.orientare).toBe('l')
    expect([a.pagW, a.pagH]).toEqual([297, 210])
    expect(a.h).toBeCloseTo(210, 6)
    expect(a.x + a.l).toBeLessThanOrEqual(297 + 1e-9)
  })
  it('rotirea 90/270 inversează orientarea; 180 nu', () => {
    expect(asezareA4(4000, 3000, 90).orientare).toBe('p')
    expect(asezareA4(4000, 3000, 270).orientare).toBe('p')
    expect(asezareA4(4000, 3000, 180).orientare).toBe('l')
    expect(asezareA4(4000, 3000, -90).orientare).toBe('p')
  })
  it('încape mereu în pagină', () => {
    for (const [w, h] of [[1, 5000], [5000, 1], [2480, 3508], [100, 100]]) {
      const a = asezareA4(w, h)
      expect(a.x).toBeGreaterThanOrEqual(-1e-9); expect(a.y).toBeGreaterThanOrEqual(-1e-9)
      expect(a.x + a.l).toBeLessThanOrEqual(a.pagW + 1e-9); expect(a.y + a.h).toBeLessThanOrEqual(a.pagH + 1e-9)
    }
  })
  it('refuză dimensiuni sau rotiri invalide', () => {
    expect(() => asezareA4(0, 10)).toThrow()
    expect(() => asezareA4(10, 10, 45)).toThrow()
  })
})

describe('dimensiuniCanvas', () => {
  it('max 2400px pe latura lungă, fără mărire, cu rotire', () => {
    expect(dimensiuniCanvas(4000, 3000)).toMatchObject({ cw: 2400, ch: 1800 })
    expect(dimensiuniCanvas(4000, 3000, 90)).toMatchObject({ cw: 1800, ch: 2400 })
    expect(dimensiuniCanvas(800, 600)).toMatchObject({ cw: 800, ch: 600, s: 1 })
  })
})

describe('alegeFont (B7, Vf8)', () => {
  it('12 dacă încape, altfel 11, altfel null', () => {
    expect(alegeFont({ 12: INALTIME_CORP })).toBe(12)
    expect(alegeFont({ 12: INALTIME_CORP + 1, 11: INALTIME_CORP })).toBe(11)
    expect(alegeFont({ 12: INALTIME_CORP + 1, 11: INALTIME_CORP + 1 })).toBe(null)
    expect(alegeFont({ 12: Infinity })).toBe(null)
  })
})

describe('numeScan (P8-1)', () => {
  it('doar cifre după semnat_, potrivit regex-ului căii din PR1', () => {
    expect(numeScan(1791355880749)).toBe('semnat_1791355880749.pdf')
    expect(CALE_FISIER_RE.test(numeScan())).toBe(true)
    expect(CALE_FISIER_RE.test('semnat_20261007_094900.pdf')).toBe(false)
  })
})

describe('estePdf', () => {
  it('recunoaște semnătura %PDF-', () => {
    expect(estePdf(new TextEncoder().encode('%PDF-1.7'))).toBe(true)
    expect(estePdf(new TextEncoder().encode('GIF89a'))).toBe(false)
    expect(estePdf(new Uint8Array([]))).toBe(false)
  })
})

describe('nrAfisat (aceeași formă ca _hr_nr_afisat)', () => {
  it('număr/dată, sufix, an fără dată, carte tehnică, draft', () => {
    expect(nrAfisat({ numar: 916, data_emitere: '2026-09-28', an: 2026, serie: 'HR' })).toBe('916/28.09.2026')
    expect(nrAfisat({ numar: 385, numar_sufix: 'a', an: 2024, serie: 'HR' })).toBe('385-a/2024')
    expect(nrAfisat({ numar: 391, an: 2025, serie: 'carte_tehnica' })).toBe('391/2025 (seria carte tehnica)')
    expect(nrAfisat({ numar: null })).toBe(null)
  })
})

describe('stareRol (cardurile din Execuție, C10/VA9)', () => {
  const AZI = '2026-10-07'
  const sem = { id: 1, tip_cod: 'RTE', stare: 'semnata', employee_id: 5, numar: 916, data_emitere: '2026-09-28', snapshot: { persoana: { nume: 'Popescu Ion' } } }
  it('decizia activă pe aceeași persoană', () => { expect(stareRol('RTE', 5, [sem], {}, AZI)).toMatchObject({ cod: 'ok', t: 'Decizia nr 916/28.09.2026' }) })
  it('echipa are altă persoană decât decizia', () => { expect(stareRol('RTE', 7, [sem], {}, AZI).cod).toBe('diferit') })
  it('doar emisă → nesemnată', () => { expect(stareRol('RTE', 5, [{ ...sem, stare: 'emisa' }], {}, AZI).cod).toBe('nesemnata') })
  it('revocată, echipa îl are încă', () => { expect(stareRol('RTE', 5, [{ ...sem, stare: 'revocata' }], {}, AZI)).toMatchObject({ cod: 'revocata', t: '⚠ decizie revocată, echipa îl are încă pe Popescu Ion' }) })
  it('fără decizie / fără nimic', () => {
    expect(stareRol('RTE', 5, [], {}, AZI).cod).toBe('lipsa')
    expect(stareRol('RTE', null, [], {}, AZI)).toBe(null)
  })
  it('legătura e pe tip_cod: o decizie MP nu etichetează cardul RTE', () => { expect(stareRol('RTE', 5, [{ ...sem, tip_cod: 'MP' }], {}, AZI).cod).toBe('lipsa') })
  it('decizia expirată (data_efect_pana trecută) nu mai e activă', () => { expect(stareRol('RTE', 5, [{ ...sem, data_efect_pana: '2026-10-01' }], {}, AZI).cod).toBe('lipsa') })
})

describe('review PR3: efect viitor, RTE multipli, G7 (J10-2, J10-3, P10-1, P10-2)', () => {
  const AZI = '2026-10-07'
  const X = { id: 1, tip_cod: 'RTE', stare: 'semnata', employee_id: 5, numar: 916, data_emitere: '2026-09-28', proiect_id: 1, domenii_isc: ['8.4D'] }
  const Y = { id: 2, tip_cod: 'RTE', stare: 'semnata', employee_id: 7, numar: 920, data_emitere: '2026-10-01', proiect_id: 1, domenii_isc: ['9.1'] }
  it('inVigoare: start ≤ azi ≤ final', () => {
    expect(inVigoare({ data_efect: '2026-10-08' }, AZI)).toBe(false)
    expect(inVigoare({ data_efect: '2026-10-07' }, AZI)).toBe(true)
    expect(inVigoare({ data_efect_pana: '2026-10-06' }, AZI)).toBe(false)
    expect(inVigoare({}, AZI)).toBe(true)
  })
  it('decizia cu efect de mâine nu e activă azi (P10-1)', () => {
    expect(stareRol('RTE', 5, [{ ...X, data_efect: '2026-10-08' }], {}, AZI).cod).toBe('viitor')
    expect(stareRol('RTE', 7, [{ ...X, data_efect: '2026-10-08' }], {}, AZI).cod).toBe('lipsa')
  })
  it('doi RTE valizi: decizia persoanei din echipă câștigă, în ambele ordini (J10-3)', () => {
    expect(stareRol('RTE', 5, [Y, X], {}, AZI).cod).toBe('ok')
    expect(stareRol('RTE', 5, [X, Y], {}, AZI).cod).toBe('ok')
    expect(stareRol('RTE', 9, [Y, X], {}, AZI).cod).toBe('diferit')
  })
  it('G7 doar pe RTE în vigoare, altă persoană, domenii disjuncte (P10-2)', () => {
    expect(alteRteInVigoare([X], 1, 7, ['9.1'], AZI)).toBe(true)
    expect(alteRteInVigoare([X], 1, 7, ['8.4D'], AZI)).toBe(false)            // același domeniu
    expect(alteRteInVigoare([{ ...X, data_efect_pana: '2026-10-01' }], 1, 7, ['9.1'], AZI)).toBe(false)   // expirat
    expect(alteRteInVigoare([X], 1, 5, ['9.1'], AZI)).toBe(false)            // aceeași persoană
    expect(alteRteInVigoare([X], 2, 7, ['9.1'], AZI)).toBe(false)            // alt proiect
  })
})
