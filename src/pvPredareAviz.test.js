import { describe, it, expect } from 'vitest'
import {
  COLOANE_PV, esc, dataRo, verificaColoane, liniiPvDinTransport, incarcaDatePv, construiesteHtmlPv, numeFisierPv,
} from './pvPredareAviz.js'

// Date sintetice (nu sunt date reale). Valorile așteptate sunt scrise de mână, nu calculate din codul testat (L25).
const AVIZ = {
  id: 'a1', transport_id: 't1', numar_aviz: 'AVZ-2026-0042', numar_transport: 'TRP-2026-0042', data_transport: '2026-11-19',
  plecare_text: 'Sediu Ploiești', destinatie_text: 'Șantier TEST', manager_plecare_nume: 'POPESCU ION',
  manager_destinatie_nume: 'IONESCU MARIA', sofer_nume: 'GEORGESCU DAN',
}
const LINII = [
  { denumire: 'Excavator Alfa X1', tipText: 'Utilaj', observatii: '', identificare: ['Nr. inventar: INV-7', 'Cod intern: EX-01'], cantitate: '1 buc' },
  { denumire: 'Țeavă PE 110', tipText: 'Marfă', observatii: 'colac', identificare: [], cantitate: '120 m' },
  { denumire: 'Generator Beta', tipText: 'Utilaj', observatii: '', identificare: ['Serie: SN-99'], cantitate: '1 buc' },
]

