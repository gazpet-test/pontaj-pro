// Exportatorul PDF al raportului de uscare (runda 6, verdict r5 P2 / L24): contextul cerut de ecran se verifică ÎN exportator, după fiecare
// citire / captură asincronă și imediat înainte de pdf.save(). Fără jsdom (rulează și pe CI): document / FileReader / rAF minimale,
// jsPDF și html2canvas falși. Date SINTETICE.
import { afterEach, describe, it, expect, vi } from 'vitest'

const st = vi.hoisted(() => ({ salvari: [], capturi: [], amanaCaptura: false, laAddImage: null }))
vi.mock('jspdf', () => ({ default: class { setProperties() {} addPage() {} addImage() { st.laAddImage?.() } getNumberOfPages() { return 1 } save(n) { st.salvari.push(n) } } }))
vi.mock('html2canvas', () => ({ default: () => {
  const canvas = { width: 1476, height: 300, toDataURL: () => 'data:image/jpeg;base64,AA==' }
  if (!st.amanaCaptura) return Promise.resolve(canvas)
  return new Promise(res => st.capturi.push(() => res(canvas)))
} }))
import { exportRaportUscarePDF, pozeCuImagini } from './uscarePdf.js'

const amana = () => { let res; const p = new Promise(r => { res = r }); return { p, res } }
const tick = async (n = 30) => { for (let i = 0; i < n; i++) await Promise.resolve() }
const RAP = { id: 10, proiect_id: 1, tronson: 'Tr. test', constructor: 'Constructor SRL', stare: 'deschisa', utilaje: [], cantariri: [] }
const POZE = [1, 2, 3].map(i => ({ id: i, uscare_id: 10, categorie: 'manometru', cale: `1/10/p${i}.jpg`, creat_la: '2026-11-10T09:00:00Z' }))
const client = { storage: { from: () => ({ createSignedUrls: async cai => ({ data: cai.map(p => ({ path: p, signedUrl: 'https://stocare.test/' + p })), error: null }) }) } }
const raspuns = { ok: true, status: 200, blob: async () => new Blob(['jpeg'], { type: 'image/jpeg' }) }

function mediu() {
  st.salvari.length = 0; st.capturi.length = 0; st.amanaCaptura = false
  const cereri = []
  const nod = () => ({ style: {}, innerHTML: '', firstElementChild: {} })
  vi.stubGlobal('document', { createElement: nod, body: { appendChild() {}, removeChild() {} } })
  vi.stubGlobal('FileReader', class { readAsDataURL() { this.result = 'data:image/jpeg;base64,AA=='; queueMicrotask(() => this.onload()) } })
  vi.stubGlobal('requestAnimationFrame', cb => { queueMicrotask(cb); return 1 })
  vi.stubGlobal('fetch', (url, opt) => {
    const d = amana(); cereri.push({ url, opt, ...d })
    opt?.signal?.addEventListener('abort', () => d.res(Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))))
    return d.p
  })
  return cereri
}
afterEach(() => { vi.unstubAllGlobals() })

describe('exportRaportUscarePDF — contextul verificat în exportator (runda 6)', () => {
  it('martor: context valid -> o descărcare, pozele citite', async () => {
    const cereri = mediu()
    const p = exportRaportUscarePDF({ client, uscare: RAP, poze: POZE, eValabil: () => true })
    for (let i = 0; i < 3; i++) { await tick(); cereri[i].res(raspuns) }
    const r = await p
    expect(r).toMatchObject({ necitite: 0 })
    expect(r.anulat).toBeUndefined()
    expect(st.salvari).toHaveLength(1)
  })

  it('contextul se schimbă cât se citește poza 1 -> bucla se oprește (pozele 2-3 necerute), zero descărcări', async () => {
    const cereri = mediu()
    let valid = true
    const p = exportRaportUscarePDF({ client, uscare: RAP, poze: POZE, eValabil: () => valid })
    await tick()
    expect(cereri).toHaveLength(1)
    valid = false
    cereri[0].res(raspuns)                                   // citirea se termină oricum, după schimbare
    expect(await p).toEqual({ anulat: true, necitite: 0, pagini: 0 })
    expect(cereri).toHaveLength(1)
    expect(st.salvari).toEqual([])
  })

  it('semnalul anulat respinge citirea în zbor -> anulat (nu „poză necitită”), zero descărcări', async () => {
    const cereri = mediu()
    const ac = new AbortController()
    const p = exportRaportUscarePDF({ client, uscare: RAP, poze: POZE, eValabil: () => true, semnal: ac.signal })
    await tick()
    expect(cereri[0].opt.signal).toBe(ac.signal)
    ac.abort()
    expect(await p).toMatchObject({ anulat: true })
    expect(cereri).toHaveLength(1)
    expect(st.salvari).toEqual([])
  })

  it('contextul se schimbă în timpul unei capturi (html2canvas amânat) -> fără capturi următoare, zero descărcări', async () => {
    const cereri = mediu()
    st.amanaCaptura = true
    let valid = true
    const p = exportRaportUscarePDF({ client, uscare: RAP, poze: [], eValabil: () => valid })
    await tick()
    expect(cereri).toHaveLength(0)
    expect(st.capturi).toHaveLength(1)
    valid = false
    st.capturi[0]()
    expect(await p).toMatchObject({ anulat: true })
    expect(st.capturi).toHaveLength(1)
    expect(st.salvari).toEqual([])
  })

  it('contextul se schimbă după ultima captură -> verificarea dinaintea lui save() oprește descărcarea', async () => {
    mediu()
    let valid = true
    // fără poze = fără anexă: după capturi urmează așezarea pe pagini (addImage, sincron) și apoi save(); contextul cade la primul addImage
    st.laAddImage = () => { valid = false }
    try {
      expect(await exportRaportUscarePDF({ client, uscare: RAP, poze: [], eValabil: () => valid })).toMatchObject({ anulat: true })
      expect(st.salvari).toEqual([])
    } finally { st.laAddImage = null }
  })

  it('o eroare reală, cu contextul încă valid, se propagă (nu e ascunsă ca „anulat”)', async () => {
    mediu()
    const stricat = { storage: { from: () => ({ createSignedUrls: async () => { throw new Error('rețea') } }) } }
    await expect(exportRaportUscarePDF({ client: stricat, uscare: RAP, poze: POZE, eValabil: () => true })).rejects.toThrow('rețea')
  })
})

describe('pozeCuImagini', () => {
  it('fără context dat: comportamentul vechi (citire eșuată = necitită, numărată)', async () => {
    const cereri = mediu()
    const p = pozeCuImagini(client, POZE.slice(0, 2))
    await tick(); cereri[0].res({ ok: false, status: 403 })
    await tick(); cereri[1].res(raspuns)
    const r = await p
    expect(r.necitite).toBe(1)
    expect(r.poze.map(x => !!x.dataUrl)).toEqual([false, true])
  })
})
