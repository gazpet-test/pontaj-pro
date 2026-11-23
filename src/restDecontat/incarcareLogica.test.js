// Teste pentru logica ecranului de încărcare (Task 4): ce blochează „Confirm”, ce primește RPC-ul, clasificarea erorilor (L05), amprenta,
// reconcilierea după amprentă (r2), citirea pe pagini. Așteptările sunt scrise de mână (L25); contractul RPC-ului (cheile liniilor / ale
// obiectului p_linii, p_fisier NULL acceptat) se compară cu TEXTUL migrărilor (L19: o singură definiție).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import {
  randuriInitiale, controlCumulat, optiuniArticol, efectiv, blocajeRanduri, liniiSituatie, pLiniiSituatie, totalLinii, verificaSituatie, verificaBaza,
  liniiBaza, clasificaEroare, sha256Hex, citesteToate, nrSituatieCanonic, POTRIVIRE_RPC, PRAG_DIFERENTA_LEI, stareDupaAmprenta, reconciliereDupaRefuz,
  MESAJ_BAZA_NEVERIFICABIL, INDICIU_BAZA_NEVERIFICABIL,
} from './incarcareLogica.js'
import { potrivesteLinii } from './potrivire.js'
import { clientFals } from './restDecontat.testutil.jsx'

const MIG = fs.readFileSync(new URL('../../supabase/migrations/20270105a_executie_rest_decontat.sql', import.meta.url), 'utf8').replace(/\r/g, '')
const corpFunctie = nume => MIG.slice(MIG.indexOf(`CREATE FUNCTION public.${nume}(`), MIG.indexOf(`REVOKE ALL ON FUNCTION public.${nume}(`))
const listaSql = s => [...s.matchAll(/'([a-z_]+)'/g)].map(m => m[1])

// baza (rânduri ca în v_executie_rest_decontat_baza) — coduri inventate
const B = (cheie, extra) => ({ cheie, tip_rand: 'articol', obiect_cod: '0001', deviz_cod: 'DZ0101', nr: null, cod: cheie.split('|')[2], denumire: 'LUCRARE ' + cheie, um: 'M', um_incert: false, ...extra })
const BAZA = [
  B('0001|DZ0101|TSA01A1', { um: 'MC' }),
  B('0001|DZ0101|TSB02', { um: 'M' }),
  B('0001|DZ0101|TSC03', { um: 'BUC' }),
  B('0002|DZ0201|TSA01A1', { obiect_cod: '0002', deviz_cod: 'DZ0201', um: 'MC' }),
  B('0001|DZ0101|OS', { tip_rand: 'os', um: 'LEI' }),
]
const L = (extra) => ({ obiect_cod: '0001', deviz_cod: 'DZ0101', nr: '001', cod: 'TSA01A1', denumire: 'SAPATURA', um: 'M.C.', cantitate: 10, valoare: 100, tip_rand: 'articol', ...extra })

