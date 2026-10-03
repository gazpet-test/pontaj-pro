// Teste pentru prototipul B „Necesită atenția ta" — contractul construiesteAtentia v1 (Audit V2).
// Fiecare caz negativ N1–N34 din contract are cel puțin un test; invarianții I1–I16 se verifică pe TOATE ieșirile.
import fs from 'node:fs'
import { describe, it, expect, vi, afterEach } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  construiesteAtentia, construiesteCuprins, normalizeazaSnapshot, doveditaR06, favorabila, reverif,
  ETICHETA_SIMULAT, NEGATIE_GATA, INTENTII_PERMISE, REGEX_JUDECATA_IN_BLOC, RANG_CLASA, SURSE_OBLIGATORII, PRAGURI_IMPLICITE,
} from './atentie.js'
import { cuEroare, snapshotSintetic, creeazaIncarcator, LICITATIE_A, LICITATIE_B } from './scenarii.js'
import PtNecesitaAtentia, { EcranAtentie, destinatieDuMa } from './PtNecesitaAtentia.jsx'

const h = React.createElement   // fișierul de test e .js: fără JSX

// Fixture-ul clonei 103 (date reale anonimizate) NU se comite: e opțional. Fără el, testele pe 103 se sar,
// iar cele pe snapshoturi sintetice rulează (ca `npm test` să rămână verde pe CI / pe un checkout curat).
const FIXTURI = import.meta.glob('./fixtures/l103.json', { eager: true, import: 'default' })
const fixture = FIXTURI['./fixtures/l103.json'] ?? null
const ARE_FIXTURE = fixture != null
const it103 = it.skipIf(!ARE_FIXTURE)
const describe103 = describe.skipIf(!ARE_FIXTURE)

const L = 103
const CAPT = fixture?.meta?.capturat_la ?? '2026-09-29T20:13:42.097601+00:00'
const MIN = 60e3
const dupa = ms => Date.parse(CAPT) + ms
const S103 = ARE_FIXTURE ? normalizeazaSnapshot(fixture) : null
const r103 = ARE_FIXTURE ? construiesteAtentia(S103, { acum: dupa(5 * MIN), licitatieId: L }) : null

// ── utilitare de test ────────────────────────────────────────────────────────────────────────────
const clona = x => JSON.parse(JSON.stringify(x))
const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze) } return o }
const ex = (r, id) => r.exceptii.find(e => e.id === id)
const exR = (r, regula) => r.exceptii.filter(e => e.regula === regula)
const okId = (r, id) => r.ok.find(o => o.id === id)
const sumEl = lst => lst.reduce((s, e) => s + (e.elemente?.length || 0), 0)
const cerIn = (r, regula) => exR(r, regula).flatMap(e => (e.elemente || []).map(x => x.cerinta_id))
const indIds = r => r.indisponibile.map(i => i.id)
const RANG_P = { pt: 0, depunere: 1, pachet: 2, f9: 3 }
const nrNum = nr => { const n = typeof nr === 'number' ? nr : parseFloat(String(nr ?? '')); return Number.isFinite(n) ? n : Infinity }

// Toate string-urile ieșirii, fără textele CITATE din surse (N33 privește textul autorului, nu datele):
// câmpurile cu text extern (documentație, capitole, AI) + titlurile de capitol din tinta.
const CHEI_EXTERNE = new Set(['text_sursa', 'document_probant', 'citat', 'locator', 'constatare'])
function textePentruScanare(r) {
  const citate = new Set()
  const colecteaza = (v, k) => {
    if (Array.isArray(v)) return v.forEach(x => colecteaza(x))
    if (v && typeof v === 'object') { for (const [kk, vv] of Object.entries(v)) colecteaza(vv, kk); return }
    if (typeof v === 'string' && CHEI_EXTERNE.has(k)) citate.add(v)
  }
  colecteaza(r)
  for (const e of r.exceptii) if (e.tinta?.capitol?.titlu) citate.add(e.tinta.capitol.titlu)
  const out = []
  const parcurge = (v, k) => {
    if (Array.isArray(v)) return v.forEach(x => parcurge(x))
    if (v && typeof v === 'object') { for (const [kk, vv] of Object.entries(v)) if (!CHEI_EXTERNE.has(kk)) parcurge(vv, kk); return }
    if (typeof v === 'string') { let s = v; for (const c of [...citate].sort((a, b) => b.length - a.length)) s = s.split(c).join(''); out.push(s) }
  }
  parcurge(r)
  return out
}

// Invarianții I2–I16 pe orice rezultat (nu pe null)
function verificaInvarianti(r, L = 103) {
  const v = r.verdict
  // I2
  expect(v.simulat).toBe(true); expect(v.sursa).toBe(ETICHETA_SIMULAT); expect(v.eticheta).toContain(ETICHETA_SIMULAT); expect(v.nu_inseamna_gata_de_depus).toBe(true)
  // I3
  expect(['BLOCKED', 'WARN', 'OK', 'INDISPONIBIL']).toContain(v.stare)
  // I4
  if (v.stare === 'OK') { expect(r.exceptii).toEqual([]); expect(r.indisponibile).toEqual([]) }
  // I5
  if (r.indisponibile.length) expect(['INDISPONIBIL', 'BLOCKED']).toContain(v.stare)
  // I6
  expect(v.stare === 'BLOCKED').toBe(r.exceptii.some(e => e.blocheaza_final && !e.din_date_expirate))
  // I7
  for (const e of r.exceptii) if (e.clasa === 'BLOCK') expect(e.blocheaza_final).toBe(true)
  // I8
  for (const o of r.ok) expect(['om', 'server', 'regula_client']).toContain(o.provenienta.sursa)
  // I10
  const actiuni = [...r.exceptii.flatMap(e => [e.actiune_umana, ...(e.elemente || []).map(x => x.actiune).filter(Boolean)]), ...r.indisponibile.map(i => i.actiune_umana)]
  for (const a of actiuni) {
    expect(a.scrie).toBe(false); expect(INTENTII_PERMISE).toContain(a.intent)
    expect(REGEX_JUDECATA_IN_BLOC.test(a.eticheta)).toBe(false); expect(REGEX_JUDECATA_IN_BLOC.test(a.intent)).toBe(false)
    expect(a.parametri.licitatie_id).toBe(L)
  }
  // I11
  const perechi = new Set()
  for (const e of r.exceptii) {
    if (e.elemente) expect(e.numar).toBe(e.elemente.length)
    if (['integritate', 'prospetime'].includes(e.domeniu) || e.aspect == null) continue
    for (const x of e.elemente || []) if (x.cerinta_id != null) {
      const k = `${x.cerinta_id}|${e.aspect}`
      expect(perechi.has(k), `pereche dublată ${k} în ${e.id}`).toBe(false); perechi.add(k)
    }
  }
  // I14
  for (const e of r.exceptii) { expect(e.tinta.licitatie_id).toBe(L); expect(typeof e.provenienta.citit_la).toBe('string') }
  // I15: id-uri unice + ordinea din §8
  const ids = r.exceptii.map(e => e.id); expect(new Set(ids).size).toBe(ids.length)
  expect(new Set(r.ok.map(o => o.id)).size).toBe(r.ok.length)
  expect(new Set(r.indisponibile.map(i => i.id)).size).toBe(r.indisponibile.length)
  const cheie = e => [e.blocheaza_final ? 0 : 1, RANG_CLASA[e.clasa], e.porti?.length ? (RANG_P[e.porti[0]] ?? 4) : 4, e.tinta?.capitol ? nrNum(e.tinta.capitol.nr) : Infinity]
  for (let i = 1; i < r.exceptii.length; i++) {
    const a = cheie(r.exceptii[i - 1]), b = cheie(r.exceptii[i])
    const cmp = a.map((x, j) => (x < b[j] ? -1 : x > b[j] ? 1 : 0)).find(x => x !== 0) ?? (r.exceptii[i - 1].id < r.exceptii[i].id ? -1 : 1)
    expect(cmp, `ordine ${r.exceptii[i - 1].id} → ${r.exceptii[i].id}`).toBe(-1)
  }
  expect(r.ok.map(o => o.id)).toEqual([...r.ok.map(o => o.id)].sort())
  // I16
  const cnt = cl => r.exceptii.filter(e => e.clasa === cl).length
  expect(v.contoare).toEqual({ BLOCK: cnt('BLOCK'), HUMAN_DECISION: cnt('HUMAN_DECISION'), CONFIRM: cnt('CONFIRM'), WARN: cnt('WARN'),
    ok: r.ok.length, indisponibile: r.indisponibile.length, blocheaza_final: r.exceptii.filter(e => e.blocheaza_final && !e.din_date_expirate).length })
  expect(v.motive.length).toBeLessThanOrEqual(5)
  // JSON pur
  expect(JSON.parse(JSON.stringify(r))).toEqual(r)
  // N33: nicio judecată în bloc în textele autorului; „gata de depus" doar în negație; fără READY
  for (const s of textePentruScanare(r)) {
    expect(REGEX_JUDECATA_IN_BLOC.test(s), `text: ${s.slice(0, 120)}`).toBe(false)
    expect(s.split(NEGATIE_GATA).join('')).not.toMatch(/gata de depus/i)
  }
  expect(JSON.stringify(r)).not.toMatch(/READY/)
}

// ── snapshot sintetic „curat": totul verificat de om, toate sursele ok și proaspete ──────────────────
const T0 = '2026-09-29T20:00:00.000Z'
const ACUM0 = Date.parse(T0) + MIN
const PT_CURAT = {
  licitatie_id: L, de_raspuns: 2, de_forma: 0, cu_capitol: 2, fara_capitol: 0, dovada_de_verificat: 0, inchise_cu_dovada: 0, exceptate: 0,
  capcane: 0, capcane_descoperite: 0, cerinte_neverificate: 0, capitole: 2, capitole_goale: 0, capitole_nu_e_cazul: 0, capitole_nescrise_de_om: 0,
  documente: 1, documente_necitite: 0, afirmatii: 3, afirmatii_blocante: 0, afirmatii_de_verificat: 0, observatii_deschise: 0,
  lista_f3_m: 1000, lista_c6_m: 1000, memoriu_m: 1000, plansa_m: 1000, grafic_fronturi_m: 1000,
  garantie_cerut_luni: 36, garantie_cerut_moment: 'pif', garantie_oferit_luni: 36, garantie_oferit_moment: 'pif',
  garantie_confirmata: true, garantie_justificata: false, garantie_luni_in_capitole: [36], garantie_cerinte_lucrari: 2,
  anexe_referite: ['anexa 7'], anexe_existente: ['Anexa 7'], fraze_anexe: [], capitole_ref: [], identitate_straine: [],
  bransamente_in_capitole: [372], bransamente_in_cerinte: [372], participanti: [], participanti_acte: [], fraze_asociere: [], declaratii_participare: [],
  grafic_versiune: 1, grafic_avertismente: 0, grafic_versiune_mod: 'oferta', grafic_activitati_declarate: [{ id: 1, durata_zile: 5, predecesori: [] }],
  anexe_declarate: [{ ref: 'Anexa 7', sursa: 'opis' }], anexe_asteptate: [], anexe_responsabili: {},
  pachet_stare: 'propus', pachet_fisiere: [{ nume: 'Anexa 7.pdf', anexa_ref: 'Anexa 7' }, { nume: 'Grafic de executie.pdf', rol: 'grafic', sursa_versiune: '1' }],
  pt_verdict: null, pt_versiune: null,
}
const CANT_CURAT = { licitatie_id: L, lista_f3_nevalidate: 0, lista_f3_nevalidate_m: null, lista_f3_validate_m: 1000, lista_c6_validate_m: 1000, memoriu_validate_m: 1000,
  plansa_validate_m: 1000, lista_c6_nevalidate: 0, memoriu_nevalidate: 0, plansa_nevalidate: 0, fara_tip_nevalidate: 0, fara_tip_nevalidate_m: null, retea_nevalidate: 0,
  retea_nevalidate_m: null, invalidate_in_afara_retea: 0, invalidate_in_afara_retea_m: null, total_invalidate: 0, unitate_schimbata_in_afara_retea: 0, um_de_normalizat: 0,
  um_de_normalizat_f3: 0, retea_alte_unitati: 0, retea_alte_unitati_lungimi_f3: 0, lista_f3_validate_fara_cant: 0, retea_validate_fara_cant: 0, sterse_dupa_validare: 0,
  transfer_conflicte_docs: 0, transfer_conflicte_n: 0, transfer_in_curs: 0, totaluri_control: [], unitati_de_verificat: 0 }
// decizii INDIVIDUALE: fiecare cerință are momentul ei (la secundă) — altfel ar fi „în bloc"
const laSec = (id, pas) => new Date(Date.parse(T0) - id * pas * 1000).toISOString()
const cer = (id, nr, tip, extra = {}) => ({ id, nr_ordine: nr, tip, text_cerinta: `Cerința de test ${nr}: ofertantul descrie modul de lucru.`, text_md5: `m${id}`, versiune: 1,
  inlocuita_de: null, duplicat_al: null, document_probant: null, stare: 'rezolvata', stare_de: 'Persoana A', stare_la: laSec(id, 7), e2_confirmata_de: 'Persoana A', e2_confirmata_la: laSec(id, 3),
  extras_de_ai: true, ...extra })
const leg = (id, cerinta_id, capitol_id, extra = {}) => ({ id, cerinta_id, capitol_id, capitol_licitatie_id: L, fel: 'capitol', stare: 'verificata', sursa: 'ai',
  verificat_la_versiunea: capitol_id === 1 ? 2 : 1, confirmat_de: 'Persoana A', confirmat_la: T0, constatare: null, severitate: null, motiv: null, nota: null, ...extra })
