// Teste de componentă pentru ecranul de încărcare (Task 4, plan Step 1): componenta REALĂ montată cu react-dom în jsdom, cu un fișier F3 .docx
// SINTETIC (parsat de parsareSituatie.js, real) și un client Supabase FALS. Probează: cu un rând de verificat „Confirm” e dezactivat; după
// alegerea articolului se activează; la confirmare RPC-ul primește p_linii cu cheie NULL pentru articolul nou și p_inlocuieste = false; nicio
// scriere înainte de „Confirm”; fișierul NU se urcă nicăieri (p_fisier NULL, Storage neatins — r2, verdict #1178 P1); nr. existent cere
// „înlocuiește”; diferența față de situația de plată cere acceptare; L05 (r2, verdict #1178 P1-2): după un rezultat NECUNOSCUT, un refuz la
// reîncercare nu declară „nimic scris” — starea se reconciliază în BD după amprentă, câmpurile rămân blocate până atunci; L24: răspunsul sosit
// după închiderea panoului nu se aplică. Fără jsdom suita PICĂ explicit (nu se sare).
import { afterEach, it, expect, vi } from 'vitest'
import { createHash } from 'node:crypto'
vi.mock('../lib/supabase.js', () => ({ supabase: null }))
import IncarcareDocument from './IncarcareDocument.jsx'
import { domObligatoriu, clientFals, monteaza, curataTot, devizF3, fisierF3, amana } from './restDecontat.testutil.jsx'
import { MESAJ_FARA_FISIER } from './incarcareLogica.js'

afterEach(curataTot)

const BAZA = [
  { proiect_id: 1, cheie: '0001|DZ0101|TSA01A1', tip_rand: 'articol', obiect_cod: '0001', deviz_cod: 'DZ0101', nr: null, cod: 'TSA01A1', denumire: 'SAPATURA DE TEST', um: 'MC', um_incert: false },
  { proiect_id: 1, cheie: '0001|DZ0101|TSB02', tip_rand: 'articol', obiect_cod: '0001', deviz_cod: 'DZ0101', nr: null, cod: 'TSB02', denumire: 'TEAVA DE TEST', um: 'M', um_incert: false },
  { proiect_id: 2, cheie: '0001|DZ0101|ALTPROIECT', tip_rand: 'articol', obiect_cod: '0001', deviz_cod: 'DZ0101', nr: null, cod: 'ALTPROIECT', denumire: 'ALT', um: 'M', um_incert: false },
]
const SL = [{ id: 11, proiect_id: 1, nr_situatie: 'SL 3', luna: 10, an: 2026, valoare_baza_lei: 175 }]
// situația: 001 exact (100), 002 cod inexistent în M (50, de verificat → articolul TSB02), 003 cod inexistent în BUC (25, de verificat → articol nou)
const SIT = () => devizF3({ articole: [
  { nr: '001', cod: 'TSA01A1', um: 'M.C.', cant: 10, total: 100 },
  { nr: '002', cod: 'XYZ99', um: 'M', cant: 5, total: 50 },
  { nr: '003', cod: 'NOU77', um: 'BUC.', cant: 1, denumire: 'LUCRARE SUPLIMENTARA DE TEST', total: 25 },
] })
const SIT1 = () => devizF3({ articole: [{ nr: '001', cod: 'TSA01A1', um: 'M.C.', cant: 17.5, total: 175 }] })
const sha = async f => createHash('sha256').update(Buffer.from(await f.arrayBuffer())).digest('hex')
const OK_SIT = (fn, a) => (fn === 'fn_rest_decontat_confirma_situatie'
  ? { data: { detaliu_id: 9, versiune: a.p_inlocuieste ? 2 : 1, inserate: a.p_linii.linii.length, total_citit: 175, total_referinta: 175, inlocuit_id: null }, error: null, status: 200 }
  : { data: { inserate: 1, ids: [1], sursa: a.p_sursa, inlocuite: 0, decontat_fara_baza: [] }, error: null, status: 200 })
