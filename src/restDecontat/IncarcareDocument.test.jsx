// Teste de componentă pentru ecranul de încărcare (Task 4, plan Step 1): componenta REALĂ montată cu react-dom în jsdom, cu un fișier F3 .docx
// SINTETIC (parsat de parsareSituatie.js, real) și un client Supabase FALS. Probează: cu un rând de verificat „Confirm” e dezactivat; după
// alegerea articolului se activează; la confirmare RPC-ul primește p_linii cu cheie NULL pentru articolul nou și p_inlocuieste = false; nicio
// scriere (Storage / RPC) înainte de „Confirm”; nr. existent cere „înlocuiește”; diferența față de situația de plată cere acceptare; eroarea de
// rețea = necunoscut, retrimiterea identică + „deja confirmat” = dovada scrierii (L05); refuzul BD-ului se arată în clar; devizul de bază.
// Fără jsdom (nu e dependență a proiectului) suita e SĂRITĂ VIZIBIL.
import { afterEach, describe, it, expect, vi } from 'vitest'
import { createHash } from 'node:crypto'
vi.mock('../lib/supabase.js', () => ({ supabase: null }))
import IncarcareDocument from './IncarcareDocument.jsx'
import { JSDOM, MOTIV_SARIT, clientFals, monteaza, curataTot, devizF3, fisierF3 } from './restDecontat.testutil.jsx'

if (!JSDOM) console.warn(`[IncarcareDocument.test] ${MOTIV_SARIT}`)
const dom = JSDOM ? describe : describe.skip
const numeDom = t => (JSDOM ? t : `${t} — ${MOTIV_SARIT}`)
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
const sha = async f => createHash('sha256').update(Buffer.from(await f.arrayBuffer())).digest('hex')
const OK_SIT = (fn, a) => (fn === 'fn_rest_decontat_confirma_situatie'
  ? { data: { detaliu_id: 9, versiune: a.p_inlocuieste ? 2 : 1, inserate: a.p_linii.linii.length, total_citit: 175, total_referinta: 175, inlocuit_id: null }, error: null, status: 200 }
  : { data: { inserate: 1, ids: [1], sursa: a.p_sursa, inlocuite: 0, decontat_fara_baza: [] }, error: null, status: 200 })

async function deschide({ tabele = {}, rpc = OK_SIT, tip = 'situatie', props = {} } = {}) {
  const { client, st } = clientFals({ tabele: { v_executie_rest_decontat_baza: BAZA, executie_situatii_plata: SL, executie_sl_detaliu: [], ...tabele }, rpc })
  const onGata = vi.fn()
  const u = await monteaza(<IncarcareDocument proiectId={1} tip={tip} client={client} onGata={onGata} {...props} />)
  await u.pana(() => u.camp('fișierul documentului'))
  return { u, st, onGata, client }
}
const confirmBtn = u => u.buton('Confirm')

