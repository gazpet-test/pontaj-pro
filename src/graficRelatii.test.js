// PR 1 Laza (14.09.2026) — „graficul spune adevărul".
// Fixture reală: Anexa 5 din răspunsul la clarificări Laza (derivată 1:1 din Anexa 9/11 a ofertei
// depuse pe 10.07.2026): 66 activități, ES/EF/durată/marjă/critic. Predecesorii vin din Anexa 9
// (fixture separat, test-fixtures/laza/anexa9_predecesori.json, când e transcris).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { verificaRelatii, detecteazaConventie, textToPred, predToText, calcCPM } from './graficCPM.js'
import { controlRelatiiGrafic, controlGraficSursa, normalizeazaActivitati, controlPachetComplet } from './ofertareControale.js'
import { evalueazaPoarta } from './ofertarePoarta.js'

const anexa5 = JSON.parse(readFileSync(new URL('../test-fixtures/laza/anexa5_activitati.json', import.meta.url), 'utf8'))

describe('graficCPM — parserul de relații', () => {
  it('citește FS/SS/FF/SF cu lag pozitiv sau negativ (lead)', () => {
    expect(textToPred('3FS, 5SS+10, 7FF-2, 9SF')).toEqual([
      { id: 3, tip: 'FS', lag: 0 }, { id: 5, tip: 'SS', lag: 10 }, { id: 7, tip: 'FF', lag: -2 }, { id: 9, tip: 'SF', lag: 0 }])
  })
  it('dus-întors: textul rămâne același', () => {
    const t = '3FS, 5SS+10, 7FF-2'
    expect(predToText(textToPred(t))).toBe(t)
  })
  it('calcCPM rămâne cum era: sfârșit exclusiv, drum critic', () => {
    const { rez, total } = calcCPM([{ id: 1, durata_zile: 5, predecesori: [] }, { id: 2, durata_zile: 3, predecesori: [{ id: 1, tip: 'FS', lag: 0 }] }])
    expect(total).toBe(8); expect(rez[2].es).toBe(5); expect(rez[2].critic).toBe(true)
  })
})

describe('verificaRelatii — declarațiile se țin între ele?', () => {
  it('FS cu suprapunere = conflict, cu numărul de zile', () => {
    const v = verificaRelatii([{ cod: 'A', es: 1, durata: 10, ef: 10 }, { cod: 'B', es: 5, durata: 5, ef: 9, predecesori: [{ cod: 'A', relatie: 'FS' }] }])
    expect(v.conventie).toBe('inclusiv'); expect(v.conflicte).toBe(1)
    expect(v.probleme[0]).toMatchObject({ cod: 'RELATION_DATE_CONFLICT', succesor: 'B', predecesor: 'A', asteptat_minim: 11, declarat: 5, suprapunere_zile: 6 })
  })
  it('aceeași suprapunere declarată SS sau FS cu lead e consistentă — NU se corectează, se descrie', () => {
    const A = { cod: 'A', es: 1, durata: 10, ef: 10 }
    expect(verificaRelatii([A, { cod: 'B', es: 5, durata: 5, ef: 9, predecesori: [{ cod: 'A', relatie: 'SS', lag: 4 }] }]).conflicte).toBe(0)
    expect(verificaRelatii([A, { cod: 'B', es: 5, durata: 5, ef: 9, predecesori: [{ cod: 'A', relatie: 'FS', lag: -6 }] }]).conflicte).toBe(0)
  })
  it('FF și SF', () => {
    const A = { cod: 'A', es: 1, durata: 10, ef: 10 }
    expect(verificaRelatii([A, { cod: 'B', es: 8, durata: 2, ef: 9, predecesori: [{ cod: 'A', relatie: 'FF' }] }]).conflicte).toBe(1)
    expect(verificaRelatii([A, { cod: 'B', es: 1, durata: 1, ef: 1, predecesori: [{ cod: 'A', relatie: 'SF' }] }]).conflicte).toBe(0)
  })
  it('predecesor inexistent și tip necunoscut se raportează, nu se ignoră', () => {
    const v = verificaRelatii([{ cod: 'A', es: 1, durata: 1, ef: 1 }, { cod: 'B', es: 2, durata: 1, ef: 2, predecesori: [{ cod: 'Z', relatie: 'FS' }, { cod: 'A', relatie: 'XX' }] }])
    expect(v.probleme.map(p => p.cod).sort()).toEqual(['MISSING_PREDECESSOR', 'UNKNOWN_RELATION_TYPE'])
  })
  it('convenția exclusivă (ef = es + d) se detectează și FS nu cere +1', () => {
    const v = verificaRelatii([{ cod: 'A', es: 0, durata: 10, ef: 10 }, { cod: 'B', es: 10, durata: 5, ef: 15, predecesori: [{ cod: 'A', relatie: 'FS' }] }])
    expect(v.conventie).toBe('exclusiv'); expect(v.conflicte).toBe(0)
  })
})

