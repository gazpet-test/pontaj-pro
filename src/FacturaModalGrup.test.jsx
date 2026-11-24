// Teste de componentă pentru FacturaModal (Financiar.jsx), factura grupată din SL (TKT-2026-0363, review #1188):
// modalul real montat cu react-dom în jsdom, cu un client Supabase FALS ale cărui răspunsuri sunt controlate de test.
// P1: citirea eșuată pe a doua SL → nicio linie completată, eroarea cu SL-ul în cauză, salvarea blocată până la o regenerare reușită.
// P2: cât rulează precompletarea, formularul e blocat (câmpuri + Regenerează); după ea, editările rămân.
// jsdom nu e dependență a proiectului: se caută în node_modules sau în REDARI_JSDOM_DIR. Fără el, suita e SĂRITĂ VIZIBIL.
import React from 'react'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { createRequire } from 'node:module'
import path from 'node:path'

const h = vi.hoisted(() => ({ client: null }))
vi.mock('./lib/supabase.js', () => ({
  supabase: { from: (...a) => h.client.from(...a), rpc: (...a) => h.client.rpc(...a), functions: { invoke: () => Promise.resolve({ data: null, error: null }) } },
}))
// Componentele altor taburi nu contează aici (și ar aduce importuri grele)
vi.mock('./ConsumuriBonuriTab.jsx', () => ({ default: () => null }))
vi.mock('./CitesteOricePanel.jsx', () => ({ default: () => null }))
vi.mock('./GbeEvidenta.jsx', () => ({ GbeTabel: () => null }))
vi.mock('./GarantiiRegistru.jsx', () => ({ default: () => null }))
vi.mock('./AtaseazaPdfFacturi.jsx', () => ({ default: () => null }))
import { FacturaModal } from './Financiar.jsx'

let JSDOM = null
const surse = [import.meta.url, process.env.REDARI_JSDOM_DIR && path.join(process.env.REDARI_JSDOM_DIR, 'package.json')].filter(Boolean)
for (const s of surse) { try { JSDOM = createRequire(s)('jsdom').JSDOM; break } catch { /* următoarea sursă */ } }
const MOTIV_SARIT = 'SĂRIT: lipsește jsdom (nu e dependență a proiectului; rulează cu REDARI_JSDOM_DIR=<dir cu jsdom instalat>)'
if (!JSDOM) console.warn(`[FacturaModalGrup.test] ${MOTIV_SARIT}`)
const dom = JSDOM ? describe : describe.skip
const numeDom = t => (JSDOM ? t : `${t} — ${MOTIV_SARIT}`)

const amana = () => { let res; const p = new Promise(r => { res = r }); return { p, res } }

// Serverul fals: proiect 7 cu contract → beneficiar; două SL (11, 12) cu valori; orice cerere poate fi suprascrisă / ținută la poartă.
const SL = { 11: { valoare_baza_lei: '1000', valoare_ajustare_lei: '0', valoare_ajustata_lei: '1000', coeficient_ajustare: null },
  12: { valoare_baza_lei: '2000', valoare_ajustare_lei: '0', valoare_ajustata_lei: '2000', coeficient_ajustare: null } }
const LISTA_SL = [{ id: 11, nr_situatie: 'SL-3', luna: 6, an: 2026, valoare_baza_lei: 1000, valoare_ajustata_lei: 1000, status: 'aprobata' },
  { id: 12, nr_situatie: 'SL-4', luna: 7, an: 2026, valoare_baza_lei: 2000, valoare_ajustata_lei: 2000, status: 'aprobata' }]
function serverFals() {
  const st = { cereri: [], peste: {}, porti: {} }
  const raspuns = c => {
    const k = `${c.tabel}:${c.filtre.id ?? c.filtre.sl_id ?? ''}`
    if (st.peste[k]) return st.peste[k](c)
    if (c.op !== 'select') return { data: null, error: { message: 'scriere neașteptată în test' } }
    if (c.tabel === 'executie_proiecte' && c.filtre.activ !== undefined) return { data: [{ id: 7, cod_intern: 'P7', nr_contract: 'NR-P' }], error: null }
    if (c.tabel === 'executie_proiecte') return { data: { contract_id: 3, nr_contract: 'NR-P' }, error: null }
    if (c.tabel === 'contracte_terti') return { data: { numar_contract: '30', data_semnare: null, denumire: 'Lot 1', termen_plata_zile: 45, beneficiar_id: 5 }, error: null }
    if (c.tabel === 'beneficiari') return { data: { id: 5, nume: 'BENEFICIAR SA', cif: 'RO1', retine_gbe_pct: 0, retine_car_pct: 0 }, error: null }
    if (c.tabel === 'executie_situatii_plata' && c.filtre.proiect_id !== undefined) return { data: LISTA_SL, error: null }
    if (c.tabel === 'executie_situatii_plata') return { data: SL[c.filtre.id] ?? null, error: null }
    if (c.tabel === 'facturi_emise') return { data: [], error: null }
    return { data: [], error: null }
  }
  const client = {
    from: tabel => {
      const c = { tabel, filtre: {}, op: 'select' }
      const q = {
        select: () => q, order: () => q, limit: () => q, neq: () => q,
        in: (k, v) => { c.filtre[k] = v; return q },
        eq: (k, v) => { c.filtre[k] = v; return q },
        single: () => q, maybeSingle: () => q,
        insert: p => { c.op = 'insert'; c.payload = p; return q },
        update: p => { c.op = 'update'; c.payload = p; return q },
        then: (res, rej) => {
          st.cereri.push(c)
          const k = `${c.tabel}:${c.filtre.id ?? c.filtre.sl_id ?? ''}`
          const poarta = st.porti[k]
          return (poarta ? poarta.p : Promise.resolve()).then(() => raspuns(c)).then(res, rej)
        },
      }
      return q
    },
    rpc: fn => { st.cereri.push({ rpc: fn }); return Promise.resolve({ data: 999, error: null }) },
  }
  return { client, st }
}

