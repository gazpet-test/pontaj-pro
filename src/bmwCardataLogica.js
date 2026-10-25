const ZI = 86400000
const FUS = 'Europe/Bucharest'

export function normalizeazaVin(v) {
  return String(v ?? '').trim().toUpperCase()
}

export function vinMascat(v) {
  const vin = normalizeazaVin(v)
  return vin ? `******${vin.slice(-6)}` : ''
}

export function numar(v) {
  return v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v)
}

export function ziBucuresti(data) {
  if (data == null || data === '') return null
  const d = new Date(data)
  if (!Number.isFinite(d.getTime())) return null
  const parti = new Intl.DateTimeFormat('en-CA', {
    timeZone: FUS, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d)
  const p = tip => parti.find(x => x.type === tip).value
  return `${p('year')}-${p('month')}-${p('day')}`
}

export function formatData(data) {
  return ziBucuresti(data) ? new Date(data).toLocaleString('ro-RO', { timeZone: FUS }) : ''
}

export function vechimeCitire(citit_la, acum = new Date()) {
  if (!ziBucuresti(citit_la)) return { ore: null, eVeche: false, text: 'Data necunoscuta' }
  const ore = Math.max(0, (new Date(acum) - new Date(citit_la)) / 3600000)
  if (!Number.isFinite(ore)) return { ore: null, eVeche: false, text: 'Data necunoscuta' }
  const n = Math.floor(ore < 24 ? ore : ore / 24)
  return { ore, eVeche: ore > 36, text: ore < 24
    ? `acum ${n} ${n === 1 ? 'ora' : 'ore'}`
    : `acum ${n} ${n === 1 ? 'zi' : 'zile'}` }
}

export function kmPeIntervale(citiri = []) {
  const sortate = citiri.filter(c => c.citit_la && ziBucuresti(c.citit_la))
    .slice().sort((a, b) => new Date(a.citit_la) - new Date(b.citit_la))
  let maximAnterior = null
  return sortate.slice(1).map((b, i) => {
    const a = sortate[i]
    const zile = (Date.parse(ziBucuresti(b.citit_la)) - Date.parse(ziBucuresti(a.citit_la))) / ZI
    const start = numar(a.odometru_km), stop = numar(b.odometru_km)
    const delta = start === null || stop === null ? null : stop - start
    // Excludem si revenirea dupa o scadere: altfel am numara din nou aceiasi km.
    const anomalie = delta !== null && (delta < 0 || (maximAnterior !== null && start < maximAnterior))
    if (start !== null) maximAnterior = Math.max(maximAnterior ?? start, start)
    if (stop !== null) maximAnterior = Math.max(maximAnterior ?? stop, stop)
    const km = delta === null || anomalie ? null : Math.round(delta * 1000) / 1000
    // OBFCM este cumulativ. Nivelul rezervorului nu dovedeste consumul intre alimentari.
    const l1 = numar(a.obfcm_combustibil_l), l2 = numar(b.obfcm_combustibil_l)
    const d1 = numar(a.obfcm_distanta_km), d2 = numar(b.obfcm_distanta_km)
    const obfcmValid = l1 !== null && l2 !== null && l2 >= l1 && d1 !== null && d2 !== null && d2 > d1
    return { de_la: a.citit_la, pana_la: b.citit_la, zile, km,
      km_pe_zi: km !== null && zile > 0 ? km / zile : null, anomalie,
      litri: obfcmValid && !anomalie ? l2 - l1 : null,
      km_consum: obfcmValid && !anomalie ? d2 - d1 : null }
  })
}

export function intervaleInFereastra(intervale, zile, acum = new Date()) {
  const sfarsit = new Date(acum).getTime()
  const inceput = sfarsit - zile * ZI
  // Numai intervale complete: fara proratarea unei distante necunoscute.
  return intervale.filter(i => new Date(i.de_la).getTime() >= inceput &&
    new Date(i.pana_la).getTime() <= sfarsit)
}

export function sumaKm(intervale, zile, acum = new Date()) {
  return intervaleInFereastra(intervale, zile, acum)
    .reduce((s, i) => s + (!i.anomalie && numar(i.km) !== null && i.km >= 0 ? Number(i.km) : 0), 0)
}

export function consumLa100(intervale = []) {
  const valide = intervale.filter(i => !i.anomalie && numar(i.km) > 0 &&
    numar(i.litri) !== null && numar(i.litri) >= 0 && numar(i.km_consum ?? i.km) > 0)
  const km = valide.reduce((s, i) => s + Number(i.km_consum ?? i.km), 0)
  return km > 0 ? valide.reduce((s, i) => s + Number(i.litri), 0) / km * 100 : null
}

export function formatKm(v) {
  return numar(v) === null ? '' : Number(v).toLocaleString('ro-RO', { maximumFractionDigits: 1 })
}

export function formatProcent(v) {
  return numar(v) === null ? '' : `${formatKm(v)}%`
}
