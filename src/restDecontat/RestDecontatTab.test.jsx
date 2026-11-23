// Teste de componentă pentru tab-ul „💰 Rest de decontat” (Task 5, plan Step 1): componenta REALĂ în jsdom, cu date FALSE (vederile 20270105a
// în memorie). Probează: totalul pe proiect = suma obiectelor; filtrul „peste ofertă” lasă doar rândurile cu rest negativ; fără drept de
// citire tab-ul nu arată nimic și nu citește nimic; eroarea ≠ gol (L18); citirea pe pagini peste plafonul de 1000 (L23); butoanele de
// încărcare doar cu drept de confirmare; semnalul de risc; lipsurile; configurarea completă prin RPC. Fila din bandă: Executie.test.jsx.
import { afterEach, describe, it, expect, vi } from 'vitest'
vi.mock('../lib/supabase.js', () => ({ supabase: null }))
import RestDecontatTab from './RestDecontatTab.jsx'
import { JSDOM, MOTIV_SARIT, clientFals, monteaza, curataTot, A, ARTICOLE, OBIECTE } from './restDecontat.testutil.jsx'

if (!JSDOM) console.warn(`[RestDecontatTab.test] ${MOTIV_SARIT}`)
const dom = JSDOM ? describe : describe.skip
const numeDom = t => (JSDOM ? t : `${t} — ${MOTIV_SARIT}`)
afterEach(curataTot)

