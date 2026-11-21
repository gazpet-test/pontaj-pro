// TKT-2026-0390: „🔍 Rulează verificarea” (VerificareFinalaSection din OfertareLicitatii.jsx) — fără parolă în browser, butonul activ
// doar pentru owner / responsabil 1-2 numit de owner sau admin Ofertare (aceeași poartă ca restul Ofertării: poateCheltuiUI), ceilalți
// văd motivul. Componenta REALĂ: (1) randată cu react-dom/server (rulează mereu, fără jsdom), (2) montată în jsdom pentru click
// (sărită vizibil fără jsdom, ca la OfertareRadar.test.jsx), (3) MUTANȚI ai sursei (butonul activ pentru toți) care trebuie prinși.
// Valorile așteptate vin din regula 20261124a (owner; responsabil nenumit de el însuși; autoatribuit = nu), nu din componentă.
import React from 'react'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const h = vi.hoisted(() => ({ client: null }))
vi.mock('./lib/supabase.js', () => ({
  supabase: {
    from: (...a) => h.client.from(...a),
    auth: { getSession: (...a) => h.client.auth.getSession(...a) },
  },
}))
vi.mock('./App.jsx', () => ({ NotificationBell: () => null }))
vi.mock('@supabase/supabase-js', () => {
  const inert = () => new Proxy(function () {}, {
    get: (_t, k) => (k === 'then' ? undefined : inert()),
    apply: () => inert(),
  })
  return { createClient: () => inert() }
})
import { VerificareFinalaSection, MOTIV_VERIFICARE_FINALA, AVERTISMENT_VERIFICARE_FINALA } from './OfertareLicitatii.jsx'

// client fals: ofertare_verificari goală la încărcare; după rulare întoarce rândul cerut
function clientFals() {
  const st = { cereri: [] }
  const from = (tabel) => {
    const q = { select: () => q, eq: () => q, order: () => q, limit: () => q,
      single: () => Promise.resolve({ data: { id: 777, verdict: 'galben', created_at: '2026-11-21T10:00:00Z', raport: { arbitru: { motivare: 'motivare test' } } }, error: null }),
      then: (res, rej) => { st.cereri.push(tabel); return Promise.resolve({ data: [], error: null }).then(res, rej) } }
    return q
  }
  return { st, client: { from, auth: { getSession: () => Promise.resolve({ data: { session: { access_token: 'tok-test' } } }) } } }
}

const OWNER = { id: 'u-owner', is_owner: true }, RESP = { id: 'u-resp', is_owner: false }, RESP2 = { id: 'u-resp2', is_owner: false }
const STRAIN = { id: 'u-strain', is_owner: false }, AUTO = { id: 'u-auto', is_owner: false }
const LIC = { id: 95, responsabil_id: 'u-resp', responsabil_setat_de: null, responsabil_numitor_autorizat: null,
  responsabil2_id: 'u-resp2', responsabil2_setat_de: 'u-owner', responsabil2_numitor_autorizat: true }
const LIC_AUTO = { id: 98, responsabil_id: 'u-auto', responsabil_setat_de: 'u-auto', responsabil_numitor_autorizat: false }

// starea butonului din HTML-ul randat pe server
function stare(Comp, licitatie, profile) {
  h.client = clientFals().client
  const html = renderToStaticMarkup(<Comp licitatie={licitatie} profile={profile} />)
  const buton = html.match(/<button[^>]*>[^<]*Rulează verificarea[^<]*<\/button>/)?.[0]
  if (!buton) throw new Error('nu găsesc butonul în ' + html.slice(0, 300))
  return { activ: !/\sdisabled=""/.test(buton), motiv: html.includes('🔒 ' + MOTIV_VERIFICARE_FINALA) }
}
// tabelul de cazuri (sursă: regula 20261124a) → [nume, licitație, profil, activ așteptat]
const CAZURI = [
  ['owner', LIC, OWNER, true],
  ['responsabil 1 (numire veche, regula A)', LIC, RESP, true],
  ['responsabil 2 numit de owner', LIC, RESP2, true],
  ['cont fără rol', LIC, STRAIN, false],
  ['responsabil autonumit', LIC_AUTO, AUTO, false],
  ['responsabil pe altă licitație', LIC_AUTO, RESP, false],
  ['fără profil (încă neîncărcat)', LIC, null, false],
]
const abateri = (Comp) => CAZURI.flatMap(([nume, l, p, asteptat]) => {
  const s = stare(Comp, l, p)
  return s.activ === asteptat && s.motiv === !asteptat ? [] : [`${nume}: activ ${s.activ} (aștept ${asteptat}), motiv afișat ${s.motiv}`]
})