const DA = { data: true, error: null }, NU = { data: false, error: null }
/** RPC-ul fals: fn_rest_decontat_drept → `drept` (răspuns sau funcție); restul → `confirma` */
const rpcCu = (confirma, drept = DA) => (fn, a, st) => (fn === 'fn_rest_decontat_drept' ? (typeof drept === 'function' ? drept(a) : drept) : confirma(fn, a, st))
const RETEA = { data: null, error: { message: 'TypeError: Failed to fetch' }, status: 0 }
const REFUZ_403 = { data: null, error: { code: '42501', message: 'rest_decontat: proiectul nu exista sau nu ai drept sa confirmi situatii' }, status: 403 }

async function deschide({ tabele = {}, rpc = rpcCu(OK_SIT), tip = 'situatie', props = {} } = {}) {
  const { client, st } = clientFals({ tabele: { v_executie_rest_decontat_baza: BAZA, executie_situatii_plata: SL, executie_sl_detaliu: [], ...tabele }, rpc })
  const onGata = vi.fn()
  const u = await monteaza(<IncarcareDocument proiectId={1} tip={tip} client={client} onGata={onGata} {...props} />)
  await u.pana(() => u.camp('fișierul documentului'))
  return { u, st, onGata, client }
}
const confirmBtn = u => { const b = u.d.querySelector('[data-confirm]'); if (!b) throw new Error('nu găsesc butonul Confirm'); return b }
const confirmari = st => st.rpc.filter(r => r.fn !== 'fn_rest_decontat_drept')
/** situația cu o linie exactă, legată de SL 3, gata de confirmat */
async function pregatesteSit(u, f) {
  await u.alegeFisier(u.camp('fișierul documentului'), f)
  await u.pana(() => u.d.querySelectorAll('[data-linie]').length === 1)
  await u.scrie(u.camp('situația de plată'), '11')
}
const campuriBlocate = u => ['fișierul documentului', 'numărul situației', 'situația de plată', 'luna', 'anul'].map(c => u.camp(c).disabled)

