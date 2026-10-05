import { describe, it, expect } from 'vitest'
import { ziRo, plusZile, zileIntre, ziValida, extrageZileDinFisa, combinaFise, acteContestabile, canalDinAnunt, calculeazaTermene, PRAG_LUCRARI_LEI } from './ofertareTermene.js'

// Cazul real: Mânăstirea CN1095546 — termen 14.10.2026 15:00 RO (12:00 UTC), fișa: 18 zile întrebări / 11 zile răspuns,
// RAR cu liste publicat 02.10.2026, erata de prelungire 14.09.2026, VE 29.264.199,92 lei (peste pragul lucrări 2026).
const TERMEN = '2026-10-14T12:00:00+00:00'
const FISA = `Numar zile pana la care se pot solicita clarificari inainte de data limita de depunere a ofertelor/candidaturilor 18
...
Termenul limita in care autoritatea contractanta va raspunde in mod clar si complet tuturor solicitarilor de clarificari/informatii
suplimentare este cu 11 zile inainte de data limita de depunere a ofertelor. Numar zile pana la care se pot solicita clarificari inainte
de data limita de depunere a ofertelor/candidaturilor: 18 zile.`

describe('zile pe ora României', () => {
  it('ziRo: 12:00 UTC în octombrie = aceeași zi (15:00 RO); 22:30 UTC = ziua următoare', () => {
    expect(ziRo(TERMEN)).toBe('2026-10-14')
    expect(ziRo('2026-10-14T22:30:00Z')).toBe('2026-10-15')
    expect(ziRo(null)).toBeNull()
    expect(ziRo('nu e data')).toBeNull()
  })
  it('plusZile / zileIntre trec peste schimbarea orei (25.10.2026) fără să piardă o zi', () => {
    expect(plusZile('2026-10-14', -18)).toBe('2026-09-26')
    expect(plusZile('2026-10-14', -11)).toBe('2026-10-03')
    expect(plusZile('2026-10-24', 3)).toBe('2026-10-27')
    expect(zileIntre('2026-10-24', '2026-10-27')).toBe(3)
    expect(zileIntre('2026-10-05', '2026-10-14')).toBe(9)
  })
})

