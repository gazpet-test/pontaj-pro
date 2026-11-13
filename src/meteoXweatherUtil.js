// Vremea ZILEI pe șantier din Vaisala Xweather (migrarea 20261221a, vederea v_meteo_zilnic_xweather) — citire + texte pentru raportul zilnic
// (telefon + pagina de rapoarte) și pentru exportul Excel. DOAR citire: datele le scrie edge fn meteo-sync, nimic nu se introduce de mână.
// Vaisala Xweather e un SERVICIU de date meteo, nu un senzor pe șantier: textele spun „Sursa: Vaisala Xweather”, coordonatele folosite și
// stația de observație cea mai apropiată (cu distanța), când există.
// Citirea: pe chei (data, pe fiecare șantier, până la pagina goală; L23); orice eroare se aruncă (L18: eroare ≠ „fără date”); o valoare
// lipsă rămâne lipsă („—” / celulă goală), niciodată 0.

export const SURSA = 'Vaisala Xweather'
export const COLOANE_XW = 'site_id,data,versiune,versiuni,tmin_c,tmax_c,tmed_c,precipitatii_mm,zapada_cm,vant_max_kmh,rafala_max_kmh,vant_dir,' +
  'vant_dir_grade,umiditate_med,descriere,lat,lng,observatii_stare,statie_id,statie_nume,statie_distanta_km,preluat_la,prima_preluare_la'
export const RAZA_STATIE_KM = 50
export const TEXT_IN_CURS = 'Rezumatul zilei apare după miezul nopții (preluat automat de la Vaisala Xweather, pentru ziua încheiată).'
export const TEXT_FARA = 'Fără rezumat Vaisala Xweather pentru această zi deocamdată (zilele lipsă se completează automat).'

export const cheie = (site, data) => `${site}|${data}`
export const aziBuc = (ms = Date.now()) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bucharest' }).format(new Date(ms))
// ziua raportului: 'date' (există rezumat) | 'in_curs' (ziua nu s-a încheiat: rezumatul vine după miezul nopții) | 'fara_date'
export const stareZi = (rand, data, azi = aziBuc()) => (rand ? 'date' : data >= azi ? 'in_curs' : 'fara_date')

// Vederea încă inexistentă (migrarea 20261221a neaplicată): DOAR „relația nu există” pe EXACT această vedere (PostgREST PGRST205 / Postgres
// 42P01, cu numele ei în mesaj). Atunci funcția nu e încă activă: exportul merge ca înainte, blocul din raport nu apare — fără eroare.
// Orice altă eroare (drepturi, rețea, alt obiect) rămâne eroare (L18).
export const VEDERE_XW = 'v_meteo_zilnic_xweather'
export function lipsaVedereXw(error) {
  if (!error) return false
  const cod = String(error.code || '')
  const text = [error.message, error.details, error.hint].filter(Boolean).join(' ')
  return (cod === 'PGRST205' || cod === '42P01') && new RegExp(`(^|[^A-Za-z0-9_])(public\\.)?${VEDERE_XW}([^A-Za-z0-9_]|$)`).test(text)
}
// eroarea de citire: marcată `vedereLipsa` când e cazul de mai sus (apelantul decide ce arată)
function eroareCitire(prefix, error) {
  const e = new Error(prefix + (error?.message || 'eroare'))
  if (lipsaVedereXw(error)) e.vedereLipsa = true
  return e
}

// toate zilele șantierelor din [de, pana], ultima versiune a fiecăreia; pe chei până la pagina goală
export async function zileXweather(client, siteIds, { de, pana, pas = 1000 } = {}) {
  const out = []
  for (const s of [...new Set(siteIds)]) {
    for (let ultima = null; ;) {
      let q = client.from(VEDERE_XW).select(COLOANE_XW).eq('site_id', s)
      if (de) q = q.gte('data', de)
      if (pana) q = q.lte('data', pana)
      if (ultima) q = q.gt('data', ultima)
      const { data, error } = await q.order('data', { ascending: true }).limit(pas)
      if (error) throw eroareCitire('vremea zilnică (Vaisala Xweather) nu se poate citi: ', error)
      if (!data || !data.length) break
      const u = data[data.length - 1].data
      if (ultima != null && !(u > ultima)) throw new Error('vremea zilnică: paginare neordonată')
      for (const r of data) out.push(r)
      ultima = u
    }
  }
  return out
}
// vremea pentru exportul Excel: rândurile, sau null = funcția nu e încă activă (vederea nu există) → exportul ca înainte de 20261221a.
// Orice altă eroare oprește exportul (nu se scoate un Excel cu „fără date” fals, L18).
export async function vremeExport(client, siteIds, { de, pana } = {}) {
  try {
    return await zileXweather(client, siteIds, { de, pana })
  } catch (e) {
    if (e?.vedereLipsa) return null
    throw e
  }
}
// o zi a unui șantier: rândul sau null (fără rezumat); eroarea se aruncă (cu `vedereLipsa` dacă vederea nu există încă)
export async function ziXweather(client, siteId, data) {
  const { data: rows, error } = await client.from(VEDERE_XW).select(COLOANE_XW).eq('site_id', siteId).eq('data', data).limit(2)
  if (error) throw eroareCitire('vremea zilei nu se poate citi: ', error)
  if ((rows || []).length > 1) throw new Error('vremea zilei: mai multe rânduri pentru aceeași zi')
  return rows?.[0] || null
}