domObligatoriu('IncarcareDocument (jsdom + react-dom)', () => {
  it('plan Step 1: rând de verificat = „Confirm” dezactivat; alegerile îl activează; RPC-ul primește cheie NULL la articolul nou, p_inlocuieste=false și p_fisier=NULL; nimic scris înainte; Storage neatins', async () => {
    const { u, st, onGata } = await deschide()
    // contextul se citește DOAR pe proiectul 1 (baza pe chei, până la pagina goală)
    expect(st.cereri.filter(c => c.tabel === 'v_executie_rest_decontat_baza').every(c => c.eq.some(([k, v]) => k === 'proiect_id' && v === 1))).toBe(true)
    // ecranul spune clar că documentul nu se păstrează în ERP
    expect(u.d.querySelector('[data-fara-fisier]').textContent).toBe(MESAJ_FARA_FISIER)
    const f = await fisierF3('SL3.docx', SIT())
    await u.alegeFisier(u.camp('fișierul documentului'), f)
    await u.pana(() => u.d.querySelectorAll('[data-linie]').length === 3)
    expect(u.text()).toContain('Citire completă')
    expect([...u.d.querySelectorAll('[data-linie]')].map(r => r.getAttribute('data-nivel'))).toEqual(['exact', 'de_verificat', 'de_verificat'])
    expect(confirmBtn(u).disabled).toBe(true)
    await u.scrie(u.camp('situația de plată'), '11')
    expect(u.camp('numărul situației').value).toBe('SL 3')
    expect(confirmBtn(u).disabled).toBe(true)
    expect(u.text()).toContain('2 linii nerezolvate')
    // opțiunile liniei 2 (UM „M”): doar TSB02 din proiect (nu articolul în MC, nici cel al altui proiect)
    const opt = [...u.camp('alege articolul liniei 2').querySelectorAll('option')].map(o => o.value)
    expect(opt).toEqual(['', '__nou', '0001|DZ0101|TSB02'])
    await u.scrie(u.camp('alege articolul liniei 2'), '0001|DZ0101|TSB02')
    expect(confirmBtn(u).disabled).toBe(true)
    await u.scrie(u.camp('alege articolul liniei 3'), '__nou')
    expect(confirmBtn(u).disabled).toBe(false)
    expect(st.rpc).toEqual([])                                            // nicio scriere înainte de „Confirm”
    await u.apasa(confirmBtn(u))
    await u.pana(() => u.d.querySelector('[data-rezultat="ok"]'))
    const amprenta = await sha(f)
    expect(st.storage).toEqual([])                                        // fișierul NU se urcă (r2)
    expect(st.rpc.length).toBe(1)
    const a = st.rpc[0].args
    expect(st.rpc[0].fn).toBe('fn_rest_decontat_confirma_situatie')
    expect(a).toMatchObject({ p_proiect: 1, p_nr_situatie: 'SL 3', p_sl_id: 11, p_amprenta: amprenta, p_inlocuieste: false, p_prag_diferenta: 1 })
    expect(a.p_fisier).toBe(null)
    expect(a.p_linii).toMatchObject({ accept_diferenta: false, luna: 10, an: 2026 })
    expect(a.p_linii.linii.map(l => [l.cod, l.tip_rand, l.cheie, l.potrivire, l.cantitate_perioada, l.valoare])).toEqual([
      ['TSA01A1', 'articol', '0001|DZ0101|TSA01A1', 'exact', 10, 100],
      ['XYZ99', 'articol', '0001|DZ0101|TSB02', 'manual', 5, 50],
      ['NOU77', 'articol_nou', null, null, 1, 25],
    ])
    expect(onGata).toHaveBeenCalledTimes(1)
    expect(u.text()).toContain('3 linii, total 175,00 lei')
  })

  it('numărul existent cere „înlocuiește” (fără bifă = dezactivat); cu bifa RPC-ul primește p_inlocuieste=true', async () => {
    const { u, st } = await deschide({ tabele: { executie_sl_detaliu: [{ id: 5, proiect_id: 1, nr_situatie: 'SL 3', versiune: 1, amprenta: '0'.repeat(64), activ: true }] } })
    await u.alegeFisier(u.camp('fișierul documentului'), await fisierF3('SL3b.docx', SIT1()))
    await u.pana(() => u.d.querySelectorAll('[data-linie]').length === 1)
    await u.scrie(u.camp('numărul situației'), 'sl  3')
    expect(confirmBtn(u).disabled).toBe(true)
    expect(u.text()).toContain('există deja (versiunea 1)')
    await u.bifa(u.camp('înlocuiește situația'))
    expect(confirmBtn(u).disabled).toBe(false)
    await u.apasa(confirmBtn(u))
    await u.pana(() => st.rpc.length === 1)
    expect(st.rpc[0].args).toMatchObject({ p_nr_situatie: 'SL 3', p_inlocuieste: true, p_sl_id: null, p_fisier: null })
  })

  it('diferența față de situația de plată peste 1 leu cere „accept diferența” → accept_diferenta=true în p_linii', async () => {
    const { u, st } = await deschide({ tabele: { executie_situatii_plata: [{ ...SL[0], valoare_baza_lei: 300 }] } })
    await u.alegeFisier(u.camp('fișierul documentului'), await fisierF3('SL3.docx', devizF3({ articole: [{ nr: '001', cod: 'TSA01A1', um: 'M.C.', cant: 10, total: 100 }] })))
    await u.pana(() => u.d.querySelectorAll('[data-linie]').length === 1)
    await u.scrie(u.camp('situația de plată'), '11')
    expect(confirmBtn(u).disabled).toBe(true)
    expect(u.d.querySelector('[data-totaluri]').textContent).toContain('-200,00 lei')
    await u.bifa(u.camp('accept diferența'))
    await u.apasa(confirmBtn(u))
    await u.pana(() => st.rpc.length === 1)
    expect(st.rpc[0].args.p_linii.accept_diferenta).toBe(true)
  })

  it('rețea picată (nescris) = NECUNOSCUT; „Verifică starea” citește după amprentă cu drept de citire → nimic scris; retrimiterea e IDENTICĂ și reușește', async () => {
    let n = 0
    const { u, st, onGata } = await deschide({ rpc: rpcCu((fn, a) => (++n === 1 ? RETEA : OK_SIT(fn, a))), props: { onInchide: () => {} } })
    await pregatesteSit(u, await fisierF3('SL3.docx', SIT1()))
    await u.apasa(confirmBtn(u))
    await u.pana(() => u.d.querySelector('[data-rezultat="necunoscut"]'))
    expect(u.text()).toContain('Rezultat necunoscut')
    expect(onGata).not.toHaveBeenCalled()
    // cât rezultatul e necunoscut, nimic nu se mai poate schimba și panoul nu se închide: doar retrimiterea identică / verificarea
    expect(campuriBlocate(u)).toEqual([true, true, true, true, true])
    expect(u.camp('închide încărcarea').disabled).toBe(true)
    expect(confirmBtn(u).disabled).toBe(false)
    await u.apasa(u.buton('Verifică starea'))
    const c = st.cereri.filter(x => x.tabel === 'executie_sl_detaliu').at(-1)
    expect(c.eq).toEqual([['proiect_id', 1], ['amprenta', st.rpc[0].args.p_amprenta]])
    expect(st.rpc.filter(r => r.fn === 'fn_rest_decontat_drept').map(r => r.args)).toEqual([{ p_proiect: 1, p_nivel: 'citire' }, { p_proiect: 1, p_nivel: 'citire' }])
    expect(u.text()).toContain('Verificat în ERP: nimic scris cu acest fișier')
    expect(u.d.querySelector('[data-rezultat="necunoscut"]')).not.toBe(null)   // „nimic scris” nu deblochează: se retrimite identic
    await u.apasa(confirmBtn(u))
    await u.pana(() => u.d.querySelector('[data-rezultat="ok"]'))
    expect(confirmari(st).length).toBe(2)
    expect(confirmari(st)[1].args).toEqual(confirmari(st)[0].args)        // retrimitere IDENTICĂ (aceeași amprentă = aceeași intenție)
    expect(onGata).toHaveBeenCalledTimes(1)
    expect(u.camp('închide încărcarea').disabled).toBe(false)
  })

  it('verdict #1178 P1-2, succesiunea EXACTĂ: prima confirmare se SCRIE, răspunsul se pierde → necunoscut; reîncercarea primește 403 → NU „nimic scris”: BD-ul (după amprentă) arată situația → ok', async () => {
    const sld = []
    let n = 0
    const confirma = (fn, a) => {
      if (++n === 1) { sld.push({ id: 50, proiect_id: 1, nr_situatie: a.p_nr_situatie, versiune: 1, activ: true, amprenta: a.p_amprenta }); return RETEA }
      return REFUZ_403                                                     // dreptul retras între timp: refuzul vine înaintea amprentei
    }
    // dreptul de citire răspunde „nu” (retras) — rândul GĂSIT e totuși dovadă
    const { u, st, onGata } = await deschide({ rpc: rpcCu(confirma, NU), tabele: { executie_sl_detaliu: sld } })
    await pregatesteSit(u, await fisierF3('SL3.docx', SIT1()))
    await u.apasa(confirmBtn(u))
    await u.pana(() => u.d.querySelector('[data-rezultat="necunoscut"]'))
    await u.apasa(confirmBtn(u))
    await u.pana(() => u.d.querySelector('[data-rezultat="ok"]'))
    expect(u.text()).toContain('Încercarea anterioară a fost scrisă')
    expect(u.text()).toContain('Situația SL 3 (versiunea 1)')
    expect(u.text()).not.toMatch(/[Nn]imic nu s-a scris/)
    expect(u.text()).not.toContain('Refuzat de server')
    expect(confirmari(st).length).toBe(2)
    expect(confirmari(st)[1].args).toEqual(confirmari(st)[0].args)
    expect(onGata).toHaveBeenCalledTimes(1)
  })

  it('L05: după necunoscut, refuz 403 (forma fără SQLSTATE, ca refuzul Storage din verdict) + nimic găsit + FĂRĂ drept de citire → rămâne NECUNOSCUT, câmpurile blocate, fără „nimic scris”', async () => {
    let n = 0
    const REFUZ_FARA_COD = { data: null, error: { message: 'new row violates row-level security policy' }, status: 403 }
    const { u, st, onGata } = await deschide({ rpc: rpcCu(() => (++n === 1 ? RETEA : REFUZ_FARA_COD), NU), props: { onInchide: () => {} } })
    await pregatesteSit(u, await fisierF3('SL3.docx', SIT1()))
    await u.apasa(confirmBtn(u))
    await u.pana(() => u.d.querySelector('[data-rezultat="necunoscut"]'))
    await u.apasa(confirmBtn(u))
    await u.pana(() => confirmari(st).length === 2 && !u.d.querySelector('[data-rezultat="reconciliere"]'))
    expect(u.d.querySelector('[data-rezultat="necunoscut"]')).not.toBe(null)
    expect(u.d.querySelector('[data-rezultat="refuz"]')).toBe(null)
    expect(u.text()).toContain('reîncercarea a fost refuzată (new row violates row-level security policy)')
    expect(u.text()).toContain('drept de citire')
    expect(u.text()).not.toMatch(/[Nn]imic nu s-a scris/)
    expect(campuriBlocate(u)).toEqual([true, true, true, true, true])
    expect(u.camp('închide încărcarea').disabled).toBe(true)
    expect(confirmBtn(u).disabled).toBe(false)                            // retrimiterea identică rămâne posibilă
    expect(onGata).not.toHaveBeenCalled()
    // „Verifică starea” spune același lucru (nu se poate dovedi absența)
    await u.apasa(u.buton('Verifică starea'))
    expect(u.text()).toContain('Verificarea n-a reușit')
    expect(campuriBlocate(u)).toEqual([true, true, true, true, true])
  })

  it('L05: după necunoscut, refuz 403 + BD citit (drept de citire înainte și după) fără nimic → refuzul devine FINAL, abia atunci câmpurile se deblochează; în timpul verificării totul e blocat', async () => {
    let n = 0
    const bariera = amana()
    let nDrept = 0
    const drept = () => (++nDrept === 1 ? bariera.p.then(() => DA) : DA)
    const { u, st, onGata } = await deschide({ rpc: rpcCu(() => (++n === 1 ? RETEA : REFUZ_403), drept), props: { onInchide: () => {} } })
    await pregatesteSit(u, await fisierF3('SL3.docx', SIT1()))
    await u.apasa(confirmBtn(u))
    await u.pana(() => u.d.querySelector('[data-rezultat="necunoscut"]'))
    await u.apasa(confirmBtn(u))
    // verificarea în zbor: nimic deblocat, „Confirm” dezactivat, panoul nu se închide
    await u.pana(() => u.d.querySelector('[data-rezultat="reconciliere"]'))
    expect(campuriBlocate(u)).toEqual([true, true, true, true, true])
    expect(confirmBtn(u).disabled).toBe(true)
    expect(u.camp('închide încărcarea').disabled).toBe(true)
    expect(u.text()).not.toMatch(/[Nn]imic nu s-a scris/)
    bariera.res()
    await u.pana(() => u.d.querySelector('[data-rezultat="refuz"]'))
    expect(u.text()).toContain('Refuzat de server: rest_decontat: proiectul nu exista sau nu ai drept')
    expect(u.d.querySelector('[data-reconciliat]').textContent).toContain('Verificat în ERP: încercarea anterioară NU s-a scris')
    expect(st.cereri.filter(c => c.tabel === 'executie_sl_detaliu').at(-1).eq).toEqual([['proiect_id', 1], ['amprenta', confirmari(st)[0].args.p_amprenta]])
    expect(campuriBlocate(u)).toEqual([false, false, false, false, false])
    expect(u.camp('închide încărcarea').disabled).toBe(false)
    expect(onGata).not.toHaveBeenCalled()
  })

  it('L05: după necunoscut, „deja confirmat” NU mai e dovadă de unul singur: dacă BD-ul are fișierul doar ca versiune înlocuită → refuz explicat (nu „ok”)', async () => {
    let n = 0
    const sld = []
    const DEJA = { data: null, error: { code: '23505', message: 'rest_decontat: acelasi fisier a fost deja confirmat pe acest proiect (amprenta_existenta)' }, status: 409 }
    const { u, onGata } = await deschide({ rpc: rpcCu((fn, a) => { if (++n === 1) { sld.push({ id: 7, proiect_id: 1, nr_situatie: 'SL 2', versiune: 1, activ: false, amprenta: a.p_amprenta }); return RETEA } return DEJA }), tabele: { executie_sl_detaliu: sld } })
    await pregatesteSit(u, await fisierF3('SL3.docx', SIT1()))
    await u.apasa(confirmBtn(u))
    await u.pana(() => u.d.querySelector('[data-rezultat="necunoscut"]'))
    await u.apasa(confirmBtn(u))
    await u.pana(() => u.d.querySelector('[data-rezultat="refuz"]'))
    expect(u.d.querySelector('[data-reconciliat]').textContent).toContain('doar ca versiune înlocuită (situația SL 2, versiunea 1, inactivă)')
    expect(u.d.querySelector('[data-rezultat="ok"]')).toBe(null)
    expect(onGata).not.toHaveBeenCalled()
  })

  it('refuzul BD-ului la PRIMA încercare se arată în clar, cu indiciul (fără reconciliere: nicio încercare anterioară)', async () => {
    const DEJA = { data: null, error: { code: '23505', message: 'rest_decontat: acelasi fisier a fost deja confirmat pe acest proiect (amprenta_existenta)' }, status: 409 }
    const { u, st, onGata } = await deschide({ rpc: rpcCu(() => DEJA) })
    await u.alegeFisier(u.camp('fișierul documentului'), await fisierF3('SL3.docx', SIT1()))
    await u.pana(() => u.d.querySelectorAll('[data-linie]').length === 1)
    await u.scrie(u.camp('numărul situației'), 'SL 3')
    await u.apasa(confirmBtn(u))
    await u.pana(() => u.d.querySelector('[data-rezultat="refuz"]'))
    expect(u.text()).toContain('Refuzat de server: rest_decontat: acelasi fisier a fost deja confirmat')
    expect(u.text()).toContain('Același fișier a fost deja confirmat')
    expect(st.rpc.filter(r => r.fn === 'fn_rest_decontat_drept')).toEqual([])
    expect(onGata).not.toHaveBeenCalled()
  })

  it('L24: panoul demontat cât confirmarea e în zbor → răspunsul sosit după nu mai cheamă onGata', async () => {
    const bariera = amana()
    const { u, st, onGata } = await deschide({ rpc: rpcCu((fn, a) => bariera.p.then(() => OK_SIT(fn, a))) })
    await pregatesteSit(u, await fisierF3('SL3.docx', SIT1()))
    await u.apasa(confirmBtn(u))
    await u.pana(() => confirmari(st).length === 1)
    await u.demonteaza()
    bariera.res()
    for (let i = 0; i < 20; i++) await Promise.resolve()
    await new Promise(r => setTimeout(r, 0))
    expect(onGata).not.toHaveBeenCalled()
  })

  it('fișier în alt format (Excel) = refuz clar, nimic trimis; antet fără lună / an = câmpuri de completat', async () => {
    const { u, st } = await deschide()
    await u.alegeFisier(u.camp('fișierul documentului'), { name: 'borderou.xlsx', arrayBuffer: async () => new ArrayBuffer(8) })
    await u.pana(() => u.text().includes('format nerecunoscut'))
    expect(u.text()).toContain('registru Excel')
    await u.alegeFisier(u.camp('fișierul documentului'), await fisierF3('fara_luna.docx', devizF3({ situatie: false, articole: [{ nr: '001', cod: 'TSA01A1', um: 'M.C.', cant: 17.5, total: 175 }] })))
    await u.pana(() => u.d.querySelectorAll('[data-linie]').length === 1)
    await u.scrie(u.camp('numărul situației'), 'SL 3')
    expect(u.camp('luna').value).toBe('')
    expect(confirmBtn(u).disabled).toBe(true)
    expect(u.text()).toContain('luna / anul situației lipsesc')
    await u.scrie(u.camp('luna'), '10'); await u.scrie(u.camp('anul'), '2026')
    expect(confirmBtn(u).disabled).toBe(false)
    expect(st.rpc).toEqual([])
  })

  it('situațiile de plată, actele și notele se citesc TOATE pe pagini (keyset pe id), chiar cu plafonul serverului sub pas (L23)', async () => {
    const multeSl = Array.from({ length: 1234 }, (_, i) => ({ id: i + 1, proiect_id: 1, nr_situatie: `SL ${i + 1}`, luna: 1, an: 2026, valoare_baza_lei: 1 }))
    const { client, st } = clientFals({ tabele: { v_executie_rest_decontat_baza: BAZA, executie_situatii_plata: multeSl, executie_sl_detaliu: [] }, plafon: 500 })
    const u = await monteaza(<IncarcareDocument proiectId={1} tip="situatie" client={client} />)
    await u.pana(() => u.camp('fișierul documentului'))
    await u.alegeFisier(u.camp('fișierul documentului'), await fisierF3('SL3.docx', SIT1()))
    await u.pana(() => u.camp('situația de plată'))
    expect(u.camp('situația de plată').querySelectorAll('option').length).toBe(1234 + 1)
    const c = st.cereri.filter(x => x.tabel === 'executie_situatii_plata')
    expect(c.length).toBe(Math.ceil(1234 / 500) + 1)
    expect(c.every(x => x.ord[0] === 'id' && x.lim === 1000)).toBe(true)
    curataTot()
    const acte = Array.from({ length: 1100 }, (_, i) => ({ id: i + 1, proiect_id: 1, numar_act: String(i + 1), data_semnare: null, activ: true }))
    const note = Array.from({ length: 1050 }, (_, i) => ({ id: i + 1, proiect_id: 1, tip: 'NR', numar: String(i + 1), data_aprobare: '2026-01-01', activ: true }))
    const b = clientFals({ tabele: { executie_acte_aditionale: acte, executie_note_modificare: note }, plafon: 400 })
    const v = await monteaza(<IncarcareDocument proiectId={1} tip="baza" client={b.client} />)
    await v.pana(() => v.camp('fișierul documentului'))
    await v.alegeFisier(v.camp('fișierul documentului'), await fisierF3('AA.docx', SIT1()))
    await v.pana(() => v.camp('sursa documentului'))
    await v.scrie(v.camp('sursa documentului'), 'act_aditional')
    expect(v.camp('actul adițional').querySelectorAll('option').length).toBe(1100 + 1)
    await v.scrie(v.camp('sursa documentului'), 'nota_renuntare')
    expect(v.camp('nota').querySelectorAll('option').length).toBe(1050 + 1)
  })

  it('devizul unui act adițional: actul + modul; RPC-ul de bază cu „doar diferențe”, p_fisier NULL, cantitățile negative păstrate', async () => {
    const { u, st } = await deschide({ tip: 'baza', tabele: { executie_acte_aditionale: [{ id: 4, proiect_id: 1, numar_act: '2', data_semnare: '2026-09-01', activ: true }], executie_note_modificare: [] } })
    await u.alegeFisier(u.camp('fișierul documentului'), await fisierF3('AA2.docx', devizF3({ articole: [
      { nr: '001', cod: 'TSA01A1', um: 'M.C.', cant: -2, total: -20 }, { nr: '002', cod: 'TSB09', um: 'M', cant: 3, total: 30 }] })))
    await u.pana(() => u.d.querySelectorAll('[data-linie]').length === 2)
    expect(u.text()).toContain('1 cu cantitate negativă')
    await u.scrie(u.camp('sursa documentului'), 'act_aditional')
    expect(confirmBtn(u).disabled).toBe(true)
    await u.scrie(u.camp('actul adițional'), '4')
    expect(confirmBtn(u).disabled).toBe(false)
    expect(st.rpc).toEqual([])
    await u.apasa(confirmBtn(u))
    await u.pana(() => st.rpc.length === 1)
    expect(st.rpc[0].fn).toBe('fn_rest_decontat_confirma_baza')
    expect(st.rpc[0].args).toMatchObject({ p_proiect: 1, p_sursa: 'act_aditional', p_act_aditional_id: 4, p_nota_id: null, p_mod: 'diferente', p_inlocuieste: false })
    expect(st.rpc[0].args.p_fisier).toBe(null)
    expect(st.storage).toEqual([])
    expect(st.rpc[0].args.p_linii.map(l => [l.cod, l.cantitate, l.valoare])).toEqual([['TSA01A1', -2, -20], ['TSB09', 3, 30]])
  })

  it('devizul AA: rețea picată, apoi „actul are deja un deviz confirmat” → starea se recitește după amprentă; găsit = scris; negăsit (cu drept de citire) = refuz final, câmpurile deblocate', async () => {
    const f = await fisierF3('AA2.docx', devizF3({ articole: [{ nr: '001', cod: 'TSA01A1', um: 'M.C.', cant: 2, total: 20 }] }))
    const amprenta = await sha(f)
    const DEJA = { data: null, error: { code: '23505', message: 'rest_decontat: actul aditional are deja un deviz confirmat (inlocuirea e o decizie separata)' }, status: 409 }
    for (const [scris, asteptat] of [[true, 'ok'], [false, 'refuz']]) {
      let n = 0
      const { u, st, onGata } = await deschide({ tip: 'baza', rpc: rpcCu(() => (++n === 1 ? { data: null, error: { message: 'gateway timeout' }, status: 504 } : DEJA)),
        tabele: { executie_acte_aditionale: [{ id: 4, proiect_id: 1, numar_act: '2', data_semnare: '2026-09-01', activ: true }], executie_note_modificare: [],
          proiect_articole: scris ? [{ id: 77, proiect_id: 1, fisier_amprenta: amprenta }] : [] } })
      await u.alegeFisier(u.camp('fișierul documentului'), f)
      await u.pana(() => u.camp('sursa documentului'))
      await u.scrie(u.camp('sursa documentului'), 'act_aditional')
      await u.scrie(u.camp('actul adițional'), '4')
      await u.apasa(confirmBtn(u))
      await u.pana(() => u.d.querySelector('[data-rezultat="necunoscut"]'))
      expect(u.camp('actul adițional').disabled).toBe(true)
      await u.apasa(confirmBtn(u))
      await u.pana(() => u.d.querySelector(`[data-rezultat="${asteptat}"]`))
      expect(confirmari(st).length).toBe(2)
      expect(confirmari(st)[1].args).toEqual(confirmari(st)[0].args)
      expect(st.cereri.find(x => x.tabel === 'proiect_articole').eq).toEqual([['proiect_id', 1], ['fisier_amprenta', amprenta]])
      if (scris) { expect(u.text()).toContain('Încercarea anterioară a fost scrisă'); expect(onGata).toHaveBeenCalledTimes(1) }
      else {
        expect(u.text()).toContain('Refuzat de server: rest_decontat: actul aditional are deja un deviz confirmat')
        expect(st.cereri.filter(x => x.tabel === 'proiect_articole_istoric').at(-1).eq).toEqual([['proiect_id', 1], ['rand->>fisier_amprenta', amprenta]])
        expect(u.d.querySelector('[data-reconciliat]')).not.toBe(null)
        expect(u.camp('actul adițional').disabled).toBe(false)
        expect(onGata).not.toHaveBeenCalled()
      }
      curataTot()
    }
  })

  it('oferta cu „listă completă” refuză cantitățile negative înainte de trimitere; sursele se limitează la cele permise', async () => {
    const { u, st } = await deschide({ tip: 'baza', tabele: { executie_acte_aditionale: [], executie_note_modificare: [] }, props: { surse: ['act_aditional', 'nota_renuntare'] } })
    expect(u.camp('sursa documentului')).toBe(null)                      // apare după citirea fișierului
    await u.alegeFisier(u.camp('fișierul documentului'), await fisierF3('AA.docx', devizF3({ articole: [{ nr: '001', cod: 'TSA01A1', um: 'M.C.', cant: -2, total: -20 }] })))
    await u.pana(() => u.camp('sursa documentului'))
    expect([...u.camp('sursa documentului').querySelectorAll('option')].map(o => o.value)).toEqual(['act_aditional', 'nota_renuntare'])
    curataTot()
    const r = await deschide({ tip: 'baza', tabele: { executie_acte_aditionale: [], executie_note_modificare: [] } })
    await r.u.alegeFisier(r.u.camp('fișierul documentului'), await fisierF3('OF.docx', devizF3({ articole: [{ nr: '001', cod: 'TSA01A1', um: 'M.C.', cant: -2, total: -20 }] })))
    await r.u.pana(() => r.u.camp('sursa documentului'))
    expect(r.u.camp('sursa documentului').value).toBe('contract_initial')
    expect(confirmBtn(r.u).disabled).toBe(true)
    expect(r.u.text()).toContain('o listă completă nu are cantități negative')
    expect(st.rpc).toEqual([]); expect(r.st.rpc).toEqual([])
  })
})