const GRUP = { proiect_id: 7, serie: 'GAZ', nr: 418, canonic: 'GAZ-418', sl: [{ id: 12, nr_situatie: 'SL-4', luna: 7, an: 2026, proiect_id: 7 }, { id: 11, nr_situatie: 'SL-3', luna: 6, an: 2026, proiect_id: 7 }] }

let curata = []
afterEach(() => { curata.splice(0).reverse().forEach(f => f()) })

async function monteaza(client) {
  h.client = client
  const j = new JSDOM('<!doctype html><div id="r"></div>', { pretendToBeVisual: true })
  const vechi = { window: globalThis.window, document: globalThis.document }
  Object.assign(globalThis, { window: j.window, document: j.window.document })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const { createRoot } = await import('react-dom/client')
  const act = React.act || (await import('react-dom/test-utils')).act
  const root = createRoot(j.window.document.getElementById('r'))
  const d = j.window.document
  const toast = vi.fn()
  const asteapta = async () => { await act(async () => { for (let i = 0; i < 40; i++) await Promise.resolve() }) }
  await act(async () => {
    root.render(<FacturaModal item={null} grupDefault={GRUP} beneficiariLista={[]} profileId={null} onClose={() => {}} onSaved={() => {}} showToast={toast} />)
  })
  await asteapta()
  curata.push(() => { act(() => root.unmount()); Object.assign(globalThis, vechi) })
  const buton = text => { const b = [...d.querySelectorAll('button')].find(x => x.textContent.includes(text)); if (!b) throw new Error('nu găsesc butonul ' + text); return b }
  const camp = eticheta => { const l = [...d.querySelectorAll('label')].find(x => x.textContent.trim().startsWith(eticheta)); if (!l) throw new Error('nu găsesc ' + eticheta); return l.nextElementSibling }
  const apasa = async el => { await act(async () => { el.dispatchEvent(new j.window.MouseEvent('click', { bubbles: true })) }); await asteapta() }
  const scrie = async (el, val) => {
    const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set
    await act(async () => { set.call(el, val); el.dispatchEvent(new j.window.Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })) })
    await asteapta()
  }
  const elibereaza = async poarta => { await act(async () => { poarta.res() }); await asteapta() }
  const denumiri = () => [...d.querySelectorAll('input')].map(i => i.value).filter(v => v.startsWith('Contravaloare'))
  const fieldset = () => d.querySelector('fieldset[data-formular-factura]')
  return { d, buton, camp, apasa, scrie, elibereaza, denumiri, fieldset, toast, asteapta }
}