describe('rândurile: ce blochează și ce se trimite', () => {
  const pot = potrivesteLinii([
    L(),                                                        // 0: exact (cod + obiect)
    L({ nr: '002', cod: 'XYZ99', valoare: 50 }),                // 1: cod inexistent → de_verificat
    L({ nr: '003', cod: 'TSB02', um: 'MP', valoare: 20 }),      // 2: UM diferit (MP vs M) → de_verificat
    L({ nr: '004', obiect_cod: '0003', cod: 'TSC03', um: 'BUC.', valoare: 5 }),  // 3: codul există doar în alt obiect, unic → 'cod'
  ], BAZA)
  const rs = randuriInitiale(pot)
  const pe = new Map(BAZA.map(b => [b.cheie, b]))

  it('nivelurile propuse (din potrivire.js) și blocajele inițiale', () => {
    expect(pot.map(p => p.nivel)).toEqual(['exact', 'de_verificat', 'de_verificat', 'cod'])
    const bl = blocajeRanduri(rs, BAZA)
    expect([...bl.keys()].sort()).toEqual([1, 2])
    expect(efectiv(rs[0], pe)).toEqual({ tip_rand: 'articol', cheie: '0001|DZ0101|TSA01A1', potrivire: 'exact' })
    expect(efectiv(rs[3], pe)).toEqual({ tip_rand: 'articol', cheie: '0001|DZ0101|TSC03', potrivire: 'cod' })
  })

  it('alegerea manuală: doar articole cu același UM normalizat; rezolvă rândul cu potrivire „manual”', () => {
    expect(optiuniArticol(rs[1].linie, BAZA).map(b => b.cheie)).toEqual(['0001|DZ0101|TSA01A1', '0002|DZ0201|TSA01A1'])   // M.C. = MC
    expect(optiuniArticol(rs[2].linie, BAZA)).toEqual([])                                                                    // MP: nimic
    const r1 = { ...rs[1], decizie: { tip: 'articol', cheie: '0002|DZ0201|TSA01A1' } }
    expect(efectiv(r1, pe)).toEqual({ tip_rand: 'articol', cheie: '0002|DZ0201|TSA01A1', potrivire: 'manual' })
    // o alegere cu alt UM (forțată din afară) rămâne blocată, nu se trimite
    expect(efectiv({ ...rs[2], decizie: { tip: 'articol', cheie: '0001|DZ0101|TSB02' } }, pe).blocat).toMatch(/UM diferit/)
  })

  it('articol nou: cheie NULL, potrivire NULL, tip articol_nou; fără denumire = blocat', () => {
    expect(efectiv({ ...rs[2], decizie: { tip: 'articol_nou' } }, pe)).toEqual({ tip_rand: 'articol_nou', cheie: null, potrivire: null })
    expect(efectiv({ ...rs[2], linie: { ...rs[2].linie, denumire: '  ' }, decizie: { tip: 'articol_nou' } }, pe).blocat).toMatch(/denumire/)
  })

  it('același articol ales pentru două linii = ambele blocate (RPC-ul ar refuza)', () => {
    const r = [rs[0], { ...rs[1], decizie: { tip: 'articol', cheie: '0001|DZ0101|TSA01A1' } }]
    const bl = blocajeRanduri(r, BAZA)
    expect([...bl.keys()].sort()).toEqual([0, 1])
    expect(bl.get(0)).toMatch(/același articol/)
  })

  it('linia incompletă în fișier (valoare null) blochează, nu se trimite pe jumătate', () => {
    const r = randuriInitiale(potrivesteLinii([L({ valoare: null })], BAZA))
    expect(blocajeRanduri(r, BAZA).get(0)).toMatch(/incompletă/)
    expect(() => liniiSituatie(r, BAZA)).toThrow(/incompletă/)
  })

  it('potrivirea pe denumire cere confirmarea omului → „descriere_confirmata”', () => {
    const r = { i: 0, linie: { ...L({ cod: '' }), nivel: 'descriere', cheie_propusa: '0001|DZ0101|TSA01A1' }, decizie: null }
    expect(efectiv(r, pe).blocat).toMatch(/denumire/)
    expect(efectiv({ ...r, decizie: { tip: 'confirm' } }, pe)).toEqual({ tip_rand: 'articol', cheie: '0001|DZ0101|TSA01A1', potrivire: 'descriere_confirmata' })
  })

  it('liniile pentru RPC: câmpurile EXACT din contractul fn_rest_decontat_confirma_situatie (paritate cu migrarea)', () => {
    const r = rs.map(x => (x.i === 1 ? { ...x, decizie: { tip: 'articol_nou' } } : x.i === 2 ? { ...x, decizie: { tip: 'articol_nou' } } : x))
    const p = pLiniiSituatie({ randuri: r, baza: BAZA, luna: 10, an: 2026, acceptDiferenta: false })
    const corp = corpFunctie('fn_rest_decontat_confirma_situatie')
    const cheiObiect = listaSql(corp.match(/jsonb_object_keys\(p_linii\) k WHERE k NOT IN \(([^)]*)\)/)[1])
    const cheiLinie = listaSql(corp.match(/jsonb_object_keys\(e\) k WHERE k NOT IN \(([\s\S]*?)\)\) THEN/)[1])
    expect(Object.keys(p).sort()).toEqual([...cheiObiect].sort())
    for (const l of p.linii) expect(Object.keys(l).sort()).toEqual([...cheiLinie].sort())
    expect(p.linii.map(l => [l.tip_rand, l.cheie, l.potrivire])).toEqual([
      ['articol', '0001|DZ0101|TSA01A1', 'exact'], ['articol_nou', null, null], ['articol_nou', null, null], ['articol', '0001|DZ0101|TSC03', 'cod'],
    ])
    // potrivirile trimise sunt exact cele acceptate de CHECK-ul tabelului
    const ck = listaSql(MIG.match(/executie_sl_detaliu_linii_potrivire_ck CHECK \(potrivire IS NULL OR potrivire IN \(([^)]*)\)\)/)[1])
    expect(Object.values(POTRIVIRE_RPC).sort()).toEqual([...ck].sort())
    expect(p.linii[0]).toMatchObject({ cantitate_perioada: 10, cantitate_cumulat_doc: null, pret_unitar: null, valoare: 100 })
    expect(totalLinii(p.linii)).toBe(175)
  })
})