dom(numeDom('IncarcareDocument (jsdom + react-dom)'), () => {
  it('plan Step 1: rând de verificat = „Confirm” dezactivat; alegerile îl activează; RPC-ul primește cheie NULL la articolul nou și p_inlocuieste=false; nimic scris înainte', async () => {
    const { u, st, onGata } = await deschide()
    // contextul se citește DOAR pe proiectul 1 (baza pe chei, până la pagina goală)
    expect(st.cereri.filter(c => c.tabel === 'v_executie_rest_decontat_baza').every(c => c.eq.some(([k, v]) => k === 'proiect_id' && v === 1))).toBe(true)
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
    expect(st.upload).toEqual([]); expect(st.rpc).toEqual([])               // nicio scriere înainte de „Confirm”
    await u.apasa(confirmBtn(u))
    await u.pana(() => u.d.querySelector('[data-rezultat="ok"]'))
    const amprenta = await sha(f)
    expect(st.upload.map(x => [x.bucket, x.cale, x.opt.upsert])).toEqual([['executie-borderouri', `sl_1/rest_decontat/${amprenta}.docx`, false]])
    expect(st.rpc.length).toBe(1)
    const a = st.rpc[0].args
    expect(st.rpc[0].fn).toBe('fn_rest_decontat_confirma_situatie')
    expect(a).toMatchObject({ p_proiect: 1, p_nr_situatie: 'SL 3', p_sl_id: 11, p_amprenta: amprenta, p_fisier: `sl_1/rest_decontat/${amprenta}.docx`, p_inlocuieste: false, p_prag_diferenta: 1 })
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
    await u.alegeFisier(u.camp('fișierul documentului'), await fisierF3('SL3b.docx', devizF3({ articole: [{ nr: '001', cod: 'TSA01A1', um: 'M.C.', cant: 17.5, total: 175 }] })))
    await u.pana(() => u.d.querySelectorAll('[data-linie]').length === 1)
    await u.scrie(u.camp('numărul situației'), 'sl  3')
    expect(confirmBtn(u).disabled).toBe(true)
    expect(u.text()).toContain('există deja (versiunea 1)')
    await u.bifa(u.camp('înlocuiește situația'))
    expect(confirmBtn(u).disabled).toBe(false)
    await u.apasa(confirmBtn(u))
    await u.pana(() => st.rpc.length === 1)
    expect(st.rpc[0].args).toMatchObject({ p_nr_situatie: 'SL 3', p_inlocuieste: true, p_sl_id: null })
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

  it('rețea picată după trimitere = rezultat NECUNOSCUT (nu eșec); „Verifică starea” citește după amprentă; retrimiterea e identică, iar „deja confirmat” dovedește scrierea', async () => {
    let n = 0
    const rpc = (fn, a) => {
      n++
      if (n === 1) return { data: null, error: { message: 'TypeError: Failed to fetch' }, status: 0 }
      return { data: null, error: { code: '23505', message: 'rest_decontat: acelasi fisier a fost deja confirmat pe acest proiect (amprenta_existenta)' }, status: 409 }
    }
    const { u, st, onGata } = await deschide({ rpc })
    await u.alegeFisier(u.camp('fișierul documentului'), await fisierF3('SL3.docx', devizF3({ articole: [{ nr: '001', cod: 'TSA01A1', um: 'M.C.', cant: 17.5, total: 175 }] })))
    await u.pana(() => u.d.querySelectorAll('[data-linie]').length === 1)
    await u.scrie(u.camp('situația de plată'), '11')
    await u.apasa(confirmBtn(u))
    await u.pana(() => u.d.querySelector('[data-rezultat="necunoscut"]'))
    expect(u.text()).toContain('Rezultat necunoscut')
    expect(onGata).not.toHaveBeenCalled()
    await u.apasa(u.buton('Verifică starea'))
    const c = st.cereri.filter(x => x.tabel === 'executie_sl_detaliu').at(-1)
    expect(c.eq).toEqual([['proiect_id', 1], ['amprenta', st.rpc[0].args.p_amprenta]])
    expect(u.text()).toContain('Nimic scris cu acest fișier')
    await u.apasa(confirmBtn(u))
    await u.pana(() => u.d.querySelector('[data-rezultat="ok"]'))
    expect(st.rpc.length).toBe(2)
    expect(st.rpc[1].args).toEqual(st.rpc[0].args)                       // retrimitere IDENTICĂ (aceeași amprentă = aceeași intenție)
    expect(u.text()).toContain('Încercarea anterioară a fost scrisă')
    expect(onGata).toHaveBeenCalledTimes(1)
  })

  it('refuzul BD-ului se arată în clar, cu indiciul; fără „deja confirmat” fals la prima încercare', async () => {
    const rpc = () => ({ data: null, error: { code: '23505', message: 'rest_decontat: acelasi fisier a fost deja confirmat pe acest proiect (amprenta_existenta)' }, status: 409 })
    const { u, onGata } = await deschide({ rpc })
    await u.alegeFisier(u.camp('fișierul documentului'), await fisierF3('SL3.docx', devizF3({ articole: [{ nr: '001', cod: 'TSA01A1', um: 'M.C.', cant: 17.5, total: 175 }] })))
    await u.pana(() => u.d.querySelectorAll('[data-linie]').length === 1)
    await u.scrie(u.camp('numărul situației'), 'SL 3')
    await u.apasa(confirmBtn(u))
    await u.pana(() => u.d.querySelector('[data-rezultat="refuz"]'))
    expect(u.text()).toContain('Refuzat de server: rest_decontat: acelasi fisier a fost deja confirmat')
    expect(u.text()).toContain('Același fișier a fost deja confirmat')
    expect(onGata).not.toHaveBeenCalled()
  })

  it('Storage refuză (4xx): RPC-ul NU se cheamă; fișierul deja urcat (409, aceeași amprentă) nu e eroare', async () => {
    const r1 = await deschide()
    r1.client.storage.from = () => ({ upload: async () => ({ data: null, error: { message: 'new row violates row-level security policy', statusCode: '403' } }) })
    await r1.u.alegeFisier(r1.u.camp('fișierul documentului'), await fisierF3('SL3.docx', devizF3({ articole: [{ nr: '001', cod: 'TSA01A1', um: 'M.C.', cant: 17.5, total: 175 }] })))
    await r1.u.pana(() => r1.u.d.querySelectorAll('[data-linie]').length === 1)
    await r1.u.scrie(r1.u.camp('numărul situației'), 'SL 3')
    await r1.u.apasa(confirmBtn(r1.u))
    await r1.u.pana(() => r1.u.d.querySelector('[data-rezultat="refuz"]'))
    expect(r1.u.text()).toContain('Fișierul nu s-a putut urca')
    expect(r1.st.rpc).toEqual([])
    curataTot()
    const r2 = await deschide()
    r2.client.storage.from = () => ({ upload: async () => ({ data: null, error: { message: 'The resource already exists', statusCode: '409' } }) })
    await r2.u.alegeFisier(r2.u.camp('fișierul documentului'), await fisierF3('SL3.docx', devizF3({ articole: [{ nr: '001', cod: 'TSA01A1', um: 'M.C.', cant: 17.5, total: 175 }] })))
    await r2.u.pana(() => r2.u.d.querySelectorAll('[data-linie]').length === 1)
    await r2.u.scrie(r2.u.camp('numărul situației'), 'SL 3')
    await r2.u.apasa(confirmBtn(r2.u))
    await r2.u.pana(() => r2.u.d.querySelector('[data-rezultat="ok"]'))
    expect(r2.st.rpc.length).toBe(1)
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

  it('devizul unui act adițional: actul + modul; RPC-ul de bază cu „doar diferențe”, cantitățile negative păstrate', async () => {
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
    expect(st.rpc[0].args.p_linii.map(l => [l.cod, l.cantitate, l.valoare])).toEqual([['TSA01A1', -2, -20], ['TSB09', 3, 30]])
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