describe('Verificare finală — butonul pe ROL (randare server, fără jsdom)', () => {
  it('owner / responsabil 1 / responsabil 2 -> activ, fără lacăt; fără rol / autonumit / altă licitație / fără profil -> inactiv, cu motivul', () => {
    expect(abateri(VerificareFinalaSection)).toEqual([])
  })
  it('sursa: parola fixă și window.prompt au dispărut; ecranul primește profilul; avertismentul de cost rămâne', () => {
    const src = readFileSync(new URL('./OfertareLicitatii.jsx', import.meta.url), 'utf8')
    const bloc = src.slice(src.indexOf('export function VerificareFinalaSection'), src.indexOf('// ── 📅 Radar sezonier'))
    expect(bloc.length).toBeGreaterThan(500)
    expect(src).not.toMatch(/Gazpet2026/)
    expect(bloc).not.toMatch(/window\.prompt|parol/i)
    expect(bloc).toMatch(/window\.confirm\(AVERTISMENT_VERIFICARE_FINALA\)/)
    expect(src).toMatch(/<VerificareFinalaSection licitatie=\{l\} profile=\{profile\} \/>/)
    expect(AVERTISMENT_VERIFICARE_FINALA).toMatch(/consumă foarte multe resurse.*finalul licitației.*depunerea în SEAP/s)
  })
})

// --- MUTANȚI: copia sursei cu butonul slăbit, importată din src/ (vi.mock se aplică și ei); fiecare trebuie prins de tabelul de cazuri ---
const AICI = path.dirname(fileURLToPath(import.meta.url))
// [nume, din, în, prins?] — martorul (doar un comentariu schimbat) NU trebuie prins, altfel detecția n-ar dovedi nimic
const MUTANTI = [
  ['MARTOR neutru (comentariu schimbat)', '// (C) arbitrul final (Fable 5.1). Rulează câteva minute; verdictul se salvează.', '// (C) martor', false],
  ['butonul activ pentru toți (doar busy îl oprește)', 'disabled={busy || !poate} onClick={ruleaza}', 'disabled={busy} onClick={ruleaza}'],
  ['poarta UI scoasă (poate = true)', 'const poate = poatePorniProcesarea(profile, l)', 'const poate = true'],
  ['poarta UI pe „e logat” în loc de rol', 'const poate = poatePorniProcesarea(profile, l)', 'const poate = !!profile?.id'],
]
describe('Verificare finală — mutanții butonului sunt prinși', () => {
  const src = readFileSync(path.join(AICI, 'OfertareLicitatii.jsx'), 'utf8')
  for (const [i, [nume, din, in_, prins = true]] of MUTANTI.entries()) {
    it(`mutant: ${nume}`, async () => {
      expect(src.split(din).length, 'textul mutantului apare exact o dată').toBe(2)
      const fis = path.join(AICI, `.tmp_mutant_vf_${i}_${process.pid}.jsx`)
      writeFileSync(fis, src.replace(din, in_))
      try {
        const m = await import(/* @vite-ignore */ `./.tmp_mutant_vf_${i}_${process.pid}.jsx`)
        if (prins) expect(abateri(m.VerificareFinalaSection).length).toBeGreaterThan(0)
        else expect(abateri(m.VerificareFinalaSection)).toEqual([])
      } finally { rmSync(fis, { force: true }) }
    }, 60000)
  }
})

// --- click în jsdom: fără drept nu pleacă nimic; cu drept: confirmare, apoi O cerere cu tokenul sesiunii; refuzul serverului afișat ---
let JSDOM = null
for (const s of [import.meta.url, process.env.REDARI_JSDOM_DIR && path.join(process.env.REDARI_JSDOM_DIR, 'package.json')].filter(Boolean)) {
  try { JSDOM = createRequire(s)('jsdom').JSDOM; break } catch { /* următoarea sursă */ }
}
const MOTIV_SARIT = 'SĂRIT: lipsește jsdom (nu e dependență a proiectului; rulează cu REDARI_JSDOM_DIR=<dir cu jsdom instalat>)'
if (!JSDOM) console.warn(`[OfertareVerificareFinala.test] ${MOTIV_SARIT}`)
const dom = JSDOM ? describe : describe.skip