describe('FIXTURE Laza — Anexa 5 (66 activități, așa cum au fost depuse)', () => {
  const acts = anexa5.activitati
  it('66 activități, 7 pachete, convenție inclusivă pe toate rândurile', () => {
    expect(acts).toHaveLength(66)
    expect(new Set(acts.map(a => a.pachet)).size).toBe(7)
    expect(detecteazaConventie(acts)).toBe('inclusiv')
    expect(acts.every(a => a.ef === a.es + a.durata - 1)).toBe(true)
  })
  it('41 pe drumul critic; ultima activitate se termină în ziua 617, nu 660 (termenul ofertat)', () => {
    expect(acts.filter(a => a.critic)).toHaveLength(41)
    expect(Math.max(...acts.map(a => a.ef))).toBe(617)
  })
  it('fără predecesori (Anexa 5 nu-i are) controlul NU trece verde: spune că n-are ce verifica', () => {
    const c = controlRelatiiGrafic({ grafic_versiune: 1, grafic_versiune_mod: 'import', grafic_activitati_declarate: acts })
    expect(c.stare).toBe('warn'); expect(c.cod).toBe('NO_RELATIONS_DECLARED')
  })
})

describe('controlRelatiiGrafic — rândul de poartă', () => {
  it('fără versiune înghețată = warn, nu ok (verdele pe gol)', () => {
    expect(controlRelatiiGrafic({ grafic_versiune: null, grafic_activitati_declarate: null }).stare).toBe('warn')
  })
  it('grafic generat de motor (fără es/ef declarate) = ok, cu explicație', () => {
    const c = controlRelatiiGrafic({ grafic_versiune: 2, grafic_activitati_declarate: [{ id: 1, durata_zile: 5, predecesori: [] }, { id: 2, durata_zile: 3, predecesori: [{ id: 1, tip: 'FS', lag: 0 }] }] })
    expect(c.stare).toBe('ok'); expect(c.detalii).toMatch(/generat[ăa] de motor/)
  })
  it('conflict declarat = block RELATION_DATE_CONFLICT și numește perechea', () => {
    const c = controlRelatiiGrafic({ grafic_versiune: 1, grafic_activitati_declarate: [
      { cod: '1.2.01', es: 47, durata: 25, ef: 71 }, { cod: '1.2.02', es: 59, durata: 12, ef: 70, predecesori: [{ cod: '1.2.01', relatie: 'FS' }] }] })
    expect(c.stare).toBe('block'); expect(c.cod).toBe('RELATION_DATE_CONFLICT'); expect(c.detalii).toMatch(/1\.2\.01→1\.2\.02 FS/)
  })
  it('normalizează ambele forme de snapshot (motor: id/tip/durata_zile; import: cod/relatie/durata)', () => {
    const n = normalizeazaActivitati([{ id: 7, durata_zile: 3, predecesori: [{ id: 5, tip: 'ss', lag: 2 }] }, { cod: 'X', durata: 1, es: 1, ef: 1 }])
    expect(n[0]).toMatchObject({ cod: '7', durata: 3, predecesori: [{ cod: '5', relatie: 'SS', lag: 2 }] })
    expect(n[1]).toMatchObject({ cod: 'X', durata: 1, es: 1 })
  })
})

