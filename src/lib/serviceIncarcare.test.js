import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { incarcaFiseService, ordineListaFise, scadenteDeschisePeActiv, urmServiceLevel } from './service.js'
import { textSursaValoriiActiv } from './citiriBord.js'
import { TRANSPORTURI_INSTABILE } from './logisticaTransporturi.js'

// TKT-2026-0380 r3 (Jakarinos #1070 r2): lista fișelor din tabul Service se citește COMPLET, prin
// funcția reală de încărcare, pe un server fals care TAIE orice răspuns la 1.000 de rânduri (max-rows
// PostgREST), cu numărare exactă / head ca PostgREST. Așteptările sunt scrise de mână (L25).
function serverFals(randuri, { maxRows = 1000, laCerere = null } = {}) {
  const cereri = []
  const tabel = () => {
    const st = { cols: null, opts: {}, filtre: [], order: [], limit: null }
    const b = {
      select(cols, opts = {}) { st.cols = cols; st.opts = opts; return b },
      gt(c, v) { st.filtre.push(r => r[c] != null && r[c] > v); return b },
      order(c, o) { st.order.push([c, o?.ascending !== false, o?.nullsFirst]); return b },
      limit(n) { st.limit = n; return b },
      then(ok, ko) { return Promise.resolve().then(() => raspunde(st)).then(ok, ko) },
    }
    return b
  }
  const raspunde = st => {
    const nr = cereri.push(st) - 1
    const h = laCerere && laCerere(st, nr, randuri)
    if (h && h.error) return { data: null, error: h.error, count: null }
    const sursa = h && h.randuri ? h.randuri : randuri
    let rez = sursa.filter(r => st.filtre.every(f => f(r)))
    const count = st.opts.count === 'exact' ? rez.length : null
    if (st.opts.head) return { data: null, error: null, count }
    for (const [c, asc, nf] of [...st.order].reverse()) {
      rez = [...rez].sort((a, b) => {
        const x = a[c], y = b[c]
        if (x == null || y == null) { if (x == null && y == null) return 0; return (x == null) === !!nf ? -1 : 1 }
        return (x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1)
      })
    }
    return { data: rez.slice(0, Math.min(st.limit ?? Infinity, maxRows)), error: null, count }
  }
  return { tabel, cereri }
}

// Scenariul din review: utilajul 9 are o fișă VECHE (2025) cu revizie la 2.250 h, finalizată, și o
// reparație programată recent (scadență 5.000 h, care nu închide revizia). Live: 4.000 h → depășit.
// Peste ele, 1.050 de fișe mai noi pe alte utilaje, fără scadențe: fișa veche cade după primele 1.000.
const AZI = '2026-11-12'
const VECHE = { id: 1, activ_id: 9, data_fisei: '2025-01-01', status: 'finalizat', tip: 'mentenanta', urmatoarea_ore: 2250, ore_iesire: 2000 }
const RECENTA = { id: 2000, activ_id: 9, data_fisei: '2026-11-10', status: 'programat', tip: 'reparatie', urmatoarea_ore: 5000 }
function setFise() {
  const r = [VECHE]
  for (let i = 0; i < 1050; i++) r.push({ id: 10 + i, activ_id: 100 + (i % 40), data_fisei: `2026-${String(1 + (i % 10)).padStart(2, '0')}-15`, status: 'finalizat', tip: 'reparatie' })
  r.push({ id: 1500, activ_id: 101, data_fisei: null, status: 'programat', tip: 'reparatie' })   // fără dată
  r.push(RECENTA)
  return r
}
const KM = { 9: { ore_live: 4000 } }

