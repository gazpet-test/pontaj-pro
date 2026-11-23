import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { creeazaActiunePv, mesajRezultatPv } from './pvPredareAvizActiune.js'
import { genereazaPvPredareAviz } from './pvPredareAvizPdf.js'

// L24 (TKT-2026-0379 r2): generarea PV-ului se oprește când utilizatorul părăsește ecranul.

const amanat = () => { let rez; const p = new Promise(r => { rez = r }); return { p, rez } }
const AVIZ = { id: 'a1', transport_id: 't1', numar_aviz: 'AVZ-2026-0042', data_transport: '2026-11-19' }

function urmaritor() {
  const stari = [], rezultate = []
  return { stari, rezultate, laStare: (x) => stari.push(x), laRezultat: (r) => rezultate.push(r) }
}

describe('creeazaActiunePv', () => {
  it('cazul bun: stare id → null, apoi rezultatul; generatorul primește un esteCurent adevărat', async () => {
    const a = creeazaActiunePv(), u = urmaritor()
    let curentLaGenerare
    const r = await a.porneste(AVIZ, { ...u, genereaza: async (_av, esteCurent) => { curentLaGenerare = esteCurent(); return { ok: true, fisier: 'f.pdf', nrLinii: 2 } } })
    expect(r).toBe('gata')
    expect(curentLaGenerare).toBe(true)
    expect(u.stari).toEqual(['a1', null])
    expect(u.rezultate).toEqual([{ ok: true, fisier: 'f.pdf', nrLinii: 2 }])
  })

  it('NEGATIV: ecran închis în timpul generării → anulat, fără mesaj și fără schimbare de stare; esteCurent devine fals', async () => {
    const a = creeazaActiunePv(), u = urmaritor(), d = amanat()
    let esteCurentPrins
    const pr = a.porneste(AVIZ, { ...u, genereaza: (_av, ec) => { esteCurentPrins = ec; return d.p } })
    expect(esteCurentPrins()).toBe(true)
    a.opreste()
    expect(esteCurentPrins()).toBe(false)
    d.rez({ ok: true, fisier: 'f.pdf', nrLinii: 1 })
    expect(await pr).toBe('anulat')
    expect(u.stari).toEqual(['a1'])          // doar pornirea; niciun null / mesaj după închidere
    expect(u.rezultate).toEqual([])
  })

  it('NEGATIV: excepție după închiderea ecranului → tot fără mesaj', async () => {
    const a = creeazaActiunePv(), u = urmaritor(), d = amanat()
    const pr = a.porneste(AVIZ, { ...u, genereaza: () => d.p.then(() => { throw new Error('boom') }) })
    a.opreste()
    d.rez()
    expect(await pr).toBe('anulat')
    expect(u.rezultate).toEqual([])
  })

  it('NEGATIV: dublu click / alt aviz cât rulează unul → ignorat, un singur generator', async () => {
    const a = creeazaActiunePv(), u = urmaritor(), d = amanat()
    const gen = vi.fn(() => d.p)
    const p1 = a.porneste(AVIZ, { ...u, genereaza: gen })
    expect(await a.porneste(AVIZ, { ...u, genereaza: gen })).toBe('pornit-deja')
    expect(await a.porneste({ ...AVIZ, id: 'a2' }, { ...u, genereaza: gen })).toBe('pornit-deja')
    expect(gen).toHaveBeenCalledTimes(1)
    d.rez({ ok: false, mesaj: 'x' })
    expect(await p1).toBe('gata')
    // după terminare se poate porni din nou
    expect(await a.porneste({ ...AVIZ, id: 'a2' }, { ...u, genereaza: async () => ({ ok: false, mesaj: 'y' }) })).toBe('gata')
    expect(u.rezultate.map(r => r.mesaj)).toEqual(['x', 'y'])
  })

  it('NEGATIV: după oprire nu mai pornește nimic; aviz fără id → refuz', async () => {
    const a = creeazaActiunePv(), u = urmaritor(), gen = vi.fn()
    expect(await a.porneste({ transport_id: 't1' }, { ...u, genereaza: gen })).toBe('fara-aviz')
    a.opreste()
    expect(await a.porneste(AVIZ, { ...u, genereaza: gen })).toBe('oprit')
    expect(gen).not.toHaveBeenCalled()
    expect(u.stari).toEqual([])
  })

  it('excepție cu ecranul deschis → rezultat cu eroare (mesaj „error”), starea se eliberează', async () => {
    const a = creeazaActiunePv(), u = urmaritor()
    expect(await a.porneste(AVIZ, { ...u, genereaza: async () => { throw new Error('boom') } })).toBe('gata')
    expect(u.stari).toEqual(['a1', null])
    expect(mesajRezultatPv(u.rezultate[0])).toEqual({ text: 'Eroare generare PV: boom', tip: 'error' })
  })

  it('o instanță nouă (remontare, StrictMode) nu e afectată de oprirea celei vechi', async () => {
    const veche = creeazaActiunePv(); veche.opreste()
    const noua = creeazaActiunePv(), u = urmaritor()
    expect(await noua.porneste(AVIZ, { ...u, genereaza: async () => ({ ok: true, fisier: 'f.pdf', nrLinii: 1 }) })).toBe('gata')
  })
})

