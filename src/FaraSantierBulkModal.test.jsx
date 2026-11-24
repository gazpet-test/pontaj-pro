// Test de ecran pentru „Alocare manuală șantier — Bulk Edit” (FaraSantierBulkModal), componenta REALĂ în jsdom, cu tabelul FALS
// din alimentariAlocare.testutil.js. Corecturi după review #1184: lista cardurilor nu depinde de primele 500 de rânduri (L23),
// alegerea cardului încarcă rândurile lui de pe server, un răspuns întârziat nu se aplică după schimbarea filtrului (L24),
// eroarea ≠ „toate au șantier” (L18), salvarea e CAS. Fără jsdom suita PICĂ explicit (domObligatoriu).
import { afterEach, it, expect, vi } from 'vitest'
const ref = vi.hoisted(() => ({ client: null }))
vi.mock('./lib/supabase.js', () => ({ supabase: { from: (...a) => ref.client.from(...a) } }))
import FaraSantierBulkModal from './FaraSantierBulkModal.jsx'
import { clientFals } from './alimentariAlocare.testutil.js'
import { domObligatoriu, monteaza, curataTot } from './restDecontat/restDecontat.testutil.jsx'

afterEach(() => { curataTot(); ref.client = null; delete globalThis.confirm })

const SITES = [{ id: 17, name: 'Șantier Test A' }, { id: 18, name: 'Șantier Test B' }]
const act = (id, cod) => ({ id, cod_intern: cod, nr_inmatriculare: null, marca: 'Tehnic', model: 'X' })

// Scenariul din verdict: cele mai noi 500 de alimentări fără șantier pe GAZPET1, a 501-a (mai veche) pe GAZPET2.
function scenariu501() {
  const r = []
  for (let i = 1; i <= 500; i++) r.push({ id: 1000 + i, data_alimentare: '2026-11-20', card_combustibil: 'GAZPET1', site_id: null, cantitate_litri: 10, logistica_active: act(1, 'NEALOCAT') })
  r.push({ id: 7, data_alimentare: '2026-10-02', card_combustibil: 'GAZPET2', site_id: null, cantitate_litri: 42, logistica_active: act(2, 'EXC-07') })
  return r
}

async function deschide(randuri, opt = {}) {
  const f = clientFals(randuri, opt)
  ref.client = f.client
  const toast = vi.fn()
  const onSaved = vi.fn()
  const u = await monteaza(<FaraSantierBulkModal sites={SITES} profile={{ id: 'u-test' }} showToast={toast} onClose={() => {}} onSaved={onSaved} />)
  const selectCard = () => [...u.d.querySelectorAll('select')].find(s => [...s.options].some(o => o.textContent === 'Toate cardurile'))
  const randuriTabel = () => [...u.d.querySelectorAll('tbody tr')]
  return { u, f, toast, onSaved, selectCard, randuriTabel }
}