describe('extrageZileDinFisa', () => {
  it('citește 18 zile întrebări și 11 zile răspuns din formulările SEAP (cu și fără diacritice)', () => {
    expect(extrageZileDinFisa(FISA)).toEqual({ zileIntrebari: 18, zileRaspuns: 11 })
    expect(extrageZileDinFisa(FISA.replace(/raspunde/g, 'răspunde').replace(/inainte/g, 'înainte'))).toEqual({ zileIntrebari: 18, zileRaspuns: 11 })
  })
  it('nu inventează: text fără cifre → null', () => {
    expect(extrageZileDinFisa('')).toEqual({ zileIntrebari: null, zileRaspuns: null })
    expect(extrageZileDinFisa('se pot solicita clarificari conform legii')).toEqual({ zileIntrebari: null, zileRaspuns: null })
    expect(extrageZileDinFisa('Se pot solicita clarificari conform art. 8 din documentatie.').zileIntrebari).toBeNull()
  })
  it('formulările reale din alte fișe: „in a 6-a zi inainte”, „in a 7 a zi inainte”, „cu 5 zile inainte … primite cu 9 zile”', () => {
    expect(extrageZileDinFisa('ACstabileste unul sau doua termene limita in care va raspunde in mod clar si complet\ntuturor solicitarilor. Raspunsurile vor fi publicate, dupa\ncum urmeaza:\n- termen-limita de raspuns este in a 6-a zi inainte de data limita').zileRaspuns).toBe(6)
    expect(extrageZileDinFisa('Autoritatea contractanta va raspunde in\nmod clar si complet tuturor solicitarilor de clarificari in a 7 a zi inainte de data limita').zileRaspuns).toBe(7)
    expect(extrageZileDinFisa('Autoritatea contractanta va raspunde in mod cIar si complet tuturor solicitarilor de clarificari/informatiiIor suplimentare cu 5 zile\ninainte de termenul stabilit pentru depunerea ofertelor, la toate solicitarile de clarificari primite cu 9 zile inainte').zileRaspuns).toBe(5)
  })
  it('review Jakarinos 05.10: „în a 6-a zi” cu diacritice e recunoscut; „primite cu 9 zile” fără cifra răspunsului NU devine răspuns', () => {
    expect(extrageZileDinFisa('AC va răspunde în mod clar și complet în a 6-a zi înainte de data limită').zileRaspuns).toBe(6)
    expect(extrageZileDinFisa('AC va raspunde in mod clar si complet la toate solicitarile de clarificari primite cu 9 zile inainte de termen').zileRaspuns).toBeNull()
  })
  it('review Jakarinos r1: „solicitarilor primite cu 18 zile … Raspunsul consolidat se publica cu 11 zile” → 11; newline înainte de cifră e permis', () => {
    expect(extrageZileDinFisa('Autoritatea va raspunde tuturor solicitarilor primite cu 18 zile inainte de depunere. Raspunsul consolidat se publica cu 11 zile inainte de depunere.').zileRaspuns).toBe(11)
    expect(extrageZileDinFisa('Numar zile pana la care se pot solicita clarificari inainte de data limita de depunere a ofertelor/candidaturilor\n18').zileIntrebari).toBe(18)
  })
  it('review Jakarinos r2 N3: „solicitarilor primite, cu 11 zile inainte” (virgulă) e termen de răspuns → 11', () => {
    expect(extrageZileDinFisa('Autoritatea va raspunde solicitarilor primite, cu 11 zile inainte de data limita.').zileRaspuns).toBe(11)
  })
  it('review Jakarinos r3 B1/B2: cifra din propoziția vecină („Vizita … cu 5 zile”) nu e răspuns; „primite” + 41 de spații tot exclude', () => {
    expect(extrageZileDinFisa('AC va raspunde solicitarilor primite cu 18 zile inainte de depunere. Vizita amplasamentului se organizeaza cu 5 zile inainte de depunere.').zileRaspuns).toBeNull()
    expect(extrageZileDinFisa('AC va raspunde solicitarilor primite' + ' '.repeat(41) + 'cu 9 zile inainte').zileRaspuns).toBeNull()
  })
  it('fișa reală lic. 103: răspunsul e în a doua propoziție („Raspunsurile … dupa cum urmeaza: - termen-limita … in a 6-a zi”)', () => {
    expect(extrageZileDinFisa('In conformitate cu art. 161 din Legea 98/2016, ACstabileste unul sau doua termene limita in care va raspunde in mod clar si complet\ntuturor solicitarilor de clarificari/informatii suplimentare. Raspunsurile vor fi incarcate si publicate, in mod consolidat, in SEAP, dupa\ncum urmeaza:\n- termen-limita de raspuns este in a 6-a zi inainte de data limita de depunere a ofertelor.\nTermenul de raspuns la clarificari a fost stabilit astfel incat').zileRaspuns).toBe(6)
  })
  it('combinaFise ia fiecare cifră din prima parte care o are (fișă spartă în două)', () => {
    expect(combinaFise([{ id: 1, text_extras: 'se pot solicita clarificari inainte de data limita de depunere a ofertelor 18' }, { id: 2, text_extras: 'AC va raspunde cu 11 zile inainte' }])).toEqual({ zileIntrebari: 18, zileRaspuns: 11, docIntrebari: 1, docRaspuns: 2 })
    expect(combinaFise([])).toEqual({ zileIntrebari: null, zileRaspuns: null, docIntrebari: null, docRaspuns: null })
  })
  it('ziValida respinge 2026-02-31', () => {
    expect(ziValida('2026-02-31')).toBeNull(); expect(ziValida('2026-10-14')).toBe('2026-10-14'); expect(ziValida('azi')).toBeNull()
  })
  it('plusZile nu aruncă la valori absurde', () => {
    expect(plusZile('2026-10-14', 1e12)).toBeNull()
    expect(plusZile('2026-10-14', NaN)).toBeNull()
  })
})

