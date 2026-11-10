// Teste de componentă pentru NodCuplareSchema (review Jakarinos r2): componenta reală montată cu react-dom în jsdom, cu un client
// Supabase FALS ale cărui răspunsuri se eliberează manual (ordinea răspunsurilor e controlată de test). Fără rețea, fără librării noi.
// jsdom nu e dependență a proiectului (ca la src/redari/ui/convocatorNeexpediatHook.test.jsx): se caută în node_modules sau în
// REDARI_JSDOM_DIR (un director cu jsdom instalat). Fără el, suita e SĂRITĂ VIZIBIL.
import React from 'react'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { createRequire } from 'node:module'
import path from 'node:path'
// clientul real nu se creează (fără variabile de mediu); fiecare test dă componentei clientul lui fals prin `client`
vi.mock('./lib/supabase.js', () => ({ supabase: null }))
import NodCuplareSchema from './NodCuplareSchema.jsx'

let JSDOM = null
const surse = [import.meta.url, process.env.REDARI_JSDOM_DIR && path.join(process.env.REDARI_JSDOM_DIR, 'package.json')].filter(Boolean)
for (const s of surse) { try { JSDOM = createRequire(s)('jsdom').JSDOM; break } catch { /* următoarea sursă */ } }
const MOTIV_SARIT = 'SĂRIT: lipsește jsdom (nu e dependență a proiectului; rulează cu REDARI_JSDOM_DIR=<dir cu jsdom instalat>)'
if (!JSDOM) console.warn(`[NodCuplareSchema.test] ${MOTIV_SARIT}`)
const dom = JSDOM ? describe : describe.skip
const numeDom = t => (JSDOM ? t : `${t} — ${MOTIV_SARIT}`)

const amana = () => { let res; const p = new Promise(r => { res = r }); return { p, res } }
const RAND = (id, cod, nod = 'NOD-A', extra = {}) => ({
  id, proiect_id: 1, nod_cod: nod, cod, subansamblu: 'Z test', dn: 300, diametru: '323,9×8', poz1: '1 test', poz2: '2 test', certitudine: 'sigur',
  stare: 'de_executat', data_stare: null, data_sudare: null, sudor: null, buletin_ndt: null, motiv: null,
  vedere: null, x_pct: null, y_pct: null, pozitie_certitudine: null, pozitii_secundare: [], versiune: 1, ...extra,
})