describe('controlul cumulatului (când documentul îl dă)', () => {
  const pot = potrivesteLinii([L({ um: '100 MC', cantitate: 0.5, cantitate_cumulat_doc: 2 })], [B('0001|DZ0101|TSA01A1', { um: 'MC' })])
  it('cumulat = decontat anterior + perioada (în UM-ul de bază, 100 MC = 100 MC × factor) → neschimbat', () => {
    // anterior 150 MC + 0,5 × 100 = 200 = 2 × 100
    const r = controlCumulat(randuriInitiale(pot), new Map([['0001|DZ0101|TSA01A1', 150]]))
    expect(r[0].linie.nivel).toBe('exact')
  })
  it('diferență peste 0,001 → de_verificat, cu motivul scris', () => {
    const r = controlCumulat(randuriInitiale(pot), new Map([['0001|DZ0101|TSA01A1', 149.9]]))
    expect(r[0].linie.nivel).toBe('de_verificat')
    expect(r[0].linie.motiv).toMatch(/cumulatul din document \(200\)/)
  })
  it('la înlocuirea situației controlul nu se poate face → de_verificat', () => {
    expect(controlCumulat(randuriInitiale(pot), new Map(), { inlocuire: true })[0].linie.nivel).toBe('de_verificat')
  })
  it('fără cumulat în document (F3) nu se schimbă nimic', () => {
    const p = potrivesteLinii([L()], BAZA)
    expect(controlCumulat(randuriInitiale(p), new Map())[0].linie.nivel).toBe('exact')
  })
})

describe('verificaSituatie: butonul „Confirm”', () => {
  const rez = { complet: true, probleme: [], linii: [L()] }
  const randuri = randuriInitiale(potrivesteLinii(rez.linii, BAZA))
  const baz = { rez, randuri, baza: BAZA, nr: 'sl 3', luna: 10, an: 2026, existente: [], amprenta: 'a'.repeat(64), inlocuieste: false, referinta: null, acceptDiferenta: false, acceptProbleme: false }
  it('totul în regulă → ok', () => { expect(verificaSituatie(baz)).toMatchObject({ ok: true, motive: [] }) })
  it('nr / luna / anul lipsă sau invalide', () => {
    expect(verificaSituatie({ ...baz, nr: '  ' }).motive.join()).toMatch(/numărul situației lipsește/)
    expect(verificaSituatie({ ...baz, luna: null }).ok).toBe(false)
    expect(verificaSituatie({ ...baz, luna: 13 }).ok).toBe(false)
    expect(verificaSituatie({ ...baz, an: 1999 }).ok).toBe(false)
  })
  it('nr existent (normalizat ca în RPC) cere „înlocuiește”; cu bifa trece; „înlocuiește” fără nr existent = refuz', () => {
    const existente = [{ nr_situatie: 'SL 3', versiune: 1, amprenta: 'b'.repeat(64) }]
    const v = verificaSituatie({ ...baz, existente })
    expect(v.ok).toBe(false); expect(v.motive.join()).toMatch(/există deja \(versiunea 1\)/); expect(v.exista.versiune).toBe(1)
    expect(verificaSituatie({ ...baz, existente, inlocuieste: true }).ok).toBe(true)
    expect(verificaSituatie({ ...baz, inlocuieste: true }).ok).toBe(false)
    expect(nrSituatieCanonic('  sl\t 3 ')).toBe('SL 3')
  })
  it('aceeași amprentă deja confirmată → blocat (nu se dublează)', () => {
    expect(verificaSituatie({ ...baz, existente: [{ nr_situatie: 'SL 9', versiune: 1, amprenta: 'a'.repeat(64) }] }).motive.join()).toMatch(/deja confirmat/)
  })
  it('citire incompletă (complet: false) cere bifa omului', () => {
    const r2 = { ...rez, complet: false, probleme: [{ motiv: 'x' }] }
    expect(verificaSituatie({ ...baz, rez: r2 }).ok).toBe(false)
    expect(verificaSituatie({ ...baz, rez: r2, acceptProbleme: true }).ok).toBe(true)
  })
  it('diferența față de situația de plată: ≤ 1 leu trece, peste cere „accept diferența”', () => {
    expect(verificaSituatie({ ...baz, referinta: 100 + PRAG_DIFERENTA_LEI }).ok).toBe(true)
    const v = verificaSituatie({ ...baz, referinta: 98.5 })
    expect(v.ok).toBe(false); expect(v.diferenta).toBe(1.5)
    expect(verificaSituatie({ ...baz, referinta: 98.5, acceptDiferenta: true }).ok).toBe(true)
  })
  it('un rând de_verificat nerezolvat blochează', () => {
    const r = randuriInitiale(potrivesteLinii([L({ cod: 'NUEXISTA' })], BAZA))
    expect(verificaSituatie({ ...baz, randuri: r }).motive.join()).toMatch(/1 linii nerezolvate/)
  })
})

