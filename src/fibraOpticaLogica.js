// ═══════════════════════════════════════════════════════════════════════════
// fibraOpticaLogica.js — logica pură pentru „🧵 Fibră optică” (Execuție → proiect)
// Decizia lui Răzvan, 10.11.2026: fibra optică se urmărește pe tronsoane, cu raportare zilnică din telefon: camerete (bucăți) și
// 3 etape pe intervale de km, în ordine: monotub montat -> validat (pregătit de suflare) -> fibră suflată.
// Tabelele: executie_fibra_camerete / _intervale / _jurnal (migrarea 20261211a). Fără React, fără Supabase: km, etapele (aceeași listă ca
// în SQL, test de paritate), validarea raportării ca în baza de date (serverul o refă, sub lock), rezumatul azi / cumulat / rest,
// CSV-ul și payload-urile RPC. Helperii de km / intervale / registru vin din probeTronsoaneLogica.js (o singură definiție).
// ═══════════════════════════════════════════════════════════════════════════

import { parseKm, fmtKm, fmtLungime, uneste, goluri, scadeZile, fmtZi } from './probeTronsoaneLogica.js'

export { parseKm, fmtKm, fmtLungime, fmtZi, scadeZile }

// ── etapele liniare, în ordinea de lucru — ACEEAȘI listă ca fn_executie_fibra_etapa_anterioara (blocul ETAPE-START / ETAPE-END din SQL) ──
export const ETAPE = ['monotub', 'validat', 'suflat']
export const ETAPA_ANTERIOARA = { monotub: null, validat: 'monotub', suflat: 'validat' }
export const ETAPA_URMATOARE = { monotub: 'validat', validat: 'suflat', suflat: null }
export const ETICHETE_ETAPA = { monotub: 'Monotub montat', validat: 'Validat (pregătit de suflare)', suflat: 'Fibră suflată' }
export const ETICHETE_SCURTE = { monotub: 'Monotub', validat: 'Validat', suflat: 'Suflat' }
// în mesaje, ca în baza de date
const ETAPA_MESAJ = { monotub: 'monotub montat', validat: 'validat', suflat: 'fibră suflată' }
export const CULORI_ETAPA = { monotub: '#58A6FF', validat: '#D29922', suflat: '#3FB950' }

// ── cameretele — ACEEAȘI listă ca fn_executie_fibra_cam_tranzitie (blocul TRANZITII-START / TRANZITII-END) ──
export const STARI_CAMERETA = ['de_montat', 'montata', 'anulata']
export const ETICHETE_CAMERETA = { de_montat: 'De montat', montata: 'Montată', anulata: 'Scoasă din listă' }
export const TRANZITII_CAMERETA = [['de_montat', 'montata'], ['montata', 'de_montat'], ['de_montat', 'anulata']]
export const tranzitieCameretaPermisa = (v, n) => TRANZITII_CAMERETA.some(([a, b]) => a === v && b === n)
export const RE_COD_CAMERETA = /^[A-Z0-9][A-Z0-9./_-]{0,29}$/
export const normCodCamereta = v => String(v ?? '').trim().toUpperCase()

// fereastra datei (aceeași ca în RPC-uri): azi … 7 zile în urmă; owner-ul până la 365 de zile
export const ZILE_INAPOI = 7
export const ZILE_INAPOI_OWNER = 365

// ── tronsoanele ──
/** Tronsonul are km valizi (început < sfârșit)? Altfel nu primește raportări (L18: fără km = necunoscut, nu 0). */
export const areKm = t => !!t && Number.isInteger(t.km_start_m) && Number.isInteger(t.km_end_m) && t.km_end_m > t.km_start_m
export const lungimeTronson = t => (areKm(t) ? t.km_end_m - t.km_start_m : null)
/** Ordinea tronsoanelor: după km de început (cele fără km la final), apoi cod. */
export function ordoneazaTronsoane(tronsoane) {
  return [...(tronsoane || [])].sort((a, b) => {
    const ka = areKm(a), kb = areKm(b)
    if (ka !== kb) return ka ? -1 : 1
    return (ka ? a.km_start_m - b.km_start_m : 0) || String(a.cod).localeCompare(String(b.cod), 'ro', { numeric: true })
  })
}

const activ = i => i && i.stare === 'activ'
const peTronsonEtapa = (intervale, tronsonId, etapa) => (intervale || []).filter(i => activ(i) && i.tronson_id === tronsonId && i.etapa === etapa)