let curata = []
afterEach(() => { [...curata].reverse().forEach(f => f()); curata = []; vi.restoreAllMocks(); vi.unstubAllGlobals() })

async function monteaza(licitatie, profile, { confirma = true, raspuns = { status: 200, corp: { ok: true, verificare_id: 777 } } } = {}) {
  const { client, st } = clientFals()
  h.client = client
  const j = new JSDOM('<!doctype html><div id="r"></div>', { pretendToBeVisual: true })
  const vechi = { window: globalThis.window, document: globalThis.document }
  Object.assign(globalThis, { window: j.window, document: j.window.document })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const confirm = vi.fn(() => confirma), prompt = vi.fn(() => 'Gazpet2026')
  j.window.confirm = confirm; j.window.prompt = prompt
  const fetchFals = vi.fn(async () => new Response(JSON.stringify(raspuns.corp), { status: raspuns.status }))
  vi.stubGlobal('fetch', fetchFals)
  const { createRoot } = await import('react-dom/client')
  const act = React.act || (await import('react-dom/test-utils')).act
  const root = createRoot(j.window.document.getElementById('r'))
  const asteapta = async () => { await act(async () => { for (let i = 0; i < 40; i++) await Promise.resolve() }) }
  await act(async () => { root.render(<VerificareFinalaSection licitatie={licitatie} profile={profile} />) })
  await asteapta()
  curata.push(() => { act(() => root.unmount()); Object.assign(globalThis, vechi) })
  const d = j.window.document
  const buton = () => [...d.querySelectorAll('button')].find(b => /Rulează/.test(b.textContent))
  const apasa = async () => { await act(async () => { buton().dispatchEvent(new j.window.MouseEvent('click', { bubbles: true })) }); await asteapta() }
  return { d, buton, apasa, confirm, prompt, fetchFals, st, text: () => d.body.textContent }
}

dom(JSDOM ? 'Verificare finală — click (jsdom)' : `Verificare finală — click (jsdom) — ${MOTIV_SARIT}`, () => {
  it('cont fără rol: butonul inactiv, click-ul nu cere confirmare și nu cheamă serverul; motivul e pe ecran', async () => {
    const m = await monteaza(LIC, STRAIN)
    expect(m.buton().disabled).toBe(true)
    await m.apasa()
    expect(m.confirm).not.toHaveBeenCalled(); expect(m.prompt).not.toHaveBeenCalled(); expect(m.fetchFals).not.toHaveBeenCalled()
    expect(m.text()).toContain(MOTIV_VERIFICARE_FINALA)
  })
  it('responsabil: confirmarea refuzată -> nicio cerere; fără parolă cerută', async () => {
    const m = await monteaza(LIC, RESP, { confirma: false })
    expect(m.buton().disabled).toBe(false)
    await m.apasa()
    expect(m.confirm).toHaveBeenCalledWith(AVERTISMENT_VERIFICARE_FINALA)
    expect(m.prompt).not.toHaveBeenCalled(); expect(m.fetchFals).not.toHaveBeenCalled()
  })
  it('owner: confirmă -> O cerere POST cu tokenul sesiunii și doar licitatie_id; verdictul apare', async () => {
    const m = await monteaza(LIC, OWNER)
    await m.apasa()
    expect(m.prompt).not.toHaveBeenCalled()
    expect(m.fetchFals).toHaveBeenCalledTimes(1)
    const [url, opt] = m.fetchFals.mock.calls[0]
    expect(url).toMatch(/\/functions\/v1\/ofertare-verificare-finala$/)
    expect(opt.method).toBe('POST'); expect(opt.headers.Authorization).toBe('Bearer tok-test')
    expect(JSON.parse(opt.body)).toEqual({ licitatie_id: 95 })
    expect(m.text()).toContain('GALBEN')
  })
  it('refuzul serverului (403) e afișat ca eroare, fără verdict inventat', async () => {
    const m = await monteaza(LIC, RESP2, { raspuns: { status: 403, corp: { ok: false, error: 'refuz de pe server (test)' } } })
    await m.apasa()
    expect(m.fetchFals).toHaveBeenCalledTimes(1)
    expect(m.text()).toContain('refuz de pe server (test)')
    expect(m.text()).toContain('nerulată încă')
  })
})