const procente = (html) => [...html.matchAll(/<col data-col="[^"]+" style="width:([^"]*)">/g)].map(m => m[1])
const nrLinii = (html) => (html.match(/<tr data-pv-linie="/g) || []).length

describe('construiesteHtmlPv', () => {
  const html = construiesteHtmlPv({ aviz: AVIZ, linii: LINII, firma: { firma_nume: 'GAZPET INSTAL SRL', firma_cui: 'RO123' }, dataPv: '2026-11-19' })

  it('conține numărul avizului, numărul PV-ului, data și titlul cerut', () => {
    expect(html).toContain('Proces-verbal de predare-primire nr. AVZ-2026-0042-PV din 19.11.2026')
    expect(html).toContain('avizul de însoțire a mărfii nr. <strong>AVZ-2026-0042</strong> din 19.11.2026')
    expect(html).toContain('TRP-2026-0042')
    expect(html).toContain('Sediu Ploiești')
    expect(html).toContain('Șantier TEST')
    expect(html).toContain('GAZPET INSTAL SRL')
  })

  it('predatorul și primitorul sunt precompletați în text și în blocurile de semnătură', () => {
    expect(html.split('POPESCU ION').length - 1).toBe(2)
    expect(html.split('IONESCU MARIA').length - 1).toBe(2)
    expect(html).toContain('Am predat')
    expect(html).toContain('Am primit')
    expect(html).toContain('GEORGESCU DAN')
  })

  it('toate liniile de conținut apar, în ordine, cu identificare și cantitate', () => {
    expect(nrLinii(html)).toBe(3)
    const i1 = html.indexOf('Excavator Alfa X1'), i2 = html.indexOf('Țeavă PE 110'), i3 = html.indexOf('Generator Beta')
    expect(i1).toBeGreaterThan(0)
    expect(i2).toBeGreaterThan(i1)
    expect(i3).toBeGreaterThan(i2)
    expect(html).toContain('Nr. inventar: INV-7')
    expect(html).toContain('Cod intern: EX-01')
    expect(html).toContain('Serie: SN-99')
    expect(html).toContain('120 m')
    expect(html).toContain('<tr data-pv-linie="3">')
  })

  it('lățimile coloanelor sunt în procente și dau exact 100', () => {
    const p = procente(html)
    expect(p).toEqual(['6%', '34%', '28%', '12%', '20%'])
    expect(p.every(x => /^\d+(\.\d+)?%$/.test(x))).toBe(true)
    expect(p.reduce((s, x) => s + Number(x.slice(0, -1)), 0)).toBe(100)
    expect(html).not.toMatch(/<col[^>]*px/)
    expect(html).toContain('width:738px')
  })

  it('antetul tabelului are stilurile fixate explicit (regula globală th din App.jsx nu-l schimbă)', () => {
    const ths = [...html.matchAll(/<th style="([^"]*)">/g)].map(m => m[1])
    expect(ths.length).toBe(5)
    for (const s of ths) {
      expect(s).toContain('text-transform:none')
      expect(s).toContain('color:#111827')
      expect(s).toContain('letter-spacing:normal')
      expect(s).toContain('padding:')
      expect(s).toContain('border:')
    }
  })

  it('coloana „Stare la predare” e goală, de completat', () => {
    expect(html).toContain('Stare la predare')
    expect((html.match(/text-align:left">&nbsp;<\/td>/g) || []).length).toBe(3)
  })

  it('fără mențiuni de AI / generare automată', () => {
    expect(html).not.toMatch(/\bAI\b|Claude|Rocky|generat automat|PontajPRO/i)
  })

  it('escape la text: nume cu < și & nu devin HTML', () => {
    const h = construiesteHtmlPv({
      aviz: { ...AVIZ, manager_plecare_nume: 'Ion <b>& Co', destinatie_text: '<script>x</script>' },
      linii: [{ denumire: 'A & B <i>', identificare: ['Cod intern: <x>'], cantitate: '1 buc' }],
      dataPv: '2026-11-19',
    })
    expect(h).toContain('Ion &lt;b&gt;&amp; Co')
    expect(h).toContain('&lt;script&gt;x&lt;/script&gt;')
    expect(h).toContain('A &amp; B &lt;i&gt;')
    expect(h).toContain('Cod intern: &lt;x&gt;')
    expect(h).not.toContain('<b>&')
    expect(h).not.toContain('<script>')
    expect(h).not.toContain('<i>')
  })

  it('nume lipsă → loc de completat, nu „undefined”', () => {
    const h = construiesteHtmlPv({ aviz: { numar_aviz: 'AVZ-1' }, linii: LINII.slice(0, 1), dataPv: '2026-01-05' })
    expect(h).not.toMatch(/undefined|null/)
    expect(h).toContain('……………')
    expect(h).toContain('AVZ-1-PV din 05.01.2026')
  })

  it('NEGATIV: fără linii nu se construiește nimic (niciun PDF gol)', () => {
    expect(() => construiesteHtmlPv({ aviz: AVIZ, linii: [], dataPv: '2026-11-19' })).toThrow(/nu există bunuri/)
    expect(() => construiesteHtmlPv({ aviz: AVIZ, linii: null, dataPv: '2026-11-19' })).toThrow()
  })
})

describe('verificaColoane', () => {
  it('coloanele livrate dau 100', () => {
    expect(verificaColoane(COLOANE_PV)).toBe(true)
    expect(COLOANE_PV.map(c => c.latime)).toEqual([6, 34, 28, 12, 20])
  })
  it('NEGATIV: sumă ≠ 100 sau lățime invalidă = refuz', () => {
    const strica = (i, v) => COLOANE_PV.map((c, j) => (j === i ? { ...c, latime: v } : c))
    expect(() => verificaColoane(strica(1, 33))).toThrow(/99%/)
    expect(() => verificaColoane(strica(4, 21))).toThrow(/101%/)
    expect(() => verificaColoane(strica(0, 0))).toThrow(/invalidă/)
    expect(() => verificaColoane(strica(0, NaN))).toThrow(/invalidă/)
    expect(() => verificaColoane([])).toThrow()
  })
})

describe('liniiPvDinTransport (aceeași regulă ca avizul)', () => {
  const asset = { cod_intern: 'EX-01', nr_inventar: 'INV-7', marca: 'Alfa', model: 'X1', nr_inmatriculare: 'PH-01-ABC', serie_sasiu: 'VIN123' }

  it('conținut multiplu → o linie pe fiecare rând, utilaje cu identificare, marfă cu cantitate + UM', () => {
    const L = liniiPvDinTransport({ continut_multiplu: true, tip: 'utilaj' }, [
      { tip: 'utilaj', asset },
      { tip: 'marfa', denumire: 'Țeavă PE 110', cantitate: 120.5, um: 'm', observatii: 'colac' },
      { tip: 'marfa', denumire: 'Robinet DN50', cantitate: '4', um: 'buc' },
    ])
    expect(L.length).toBe(3)
    expect(L[0]).toMatchObject({ denumire: 'Alfa X1', cantitate: '1 buc', tipText: 'Utilaj', regimSpecial: false })
    expect(L[0].identificare).toEqual(['Nr. inventar: INV-7', 'Cod intern: EX-01', 'Nr. înmatr.: PH-01-ABC', 'Serie șasiu: VIN123'])
    expect(L[1]).toMatchObject({ denumire: 'Țeavă PE 110', cantitate: '120,5 m', observatii: 'colac', tipText: 'Marfă' })
    expect(L[2]).toMatchObject({ denumire: 'Robinet DN50', cantitate: '4 buc' })
  })

  it('fără conținut multiplu → activul de pe transport (etichetele formei simple din aviz)', () => {
    const L = liniiPvDinTransport({ continut_multiplu: false, tip: 'utilaj', activ_transportat: asset }, [])
    expect(L).toEqual([{ denumire: 'Alfa X1', tipText: 'Utilaj', regimSpecial: false, observatii: '', identificare: ['Nr. inventar: INV-7', 'Cod intern: EX-01', 'Nr. înmatriculare: PH-01-ABC', 'Serie șasiu: VIN123'], cantitate: '1 buc' }])
  })

  it('multiplu fără rânduri → cade pe activul / descrierea transportului, ca avizul', () => {
    expect(liniiPvDinTransport({ continut_multiplu: true, tip: 'utilaj', activ_transportat: asset }, [])[0].denumire).toBe('Alfa X1')
    expect(liniiPvDinTransport({ continut_multiplu: false, tip: 'materiale', continut_descriere: '10 saci ciment' }, [])[0])
      .toEqual({ denumire: '10 saci ciment', tipText: '', regimSpecial: false, observatii: '', identificare: [], cantitate: '' })
  })

  it('utilaj fără marcă / model → „—” în PV (avizul lasă celula albă), identificarea rămâne', () => {
    const L = liniiPvDinTransport({ continut_multiplu: true }, [{ tip: 'utilaj', asset: { cod_intern: 'EX-09' } }])
    expect(L).toEqual([{ denumire: '—', tipText: 'Utilaj', regimSpecial: false, observatii: '', identificare: ['Cod intern: EX-09'], cantitate: '1 buc' }])
  })

  it('NEGATIV: nimic de predat → listă goală (PV-ul nu se generează)', () => {
    expect(liniiPvDinTransport({ tip: 'materiale', continut_descriere: '   ' }, [])).toEqual([])
    expect(liniiPvDinTransport({ tip: 'utilaj', activ_transportat: null }, [])).toEqual([])
    expect(liniiPvDinTransport({ continut_multiplu: true, tip: 'materiale', continut_descriere: '' }, [])).toEqual([])
    expect(liniiPvDinTransport(null, null)).toEqual([])
  })

  it('regim de transport special → marcat în PV', () => {
    const L = liniiPvDinTransport({ tip: 'utilaj', activ_transportat: { ...asset, regim_transport_special: true } }, [])
    expect(L[0].regimSpecial).toBe(true)
    const h = construiesteHtmlPv({ aviz: AVIZ, linii: L, dataPv: '2026-11-19' })
    expect(h).toContain('REGIM TRANSPORT SPECIAL')
    expect(construiesteHtmlPv({ aviz: AVIZ, linii: LINII, dataPv: '2026-11-19' })).not.toContain('REGIM TRANSPORT SPECIAL')
  })
})

// Client Supabase fals: fiecare tabel întoarce rezultatul configurat; se notează cererile.
function dbFals(rez) {
  const cereri = []
  return {
    cereri,
    from(tabel) {
      const c = { tabel, pasi: [] }
      cereri.push(c)
      const q = {
        select(...a) { c.pasi.push(['select', ...a]); return q },
        eq(...a) { c.pasi.push(['eq', ...a]); return q },
        in(...a) { c.pasi.push(['in', ...a]); return q },
        order(...a) { c.pasi.push(['order', ...a]); return q },
        maybeSingle() { c.pasi.push(['maybeSingle']); return Promise.resolve(rez[tabel]) },
        then(ok, ko) { return Promise.resolve(rez[tabel]).then(ok, ko) },
      }
      return q
    },
  }
}

describe('incarcaDatePv', () => {
  const firma = { data: [{ key: 'firma_nume', value: 'GAZPET INSTAL SRL' }], error: null }

  it('aviz fără transport_id → mesaj clar, nicio citire', async () => {
    const db = dbFals({})
    const r = await incarcaDatePv(db, { numar_aviz: 'AVZ-1', transport_id: null })
    expect(r.ok).toBe(false)
    expect(r.mesaj).toMatch(/nu are un transport legat/)
    expect(db.cereri.length).toBe(0)
  })

  it('transport negăsit → mesaj clar, fără PDF', async () => {
    const r = await incarcaDatePv(dbFals({ logistica_transporturi: { data: null, error: null } }), AVIZ)
    expect(r).toEqual({ ok: false, mesaj: 'Transportul avizului AVZ-2026-0042 nu se mai găsește (poate a fost șters) — PV-ul nu se poate genera.' })
  })

  it('eroare la citire ≠ transport lipsă (L18)', async () => {
    const r = await incarcaDatePv(dbFals({ logistica_transporturi: { data: null, error: { message: 'timeout' } } }), AVIZ)
    expect(r.ok).toBe(false)
    expect(r.mesaj).toBe('Nu am putut citi transportul avizului: timeout')
  })

  it('conținut citit incomplet (count ≠ rânduri) → refuz, nu PV parțial', async () => {
    const r = await incarcaDatePv(dbFals({
      logistica_transporturi: { data: { id: 't1', continut_multiplu: true, tip: 'utilaj' }, error: null },
      logistica_transporturi_continut: { data: [{ tip: 'marfa', denumire: 'X', cantitate: 1 }], count: 2, error: null },
      logistica_setari: firma,
    }), AVIZ)
    expect(r.ok).toBe(false)
    expect(r.mesaj).toMatch(/are 2 rânduri, dar s-au citit 1/)
  })

  it('eroare la conținut → refuz', async () => {
    const r = await incarcaDatePv(dbFals({
      logistica_transporturi: { data: { id: 't1', continut_multiplu: true }, error: null },
      logistica_transporturi_continut: { data: null, error: { message: 'rls' } },
    }), AVIZ)
    expect(r).toEqual({ ok: false, mesaj: 'Nu am putut citi conținutul transportului: rls' })
  })

  it('transport fără niciun conținut → refuz (fără PDF gol)', async () => {
    const r = await incarcaDatePv(dbFals({
      logistica_transporturi: { data: { id: 't1', continut_multiplu: false, tip: 'materiale', continut_descriere: '' }, error: null },
      logistica_setari: firma,
    }), AVIZ)
    expect(r.ok).toBe(false)
    expect(r.mesaj).toMatch(/nu se generează gol/)
  })

  it('eroare la datele firmei → refuz', async () => {
    const r = await incarcaDatePv(dbFals({
      logistica_transporturi: { data: { id: 't1', continut_multiplu: false, tip: 'materiale', continut_descriere: 'ciment' }, error: null },
      logistica_setari: { data: null, error: { message: 'x' } },
    }), AVIZ)
    expect(r).toEqual({ ok: false, mesaj: 'Nu am putut citi datele firmei: x' })
  })

  it('cazul bun: citește transportul pe id-ul avizului, conținutul ordonat, firma pe chei', async () => {
    const db = dbFals({
      logistica_transporturi: { data: { id: 't1', continut_multiplu: true, tip: 'utilaj' }, error: null },
      logistica_transporturi_continut: { data: [{ tip: 'marfa', denumire: 'A', cantitate: 2, um: 'buc' }, { tip: 'marfa', denumire: 'B' }], count: 2, error: null },
      logistica_setari: firma,
    })
    const r = await incarcaDatePv(db, AVIZ)
    expect(r.ok).toBe(true)
    expect(r.linii.map(l => l.denumire)).toEqual(['A', 'B'])
    expect(r.firma).toEqual({ firma_nume: 'GAZPET INSTAL SRL' })
    expect(db.cereri[0].pasi).toContainEqual(['eq', 'id', 't1'])
    expect(db.cereri[1].pasi).toContainEqual(['eq', 'transport_id', 't1'])
    expect(db.cereri[1].pasi.filter(p => p[0] === 'order')).toEqual([['order', 'ordine'], ['order', 'id']])
    expect(db.cereri[1].pasi).toContainEqual(['select', '*, asset:logistica_active!active_id(id, cod_intern, nr_inventar, marca, model, nr_inmatriculare, serie_sasiu, regim_transport_special)', { count: 'exact' }])
    expect(db.cereri.map(c => c.tabel)).toEqual(['logistica_transporturi', 'logistica_transporturi_continut', 'logistica_setari'])
  })
})

describe('utilitare', () => {
  it('esc', () => { expect(esc(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;') })
  it('dataRo fără decalaj de fus orar', () => {
    expect(dataRo('2026-01-01')).toBe('01.01.2026')
    expect(dataRo('2026-12-31T23:30:00+00:00')).toBe('31.12.2026')
    expect(dataRo('')).toBe('')
    expect(dataRo(null)).toBe('')
  })
  it('numele fișierului', () => {
    expect(numeFisierPv(AVIZ)).toBe('AVZ-2026-0042-PV.pdf')
    expect(numeFisierPv({ numar_aviz: 'AVZ 1/2' })).toBe('AVZ_1_2-PV.pdf')
    expect(numeFisierPv({})).toBe('aviz-PV.pdf')
  })
})