/**
 * Validarea unei raportări, cu ACELEAȘI reguli ca baza (trigger-ul + RPC-ul); serverul o refă sub lock-ul tronsonului.
 * Întoarce lista de erori (gol = ok). `intervale` = toate intervalele citite ale proiectului (active și anulate).
 */
export function valideazaRaport({ tronson, etapa, deLa, panaLa, data, azi, owner = false, intervale, observatii = '' }) {
  const e = []
  if (!ETAPE.includes(etapa)) e.push('Alege etapa')
  if (!tronson) { e.push('Alege tronsonul'); return e }
  if (!areKm(tronson)) { e.push(`Tronsonul ${tronson.cod} nu are km de început și de sfârșit (se completează întâi la Tronsoane)`); return e }
  if (deLa == null || panaLa == null) e.push('Scrie km de început și de sfârșit')
  else if (!Number.isFinite(deLa) || !Number.isFinite(panaLa)) e.push('Km: scrie „12+350” (sau metri întregi „12350”)')
  else if (panaLa <= deLa) e.push('Sfârșitul trebuie să fie după început')
  else if (deLa < tronson.km_start_m || panaLa > tronson.km_end_m) {
    e.push(`Intervalul iese din tronsonul ${tronson.cod} (km ${fmtKm(tronson.km_start_m)}–${fmtKm(tronson.km_end_m)})`)
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data || '')) e.push('Data lipsește')
  else if (data > azi) e.push('Data e în viitor')
  else if (data < scadeZile(azi, owner ? ZILE_INAPOI_OWNER : ZILE_INAPOI)) e.push(owner ? 'Data poate fi cel mult 365 de zile în urmă' : 'Data poate fi cel mult 7 zile în urmă')
  if (String(observatii || '').trim().length > 1000) e.push('Observațiile au cel mult 1000 de caractere')
  if (e.length || !ETAPE.includes(etapa)) return e
  // suprapunerea cu aceeași etapă
  const supr = peTronsonEtapa(intervale, tronson.id, etapa).filter(i => i.km_de_la_m < panaLa && deLa < i.km_pana_la_m)
    .sort((a, b) => a.km_de_la_m - b.km_de_la_m || a.id - b.id)[0]
  if (supr) {
    e.push(`Porțiunea km ${fmtKm(Math.max(supr.km_de_la_m, deLa))}–${fmtKm(Math.min(supr.km_pana_la_m, panaLa))} e deja raportată pe ${fmtZi(supr.data_lucru).slice(0, 5)} (${ETAPA_MESAJ[etapa]})`)
    return e
  }
  // acoperirea de către etapa anterioară, raportată cel târziu în aceeași zi
  const ant = ETAPA_ANTERIOARA[etapa]
  if (ant) {
    const toate = peTronsonEtapa(intervale, tronson.id, ant)
    const lipsa = goluri(deLa, panaLa, toate.filter(i => i.data_lucru <= data).map(i => ({ de_la: i.km_de_la_m, pana_la: i.km_pana_la_m })))[0]
    if (lipsa) {
      const tarziu = toate.filter(i => i.data_lucru > data && i.km_de_la_m < lipsa.pana_la && lipsa.de_la < i.km_pana_la_m).map(i => i.data_lucru).sort()[0]
      e.push(tarziu
        ? `Pe km ${fmtKm(lipsa.de_la)}–${fmtKm(lipsa.pana_la)} „${ETAPA_MESAJ[ant]}” e raportat abia pe ${fmtZi(tarziu).slice(0, 5)}, după data aleasă`
        : `Porțiunea km ${fmtKm(lipsa.de_la)}–${fmtKm(lipsa.pana_la)} nu are „${ETAPA_MESAJ[ant]}” raportat („${ETAPA_MESAJ[etapa]}” se raportează doar peste „${ETAPA_MESAJ[ant]}”)`)
    }
  }
  return e
}