describe('mesajRezultatPv', () => {
  it('succes / refuz / anulat', () => {
    expect(mesajRezultatPv({ ok: true, fisier: 'AVZ-PV.pdf', nrLinii: 1 })).toEqual({ text: '✓ AVZ-PV.pdf descărcat (1 bun)', tip: undefined })
    expect(mesajRezultatPv({ ok: true, fisier: 'AVZ-PV.pdf', nrLinii: 3 }).text).toBe('✓ AVZ-PV.pdf descărcat (3 bunuri)')
    expect(mesajRezultatPv({ ok: false, mesaj: 'Transport negăsit' })).toEqual({ text: 'Transport negăsit', tip: 'warn' })
    expect(mesajRezultatPv({ ok: false, anulat: true })).toBe(null)
    expect(mesajRezultatPv(null)).toBe(null)
  })
})

// ── genereazaPvPredareAviz cu unelte false (fără browser): unde se oprește când esteCurent devine fals ──
function dbBun() {
  const rez = {
    logistica_transporturi: { data: { id: 't1', continut_multiplu: false, tip: 'materiale', continut_descriere: 'ciment' }, error: null },
    logistica_setari: { data: [], error: null },
  }
  return {
    from(t) {
      const q = { select: () => q, eq: () => q, in: () => q, order: () => q, maybeSingle: () => Promise.resolve(rez[t]), then: (a, b) => Promise.resolve(rez[t]).then(a, b) }
      return q
    },
  }
}

function unelteFalse(pasi) {
  const element = (tip) => ({
    tip, style: {}, innerHTML: '', firstElementChild: { tip: 'radacina' }, width: 0, height: 0,
    getContext: () => ({ drawImage: () => pasi.push('desen') }), toDataURL: () => 'data:image/jpeg;base64,AA',
  })
  class PdfFals {
    addPage() { pasi.push('pagina') }
    addImage() { pasi.push('imagine') }
    save(f) { pasi.push('save:' + f) }
  }
  return {
    document: { createElement: element, body: { appendChild: () => pasi.push('montat'), removeChild: () => pasi.push('demontat') } },
    requestAnimationFrame: (f) => { pasi.push('cadru'); f() },
    html2canvas: async () => { pasi.push('captura'); return { width: 1476, height: 800 } },
    jsPDF: PdfFals,
  }
}

describe('genereazaPvPredareAviz — verificările de generație (L24)', () => {
  it('cazul bun: montare → 2 cadre → captură → demontare → imagine → save', async () => {
    const pasi = []
    const r = await genereazaPvPredareAviz({ supabase: dbBun(), aviz: AVIZ, unelte: unelteFalse(pasi) })
    expect(r).toEqual({ ok: true, fisier: 'AVZ-2026-0042-PV.pdf', nrLinii: 1 })
    expect(pasi).toEqual(['montat', 'cadru', 'cadru', 'captura', 'demontat', 'desen', 'imagine', 'save:AVZ-2026-0042-PV.pdf'])
  })

  // esteCurent devine fals după al N-lea apel: fiecare punct de verificare oprește generarea înaintea efectului următor.
  const cazuri = [
    { dupa: 0, ultimulPas: undefined, nume: 'după citiri (nimic montat)' },
    { dupa: 1, ultimulPas: 'demontat', nume: 'înainte de captură' },
    { dupa: 2, ultimulPas: 'demontat', nume: 'după captură (fără PDF)' },
    { dupa: 3, ultimulPas: 'imagine', nume: 'înainte de descărcare' },
  ]
  for (const c of cazuri) {
    it(`NEGATIV: ecran închis ${c.nume} → anulat, fără save`, async () => {
      const pasi = []
      let apeluri = 0
      const esteCurent = () => apeluri++ < c.dupa
      const r = await genereazaPvPredareAviz({ supabase: dbBun(), aviz: AVIZ, esteCurent, unelte: unelteFalse(pasi) })
      expect(r).toEqual({ ok: false, anulat: true })
      expect(pasi.some(p => p.startsWith('save'))).toBe(false)
      expect(pasi[pasi.length - 1]).toBe(c.ultimulPas)
      if (c.dupa <= 1) expect(pasi).not.toContain('captura')
      // gazda montată se scoate mereu din pagină
      expect(pasi.filter(p => p === 'montat').length).toBe(pasi.filter(p => p === 'demontat').length)
      expect(apeluri).toBe(c.dupa + 1)
    })
  }

  it('refuzul din citiri rămâne refuz (nu anulat) când ecranul e deschis', async () => {
    const pasi = []
    const r = await genereazaPvPredareAviz({ supabase: dbBun(), aviz: { ...AVIZ, transport_id: null }, unelte: unelteFalse(pasi) })
    expect(r.ok).toBe(false)
    expect(r.anulat).toBeUndefined()
    expect(pasi).toEqual([])
  })
})

describe('legătura din ecranul „Arhivă avize” (Logistica.jsx)', () => {
  const src = readFileSync(new URL('./Logistica.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const i0 = src.indexOf('function ArhivaAvizePage(')
  const corp = src.slice(i0, src.indexOf('\nfunction ', i0 + 10))

  it('acțiunea se creează la montare și se oprește la demontare; generatorul primește esteCurent', () => {
    expect(i0).toBeGreaterThan(0)
    expect(corp).toMatch(/useEffect\(\(\) => \{\n\s+const a = creeazaActiunePv\(\)\n\s+pvActiune\.current = a\n\s+return \(\) => \{ a\.opreste\(\);/)
    expect(corp).toMatch(/genereazaPvPredareAviz\(\{ supabase, aviz, esteCurent \}\)/)
    expect(corp).toMatch(/if \(!esteCurent\(\)\) return \{ ok: false, anulat: true \}/)
    expect(corp).toContain('const m = mesajRezultatPv(r)')
    expect(corp).not.toContain('pvBusy')
  })
})