const aco = (id, cerinta_id, status, extra = {}) => ({ id, cerinta_id, status, verificat_pe_scan: false, reverificare_ceruta: false, doc_firma_id: null, verificat_de: null, ...extra })
const ok = (date, extra = {}) => ({ stare: 'ok', licitatie_id: L, citit_la: T0, eroare: null, date, ...extra })
function snapCurat() {
  return {
    versiune_format: 1, licitatie_id: L, capturat_la: T0,
    surse: {
      licitatie: ok({ id: L, nr_anunt: 'TEST', termen_depunere: '2026-12-01T10:00:00Z', status: 'in_lucru' }),
      cerinte: ok([cer(11, 1, 'propunere'), cer(12, 2, 'propunere'), cer(13, 3, 'eliminatorie', { document_probant: 'Certificat ISO 9001' }),
        cer(14, 4, 'contractuala', { stare: 'nu_se_aplica' })]),
      legaturi: ok([leg(101, 11, 1), leg(102, 12, 2)]),
      capitole: ok([
        { id: 1, nr: 1, titlu: 'Metodologie', versiune: 2, obligatoriu: true, stare: 'scris', sursa: 'om', continut_gol: false, are_fisier: false, continut_len: 40, continut_md5: 'h1', blocat: false, continut: 'Metodologia de execuție a lucrărilor.' },
        { id: 2, nr: 2, titlu: 'Calitate', versiune: 1, obligatoriu: true, stare: 'scris', sursa: 'om', continut_gol: false, are_fisier: false, continut_len: 30, continut_md5: 'h2', blocat: false, continut: 'Planul calității pentru contract.' },
      ]),
      acoperire: ok([aco(201, 11, 'nu_se_aplica'), aco(202, 12, 'nu_se_aplica'), aco(203, 13, 'acoperit', { verificat_pe_scan: true, verificat_de: 'Persoana A', doc_firma_id: 501 }),
        aco(204, 14, 'nu_se_aplica')]),
      pt_dovezi: ok([]),
      documente: ok([{ id: 301, nume_original: 'Caiet de sarcini.pdf', status_procesare: 'procesat', eroare: null, necitit_server: false }]),
      documente_firma_valabilitate: ok([{ id: 501, utilizabil: true, fara_expirare: false, data_valabilitate: '2028-01-01', se_reemite: false }]),
      pt_stare: ok({ ...PT_CURAT }),
      seap_completitudine: ok({ licitatie_id: L, blocaj: null, esentiale: 3, esentiale_necitite: 0 }),
      r5: ok({ licitatie_id: L, rezultat: null }),
      e2_neconfirmate: ok({ licitatie_id: L, cerinte_neconfirmate_cu_capitol: 0, cerinte_neconfirmate_ids: [] }),
      echipa_blocaje: ok([]),
      cantitati_nevalidate: ok({ ...CANT_CURAT }),
    },
  }
}
const A0 = { acum: ACUM0, licitatieId: L }
const cu = (fn, opts = A0) => { const s = snapCurat(); fn(s); return construiesteAtentia(s, opts) }
const candidat = (extra = {}) => ({ id: 'q1', cerinta_id: 11, legatura_id: 101, capitol_id: 1, citat: 'Metodologia de execuție', locator: '§1', citat_gasit_exact: true,
  propunere_ai: 'MATCH', scor: 99, capitol_versiune: 2, hash_text: 'h1', cerinta_versiune: 1, hash_cerinta: 'm11', parser_version: 'p1', ...extra })
const neverifica = s => { const l = s.surse.legaturi.date[0]; Object.assign(l, { stare: 'atribuita', verificat_la_versiunea: null, confirmat_de: null }); s.surse.pt_stare.date.cerinte_neverificate = 1 }

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