/** Anularea: interval activ fără o etapă următoare activă peste el (aceeași regulă ca trigger-ul). null = se poate; altfel motivul. */
export function blocajAnulare(interval, intervale) {
  if (!activ(interval)) return 'Raportarea e deja anulată'
  const urm = ETAPA_URMATOARE[interval.etapa]
  if (!urm) return null
  const dep = peTronsonEtapa(intervale, interval.tronson_id, urm).filter(i => i.km_de_la_m < interval.km_pana_la_m && interval.km_de_la_m < i.km_pana_la_m)
    .sort((a, b) => a.km_de_la_m - b.km_de_la_m || a.id - b.id)[0]
  if (!dep) return null
  return `Pe km ${fmtKm(Math.max(dep.km_de_la_m, interval.km_de_la_m))}–${fmtKm(Math.min(dep.km_pana_la_m, interval.km_pana_la_m))} există „${ETAPA_MESAJ[urm]}” raportat pe ${fmtZi(dep.data_lucru).slice(0, 5)}: anulează întâi acea raportare`
}
/** Cine poate anula: cel care a raportat sau owner-ul (serverul verifică din nou). */
export const poateAnula = (interval, uid, owner) => activ(interval) && (owner || (!!uid && interval.raportat_de === uid))
export const poateAnulaMontarea = (c, uid, owner) => c?.stare === 'montata' && (owner || (!!uid && c.montat_de === uid))
export const poateScoateCamereta = (c, uid, owner) => c?.stare === 'de_montat' && (owner || (c.sursa === 'santier' && !!uid && c.creat_de === uid))

// ── rezumatul: pe tronson și pe proiect, pentru fiecare etapă: azi, cumulat, rest (metri și %), camerete montate / total ──
const suma = l => l.reduce((s, x) => s + x, 0)
/** Metrii activi ai unei etape în limitele tronsonului (unire, deci fără dublări chiar dacă datele ar fi stricate). */
function metri(lista, t) {
  const u = uneste(lista.map(i => ({ de_la: Math.max(i.km_de_la_m, t.km_start_m), pana_la: Math.min(i.km_pana_la_m, t.km_end_m) })))
  return suma(u.map(x => x.pana_la - x.de_la))
}
export const procent = (parte, total) => (Number.isFinite(total) && total > 0 && Number.isFinite(parte) ? Math.round((parte / total) * 1000) / 10 : null)

export function rezumatTronson(t, intervale, camerete, azi) {
  const lungime = lungimeTronson(t)
  const etape = {}
  for (const et of ETAPE) {
    const l = peTronsonEtapa(intervale, t.id, et)
    if (lungime == null) { etape[et] = { azi: null, cumulat: null, rest: null, pct: null }; continue }
    const cumulat = metri(l, t)
    const aziM = metri(l.filter(i => i.data_lucru === azi), t)
    etape[et] = { azi: aziM, cumulat, rest: lungime - cumulat, pct: procent(cumulat, lungime) }
  }
  const cam = (camerete || []).filter(c => c.tronson_id === t.id && c.stare !== 'anulata')
  const montate = cam.filter(c => c.stare === 'montata')
  return {
    id: t.id, cod: t.cod, km_start_m: t.km_start_m ?? null, km_end_m: t.km_end_m ?? null, lungime, areKm: lungime != null, etape,
    camerete: { total: cam.length, montate: montate.length, azi: montate.filter(c => c.data_montare === azi).length },
  }
}
/** Totalul proiectului: doar tronsoanele cu km intră în lungime (cele fără km se listează separat, nu se socotesc 0). */
export function rezumatProiect(tronsoane, intervale, camerete, azi) {
  const randuri = ordoneazaTronsoane(tronsoane).map(t => rezumatTronson(t, intervale, camerete, azi))
  const cuKm = randuri.filter(r => r.areKm)
  const lungime = suma(cuKm.map(r => r.lungime))
  const etape = {}
  for (const et of ETAPE) {
    const cumulat = suma(cuKm.map(r => r.etape[et].cumulat))
    etape[et] = { azi: suma(cuKm.map(r => r.etape[et].azi)), cumulat, rest: lungime - cumulat, pct: procent(cumulat, lungime) }
  }
  return {
    randuri, lungime, etape, faraKm: randuri.filter(r => !r.areKm).map(r => r.cod),
    camerete: { total: suma(randuri.map(r => r.camerete.total)), montate: suma(randuri.map(r => r.camerete.montate)), azi: suma(randuri.map(r => r.camerete.azi)) },
  }
}

// ── CSV (separator „;”, zecimale cu virgulă, BOM pentru Excel) ──
const BOM = String.fromCharCode(0xFEFF)
const celula = v => {
  const s = v == null ? '' : String(v)
  return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}
