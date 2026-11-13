// Rezumatul zilnic Vaisala Xweather pe șantier (migrarea 20261221a, tabelul meteo_zilnic_xweather) — logica pură, fără rețea și fără BD,
// folosită de meteo-sync/index.ts și testată cu vitest (src/xweatherZilnicLogica.test.js).
//
// Sursa: Vaisala Xweather = SERVICIU de date meteo (nu un senzor pe șantier). Pentru fiecare (șantier, zi încheiată, ziua în Europe/Bucharest):
//   * conditions/summary/<lat>,<lng>  — rezumatul condițiilor la coordonatele șantierului din ERP (valorile zilei);
//   * observations/summary/closest    — stația de observație cea mai apropiată (id, nume, distanța dată de API), rază RAZA_STATIE_KM.
// Răspunsurile sunt conținut EXTERN: se iau doar numere validate (intervale ca în CHECK-urile tabelului) și text scurt fără caractere de
// control; răspunsul brut se păstrează întreg ca probă. Lipsa unei valori = NULL, niciodată 0 („0 mm” doar dacă API-ul a spus 0, L18).
//
// FORMA răspunsurilor (r2, după review): la conditions/summary valorile zilei stau DIRECT pe fiecare element din response[].periods[]
//   (periods[].dateTimeISO, periods[].temp.maxC …); doar la observations/summary sunt sub periods[].summary. O perioadă fără dată
//   (dateTimeISO / ymd) în locul așteptat = formă neașteptată → ziua RESPINSĂ cu motiv (vizibil în erori), nu „lipsă” tăcută.
// DE CONFIRMAT LA PRIMA RULARE (fără apel real nu se poate verifica; răspunsul brut rămâne în tabel, deci valorile se pot reface):
//   - numele exacte ale câmpurilor fiecărei perioade (CAMPURI: lista căilor acceptate, în ordinea priorității — întâi forma conditions);
//   - parametrii from / to ca timestamp UNIX pentru o zi locală și „closest” + radius pe observations/summary;
//   - dacă abonamentul dă observations/summary (altfel observatii_stare = 'neautorizat', fără eroare pe zi).
// LIMITE ASUMATE (spuse și în raportul livrării; detaliile și cifrele cotei: docs/METEO_XWEATHER_COTA.md):
//   - r4: corecțiile furnizorului NU se mai prind automat (reverificarea zilnică a lui alaltăieri s-a scos, ca pasul să încapă în cotă);
//     o corecție intră doar dacă owner-ul cere reverificarea intervalului:
//     {xweather_backfill:true, site_id, de_la, pana, reverifica:true} (versiune nouă dacă diferă). Un răspuns MAI SĂRAC la reverificare
//     nu se scrie (garda r3, procesZi);
//   - r4 / r5: pasul zilnic cere vremea DOAR pentru (a) șantierele active (raport zilnic în ultimele ZILE_ACTIVITATE zile): ieri + zilele
//     lipsă din ultimele ZILE_RELUARE_ACTIVE, și (b) zilele-șantier cu raport zilnic și fără vreme din ultimele FEREASTRA_RAPOARTE_ZILE zile;
//     ordinea se rotește (rotesteCoada); plafonul în unități, garda de cotă și termenul opresc rularea, restul se reia a doua zi. O zi mai
//     veche de fereastră (cu sau fără raport) sau a unui șantier inactiv se recuperează doar cu comanda owner-ului
//     {xweather_backfill:true, site_id, de_la, pana} (reluabilă cu `pana` = continua_pana din răspuns; zilele fără date sunt sărite și listate).
import { esteZi, adunaZile, aziBucuresti, coordValide } from './istoric_logica.ts'

export const SURSA_XW = 'Vaisala Xweather'
export const ENDPOINT_CONDITII = 'conditions/summary'
export const ENDPOINT_OBSERVATII = 'observations/summary/closest'
export const RAZA_STATIE_KM = 50
export const PRIMA_ZI_XW = '2015-01-01'
export const MAX_ZILE_APEL = 62          // completarea pornită de owner: cel mult atâtea zile pe apel (reluabilă cu `pana`)
export const MAX_RASPUNS_OCTETI = 200_000
export const TIMP_CERERE_MS = 25_000

// ── cota Xweather — TOATE regulile pasului zilnic stau aici (r5: în UNITĂȚI DE COST din antete, xweather_cota_logica.ts) ─────────
// O zi-șantier = conditions/summary (1 unitate / zi, documentat) + (dacă ziua are valori) observations/summary (nespecificat, estimat 1).
export const ZILE_ACTIVITATE = 14        // șantier ACTIV = cel puțin un raport zilnic cu data ≥ ieri − 13 (ultimele 14 zile încheiate, plus azi)
export const ZILE_RELUARE_ACTIVE = 7     // pe șantierele active: ieri + zilele lipsă din ultimele 7 (reluarea după 5xx / plafon / termen);
                                         // cu 1 = strict „ieri” (o zi neajunsă fără raport s-ar pierde)
export const FEREASTRA_RAPOARTE_ZILE = 31 // r5: zilele-șantier cu raport și fără vreme intră automat doar din ultimele 31 de zile (≥ ieri − 30);
                                          // mai vechi = DOAR comanda owner-ului. O zi fără date e reîncercată cel mult cât stă în fereastră.
export const MAX_UNITATI_XW_APEL = 62    // comanda owner-ului (completare / reverificare, un șantier): plafonul pe apel, în unități = exact apelul
                                         // implicit (max_zile 31 × 2 cu costurile documentate); peste el restul rămâne „neajunsă” → continua_pana
export const ACCESE_MAX_ZI = 2           // costul rezervat implicit pentru o zi-șantier (r5: crește dacă antetele arată mai mult, costZiSantier)
export const BUGET_XW_ZILNIC_MS = 40_000 // pasul zilnic: termenul propriu al buclei Xweather (și termenul global al handlerului, index.ts)
export const BUGET_XW_APEL_MS = 100_000  // comanda owner-ului (apel separat, nu din cron); tot sub termenul global
export const MIN_TIMP_ZI_MS = 5_000      // o zi-șantier nouă începe doar dacă mai sunt cel puțin 5 s până la termen
export const NEAJUNSA_PLAFON = 'neajunsă (plafonul de unități)'
export const NEAJUNSA_TIMP = 'neajunsă (bugetul de timp)'