describe('verificaBaza: devizele ofertei / AA / notelor', () => {
  const rez = { complet: true, probleme: [], linii: [L({ cantitate: -2, valoare: -20 }), L({ nr: '002', cod: 'B' })] }
  it('AA: actul și modul obligatorii; lista completă nu are cantități negative', () => {
    expect(verificaBaza({ rez, sursa: 'act_aditional', mod: 'diferente' }).motive.join()).toMatch(/alegeți actul/)
    expect(verificaBaza({ rez, sursa: 'act_aditional', mod: 'diferente', actId: 4 })).toMatchObject({ ok: true, mod: 'diferente' })
    expect(verificaBaza({ rez, sursa: 'act_aditional', mod: 'lista_completa', actId: 4 }).motive.join()).toMatch(/negative/)
  })
  it('oferta = listă completă (cantitățile negative refuzate)', () => {
    expect(verificaBaza({ rez, sursa: 'contract_initial' }).mod).toBe('lista_completa')
    expect(verificaBaza({ rez, sursa: 'contract_initial' }).ok).toBe(false)
  })
  it('nota: aleasă și aprobată; doar diferențe', () => {
    const note = [{ id: 1, tip: 'NR', data_aprobare: null }, { id: 2, tip: 'NR', data_aprobare: '2026-10-01' }]
    expect(verificaBaza({ rez, sursa: 'nota_renuntare', notaId: 1, note }).motive.join()).toMatch(/aprobării/)
    expect(verificaBaza({ rez, sursa: 'nota_renuntare', notaId: 2, note })).toMatchObject({ ok: true, mod: 'diferente' })
  })
  it('liniile bazei: câmpurile EXACT din contractul fn_rest_decontat_confirma_baza (paritate cu migrarea)', () => {
    const corp = corpFunctie('fn_rest_decontat_confirma_baza')
    const chei = listaSql(corp.match(/jsonb_object_keys\(e\) k WHERE k NOT IN \(([\s\S]*?)\)\) THEN/)[1])
    for (const l of liniiBaza(rez)) expect(Object.keys(l).sort()).toEqual([...chei].sort())
    expect(liniiBaza(rez)[0]).toMatchObject({ cantitate: -2, valoare: -20, pret_unitar: null })
  })
})