describe('controlGraficSursa — piesa de grafic vine dintr-o versiune înghețată?', () => {
  it('pachet fără piese de grafic = ok', () => {
    expect(controlGraficSursa({ pachet_fisiere: [{ nume: 'Formular 12.pdf' }], grafic_versiune: null }).stare).toBe('ok')
  })
  it('Gantt/PERT în pachet și nicio versiune înghețată = block (cazul Laza: grafic în Word)', () => {
    const c = controlGraficSursa({ pachet_fisiere: [{ nume: 'Anexa 9 Grafic Gantt.pdf' }, { nume: 'Anexa 11 Diagrama PERT.pdf' }], grafic_versiune: null })
    expect(c.stare).toBe('block'); expect(c.cod).toBe('SCHEDULE_NOT_FROM_FROZEN_VERSION'); expect(c.piese).toHaveLength(2)
  })
  it('cu versiune înghețată = ok și spune de unde vine', () => {
    expect(controlGraficSursa({ pachet_fisiere: [{ rol: 'grafic' , nume: 'g.pdf' }], grafic_versiune: 3, grafic_versiune_mod: 'import' }).detalii).toMatch(/versiunea înghețată 3 \(import\)/)
  })
})

describe('controlPachetComplet — piesele neidentificabile nu mai dispar (Pantea)', () => {
  it('„Formular profil Pantea" n-are (tip, număr): se numără și controlul iese warn, nu ok', () => {
    const c = controlPachetComplet({
      anexe_declarate: [{ ref: 'Anexa 7', sursa: 'opis' }, { ref: 'Formular profil Pantea Constantin', sursa: 'opis' }],
      pachet_stare: 'depus', pachet_fisiere: [{ nume: 'Anexa 7.pdf', anexa_ref: 'Anexa 7' }],
    })
    expect(c.stare).toBe('warn'); expect(c.cod).toBe('UNIDENTIFIED_DECLARED_PIECE')
    expect(c.neidentificate).toEqual(['Formular profil Pantea Constantin'])
    expect(c.detalii).toMatch(/Pantea/)
  })
})

describe('poarta — rândurile noi ajung în verdict', () => {
  it('conflictul din grafic blochează poarta cu cheia grafic_relatii', () => {
    const st = { capitole: 1, de_raspuns: 0, fara_capitol: 0, afirmatii: 1, documente: 1, grafic_versiune: 1,
      grafic_activitati_declarate: [{ cod: 'A', es: 1, durata: 10, ef: 10 }, { cod: 'B', es: 5, durata: 5, ef: 9, predecesori: [{ cod: 'A', relatie: 'FS' }] }] }
    expect(evalueazaPoarta(st).blocaje).toContain('grafic_relatii')
  })
})