// ── timp: ziua locală Europe/Bucharest ──────────────────────────────────────────────────────────────────────────
const fmtOra = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
function oraBucuresti(ms: number): string {
  const p = Object.fromEntries(fmtOra.formatToParts(new Date(ms)).map(x => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`
}
// momentul UTC (ms) al orei 00:00 în București pentru ziua dată (ora de vară / iarnă; schimbarea orei în România nu e la miezul nopții)
export function miezulNoptiiUtc(zi: string): number {
  if (!esteZi(zi)) throw new Error('zi invalidă: ' + zi)
  const [y, m, d] = zi.split('-').map(Number)
  for (const ore of [2, 3]) {
    const t = Date.UTC(y, m - 1, d) - ore * 3600e3
    if (oraBucuresti(t) === `${zi} 00:00`) return t
  }
  throw new Error('miezul nopții nedeterminat pentru ' + zi)
}
// [from, to] în secunde UNIX: de la 00:00 la 23:59:59 ora României (23 / 24 / 25 de ore la schimbarea orei)
export function intervalZi(zi: string): { from: number; to: number } {
  return { from: miezulNoptiiUtc(zi) / 1000, to: miezulNoptiiUtc(adunaZile(zi, 1)) / 1000 - 1 }
}
export const ieriBuc = (ms = Date.now()) => adunaZile(aziBucuresti(ms), -1)

// ── cererile (FĂRĂ credențiale: ele se adaugă doar la apel; cererea salvată în tabel nu le conține niciodată) ──────────────
const coord = (x: number) => String(Number(x.toFixed(6)))
export function cerereConditii({ lat, lng, zi }: { lat: number; lng: number; zi: string }): string {
  if (!coordValide(lat, lng)) throw new Error('coordonate invalide')
  const { from, to } = intervalZi(zi)
  return `${ENDPOINT_CONDITII}/${coord(lat)},${coord(lng)}?from=${from}&to=${to}`
}
export function cerereObservatii({ lat, lng, zi }: { lat: number; lng: number; zi: string }): string {
  if (!coordValide(lat, lng)) throw new Error('coordonate invalide')
  const { from, to } = intervalZi(zi)
  return `${ENDPOINT_OBSERVATII}?p=${coord(lat)},${coord(lng)}&radius=${RAZA_STATIE_KM}km&limit=1&from=${from}&to=${to}`
}
export const cuCredentiale = (cerere: string, cid: string, csec: string) =>
  `${cerere}${cerere.includes('?') ? '&' : '?'}client_id=${encodeURIComponent(cid)}&client_secret=${encodeURIComponent(csec)}`

// ── clasificarea unui răspuns HTTP (L05: 5xx / 429 / timeout / rețea = necunoscut → ziua nu se scrie, se reia la rularea următoare) ──
export type Clasa = 'ok' | 'fara_date' | 'neautorizat' | 'tranzitoriu' | 'eroare'
export function clasificaRaspuns(status: number, j: any): Clasa {
  if (!Number.isInteger(status) || status === 0 || status === 429 || status >= 500) return 'tranzitoriu'
  if (status === 401 || status === 403) return 'neautorizat'
  if (!j || typeof j !== 'object') return 'eroare'
  const cod = typeof j.error?.code === 'string' ? j.error.code : null
  if (cod === 'warn_no_data') return 'fara_date'
  if (cod === 'invalid_client' || cod === 'unauthorized_namespace' || cod === 'insufficient_scope') return 'neautorizat'
  if (status !== 200 || j.success !== true) return 'eroare'
  const r = j.response
  if (r == null || (Array.isArray(r) && r.length === 0)) return 'fara_date'
  if (typeof r !== 'object') return 'eroare'
  return 'ok'
}

// ── maparea rezumatului ─────────────────────────────────────────────────────────────────────────────────────────
// coloana din tabel → [căile acceptate în perioada zilei (prima prezentă câștigă), minim, maxim (exclusiv), zecimale]
// ordinea: întâi numele în stilul endpoint-ului conditions (windSpeed / windGust / humidity), apoi variantele în stilul observations (wind / rh)
// DOCUMENTAT vs TOLERAT (r3): PRIMA cale din fiecare listă (CAMPURI, CAI_DIRECTIE, CAI_DESCRIERE) e cea din documentația oficială
//   conditions/summary (temp.minC / maxC / avgC, precip.totalMM, snow.totalCM, windSpeed.maxKPH, windGust.maxKPH, windSpeed.maxDirDEG,
//   humidity.avg, windSpeed.maxDir, weather.phrase). Celelalte sunt ALIASURI TOLERATE, nedocumentate pentru acest endpoint (numele din
//   stilul observations: snowDepth, wind.*, windDir.*, rh, `weather` ca șir). Un alias folosit efectiv se întoarce în `aliasuri` și se
//   numără separat în rezultatul funcției (aliasuri_folosite), ca să-l vedem la prima rulare reală și să-l scoatem dacă nu apare.
export const CAMPURI: Record<string, [string[], number, number, number]> = {
  tmin_c: [['temp.minC'], -60, 60.0001, 2],
  tmax_c: [['temp.maxC'], -60, 60.0001, 2],
  tmed_c: [['temp.avgC'], -60, 60.0001, 2],
  precipitatii_mm: [['precip.totalMM'], 0, 1000, 2],
  zapada_cm: [['snow.totalCM', 'snowDepth.totalCM'], 0, 1000, 2],
  vant_max_kmh: [['windSpeed.maxKPH', 'wind.maxKPH'], 0, 400, 2],
  rafala_max_kmh: [['windGust.maxKPH', 'wind.gustKPH', 'wind.gustMaxKPH'], 0, 400, 2],
  vant_dir_grade: [['windSpeed.maxDirDEG', 'windDir.maxDEG', 'wind.maxDirDEG', 'wind.dirMaxDEG'], 0, 360.0001, 0],
  umiditate_med: [['humidity.avg', 'rh.avg'], 0, 100.0001, 2],
}
export const CAI_DIRECTIE = ['windSpeed.maxDir', 'windDir.max', 'wind.maxDir', 'wind.dirMax']
export const CAI_DESCRIERE = ['weather.phrase', 'weather']
export const DIRECTII = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
// coloanele de VALORI (ce compară reverificarea; o diferență = versiune nouă, nu suprascriere)
export const VALORI = ['tmin_c', 'tmax_c', 'tmed_c', 'precipitatii_mm', 'zapada_cm', 'vant_max_kmh', 'rafala_max_kmh', 'vant_dir', 'vant_dir_grade',
  'umiditate_med', 'descriere', 'observatii_stare', 'statie_id', 'statie_nume', 'statie_distanta_km']

const cale = (o: any, p: string) => p.split('.').reduce((a, k) => (a != null && typeof a === 'object' ? a[k] : undefined), o)
const RE_CONTROL = /[\u0000-\u001f\u007f-\u009f]/
// text extern scurt: șir, fără caractere de control, 1..max după trim; absent = null; altceva = invalid (undefined)
function textScurt(x: unknown, max: number): string | null | undefined {
  if (x === null || x === undefined) return null
  if (typeof x !== 'string') return undefined
  const t = x.trim()
  if (!t.length || t.length > max || RE_CONTROL.test(t)) return undefined
  return t
}
const rotunjeste = (x: number, zec: number) => Number(x.toFixed(zec))
const primul = (r: any) => (Array.isArray(r) ? r[0] : r)

// perioada zilei cerute din răspuns: ziua din dateTimeISO (ora locală a punctului) sau ymd; fusul orar, dacă e dat, trebuie să fie al României.
// forma: 'conditions' = valorile direct pe periods[i]; 'observations' = sub periods[i].summary. O perioadă care nu are dată în locul formei
// cerute = formă neașteptată → motiv (respins), nu „nicio perioadă” (altfel o formă greșită ar trece drept zi fără date).
export type Forma = 'conditions' | 'observations'
function perioadaZilei(obj: any, zi: string, forma: Forma): { summary?: any; motiv?: string } {
  const tz = obj?.profile?.tz
  if (tz != null && tz !== 'Europe/Bucharest') return { motiv: 'fus orar neașteptat: ' + String(tz).slice(0, 40) }
  const per = Array.isArray(obj?.periods) ? obj.periods : null
  if (!per) return { motiv: 'răspuns fără periods' }
  const ymd = zi.replace(/-/g, '')
  const ale: any[] = []
  for (const p of per) {
    const s = forma === 'conditions' ? p : p?.summary
    const d = s && typeof s === 'object' && typeof s.dateTimeISO === 'string' && /^\d{4}-\d{2}-\d{2}/.test(s.dateTimeISO) ? s.dateTimeISO.slice(0, 10) : null
    const y = s && typeof s === 'object' && (typeof s.ymd === 'number' || typeof s.ymd === 'string') ? String(s.ymd) : null
    if (d == null && y == null) return { motiv: `perioadă fără dată (formă neașteptată pentru ${forma}/summary)` }
    if (d === zi || (d == null && y === ymd)) ale.push(s)
  }
  if (ale.length > 1) return { motiv: 'mai multe perioade pentru aceeași zi' }
  if (!ale.length) return {}
  return { summary: ale[0] }
}

// conditions/summary → valorile zilei. { valori } | { lipsa } (nicio valoare pentru zi) | { respins } (formă / valoare invalidă: ziua NU se scrie)
export function valoriDinConditii(j: any, zi: string): { valori?: Record<string, unknown>; lipsa?: string; respins?: string; aliasuri?: string[] } {
  const obj = primul(j?.response)
  if (!obj || typeof obj !== 'object') return { respins: 'răspuns conditions fără response' }
  const { summary: s, motiv } = perioadaZilei(obj, zi, 'conditions')
  if (motiv) return { respins: motiv }
  if (!s) return { lipsa: 'nicio perioadă pentru ziua cerută' }
  const v: Record<string, unknown> = {}
  const aliasuri: string[] = []   // căile tolerate (nedocumentate) folosite efectiv: indexul > 0 în listă
  for (const [col, [cai, min, max, zec]] of Object.entries(CAMPURI)) {
    v[col] = null
    for (const [i, c] of cai.entries()) {
      const x = cale(s, c)
      if (x === null || x === undefined) continue
      if (typeof x !== 'number' || !Number.isFinite(x) || x < min || x >= max) return { respins: `valoare invalidă pentru ${col}` }
      const r = rotunjeste(x, zec)
      if (r < min || r >= max) return { respins: `valoare invalidă pentru ${col}` }
      v[col] = r
      if (i > 0) aliasuri.push(c)
      break
    }
  }
  if (v.vant_dir_grade === 360) v.vant_dir_grade = 0
  v.vant_dir = null
  for (const [i, c] of CAI_DIRECTIE.entries()) {
    const x = cale(s, c)
    if (x === null || x === undefined) continue
    if (typeof x !== 'string' || !DIRECTII.includes(x)) return { respins: 'direcția vântului invalidă' }
    v.vant_dir = x
    if (i > 0) aliasuri.push(c)
    break
  }
  v.descriere = null
  for (const [i, c] of CAI_DESCRIERE.entries()) {
    const x = cale(s, c)
    if (x === null || x === undefined || (typeof x === 'object' && c === 'weather')) continue
    const t = textScurt(x, 200)
    if (t === undefined) return { respins: 'descrierea vremii invalidă' }
    v.descriere = t
    if (i > 0) aliasuri.push(c)
    break
  }
  const t = v as Record<string, number | null>
  if (t.tmin_c != null && t.tmax_c != null && t.tmin_c > t.tmax_c) return { respins: 'Tmin > Tmax' }
  if (t.tmed_c != null && ((t.tmin_c != null && t.tmed_c < t.tmin_c) || (t.tmax_c != null && t.tmed_c > t.tmax_c))) return { respins: 'Tmedie în afara [Tmin, Tmax]' }
  if (['tmin_c', 'tmax_c', 'tmed_c', 'precipitatii_mm', 'zapada_cm', 'vant_max_kmh', 'rafala_max_kmh', 'umiditate_med'].every(c => v[c] == null)) {
    return { lipsa: 'nicio valoare numerică pentru zi' }
  }
  return aliasuri.length ? { valori: v, aliasuri } : { valori: v }
}

// observations/summary/closest → stația (id, nume, distanța dată de API). Lipsa stației NU e eroare: observatii_stare o spune.
export type Statie = { observatii_stare: 'ok' | 'fara_statie' | 'neautorizat' | 'eroare'; statie_id: string | null; statie_nume: string | null;
  statie_distanta_km: number | null; statie_lat: number | null; statie_lng: number | null }
const FARA: Omit<Statie, 'observatii_stare'> = { statie_id: null, statie_nume: null, statie_distanta_km: null, statie_lat: null, statie_lng: null }
export function statieDinObservatii(clasa: Clasa, j: any, zi: string): Statie {
  if (clasa === 'fara_date') return { observatii_stare: 'fara_statie', ...FARA }
  if (clasa === 'neautorizat') return { observatii_stare: 'neautorizat', ...FARA }
  if (clasa !== 'ok') return { observatii_stare: 'eroare', ...FARA }
  const obj = primul(j?.response)
  if (!obj || typeof obj !== 'object') return { observatii_stare: 'fara_statie', ...FARA }
  const id = typeof obj.id === 'string' && /^[A-Za-z0-9_.:-]{1,40}$/.test(obj.id) ? obj.id : null
  if (!id) return { observatii_stare: 'eroare', ...FARA }
  // stația trebuie să aibă rezumat pentru ziua cerută; altfel nu e „stația zilei”
  const { summary, motiv } = perioadaZilei(obj, zi, 'observations')
  if (motiv) return { observatii_stare: 'eroare', ...FARA }
  if (!summary) return { observatii_stare: 'fara_statie', ...FARA }
  const nume = textScurt(obj.place?.name, 120)
  const dist = obj.relativeTo?.distanceKM
  const lat = obj.loc?.lat, lng = obj.loc?.long
  return {
    observatii_stare: 'ok', statie_id: id, statie_nume: nume === undefined ? null : nume,
    // distanța doar dacă o dă API-ul (nu o calculăm noi); în afara razei cerute = nedovedită → NULL
    statie_distanta_km: typeof dist === 'number' && Number.isFinite(dist) && dist >= 0 && dist <= RAZA_STATIE_KM + 0.5 ? rotunjeste(dist, 2) : null,
    statie_lat: coordValide(lat, lng) ? rotunjeste(lat, 6) : null, statie_lng: coordValide(lat, lng) ? rotunjeste(lng, 6) : null,
  }
}

// răspunsul brut păstrat ca probă (fără credențiale: răspunsul nu le conține; dimensiune plafonată ca în CHECK)
export function brut(j: unknown): unknown {
  const s = JSON.stringify(j ?? null)
  if (s.length > MAX_RASPUNS_OCTETI) throw new Error('răspuns prea mare pentru a fi păstrat')
  return JSON.parse(s)
}

// rândul pentru meteo_zilnic_xweather (preluat_la îl pune serverul; versiunea o verifică trigger-ul)
export function randXweather({ site_id, zi, lat, lng, versiune, valori, statie, cerCond, cerObs, jCond, jObs }:
  { site_id: number; zi: string; lat: number; lng: number; versiune: number; valori: Record<string, unknown>; statie: Statie;
    cerCond: string; cerObs: string | null; jCond: unknown; jObs: unknown }) {
  return {
    site_id, data: zi, versiune, ...valori, lat: rotunjeste(lat, 6), lng: rotunjeste(lng, 6),
    cerere_conditii: cerCond, cerere_observatii: cerObs, ...statie,
    raspuns_conditii: brut(jCond), raspuns_observatii: cerObs == null ? null : brut(jObs ?? null),
  }
}

// aceleași valori (reverificarea): numere comparate ca numere (valorile din BD au deja scara coloanei), textul exact
export function valoriEgale(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return VALORI.every(c => {
    const x = a[c] ?? null, y = b[c] ?? null
    if (x === null || y === null) return x === y
    if (typeof x === 'number' || typeof y === 'number') return Number(x) === Number(y)
    return String(x) === String(y)
  })
}

// ── planul unei rulări ──────────────────────────────────────────────────────────────────────────────────────────
// existente: site_id → (zi → ultima versiune a zilei, cu valorile). start: site_id → prima zi de luat în calcul (data_start a proiectului).
// rapoarte (doar zilnic): site_id → zilele cu raport zilnic (rapoarte_zilnice, UNIQUE (site_id, data)).
// zilnic (r4, cota): DOAR zile NOI (fără reverificare automată), în ordinea:
//   (a) „activ”  — șantierele active (santierActiv): ieri + zilele lipsă din ultimele ZILE_RELUARE_ACTIVE (≥ data de start a proiectului),
//                  chiar fără raport în ziua aceea (o zi nelucrată din cauza vremii e exact ziua pentru care vrem dovada); cele mai noi întâi;
//   (b) „raport” — zilele-șantier cu raport zilnic și fără vreme (rapoarte întârziate) din fereastra de FEREASTRA_RAPOARTE_ZILE zile
//                  (r5; mai vechi = doar comanda owner-ului), cele mai noi întâi; fără dubluri cu (a);
//   nimic altceva. Planul NU taie: plafonul, garda de cotă și termenul le aplică bucla (index.ts), restul apare „neajunsă” și se reia;
//   ordinea parcurgerii o rotește rotesteCoada (r5), ca zilele care eșuează mereu să nu ocupe plafonul în fiecare zi.
// backfill (owner): zilele lipsă din [de, pana], de la cea mai nouă, cel mult maxZile (reluabil, idempotent: o zi existentă nu se mai cere);
//          cu reverifica = true și zilele EXISTENTE din interval se reverifică (o corecție târzie a furnizorului = versiune nouă).
//          Ziua de reluare NU o dă planul: o dă continuaPana(), după rezultatele scrierii (L05).
export type Sarcina = { site_id: number; lat: number; lng: number; zi: string; tip: 'nou' | 'verificare'; anterior?: Record<string, unknown>;
  tinta?: 'activ' | 'raport' }
// șantier activ = are cel puțin un raport zilnic cu data ≥ ieri − (ZILE_ACTIVITATE − 1)
export function santierActiv(zile: Set<string> | undefined, ieri: string): boolean {
  if (!zile || !zile.size) return false
  const de = adunaZile(ieri, -(ZILE_ACTIVITATE - 1))
  for (const z of zile) if (esteZi(z) && z >= de) return true
  return false
}
// fereastra pasului zilnic (r5, mărginită): [ieri − (FEREASTRA_RAPOARTE_ZILE − 1), ieri] — cuprinde și reluarea șantierelor active (7 zile)
// și activitatea (14 zile); rapoartele și vremea existentă se citesc din BD doar pe ea
export function fereastraZilnica(ieri: string): string {
  const de = adunaZile(ieri, -(Math.max(FEREASTRA_RAPOARTE_ZILE, ZILE_RELUARE_ACTIVE, ZILE_ACTIVITATE) - 1))
  return de < PRIMA_ZI_XW ? PRIMA_ZI_XW : de
}
const maiNouIntai = (a: Sarcina, b: Sarcina) => (a.zi < b.zi ? 1 : a.zi > b.zi ? -1 : a.site_id - b.site_id)
export function planXweather(
  sites: { id: number; lat: unknown; lng: unknown; proiect_id?: number | null }[],
  existente: Map<string, Map<string, Record<string, unknown>>>,
  start: Map<string, string | null>,
  { mod, ieri, deLa = null, pana = null, maxZile = MAX_ZILE_APEL, reverifica = false, rapoarte = new Map() }:
    { mod: 'zilnic' | 'backfill'; ieri: string; deLa?: string | null; pana?: string | null; maxZile?: number; reverifica?: boolean;
      rapoarte?: Map<string, Set<string>> },
) {
  if (!esteZi(ieri)) throw new Error('ieri invalid')
  if (deLa != null && (!esteZi(deLa) || deLa < PRIMA_ZI_XW || deLa > ieri)) throw new Error('de_la invalid')
  if (pana != null && (!esteZi(pana) || pana < PRIMA_ZI_XW || pana > ieri)) throw new Error('pana invalid')
  if (!Number.isInteger(maxZile) || maxZile < 1 || maxZile > MAX_ZILE_APEL) throw new Error('max_zile invalid')
  if (mod === 'backfill' && sites.length !== 1) throw new Error('completarea pornită de owner: un singur șantier pe apel (site_id)')
  if (mod === 'zilnic' && (deLa != null || pana != null || reverifica)) throw new Error('pasul zilnic nu primește interval / reverificare')
  const sarcini: Sarcina[] = []
  const sarite: { site_id: number; motiv: string }[] = []
  const lipsa = new Map<number, string[]>()   // site → zilele de cerut (lipsă, plus existente la reverificare), de la cea mai nouă
  const valide: { id: number; lat: number; lng: number }[] = []
  const exSite = new Map<number, Map<string, Record<string, unknown>>>()
  const activ: Sarcina[] = [], dinRaport: Sarcina[] = []
  const activi: number[] = []
  for (const s of sites) {
    if (!coordValide(s.lat, s.lng)) { sarite.push({ site_id: s.id, motiv: 'fără coordonate (lat / lng)' }); continue }
    const lat = s.lat as number, lng = s.lng as number
    valide.push({ id: s.id, lat, lng })
    const ex = existente.get(String(s.id)) || new Map()
    exSite.set(s.id, ex)
    const st = s.proiect_id != null ? start.get(String(s.proiect_id)) ?? null : null
    if (mod === 'zilnic') {
      const zr = rapoarte.get(String(s.id))
      const luate = new Set<string>()
      if (santierActiv(zr, ieri)) {
        activi.push(s.id)
        const jos = adunaZile(ieri, -(ZILE_RELUARE_ACTIVE - 1))
        for (let d = ieri; d >= jos; d = adunaZile(d, -1)) {
          if (ex.has(d) || d < PRIMA_ZI_XW || (st && esteZi(st) && d < st)) continue
          activ.push({ site_id: s.id, lat, lng, zi: d, tip: 'nou', tinta: 'activ' }); luate.add(d)
        }
      }
      const josRap = fereastraZilnica(ieri)
      for (const d of zr || []) {
        if (!esteZi(d) || d > ieri || d < PRIMA_ZI_XW || d < josRap || ex.has(d) || luate.has(d)) continue
        dinRaport.push({ site_id: s.id, lat, lng, zi: d, tip: 'nou', tinta: 'raport' })
      }
      continue
    }
    const sus = pana ?? ieri
    const d0 = deLa ?? (st && esteZi(st) ? st : null)
    if (!d0) { sarite.push({ site_id: s.id, motiv: 'fără dată de început (proiect fără data_start; se poate da de_la)' }); continue }
    const de = d0 < PRIMA_ZI_XW ? PRIMA_ZI_XW : d0
    const z: string[] = []
    for (let d = sus; d >= de; d = adunaZile(d, -1)) if (!ex.has(d) || reverifica) z.push(d)
    lipsa.set(s.id, z)
  }
  if (mod === 'zilnic') return { sarcini: [...activ.sort(maiNouIntai), ...dinRaport.sort(maiNouIntai)], sarite, ramase: 0, activi }
  // backfill: zilele lipsă de la cea mai nouă, până la maxZile (un singur șantier pe apel)
  const buget = maxZile
  let luate = 0
  const idx = new Map<number, number>()
  for (let progres = true; progres && luate < buget;) {
    progres = false
    for (const s of valide) {
      const z = lipsa.get(s.id) || [], i = idx.get(s.id) || 0
      if (i >= z.length || luate >= buget) continue
      const ant = exSite.get(s.id)?.get(z[i])
      sarcini.push(ant ? { site_id: s.id, lat: s.lat, lng: s.lng, zi: z[i], tip: 'verificare', anterior: ant }
                       : { site_id: s.id, lat: s.lat, lng: s.lng, zi: z[i], tip: 'nou' })
      idx.set(s.id, i + 1); luate++; progres = true
    }
  }
  let ramase = 0
  for (const s of valide) ramase += Math.max(0, (lipsa.get(s.id) || []).length - (idx.get(s.id) || 0))
  return { sarcini, sarite, ramase, activi: [] as number[] }
}

// ── r5: coada nu se mai poate înfometa ─────────────────────────────────────────────────────────────────────────────
// „Ieri” pe șantierele active are partea lui (r6: nu mai e prioritate fixă, vezi partiCoada mai jos). Restul cozii (zilele lipsă ale șantierelor
// active + zilele cu raport din fereastră, cele mai noi întâi) se parcurge circular dintr-un punct de pornire care se mută determinist cu ziua calendaristică:
//   pornire = ⌊ fracția(indexul zilei `ieri` × φ) × lungimea cozii ⌋, φ = (√5 − 1) / 2 (șirul lui Weyl / raportul de aur).
// Fracțiile succesive acoperă uniform [0, 1) oricât s-ar scurta coada între rulări (zilele servite ies din ea), deci zilele care eșuează mereu
// („furnizorul nu are date”, coordonate greșite) nu mai pot ocupa plafonul în fiecare zi înaintea celorlalte. O pornire „(index × pas) mod
// lungime” s-a dovedit mai slabă în simulare: se decalează când coada se scurtează (plafon 10: 70 de rulări în cel mai rău caz, față de 26).
// Dacă toată coada încape sigur în rulare (≤ pas = plafon / costul unei zile), ordinea rămâne „cele mai noi întâi” (nu e nimic de împărțit).
//
// r6 (P1 r5: prioritatea fixă „ieri” putea înfometa complet restanțele — plafon 10, zece șantiere active cu câte o zi nouă pe zi → cele 5
// locuri luate mereu de „ieri”, zero restanțe în 31 de rulări): coada are acum DOUĂ PĂRȚI, „ieri” (ziua nouă a șantierelor active) și
// „restanțe” (tot restul). Când există amândouă, partiCoada rezervă restanțelor cel puțin o treime din locurile rulării (⌈pas / 3⌉, minimum
// o zi-șantier), iar restul rămâne lui „ieri”; partea nefolosită a uneia trece celeilalte. Plafon 10 (pas 5): 2 restanțe + 3 ieri; plafon 60
// (pas 30): 10 + 20. La pas 1 locul alternează după paritatea zilei. Rotația (φ) rămâne în interiorul fiecărei părți, iar cele două părți se
// împletesc uniform în ORDINEA DE EXECUȚIE (r7: rotunjire, nu ⌊…⌋): în orice prefix al cozii fiecare parte e la cel mult ½ poziție de
// proporția planificată, deci o oprire după oricâte poziții (gardă de cotă actualizată, termen, cost mai mare) le atinge pe amândouă
// proporțional, nu doar pe cea de la coadă. (Nu garantează partea ÎNTREAGĂ: o oprire după 2 poziții servește 1 + 1, nu 3 + 2.)
export const indexZi = (zi: string) => Math.round(Date.parse(zi + 'T00:00:00Z') / 864e5)
const PHI = (Math.sqrt(5) - 1) / 2
export const esteIeri = (s: { tinta?: string; zi: string }, ieri: string) => s.tinta === 'activ' && s.zi === ieri
export const PARTE_RESTANTE = 3            // restanțele: cel puțin ⌈pas / 3⌉ locuri pe rulare (minimum 1) când există și „ieri”
export function partiCoada(nIeri: number, nRest: number, pas: number, ieri: string) {
  const p = Math.max(1, Math.floor(pas))
  const rezRest = !nRest ? 0 : !nIeri ? p : p >= 2 ? Math.min(p - 1, Math.max(1, Math.ceil(p / PARTE_RESTANTE))) : indexZi(ieri) % 2
  const rezIeri = p - rezRest
  return { pas: p, rezervat_restante: rezRest, rezervat_ieri: rezIeri,
    ieri: Math.min(nIeri, rezIeri + Math.max(0, rezRest - nRest)), restante: Math.min(nRest, rezRest + Math.max(0, rezIeri - nIeri)) }
}
export function rotesteCoada(sarcini: Sarcina[], ieri: string, pas: number): { sarcini: Sarcina[]; pornire: number } {
  if (!esteZi(ieri)) throw new Error('ieri invalid')
  const prime = sarcini.filter(s => esteIeri(s, ieri))
  const rest = sarcini.filter(s => !esteIeri(s, ieri))
  // totul încape: ordinea „ieri, apoi cele mai noi întâi” (nu e nimic de împărțit)
  if (prime.length + rest.length <= Math.max(1, Math.floor(pas))) return { sarcini: [...prime, ...rest], pornire: 0 }
  const pt = partiCoada(prime.length, rest.length, pas, ieri)
  const f = (indexZi(ieri) * PHI) % 1
  const roteste = (q: Sarcina[], locuri: number) => {
    const o = q.length > locuri ? Math.min(q.length - 1, Math.floor(f * q.length)) : 0
    return { q: [...q.slice(o), ...q.slice(0, o)], o }
  }
  const R = roteste(rest, pt.restante), I = roteste(prime, pt.ieri)
  const tot = pt.ieri + pt.restante
  const out: Sarcina[] = []
  // r7: restanțele din primele m poziții = round(m × restante / tot) (nu ⌊…⌋): în ORICE prefix (o oprire după k poziții, de gardă /
  // termen / cost) fiecare parte e la cel mult ½ poziție de proporția planificată. Cu ⌊…⌋ restanțele erau mereu în urmă (pas 5, 3 + 2:
  // „IIRIR” — o oprire după 2 poziții le lăsa la zero); acum „IRIRI”. La pas întreg, aceleași 2 + 3 (round(tot × r / tot) = r).
  const pana = (m: number) => Math.floor((2 * m * pt.restante + tot) / (2 * tot))
  for (let k = 0, i = 0, r = 0; i < I.q.length || r < R.q.length; k++) {
    const vreaRest = pana(k + 1) > pana(k)
    if ((vreaRest && r < R.q.length) || i >= I.q.length) out.push(R.q[r++]); else out.push(I.q[i++])
  }
  return { sarcini: out, pornire: R.o }
}

// ── plafonul de unități, termenul și oprirea rulării (aplicate de bucla din index.ts) ─────────────────────────────────
// o zi-șantier începe doar dacă (1) încape ÎNTREAGĂ sub plafon (costZi: implicit ACCESE_MAX_ZI = 2; r5: maximul văzut în antete) — rularea
// nu trece de plafon decât dacă un antet arată un cost peste cel rezervat — și (2) mai sunt cel puțin MIN_TIMP_ZI_MS până la termen.
// null = poate începe; altfel motivul („neajunsă …”, se reia la rularea următoare).
export function poateIncepeZi(unitati: number, plafon: number, acum: number, termen: number, costZi = ACCESE_MAX_ZI): string | null {
  if (unitati + costZi > plafon) return NEAJUNSA_PLAFON
  if (acum + MIN_TIMP_ZI_MS > termen) return NEAJUNSA_TIMP
  return null
}
// timpul unei cereri: cel mult TIMP_CERERE_MS și niciodată după termen (pragul se impune la fiecare cerere, nu se constată la final);
// ≤ 0 = cererea NU se mai trimite (nu e acces)
export const timpCerere = (acum: number, termen: number) => Math.min(TIMP_CERERE_MS, termen - acum)
// răspunsul care oprește TOATĂ rularea: limita de accese a furnizorului (429 / maxhits_*) la orice cerere, sau contul neautorizat la
// conditions (fără el nicio zi nu se poate lua). Cererile următoare ar consuma accese degeaba; zilele rămase apar „neajunsă (oprit: …)”.
// „neautorizat” la observations NU oprește: e starea stației (observatii_stare), ziua se scrie.
export function motivOprire(endpoint: 'conditions' | 'observations', status: number, j: any): string | null {
  const cod = typeof j?.error?.code === 'string' ? j.error.code : ''
  if (status === 429 || /^maxhits/.test(cod)) return `limita de accese a furnizorului (${status}${cod ? ' ' + cod.slice(0, 40) : ''})`
  if (endpoint === 'conditions' && clasificaRaspuns(status, j) === 'neautorizat') return `cont neautorizat la conditions (${status})`
  return null
}

// ── reluarea completării (backfill, un șantier pe apel): DUPĂ rezultate, nu după plan (L05) ─────────────────────────────
// confirmate = zilele cu rezultat DOVEDIT: scrierea a reușit, rândul există deja (23505), reverificarea a găsit aceleași valori, sau
// furnizorul a spus definitiv „fără date” pentru zi. Orice altceva (rețea / timp depășit / 5xx, răspuns respins, eroare de scriere, sarcină
// neajunsă din cauza bugetului de timp) e NECONFIRMAT: reluarea pornește de la cea mai nouă zi neconfirmată, ca ea să fie cerută din nou.
// Toate confirmate: ziua dinaintea celei mai vechi luate (dacă mai rămân zile în interval), altfel null (gata).
export function continuaPana(sarcini: Sarcina[], confirmate: Set<string>, ramase: number): string | null {
  const zile = [...new Set(sarcini.map(s => s.zi))].sort().reverse()
  const prima = zile.find(z => !confirmate.has(z))
  if (prima) return prima
  return ramase > 0 && zile.length ? adunaZile(zile[zile.length - 1], -1) : null
}
// rezultatul unei zile → confirmată sau nu (pentru continuaPana)
// deno-lint-ignore no-explicit-any
// Un răspuns mai sărac la reverificare (incomplet) e și el rezultat DOVEDIT: furnizorul a răspuns, versiunea afișată rămâne cea completă;
// altfel cursorul completării s-ar bloca pe zi la nesfârșit.
export function zConfirmata(z: any, scriere: 'ok' | 'deja' | 'eroare' | null): boolean {
  if (z?.neschimbat === true || (typeof z?.lipsa === 'string' && z.lipsa) || (typeof z?.incomplet === 'string' && z.incomplet)) return true
  return !!z?.rand && (scriere === 'ok' || scriere === 'deja')
}

// ── garda reverificării (r3): o versiune nouă nu are voie să piardă nimic față de cea afișată ─────────────────────────────
// Câmpurile stației (în afara VALORI, comparate doar la pierdere): poziția stației, citită și ea din vedere ca versiune anterioară.
export const STATIE_EXTRA = ['statie_lat', 'statie_lng']
// câmpurile care aveau valoare în versiunea anterioară și ar deveni NULL în cea nouă (STATIE_EXTRA doar dacă anteriorul le are)
export function campuriPierdute(anterior: Record<string, unknown>, nou: Record<string, unknown>): string[] {
  return [...VALORI, ...STATIE_EXTRA.filter(c => c in anterior)].filter(c => anterior[c] != null && nou[c] == null)
}
// stația versiunii anterioare se păstrează când reverificarea observațiilor NU aduce o stație: anteriorul avea stație și acum nu mai e
// (eroare 4xx, neautorizat, fără stație), sau acum e „eroare” peste o stare cunoscută (fara_statie / neautorizat). „eroare” nu e informație.
export function pastreazaStatia(anterior: Record<string, unknown>, statie: Statie): boolean {
  if (anterior.observatii_stare === 'ok') return statie.observatii_stare !== 'ok'
  return statie.observatii_stare === 'eroare' && anterior.observatii_stare != null && anterior.observatii_stare !== 'eroare'
}
const statieAnterioara = (a: Record<string, unknown>): Statie => ({
  observatii_stare: a.observatii_stare as Statie['observatii_stare'],
  statie_id: (a.statie_id ?? null) as string | null, statie_nume: (a.statie_nume ?? null) as string | null,
  statie_distanta_km: a.statie_distanta_km == null ? null : Number(a.statie_distanta_km),
  statie_lat: a.statie_lat == null ? null : Number(a.statie_lat), statie_lng: a.statie_lng == null ? null : Number(a.statie_lng),
})

// ── o zi: din cele două răspunsuri → rândul de scris, sau motivul pentru care nu se scrie ────────────────────────────
// { rand } | { lipsa } | { respins } | { tranzitoriu } | { eroare } | { neschimbat } | { incomplet }
//   + statie_pastrata (reverificarea observațiilor a eșuat, stația vine din versiunea anterioară) + aliasuri (căi tolerate folosite)
// GARDA REVERIFICĂRII (r3): la tip 'verificare' o versiune nouă se scrie DOAR dacă nu pierde nimic față de cea afișată:
//   - observațiile eșuate nu înlocuiesc stația cunoscută: se păstrează stația versiunii anterioare, iar dovada eșecului stă în
//     raspuns_observatii (obiectul { statie_din_versiunea, reverificare_observatii: 'esuata', status, raspuns }) și în rezultatul funcției;
//   - dacă vreun câmp care avea valoare ar deveni NULL → { incomplet } — NIMIC scris (tabelul nu admite UPDATE / DELETE, iar orice rând
//     nou ar deveni versiunea afișată; un rând „marcat” ar cere coloană nouă în migrare), doar consemnat în rezultat (reverificari_incomplete);
//   - o corecție reală (valori diferite, la fel de complete sau mai complete) = versiune nouă, ca până acum.
// La tip 'nou' (prima versiune) nu există nimic de degradat: se scrie cu câmpurile lipsă NULL.
export function procesZi(s: Sarcina, cond: { status: number; json: any; cerere: string }, obs: { status: number; json: any; cerere: string } | null) {
  const cc = clasificaRaspuns(cond.status, cond.json)
  if (cc === 'tranzitoriu') return { tranzitoriu: `conditions ${cond.status || 'rețea / timp depășit'}` }
  if (cc === 'fara_date') return { lipsa: 'Xweather nu are rezumat pentru zi' }
  if (cc !== 'ok') return { eroare: `conditions: ${cc} (${cond.status})` }
  const m = valoriDinConditii(cond.json, s.zi)
  if (m.respins) return { respins: m.respins }
  if (m.lipsa) return { lipsa: m.lipsa }
  const al = m.aliasuri?.length ? { aliasuri: m.aliasuri } : {}
  if (!obs) return { eroare: 'cererea de observații lipsește' }
  const co = clasificaRaspuns(obs.status, obs.json)
  if (co === 'tranzitoriu') return { tranzitoriu: `observations ${obs.status || 'rețea / timp depășit'}` }
  let statie = statieDinObservatii(co, obs.json, s.zi)
  let jObs: unknown = obs.json
  let pastrata = false
  const ant = s.tip === 'verificare' ? s.anterior : undefined
  if (ant && pastreazaStatia(ant, statie)) {
    pastrata = true
    jObs = { statie_din_versiunea: Number(ant.versiune), reverificare_observatii: 'esuata', status: obs.status, stare: statie.observatii_stare, raspuns: obs.json ?? null }
    statie = statieAnterioara(ant)
  }
  const sp = pastrata ? { statie_pastrata: true } : {}
  const nou = { ...m.valori, ...statie }
  if (ant) {
    const pierdute = campuriPierdute(ant, nou)
    if (pierdute.length) return { incomplet: `răspuns incomplet la reverificare (ar pierde: ${pierdute.join(', ')})`, ...sp, ...al }
    if (valoriEgale(nou, ant)) return { neschimbat: true, ...sp, ...al }
  }
  const versiune = ant ? Number(ant.versiune) + 1 : 1
  if (!Number.isInteger(versiune) || versiune < 1) return { eroare: 'versiunea anterioară invalidă' }
  return { rand: randXweather({ site_id: s.site_id, zi: s.zi, lat: s.lat, lng: s.lng, versiune, valori: m.valori!, statie,
    cerCond: cond.cerere, cerObs: obs.cerere, jCond: cond.json, jObs }), ...sp, ...al }
}

// ── rezultatul unui lot (r3): spune adevărul despre zilele nesalvate ─────────────────────────────────────────────────
// motivul pentru care o zi neconfirmată nu s-a salvat (pentru zile_nesalvate)
// deno-lint-ignore no-explicit-any
export function motivNesalvat(z: any, scriere: 'ok' | 'deja' | 'eroare' | null): string {
  if (z?.tranzitoriu) return 'tranzitoriu (se reia): ' + z.tranzitoriu
  if (z?.respins) return 'respins: ' + z.respins
  if (scriere === 'eroare') return 'scriere eșuată'
  if (z?.eroare) return 'eroare: ' + z.eroare
  return 'eroare'
}
export type Nesalvata = { site_id: number; zi: string; motiv: string }
// complet = fiecare zi cerută are rezultat dovedit; ok = complet și fără erori. Un lot doar cu tranzitorii (5xx / 429 / rețea) = ok:false,
// complet:false (înainte r2 dădea ok:true). Lista e plafonată (62), numărul nu.
export function rezultatLot(erori: string[], nesalvate: Nesalvata[]) {
  const complet = nesalvate.length === 0
  return { ok: complet && erori.length === 0, complet, nr_nesalvate: nesalvate.length, zile_nesalvate: nesalvate.slice(0, 62) }
}
// starea HTTP a răspunsului funcției: 207 când pasul Xweather a rulat și nu e complet (rămâne 2xx pentru apelanții existenți, dar
// se vede în net._http_response.status_code al cron-ului); 200 altfel
export const statusHttpXweather = (xw: { ok?: unknown } | null | undefined) => (xw != null && xw.ok !== true ? 207 : 200)