describe('acteContestabile', () => {
  it('grupează pe ziua publicării; tipul dominant: erată > răspuns > document nou; data = data_document din citire, altfel created_at', () => {
    const acte = acteContestabile([
      { id: 1, tip: 'fisa_date', created_at: '2026-08-25T08:00:00Z' },
      { id: 126, tip: 'alta', aparut_ulterior: true, nume_original: 'ATR.pdf', created_at: '2026-08-29T05:24:50Z' },
      { id: 130, tip: 'plansa', aparut_ulterior: true, nume_original: 'plan.pdf', created_at: '2026-08-29T05:25:02Z' },
      { id: 317, tip: 'raspuns_clarificare', nume_original: 'Clarificare_Oficiu_Automata.pdf', created_at: '2026-09-16T08:27:44Z', citire: { tip: 'erata', data_document: '2026-09-14' } },
      { id: 1305, tip: 'raspuns_clarificare', nume_original: 'DOC_F1_F6_C1_C9.rar', aparut_ulterior: true, created_at: '2026-10-02T12:50:00Z' },
    ])
    expect(acte.map(a => [a.zi, a.tip, a.docs.length, a.areRaspuns, a.sursaZi])).toEqual([['2026-08-29', 'document_nou', 2, false, 'import'], ['2026-09-14', 'erata', 1, true, 'citire'], ['2026-10-02', 'raspuns_clarificare', 1, true, 'import']])
  })
  it('o erată fără tip răspuns NU e răspuns (areRaspuns=false) și nu stinge alerta de întârziere; data AI imposibilă → ziua importului', () => {
    const acte = acteContestabile([{ id: 5, tip: 'alta', nume_original: 'erata.pdf', created_at: '2026-10-02T09:00:00Z', citire: { tip: 'erata', data_document: '2026-02-31' } }])
    expect(acte).toEqual([{ zi: '2026-10-02', tip: 'erata', docs: [{ id: 5, nume: 'erata.pdf' }], areRaspuns: false, sursaZi: 'import' }])
    const mixt = acteContestabile([
      { id: 6, tip: 'alta', aparut_ulterior: true, created_at: '2026-10-02T09:00:00Z', citire: { data_document: '2026-10-02' } },
      { id: 7, tip: 'alta', aparut_ulterior: true, created_at: '2026-10-02T10:00:00Z' },
    ])
    expect(mixt[0].sursaZi).toBe('mixt')
    expect(acteContestabile([mixt && { id: 7, tip: 'alta', aparut_ulterior: true, created_at: '2026-10-02T10:00:00Z' }, { id: 6, tip: 'alta', aparut_ulterior: true, created_at: '2026-10-02T09:00:00Z', citire: { data_document: '2026-10-02' } }])[0].sursaZi).toBe('mixt')
    const r = calculeazaTermene({ termenDepunere: '2026-10-14T12:00:00Z', zileIntrebari: 18, zileRaspuns: 11, canal: 'seap_cn', acum: new Date('2026-10-05T10:00:00Z'),
      docs: [{ id: 5, tip: 'alta', created_at: '2026-10-02T09:00:00Z', citire: { tip: 'erata' } }] })
    expect(r.intarziereAC).toBe(true); expect(r.ultimRaspuns).toBeNull()
  })
})

describe('canalDinAnunt', () => {
  it('numărul anunțului bate câmpul canal (lic. 3: CN1095546 cu canal seap_scn)', () => {
    expect(canalDinAnunt('CN1095546', 'seap_scn')).toBe('seap_cn')
    expect(canalDinAnunt('SCN1172880', 'seap_cn')).toBe('seap_scn')
    expect(canalDinAnunt('DF1278266', 'seap_cn')).toBe('seap_cn')
    expect(canalDinAnunt(null, null)).toBeNull()
  })
})