// ════════════════════════════════════════════════════════════════
describe103('fixture 103 — rezultatul fixat (contract §11)', () => {
  it103('verdict BLOCKED, SIMULAT, cu o singură sursă indisponibilă (documente_firma)', () => {
    expect(r103.verdict.stare).toBe('BLOCKED')
    expect(r103.verdict.simulat).toBe(true)
    expect(r103.verdict.sursa).toBe('SIMULAT — J07 neaplicat')
    expect(r103.verdict.eticheta).toContain('SIMULAT — J07 neaplicat')
    expect(indIds(r103)).toEqual(['IND:documente_firma_valabilitate:lipsa'])
    expect(r103.indisponibile[0].reguli_afectate).toEqual(['DEP_ROSII'])
    verificaInvarianti(r103)
  })
  it103('PT02: 11 grupuri pe capitol, Σ 263, CONFIRM și blochează final', () => {
    const g = exR(r103, 'PT02')
    expect(g).toHaveLength(11)
    expect(Object.fromEntries(g.map(e => [e.tinta.capitol.id, e.numar]))).toEqual({ 59: 91, 60: 42, 61: 8, 62: 14, 63: 18, 64: 5, 65: 10, 66: 3, 67: 14, 69: 24, 70: 34 })
    expect(sumEl(g)).toBe(263)
    g.forEach(e => { expect(e.clasa).toBe('CONFIRM'); expect(e.blocheaza_final).toBe(true); expect(e.provenienta.sursa).toBe('ai'); expect(e.actiune_umana.intent).toBe('deschide_capitol') })
  })
  it103('PT04: 7 capcane cu capitol, neverificate → HUMAN_DECISION; 263 + 7 = 270 = cerinte_neverificate', () => {
    const g = exR(r103, 'PT04')
    expect(cerIn(r103, 'PT04').map(id => S103.surse.cerinte.date.find(c => c.id === id).nr_ordine).sort((a, b) => a - b)).toEqual([70, 252, 256, 257, 260, 263, 270])
    g.forEach(e => { expect(e.clasa).toBe('HUMAN_DECISION'); expect(e.blocheaza_final).toBe(true) })
    expect(sumEl(exR(r103, 'PT02')) + sumEl(g) + sumEl(exR(r103, 'PT03')) + sumEl(exR(r103, 'PT07'))).toBe(fixture.v_ofertare_pt_stare[0].cerinte_neverificate)
    expect(exR(r103, 'PT03')).toEqual([]); expect(exR(r103, 'PT07')).toEqual([])
  })
  it103('CAP02: 12 excepții CONFIRM, câte una per capitol obligatoriu cu text AI (cap. 1–12)', () => {
    const g = exR(r103, 'CAP02')
    expect(g.map(e => e.tinta.capitol.nr)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    g.forEach(e => { expect(e.clasa).toBe('CONFIRM'); expect(e.blocheaza_final).toBe(true); expect(e.cauza).toMatch(/QW4/) })
  })
  it103('R06 + DEP01: 22 + 2 + 1 + 9 + 43 = 77 = n_neacoperite (recalculat independent)', () => {
    expect(ex(r103, 'R06_ELIM_PROPUSA').numar).toBe(22)
    expect(ex(r103, 'R06_ELIM_FARA').numar).toBe(2)
    expect(ex(r103, 'R06_ELIM_NEDET')).toMatchObject({ numar: 1, clasa: 'HUMAN_DECISION', blocheaza_final: true })
    const prop = exR(r103, 'R06_PROPUSA')
    expect(sumEl(prop)).toBe(9)
    prop.forEach(e => { expect(e.clasa).toBe('CONFIRM'); expect(e.provenienta.detaliu.din_care_fara_capitol).toBe(0) })
    const dep = ex(r103, 'DEP01')
    expect(dep.numar).toBe(43)
    const peTip = {}; for (const e of dep.elemente) peTip[e.detalii.tip] = (peTip[e.detalii.tip] || 0) + 1
    expect(peTip).toEqual({ propunere: 4, forma: 29, contractuala: 10 })
    // recalcul independent, direct pe rândurile fixture-ului (expresia din fn_gate_depunere)
    const ac = {}; for (const a of fixture.acoperire) (ac[a.cerinta_id] ||= []).push(a)
    const active = fixture.cerinte.filter(c => c.inlocuita_de == null && c.duplicat_al == null)
    const neacoperite = active.filter(c => !(ac[c.id] || []).some(a => a.status === 'nu_se_aplica' || (['acoperit', 'acoperit_partener'].includes(a.status) && a.verificat_pe_scan && !(a.reverificare_ceruta ?? false))))
    const nReverif = fixture.acoperire.filter(a => ['acoperit', 'acoperit_partener'].includes(a.status) && (a.reverificare_ceruta ?? false)).length
    expect(neacoperite.length).toBe(77)
    expect(nReverif).toBe(0); expect(ex(r103, 'R06_REVERIF')).toBeUndefined()
    const s5 = ['R06_ELIM_PROPUSA', 'R06_ELIM_FARA', 'R06_ELIM_NEDET', 'R06_PROPUSA', 'DEP01'].reduce((s, g) => s + sumEl(exR(r103, g)), 0)
    expect(s5).toBe(77)
    expect(new Set(['R06_ELIM_PROPUSA', 'R06_ELIM_FARA', 'R06_ELIM_NEDET', 'R06_PROPUSA', 'DEP01'].flatMap(g => cerIn(r103, g)))).toEqual(new Set(neacoperite.map(c => c.id)))
  })
  it103('R5, DOC03, F9, DOC02, INT03', () => {
    expect(ex(r103, 'R5')).toMatchObject({ clasa: 'BLOCK', blocheaza_final: true }); expect(ex(r103, 'R5').cauza).toContain('lista_f3_nevalidate = 62')
    expect(ex(r103, 'DOC03').cauza).toContain('1 document(e) esențiale')
    expect(ex(r103, 'F9:cerinta_descoperita')).toMatchObject({ clasa: 'BLOCK', numar: 10 })
    expect(ex(r103, 'DOC02')).toMatchObject({ clasa: 'WARN', blocheaza_final: false, numar: fixture.v_ofertare_pt_stare[0].documente_necitite })
    expect(ex(r103, 'DOC02').elemente.map(e => e.document_id)).toEqual([1283, 1286, 1287])
    expect(ex(r103, 'INT03')).toMatchObject({ clasa: 'WARN', numar: 15 })
  })
  it103('controalele: BLOCK cantitati/garantie/anexe; identitate HUMAN_DECISION; pachet, grafic_sursa și numere „neevaluat"', () => {
    const c = k => ex(r103, `CTRL.${k}`)
    for (const k of ['cantitati', 'garantie', 'anexe']) expect(c(k)).toMatchObject({ clasa: 'BLOCK', blocheaza_final: true })
    for (const k of ['nu_e_cazul', 'conformitate', 'grafic', 'participare', 'grafic_relatii']) expect(c(k)).toMatchObject({ clasa: 'WARN', blocheaza_final: false })
    for (const k of ['pachet', 'grafic_sursa', 'numere']) { expect(c(k).clasa).toBe('WARN'); expect(c(k).titlu).toMatch(/neevaluat/) }
    expect(c('identitate')).toMatchObject({ clasa: 'HUMAN_DECISION', blocheaza_final: false })
    expect(c('identitate').provenienta.detaliu.text_sursa).toMatch(/Romgaz/)
  })
  it103('ok[]: exact lista așteptată; niciun verde din AI, din absență sau din sursele cu blocaj', () => {
    // E2.ok și R06.ok_scoase_om NU mai apar: pe 103 confirmările E2 și „nu se aplică" sunt scrieri în bloc (vezi testele E2_BLOC / R06_ELIM_AI_NA)
    expect(r103.ok.map(o => o.id)).toEqual(['CAP01.ok', 'CTRL.observatii.ok', 'PT.ok_exceptate_om', 'PT01.ok', 'PT05.ok', 'R06.ok_dovedite'])
    expect(okId(r103, 'PT.ok_exceptate_om').numar).toBe(1)
    expect(okId(r103, 'R06.ok_dovedite').numar).toBe(4)
    for (const id of ['PT.ok_verificate', 'R5.ok', 'DOC03.ok', 'F9.ok', 'CTRL.pachet.ok', 'CTRL.grafic_sursa.ok', 'CTRL.numere.ok', 'E2.ok', 'R06.ok_scoase_om']) expect(okId(r103, id)).toBeUndefined()
    expect(r103.ok.some(o => ['ai', 'mixt', 'necunoscuta'].includes(o.provenienta.sursa))).toBe(false)
  })
  it103('I9: fiecare legătură AI neverificată (cerință PT cu capitol) e în exact una dintre PT02/PT03/PT04/PT07', () => {
    const cerPT = new Set(S103.surse.cerinte.date.filter(c => ['propunere', 'forma'].includes(c.tip) && !c.inlocuita_de && !c.duplicat_al).map(c => c.id))
    const aiNev = S103.surse.legaturi.date.filter(l => l.fel === 'capitol' && l.sursa === 'ai' && l.stare !== 'verificata' && cerPT.has(l.cerinta_id))
    expect(aiNev.length).toBe(270)
    const loc = {}
    for (const g of ['PT02', 'PT03', 'PT04', 'PT07']) for (const id of cerIn(r103, g)) loc[id] = (loc[id] || 0) + 1
    for (const l of aiNev) expect(loc[l.cerinta_id]).toBe(1)
  })
  it103('zero divergențe recalcul ↔ server pe 103 (INT01 absent), nicio valoare invalidă (INT04 absent)', () => {
    expect(exR(r103, 'INT01')).toEqual([]); expect(exR(r103, 'INT04')).toEqual([]); expect(exR(r103, 'INT02')).toEqual([])
  })
  it103('aceeași fixture la captură + 3 h: INDISPONIBIL, excepțiile marcate din_date_expirate, ok[] gol', () => {
    const r = construiesteAtentia(S103, { acum: dupa(3 * 3600e3), licitatieId: L })
    expect(r.verdict.stare).toBe('INDISPONIBIL')
    expect(r.ok).toEqual([])
    expect(r.exceptii.length).toBeGreaterThan(0)
    expect(r.exceptii.every(e => e.din_date_expirate)).toBe(true)
    const expirate = r.indisponibile.filter(i => i.motiv === 'expirat').map(i => i.sursa).sort()
    expect(expirate).toEqual(SURSE_OBLIGATORII.filter(n => n !== 'documente_firma_valabilitate').sort())
    verificaInvarianti(r)
  })
  it103('aceeași fixture la captură + 30 min: PROSP01 (WARN), rândurile ok marcate stale, verdictul rămâne BLOCKED', () => {
    const r = construiesteAtentia(S103, { acum: dupa(30 * MIN), licitatieId: L })
    expect(ex(r, 'PROSP01')).toMatchObject({ clasa: 'WARN', blocheaza_final: false })
    expect(r.ok.every(o => o.stale === true)).toBe(true)
    expect(r.verdict.stare).toBe('BLOCKED')
    verificaInvarianti(r)
  })
  it103('cuprinsul 103: 15 capitole, progres 0 verificate de om, candidații AI numărați separat', () => {
    const c = construiesteCuprins(S103, { acum: dupa(5 * MIN), licitatieId: L }, r103)
    expect(c.disponibil).toBe(true)
    expect(c.capitole).toHaveLength(15)
    expect(c.capitole.reduce((s, k) => s + k.progres.verificate_om, 0)).toBe(0)
    expect(c.capitole.find(k => k.id === 59).progres).toMatchObject({ total: 92, verificate_om: 0, candidati_ai: 92 })
    expect(c.capitole.reduce((s, k) => s + k.progres.total, 0)).toBe(270)
    expect(c.fara_capitol).toHaveLength(1); expect(c.fara_capitol[0].exceptata).toBe(true)
    const cap70 = c.capitole.find(k => k.id === 70)
    expect(cap70.exceptii).toEqual(expect.arrayContaining(['PT02:cap:70', 'PT04:cap:70']))
    expect(cap70.text_trunchiat).toBe(true)
  })
})

// ════════════════════════════════════════════════════════════════
describe('I1 — puritate', () => {
  it103('intrare înghețată, două apeluri identice, fără ceas / random / new Date() fără argument', () => {
    const s = deepFreeze(clona(S103))
    const RealDate = globalThis.Date
    class DateFaraCeas extends RealDate { constructor(...a) { if (!a.length) throw new Error('new Date() fără argument'); super(...a) } static now() { throw new Error('Date.now') } }
    vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('Math.random') })
    globalThis.Date = DateFaraCeas
    let a, b
    try { a = construiesteAtentia(s, { acum: dupa(5 * MIN), licitatieId: L }); b = construiesteAtentia(s, { acum: dupa(5 * MIN), licitatieId: L }) } finally { globalThis.Date = RealDate }
    expect(a).toEqual(b); expect(a).toEqual(r103)
    expect(JSON.parse(JSON.stringify(a))).toEqual(a)
  })
  it('fișierul nu importă supabase, react sau fetch', () => {
    const src = fs.readFileSync(new URL('./atentie.js', import.meta.url), 'utf8')
    expect(src).not.toMatch(/from ['"][^'"]*supabase/); expect(src).not.toMatch(/from ['"]react/); expect(src).not.toMatch(/\bfetch\(/)
    expect(src).not.toMatch(/Date\.now\(|Math\.random\(|new Date\(\)/)
  })
})

// ════════════════════════════════════════════════════════════════
describe('R06 — tabelul de adevăr cu NULL-uri (formula server, JS strict)', () => {
  const statusuri = ['acoperit', 'acoperit_partener', 'nu_se_aplica', 'gol', 'in_lucru', 'regula_propunere', null]
  const scan = [true, false, null, undefined, 'true', 1]
  const rev = [false, null, undefined, true, 'false', 0]
  it.each(statusuri.flatMap(st => scan.flatMap(v => rev.map(r => [st, v, r]))))('status=%s verificat_pe_scan=%s reverificare_ceruta=%s', (st, v, r) => {
    const a = { status: st, verificat_pe_scan: v, reverificare_ceruta: r }
    const asteptat = ['acoperit', 'acoperit_partener'].includes(st) && v === true && (r === false || r == null)
    expect(doveditaR06(a)).toBe(asteptat)
    expect(favorabila(a)).toBe(['acoperit', 'acoperit_partener'].includes(st))
    expect(reverif(a)).toBe(!(r === false || r == null))
  })
})

// ════════════════════════════════════════════════════════════════
describe('snapshot curat — N21 / N22 / N23', () => {
  it('N21: zero excepții → OK SIMULAT, „nu înseamnă gata de depus", fără READY', () => {
    const r = construiesteAtentia(snapCurat(), A0)
    expect(r.exceptii).toEqual([]); expect(r.indisponibile).toEqual([])
    expect(r.verdict.stare).toBe('OK')
    expect(r.verdict.eticheta).toContain('SIMULAT — J07 neaplicat'); expect(r.verdict.eticheta).toContain('Nu înseamnă «gata de depus»')
    expect(r.verdict.nu_inseamna_gata_de_depus).toBe(true)
    expect(r.ok.map(o => o.id)).toEqual(expect.arrayContaining(['PT.ok_verificate', 'E2.ok', 'R06.ok_dovedite', 'R5.ok', 'DOC03.ok', 'F9.ok', 'CTRL.pachet.ok', 'CTRL.numere.ok']))
    verificaInvarianti(r)
  })
  it('N21 cu server_cer consistent: tot OK, fără INT01', () => {
    const s = snapCurat()
    for (const c of s.surse.cerinte.date) if (['propunere', 'forma'].includes(c.tip)) c.server_cer = { are_capitol: true, capcana: false, dovedita: false, exceptata: false, propusa: false, verificata: true }
    const r = construiesteAtentia(s, A0)
    expect(r.verdict.stare).toBe('OK'); verificaInvarianti(r)
  })
  it('N22: sursă veche de 30 min → WARN (PROSP01), nu OK; la 3 h → INDISPONIBIL (expirat), fără ok[] din ea', () => {
    const s = snapCurat(); s.surse.r5.citit_la = new Date(ACUM0 - 30 * MIN).toISOString()
    const r = construiesteAtentia(s, A0)
    expect(r.verdict.stare).toBe('WARN'); expect(ex(r, 'PROSP01')).toBeTruthy(); expect(okId(r, 'R5.ok').stale).toBe(true)
    verificaInvarianti(r)
    s.surse.r5.citit_la = new Date(ACUM0 - 3 * 3600e3).toISOString()
    const r2 = construiesteAtentia(s, A0)
    expect(r2.verdict.stare).toBe('INDISPONIBIL'); expect(indIds(r2)).toEqual(['IND:r5:expirat']); expect(r2.indisponibile[0].reguli_afectate).toEqual(['R5'])
    expect(okId(r2, 'R5.ok')).toBeUndefined()
    verificaInvarianti(r2)
  })
  it('N23: fără timestamp / citit „în viitor" → INDISPONIBIL (fara_timestamp / timp_invalid)', () => {
    const s = snapCurat(); s.capturat_la = null
    for (const n of Object.keys(s.surse)) s.surse[n].citit_la = null
    const r = construiesteAtentia(s, A0)
    expect(r.verdict.stare).toBe('INDISPONIBIL'); expect(r.indisponibile.every(i => i.motiv === 'fara_timestamp')).toBe(true); expect(r.ok).toEqual([])
    verificaInvarianti(r)
    const s2 = snapCurat(); s2.surse.documente.citit_la = new Date(ACUM0 + 10 * MIN).toISOString()
    const r2 = construiesteAtentia(s2, A0)
    expect(r2.verdict.stare).toBe('INDISPONIBIL'); expect(indIds(r2)).toEqual(['IND:documente:timp_invalid'])
    verificaInvarianti(r2)
  })
})

// ════════════════════════════════════════════════════════════════
describe('eroare de citire per sursă → INDISPONIBIL, nu listă goală, nu verde (N16, N17, N26)', () => {
  const surse = [...SURSE_OBLIGATORII]
  it.each(surse)('snapshot curat, sursa %s în eroare (cu date vechi atașate) → INDISPONIBIL', n => {
    const r = construiesteAtentia(cuEroare(snapCurat(), n), A0)
    expect(r.verdict.stare).toBe('INDISPONIBIL')
    const i = r.indisponibile.find(x => x.sursa === n)
    expect(i).toMatchObject({ motiv: 'eroare', blocheaza_final: true })
    expect(i.reguli_afectate.length).toBeGreaterThan(0)
    for (const reg of i.reguli_afectate) {
      expect(r.exceptii.some(e => e.regula === reg)).toBe(false)
      expect(r.ok.some(o => o.regula === reg || o.id.startsWith(`${reg}.`))).toBe(false)
    }
    verificaInvarianti(r)
  })
  it103.each(surse)('fixture 103, sursa %s în eroare → verdict ∈ {INDISPONIBIL, BLOCKED}, niciodată OK / WARN', n => {
    const r = construiesteAtentia(cuEroare(S103, n), { acum: dupa(5 * MIN), licitatieId: L })
    expect(['INDISPONIBIL', 'BLOCKED']).toContain(r.verdict.stare)
    expect(r.indisponibile.some(x => x.sursa === n && x.motiv === 'eroare')).toBe(true)
    verificaInvarianti(r)
  })
  it103('N16: acoperire în eroare → nicio excepție R06/DEP, niciun R06.ok; datele vechi NU se folosesc', () => {
    const r = construiesteAtentia(cuEroare(S103, 'acoperire'), { acum: dupa(5 * MIN), licitatieId: L })
    const i = r.indisponibile.find(x => x.sursa === 'acoperire')
    expect(i.reguli_afectate).toEqual(expect.arrayContaining(['PT01', 'DEP01', 'DEP_ROSII', 'R06_ELIM_PROPUSA', 'R06_PROPUSA', 'R06_REVERIF']))
    expect(r.exceptii.some(e => /^(R06|DEP)/.test(e.regula))).toBe(false)
    expect(r.ok.some(o => o.id.startsWith('R06') || o.id === 'PT01.ok')).toBe(false)
    expect(['INDISPONIBIL', 'BLOCKED']).toContain(r.verdict.stare)
  })
  it103('N17: pt_dovezi în eroare → dovezi_atasate = null (nu 0) în PT02, sursa în indisponibile', () => {
    const r = construiesteAtentia(cuEroare(S103, 'pt_dovezi'), { acum: dupa(5 * MIN), licitatieId: L })
    expect(r.indisponibile.find(x => x.sursa === 'pt_dovezi').reguli_afectate).toEqual(['PT02'])
    for (const e of exR(r, 'PT02')) for (const x of e.elemente) expect(x.detalii.dovezi_atasate).toBeNull()
    for (const e of exR(r103, 'PT02')) for (const x of e.elemente) expect(x.detalii.dovezi_atasate).toBe(0)
    expect(r.verdict.stare).not.toBe('OK')
  })
  it('N26: echipa_blocaje citită ok cu 0 rânduri → F9.ok; în eroare → indisponibil, fără F9.ok', () => {
    expect(okId(construiesteAtentia(snapCurat(), A0), 'F9.ok')).toBeTruthy()
    const r = construiesteAtentia(cuEroare(snapCurat(), 'echipa_blocaje'), A0)
    expect(okId(r, 'F9.ok')).toBeUndefined(); expect(indIds(r)).toContain('IND:echipa_blocaje:eroare')
  })
  it('sursă opțională: candidati_citat absent = fără zgomot; în eroare = indisponibil', () => {
    expect(construiesteAtentia(snapCurat(), A0).indisponibile).toEqual([])
    const r = cu(s => { s.surse.candidati_citat = { stare: 'eroare', licitatie_id: L, citit_la: T0, eroare: 'timeout', date: [] } })
    expect(indIds(r)).toEqual(['IND:candidati_citat:eroare']); expect(r.verdict.stare).toBe('INDISPONIBIL')
  })
})

// ════════════════════════════════════════════════════════════════
describe('candidați de citat — AI candidate ≠ human verified (N1–N6, N10)', () => {
  it('N1: citat real, MATCH exact, scor 99, legătură AI atribuită → rămâne PT02 CONFIRM, nu ok, verdict ≠ OK', () => {
    const r = cu(s => { neverifica(s); s.surse.candidati_citat = ok([candidat()]) })
    const e = ex(r, 'PT02:cap:1')
    expect(e.clasa).toBe('CONFIRM'); expect(e.elemente[0]).toMatchObject({ cerinta_id: 11, motiv: 'neverificata' })
    expect(e.elemente[0].candidat).toMatchObject({ propunere_ai: 'MATCH', citat_gasit_exact: true })
    expect(okId(r, 'PT.ok_verificate').numar).toBe(1)          // doar cerința 12, verificată de om
    expect(r.verdict.stare).toBe('BLOCKED')
    verificaInvarianti(r)
  })
  it('scorul nu contează: 1000 de candidați MATCH cu scor 100 nu verifică nimic', () => {
    const r = cu(s => { neverifica(s); s.surse.candidati_citat = ok(Array.from({ length: 50 }, (_, i) => candidat({ id: `q${i}`, scor: 100 }))) })
    expect(ex(r, 'PT02:cap:1').numar).toBe(1); expect(r.verdict.stare).not.toBe('OK')
  })
  it('N2: citat contradictoriu (CONFLICT) → PT07 HUMAN_DECISION, blochează final', () => {
    const r = cu(s => { neverifica(s); s.surse.candidati_citat = ok([candidat({ propunere_ai: 'CONFLICT' })]) })
    expect(ex(r, 'PT07:cap:1')).toMatchObject({ clasa: 'HUMAN_DECISION', blocheaza_final: true })
    expect(ex(r, 'PT07:cap:1').elemente[0].motiv).toBe('citat_contradictoriu'); expect(ex(r, 'PT02:cap:1')).toBeUndefined()
    verificaInvarianti(r)
  })
  it.each([[{ propunere_ai: 'PARTIAL' }, 'citat_partial'], [{ citat_gasit_exact: false }, 'citat_negasit_exact'], [{ propunere_ai: 'UNDETERMINED' }, 'citat_nedeterminat']])(
    'N3: citat parțial / trunchiat (%o) → PT07 HUMAN_DECISION', (patch, motiv) => {
      const r = cu(s => { neverifica(s); s.surse.candidati_citat = ok([candidat(patch)]) })
      expect(ex(r, 'PT07:cap:1').elemente[0].motiv).toBe(motiv)
    })
  it.each([[{ capitol_versiune: 1 }, 'versiune'], [{ hash_text: 'altul' }, 'hash'], [{ hash_text: null }, 'fara_hash'], [{ hash_cerinta: 'x' }, 'hash_cerinta']])(
    'N4: candidat din versiune veche / hash schimbat (%o) → ignorat, PT02 cu motiv candidat_invalid, INT02', (patch, cauza) => {
      const r = cu(s => { neverifica(s); s.surse.candidati_citat = ok([candidat(patch)]) })
      expect(ex(r, 'PT02:cap:1').elemente[0].motiv).toBe(`candidat_invalid:${cauza}`)
      expect(ex(r, 'PT02:cap:1').elemente[0].candidat).toBeUndefined()
      expect(ex(r, 'INT02').elemente.some(x => x.motiv.includes(cauza))).toBe(true)
      verificaInvarianti(r)
    })
  it('N5: clarificare înlocuită — cerința veche iese din U_PT / C_act / E2, verificarea nu se moștenește; cea nouă e PT01 BLOCK', () => {
    const r = cu(s => {
      s.surse.cerinte.date[1].inlocuita_de = 15
      s.surse.cerinte.date.push(cer(15, 5, 'propunere'))
      s.surse.candidati_citat = ok([candidat({ id: 'qv', cerinta_id: 12, legatura_id: 102, capitol_id: 2, capitol_versiune: 1, hash_text: 'h2', hash_cerinta: 'm12' })])
    })
    const toate = r.exceptii.filter(e => !['integritate', 'prospetime'].includes(e.domeniu)).flatMap(e => (e.elemente || []).map(x => x.cerinta_id))
    expect(toate).not.toContain(12)
    expect(ex(r, 'PT01').elemente.map(x => x.cerinta_id)).toEqual([15])
    expect(ex(r, 'INT02').elemente.some(x => x.motiv.includes('cerinta_inactiva'))).toBe(true)
    expect(okId(r, 'PT.ok_verificate').numar).toBe(1)
    verificaInvarianti(r)
  })
  it('N6: același text în capitolul greșit (candidat pe alt capitol decât legătura) → candidat ignorat, rândul rămâne PT02', () => {
    const r = cu(s => { neverifica(s); s.surse.candidati_citat = ok([candidat({ capitol_id: 2, capitol_versiune: 1, hash_text: 'h2' })]) })
    expect(ex(r, 'PT02:cap:1').elemente[0].motiv).toBe('candidat_invalid:alt_capitol')
    expect(ex(r, 'INT02')).toBeTruthy()
  })
  it('N10: legătură AI pe capitolul greșit, fără candidat → PT02 CONFIRM, nimic verificat automat', () => {
    const r = cu(s => { Object.assign(s.surse.legaturi.date[1], { capitol_id: 1, stare: 'atribuita', verificat_la_versiunea: null, confirmat_de: null }); s.surse.pt_stare.date.cerinte_neverificate = 1 })
    expect(ex(r, 'PT02:cap:1').elemente.map(x => x.cerinta_id)).toEqual([12])
    expect(okId(r, 'PT.ok_verificate').numar).toBe(1)
  })
})

// ════════════════════════════════════════════════════════════════
describe('legături PT și integritate (N7, N8, N27, N28, N29)', () => {
  it('N7: server_cer.verificata = true, recalculul = false → varianta mai puțin verde (PT02) + INT01 blocant', () => {
    const r = cu(s => {
      neverifica(s)
      s.surse.cerinte.date[0].server_cer = { are_capitol: true, capcana: false, dovedita: false, exceptata: false, propusa: false, verificata: true }
    })
    expect(ex(r, 'PT02:cap:1').elemente[0].cerinta_id).toBe(11)
    expect(ex(r, 'INT01:blocant')).toMatchObject({ clasa: 'BLOCK', blocheaza_final: true })
    verificaInvarianti(r)
  })
  it('N7: contoare — server < recalcul → INT01 informativ (WARN); server > recalcul pe contor blocant → INT01 BLOCK', () => {
    const r = cu(s => { neverifica(s); s.surse.pt_stare.date.cerinte_neverificate = 0 })
    expect(ex(r, 'INT01:informativ').elemente.some(x => x.motiv.includes('cerinte_neverificate'))).toBe(true)
    expect(ex(r, 'INT01:blocant')).toBeUndefined()
    const r2 = cu(s => { s.surse.pt_stare.date.cerinte_neverificate = 5 })
    expect(ex(r2, 'INT01:blocant').elemente[0].motiv).toContain('cerinte_neverificate')
    expect(r2.verdict.stare).toBe('BLOCKED')
    verificaInvarianti(r2)
  })
  it('N8: verificată la v1, capitolul e acum v2 → PT02 CONFIRM cu motiv versiune_veche, blochează final', () => {
    const r = cu(s => { s.surse.legaturi.date[0].verificat_la_versiunea = 1; s.surse.pt_stare.date.cerinte_neverificate = 1 })
    const e = ex(r, 'PT02:cap:1')
    expect(e.elemente[0]).toMatchObject({ cerinta_id: 11, motiv: 'versiune_veche' }); expect(e.blocheaza_final).toBe(true)
    expect(e.cauza).toMatch(/versiune veche/)
  })
  it('N27: o legătură blocată (R09) + alta verificată la versiunea curentă → PT03 HUMAN_DECISION, nu PT.ok_verificate', () => {
    const r = cu(s => {
      s.surse.legaturi.date.push(leg(103, 11, 2, { stare: 'blocata', verificat_la_versiunea: null, confirmat_de: 'Persoana B', constatare: 'contrazice cerința', severitate: 'mare' }))
      s.surse.pt_stare.date.cerinte_neverificate = 1
    })
    const e = ex(r, 'PT03:cap:1')
    expect(e).toMatchObject({ clasa: 'HUMAN_DECISION', blocheaza_final: true })
    expect(e.elemente[0].detalii).toMatchObject({ constatare: 'contrazice cerința', severitate: 'mare' })
    expect(e.elemente[0].alte_capitole).toEqual([2])
    expect(okId(r, 'PT.ok_verificate').numar).toBe(1)
    verificaInvarianti(r)
  })
  it('N28: stare verificata cu verificat_la_versiunea NULL → PT02 (neverificată) + INT04', () => {
    const r = cu(s => { s.surse.legaturi.date[0].verificat_la_versiunea = null; s.surse.pt_stare.date.cerinte_neverificate = 1 })
    expect(ex(r, 'PT02:cap:1').elemente[0].motiv).toBe('neverificata')
    expect(ex(r, 'INT04').elemente.some(x => x.legatura_id === 101)).toBe(true)
  })
  it('N29: legătură spre capitolul altei licitații → ignorată (INT02); fără altă legătură → PT01 BLOCK; server ≠ recalcul → INT01', () => {
    const r = cu(s => { Object.assign(s.surse.legaturi.date[0], { capitol_id: 999, capitol_licitatie_id: 93 }) })
    expect(ex(r, 'INT02').elemente.some(x => x.legatura_id === 101)).toBe(true)
    expect(ex(r, 'PT01').elemente.map(x => x.cerinta_id)).toEqual([11])
    expect(exR(r, 'INT01').length).toBeGreaterThan(0)
    verificaInvarianti(r)
  })
  it('capcana necunoscută (text trunchiat, fără server_cer) pe o cerință atribuită → PT04 capcana_necunoscuta, nu PT02', () => {
    const r = cu(s => { neverifica(s); s.surse.cerinte.date[0].text_cerinta = 'Oferta care nu … [trunchiat]' })
    expect(ex(r, 'PT04:cap:1').elemente[0].motiv).toBe('capcana_necunoscuta')
  })
  it('capcană fără capitol → PT05 BLOCK; necunoscută fără capitol → PT05 control indisponibil, fără PT05.ok', () => {
    const r = cu(s => { s.surse.legaturi.date.splice(0, 1); s.surse.cerinte.date[0].text_cerinta = 'Oferta va fi respinsă ca neconformă dacă lipsește.'; s.surse.acoperire.date[0].status = 'acoperit' })
    expect(ex(r, 'PT05')).toMatchObject({ clasa: 'BLOCK', aspect: 'capcana' })
    const r2 = cu(s => { s.surse.legaturi.date.splice(0, 1); s.surse.cerinte.date[0].text_cerinta = 'Ceva … [trunchiat]'; s.surse.acoperire.date[0].status = 'acoperit' })
    expect(indIds(r2)).toContain('IND:control:control_invalid:PT05'); expect(okId(r2, 'PT05.ok')).toBeUndefined()
    verificaInvarianti(r2)
  })
  it('excepție pusă de AI → PT06 HUMAN_DECISION care blochează final (incident NSA_AI: excepțiile AI închid poarta); pusă de om → PT.ok_exceptate_om', () => {
    const r = cu(s => { s.surse.legaturi.date[0] = { id: 101, cerinta_id: 11, capitol_id: null, capitol_licitatie_id: null, fel: 'exceptat', stare: 'atribuita', sursa: 'ai', motiv: 'nu se aplică' } })
    expect(ex(r, 'PT06')).toMatchObject({ clasa: 'HUMAN_DECISION', blocheaza_final: true }); expect(ex(r, 'PT06').cauza).toMatch(/INCIDENT_V2_NSA_AI_2026-09-29/)
    expect(r.verdict.stare).toBe('BLOCKED'); verificaInvarianti(r)
    const r2 = cu(s => { s.surse.legaturi.date[0] = { id: 101, cerinta_id: 11, capitol_id: null, capitol_licitatie_id: null, fel: 'exceptat', stare: 'atribuita', sursa: 'om', motiv: 'nu se aplică' } })
    expect(okId(r2, 'PT.ok_exceptate_om').numar).toBe(1)
  })
})

// ════════════════════════════════════════════════════════════════
describe('dovezi R06 / depunere (N11–N15)', () => {
  it('N11: eliminatorie acoperită fără scan, cu document probant → R06_ELIM_PROPUSA BLOCK, BLOCKED', () => {
    const r = cu(s => { s.surse.acoperire.date[2].verificat_pe_scan = false })
    expect(ex(r, 'R06_ELIM_PROPUSA')).toMatchObject({ clasa: 'BLOCK', numar: 1 }); expect(r.verdict.stare).toBe('BLOCKED')
    verificaInvarianti(r)
  })
  it.each([[null, false], ['true', true], [1, true]])('N12: verificat_pe_scan = %o → tot BLOCK (INT04 pentru non-boolean: %s)', (v, int04) => {
    const r = cu(s => { s.surse.acoperire.date[2].verificat_pe_scan = v })
    expect(ex(r, 'R06_ELIM_PROPUSA')).toBeTruthy(); expect(!!ex(r, 'INT04')).toBe(int04)
  })
  it('N13: scan true + reverificare NULL → dovedită (COALESCE); reverificare true → R06_REVERIF BLOCK', () => {
    const r = cu(s => { s.surse.acoperire.date[2].reverificare_ceruta = null })
    expect(okId(r, 'R06.ok_dovedite').numar).toBe(1); expect(r.verdict.stare).toBe('OK')
    const r2 = cu(s => { s.surse.acoperire.date[2].reverificare_ceruta = true })
    expect(ex(r2, 'R06_REVERIF')).toMatchObject({ clasa: 'BLOCK', numar: 1 }); expect(ex(r2, 'R06_REVERIF').provenienta.detaliu.n_reverif_randuri).toBe(1)
    expect(okId(r2, 'R06.ok_dovedite')).toBeUndefined()
  })
  it('N14: eliminatorie fără acoperire, cu document → R06_ELIM_FARA BLOCK; fără document → R06_ELIM_NEDET HUMAN_DECISION', () => {
    const r = cu(s => { s.surse.acoperire.date.splice(2, 1) })
    expect(ex(r, 'R06_ELIM_FARA')).toMatchObject({ clasa: 'BLOCK', numar: 1 })
    const r2 = cu(s => { s.surse.acoperire.date.splice(2, 1); s.surse.cerinte.date[2].document_probant = '  ' })
    expect(ex(r2, 'R06_ELIM_NEDET')).toMatchObject({ clasa: 'HUMAN_DECISION', blocheaza_final: true })
    expect(okId(r2, 'R06.ok_dovedite')).toBeUndefined()                 // nici OK …
    expect(ex(r2, 'R06_ELIM_FARA')).toBeUndefined()                     // … nici „negativ" (fără document nu știm)
  })
  it('N15 (finding 7): „nu se aplică" pus automat pe o eliminatorie → R06_ELIM_AI_NA HUMAN_DECISION care BLOCHEAZĂ final (incident NSA_AI), nu ok, nu WARN', () => {
    const r = cu(s => { Object.assign(s.surse.acoperire.date[2], { status: 'nu_se_aplica', verificat_pe_scan: false }); Object.assign(s.surse.cerinte.date[2], { stare: 'de_analizat', stare_de: null }) })
    expect(ex(r, 'R06_ELIM_AI_NA')).toMatchObject({ clasa: 'HUMAN_DECISION', blocheaza_final: true, numar: 1 })
    expect(ex(r, 'R06_ELIM_AI_NA').cauza).toMatch(/INCIDENT_V2_NSA_AI_2026-09-29/)
    expect(ex(r, 'R06_ELIM_AI_NA').elemente[0]).toMatchObject({ motiv: 'nu_se_aplica_neconfirmat_de_om', sursa: 'ai' })
    expect(okId(r, 'R06.ok_dovedite')).toBeUndefined(); expect(okId(r, 'R06.ok_scoase_om').numar).toBe(1)   // doar cerința contractuală 14, scoasă de om, individual
    expect(r.verdict.stare).toBe('BLOCKED'); expect(r.verdict.eticheta).not.toMatch(/WARN/)
    verificaInvarianti(r)
  })
  it('„nu se aplică" automat pe o cerință contractuală → R06_AI_NA CONFIRM (nu ok); scoasă de om → R06.ok_scoase_om', () => {
    const r = cu(s => { s.surse.cerinte.date[3].stare_de = null })
    expect(ex(r, 'R06_AI_NA')).toMatchObject({ clasa: 'CONFIRM', blocheaza_final: false, numar: 1 })
    expect(okId(construiesteAtentia(snapCurat(), A0), 'R06.ok_scoase_om').numar).toBe(1)
  })
  it('dovadă propusă pe o cerință PT fără capitol → R06_PROPUSA BLOCK final (nu mai coboară blocajul la warn)', () => {
    const r = cu(s => { s.surse.legaturi.date.splice(0, 1); s.surse.acoperire.date[0].status = 'acoperit'; Object.assign(s.surse.pt_stare.date, { cu_capitol: 1, dovada_de_verificat: 1 }) })
    const e = ex(r, 'R06_PROPUSA:fara_capitol')
    expect(e).toMatchObject({ clasa: 'CONFIRM', blocheaza_final: true }); expect(e.provenienta.detaliu.din_care_fara_capitol).toBe(1)
    expect(ex(r, 'PT01')).toBeUndefined()      // ca pe server: propusa scoate cerința din fara_capitol …
    expect(r.verdict.stare).toBe('BLOCKED')    // … dar nu mai lasă poarta deschisă
  })
  it('DEP00: 0 cerințe active → BLOCK, nu „nimic de făcut ⇒ OK"', () => {
    const r = cu(s => { s.surse.cerinte.date = []; s.surse.legaturi.date = []; s.surse.acoperire.date = [] })
    expect(ex(r, 'DEP00')).toMatchObject({ clasa: 'BLOCK' }); expect(r.verdict.stare).toBe('BLOCKED')
  })
  it('DEP_ROSII: document neutilizabil / expiră < 90 zile după termen → BLOCK; NULL tratat ca în SQL (+INT04)', () => {
    const r = cu(s => { s.surse.documente_firma_valabilitate.date[0].utilizabil = false })
    expect(ex(r, 'DEP_ROSII')).toMatchObject({ clasa: 'BLOCK', numar: 1 })
    const r2 = cu(s => { s.surse.documente_firma_valabilitate.date[0].data_valabilitate = '2027-01-15' })
    expect(ex(r2, 'DEP_ROSII').elemente[0].motiv).toBe('valabilitate_insuficienta')
    const r3 = cu(s => { Object.assign(s.surse.documente_firma_valabilitate.date[0], { data_valabilitate: '2027-01-15', se_reemite: true }) })
    expect(ex(r3, 'DEP_ROSII')).toBeUndefined()
    const r4 = cu(s => { s.surse.documente_firma_valabilitate.date[0].utilizabil = null })
    expect(ex(r4, 'DEP_ROSII')).toBeUndefined(); expect(ex(r4, 'INT04')).toBeTruthy()
  })
})

// ════════════════════════════════════════════════════════════════
describe('licitația greșită, forme invalide, controale (N18–N20, N24, N25, N30–N32, N34)', () => {
  it103('N18: răspuns vechi pentru altă licitație → exceptii [], ok [], SNAP:alta_licitatie, INDISPONIBIL', () => {
    const s = clona(S103); s.licitatie_id = 93
    const r = construiesteAtentia(s, { acum: dupa(5 * MIN), licitatieId: L })
    expect(r.exceptii).toEqual([]); expect(r.ok).toEqual([]); expect(indIds(r)).toEqual(['SNAP:alta_licitatie']); expect(r.verdict.stare).toBe('INDISPONIBIL')
    verificaInvarianti(r)
  })
  it('N19: sursa cerinte citită pentru 93 într-un snapshot 103 → ignorată, fără DEP00 și fără OK', () => {
    const r = cu(s => { s.surse.cerinte.licitatie_id = 93 })
    expect(indIds(r)).toContain('IND:cerinte:alta_licitatie'); expect(ex(r, 'DEP00')).toBeUndefined(); expect(r.verdict.stare).toBe('INDISPONIBIL')
    const r2 = cu(s => { s.surse.pt_stare.date.licitatie_id = 93 })
    expect(indIds(r2)).toContain('IND:pt_stare:alta_licitatie')
  })
  it103('N20: licitatieId = 93 cu licitatiiPermise implicit → licitatie_nepermisa, fără nicio evaluare', () => {
    const r = construiesteAtentia(S103, { acum: dupa(5 * MIN), licitatieId: 93 })
    expect(indIds(r)).toEqual(['SNAP:licitatie_nepermisa']); expect(r.exceptii).toEqual([]); expect(r.ok).toEqual([]); expect(r.verdict.stare).toBe('INDISPONIBIL')
    verificaInvarianti(r, 93)
  })
  it.each([null, -1, '3', 1.5])('N24: E2 cerinte_neconfirmate_cu_capitol = %o → control indisponibil, fără E2.ok', v => {
    const r = cu(s => { s.surse.e2_neconfirmate.date.cerinte_neconfirmate_cu_capitol = v })
    expect(indIds(r)).toContain('IND:control:control_invalid:E2_01'); expect(okId(r, 'E2.ok')).toBeUndefined(); expect(r.verdict.stare).toBe('INDISPONIBIL')
  })
  it('E2: cerințele fără câmpul confirmata_de → forma_invalida, nu „toate confirmate"; neconfirmate → E2_01 grupate pe capitol', () => {
    const r = cu(s => { s.surse.cerinte.date.forEach(c => { delete c.e2_confirmata_de }) })
    expect(indIds(r)).toContain('IND:control:forma_invalida:E2_01'); expect(okId(r, 'E2.ok')).toBeUndefined()
    const r2 = cu(s => { s.surse.cerinte.date[0].e2_confirmata_de = null; Object.assign(s.surse.e2_neconfirmate.date, { cerinte_neconfirmate_cu_capitol: 1, cerinte_neconfirmate_ids: [11] }) })
    expect(ex(r2, 'E2_01:cap:1')).toMatchObject({ clasa: 'CONFIRM', aspect: 'registru_e2', porti: ['pt', 'depunere'] })
    verificaInvarianti(r2)
  })
  it103('N25: view cu un singur rând întors gol (SEAP / R5) → forma_invalida, fără DOC03.ok / R5.ok', () => {
    const r = cu(s => { s.surse.seap_completitudine.date = null; s.surse.r5.date = null })
    expect(indIds(r)).toEqual(expect.arrayContaining(['IND:seap_completitudine:forma_invalida', 'IND:r5:forma_invalida']))
    expect(okId(r, 'DOC03.ok')).toBeUndefined(); expect(okId(r, 'R5.ok')).toBeUndefined(); expect(r.verdict.stare).toBe('INDISPONIBIL')
    const n = normalizeazaSnapshot({ ...fixture, ofertare_r5_blocaj_sursa: [] })
    expect(indIds(construiesteAtentia(n, { acum: dupa(5 * MIN), licitatieId: L }))).toContain('IND:r5:forma_invalida')
  })
  it('N30: capitole citite ok cu 0 rânduri → CAP00 BLOCK, nu „0 goale ⇒ ok"', () => {
    const r = cu(s => { s.surse.capitole.date = []; s.surse.legaturi.date = [] })
    expect(ex(r, 'CAP00')).toMatchObject({ clasa: 'BLOCK' }); expect(okId(r, 'CAP01.ok')).toBeUndefined()
  })
  it('N31: capitol cu text și sursa NULL → CAP03 WARN, nu CAP02, nu verde', () => {
    const r = cu(s => { s.surse.capitole.date[0].sursa = null })
    expect(ex(r, 'CAP03')).toMatchObject({ clasa: 'WARN', numar: 1 }); expect(exR(r, 'CAP02')).toEqual([])
  })
  it('CAP02 pe snapshot curat: capitol AI → CONFIRM per capitol, fără acțiune de acceptare', () => {
    const r = cu(s => { s.surse.capitole.date[1].sursa = 'ai'; s.surse.pt_stare.date.capitole_nescrise_de_om = 1 })
    expect(ex(r, 'CAP02:cap:2')).toMatchObject({ clasa: 'CONFIRM', blocheaza_final: true })
    expect(ex(r, 'CAP02:cap:2').actiune_umana.intent).toBe('deschide_capitol')
  })
  it('N32: H9 pachet cu pachet_stare NULL → CTRL.pachet WARN „neevaluat", nu CTRL.pachet.ok', () => {
    const r = cu(s => { s.surse.pt_stare.date.pachet_stare = null })
    expect(ex(r, 'CTRL.pachet')).toMatchObject({ clasa: 'WARN' }); expect(ex(r, 'CTRL.pachet').titlu).toMatch(/neevaluat/); expect(okId(r, 'CTRL.pachet.ok')).toBeUndefined()
  })
  it('H6 numere fără număr în cerințe → „neevaluat" (lipsa informației ≠ verde)', () => {
    const r = cu(s => { s.surse.pt_stare.date.bransamente_in_cerinte = null })
    expect(ex(r, 'CTRL.numere').titlu).toMatch(/neevaluat/); expect(okId(r, 'CTRL.numere.ok')).toBeUndefined()
  })
  it('garda listă ↔ poartă: evaluatorul blochează pe sursa cantităților, dar R5 (server) zice ok → INT01 BLOCK', () => {
    const r = cu(s => { s.surse.cantitati_nevalidate.date.lista_f3_nevalidate = 4 })
    expect(ex(r, 'INT01:blocant').elemente.some(x => x.motiv.includes('sursa_cantitati'))).toBe(true)
    expect(r.verdict.stare).toBe('BLOCKED')
  })
  it('N9: același nume de fișier, bytes diferiți, unul necitit → DOC02 cu 1 element, identificat prin id', () => {
    const r = cu(s => {
      s.surse.documente.date.push({ id: 302, nume_original: 'Caiet de sarcini.pdf', status_procesare: 'partial', eroare: null, necitit_server: true, size_bytes: 9 })
      Object.assign(s.surse.pt_stare.date, { documente: 2, documente_necitite: 1 })
    })
    expect(ex(r, 'DOC02').elemente.map(e => e.document_id)).toEqual([302])
  })
  it103('N34: acum lipsă / invalid, licitatieId lipsă → TypeError; snapshot null → null', () => {
    expect(() => construiesteAtentia(S103, { licitatieId: L })).toThrow(TypeError)
    expect(() => construiesteAtentia(S103, { acum: 'nu-e-dată', licitatieId: L })).toThrow(TypeError)
    expect(() => construiesteAtentia(S103, { acum: dupa(0) })).toThrow(TypeError)
    expect(() => construiesteAtentia(null, {})).toThrow(TypeError)
    expect(construiesteAtentia(null, { acum: dupa(0), licitatieId: L })).toBeNull()
    expect(construiesteAtentia({ nimic: 1 }, { acum: dupa(0), licitatieId: L }).indisponibile[0].id).toBe('SNAP:snapshot_invalid')
    expect(() => construiesteAtentia(S103, { acum: dupa(0), licitatieId: L, praguri: { stale_ms: -1 } })).toThrow(TypeError)
  })
  it('J07 prezent (finding 9): J07 mai sever (BLOCKED vs OK) → INT05 BLOCK, blochează final, verdict BLOCKED; tot SIMULAT', () => {
    const r = cu(s => { s.surse.j07 = ok({ licitatie_id: L, stare: 'BLOCKED' }) })
    expect(r.verdict.simulat).toBe(true); expect(ex(r, 'INT05')).toMatchObject({ clasa: 'BLOCK', blocheaza_final: true }); expect(r.verdict.stare).toBe('BLOCKED')
    verificaInvarianti(r)
    // J07 cu o stare necunoscută = tratată ca blocaj (nu slăbim nimic)
    const r2 = cu(s => { s.surse.j07 = ok({ licitatie_id: L, stare: 'CEVA_NOU' }) })
    expect(ex(r2, 'INT05')).toMatchObject({ clasa: 'BLOCK', blocheaza_final: true }); expect(r2.verdict.stare).toBe('BLOCKED')
    verificaInvarianti(r2)
    // J07 mai permisiv decât simularea → INT05 WARN, verdictul simulat (mai strict) rămâne
    const r3 = cu(s => { s.surse.j07 = ok({ licitatie_id: L, stare: 'OK' }); s.surse.acoperire.date[2].verificat_pe_scan = false })
    expect(ex(r3, 'INT05')).toMatchObject({ clasa: 'WARN', blocheaza_final: false }); expect(r3.verdict.stare).toBe('BLOCKED')
    // J07 = READY pe o simulare OK: aceeași treaptă, fără INT05 și fără cuvântul READY în ieșire
    const r4 = cu(s => { s.surse.j07 = ok({ licitatie_id: L, stare: 'READY' }) })
    expect(ex(r4, 'INT05')).toBeUndefined(); expect(r4.verdict.stare).toBe('OK'); verificaInvarianti(r4)
  })
  it103('praguri suprascrise se întorc în verdict.praguri', () => {
    const r = construiesteAtentia(S103, { acum: dupa(5 * MIN), licitatieId: L, praguri: { stale_ms: MIN } })
    expect(r.verdict.praguri).toEqual({ ...PRAGURI_IMPLICITE, stale_ms: MIN }); expect(ex(r, 'PROSP01')).toBeTruthy()
  })
})

// ════════════════════════════════════════════════════════════════
describe('cuprinsul: sursă lipsă ≠ listă goală', () => {
  it103('legaturi în eroare → disponibil:false cu motiv, nu capitole fără cerințe', () => {
    const c = construiesteCuprins(cuEroare(S103, 'legaturi'), { acum: dupa(5 * MIN), licitatieId: L })
    expect(c.disponibil).toBe(false); expect(c.surse_lipsa).toEqual(['legaturi']); expect(c.capitole).toBeUndefined()
  })
  it('altă licitație → disponibil:false', () => {
    const c = construiesteCuprins(snapshotSintetic(LICITATIE_B, CAPT), { acum: dupa(5 * MIN), licitatieId: LICITATIE_A })
    expect(c.disponibil).toBe(false)
  })
  it('stări pe cerință în workspace: verificată de om / citat candidat AI / blocată / versiune veche', () => {
    const s = snapCurat()
    neverifica(s); s.surse.candidati_citat = ok([candidat()])
    s.surse.legaturi.date.push(leg(103, 12, 1, { stare: 'blocata', verificat_la_versiunea: null }))
    const c = construiesteCuprins(s, A0, construiesteAtentia(s, A0))
    const k1 = c.capitole.find(k => k.id === 1)
    expect(Object.fromEntries(k1.cerinte.map(x => [x.cerinta_id, x.stare]))).toEqual({ 11: 'citat_candidat_ai', 12: 'blocata' })
    expect(c.capitole.find(k => k.id === 2).cerinte[0].stare).toBe('blocata')
    expect(k1.progres).toMatchObject({ total: 2, verificate_om: 0, blocate: 1, candidati_ai: 1 })
  })
})

// ════════════════════════════════════════════════════════════════
describe('garda de concurență: A→B→A cu răspunsul B întârziat', () => {
  function ruleaza(garda) {
    vi.useFakeTimers()
    const aplicate = [], jurnal = []
    const inc = creeazaIncarcator({ citeste: lic => (lic === LICITATIE_A ? S103 : snapshotSintetic(lic, CAPT)), aplica: (snap, lic) => aplicate.push({ snap, lic }),
      jurnal: e => jurnal.push(e), garda: () => garda })
    inc.incarca(LICITATIE_A, 300)
    vi.advanceTimersByTime(100); inc.incarca(LICITATIE_B, 1800)
    vi.advanceTimersByTime(150); inc.incarca(LICITATIE_A, 300)
    vi.advanceTimersByTime(3000)
    const ultim = [...aplicate].reverse().find(x => x.snap)?.snap ?? null
    return { aplicate, jurnal, ultim }
  }
  it103('cu gardă: răspunsul întârziat pentru B e ignorat; pe ecran rămâne A (103)', () => {
    const { jurnal, ultim } = ruleaza(true)
    expect(jurnal.filter(e => e.tip === 'ignorat').map(e => e.licitatieId)).toEqual([LICITATIE_A, LICITATIE_B])
    expect(ultim.licitatie_id).toBe(LICITATIE_A)
    expect(construiesteAtentia(ultim, { acum: dupa(5 * MIN), licitatieId: LICITATIE_A }).verdict.stare).toBe('BLOCKED')
  })
  it('fără gardă (comportamentul de azi): B suprascrie ecranul lui A — dar construiesteAtentia îl refuză (SNAP:alta_licitatie), nu verde', () => {
    const { ultim } = ruleaza(false)
    expect(ultim.licitatie_id).toBe(LICITATIE_B)
    const r = construiesteAtentia(ultim, { acum: dupa(5 * MIN), licitatieId: LICITATIE_A })
    expect(indIds(r)).toEqual(['SNAP:alta_licitatie']); expect(r.verdict.stare).toBe('INDISPONIBIL'); expect(r.exceptii).toEqual([])
  })
})

// ════════════════════════════════════════════════════════════════
describe('ecranul (randare statică, fără browser)', () => {
  const opts = { acum: dupa(5 * MIN), licitatieId: L }
  const buton = html => [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map(m => m[1].replace(/<[^>]+>/g, ''))
  it103('fixture 103: banda SIMULAT, lista în ordinea BLOCK → HUMAN_DECISION → CONFIRM → WARN, secțiunea Indisponibile, zero butoane care scriu', () => {
    const cup = construiesteCuprins(S103, opts, r103)
    const html = renderToStaticMarkup(h(EcranAtentie, { rezultat: r103, cuprins: cup, snapshot: S103, capSel: 59 }))
    expect(html).toContain('SIMULAT — J07 neaplicat'); expect(html).toContain('prototip read-only'); expect(html).toContain('Indisponibile')
    const iB = html.indexOf('data-clasa="BLOCK"'), iH = html.indexOf('data-clasa="HUMAN_DECISION"'), iC = html.indexOf('data-clasa="CONFIRM"'), iW = html.indexOf('data-clasa="WARN"')
    expect(iB).toBeGreaterThan(-1); expect(iB).toBeLessThan(iH); expect(iH).toBeLessThan(iC); expect(iC).toBeLessThan(iW)
    const texte = buton(html)
    expect(texte.length).toBeGreaterThan(0)
    for (const t of texte) expect(t).not.toMatch(/confirmă|confirm\b|aprob|semneaz|salvează|acceptă|accept\b|verifică|trimite|șterge|bulk/i)
    expect(html).toMatch(/Du-mă acolo/)
    expect(html.replace(/Nu există „confirmă toate(&quot;|")/g, '')).not.toMatch(/Confirmă puternicele|Confirmă toate/i)   // apare doar ca negație
  })
  it103('sursă în eroare: Indisponibile vizibile, verdict INDISPONIBIL/BLOCKED, nicio bifă verde pe cuprins', () => {
    const s = cuEroare(S103, 'legaturi')
    const r = construiesteAtentia(s, opts)
    const html = renderToStaticMarkup(h(EcranAtentie, { rezultat: r, cuprins: construiesteCuprins(s, opts, r), snapshot: s }))
    expect(html).toContain('Indisponibile'); expect(html).toContain('ofertare_pt_legaturi'); expect(html).toContain('Cuprinsul nu poate fi construit')
  })
  it('licitația B (nepermisă) și răspunsul întârziat pentru altă licitație: ecran INDISPONIBIL, fără listă „curată"', () => {
    const snapB = snapshotSintetic(LICITATIE_B, CAPT)
    for (const [snap, lic, motiv] of [[snapB, LICITATIE_B, 'licitatie_nepermisa'], [snapB, LICITATIE_A, 'alta_licitatie']]) {
      const o = { acum: dupa(5 * MIN), licitatieId: lic }
      const r = construiesteAtentia(snap, o)
      const html = renderToStaticMarkup(h(EcranAtentie, { rezultat: r, cuprins: construiesteCuprins(snap, o, r), snapshot: snap }))
      expect(html).toContain('data-verdict="INDISPONIBIL"'); expect(html).toContain(motiv); expect(html).toContain('Indisponibile')
      expect(html).not.toContain('data-clasa=')
    }
  })
  it103('date expirate (+3 h): excepțiile rămân vizibile, marcate „din date expirate", cuprinsul fără verde', () => {
    const o = { acum: dupa(3 * 3600e3), licitatieId: L }
    const r = construiesteAtentia(S103, o)
    const html = renderToStaticMarkup(h(EcranAtentie, { rezultat: r, cuprins: construiesteCuprins(S103, o, r), snapshot: S103 }))
    expect(html).toContain('din date expirate'); expect(html).toContain('date expirate — cifre doar orientative'); expect(html).toContain('data-verdict="INDISPONIBIL"')
  })
  it('încărcare (rezultat null) → „Se încarcă…", nu listă goală; containerul pornește în starea de încărcare', () => {
    expect(renderToStaticMarkup(h(EcranAtentie, { rezultat: null, cuprins: null, snapshot: null }))).toContain('Se încarcă')
    const cont = renderToStaticMarkup(h(PtNecesitaAtentia))
    if (ARE_FIXTURE) expect(cont).toContain('Se încarcă')
    else { expect(cont).toContain('lipsește din acest checkout'); expect(cont).not.toContain('data-verdict'); expect(cont).not.toContain('data-clasa') }
  })
})

// ════════════════════════════════════════════════════════════════
// Finding-urile verificatorilor (29.09 seara, verdict FAIL / PASS_CU_CONDITII) — fiecare cu testul care îl prinde
// ════════════════════════════════════════════════════════════════
const campuriCtrl = { observatii_deschise: 'observatii', capitole_nu_e_cazul: 'nu_e_cazul', afirmatii: 'conformitate', afirmatii_blocante: 'conformitate',
  afirmatii_de_verificat: 'conformitate', grafic_avertismente: 'grafic', identitate_straine: 'identitate', anexe_referite: 'anexe', anexe_existente: 'anexe',
  fraze_anexe: 'anexe', capitole_ref: 'anexe', garantie_luni_in_capitole: 'garantie', garantie_cerinte_lucrari: 'garantie', bransamente_in_capitole: 'numere',
  bransamente_in_cerinte: 'numere', participanti: 'participare', participanti_acte: 'participare', fraze_asociere: 'participare', declaratii_participare: 'participare',
  anexe_declarate: 'pachet', anexe_asteptate: 'pachet', pachet_fisiere: 'pachet', grafic_activitati_declarate: 'grafic_relatii' }
const CONTOARE_INT = ['observatii_deschise', 'capitole_nu_e_cazul', 'afirmatii', 'afirmatii_blocante', 'afirmatii_de_verificat', 'grafic_avertismente', 'garantie_cerinte_lucrari']

describe('F1 — DOC03: cheia blocaj absentă nu e „fără blocaj"', () => {
  it('snapshot curat fără câmpul blocaj → DOC03 indisponibil (forma_invalida), fără DOC03.ok, verdict INDISPONIBIL, fără INT01 dublat', () => {
    const r = cu(s => { delete s.surse.seap_completitudine.date.blocaj })
    expect(indIds(r)).toContain('IND:control:forma_invalida:DOC03'); expect(okId(r, 'DOC03.ok')).toBeUndefined()
    expect(r.verdict.stare).toBe('INDISPONIBIL'); expect(ex(r, 'INT01:blocant')).toBeUndefined()
    verificaInvarianti(r)
  })
  it('blocaj = NULL scris explicit de view → DOC03.ok (NULL e valoarea „fără blocaj" a view-ului)', () => {
    expect(okId(construiesteAtentia(snapCurat(), A0), 'DOC03.ok')).toBeTruthy()
  })
  it103('fixture 103 fără câmpul blocaj → blocajul server nu dispare în verde: fără DOC03.ok, DOC03 indisponibil', () => {
    const s = clona(S103); delete s.surse.seap_completitudine.date.blocaj
    const r = construiesteAtentia(s, { acum: dupa(5 * MIN), licitatieId: L })
    expect(okId(r, 'DOC03.ok')).toBeUndefined(); expect(indIds(r)).toContain('IND:control:forma_invalida:DOC03')
    verificaInvarianti(r)
  })
})

describe('F2 — v_ofertare_pt_stare / v_ofertare_cantitati_nevalidate: câmp absent sau NULL nu devine „în regulă"', () => {
  it.each(Object.keys(campuriCtrl))('pt_stare.%s ABSENT → CTRL.<k> indisponibil (forma_invalida), fără CTRL.<k>.ok, verdict ≠ OK', camp => {
    const k = campuriCtrl[camp]
    const r = cu(s => { delete s.surse.pt_stare.date[camp] })
    expect(indIds(r)).toContain(`IND:control:forma_invalida:CTRL.${k}`); expect(okId(r, `CTRL.${k}.ok`)).toBeUndefined(); expect(r.verdict.stare).not.toBe('OK')
    expect(r.indisponibile.find(i => i.id === `IND:control:forma_invalida:CTRL.${k}`).detaliu).toContain(camp)
    verificaInvarianti(r)
  })
  it.each(Object.keys(campuriCtrl))('pt_stare.%s = NULL → fără CTRL.<k>.ok (contor: indisponibil; listă: „neevaluat"), verdict ≠ OK', camp => {
    const k = campuriCtrl[camp]
    const r = cu(s => { s.surse.pt_stare.date[camp] = null })
    expect(okId(r, `CTRL.${k}.ok`)).toBeUndefined(); expect(r.verdict.stare).not.toBe('OK')
    if (CONTOARE_INT.includes(camp)) expect(indIds(r)).toContain(`IND:control:forma_invalida:CTRL.${k}`)
    else if (ex(r, `CTRL.${k}`)?.provenienta.detaliu.stare_regula === 'ok') expect(ex(r, `CTRL.${k}`).titlu).toMatch(/neevaluat/)
    verificaInvarianti(r)
  })
  it.each(['lista_f3_nevalidate', 'transfer_in_curs', 'total_invalidate', 'unitati_de_verificat', 'retea_validate_fara_cant', 'totaluri_control'])(
    'cantitati_nevalidate.%s NULL / absent → CTRL.cantitati indisponibil (nu completat cu 0), fără INT01 de gardă', camp => {
      for (const mod of ['null', 'delete']) {
        const r = cu(s => { if (mod === 'null') s.surse.cantitati_nevalidate.date[camp] = null; else delete s.surse.cantitati_nevalidate.date[camp] })
        expect(indIds(r)).toContain('IND:control:forma_invalida:CTRL.cantitati'); expect(okId(r, 'CTRL.cantitati.ok')).toBeUndefined()
        expect(ex(r, 'INT01:blocant')).toBeUndefined(); expect(r.verdict.stare).toBe('INDISPONIBIL')
        verificaInvarianti(r)
      }
    })
  it103('fixture 103 fără identitate_straine / capitole_nu_e_cazul → nici CTRL.identitate.ok, nici CTRL.nu_e_cazul.ok', () => {
    for (const camp of ['identitate_straine', 'capitole_nu_e_cazul']) {
      const s = clona(S103); delete s.surse.pt_stare.date[camp]
      const r = construiesteAtentia(s, { acum: dupa(5 * MIN), licitatieId: L })
      const k = campuriCtrl[camp]
      expect(okId(r, `CTRL.${k}.ok`)).toBeUndefined(); expect(indIds(r)).toContain(`IND:control:forma_invalida:CTRL.${k}`)
    }
  })
  // scan sistematic (ca al verificatorului): ștergerea / NULL-ul fiecărei chei din fiecare sursă. Rămân OK DOAR cheile de afișare
  // sau cele al căror NULL e valoarea legitimă din SQL — listate explicit aici, ca orice cheie nouă să fie judecată, nu ignorată.
  const AFISARE = new Set(['pt_stare.de_forma', 'pt_stare.cu_capitol', 'pt_stare.capcane', 'pt_stare.pt_verdict', 'pt_stare.pt_versiune',
    'cantitati_nevalidate.lista_f3_nevalidate_m', 'cantitati_nevalidate.lista_f3_validate_m', 'cantitati_nevalidate.lista_c6_validate_m', 'cantitati_nevalidate.memoriu_validate_m',
    'cantitati_nevalidate.plansa_validate_m', 'cantitati_nevalidate.fara_tip_nevalidate_m', 'cantitati_nevalidate.retea_nevalidate', 'cantitati_nevalidate.retea_nevalidate_m',
    'cantitati_nevalidate.invalidate_in_afara_retea_m', 'cantitati_nevalidate.transfer_conflicte_n', 'seap_completitudine.esentiale', 'seap_completitudine.esentiale_necitite',
    'licitatie.nr_anunt', 'licitatie.status', 'cerinte[].nr_ordine', 'cerinte[].text_cerinta', 'cerinte[].text_md5', 'cerinte[].versiune', 'cerinte[].inlocuita_de',
    'cerinte[].duplicat_al', 'cerinte[].document_probant', 'cerinte[].extras_de_ai', 'legaturi[].id', 'legaturi[].capitol_licitatie_id', 'legaturi[].sursa',
    'legaturi[].constatare', 'legaturi[].severitate', 'legaturi[].motiv', 'legaturi[].nota', 'capitole[].nr', 'capitole[].titlu', 'capitole[].stare', 'capitole[].are_fisier',
    'capitole[].continut_len', 'capitole[].continut_md5', 'capitole[].blocat', 'capitole[].continut', 'acoperire[].id', 'documente[].id', 'documente[].nume_original',
    'documente[].status_procesare', 'documente[].eroare', 'documente[].necitit_server', 'documente_firma_valabilitate[].data_valabilitate', 'documente_firma_valabilitate[].se_reemite'])
  const NULL_LEGITIM = new Set([...AFISARE, 'pt_stare.lista_f3_m', 'pt_stare.lista_c6_m', 'pt_stare.memoriu_m', 'pt_stare.plansa_m', 'pt_stare.garantie_justificata',
    'pt_stare.grafic_versiune_mod', 'pt_stare.anexe_responsabili', 'seap_completitudine.blocaj', 'r5.rezultat', 'acoperire[].reverificare_ceruta', 'acoperire[].doc_firma_id'])
  it('scan: nicio cheie de decizie, ștearsă sau NULL, nu lasă verdictul OK (în afara listelor explicite de mai sus)', () => {
    const verzi = { delete: [], null: [] }
    for (const sursa of ['pt_stare', 'cantitati_nevalidate', 'seap_completitudine', 'r5', 'e2_neconfirmate', 'licitatie'])
      for (const k of Object.keys(snapCurat().surse[sursa].date)) {
        if (k === 'licitatie_id' || k === 'id') continue
        for (const mod of ['delete', 'null']) {
          const s = snapCurat(); if (mod === 'delete') delete s.surse[sursa].date[k]; else s.surse[sursa].date[k] = null
          if (construiesteAtentia(s, A0).verdict.stare === 'OK') verzi[mod].push(`${sursa}.${k}`)
        }
      }
    for (const sursa of ['cerinte', 'legaturi', 'capitole', 'acoperire', 'documente', 'documente_firma_valabilitate'])
      for (const k of new Set(snapCurat().surse[sursa].date.flatMap(x => Object.keys(x))))
        for (const mod of ['delete', 'null']) {
          const s = snapCurat(); for (const x of s.surse[sursa].date) { if (mod === 'delete') delete x[k]; else x[k] = null }
          if (construiesteAtentia(s, A0).verdict.stare === 'OK') verzi[mod].push(`${sursa}[].${k}`)
        }
    expect(verzi.delete.filter(k => !AFISARE.has(k))).toEqual([])
    expect(verzi.null.filter(k => !NULL_LEGITIM.has(k))).toEqual([])
  })
})

describe('F3 — F9: rânduri de blocaj neatribuibile nu dispar în verde', () => {
  const echipa = extra => [{ licitatie_id: L, fel: 'cerinta_descoperita', motiv: 'Rol fără om: șef de șantier', ...extra }]
  it.each([['absent', r => { delete r.licitatie_id }], ['NULL', r => { r.licitatie_id = null }]])('licitatie_id %s pe rândul de blocaj → F9 indisponibil, fără F9.ok', (_, f) => {
    const r = cu(s => { s.surse.echipa_blocaje.date = echipa(); f(s.surse.echipa_blocaje.date[0]) })
    expect(okId(r, 'F9.ok')).toBeUndefined(); expect(indIds(r)).toContain('IND:control:forma_invalida:F9'); expect(r.verdict.stare).toBe('INDISPONIBIL')
    verificaInvarianti(r)
  })
  it('rând al altei licitații → F9 indisponibil (alta_licitatie); rândurile lui L rămân BLOCK', () => {
    const r = cu(s => { s.surse.echipa_blocaje.date = [...echipa(), ...echipa({ licitatie_id: 9001, motiv: 'altă licitație' })] })
    expect(indIds(r)).toContain('IND:control:alta_licitatie:F9'); expect(ex(r, 'F9:cerinta_descoperita')).toMatchObject({ clasa: 'BLOCK', numar: 1 })
    expect(okId(r, 'F9.ok')).toBeUndefined(); verificaInvarianti(r)
  })
  it103('fixture 103, licitatie_id șters de pe cele 10 rânduri → fără F9.ok, F9 indisponibil', () => {
    const s = clona(S103); s.surse.echipa_blocaje.date.forEach(x => { delete x.licitatie_id })
    const r = construiesteAtentia(s, { acum: dupa(5 * MIN), licitatieId: L })
    expect(okId(r, 'F9.ok')).toBeUndefined(); expect(indIds(r)).toContain('IND:control:forma_invalida:F9')
    verificaInvarianti(r)
  })
})

describe('F4 — PT01.ok nu se emite când o cerință PT fără capitol e „închisă" doar de o propunere AI', () => {
  it('cerința #2 fără legătură, acoperire acoperit neverificată pe scan → fără PT01.ok; cerința e în R06_PROPUSA:fara_capitol (blochează)', () => {
    const r = cu(s => { s.surse.legaturi.date.splice(1, 1); Object.assign(s.surse.acoperire.date[1], { status: 'acoperit', verificat_pe_scan: null }); Object.assign(s.surse.pt_stare.date, { cu_capitol: 1, dovada_de_verificat: 1 }) })
    expect(okId(r, 'PT01.ok')).toBeUndefined(); expect(ex(r, 'PT01')).toBeUndefined()   // paritate cu fara_capitol din server
    expect(ex(r, 'R06_PROPUSA:fara_capitol').elemente.map(x => x.cerinta_id)).toEqual([12]); expect(r.verdict.stare).toBe('BLOCKED')
    expect(r.ok.some(o => /Fiecare cerință PT are capitol|Nicio cerință PT fără capitol/i.test(o.titlu))).toBe(false)
    verificaInvarianti(r)
  })
})

describe('F5 — R06.ok_scoase_om cere decizie INDIVIDUALĂ (autor + moment propriu)', () => {
  const naElim = s => { Object.assign(s.surse.acoperire.date[2], { status: 'nu_se_aplica', verificat_pe_scan: false, verificat_de: null }) }
  it('eliminatorie scoasă în aceeași secundă cu altă cerință → R06_ELIM_AI_NA (scoasa_in_bloc), blochează, fără ok pentru ea', () => {
    const r = cu(s => { naElim(s); Object.assign(s.surse.cerinte.date[2], { stare: 'nu_se_aplica', stare_de: 'Persoana A', stare_la: s.surse.cerinte.date[3].stare_la }) })
    const e = ex(r, 'R06_ELIM_AI_NA')
    expect(e).toMatchObject({ clasa: 'HUMAN_DECISION', blocheaza_final: true, numar: 1 }); expect(e.elemente[0]).toMatchObject({ motiv: 'scoasa_in_bloc', sursa: 'om_in_bloc' })
    expect(e.elemente[0].detalii.scoase_in_aceeasi_secunda).toBe(2); expect(e.provenienta.detaliu).toMatchObject({ in_bloc: 1, fara_autor: 0 })
    expect(okId(r, 'R06.ok_scoase_om')).toBeUndefined()   // și cerința 14 (în același bloc) iese din verde → R06_AI_NA
    expect(ex(r, 'R06_AI_NA').elemente[0]).toMatchObject({ cerinta_id: 14, motiv: 'scoasa_in_bloc' })
    expect(r.verdict.stare).toBe('BLOCKED'); verificaInvarianti(r)
  })
  it.each([['stare_de gol', { stare_de: '' }, 'nu_se_aplica_neconfirmat_de_om'], ['stare_de spații', { stare_de: '   ' }, 'nu_se_aplica_neconfirmat_de_om'],
    ['stare_la NULL', { stare_la: null }, 'scoasa_fara_moment']])('eliminatorie „scoasă" cu %s → nu e ok, R06_ELIM_AI_NA blochează', (_, patch, motiv) => {
    const r = cu(s => { naElim(s); Object.assign(s.surse.cerinte.date[2], { stare: 'nu_se_aplica', stare_de: 'Persoana A', ...patch }) })
    expect(ex(r, 'R06_ELIM_AI_NA')).toMatchObject({ blocheaza_final: true }); expect(ex(r, 'R06_ELIM_AI_NA').elemente[0].motiv).toBe(motiv)
    expect(okId(r, 'R06.ok_scoase_om').numar).toBe(1)   // doar cerința 14, scoasă individual
  })
  it('scoasă individual (autor + moment unic) → R06.ok_scoase_om', () => {
    const r = cu(s => { naElim(s); Object.assign(s.surse.cerinte.date[2], { stare: 'nu_se_aplica', stare_de: 'Persoana B' }) })
    expect(okId(r, 'R06.ok_scoase_om').numar).toBe(2); expect(ex(r, 'R06_ELIM_AI_NA')).toBeUndefined(); expect(r.verdict.stare).toBe('OK')
  })
  it103('fixture 103: 107 eliminatorii „nu se aplică" în bloc → R06_ELIM_AI_NA 107, blochează; R06.ok_scoase_om nu mai apare', () => {
    const e = ex(r103, 'R06_ELIM_AI_NA')
    expect(e).toMatchObject({ clasa: 'HUMAN_DECISION', blocheaza_final: true, numar: 107 }); expect(e.provenienta.detaliu).toEqual({ fara_autor: 0, in_bloc: 107, fara_moment: 0 })
    expect(e.provenienta.sursa).toBe('om_in_bloc')   // nu „om" (verde): a scris un om, dar nu individual
    expect(Math.max(...e.elemente.map(x => x.detalii.scoase_in_aceeasi_secunda))).toBe(106)
    expect(okId(r103, 'R06.ok_scoase_om')).toBeUndefined()
  })
})

describe('F6 — E2: confirmările în bloc nu sunt verde; șirul gol = neconfirmat', () => {
  it('două cerințe confirmate în aceeași secundă → E2_BLOC CONFIRM, blochează, fără E2.ok', () => {
    const r = cu(s => { s.surse.cerinte.date[1].e2_confirmata_la = s.surse.cerinte.date[0].e2_confirmata_la })
    const g = exR(r, 'E2_BLOC')
    expect(sumEl(g)).toBe(2); g.forEach(e => expect(e).toMatchObject({ clasa: 'CONFIRM', blocheaza_final: true, aspect: 'registru_e2' }))
    expect(g.flatMap(e => e.elemente).every(x => x.motiv === 'confirmata_in_bloc' && x.detalii.confirmari_in_aceeasi_secunda === 2)).toBe(true)
    expect(okId(r, 'E2.ok')).toBeUndefined(); expect(r.verdict.stare).toBe('BLOCKED')
    verificaInvarianti(r)
  })
  it('confirmata_de = "" → E2_01 (neconfirmată), nu E2.ok', () => {
    const r = cu(s => { s.surse.cerinte.date[0].e2_confirmata_de = ''; Object.assign(s.surse.e2_neconfirmate.date, { cerinte_neconfirmate_cu_capitol: 1, cerinte_neconfirmate_ids: [11] }) })
    expect(ex(r, 'E2_01:cap:1').elemente.map(x => x.cerinta_id)).toEqual([11]); expect(okId(r, 'E2.ok')).toBeUndefined()
  })
  it('confirmare fără moment (e2_confirmata_la NULL) → E2_BLOC confirmata_fara_moment; câmp absent → E2_BLOC indisponibil', () => {
    const r = cu(s => { s.surse.cerinte.date[0].e2_confirmata_la = null })
    expect(exR(r, 'E2_BLOC').flatMap(e => e.elemente).map(x => x.motiv)).toEqual(['confirmata_fara_moment'])
    const r2 = cu(s => { s.surse.cerinte.date.forEach(c => { delete c.e2_confirmata_la }) })
    expect(indIds(r2)).toContain('IND:control:forma_invalida:E2_BLOC'); expect(okId(r2, 'E2.ok')).toBeUndefined(); expect(r2.verdict.stare).toBe('INDISPONIBIL')
  })
  it103('fixture 103: 395 confirmări E2 în aceeași secundă → E2_BLOC (Σ 395, 12 grupuri); 22 individuale; fără E2.ok', () => {
    const g = exR(r103, 'E2_BLOC')
    expect(sumEl(g)).toBe(395); expect(g).toHaveLength(12)
    expect(new Set(g.flatMap(e => e.elemente.map(x => x.detalii.confirmata_la)))).toEqual(new Set(['2026-09-15T12:31:09']))
    expect(okId(r103, 'E2.ok')).toBeUndefined()
    expect(g.every(e => e.blocheaza_final && e.clasa === 'CONFIRM' && e.provenienta.sursa === 'om_in_bloc')).toBe(true)
  })
})

describe('F8 — fără verde prin absență: universul 0 nu produce *.ok', () => {
  it('0 cerințe PT (doar o eliminatorie dovedită și una contractuală) → PT00 HUMAN_DECISION blocant, fără PT01.ok / PT05.ok, verdict BLOCKED', () => {
    const r = cu(s => { s.surse.cerinte.date.splice(0, 2); s.surse.legaturi.date = []; s.surse.acoperire.date.splice(0, 2)
      Object.assign(s.surse.pt_stare.date, { de_raspuns: 0, cu_capitol: 0 }) })
    expect(ex(r, 'PT00')).toMatchObject({ clasa: 'HUMAN_DECISION', blocheaza_final: true })
    for (const id of ['PT01.ok', 'PT05.ok', 'PT.ok_verificate']) expect(okId(r, id)).toBeUndefined()
    expect(r.verdict.stare).toBe('BLOCKED'); verificaInvarianti(r)
  })
  it('cerinte = [] → DEP00 + PT00, și niciun rând ok cu „0 din 0" / „Toate cele 0"', () => {
    const r = cu(s => { s.surse.cerinte.date = []; s.surse.legaturi.date = []; s.surse.acoperire.date = [] })
    expect(ex(r, 'DEP00')).toBeTruthy(); expect(ex(r, 'PT00')).toBeTruthy()
    for (const id of ['E2.ok', 'PT01.ok', 'PT05.ok']) expect(okId(r, id)).toBeUndefined()
    expect(r.ok.some(o => /\b0 din 0\b|Toate cele 0\b/.test(o.titlu))).toBe(false)
    verificaInvarianti(r)
  })
})

describe('F10 — workspace: starea e a legăturii din capitol, nu a cerinței', () => {
  it('cerința verificată în cap. 2, dar legătura AI din cap. 1 (principal) neverificată → pe cap. 1 NU apare „verificată de om"', () => {
    const s = snapCurat()
    Object.assign(s.surse.legaturi.date[0], { stare: 'atribuita', verificat_la_versiunea: null, confirmat_de: null, confirmat_la: null })
    s.surse.legaturi.date.push(leg(103, 11, 2))   // verificată pe cap. 2, versiunea curentă 1
    const r = construiesteAtentia(s, A0), c = construiesteCuprins(s, A0, r)
    const x1 = c.capitole.find(k => k.id === 1).cerinte.find(x => x.cerinta_id === 11)
    expect(x1).toMatchObject({ stare: 'verificata_alt_capitol', verificata_in_capitol: 2, principal: true })
    expect(c.capitole.find(k => k.id === 1).progres).toMatchObject({ total: 1, verificate_om: 0, verificate_alt_capitol: 1 })
    expect(c.capitole.find(k => k.id === 2).cerinte.find(x => x.cerinta_id === 11).stare).toBe('verificata_om')
    const html = renderToStaticMarkup(h(EcranAtentie, { rezultat: r, cuprins: c, snapshot: s, capSel: 1 }))
    expect(html).toContain('verificată în alt capitol, nu aici (cap. 2)')
  })
})

describe('F11 — sursă „ok" venită cu eroare = eroare', () => {
  it.each([['echipa_blocaje', [], 'F9.ok'], ['r5', { licitatie_id: L, rezultat: null }, 'R5.ok']])('%s {stare:ok, eroare:…} → indisponibil (eroare), fără %s', (n, date, okid) => {
    const r = cu(s => { s.surse[n] = ok(date, { eroare: 'timeout PostgREST' }) })
    expect(indIds(r)).toContain(`IND:${n}:eroare`); expect(okId(r, okid)).toBeUndefined(); expect(r.verdict.stare).toBe('INDISPONIBIL')
    verificaInvarianti(r)
  })
})

describe('F12 — proveniența „om" cere un actor nevid', () => {
  it('verificat_pe_scan = true cu verificat_de NULL / "" → R06_FARA_AUTOR (blochează), fără R06.ok_dovedite', () => {
    for (const v of [null, '', '  ']) {
      const r = cu(s => { s.surse.acoperire.date[2].verificat_de = v })
      expect(ex(r, 'R06_FARA_AUTOR')).toMatchObject({ clasa: 'CONFIRM', blocheaza_final: true, numar: 1 }); expect(okId(r, 'R06.ok_dovedite')).toBeUndefined()
      expect(r.verdict.stare).toBe('BLOCKED'); verificaInvarianti(r)
    }
  })
  it('legătură verificată cu confirmat_de = "" → neverificată (PT02) + INT04, nu PT.ok_verificate pentru ea', () => {
    const r = cu(s => { s.surse.legaturi.date[0].confirmat_de = ''; s.surse.pt_stare.date.cerinte_neverificate = 1 })
    expect(ex(r, 'PT02:cap:1').elemente[0]).toMatchObject({ cerinta_id: 11, motiv: 'neverificata' }); expect(ex(r, 'INT04').elemente.some(x => x.legatura_id === 101)).toBe(true)
    expect(okId(r, 'PT.ok_verificate').numar).toBe(1)
  })
})

describe('F13 — pe date vechi / expirate nimic nu e randat verde', () => {
  it.each([['expirat', 3 * 3600e3], ['stale', 30 * MIN]])('snapshot curat %s: niciun #3FB950 în ecran, chipurile spun de ce', (cal, dt) => {
    const o = { acum: Date.parse(T0) + dt, licitatieId: L }
    const s = snapCurat(); s.surse.legaturi.date.push({ id: 104, cerinta_id: 99, capitol_id: null, capitol_licitatie_id: null, fel: 'exceptat', stare: 'atribuita', sursa: 'om' })
    const r = construiesteAtentia(s, o), c = construiesteCuprins(s, o, r)
    expect(c.calitate).toBe(cal)
    for (const capSel of [1, 'fara']) {
      const html = renderToStaticMarkup(h(EcranAtentie, { rezultat: r, cuprins: c, snapshot: s, capSel }))
      expect(html).not.toMatch(/#3FB950/i)
    }
    const html = renderToStaticMarkup(h(EcranAtentie, { rezultat: r, cuprins: c, snapshot: s, capSel: 1 }))
    expect(html).toContain(cal === 'expirat' ? '✓ verificată de om (din date expirate)' : '✓ verificată de om (date vechi)')
  })
})

describe('F14 — rânduri ale altei licitații sub o sursă declarată 103', () => {
  it.each(['cerinte', 'capitole', 'documente', 'acoperire'])('%s: un rând cu licitatie_id 9001 → sursa alta_licitatie, verdict INDISPONIBIL', n => {
    const r = cu(s => { s.surse[n].date[0].licitatie_id = 9001 })
    expect(indIds(r)).toContain(`IND:${n}:alta_licitatie`); expect(r.verdict.stare).toBe('INDISPONIBIL')
    verificaInvarianti(r)
  })
})

describe('F15 — DEP_ROSII: documente referite, dar necitite / fără termen = valabilitate necunoscută', () => {
  it('acoperire cu doc_firma_id absent din citire → DEP_ROSII indisponibil, verdict INDISPONIBIL', () => {
    const r = cu(s => { s.surse.acoperire.date[2].doc_firma_id = 999 })
    expect(indIds(r)).toContain('IND:control:forma_invalida:DEP_ROSII'); expect(r.verdict.stare).toBe('INDISPONIBIL')
    expect(r.indisponibile.find(i => i.id === 'IND:control:forma_invalida:DEP_ROSII').detaliu).toContain('doc 999')
    verificaInvarianti(r)
  })
  it('termen_depunere lipsă → DEP_ROSII indisponibil (nu se înlocuiește cu ziua de azi)', () => {
    const r = cu(s => { s.surse.licitatie.date.termen_depunere = null })
    expect(indIds(r)).toContain('IND:control:forma_invalida:DEP_ROSII'); expect(ex(r, 'DEP_ROSII')).toBeUndefined(); expect(r.verdict.stare).toBe('INDISPONIBIL')
  })
})

describe('V2-1 — ecranul: fără listă construibilă nu există „(0)", „Nicio excepție" sau contoare pe 0', () => {
  const randeaza = (snap, lic) => {
    const o = { acum: dupa(5 * MIN), licitatieId: lic }
    const r = construiesteAtentia(snap, o)
    return { r, html: renderToStaticMarkup(h(EcranAtentie, { rezultat: r, cuprins: construiesteCuprins(snap, o, r), snapshot: snap })) }
  }
  const toateInEroare = () => { let s = snapCurat(); s.capturat_la = CAPT; for (const n of SURSE_OBLIGATORII) s = cuEroare(s, n); for (const n of SURSE_OBLIGATORII) s.surse[n].citit_la = CAPT; return s }
  it.each([['SNAP:licitatie_nepermisa', () => [snapshotSintetic(LICITATIE_B, CAPT), LICITATIE_B]], ['SNAP:alta_licitatie', () => [snapshotSintetic(LICITATIE_B, CAPT), LICITATIE_A]],
    ['toate sursele în eroare', () => [toateInEroare(), L]]])('%s', (_, f) => {
    const [snap, lic] = f()
    const { r, html } = randeaza(snap, lic)
    expect(r.verdict.lista_construita).toBe(false); expect(r.verdict.stare).toBe('INDISPONIBIL')
    expect(html).not.toContain('Nicio excepție'); expect(html).not.toMatch(/atenția ta \(0/i); expect(html).not.toContain('0 blocaje')
    expect(html).not.toContain('0 grupuri de confirmat'); expect(html).toContain('Lista nu poate fi construită'); expect(html).toContain('contoare: —')
  })
  it('eroare parțială pe capitole → contoarele spun „+ N reguli neevaluate" pe clasele afectate (CONFIRM inclus), nu un 0 simplu', () => {
    const s = cuEroare(snapCurat(), 'capitole')
    const r = construiesteAtentia(s, A0)
    expect(r.verdict.lista_construita).toBe(true)
    expect(r.verdict.neevaluate_pe_clasa.CONFIRM).toEqual(expect.arrayContaining(['CAP02', 'PT02']))
    const html = renderToStaticMarkup(h(EcranAtentie, { rezultat: r, cuprins: construiesteCuprins(s, A0, r), snapshot: s }))
    expect(html).toMatch(/0 grupuri de confirmat \(0 rânduri\) \+ \d+ reguli neevaluate/)
    expect(html).not.toContain('Nicio excepție în sursele citite')
  })
})

describe('„Du-mă acolo" — destinația (măsurat în Playwright: grupul E2 „fără capitol" ducea în vederea PT, unde cerințele lui nu apar)', () => {
  it('capitol → workspace-ul capitolului; PT fără capitol → vederea „fără capitol"; E2 / R06 fără capitol → ecranul din aplicație (mesaj), nu vederea PT', () => {
    const r = cu(s => { s.surse.legaturi.date.splice(0, 1); s.surse.cerinte.date[0].e2_confirmata_de = null; s.surse.acoperire.date[0].status = 'gol'
      Object.assign(s.surse.e2_neconfirmate.date, { cerinte_neconfirmate_cu_capitol: 0, cerinte_neconfirmate_ids: [] }) })
    expect(destinatieDuMa(ex(r, 'PT01'))).toEqual({ capitol_id: 'fara' })
    expect(destinatieDuMa(ex(r, 'E2_01:fara_capitol'))).toBeNull()
    const r2 = cu(s => { s.surse.legaturi.date[0] = { ...s.surse.legaturi.date[0], stare: 'atribuita', verificat_la_versiunea: null, confirmat_de: null }; s.surse.pt_stare.date.cerinte_neverificate = 1 })
    expect(destinatieDuMa(ex(r2, 'PT02:cap:1'))).toEqual({ capitol_id: 1 })
  })
  it103('fixture 103: E2_BLOC:fara_capitol (141 de cerințe, majoritatea ne-PT) nu mai duce în vederea PT „fără capitol"', () => {
    expect(ex(r103, 'E2_BLOC:fara_capitol').numar).toBe(141); expect(destinatieDuMa(ex(r103, 'E2_BLOC:fara_capitol'))).toBeNull()
  })
})