const nrRo = v => (v == null ? '' : String(v).replace('.', ','))
/** Tabelul rezumatului ca CSV: un rând pe tronson + TOTAL; metrii și procentele pe fiecare etapă. */
export function csvRezumat(rez, azi) {
  const antet = ['Tronson', 'Km început', 'Km sfârșit', 'Lungime (m)']
  for (const et of ETAPE) antet.push(`${ETICHETE_SCURTE[et]} azi (m)`, `${ETICHETE_SCURTE[et]} cumulat (m)`, `${ETICHETE_SCURTE[et]} rest (m)`, `${ETICHETE_SCURTE[et]} %`)
  antet.push('Camerete montate', 'Camerete total', 'Camerete montate azi')
  const rand = (cod, t, r) => {
    const l = [cod, t ? fmtKm(t.km_start_m) : '', t ? fmtKm(t.km_end_m) : '', r.lungime ?? '']
    for (const et of ETAPE) { const x = r.etape[et]; l.push(x.azi ?? '', x.cumulat ?? '', x.rest ?? '', nrRo(x.pct)) }
    l.push(r.camerete.montate, r.camerete.total, r.camerete.azi)
    return l.map(celula).join(';')
  }
  const linii = [`Fibră optică — situația la ${fmtZi(azi)}`, antet.map(celula).join(';')]
  for (const r of rez.randuri) linii.push(rand(r.cod + (r.areKm ? '' : ' (fără km — nu intră în total)'), r.areKm ? r : null, r))
  linii.push(rand('TOTAL', null, rez))
  return BOM + linii.join('\r\n') + '\r\n'
}

// ── banda tronsonului: segmentele fiecărei etape și cameretele, în coordonate 0…1 pe lungimea tronsonului ──
export function bandaTronson(t, intervale, camerete) {
  if (!areKm(t)) return null
  const L = t.km_end_m - t.km_start_m
  const x = m => (m - t.km_start_m) / L
  const benzi = {}
  for (const et of ETAPE) {
    const u = uneste(peTronsonEtapa(intervale, t.id, et).map(i => ({ de_la: Math.max(i.km_de_la_m, t.km_start_m), pana_la: Math.min(i.km_pana_la_m, t.km_end_m) })))
    benzi[et] = u.map(s => ({ ...s, x0: x(s.de_la), x1: x(s.pana_la) }))
  }
  const puncte = (camerete || []).filter(c => c.tronson_id === t.id && c.stare !== 'anulata')
    .map(c => ({ id: c.id, cod: c.cod, km_m: c.km_m, stare: c.stare, x: x(c.km_m) })).sort((a, b) => a.km_m - b.km_m || a.id - b.id)
  return { benzi, puncte }
}
/** Ce mai e de făcut pe tronson pentru o etapă: porțiunile acoperite de etapa anterioară și nefăcute încă (propunerea din formular). */
export function deFacut(t, etapa, intervale) {
  if (!areKm(t)) return []
  const ant = ETAPA_ANTERIOARA[etapa]
  const facute = peTronsonEtapa(intervale, t.id, etapa).map(i => ({ de_la: i.km_de_la_m, pana_la: i.km_pana_la_m }))
  const baza = ant ? uneste(peTronsonEtapa(intervale, t.id, ant).map(i => ({ de_la: i.km_de_la_m, pana_la: i.km_pana_la_m })))
    : [{ de_la: t.km_start_m, pana_la: t.km_end_m }]
  return baza.flatMap(b => goluri(b.de_la, b.pana_la, facute))
}