domObligatoriu('FaraSantierBulkModal (jsdom + react-dom)', () => {
  it('scenariul din verdict: GAZPET2 (a 501-a) e în lista de carduri; alegerea lui îl încarcă de pe server și se poate aloca', async () => {
    const { u, f, selectCard, randuriTabel } = await deschide(scenariu501())
    await u.pana(() => randuriTabel().length === 500)
    expect(u.text()).toContain('În total sunt 501 alimentări fără șantier')
    const optiuni = [...selectCard().options].map(o => o.textContent)
    expect(optiuni).toEqual(['Toate cardurile', '💳 GAZPET1 (500)', '💳 GAZPET2 (1)'])

    const n0 = f.cereri.length
    await u.scrie(selectCard(), 'GAZPET2')
    await u.pana(() => randuriTabel().length === 1)
    expect(randuriTabel()[0].textContent).toContain('EXC-07')
    // cererea rândurilor are filtrul pe card (server), nu doar filtrarea din client
    const cerereRanduri = f.cereri.slice(n0).find(c => c.cols?.includes('whatsapp_caption'))
    expect(cerereRanduri.urme).toEqual(['site_id=is.null', 'card_combustibil=in.("GAZPET2")'])
    expect(u.text()).not.toContain('În total sunt')   // cu card ales nu e trunchiere

    // alocare + salvare: UPDATE cu CAS pe site_id IS NULL
    globalThis.confirm = () => true
    await u.scrie(randuriTabel()[0].querySelector('select'), '17')
    await u.apasa(u.buton('Salvează 1 alocări'))
    const upd = f.cereri.filter(c => c.op === 'update')
    expect(upd).toHaveLength(1)
    expect(upd[0].urme).toEqual(['id=eq.7', 'site_id=is.null'])
    expect(f.tabel.find(r => r.id === 7)).toMatchObject({ site_id: 17, sursa_alocare_santier: 'manual', aloc_santier_de: 'u-test' })
  })

  it('L24: răspunsul întârziat al cardului ales ÎNAINTE nu se aplică după schimbarea filtrului', async () => {
    const R = [
      { id: 1, data_alimentare: '2026-11-01', card_combustibil: 'GAZPET1', site_id: null, logistica_active: act(1, 'G1-A') },
      { id: 2, data_alimentare: '2026-11-02', card_combustibil: 'GAZPET1', site_id: null, logistica_active: act(1, 'G1-B') },
      { id: 3, data_alimentare: '2026-11-03', card_combustibil: 'GAZPET2', site_id: null, logistica_active: act(2, 'G2-A') },
    ]
    let elibereaza = null
    const amana = st => (st.cols?.includes('whatsapp_caption') && st.urme.includes('card_combustibil=in.("GAZPET1")') && !elibereaza
      ? new Promise(r => { elibereaza = r }) : null)
    const { u, selectCard, randuriTabel } = await deschide(R, { amana })
    await u.pana(() => randuriTabel().length === 3)

    await u.scrie(selectCard(), 'GAZPET1')          // cererea GAZPET1 rămâne în zbor
    await u.pana(() => elibereaza !== null)
    await u.scrie(selectCard(), 'GAZPET2')          // a doua alegere răspunde imediat
    await u.pana(() => randuriTabel().length === 1 && randuriTabel()[0].textContent.includes('G2-A'))
    elibereaza()                                    // răspunsul vechi (GAZPET1) sosește acum
    await u.asteapta(10)
    expect(randuriTabel().map(tr => tr.textContent.includes('G2-A'))).toEqual([true])
    expect(u.text()).toContain('pe cardul GAZPET2')
    expect(u.text()).not.toContain('G1-A')
    expect(selectCard().value).toBe('GAZPET2')
  })

  it('L18: eroarea la citirea cardurilor = mesaj de eroare + „Reîncearcă”, nu „toate au șantier”', async () => {
    let cade = true
    const { u, randuriTabel } = await deschide(scenariu501(), { eroare: st => (cade && st.op === 'select' ? { message: 'canceling statement due to statement timeout' } : null) })
    await u.pana(() => u.text().includes('Eroare la încărcare'))
    expect(u.text()).not.toContain('Toate alimentările au șantier alocat')
    expect(u.text()).toContain('nu înseamnă că nu există')
    cade = false
    await u.apasa(u.buton('Reîncearcă'))
    await u.pana(() => randuriTabel().length === 500)
  })

  it('un card rămas fără rânduri (alocate între timp) arată mesajul cardului, iar filtrele rămân pe ecran', async () => {
    const R = [
      { id: 1, data_alimentare: '2026-11-01', card_combustibil: 'GAZPET1', site_id: null, logistica_active: act(1, 'G1-A') },
      { id: 3, data_alimentare: '2026-11-03', card_combustibil: 'GAZPET2', site_id: null, logistica_active: act(2, 'G2-A') },
    ]
    const { u, f, selectCard, randuriTabel } = await deschide(R)
    await u.pana(() => randuriTabel().length === 2)
    f.tabel.find(r => r.id === 3).site_id = 18      // altcineva alocă GAZPET2 înainte de alegere
    await u.scrie(selectCard(), 'GAZPET2')
    await u.pana(() => u.text().includes('Nicio alimentare fără șantier pe cardul GAZPET2'))
    expect(u.text()).not.toContain('Toate alimentările au șantier alocat')
    expect(selectCard().value).toBe('GAZPET2')
    await u.scrie(selectCard(), 'toate')
    await u.pana(() => randuriTabel().length === 1)
  })
})