describe('incarcaFiseService — lista din care se calculează KPI-ul „Scadențe”', () => {
  it('vechea citire (un singur SELECT) pe același server pierde fișa veche → utilajul ar apărea „ok”', async () => {
    const s = serverFals(setFise())
    const { data } = await s.tabel().select('*').order('data_fisei', { ascending: false, nullsFirst: false }).order('id', { ascending: false })
    assert.equal(data.length, 1000)
    assert.equal(data.some(f => f.id === 1), false)
    assert.equal(urmServiceLevel(scadenteDeschisePeActiv(data, KM, { azi: AZI })[9].u), 'ok')
  })

  it('citirea completă aduce toate cele 1.053 de fișe → utilajul 9 rămâne „depășit”', async () => {
    const s = serverFals(setFise())
    const fise = await incarcaFiseService(s.tabel)
    assert.equal(fise.length, 1053)
    assert.ok(fise.some(f => f.id === 1))
    const d = scadenteDeschisePeActiv(fise, KM, { azi: AZI })
    assert.equal(urmServiceLevel(d[9].u), 'depasit')
    assert.equal(d[9].fisa.id, 1)
    // cel puțin două pagini + numărarea finală, toate pe select-ul complet (head doar pe id)
    assert.ok(s.cereri.length >= 3)
    assert.ok(s.cereri.filter(c => !c.opts.head).every(c => c.cols.includes('logistica_service_intrari(id)')))
    assert.ok(s.cereri.some(c => c.opts.head && c.cols === 'id'))
  })

  it('ordinea afișată e cea de dinainte: data desc (fără dată la final), apoi id desc', async () => {
    const fise = await incarcaFiseService(serverFals(setFise()).tabel)
    assert.equal(fise[0].id, 2000)
    assert.equal(fise[fise.length - 2].id, 1)
    assert.equal(fise[fise.length - 1].id, 1500)
    const asteptat = [...setFise()].sort((a, b) => ordineListaFise(a, b))
    assert.deepEqual(fise.map(f => f.id), asteptat.map(f => f.id))
  })

  it('o eroare pe pagina a doua = EROARE, nu o listă parțială', async () => {
    const s = serverFals(setFise(), { laCerere: (st, nr) => (nr === 1 ? { error: { message: 'timeout simulat' } } : null) })
    // eroarea Supabase (obiect cu message) ajunge la apelant; ServiceTab afișează .message
    await assert.rejects(incarcaFiseService(s.tabel), e => e?.message === 'timeout simulat')
  })

  it('numărul se schimbă la fiecare trecere → eroare de instabilitate cu text despre fișe', async () => {
    const baza = setFise()
    let extra = 0
    const s = serverFals(baza, {
      laCerere: st => (st.opts.head ? { randuri: [...baza, ...Array.from({ length: ++extra }, (_, i) => ({ id: 5000 + i, activ_id: 1, data_fisei: AZI }))] } : null),
    })
    await assert.rejects(incarcaFiseService(s.tabel), e => e.code === TRANSPORTURI_INSTABILE && /^Fișele de service s-au modificat/.test(e.message))
  })

  it('serverul fără număr confirmat → eroare (nu „Toate la zi”)', async () => {
    const s = serverFals(setFise(), { laCerere: () => ({ randuri: null }) })
    const t = () => { const b = s.tabel(); const sel = b.select; b.select = (c, o = {}) => sel(c, { ...o, count: undefined }); return b }
    await assert.rejects(incarcaFiseService(t), /numărul total de fișe de service/)
  })
})

describe('textSursaValoriiActiv — formularul de alimentare din Logistică (r3, P2)', () => {
  const surse = (erori = []) => ({ km: [{ sursa: 'alimentare', id: 77, data: '2026-10-03', val: 569786 }, { sursa: 'manual', id: null, data: null, val: 600000 }], ore: [], erori })
  it('toate sursele citite, niciun rând egal → scrisă direct pe activ', () => {
    assert.equal(textSursaValoriiActiv(600000, surse(), 'km'), 'a fost scrisă direct pe fișa activului (ajustare manuală sau import)')
  })
  it('citirea fișelor a eșuat, niciun rând egal → sursa nu a putut fi stabilită (NU „scrisă direct”)', () => {
    const t = textSursaValoriiActiv(600000, surse(['fișe de service: eroare simulată']), 'km')
    assert.match(t, /sursa nu a putut fi stabilită/)
    assert.match(t, /fișe de service: eroare simulată|569\.786 km/)
    assert.doesNotMatch(t, /scrisă direct/)
  })
  it('o sursă a eșuat, dar o alimentare are exact valoarea → vine din alimentare', () => {
    assert.match(textSursaValoriiActiv(569786, surse(['telemetrie: eroare']), 'km'), /^vine din /)
  })
  it('încă necitite → se caută', () => {
    assert.equal(textSursaValoriiActiv(600000, null, 'km'), '— se caută sursa…')
  })
})