// clientul fals: „serverul” e o hartă de rânduri; o citire face instantaneul LA CERERE și îl livrează când testul deschide poarta;
// o salvare se aplică pe server abia când testul o eliberează ('ok') sau întoarce eroare de rețea ('eroare', fără aplicare)
function clientFals({ randuri, manifest = null, model3d = null }) {
  const server = new Map(randuri.map(r => [r.id, { ...r }]))
  const st = { poartaLista: null, rpc: [], rand: [], img: [], imgManual: false }
  const interogare = () => {
    const f = { gt: null, lim: 1000, id: null }
    const q = {
      select: () => q, order: () => q,
      eq: (c, v) => { if (c === 'id') f.id = v; return q },
      limit: n => { f.lim = n; return q }, gt: (_c, v) => { f.gt = v; return q },
      maybeSingle: () => {
        const instant = server.has(f.id) ? { ...server.get(f.id) } : null
        const d = amana(); st.rand.push({ id: f.id, ...d })
        return d.p.then(() => ({ data: instant, error: null }))
      },
      then: (res, rej) => {
        const instant = [...server.values()].filter(r => f.gt == null || r.id > f.gt).sort((a, b) => a.id - b.id).slice(0, f.lim).map(r => ({ ...r }))
        const poarta = f.gt == null ? st.poartaLista : null
        return (poarta ? poarta.p : Promise.resolve()).then(() => ({ data: instant, error: null })).then(res, rej)
      },
    }
    return q
  }
  const client = {
    from: () => interogare(),
    rpc: (fn, a) => {
      if (fn === 'fn_executie_nod_drept') return Promise.resolve({ data: true, error: null })
      const d = amana(); st.rpc.push({ a, ...d })
      return d.p.then(mod => {
        if (mod === 'eroare') return { data: null, error: { message: 'timeout simulat' } }
        const r = server.get(a.p_id)
        if (r.stare !== a.p_stare_veche || r.versiune !== a.p_versiune) return { data: { ok: false, motiv: 'conflict', sudura: { ...r } }, error: null }
        const primaSudare = a.p_stare_noua === 'sudat' && ['de_executat', 'insailat'].includes(r.stare)
        Object.assign(r, { stare: a.p_stare_noua, data_stare: a.p_data, versiune: r.versiune + 1, sudor: a.p_sudor ?? r.sudor,
          buletin_ndt: a.p_buletin_ndt ?? r.buletin_ndt, data_sudare: primaSudare ? a.p_data : r.data_sudare })
        return { data: { ok: true, duplicat: false, sudura: { ...r } }, error: null }
      })
    },
    storage: {
      from: () => ({
        download: async cale => {
          // model_3d.json (schema 3D, opțională): obiect = conținutul; { eroare } = altă eroare decât lipsa; null = fișier lipsă (404)
          if (String(cale).endsWith('/model_3d.json')) {
            if (!model3d) return { data: null, error: { message: 'Object not found', status: 400, statusCode: '404' } }
            if (model3d.eroare) return { data: null, error: model3d.eroare }
            return { data: new Blob([JSON.stringify(model3d)]), error: null }
          }
          return manifest ? { data: new Blob([JSON.stringify(manifest)]), error: null } : { data: null, error: { message: 'Object not found' } }
        },
        createSignedUrl: cale => {
          if (!st.imgManual) return Promise.resolve({ data: { signedUrl: 'url:' + cale }, error: null })
          const d = amana(); st.img.push({ cale, ...d })
          return d.p.then(() => ({ data: { signedUrl: 'url:' + cale }, error: null }))
        },
      }),
    },
  }
  return { client, st, server }
}

let curata = []
afterEach(() => { curata.forEach(f => f()); curata = []; vi.restoreAllMocks() })

async function monteaza(client) {
  const j = new JSDOM('<!doctype html><div id="r"></div>', { pretendToBeVisual: true })
  const vechi = { window: globalThis.window, document: globalThis.document }
  Object.assign(globalThis, { window: j.window, document: j.window.document })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  // garda „click fantomă” din fișă / listă ignoră 450 ms după deschidere: ceasul se avansează explicit din test
  let ceas = 1_000_000_000_000
  vi.spyOn(Date, 'now').mockImplementation(() => ceas)
  const { createRoot } = await import('react-dom/client')
  const act = React.act || (await import('react-dom/test-utils')).act
  const root = createRoot(j.window.document.getElementById('r'))
  const d = j.window.document
  const asteapta = async () => { await act(async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }) }
  await act(async () => { root.render(<NodCuplareSchema proiectId={1} client={client} />) })
  await asteapta()
  let montat = true
  const demonteaza = () => { if (montat) { montat = false; act(() => root.unmount()) } }
  curata.push(() => { demonteaza(); Object.assign(globalThis, vechi) })
  const trece = () => { ceas += 1000 }
  const butoane = () => [...d.querySelectorAll('button')]
  const buton = (text, ultim = true) => { const b = butoane().filter(x => x.textContent.includes(text)); const r = ultim ? b.at(-1) : b[0]; if (!r) throw new Error('nu găsesc butonul ' + text); return r }
  const apasa = async el => { trece(); await act(async () => { el.dispatchEvent(new j.window.MouseEvent('click', { bubbles: true })) }); await asteapta() }
  const scrie = async (el, val) => {
    const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set
    await act(async () => { set.call(el, val); el.dispatchEvent(new j.window.Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })) })
    await asteapta()
  }
  const elibereaza = async (cerere, val) => { await act(async () => { cerere.res(val) }); await asteapta() }
  // fluxul utilizatorului: lista „fără punct” -> fișa -> starea țintă -> sudor / buletin -> Confirmă
  const deschide = async cod => { await apasa(buton('Suduri fără punct')); await apasa(buton(cod)) }
  const inchide = async () => { await apasa(d.querySelector('button[aria-label="Închide"]')) }
  const marcheaza = async (eticheta, { sudor, buletin } = {}) => {
    await apasa(buton(eticheta))
    if (sudor != null) await scrie(d.querySelector('input[placeholder^="ex. POPESCU"]'), sudor)
    if (buletin != null) await scrie(d.querySelector('input[placeholder="ex. RT-0123"]'), buletin)
    await apasa(buton('✓ Confirmă'))
  }
  const stare = async cod => { await apasa(buton('Suduri fără punct')); const t = buton(cod).textContent; await inchide(); return t }
  return { d, act, demonteaza, asteapta, apasa, buton, scrie, elibereaza, deschide, inchide, marcheaza, stare }
}