const DREPT_TOT = { stare: 'ok', citire: true, confirmare: true, documente_baza: true }
const LIPSURI = [{ proiect_id: 1, tip: 'sl_fara_detaliu', referinta: 'SL 2' }, { proiect_id: 1, tip: 'aa_fara_deviz', referinta: '3' }, { proiect_id: 2, tip: 'fara_oferta', referinta: 'proiect 2' }]
const SLP = [{ id: 1, proiect_id: 1, nr_situatie: 'SL 1', valoare_ajustare_lei: 12.5 }, { id: 2, proiect_id: 1, nr_situatie: 'SL 2', valoare_ajustare_lei: null }]
const PROIECTE = [{ id: 1, configurare_completa_la: null, configurare_exceptie_motiv: null }]
const lei = v => new Intl.NumberFormat('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)

async function deschide({ drept = DREPT_TOT, tabele = {}, erori = {}, rpc = null } = {}) {
  const { client, st } = clientFals({ tabele: { v_executie_rest_decontat: ARTICOLE, v_executie_rest_decontat_obiect: OBIECTE, v_executie_rest_decontat_lipsuri: LIPSURI,
    executie_situatii_plata: SLP, executie_proiecte: PROIECTE, ...tabele }, erori, rpc })
  const u = await monteaza(<RestDecontatTab proiectId={1} codProiect="T1" client={client} drept={drept} />)
  return { u, st }
}
const articoleAfisate = u => [...u.d.querySelectorAll('[data-articol]')].map(x => x.getAttribute('data-articol'))

dom(numeDom('RestDecontatTab (jsdom + react-dom)'), () => {
  it('totalurile de sus = rândul proiectului = suma obiectelor; ajustările separat; lipsurile proiectului', async () => {
    const { u, st } = await deschide()
    await u.pana(() => u.d.querySelector('[data-totaluri-proiect]'))
    const ob = OBIECTE.filter(o => o.nivel === 'obiect')
    const s = k => ob.reduce((x, o) => x + o[k], 0)
    expect(u.d.querySelector('[data-total="baza"]').textContent).toContain(`${lei(s('baza_valoare'))} lei`)
    expect(u.d.querySelector('[data-total="decontat"]').textContent).toContain(`${lei(s('decontat_valoare'))} lei`)
    expect(u.d.querySelector('[data-total="rest"]').textContent).toContain(`${lei(s('rest_valoare'))} lei`)
    expect(u.d.querySelector('[data-total="pct"]').textContent).toContain('41,6%')
    expect(u.d.querySelector('[data-total="ajustari"]').textContent).toContain('12,50 lei')
    expect(u.d.querySelector('[data-incoerent]')).toBe(null)
    // lipsurile: doar ale proiectului 1 (filtrate în cerere), pe tip
    expect([...u.d.querySelectorAll('[data-lipsa]')].map(x => x.getAttribute('data-lipsa'))).toEqual(['sl_fara_detaliu', 'aa_fara_deviz'])
    // toate citirile tab-ului sunt pe proiectul 1
    for (const c of st.cereri.filter(x => x.tabel.startsWith('v_executie_rest_decontat'))) expect(c.eq).toContainEqual(['proiect_id', 1])
    // gruparea: obiect 0001 (C1, C2), obiect 0002 (C3, C4, articolul nou)
    expect([...u.d.querySelectorAll('[data-obiect]')].map(x => x.getAttribute('data-obiect'))).toEqual(['0001', '0002'])
    expect(articoleAfisate(u)).toEqual(['1:0001|D1|C1', '1:0001|D1|C2', '1:0002|D2|C3', '1:0002|D2|C4', '1:articol_nou:abc'])
  })

  it('un total de proiect diferit de suma obiectelor se semnalează (nu se ascunde)', async () => {
    const { u } = await deschide({ tabele: { v_executie_rest_decontat_obiect: OBIECTE.map(o => (o.nivel === 'proiect' ? { ...o, rest_valoare: 1 } : o)) } })
    await u.pana(() => u.d.querySelector('[data-incoerent]'))
  })

  it('filtrul „peste ofertă” lasă doar rândurile cu rest negativ; „nedecontat deloc”; obiectul', async () => {
    const { u } = await deschide()
    await u.pana(() => articoleAfisate(u).length === 5)
    await u.bifa(u.camp('peste ofertă'))
    expect(articoleAfisate(u)).toEqual(['1:0001|D1|C2', '1:articol_nou:abc'])
    const rest = articoleAfisate(u).map(id => ARTICOLE.find(a => a.rand_id === id).rest_valoare)
    expect(rest.every(v => v < 0)).toBe(true)
    await u.bifa(u.camp('peste ofertă'))
    await u.bifa(u.camp('nedecontat deloc'))
    expect(articoleAfisate(u)).toEqual(['1:0002|D2|C3'])
    await u.bifa(u.camp('nedecontat deloc'))
    await u.scrie(u.camp('obiectul'), '0001')
    expect(articoleAfisate(u)).toEqual(['1:0001|D1|C1', '1:0001|D1|C2'])
  })

  it('fără drept de citire: mesajul, nicio citire a datelor; dreptul încă necitit / eroarea lui se arată', async () => {
    const r = await deschide({ drept: { stare: 'ok', citire: false, confirmare: false, documente_baza: true } })
    expect(r.u.d.querySelector('[data-fara-drept]')).not.toBe(null)
    expect(r.st.cereri).toEqual([])
    expect(r.u.d.querySelector('[data-totaluri-proiect]')).toBe(null)
    curataTot()
    const e = await deschide({ drept: { stare: 'eroare', eroare: 'function fn_rest_decontat_drept does not exist' } })
    expect(e.u.text()).toContain('Nu s-a putut verifica dreptul')
    expect(e.st.cereri).toEqual([])
  })

  it('eroarea de citire se arată (nu „niciun articol”); „Reîncearcă” cere din nou (L18)', async () => {
    const { u, st } = await deschide({ erori: { v_executie_rest_decontat: { message: 'permission denied for view v_executie_rest_decontat' } } })
    await u.pana(() => u.text().includes('Nu s-a putut citi restul de decontat'))
    expect(u.d.querySelector('[data-gol]')).toBe(null)
    const n = st.cereri.length
    await u.apasa(u.buton('Reîncearcă'))
    expect(st.cereri.length).toBeGreaterThan(n)
  })

  it('peste plafonul de 1000 de rânduri: toate articolele se citesc (keyset pe rand_id până la pagina goală, L23)', async () => {
    const multe = Array.from({ length: 1500 }, (_, i) => A(`0001|D1|K${String(i).padStart(4, '0')}`))
    const { u, st } = await deschide({ tabele: { v_executie_rest_decontat: multe } })
    await u.pana(() => u.text().includes('1500 din 1500 articole'))
    const pag = st.cereri.filter(c => c.tabel === 'v_executie_rest_decontat')
    expect(pag.length).toBe(3)                                    // 1000 + 500 + pagina goală
    expect(pag.every(c => c.lim === 1000 && c.ord[0] === 'rand_id')).toBe(true)
  })

  it('butoanele de încărcare doar cu drept de confirmare / documente de bază; fără ele, doar citire', async () => {
    const r = await deschide({ drept: { stare: 'ok', citire: true, confirmare: false, documente_baza: false } })
    await r.u.pana(() => r.u.d.querySelector('[data-totaluri-proiect]'))
    expect(r.u.butoane().some(b => b.textContent.includes('Încarcă situație'))).toBe(false)
    expect(r.u.butoane().some(b => b.textContent.includes('Încarcă deviz'))).toBe(false)
    expect(r.u.butoane().some(b => b.textContent.includes('Configurare completă'))).toBe(false)
    curataTot()
    const c = await deschide({ drept: { stare: 'ok', citire: true, confirmare: false, documente_baza: true } })
    await c.u.pana(() => c.u.d.querySelector('[data-totaluri-proiect]'))
    expect(c.u.butoane().some(b => b.textContent.includes('Încarcă situație'))).toBe(false)
    await c.u.apasa(c.u.buton('Încarcă deviz'))
    await c.u.pana(() => c.u.camp('fișierul documentului'))
    expect(c.st.rpc).toEqual([])
  })

  it(`semnalul de risc apare doar când proiectul a trecut de 70% decontat`, async () => {
    const r = await deschide()
    await r.u.pana(() => r.u.d.querySelector('[data-totaluri-proiect]'))
    expect(r.u.d.querySelector('[data-risc]')).toBe(null)                   // 41,6%
    curataTot()
    const p = await deschide({ tabele: { v_executie_rest_decontat_obiect: OBIECTE.map(o => (o.nivel === 'proiect' ? { ...o, pct_decontat: 75 } : o)) } })
    await p.u.pana(() => p.u.d.querySelector('[data-risc]'))
    expect([...p.u.d.querySelectorAll('[data-risc-articol]')].map(x => x.getAttribute('data-risc-articol'))).toEqual(['1:0002|D2|C4', '1:0002|D2|C3'])
  })

  it('„Configurare completă”: RPC-ul din 20270105b pe proiect, apoi reîncărcare; eroarea lui se arată', async () => {
    let n = 0
    const rpc = fn => (fn === 'fn_executie_proiect_configurare_completa' ? (++n === 1 ? { data: null, error: { code: 'P0001', message: 'configurare: proiectul nu are oferta financiara incarcata (fara_oferta)' }, status: 400 } : { data: { ok: true }, error: null }) : { data: null, error: null })
    const { u, st } = await deschide({ rpc })
    await u.pana(() => u.butoane().some(b => b.textContent.includes('Configurare completă')))
    await u.apasa(u.buton('Configurare completă'))
    await u.pana(() => u.text().includes('fara_oferta'))
    expect(st.rpc.at(-1)).toEqual({ fn: 'fn_executie_proiect_configurare_completa', args: { p_proiect: 1, p_motiv: null } })
    const n0 = st.cereri.length
    await u.apasa(u.buton('Configurare completă'))
    await u.pana(() => st.cereri.length > n0)
  })
})