// ── texte ──
const NR = (v, zec = 1) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v).toLocaleString('ro-RO', { maximumFractionDigits: zec }))
const cu = (v, um, zec = 1) => { const n = NR(v, zec); return n == null ? '—' : `${n}${um}` }
// direcția vântului în notația românească (V = vest)
export const directieRo = (d) => (typeof d === 'string' && /^[NESW]{1,3}$/.test(d) ? d.replace(/W/g, 'V') : null)
const RO = {
  'sunny': 'Însorit', 'clear': 'Senin', 'mostly sunny': 'Mai mult însorit', 'mostly clear': 'Mai mult senin', 'partly cloudy': 'Parțial noros',
  'mostly cloudy': 'Mai mult noros', 'cloudy': 'Înnorat', 'overcast': 'Cer acoperit', 'rain': 'Ploaie', 'light rain': 'Ploaie slabă',
  'heavy rain': 'Ploaie puternică', 'showers': 'Averse', 'rain showers': 'Averse de ploaie', 'drizzle': 'Burniță', 'snow': 'Ninsoare',
  'light snow': 'Ninsoare slabă', 'heavy snow': 'Ninsoare puternică', 'snow showers': 'Averse de ninsoare', 'rain and snow': 'Lapoviță',
  'freezing rain': 'Ploaie înghețată', 'thunderstorms': 'Furtuni', 'fog': 'Ceață', 'windy': 'Vânt puternic',
}
// descrierea furnizorului: traducere exactă când o știm, altfel textul lui (marcat ca text al furnizorului)
export function descriereRo(s) {
  if (typeof s !== 'string' || !s.trim()) return null
  const t = RO[s.trim().toLowerCase()]
  return t || `„${s.trim()}” (descrierea furnizorului)`
}
export function textValori(r) {
  if (!r) return ''
  const dir = directieRo(r.vant_dir)
  return [
    `T min ${cu(r.tmin_c, '°C')}`, `T max ${cu(r.tmax_c, '°C')}${r.tmed_c != null ? ` (medie ${cu(r.tmed_c, '°C')})` : ''}`,
    `precipitații ${cu(r.precipitatii_mm, ' mm')}`, `zăpadă ${cu(r.zapada_cm, ' cm')}`,
    `vânt max ${cu(r.vant_max_kmh, ' km/h', 0)}${r.rafala_max_kmh != null ? `, rafale ${cu(r.rafala_max_kmh, ' km/h', 0)}` : ''}${dir ? ` din ${dir}` : ''}`,
    `umiditate medie ${cu(r.umiditate_med, '%', 0)}`,
  ].join(' · ')
}
export function fmtMoment(t) {
  if (!t) return '—'
  const d = new Date(t)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('ro-RO', { timeZone: 'Europe/Bucharest', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d)
}
export function textStatie(r) {
  if (!r) return ''
  if (r.observatii_stare === 'ok' && r.statie_id) {
    const dist = NR(r.statie_distanta_km, 1)
    return `stația de observație cea mai apropiată: ${r.statie_nume ? `${r.statie_nume} (${r.statie_id})` : r.statie_id}${dist != null ? `, la ${dist} km` : ', distanța nedată de furnizor'}`
  }
  if (r.observatii_stare === 'fara_statie') return `stația de observație: nicio stație cu date în raza de ${RAZA_STATIE_KM} km`
  if (r.observatii_stare === 'neautorizat') return 'stația de observație: nedisponibilă în abonamentul Xweather'
  return 'stația de observație: necunoscută (eroare la preluare)'
}
const coordText = (r) => (r?.lat == null || r?.lng == null ? '—' : `${Number(r.lat)}, ${Number(r.lng)}`)
export function textSursa(r) {
  if (!r) return ''
  const corectat = Number(r.versiuni) > 1 ? `; corectat de furnizor (versiunea ${r.versiune}, ${fmtMoment(r.preluat_la)})` : ''
  return `Sursa: ${SURSA} — rezumatul zilei la coordonatele șantierului ${coordText(r)}; ${textStatie(r)}; preluat ${fmtMoment(r.prima_preluare_la || r.preluat_la)}${corectat}`
}
// varianta scurtă, pentru o celulă de Excel
export function sursaScurta(r) {
  if (!r) return ''
  const st = r.observatii_stare === 'ok' && r.statie_id
    ? `stația ${r.statie_nume ? `${r.statie_nume} (${r.statie_id})` : r.statie_id}${NR(r.statie_distanta_km, 1) != null ? ` la ${NR(r.statie_distanta_km, 1)} km` : ''}`
    : r.observatii_stare === 'fara_statie' ? `fără stație în ${RAZA_STATIE_KM} km` : r.observatii_stare === 'neautorizat' ? 'stație nedisponibilă' : 'stație necunoscută'
  return `${SURSA} · coord. ${coordText(r)} · ${st} · preluat ${fmtMoment(r.prima_preluare_la || r.preluat_la)}${Number(r.versiuni) > 1 ? ` · versiunea ${r.versiune}` : ''}`
}