describe('calculeazaTermene — Mânăstirea pe 05.10.2026', () => {
  const docs = [
    { id: 126, tip: 'alta', aparut_ulterior: true, nume_original: 'ATR.pdf', created_at: '2026-08-29T05:24:50Z' },
    { id: 317, tip: 'raspuns_clarificare', nume_original: 'erata.pdf', created_at: '2026-09-16T08:27:44Z', citire: { tip: 'erata', data_document: '2026-09-14' } },
    { id: 1305, tip: 'raspuns_clarificare', nume_original: 'DOC_F1_F6_C1_C9.rar', aparut_ulterior: true, created_at: '2026-10-02T12:50:00Z' },
  ]
  const r = calculeazaTermene({ termenDepunere: TERMEN, ...extrageZileDinFisa(FISA), canal: 'seap_cn', valoareEstimata: 29264199.92, docs, acum: new Date('2026-10-05T10:00:00Z') })

  it('reperele din fișă: întrebări 26.09 (trecut), răspuns 03.10 (trecut), depunere 14.10 15:00 (9 zile)', () => {
    const byKey = Object.fromEntries(r.repere.map(x => [x.cheie, x]))
    expect(byKey.intrebari.zi).toBe('2026-09-26'); expect(byKey.intrebari.stare).toBe('trecut')
    expect(byKey.raspuns.zi).toBe('2026-10-03'); expect(byKey.raspuns.stare).toBe('trecut'); expect(byKey.raspuns.sursa).toMatch(/fișa de date: 11/)
    expect(byKey.depunere.zi).toBe('2026-10-14'); expect(byKey.depunere.zile).toBe(9); expect(byKey.depunere.ora).toBe('15:00')
  })
  it('peste prag → contestație 10 zile: RAR din 02.10 → 12.10 (viitor), erata din 14.09 → 24.09 (trecut), lotul din 29.08 → 08.09; cele mai recente primele', () => {
    expect(r.prag).toEqual({ lei: PRAG_LUCRARI_LEI, peste: true, zile: 10 })
    expect(r.contestatii.map(c => [c.zi, c.tip, c.pana_la, c.stare])).toEqual([['2026-10-02', 'raspuns_clarificare', '2026-10-12', 'viitor'], ['2026-09-14', 'erata', '2026-09-24', 'trecut'], ['2026-08-29', 'document_nou', '2026-09-08', 'trecut']])
  })
  it('cu RAR-ul din 02.10 (tip răspuns) nu mai e întârziere formală, dar ultimRaspuns spune ce trebuie verificat', () => {
    expect(r.intarziereAC).toBe(false)
    expect(r.ultimRaspuns).toBe('2026-10-02')
  })
  it('AC în întârziere: termenul de răspuns a trecut și singurul „răspuns” e erata dinaintea termenului de întrebări', () => {
    const r2 = calculeazaTermene({ termenDepunere: TERMEN, ...extrageZileDinFisa(FISA), canal: 'seap_cn', valoareEstimata: 29264199.92, acum: new Date('2026-10-05T10:00:00Z'), docs: docs.filter(d => d.id !== 1305) })
    expect(r2.intarziereAC).toBe(true)
    expect(r2.ultimRaspuns).toBe('2026-09-14')
  })
  it('înainte de termenul de răspuns nu e întârziere, oricât de goală ar fi lista', () => {
    const r3 = calculeazaTermene({ termenDepunere: TERMEN, zileIntrebari: 18, zileRaspuns: 11, canal: 'seap_cn', docs: [], acum: new Date('2026-10-01T10:00:00Z') })
    expect(r3.intarziereAC).toBe(false); expect(r3.ultimRaspuns).toBeNull()
  })
  it('sub prag → 7 zile; fără valoare → fără contestații; SCN fără fișă → 6 zile implicit', () => {
    const sub = calculeazaTermene({ termenDepunere: TERMEN, zileIntrebari: 18, zileRaspuns: 11, canal: 'seap_cn', valoareEstimata: 5_000_000, docs, acum: new Date('2026-10-05T10:00:00Z') })
    expect(sub.prag.zile).toBe(7); expect(sub.contestatii[0].pana_la).toBe('2026-10-09')
    const fara = calculeazaTermene({ termenDepunere: TERMEN, canal: 'seap_scn', docs, acum: new Date('2026-10-05T10:00:00Z') })
    expect(fara.contestatii).toEqual([]); expect(fara.prag.peste).toBeNull()
    const byKey = Object.fromEntries(fara.repere.map(x => [x.cheie, x]))
    expect(byKey.raspuns.zi).toBe('2026-10-08'); expect(byKey.raspuns.sursa).toMatch(/implicit L98 art. 161: 6/)
    expect(byKey.intrebari.zi).toBeNull()
  })
  it('fără termen de depunere → fără repere, fără întârziere', () => {
    const x = calculeazaTermene({ termenDepunere: null, docs, acum: new Date('2026-10-05T10:00:00Z') })
    expect(x.repere).toEqual([]); expect(x.intarziereAC).toBe(false)
  })
})