dom(numeDom('NodCuplareSchema — răspunsuri întârziate (jsdom + react-dom)'), () => {
  it('A: reîncărcarea începută înainte de salvare și terminată după ea nu readuce versiunea veche', async () => {
    const { client, st } = clientFals({ randuri: [RAND(1, 'CP-001'), RAND(2, 'CP-002')] })
    const u = await monteaza(client)
    st.poartaLista = amana()
    await u.apasa(u.buton('↻ Reîncarcă'))                 // citirea face instantaneul acum: CP-001 v1
    await u.deschide('CP-001')
    await u.marcheaza('Sudat', { sudor: 'P-1' })
    await u.elibereaza(st.rpc[0], 'ok')                    // v2 aplicat local
    await u.elibereaza(st.poartaLista, undefined)          // abia acum ajunge citirea veche (v1)
    expect(await u.stare('CP-001')).toContain('Sudat')
    expect(u.d.body.textContent).toContain('cumulat din 2')
  })

  it('A: ordinea inversă — citirea veche ajunge întâi, salvarea după: rămâne tot versiunea nouă', async () => {
    const { client, st } = clientFals({ randuri: [RAND(1, 'CP-001'), RAND(2, 'CP-002')] })
    const u = await monteaza(client)
    st.poartaLista = amana()
    await u.apasa(u.buton('↻ Reîncarcă'))
    await u.deschide('CP-001')
    await u.marcheaza('Sudat', { sudor: 'P-1' })
    await u.elibereaza(st.poartaLista, undefined)
    await u.elibereaza(st.rpc[0], 'ok')
    expect(await u.stare('CP-001')).toContain('Sudat')
  })

  it('B: două salvări pe fișe diferite, cu erori în ordine inversă — fiecare își păstrează cheia și cererea', async () => {
    const { client, st } = clientFals({ randuri: [RAND(1, 'CP-001'), RAND(2, 'CP-002')] })
    const u = await monteaza(client)
    await u.deschide('CP-001'); await u.marcheaza('Sudat', { sudor: 'P-1' })     // A, în zbor
    await u.inchide()
    await u.deschide('CP-002'); await u.marcheaza('Sudat', { sudor: 'P-1' })     // B, în zbor
    await u.elibereaza(st.rpc[1], 'eroare')                                      // B: necunoscut
    await u.elibereaza(st.rpc[0], 'eroare')                                      // A: necunoscut, mai târziu
    await u.apasa(u.buton('✓ Confirmă'))                                         // reîncercarea lui B, formular neschimbat
    expect(st.rpc[2].a).toEqual(st.rpc[1].a)
    expect(st.rpc[2].a.p_cheie).toBe(st.rpc[1].a.p_cheie)
    await u.elibereaza(st.rpc[2], 'ok')
    await u.inchide()
    await u.deschide('CP-001'); await u.marcheaza('Sudat')                       // reîncercarea lui A (sudorul rămâne din sesiune)
    expect(st.rpc[3].a).toEqual(st.rpc[0].a)
    expect(st.rpc[3].a.p_cheie).toBe(st.rpc[0].a.p_cheie)
    expect(st.rpc[0].a.p_cheie).not.toBe(st.rpc[1].a.p_cheie)
  })

  it('B: o reconciliere întârziată nu șterge o intenție ulterioară pe aceeași sudură', async () => {
    const { client, st } = clientFals({ randuri: [RAND(1, 'CP-001')] })
    const u = await monteaza(client)
    await u.deschide('CP-001'); await u.marcheaza('Sudat', { sudor: 'P-1' })
    await u.elibereaza(st.rpc[0], 'eroare')                                      // k1 necunoscut
    await u.inchide()                                                            // reconcilierea k1 pornește (instantaneu v1), rămâne în zbor
    expect(st.rand.length).toBe(1)
    await u.deschide('CP-001'); await u.marcheaza('Sudat')                       // aceeași cerere -> k1
    expect(st.rpc[1].a.p_cheie).toBe(st.rpc[0].a.p_cheie)
    await u.elibereaza(st.rpc[1], 'ok')                                          // v2
    await u.deschide('CP-001'); await u.marcheaza('NDT (fără rezultat)', { buletin: 'RT-1' })
    await u.elibereaza(st.rpc[2], 'eroare')                                      // k3 necunoscut, intenție ulterioară
    await u.elibereaza(st.rand[0], undefined)                                    // abia acum: reconcilierea veche (k1, v1)
    await u.apasa(u.buton('✓ Confirmă'))                                         // reîncercarea lui k3
    expect(st.rpc[3].a.p_cheie).toBe(st.rpc[2].a.p_cheie)
    expect(st.rpc[3].a).toEqual(st.rpc[2].a)
    await u.inchide()
    expect(await u.stare('CP-001')).toContain('Sudat')                           // instantaneul v1 nu a readus „De executat”
  })

  it('imaginea întârziată: nu apare pe altă vedere sau pe alt nod', async () => {
    const manifest = [{ vedere: 'PLAN', fisier: 'PLAN.png', latime_px: 100, inaltime_px: 50, titlu: 'Plan' },
      { vedere: 'A', fisier: 'A.png', latime_px: 100, inaltime_px: 50, titlu: 'A' }]
    const { client, st } = clientFals({ randuri: [RAND(1, 'CP-001', 'NOD-A'), RAND(2, 'CP-002', 'NOD-B')], manifest })
    st.imgManual = true
    const u = await monteaza(client)
    const src = () => u.d.querySelector('img')?.getAttribute('src') || null
    expect(st.img.map(x => x.cale)).toEqual(['1/NOD-A/PLAN.png'])
    await u.apasa(u.buton('Vedere A'))
    await u.elibereaza(st.img[0], undefined)              // răspunsul vechi (PLAN) după schimbarea vederii
    expect(src()).toBeNull()
    await u.elibereaza(st.img[1], undefined)
    expect(src()).toBe('url:1/NOD-A/A.png')
    // alt nod, cât timp cererea nodului vechi e în zbor
    await u.apasa(u.buton('Plan', false))
    expect(st.img.at(-1).cale).toBe('1/NOD-A/PLAN.png')
    const veche = st.img.at(-1)
    await u.scrie(u.d.querySelector('select'), 'NOD-B')
    expect(src()).toBeNull()                               // imaginea nodului A dispare imediat
    await u.elibereaza(veche, undefined)
    expect(src()).toBeNull()                               // și nu revine din răspunsul întârziat
    const noua = st.img.at(-1)
    expect(noua.cale).toBe('1/NOD-B/PLAN.png')
    await u.elibereaza(noua, undefined)
    expect(src()).toBe('url:1/NOD-B/PLAN.png')
  })

  it('demontarea în timpul salvării: răspunsul ulterior nu mai programează nimic', async () => {
    const { client, st } = clientFals({ randuri: [RAND(1, 'CP-001')] })
    const u = await monteaza(client)
    await u.deschide('CP-001'); await u.marcheaza('Sudat', { sudor: 'P-1' })
    u.demonteaza()
    const timere = vi.spyOn(globalThis, 'setTimeout')
    const erori = vi.spyOn(console, 'error')
    await u.act(async () => { st.rpc[0].res('ok'); for (let i = 0; i < 30; i++) await Promise.resolve() })
    expect(timere.mock.calls.filter(([, ms]) => ms === 700)).toEqual([])
    expect(erori).not.toHaveBeenCalled()
  })
})