describe('clasificaEroare (L05: doar 4xx / SQLSTATE e refuz cert)', () => {
  it('rețea (status 0), 5xx, excepție = necunoscut', () => {
    expect(clasificaEroare({ error: { message: 'TypeError: Failed to fetch' }, status: 0 }).tip).toBe('necunoscut')
    expect(clasificaEroare({ error: { message: 'gateway timeout' }, status: 504 }).tip).toBe('necunoscut')
    expect(clasificaEroare(new TypeError('Failed to fetch')).tip).toBe('necunoscut')
    expect(clasificaEroare({ error: { message: 'fără cod' } }).tip).toBe('necunoscut')
  })
  it('refuzul BD-ului: mesajul în clar + indiciul pe cod', () => {
    const c = clasificaEroare({ error: { code: '23505', message: 'rest_decontat: situatia SL 3 exista deja (versiunea 1); inlocuirea cere confirmare explicita (situatie_existenta)' }, status: 409 })
    expect(c).toMatchObject({ tip: 'refuz', cod: '23505' }); expect(c.mesaj).toMatch(/situatie_existenta/); expect(c.indiciu).toMatch(/înlocuiește/)
    expect(clasificaEroare({ error: { code: 'P0001', message: 'rest_decontat: proiectul nu are oferta financiara confirmata (fara_baza)' } }).indiciu).toMatch(/oferta/)
    expect(clasificaEroare({ error: { code: '42501', message: 'rest_decontat: proiectul nu exista sau nu ai drept' }, status: 403 }).indiciu).toMatch(/drept/)
  })
})

describe('fișierul nu se păstrează (r2, verdict #1178 P1): p_fisier NULL e acceptat de ambele RPC-uri', () => {
  it('validarea din migrare lasă p_fisier NULL (doar lungimea unui text NENUL e verificată) pe confirma_situatie ȘI confirma_baza', () => {
    for (const fn of ['fn_rest_decontat_confirma_situatie', 'fn_rest_decontat_confirma_baza']) {
      const corp = corpFunctie(fn)
      expect(corp).toContain('(p_fisier IS NOT NULL AND length(p_fisier) NOT BETWEEN 1 AND 1000)')
      expect(corp).not.toMatch(/p_fisier IS NULL/)
    }
  })
  it('modulul logicii nu mai exportă nimic despre Storage (bucket / cale / „deja încărcat”)', async () => {
    const m = await import('./incarcareLogica.js')
    expect(Object.keys(m).filter(k => /bucket|cale|incarcat|storage/i.test(k))).toEqual([])
  })
})

