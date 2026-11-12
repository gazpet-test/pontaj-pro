import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import {
  PRAG_CITIRI, SALT_KM, MAX_ORE, referintaIndependenta, verificaCitire, verificaCitiriAlimentare,
  sursaValoriiMari, descrieSursa, textConfirmareCitiri, confirmaCitiriAlimentari, incarcaCitiriActive,
  sursaCareTineSus, confirmaAjustareManuala, incarcaSurseMaxime, stabilesteSursa, textSursa,
} from './citiriBord.js'
import {
  calcUrmService, urmServiceLevel, urmServiceColor, urmServiceBadgeText, citireFisa, citireNeverosimila,
  acopeririScadente, scadenteDeschisePeActiv, areCitireDeVerificat,
} from './service.js'

// TKT-2026-0380. Cazurile sunt cele reale (fără nume), cu așteptările scrise de mână (L25):
//  - autoturism: 569.786 km dintr-o alimentare, service și telemetrie ~371.000;
//  - autoturism: 510.205 din alimentări față de ~288.000;
//  - motocompresor: 19.516 ore dintr-o alimentare față de ~2.400;
//  - motocompresor: 12.229 față de 1.222 (o cifră în plus).
const F = (id, data, val) => ({ sursa: 'fisa', id, data, val })
const A = (id, data, val) => ({ sursa: 'alimentare', id, data, val })
const M = val => ({ sursa: 'manual', id: null, data: null, val })

describe('referintaIndependenta', () => {
  it('mediana inferioară a ultimelor fișe + alimentări: o alimentare greșită nu mută referința', () => {
    const r = referintaIndependenta([F(1, '2026-08-12', 370900), A(10, '2026-10-01', 371200), A(11, '2026-10-08', 371500), A(12, '2026-10-15', 569786)], '2026-10-20', PRAG_CITIRI.km.plafon)
    // ordonat: 370.900 · 371.200 · 371.500 · 569.786 → mediana inferioară = 371.200 (alimentarea #10)
    assert.deepEqual(r, { val: 371200, sursa: 'alimentare', data: '2026-10-01', id: 10 })
  })
  it('două citiri, una greșită în sus: rămâne cea corectă', () => {
    const r = referintaIndependenta([A(10, '2026-10-01', 371200), A(11, '2026-10-15', 569786)], '2026-10-20', PRAG_CITIRI.km.plafon)
    assert.equal(r.val, 371200)
  })
  it('ignoră citirile de după data verificată, peste plafon, zero sau goale', () => {
    const r = referintaIndependenta([F(1, '2026-11-01', 400000), F(2, '2026-08-01', 2000000), A(3, '2026-09-01', 0), A(4, '2026-09-02', ''), A(5, '2026-09-03', 288000)], '2026-10-01', PRAG_CITIRI.km.plafon)
    assert.deepEqual(r, { val: 288000, sursa: 'alimentare', data: '2026-09-03', id: 5 })
  })
  it('fără nimic datat: valoarea manuală; fără nimic: null', () => {
    assert.deepEqual(referintaIndependenta([M(2400)], '2026-10-01', MAX_ORE), { val: 2400, sursa: 'manual', data: null, id: null })
    assert.equal(referintaIndependenta([], '2026-10-01', MAX_ORE), null)
    assert.equal(referintaIndependenta(null, '2026-10-01', MAX_ORE), null)
  })
})

