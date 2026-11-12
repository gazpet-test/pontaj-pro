import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import {
  PRAG_CITIRI, SALT_KM, MAX_ORE, referintaIndependenta, verificaCitire, verificaCitiriAlimentare,
  sursaValoriiMari, descrieSursa, textConfirmareCitiri, confirmaCitiriAlimentari, incarcaCitiriActive,
  sursaCareTineSus, confirmaAjustareManuala, incarcaSurseMaxime,
} from './citiriBord.js'
import { calcUrmService, urmServiceLevel, urmServiceColor, depasireImposibila, citireFisa, ultimeleFiseCuScadenta, fisaInlocuitaDe } from './service.js'

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

describe('depasireImposibila + calcUrmService (afișarea din lista de service)', () => {
  const AZI = '2026-11-11'
  it('216.179 km depășiți la o fișă din 24.08.2026 → „citire de verificat”, nu „depășit”', () => {
    const fisa = { data_fisei: '2026-08-24', km_iesire: 338607, urmatoarea_km: 353607 }
    const u = calcUrmService(fisa, 569786, null, AZI)
    assert.equal(u.deVerificat, true)
    assert.equal(u.label, 'citire de verificat')
    assert.equal(u.depasire, 216179)
    assert.equal(urmServiceLevel(u), 'verificare')
    assert.equal(urmServiceColor(u), '#BC8CFF')
  })
  it('47.168 h depășite → de verificat; o depășire reală mică rămâne „depășit”', () => {
    assert.equal(depasireImposibila('ore', 52168, { urmatoarea_ore: 5000 }, AZI), true)
    const u = calcUrmService({ data_fisei: '2026-09-01', ore_iesire: 2000, urmatoarea_ore: 2250 }, null, 2300, AZI)
    assert.equal(u.deVerificat, undefined)
    assert.equal(urmServiceLevel(u), 'depasit')
  })
  it('creștere de la fișă mai mare decât 24 h/zi → de verificat chiar sub saltul de 1.500 h', () => {
    // fișă 09.07.2026 cu 3.000 h; azi 11.11 (126 de zile) → cel mult 3.024 h în plus; live 7.834 = +4.834
    const fisa = { data_fisei: '2026-07-09', ore_iesire: 3000, urmatoarea_ore: 3250 }
    assert.equal(depasireImposibila('ore', 7834, fisa, AZI), true)
    assert.equal(depasireImposibila('ore', 3400, fisa, AZI), false)
  })
  it('nedepășit sau fără date: nu se judecă', () => {
    assert.equal(depasireImposibila('km', 100, { urmatoarea_km: 200 }, AZI), false)
    assert.equal(depasireImposibila('km', null, { urmatoarea_km: 200 }, AZI), false)
    assert.equal(depasireImposibila('km', 300, {}, AZI), false)
  })
  it('scadența reală depășită rămâne prima; „de verificat” înaintea celor neajunse', () => {
    const u = calcUrmService({ data_fisei: '2026-08-24', km_iesire: 338607, urmatoarea_km: 353607, urmatoarea_ore: 100, urmatoarea_data: '2027-05-10' }, 569786, 120, AZI)
    assert.deepEqual(u.toate.map(t => t.tip), ['ore', 'km', 'data'])
    assert.equal(u.toate[1].deVerificat, true)
  })
  it('fișa veche înlocuită de una mai nouă CU scadență nu se mai compară cu km de azi; o reparație fără scadență nu înlocuiește', () => {
    const fise = [
      { id: 1, activ_id: 7, data_fisei: '2025-03-01', urmatoarea_km: 200000 },
      { id: 2, activ_id: 7, data_fisei: '2026-08-24', urmatoarea_km: 353607 },
      { id: 3, activ_id: 7, data_fisei: '2026-10-01' },                                  // reparație, fără scadență
      { id: 4, activ_id: 8, data_fisei: '2026-05-01', urmatoarea_ore: 2500 },
      { id: 5, activ_id: 8, data_fisei: '2026-05-01', urmatoarea_ore: 2600 },            // aceeași zi, id mai mare
    ]
    const m = ultimeleFiseCuScadenta(fise)
    assert.equal(m[7].id, 2); assert.equal(m[8].id, 5)
    assert.equal(fisaInlocuitaDe(fise[0], m).id, 2)
    assert.equal(fisaInlocuitaDe(fise[1], m), null)
    assert.equal(fisaInlocuitaDe(fise[2], m), null)     // reparația e mai nouă: nu e „înlocuită”
    assert.equal(fisaInlocuitaDe(fise[3], m).id, 5)
    assert.equal(fisaInlocuitaDe(null, m), null)
  })
  it('citireFisa: cea mai mare dintre intrare/ieșire; lipsă = null', () => {
    assert.equal(citireFisa({ km_intrare: 10, km_iesire: 12 }, 'km'), 12)
    assert.equal(citireFisa({ ore_intrare: '7' }, 'ore'), 7)
    assert.equal(citireFisa({}, 'km'), null)
  })
})

// Client PostgREST simulat: înregistrează filtrele și aplică .in / .eq / .not is null / .gt / .gte /
// .order / .limit / .maybeSingle pe tabelele date.
function clientFals(tabele, { eroareLa = null } = {}) {
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
        const rows = (tabele[tabel] || []).filter(r => f.filtre.every(p => p(r))).sort(cmp).slice(0, f.limit ?? Infinity)
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