// ── schema 3D (probă): butonul apare doar cu model_3d.json; jsdom nu are WebGL, deci verificăm butonul, mesajul de rezervă,
// lista „fără loc în 3D” și că fișa se deschide din ea cu ACEEAȘI logică de bifare ──
const MODEL3D = {
  format: 'gazpet-nod-3d', versiune: 1, unitate: 'mm', titlu: 'Probă', note: ['Model schematic.'],
  grupuri: [{
    id: 'rez', titlu: 'Rezervoare', prefixe: ['CR'], teren_z: 0,
    elemente: [{ tip: 'teava', a: [0, 0, 0], b: [1000, 0, 0], dn: 250 }],
    suduri: [{ cod: 'CR-001', p: [0, 0, 0], cert: 'desen' }, { cod: 'CR-050', p: [1000, 0, 0], cert: 'desen' }],
    fara_pozitie: [{ cod: 'CR-114', motiv: 'de confirmat' }],
  }],
}
const pana = async (u, cond, ms = 4000) => {
  const t0 = performance.now()
  while (!cond()) {
    if (performance.now() - t0 > ms) throw new Error('condiția nu s-a îndeplinit în timp')
    await u.act(async () => { await new Promise(r => setTimeout(r, 25)) })
  }
}

dom(numeDom('NodCuplareSchema — schema 3D (probă)'), () => {
  const randuri = () => [RAND(1, 'CR-001'), RAND(2, 'CR-114'), RAND(3, 'CP-005')]

  it('fără model_3d.json: niciun buton 3D și niciun mesaj de eroare', async () => {
    const { client } = clientFals({ randuri: randuri() })
    const u = await monteaza(client)
    expect(u.d.body.textContent).not.toContain('3D (probă)')
    expect(u.d.body.textContent).not.toContain('Schema 3D')
  })

  it('cu model: butonul apare; în 3D lista „fără loc” are doar sudurile grupului; fișa se deschide din ea; înapoi la 2D', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})   // jsdom fără WebGL: three raportează că nu poate crea contextul
    const manifest = [{ vedere: 'PLAN', fisier: 'PLAN.png', latime_px: 100, inaltime_px: 50, titlu: 'Plan' }]
    const { client, st } = clientFals({ randuri: randuri(), manifest, model3d: MODEL3D })
    const u = await monteaza(client)
    await u.apasa(u.buton('3D (probă)'))
    // CR-001 are sferă, CR-114 e „fără loc”, CP-005 nu e în domeniul grupului (alt prefix); CR-050 e în model, dar nu în listă
    expect(u.d.body.textContent).toContain('În schema 3D: 1 suduri')
    expect(u.buton('Suduri fără loc în 3D').textContent).toContain(': 1')
    expect(u.d.body.textContent).toContain('În schemă, dar nu în lista sudurilor: CR-050')
    await pana(u, () => /WebGL indisponibil|nu s-a putut încărca/.test(u.d.body.textContent))
    expect(u.d.body.textContent).toContain('WebGL indisponibil')
    expect(u.d.querySelector('img')).toBeNull()              // imaginea 2D nu e afișată în modul 3D
    await u.apasa(u.buton('Suduri fără loc în 3D'))
    expect(u.d.body.textContent).toContain('Suduri fără loc în 3D (Rezervoare): 1')
    await u.apasa(u.buton('CR-114'))
    await u.marcheaza('Sudat', { sudor: 'P-1' })              // aceeași fișă / același RPC ca în 2D
    expect(st.rpc).toHaveLength(1)
    expect(st.rpc[0].a).toMatchObject({ p_id: 2, p_stare_veche: 'de_executat', p_stare_noua: 'sudat', p_sudor: 'P-1' })
    await u.elibereaza(st.rpc[0], 'ok')
    expect(u.d.body.textContent).toContain('Salvat.')
    await u.inchide()
    await u.apasa(u.buton('Plan'))
    expect(u.d.body.textContent).toContain('Pe această vedere')
  })

  it('eroare la citirea modelului (alta decât lipsa fișierului) = mesaj vizibil, fără buton', async () => {
    const { client } = clientFals({ randuri: randuri(), model3d: { eroare: { message: 'Failed to fetch' } } })
    const u = await monteaza(client)
    expect(u.d.body.textContent).toContain('Schema 3D nu se poate citi (model_3d.json): Failed to fetch')
    expect(u.d.body.textContent).not.toContain('3D (probă)')
  })

  it('model cu alt format: respins cu motiv, fără buton', async () => {
    const { client } = clientFals({ randuri: randuri(), model3d: { ...MODEL3D, format: 'altul' } })
    const u = await monteaza(client)
    expect(u.d.body.textContent).toContain('alt format')
    expect(u.d.body.textContent).not.toContain('3D (probă)')
  })

  // varianta B: două grupuri amplasate (rez, gara) + unul cu amplasare invalidă (gaz) — model sintetic
  const MODEL_B = () => ({
    ...MODEL3D,
    grupuri: [
      { ...MODEL3D.grupuri[0], amplasare: { origine: [0, 0, -1500], rot_z: 0 } },
      { id: 'gara', titlu: 'Gara', prefixe: ['CP'], teren_z: 0, amplasare: { origine: [10000, 0, 0], rot_z: 90 },
        elemente: [{ tip: 'teava', a: [0, 0, 0], b: [1000, 0, 0], dn: 300 }],
        suduri: [{ cod: 'CP-005', p: [1000, 0, 0], cert: 'desen' }], fara_pozitie: [] },
      { id: 'gaz', titlu: 'Alimentare', prefixe: ['CI'], teren_z: 0, amplasare: { origine: [0, 0, 0], rot_z: 720 },
        elemente: [{ tip: 'teava', a: [0, 0, 0], b: [0, 0, 500], dn: 25 }], suduri: [], fara_pozitie: [] },
    ],
  })

  it('varianta B: „Toată instalația” e vederea implicită; reuniunea grupurilor amplasate; grupul neamplasat e enumerat; înapoi pe grup', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { client } = clientFals({ randuri: [...randuri(), RAND(4, 'CP-099'), RAND(5, 'CI-001')], model3d: MODEL_B() })
    const u = await monteaza(client)
    // amplasarea invalidă: eroare vizibilă, grupul rămâne (în vederea lui)
    expect(u.d.body.textContent).toContain('Grupul 3 (gaz): rot_z lipsește sau nu e un număr între -360 și 360')
    await u.apasa(u.buton('3D (probă)'))
    expect(u.buton('Toată instalația').style.fontWeight).toBe('800')
    expect(u.d.body.textContent).toContain('Nu sunt amplasate (se văd doar în vederea lor): Alimentare')
    // sfere: CR-001 + CP-005; fără loc: CR-114 (fără poziție) + CP-099 (lipsă din model); CI-001 e al grupului neamplasat
    expect(u.d.body.textContent).toContain('În schema 3D: 2 suduri')
    expect(u.buton('Suduri fără loc în 3D').textContent).toContain(': 2')
    expect(u.d.body.textContent).toContain('În schemă, dar nu în lista sudurilor: CR-050')
    await u.apasa(u.buton('Suduri fără loc în 3D'))
    expect(u.d.body.textContent).toContain('Suduri fără loc în 3D (Toată instalația): 2')
    expect(u.buton('CR-114')).toBeTruthy()
    expect(u.buton('CP-099')).toBeTruthy()
    await u.apasa(u.d.querySelector('button[aria-label="Închide"]'))
    // pe un grup: ca înainte (doar domeniul lui)
    await u.apasa(u.buton('Gara'))
    expect(u.d.body.textContent).toContain('În schema 3D: 1 suduri')
    expect(u.buton('Suduri fără loc în 3D').textContent).toContain(': 1')
    expect(u.d.body.textContent).not.toContain('Nu sunt amplasate')
    await u.apasa(u.buton('Alimentare'))
    expect(u.buton('Suduri fără loc în 3D').textContent).toContain(': 1')   // CI-001
  })

  it('compatibil înapoi: fără amplasări nu apare „Toată instalația” și primul grup e cel afișat', async () => {
    const { client } = clientFals({ randuri: randuri(), model3d: MODEL3D })
    const u = await monteaza(client)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await u.apasa(u.buton('3D (probă)'))
    expect(u.d.body.textContent).not.toContain('Toată instalația')
    expect(u.d.body.textContent).toContain('Rezervoare')
    expect(u.d.body.textContent).toContain('În schema 3D: 1 suduri')
  })
})