describe('verificaCitiriAlimentare — cazurile reale', () => {
  const istoricKm = { km: [F(1, '2026-08-12', 370900), A(10, '2026-10-01', 371200)], ore: [] }
  it('569.786 km față de ~371.000: salt imposibil, cu sursa referinței', () => {
    const m = verificaCitiriAlimentare({ data_alimentare: '2026-10-20', km_la_alimentare: 569786 }, istoricKm)
    assert.equal(m.length, 1)
    // referința = mediana inferioară (370.900 fișa #1, 371.200 alimentarea #10) = fișa #1
    assert.match(m[0], /^Km la alimentare: 569\.786 km — cu 198\.886 km peste ultima valoare cunoscută \(370\.900, din fișa de service #1 din 12\.08\.2026\)$/)
  })
  it('510.205 față de ~288.000: salt imposibil', () => {
    const m = verificaCitiriAlimentare({ data_alimentare: '2026-10-20', km_la_alimentare: 510205 }, { km: [F(2, '2026-09-01', 288000)] })
    assert.equal(m.length, 1)
    assert.match(m[0], /peste ultima valoare cunoscută \(288\.000, din fișa de service #2 din 01\.09\.2026\)/)
  })
  it('19.516 ore față de ~2.400 și 12.229 față de 1.222: salt imposibil la ore', () => {
    const a = verificaCitiriAlimentare({ data_alimentare: '2026-10-20', ore_la_alimentare: 19516 }, { ore: [F(3, '2026-09-01', 2400)] })
    const b = verificaCitiriAlimentare({ data_alimentare: '2026-10-20', ore_la_alimentare: 12229 }, { ore: [A(4, '2026-10-10', 1222)] })
    assert.equal(a.length, 1); assert.match(a[0], /^Ore bord la alimentare: 19\.516 h — cu 17\.116 h peste/)
    assert.equal(b.length, 1); assert.match(b[0], /^Ore bord la alimentare: 12\.229 h — cu 11\.007 h peste/)
  })
  it('citire normală: nicio problemă', () => {
    assert.deepEqual(verificaCitiriAlimentare({ data_alimentare: '2026-10-20', km_la_alimentare: 372500 }, istoricKm), [])
    assert.deepEqual(verificaCitiriAlimentare({ data_alimentare: '2026-10-20', ore_la_alimentare: 1240 }, { ore: [A(4, '2026-10-10', 1222)] }), [])
  })
  it('corectarea unei cifre greșite NU e semnalată ca regres (rândul editat nu e în referință)', () => {
    // la editare apelantul exclude rândul; restul istoricului e cel corect
    assert.deepEqual(verificaCitiriAlimentare({ data_alimentare: '2026-10-15', km_la_alimentare: 371900 }, istoricKm), [])
  })
  it('regres mare: semnalat (contor înlocuit sau cifră lipsă)', () => {
    const m = verificaCitiriAlimentare({ data_alimentare: '2026-10-20', km_la_alimentare: 37120 }, istoricKm)
    assert.match(m[0], /SUB ultima valoare cunoscută \(370\.900, din fișa de service #1 din 12\.08\.2026\); contorul a fost înlocuit\?$/)
  })
  it('creștere imposibilă în zilele scurse, chiar sub saltul de 1.500 h', () => {
    // 1.222 → 2.122 h în 10 zile (de la 10.10 la 19.10 inclusiv): cel mult 240 h
    const m = verificaCitiriAlimentare({ data_alimentare: '2026-10-19', ore_la_alimentare: 2122 }, { ore: [A(4, '2026-10-10', 1222)] })
    assert.equal(m.length, 1)
    assert.match(m[0], /imposibil în 10 zile \(cel mult ~240 h\)$/)
  })
  it('peste plafonul absolut: semnalat chiar fără istoric', () => {
    const m = verificaCitiriAlimentare({ data_alimentare: '2026-10-20', ore_la_alimentare: 80506 }, { ore: [] })
    assert.match(m[0], /valoare imposibilă \(peste 50\.000 h\)/)
  })
  it('câmpuri goale / text: nu se verifică', () => {
    assert.deepEqual(verificaCitiriAlimentare({ data_alimentare: '2026-10-20', km_la_alimentare: '', ore_la_alimentare: null }, istoricKm), [])
    assert.deepEqual(verificaCitiriAlimentare({ data_alimentare: '2026-10-20', km_la_alimentare: 'abc' }, istoricKm), [])
  })
})

describe('verificaCitire cu referință număr = textele vechi din ServiceTab', () => {
  it('salt / regres / plafon', () => {
    assert.equal(verificaCitire('KM intrare', 500000, 300000, PRAG_CITIRI.km), 'KM intrare: 500.000 km — cu 200.000 km peste ultima valoare cunoscută (300.000)')
    assert.equal(verificaCitire('Ore ieșire', 1000, 4200, PRAG_CITIRI.ore), 'Ore ieșire: 1.000 h — SUB ultima valoare cunoscută (4.200); contorul a fost înlocuit?')
    assert.equal(verificaCitire('Ore intrare', 80506, null, PRAG_CITIRI.ore), 'Ore intrare: 80.506 h — valoare imposibilă (peste 50.000 h); citire de pe un contor defect?')
    assert.equal(verificaCitire('KM intrare', 300000 + SALT_KM, 300000, PRAG_CITIRI.km), null)  // exact pragul = OK
  })
})

describe('sursaValoriiMari — „de unde vine valoarea mare”', () => {
  const cand = [
    { sursa: 'alimentare', id: 77, data: '2026-10-03', val: 569786 },
    { sursa: 'fisa', id: 5, data: '2026-08-24', val: 371000 },
    { sursa: 'telemetrie', id: null, data: '2026-11-05', val: 431000 },
    { sursa: 'manual', id: null, data: null, val: 569786 },
  ]
  it('candidatul egal cu valoarea afișată; manualul doar dacă nimic altceva nu e egal', () => {
    const s = sursaValoriiMari(569786, cand)
    assert.equal(s.sursa, 'alimentare'); assert.equal(s.id, 77); assert.equal(s.exact, true)
    assert.equal(descrieSursa(s), 'alimentarea #77 din 03.10.2026')
    assert.equal(sursaValoriiMari(431000, cand).sursa, 'telemetrie')
  })
  it('niciun candidat egal: cel mai mare, marcat exact:false; fără date: null', () => {
    const s = sursaValoriiMari(600000, cand)
    assert.equal(s.exact, false); assert.equal(s.val, 569786)
    assert.equal(sursaValoriiMari(1, []), null)
    assert.equal(sursaValoriiMari(null, cand), null)
  })
})

describe('r2 P1-a: o depășire reală nu dispare; „citire de verificat” se adaugă (ritm, nu prag pe restanță)', () => {
  const AZI = '2026-11-11'
  const RED = '#F85149'
  it('cazul din verdict: fișă 01.01.2025 la 2.000 h, revizia la 2.250 h, azi 4.000 h → depășit 1.750 h, FĂRĂ etichetă', () => {
    const fisa = { id: 1, activ_id: 9, tip: 'mentenanta', status: 'finalizat', data_fisei: '2025-01-01', ore_iesire: 2000, urmatoarea_ore: 2250 }
    const u = calcUrmService(fisa, null, 4000, { azi: AZI })
    assert.equal(u.label, '1750 h depășite')
    assert.equal(urmServiceLevel(u), 'depasit')
    assert.equal(urmServiceColor(u), RED)
    assert.equal(u.deVerificat, undefined)
    assert.equal(areCitireDeVerificat(u), false)
    // KPI-ul și filtrul „Scadențe” îl văd
    const d = scadenteDeschisePeActiv([fisa], { 9: { km_live: null, ore_live: 4000 } }, { azi: AZI })
    assert.equal(d[9].fisa.id, 1)
    assert.equal(urmServiceLevel(d[9].u), 'depasit')
  })
  it('19.516 h față de ~2.400 (fișă din 01.09.2026) → rămâne depășit + „citire de verificat” cu fișa de referință', () => {
    const fisa = { id: 5, activ_id: 9, data_fisei: '2026-09-01', ore_iesire: 2400, urmatoarea_ore: 2650 }
    const u = calcUrmService(fisa, null, 19516, { azi: AZI })
    assert.equal(urmServiceLevel(u), 'depasit')
    assert.equal(u.label, '16866 h depășite')
    assert.equal(u.deVerificat, true)
    assert.equal(u.verificare.motiv, 'ritm')
    assert.deepEqual([u.verificare.ref.sursa, u.verificare.ref.id, u.verificare.ref.val], ['fisa', 5, 2400])
    assert.equal(u.verificare.zile, 72)                      // 01.09 → 11.11 inclusiv
    assert.equal(u.verificare.posibil, 72 * PRAG_CITIRI.ore.maxPeZi)
    assert.equal(urmServiceBadgeText(u), '⏱️ 16866 h depășite · 🔎 citire de verificat')
    const d = scadenteDeschisePeActiv([fisa], { 9: { ore_live: 19516 } }, { azi: AZI })
    assert.equal(urmServiceLevel(d[9].u), 'depasit')        // numărat la depășite
  })
  it('216.179 km depășiți (fișă 24.08.2026 la 338.607, azi 569.786) → depășit + de verificat', () => {
    const u = calcUrmService({ id: 2, data_fisei: '2026-08-24', km_iesire: 338607, urmatoarea_km: 353607 }, 569786, null, { azi: AZI })
    assert.equal(urmServiceLevel(u), 'depasit')
    assert.equal(u.depasire, 216179)
    assert.equal(u.deVerificat, true)
  })
  it('față de sursele independente: fișa veche permite creșterea, o alimentare recentă NU → etichetă cu alimentarea', () => {
    // fișă din 2023 la 2.000 h: în 1.411 zile se pot face ~33.864 h, deci 19.516 e posibil față de ea;
    // alimentarea #44 din 01.10.2026 are 2.400 h: în 42 de zile, cel mult ~1.008 h în plus
    const fisa = { id: 1, data_fisei: '2023-01-01', ore_iesire: 2000, urmatoarea_ore: 2250 }
    assert.equal(calcUrmService(fisa, null, 19516, { azi: AZI }).deVerificat, undefined)
    const ref = { ore: [A(44, '2026-10-01', 2400), { sursa: 'alimentare', id: 45, data: '2026-11-10', val: 19516 }], km: [] }
    const u = calcUrmService(fisa, null, 19516, { azi: AZI, referinte: ref })
    assert.equal(urmServiceLevel(u), 'depasit')
    assert.equal(u.deVerificat, true)
    assert.deepEqual([u.verificare.ref.sursa, u.verificare.ref.id], ['alimentare', 44])
  })
  it('telemetria, manualul și citirile cu dată după azi NU sunt referință; peste plafon → etichetă chiar fără referințe', () => {
    const refs = [{ sursa: 'telemetrie', data: '2026-11-10', val: 10 }, M(10), A(1, '2026-12-01', 10)]
    assert.equal(citireNeverosimila('km', 300000, refs, AZI), null)
    assert.equal(citireNeverosimila('ore', 52168, [], AZI).motiv, 'plafon')
    const u = calcUrmService({ urmatoarea_ore: 5000 }, null, 52168, { azi: AZI })
    assert.equal(urmServiceLevel(u), 'depasit')
    assert.equal(u.deVerificat, true)
  })
  it('nedepășit: nu se judecă citirea; depășit mic real: fără etichetă', () => {
    const f = { id: 3, data_fisei: '2026-11-10', ore_iesire: 100, urmatoarea_ore: 99999 }
    assert.equal(calcUrmService(f, null, 5000, { azi: AZI }).deVerificat, undefined)
    const u = calcUrmService({ data_fisei: '2026-09-01', ore_iesire: 2000, urmatoarea_ore: 2250 }, null, 2300, { azi: AZI })
    assert.equal(u.deVerificat, undefined)
    assert.equal(urmServiceLevel(u), 'depasit')
  })
  it('ordinea: o depășire uriașă cu etichetă rămâne cea mai urgentă (nu mai coboară sub cele neajunse)', () => {
    const u = calcUrmService({ data_fisei: '2026-08-24', km_iesire: 338607, urmatoarea_km: 353607, urmatoarea_ore: 100, urmatoarea_data: '2027-05-10' }, 569786, 120, { azi: AZI })
    assert.deepEqual(u.toate.map(t => t.tip), ['km', 'ore', 'data'])
    assert.equal(u.toate[0].deVerificat, true)
    assert.equal(areCitireDeVerificat(u), true)
  })
})

describe('r2 P1-b: o scadență veche e închisă DOAR de o mentenanță FINALIZATĂ pe aceeași dimensiune', () => {
  const AZI = '2026-11-11'
  const VECHE = { id: 1, activ_id: 9, tip: 'mentenanta', status: 'finalizat', data_fisei: '2025-01-01', ore_iesire: 2000, urmatoarea_ore: 2250 }
  const KMORE = { 9: { km_live: 50000, ore_live: 2600 } }
  const deschisa = (ulterioara) => {
    const fise = [VECHE, { activ_id: 9, id: 2, ...ulterioara }]
    const acop = acopeririScadente(fise, AZI)
    const d = scadenteDeschisePeActiv(fise, KMORE, { azi: AZI, acoperiri: acop })
    return { acop, d, u: calcUrmService(VECHE, 50000, 2600, { azi: AZI, acoperite: acop[1] }) }
  }
  it('reparație PROGRAMATĂ cu dată viitoare → restanța la ore rămâne (KPI + filtru o văd)', () => {
    const { acop, d, u } = deschisa({ tip: 'reparatie', status: 'programat', data_fisei: '2026-10-01', urmatoarea_data: '2027-03-01' })
    assert.equal(acop[1], undefined)
    assert.equal(u.label, '350 h depășite')
    assert.equal(d[9].fisa.id, 1)
    assert.equal(urmServiceLevel(d[9].u), 'depasit')
  })
  it('mentenanță ÎN LUCRU (sau programată) cu scadență nouă la ore → nu închide', () => {
    for (const status of ['in_lucru', 'programat']) {
      const { acop, d } = deschisa({ tip: 'mentenanta', status, data_fisei: '2026-10-01', ore_iesire: 2590, urmatoarea_ore: 2840 })
      assert.equal(acop[1], undefined, status)
      assert.equal(d[9].fisa.id, 1, status)
    }
  })
  it('reparație FINALIZATĂ cu scadență la ore → nu închide (doar mentenanța)', () => {
    assert.equal(deschisa({ tip: 'reparatie', status: 'finalizat', data_fisei: '2026-10-01', urmatoarea_ore: 2840 }).acop[1], undefined)
  })
  it('mentenanță finalizată care acoperă DOAR km, când restanța e la ore → restanța la ore rămâne', () => {
    const veche2 = { ...VECHE, urmatoarea_km: 40000 }
    const fise = [veche2, { id: 2, activ_id: 9, tip: 'mentenanta', status: 'finalizat', data_fisei: '2026-10-01', km_iesire: 49000, urmatoarea_km: 59000 }]
    const acop = acopeririScadente(fise, AZI)
    assert.deepEqual(Object.keys(acop[1]), ['km'])
    const u = calcUrmService(veche2, 50000, 2600, { azi: AZI, acoperite: acop[1] })
    assert.deepEqual(u.toate.map(t => t.tip), ['ore'])        // km închis, ore deschis
    assert.equal(urmServiceLevel(u), 'depasit')
    const d = scadenteDeschisePeActiv(fise, KMORE, { azi: AZI, acoperiri: acop })
    assert.equal(d[9].fisa.id, 1)
  })
  it('mentenanță FINALIZATĂ corectă (ore cu ore) → restanța veche e închisă; activul e judecat după fișa nouă', () => {
    const { acop, d, u } = deschisa({ tip: 'mentenanta', status: 'finalizat', data_fisei: '2026-10-01', ore_iesire: 2590, urmatoarea_ore: 2840 })
    assert.equal(acop[1].ore.id, 2)
    assert.equal(u, null)                                      // nimic deschis pe fișa veche
    assert.equal(d[9].fisa.id, 2)
    assert.equal(urmServiceLevel(d[9].u), 'ok')
  })
  it('mentenanță „finalizată” cu dată după azi sau fără dată → nu închide; aceeași zi: contează id-ul', () => {
    assert.equal(deschisa({ tip: 'mentenanta', status: 'finalizat', data_fisei: '2026-12-01', urmatoarea_ore: 2840 }).acop[1], undefined)
    assert.equal(deschisa({ tip: 'mentenanta', status: 'finalizat', data_fisei: null, urmatoarea_ore: 2840 }).acop[1], undefined)
    const a = { id: 4, activ_id: 8, tip: 'mentenanta', status: 'finalizat', data_fisei: '2026-05-01', urmatoarea_ore: 2500 }
    const b = { id: 5, activ_id: 8, tip: 'mentenanta', status: 'finalizat', data_fisei: '2026-05-01', urmatoarea_ore: 2600 }
    const acop = acopeririScadente([b, a], AZI)
    assert.equal(acop[4].ore.id, 5)
    assert.equal(acop[5], undefined)
  })
  it('activele „fără service Gazpet” sunt excluse din scadențele pe activ', () => {
    const d = scadenteDeschisePeActiv([VECHE], KMORE, { azi: AZI, exclude: id => id === 9 })
    assert.equal(d[9], undefined)
  })
})

describe('calcUrmService — utilitare', () => {
  it('citireFisa: cea mai mare dintre intrare/ieșire; lipsă = null', () => {
    assert.equal(citireFisa({ km_intrare: 10, km_iesire: 12 }, 'km'), 12)
    assert.equal(citireFisa({ ore_intrare: '7' }, 'ore'), 7)
    assert.equal(citireFisa({}, 'km'), null)
  })
})

// Client PostgREST simulat: înregistrează filtrele și aplică .in / .eq / .not is null / .gt / .gte /
// .order / .limit / .maybeSingle pe tabelele date.
// plafonServer = max-rows al PostgREST: orice răspuns se taie la atâtea rânduri, fără eroare.
function clientFals(tabele, { eroareLa = null, plafonServer = Infinity } = {}) {
  const cereri = []
  const from = tabel => {
    const f = { tabel, filtre: [], ordine: [], single: false }
    const q = {
      select: () => q,
      in: (c, v) => { f.filtre.push(r => v.map(Number).includes(Number(r[c]))); return q },
      eq: (c, v) => { f.filtre.push(r => Number(r[c]) === Number(v)); return q },
      not: (c, op, v) => { if (op === 'is' && v === null) f.filtre.push(r => r[c] != null); return q },
      gt: (c, v) => { f.filtre.push(r => r[c] > v); return q },
      gte: (c, v) => { f.filtre.push(r => r[c] >= v); return q },
      or: () => q,
      order: (c, o = {}) => { f.ordine.push([c, o.ascending === false ? -1 : 1]); return q },
      limit: n => { f.limit = n; return q },
      maybeSingle: () => { f.single = true; return q },
      then: (ok, ko) => {
        cereri.push(tabel)
        if (eroareLa === tabel) return Promise.resolve({ data: null, error: { message: 'eroare simulată' } }).then(ok, ko)
        const ord = f.ordine.length ? f.ordine : [['id', 1]]
        const cmp = (a, b) => { for (const [c, d] of ord) { if (a[c] < b[c]) return -d; if (a[c] > b[c]) return d } return 0 }
        const rows = (tabele[tabel] || []).filter(r => f.filtre.every(p => p(r))).sort(cmp).slice(0, Math.min(f.limit ?? Infinity, plafonServer))
        return Promise.resolve({ data: f.single ? (rows[0] ?? null) : rows, error: null }).then(ok, ko)
      },
    }
    return q
  }
  return { from, cereri }
}

describe('ajustarea manuală: de ce „nu se lasă” modificat km-ul (TKT-2026-0380 c)', () => {
  // autoturismul din tichet: manual 371.000, o alimentare cu 569.786, telemetria 431.000, fișa 370.900
  const tabele = {
    logistica_alimentari: [
      { id: 10, active_id: 7, data_alimentare: '2026-10-01', km_la_alimentare: 371200, ore_la_alimentare: null },
      { id: 77, active_id: 7, data_alimentare: '2026-10-03', km_la_alimentare: 569786, ore_la_alimentare: null },
    ],
    logistica_service_fise: [{ id: 1, activ_id: 7, data_fisei: '2026-08-12', km_intrare: 370000, km_iesire: 370900, ore_intrare: null, ore_iesire: null }],
    logistica_telemetrie_zilnica: [{ id: 1, asset_id: 7, data: '2026-11-05', km_sfarsit_zi: 431000 }],
    logistica_active: [{ id: 7, km_actuali: 569786, ore_functionare_actuale: null }],
  }
  it('sursaCareTineSus: cea mai mare citire NE-manuală peste valoarea nouă; altfel null', () => {
    const c = [A(77, '2026-10-03', 569786), { sursa: 'telemetrie', id: null, data: '2026-11-05', val: 431000 }, M(600000)]
    assert.equal(sursaCareTineSus(371000, c).id, 77)
    assert.equal(sursaCareTineSus(500000, c).id, 77)
    assert.equal(sursaCareTineSus(570000, c), null)          // manualul de 600.000 e chiar ce se înlocuiește
    assert.equal(sursaCareTineSus('', c), null)
  })
  it('scăderea la 371.000 → confirmare care numește alimentarea #77 și data ei; refuz = nu se salvează', async () => {
    const mesaje = []
    const ok = await confirmaAjustareManuala(clientFals(tabele), 7, { km: 371000, ore: null }, { confirma: m => { mesaje.push(m); return false } })
    assert.equal(ok, false)
    assert.equal(mesaje.length, 1)
    assert.match(mesaje[0], /• Km: scrii 371\.000 km, dar alimentarea #77 din 03\.10\.2026 are 569\.786 km\./)
    assert.doesNotMatch(mesaje[0], /Telemetria GPS nu se corectează/)
  })
  it('după corectarea alimentării, telemetria rămâne singura peste → o numește și spune cine o corectează', async () => {
    const t2 = { ...tabele, logistica_alimentari: [tabele.logistica_alimentari[0]] }
    const mesaje = []
    await confirmaAjustareManuala(clientFals(t2), 7, { km: 371500 }, { confirma: m => { mesaje.push(m); return true } })
    assert.match(mesaje[0], /dar telemetria GPS din 05\.11\.2026 are 431\.000 km/)
    assert.match(mesaje[0], /Telemetria GPS nu se corectează din ecran/)
  })
  it('valoare nouă peste toate sursele → fără întrebare', async () => {
    let intrebat = false
    assert.equal(await confirmaAjustareManuala(clientFals(tabele), 7, { km: 570000 }, { confirma: () => { intrebat = true; return false } }), true)
    assert.equal(intrebat, false)
  })
  it('o sursă necitită → întreabă explicit, nu tace (L18)', async () => {
    const mesaje = []
    const ok = await confirmaAjustareManuala(clientFals({ ...tabele, logistica_alimentari: [] }, { eroareLa: 'logistica_telemetrie_zilnica' }), 7, { km: 575000 }, { confirma: m => { mesaje.push(m); return false } })
    assert.equal(ok, false)
    assert.match(mesaje[0], /Nu am putut verifica.*telemetrie: eroare simulată/)
  })
  it('incarcaSurseMaxime: maximul fiecărei surse, cu rândul și data', async () => {
    const s = await incarcaSurseMaxime(clientFals(tabele), 7)
    assert.deepEqual(s.km.map(c => [c.sursa, c.val, c.id]), [['alimentare', 569786, 77], ['fisa', 370900, 1], ['telemetrie', 431000, null], ['manual', 569786, null]])
    assert.deepEqual(s.erori, [])
  })
})

describe('r2 P2: sursa valorii mari — citire completă a fișelor și „sursa nu a putut fi stabilită”', () => {
  // 1.001 fișe; maximul (19.516 h) e în fișa #1001; serverul taie la 1.000 de rânduri fără eroare
  const fise = Array.from({ length: 1001 }, (_, i) => ({ id: i + 1, activ_id: 9, data_fisei: '2026-01-01', km_intrare: null, km_iesire: null, ore_intrare: 1000 + i, ore_iesire: null }))
  fise[1000].ore_iesire = 19516
  const tabele = {
    logistica_alimentari: [{ id: 3, active_id: 9, data_alimentare: '2026-10-01', km_la_alimentare: null, ore_la_alimentare: 2400 }],
    logistica_service_fise: fise,
    logistica_telemetrie_zilnica: [],
    logistica_active: [{ id: 9, km_actuali: null, ore_functionare_actuale: 19516 }],   // manualul copiat din fișă
  }
  it('cu plafon de server 1.000: maximul din fișa #1001 e găsit (citire paginată), sursa = fișa, nu manualul', async () => {
    const client = clientFals(tabele, { plafonServer: 1000 })
    const s = await incarcaSurseMaxime(client, 9)
    assert.deepEqual(s.erori, [])
    const f = s.ore.find(c => c.sursa === 'fisa')
    assert.deepEqual([f.val, f.id], [19516, 1001])
    assert.ok(client.cereri.filter(t => t === 'logistica_service_fise').length >= 2)   // a cerut și pagina a doua
    const r = stabilesteSursa(19516, s, 'ore')
    assert.equal(r.stabilita, true)
    assert.equal(r.sursa.id, 1001)
    assert.equal(textSursa(r, 'h'), 'vine din fișa de service #1001 din 01.01.2026')
  })
  it('fișele nu s-au putut citi + doar manualul egal → „sursa nu a putut fi stabilită”, nu manualul', async () => {
    const s = await incarcaSurseMaxime(clientFals(tabele, { eroareLa: 'logistica_service_fise' }), 9)
    assert.match(s.erori.join(';'), /fișe de service: eroare simulată/)
    const r = stabilesteSursa(19516, s, 'ore')
    assert.equal(r.sursa, null)
    assert.equal(r.stabilita, false)
    assert.match(textSursa(r, 'h'), /^sursa nu a putut fi stabilită \(fișe de service: eroare simulată\)$/)
  })
  it('o sursă necitită, dar un rând real are EXACT valoarea → acel rând (e sigur o sursă adevărată)', () => {
    const s = { ore: [{ sursa: 'alimentare', id: 3, data: '2026-10-01', val: 19516 }, M(19516)], km: [], erori: ['telemetrie: x'] }
    assert.equal(stabilesteSursa(19516, s, 'ore').sursa.id, 3)
    assert.equal(stabilesteSursa(19516, null, 'ore').seIncarca, true)
    assert.equal(textSursa(stabilesteSursa(19516, null, 'ore'), 'h'), 'se caută sursa…')
  })
  it('fără erori, dar niciun rând egal → spune că sursa nu e stabilită exact și arată cel mai mare găsit', () => {
    const s = { ore: [{ sursa: 'alimentare', id: 3, data: '2026-10-01', val: 2400 }], km: [], erori: [] }
    assert.match(textSursa(stabilesteSursa(19516, s, 'ore'), 'h'), /^sursa nu a putut fi stabilită exact; cea mai mare citire găsită: 2\.400 h, din alimentarea #3/)
  })
})

describe('confirmaCitiriAlimentari (pasul dinaintea scrierii)', () => {
  const tabele = {
    logistica_service_fise: [{ id: 1, activ_id: 7, data_fisei: '2026-08-12', km_intrare: 370000, km_iesire: 370900, ore_intrare: null, ore_iesire: null }],
    logistica_alimentari: [
      { id: 10, active_id: 7, data_alimentare: '2026-10-01', km_la_alimentare: 371200, ore_la_alimentare: null },
      { id: 11, active_id: 7, data_alimentare: '2026-10-15', km_la_alimentare: 569786, ore_la_alimentare: null },
    ],
    logistica_active: [{ id: 7, km_actuali: 569786, ore_functionare_actuale: null }],
  }
  it('citire suspectă → cere confirmare cu mesajul; refuz = nu se scrie', async () => {
    const mesaje = []
    const ok = await confirmaCitiriAlimentari(clientFals(tabele), [{ active_id: 7, data_alimentare: '2026-10-20', km_la_alimentare: 980000, eticheta: 'PH-TEST' }], { confirma: m => { mesaje.push(m); return false } })
    assert.equal(ok, false)
    assert.equal(mesaje.length, 1)
    assert.match(mesaje[0], /PH-TEST — Km la alimentare: 980\.000 km/)
  })
  it('citire normală → fără întrebare', async () => {
    let intrebat = false
    const ok = await confirmaCitiriAlimentari(clientFals(tabele), [{ active_id: 7, data_alimentare: '2026-10-20', km_la_alimentare: 372000 }], { confirma: () => { intrebat = true; return false } })
    assert.equal(ok, true); assert.equal(intrebat, false)
  })
  it('editarea rândului greșit (#11) la valoarea corectă nu e oprită de el însuși', async () => {
    let intrebat = false
    const ok = await confirmaCitiriAlimentari(clientFals(tabele), [{ active_id: 7, data_alimentare: '2026-10-15', km_la_alimentare: 371900 }], { excludeAlimIds: [11], confirma: () => { intrebat = true; return false } })
    assert.equal(ok, true); assert.equal(intrebat, false)
  })
  it('eroare la citirea istoricului → întreabă explicit „salvez fără verificare?” (L18)', async () => {
    const mesaje = []
    const ok = await confirmaCitiriAlimentari(clientFals(tabele, { eroareLa: 'logistica_alimentari' }), [{ active_id: 7, data_alimentare: '2026-10-20', km_la_alimentare: 372000 }], { confirma: m => { mesaje.push(m); return true } })
    assert.equal(ok, true)
    assert.match(mesaje[0], /Nu am putut verifica citirile de bord.*eroare simulată[\s\S]*Salvez fără verificare\?$/)
  })
  it('fără km / ore completate → nicio cerere la BD', async () => {
    const c = clientFals(tabele)
    assert.equal(await confirmaCitiriAlimentari(c, [{ active_id: 7, data_alimentare: '2026-10-20' }], { confirma: () => false }), true)
    assert.deepEqual(c.cereri, [])
  })
  it('incarcaCitiriActive: paginează până la pagina goală și exclude rândurile cerute', async () => {
    const multe = Array.from({ length: 2500 }, (_, i) => ({ id: i + 1, active_id: 9, data_alimentare: '2026-01-01', km_la_alimentare: 1000 + i, ore_la_alimentare: null }))
    const c = clientFals({ logistica_alimentari: multe, logistica_service_fise: [], logistica_active: [] })
    const r = await incarcaCitiriActive(c, [9], { excludeAlimIds: [5] })
    assert.equal(r.get(9).km.length, 2499)
    assert.equal(c.cereri.filter(t => t === 'logistica_alimentari').length, 4)  // 1000 + 1000 + 500 + pagina goală
  })
  it('textul de confirmare limitează lista și spune câte au rămas', () => {
    const t = textConfirmareCitiri(Array.from({ length: 14 }, (_, i) => ({ eticheta: `R${i}`, mesaje: ['x'] })), 12)
    assert.match(t, /… și încă 2 rânduri/)
  })
})