describe('stareDupaAmprenta + reconciliereDupaRefuz (L05: după un rezultat necunoscut, refuzul nu dovedește „nimic scris”)', () => {
  const AMP = 'a'.repeat(64)
  const drept = (...raspunsuri) => { let i = 0; return fn => (fn === 'fn_rest_decontat_drept' ? raspunsuri[Math.min(i++, raspunsuri.length - 1)] : { data: null, error: null }) }
  const DA = { data: true, error: null }, NU = { data: false, error: null }
  const REFUZ = clasificaEroare({ error: { code: '42501', message: 'rest_decontat: proiectul nu exista sau nu ai drept sa confirmi situatii' }, status: 403 })
  it('situația ACTIVĂ cu amprenta = scris → ok (chiar și fără drept de citire: rândul găsit e dovadă)', async () => {
    const { client, st } = clientFals({ tabele: { executie_sl_detaliu: [{ id: 3, proiect_id: 1, nr_situatie: 'SL 3', versiune: 2, activ: true, amprenta: AMP }] }, rpc: drept(NU) })
    const v = await stareDupaAmprenta({ client, pid: 1, eSit: true, amprenta: AMP })
    expect(v).toMatchObject({ scris: true }); expect(v.dovada).toMatch(/SL 3.*versiunea 2/)
    expect(st.cereri.at(-1)).toMatchObject({ tabel: 'executie_sl_detaliu', eq: [['proiect_id', 1], ['amprenta', AMP]] })
    expect(reconciliereDupaRefuz(v, REFUZ)).toMatchObject({ stare: 'ok' })
  })
  it('doar versiune inactivă = retras → refuz cu explicația (nu „ok”, nu necunoscut)', async () => {
    const { client } = clientFals({ tabele: { executie_sl_detaliu: [{ id: 3, proiect_id: 1, nr_situatie: 'SL 3', versiune: 1, activ: false, amprenta: AMP }] }, rpc: drept(DA) })
    const v = await stareDupaAmprenta({ client, pid: 1, eSit: true, amprenta: AMP })
    expect(v).toMatchObject({ retras: true })
    expect(reconciliereDupaRefuz(v, REFUZ)).toMatchObject({ stare: 'refuz', mesaj: REFUZ.mesaj, reconciliat: expect.stringMatching(/înlocuită/) })
  })
  it('absent + drept de citire înainte ȘI după → absent dovedit → refuzul devine final (cu „verificat în ERP”)', async () => {
    const { client, st } = clientFals({ tabele: { executie_sl_detaliu: [{ id: 3, proiect_id: 2, nr_situatie: 'X', versiune: 1, activ: true, amprenta: AMP }] }, rpc: drept(DA, DA) })
    const v = await stareDupaAmprenta({ client, pid: 1, eSit: true, amprenta: AMP })
    expect(v).toEqual({ absent: true })
    expect(st.rpc.map(r => r.args)).toEqual([{ p_proiect: 1, p_nivel: 'citire' }, { p_proiect: 1, p_nivel: 'citire' }])
    expect(reconciliereDupaRefuz(v, REFUZ)).toMatchObject({ stare: 'refuz', reconciliat: expect.stringMatching(/NU s-a scris/) })
  })
  it('absent dar FĂRĂ drept de citire (înainte sau după) / eroare la drept / eroare la citire → neverificabil → rămâne necunoscut', async () => {
    for (const r of [drept(NU, DA), drept(DA, NU), drept({ data: null, error: { message: 'timeout' } })]) {
      const { client } = clientFals({ rpc: r })
      const v = await stareDupaAmprenta({ client, pid: 1, eSit: true, amprenta: AMP })
      expect(v.neverificabil).toBeTruthy()
      const t = reconciliereDupaRefuz(v, REFUZ)
      expect(t.stare).toBe('necunoscut'); expect(JSON.stringify(t)).not.toMatch(/[Nn]imic nu s-a scris/)
    }
    const { client } = clientFals({ rpc: drept(DA), erori: { executie_sl_detaliu: { message: 'permission denied' } } })
    expect((await stareDupaAmprenta({ client, pid: 1, eSit: true, amprenta: AMP })).neverificabil).toMatch(/permission denied/)
  })
  it('devizul de bază: rânduri în proiect_articole = scris; doar în istoric (rand->>fisier_amprenta) = retras', async () => {
    const a = clientFals({ tabele: { proiect_articole: [{ id: 9, proiect_id: 1, fisier_amprenta: AMP }] }, rpc: drept(DA) })
    expect(await stareDupaAmprenta({ client: a.client, pid: 1, eSit: false, amprenta: AMP })).toMatchObject({ scris: true })
    const h = clientFals({ tabele: { proiect_articole_istoric: [{ id: 4, proiect_id: 1, rand: { fisier_amprenta: AMP } }] }, rpc: drept(DA) })
    expect(await stareDupaAmprenta({ client: h.client, pid: 1, eSit: false, amprenta: AMP })).toMatchObject({ retras: true })
    expect(h.st.cereri.at(-1)).toMatchObject({ tabel: 'proiect_articole_istoric', eq: [['proiect_id', 1], ['rand->>fisier_amprenta', AMP]] })
  })
  // r3 (verdict #1178 r2, P1): dreptul „Rest de decontat” NU garantează vizibilitatea în proiect_articole → „negăsit” nu e niciodată absență dovedită
  it('devizul de bază NEGĂSIT, chiar cu dreptul de citire adevărat înainte și după → neverificabil (nu absent) → rămâne necunoscut, cu „întrebați un administrator”', async () => {
    for (const r of [drept(DA, DA), drept(NU), drept({ data: null, error: { message: 'timeout' } })]) {
      const g = clientFals({ rpc: r })
      const v = await stareDupaAmprenta({ client: g.client, pid: 1, eSit: false, amprenta: AMP })
      expect(v.absent).toBeUndefined()
      expect(v).toEqual({ neverificabil: MESAJ_BAZA_NEVERIFICABIL, indiciu: INDICIU_BAZA_NEVERIFICABIL })
      const t = reconciliereDupaRefuz(v, REFUZ)
      expect(t.stare).toBe('necunoscut')
      expect(t.indiciu).toMatch(/întrebați un administrator sau verificați devizul în proiect/)
      expect(JSON.stringify(t)).not.toMatch(/NU s-a scris|[Nn]imic nu s-a scris/)
      expect(reconciliereDupaRefuz(v, null).stare).toBe('necunoscut')
    }
  })
  it('scenariul din verdict: devizul COMIS (rândurile există), dar RLS-ul le ascunde contului care păstrează dreptul Restului → necunoscut, nu „NU s-a scris”', async () => {
    const { client } = clientFals({ tabele: { proiect_articole: [{ id: 9, proiect_id: 1, fisier_amprenta: AMP }] }, ascunse: { proiect_articole: () => true }, rpc: drept(DA, DA) })
    const v = await stareDupaAmprenta({ client, pid: 1, eSit: false, amprenta: AMP })
    expect(v.neverificabil).toBe(MESAJ_BAZA_NEVERIFICABIL)
    expect(reconciliereDupaRefuz(v, REFUZ)).toMatchObject({ stare: 'necunoscut', indiciu: INDICIU_BAZA_NEVERIFICABIL })
  })
  it('premisa din migrare (L19): amprenta situației e vizibilă EXACT prin dreptul Restului; proiect_articole nu primește politică de la Rest de decontat', () => {
    expect(MIG).toContain("CREATE POLICY executie_sl_detaliu_citire ON public.executie_sl_detaliu FOR SELECT TO authenticated\n  USING (public.fn_rest_decontat_drept(proiect_id, 'citire'));")
    expect(MIG.match(/CREATE POLICY \w+ ON public\.executie_sl_detaliu\b/g)).toHaveLength(1)
    expect(MIG).not.toMatch(/CREATE POLICY \w+ ON public\.proiect_articole\s/)
    // nicio vedere / funcție de calcul nu expune amprenta bazei (dacă apare una, reconcilierea bazei se poate muta pe ea)
    for (const f of ['fn_rest_decontat_baza_calcul', 'fn_rest_decontat_calcul', 'fn_rest_decontat_obiect_calcul', 'fn_rest_decontat_lipsuri_calcul']) {
      expect(corpFunctie(f).split('LANGUAGE')[0]).not.toMatch(/amprenta/)
    }
  })
  it('devizul de bază: eroare la citirea bazei / a istoricului → necunoscut cu același indiciu', async () => {
    for (const t of ['proiect_articole', 'proiect_articole_istoric']) {
      const { client } = clientFals({ rpc: drept(DA), erori: { [t]: { message: 'permission denied for table ' + t } } })
      const v = await stareDupaAmprenta({ client, pid: 1, eSit: false, amprenta: AMP })
      expect(v).toEqual({ neverificabil: 'permission denied for table ' + t, indiciu: INDICIU_BAZA_NEVERIFICABIL })
    }
  })
  it('fără refuz („Verifică starea” după rețea): absent nu produce o stare finală', () => {
    expect(reconciliereDupaRefuz({ absent: true }, null).stare).toBe('necunoscut')
  })
})