// ── payload-urile RPC (fără cheie; cheia se pune la trimitere) ──
const txt = v => (v == null ? '' : String(v).trim())
export const payloadRaport = ({ proiectId, tronsonId, etapa, deLa, panaLa, data, observatii }) => Object.freeze({
  p_proiect: proiectId, p_tronson: tronsonId, p_etapa: etapa, p_km_de_la_m: deLa, p_km_pana_la_m: panaLa, p_data: data, p_observatii: txt(observatii) || null,
})
export const payloadAnulare = (interval, motiv) => Object.freeze({ p_id: interval.id, p_motiv: txt(motiv) || null })
export const payloadCameretaNoua = ({ proiectId, tronsonId, cod, km, montata, data, observatii }) => Object.freeze({
  p_proiect: proiectId, p_tronson: tronsonId, p_cod: normCodCamereta(cod), p_km_m: km, p_montata: !!montata, p_data: montata ? data : null,
  p_observatii: txt(observatii) || null,
})
export const payloadCameretaStare = (c, { stareNoua, data, motiv }) => Object.freeze({
  p_id: c.id, p_versiune: c.versiune, p_stare_noua: stareNoua, p_data: stareNoua === 'montata' ? data : null,
  p_motiv: stareNoua === 'montata' ? null : (txt(motiv) || null),
})
/** Validarea unei camerete noi (serverul o refă: limite, cod unic). */
export function valideazaCameretaNoua({ tronson, cod, km, montata, data, azi, owner = false, camerete }) {
  const e = []
  const c = normCodCamereta(cod)
  if (!RE_COD_CAMERETA.test(c)) e.push('Codul: litere mari, cifre și . / _ - (cel mult 30)')
  if (!tronson) e.push('Alege tronsonul')
  else if (!areKm(tronson)) e.push(`Tronsonul ${tronson.cod} nu are km de început și de sfârșit`)
  else if (km == null) e.push('Scrie km-ul cameretei')
  else if (!Number.isFinite(km)) e.push('Km: scrie „12+350” (sau metri întregi „12350”)')
  else if (km < tronson.km_start_m || km > tronson.km_end_m) e.push(`Camereta iese din tronsonul ${tronson.cod} (km ${fmtKm(tronson.km_start_m)}–${fmtKm(tronson.km_end_m)})`)
  if (montata) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data || '')) e.push('Data montării lipsește')
    else if (data > azi) e.push('Data e în viitor')
    else if (data < scadeZile(azi, owner ? ZILE_INAPOI_OWNER : ZILE_INAPOI)) e.push(owner ? 'Data poate fi cel mult 365 de zile în urmă' : 'Data poate fi cel mult 7 zile în urmă')
  }
  const dublu = (camerete || []).find(x => x.stare !== 'anulata' && x.cod === c)
  if (RE_COD_CAMERETA.test(c) && dublu) e.push(`Camereta ${c} există deja pe proiect (km ${fmtKm(dublu.km_m)})`)
  return e
}

// ── registrul cererilor nelămurite (L05): aceleași reguli ca la probe, alt prefix și lista RPC-urilor de aici ──
export const RPC_FIBRA = ['fn_executie_fibra_raporteaza', 'fn_executie_fibra_anuleaza', 'fn_executie_fibra_camereta_adauga', 'fn_executie_fibra_camereta_stare']
export const prefixRegistruFibra = (utilizator, proiect) => `gazpet.fibra_optica.incert.v1:${utilizator}:${proiect}:`

// ── L24: intervalele NU au `versiune` (aplicaRand / imbinaLista de la probe compară versiunea, deci la ele nu apără nimic). În bază
// singura tranziție permisă e activ -> anulat (trigger-ul refuză orice altă schimbare), deci „anulat” e FINAL: un răspuns întârziat sau
// o citire mai veche cu „activ” nu înlocuiește un „anulat” deja afișat. Cameretele au `versiune` și rămân pe helperii comuni. ──
const intervalMaiVechi = (venit, local) => !!local && local.stare === 'anulat' && venit.stare !== 'anulat'
export function aplicaInterval(lista, rand) {
  if (!rand || rand.id == null) return lista
  if (!(lista || []).some(x => x.id === rand.id)) return [...(lista || []), rand]
  return lista.map(x => (x.id === rand.id && !intervalMaiVechi(rand, x) ? { ...x, ...rand } : x))
}
export function imbinaIntervale(citite, curente) {
  const local = new Map((curente || []).map(x => [x.id, x]))
  return (citite || []).map(r => { const l = local.get(r.id); return intervalMaiVechi(r, l) ? l : r })
}

/** Textul unui rând de jurnal (istoric). */
export function textJurnal(j) {
  const v = j.valori || {}
  const interval = (a, b) => `km ${fmtKm(a)} → ${fmtKm(b)}`
  switch (j.actiune) {
    case 'raportare': return `${ETICHETE_SCURTE[v.etapa] || v.etapa}: ${interval(v.km_de_la_m, v.km_pana_la_m)} (${fmtLungime(v.km_pana_la_m - v.km_de_la_m)}), lucrat ${fmtZi(v.data)}${v.observatii ? ' · ' + v.observatii : ''}`
    case 'anulare': return `Anulat ${ETICHETE_SCURTE[v.etapa] || ''} ${interval(v.km_de_la_m, v.km_pana_la_m)}: ${v.motiv || ''}`
    case 'camereta_adaugata': return `Cameretă adăugată ${v.cod} la km ${fmtKm(v.km_m)}${v.stare === 'montata' ? `, montată ${fmtZi(v.data)}` : ''}`
    case 'camereta_montata': return `Cameretă ${v.cod} montată ${fmtZi(v.data)}`
    case 'camereta_montare_anulata': return `Cameretă ${v.cod}: montarea anulată (${v.motiv || ''})`
    case 'camereta_scoasa': return `Cameretă ${v.cod} scoasă din listă (${v.motiv || ''})`
    default: return j.actiune
  }
}