dom(numeDom('FacturaModal: factura grupată din SL (jsdom + react-dom)'), () => {
  it('P1: citirea valorilor celei de-a doua SL eșuează → nicio linie, eroarea cu SL-ul, salvarea blocată până la regenerare reușită', async () => {
    const { client, st } = serverFals()
    st.peste['executie_situatii_plata:12'] = () => ({ data: null, error: { message: 'canceling statement due to statement timeout' } })
    const u = await monteaza(client)
    // ordinea cronologică: SL-3 (11) se citește întâi, SL-4 (12) a doua și pică
    const citiriSL = st.cereri.filter(c => c.tabel === 'executie_situatii_plata' && c.filtre.id !== undefined).map(c => c.filtre.id)
    expect(citiriSL).toEqual([11, 12])
    expect(u.denumiri()).toEqual([])
    const alerta = u.d.querySelector('[role="alert"]')
    expect(alerta && alerta.textContent).toContain('Nu am putut citi valorile pentru SL SL-4: canceling statement due to statement timeout')
    expect(alerta.textContent).toContain('Salvarea e blocată')
    // nici beneficiarul din generarea eșuată nu e completat
    expect(u.camp('Denumire beneficiar').value).toBe('')
    expect(u.buton('💾 Salvează').disabled).toBe(true)
    expect(u.buton('Salvează + PDF').disabled).toBe(true)
    // seria/numărul (citire separată, reușită) rămân precompletate; SL-urile rămân legate
    expect(u.camp('Număr').value).toBe('418')
    // salvarea forțată (click pe buton dezactivat) nu scrie nimic
    await u.apasa(u.buton('💾 Salvează'))
    expect(st.cereri.filter(c => c.op !== 'select' || c.rpc)).toEqual([])

    // regenerare care pică din nou → tot blocat
    await u.apasa(u.buton('Regenerează linii'))
    expect(u.denumiri()).toEqual([])
    expect(u.buton('💾 Salvează').disabled).toBe(true)
    expect(u.toast).toHaveBeenLastCalledWith(expect.stringContaining('SL SL-4'), 'err')

    // citirea își revine → regenerarea reușește → liniile ambelor SL, eroarea dispare, salvarea se deblochează
    delete st.peste['executie_situatii_plata:12']
    await u.apasa(u.buton('Regenerează linii'))
    expect(u.denumiri()).toHaveLength(2)
    expect(u.denumiri()[0]).toContain('nr.SL-3')
    expect(u.denumiri()[1]).toContain('nr.SL-4')
    expect(u.d.querySelector('[role="alert"]')).toBeNull()
    expect(u.camp('Denumire beneficiar').value).toBe('BENEFICIAR SA')
    expect(u.buton('💾 Salvează').disabled).toBe(false)
  })

  it('P1: eroare la ajustările retroactive ale celei de-a doua SL = la fel de blocant (nu „fără ajustări”)', async () => {
    const { client, st } = serverFals()
    st.peste['executie_sl_ajustari:12'] = () => { throw new TypeError('Failed to fetch') }
    const u = await monteaza(client)
    expect(u.denumiri()).toEqual([])
    expect(u.d.querySelector('[role="alert"]').textContent).toContain('ajustările retroactive pentru SL SL-4: Failed to fetch')
    expect(u.buton('💾 Salvează').disabled).toBe(true)
  })

  it('P2: cât rulează precompletarea formularul e blocat; după ea editările rămân', async () => {
    const { client, st } = serverFals()
    const poarta = amana()
    st.porti['executie_situatii_plata:12'] = poarta   // a doua SL răspunde târziu
    const u = await monteaza(client)
    expect(u.d.body.textContent).toContain('Generez liniile și verific numărul')
    // tot formularul (câmpuri, liste, Regenerează, Adaugă linie) e într-un fieldset dezactivat; salvarea e blocată
    expect(u.fieldset().disabled).toBe(true)
    for (const el of [u.camp('Denumire beneficiar'), u.camp('Număr'), u.camp('Serie'), u.camp('SL linkate'), u.buton('Regenerează linii'), u.buton('Adaugă linie')]) {
      expect(el.closest('fieldset[data-formular-factura]')).toBe(u.fieldset())
      expect(el.matches(':disabled')).toBe(true)
    }
    expect(u.buton('💾 Salvează').disabled).toBe(true)
    // Anulează rămâne disponibil
    expect(u.buton('Anulează').closest('fieldset')).toBeNull()

    await u.elibereaza(poarta)
    expect(u.fieldset().disabled).toBe(false)
    expect(u.camp('Denumire beneficiar').matches(':disabled')).toBe(false)
    expect(u.denumiri()).toHaveLength(2)
    expect(u.camp('Denumire beneficiar').value).toBe('BENEFICIAR SA')
    expect(u.camp('Număr').value).toBe('418')
    // editarea de după precompletare nu mai e suprascrisă de nimic
    await u.scrie(u.camp('Denumire beneficiar'), 'ALT BENEFICIAR')
    await u.scrie(u.camp('Număr'), '500')
    await u.asteapta()
    expect(u.camp('Denumire beneficiar').value).toBe('ALT BENEFICIAR')
    expect(u.camp('Număr').value).toBe('500')
    expect(u.buton('💾 Salvează').disabled).toBe(false)
  })

  it('P2: în timpul unei regenerări formularul e blocat din nou, apoi se deblochează', async () => {
    const { client, st } = serverFals()
    const u = await monteaza(client)
    expect(u.fieldset().disabled).toBe(false)
    const poarta = amana()
    st.porti['executie_situatii_plata:12'] = poarta
    // liniile generate nu au fost modificate → fără confirmare
    await u.apasa(u.buton('Regenerează linii'))
    expect(u.fieldset().disabled).toBe(true)
    expect(u.buton('💾 Salvează').disabled).toBe(true)
    await u.elibereaza(poarta)
    expect(u.fieldset().disabled).toBe(false)
    expect(u.denumiri()).toHaveLength(2)
  })
})