describe('amprenta, citirea pe pagini', () => {
  it('sha256Hex: vectorul standard „abc”', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc').buffer)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
  it('citesteToate: pagini până la pagina goală; eroarea se aruncă; fără progres = eroare', async () => {
    const date = Array.from({ length: 2500 }, (_, i) => ({ k: `k${String(i).padStart(5, '0')}` }))
    const cereri = []
    const tot = await citesteToate((ultim, pas) => { cereri.push(ultim); const r = date.filter(x => ultim == null || x.k > ultim).slice(0, pas); return Promise.resolve({ data: r, error: null }) }, 'k')
    expect(tot.length).toBe(2500); expect(cereri.length).toBe(4)
    await expect(citesteToate(() => Promise.resolve({ data: null, error: { message: 'boom' } }), 'k')).rejects.toMatchObject({ message: 'boom' })
    await expect(citesteToate(() => Promise.resolve({ data: [{ k: 'a' }], error: null }), 'k')).rejects.toThrow(/fără progres/)
  })
  it('citesteToate cu plafonul serverului SUB pasul cerut (max-rows 300, pas 1000): toate rândurile, fără plafon tăcut (L23)', async () => {
    const rows = Array.from({ length: 2345 }, (_, i) => ({ proiect_id: 1, id: i + 1 }))
    const { client, st } = clientFals({ tabele: { t: rows }, plafon: 300 })
    const tot = await citesteToate((ultim, pas) => { let q = client.from('t').select('id').eq('proiect_id', 1).order('id').limit(pas); if (ultim != null) q = q.gt('id', ultim); return q }, 'id')
    expect(tot.map(x => x.id)).toEqual(rows.map(x => x.id))
    expect(st.cereri.length).toBe(Math.ceil(2345 / 300) + 1)
  })
})