// ════════════════════════════════════════════════════════════════
// FIXTURE Laza — graficul DEPUS, din fișierul-sursă (Drive, modificat 10.07.2026 10:38, ziua
// depunerii): foaia PERT = Anexa 11, foaia Gantt = Anexa 9. 66 activități, 59 relații, toate FS.
// Constatarea liniei de cercetare (din PDF): 16 din 66 relații FS au ES(succ) < EF(pred).
// Aici se reproduce independent, din sursă, nu din PDF — dacă numărul se schimbă, cineva a
// atins fie fixture-ul, fie regula.
// ════════════════════════════════════════════════════════════════
const depus = JSON.parse(readFileSync(new URL('../test-fixtures/laza/grafic_pert_depus.json', import.meta.url), 'utf8'))
describe('FIXTURE Laza — PERT depus: 16 relații FS contrazise de propriile date', () => {
  const acts = depus.activitati
  it('66 activități, 59 relații declarate, toate FS, 7 fără predecesor (începuturi de pachet)', () => {
    expect(acts).toHaveLength(66)
    const rel = acts.flatMap(a => a.predecesori)
    expect(rel).toHaveLength(59); expect(rel.every(p => p.relatie === 'FS' && p.lag === 0)).toBe(true)
    expect(acts.filter(a => !a.predecesori.length)).toHaveLength(7)
    expect(depus.predecesori_neparsati).toEqual([])
  })
  it('convenție inclusivă (EF = ES + D − 1) pe toate rândurile; PERT-ul și Anexa 5 spun același lucru', () => {
    expect(acts.every(a => a.ef === a.es + a.durata - 1)).toBe(true)
    const a5 = new Map(anexa5.activitati.map(a => [a.cod, a]))
    expect(acts.every(a => a5.get(a.cod)?.es === a.es && a5.get(a.cod)?.ef === a.ef)).toBe(true)
  })
  it('EXACT 16 conflicte RELATION_DATE_CONFLICT, cu perechile reale', () => {
    const v = verificaRelatii(acts)
    expect(v.conventie).toBe('inclusiv'); expect(v.relatii).toBe(59); expect(v.conflicte).toBe(16)
    expect(v.probleme.every(p => p.cod === 'RELATION_DATE_CONFLICT')).toBe(true)
    expect(v.probleme.map(p => `${p.predecesor}>${p.succesor}`)).toEqual([
      '1.1.01>1.1.02', '1.1.02>1.1.03', '1.1.03>1.1.04', '1.2.01>1.2.02', '1.2.06>1.2.07', '1.2.09>1.2.10',
      '1.3.06>1.3.07', '1.3.14>1.3.15', '1.4.05>1.4.06', '1.5.06>1.5.07', '1.5.07>1.5.08', '1.5.08>1.5.09',
      '1.6.03>1.6.04', '1.7.02>1.7.03', '1.7.04>1.7.05', '1.7.06>1.7.07'])
  })
  it('cea mai mare suprapunere: 1.5.08→1.5.09, 16 zile; cea mai mică: 1.6.03→1.6.04, 3 zile', () => {
    const v = verificaRelatii(acts)
    const s = v.probleme.map(p => p.suprapunere_zile)
    expect(Math.max(...s)).toBe(16); expect(Math.min(...s)).toBe(3)
  })
  it('primele 4 conflicte sunt chiar pe drumul critic (marjă 0) — drumul critic declarat nu se ține', () => {
    const v = verificaRelatii(acts)
    const byCod = new Map(acts.map(a => [a.cod, a]))
    const critice = v.probleme.filter(p => byCod.get(p.succesor).critic && byCod.get(p.succesor).marja === 0)
    expect(critice.length).toBeGreaterThanOrEqual(4)
    expect(critice.slice(0, 3).map(p => p.succesor)).toEqual(['1.1.02', '1.1.03', '1.1.04'])
  })
  it('rândul de poartă blochează pe acest grafic, cu codul și primele perechi în text', () => {
    const c = controlRelatiiGrafic({ grafic_versiune: 1, grafic_versiune_mod: 'import', grafic_activitati_declarate: acts })
    expect(c.stare).toBe('block'); expect(c.cod).toBe('RELATION_DATE_CONFLICT')
    expect(c.detalii).toMatch(/16 din 59 relații/); expect(c.detalii).toMatch(/1\.1\.01→1\.1\.02 FS \(începe cu 5 zile înainte\)/)
  })
  it('dacă aceleași suprapuneri ar fi fost declarate FS cu lead, graficul ar fi consistent — controlul nu inventează asta, dar o poate confirma', () => {
    const v0 = verificaRelatii(acts)
    const cu = new Map(v0.probleme.map(p => [`${p.predecesor}>${p.succesor}`, p.suprapunere_zile]))
    const corectat = acts.map(a => ({ ...a, predecesori: a.predecesori.map(p => ({ ...p, lag: -(cu.get(`${p.cod}>${a.cod}`) || 0) })) }))
    expect(verificaRelatii(corectat).conflicte).toBe(0)
  })
})
