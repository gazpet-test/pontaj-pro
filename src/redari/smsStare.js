// Redări — starea SMS pe deținător (cine a primit, cine nu, de câte ori). Sursa: RPC fn_red_sms_stare(p_proiect_id) (migrarea 20261130i),
// care întoarce DOAR agregate (fără text, telefon, cod de eroare). Definițiile stărilor stau în SQL (o singură definiție, L19):
//   nr_trimise = acceptate de operator (trimis_la nenul) · nr_livrate = confirmate livrate · nr_esuate = eșuate (la trimitere sau după)
//   nr_in_curs = rezervate / în coadă într-un lot aprobat · categorie = livrat > trimis (fără confirmare) > in_curs > esuat.
// Aici: validarea răspunsului (listă albă, numere întregi ≥ 0 — un răspuns stricat e eroare, nu „niciun SMS”, L18), harta pe deținător,
// filtrul din Registru, textele afișate și CSV-ul „Lista SMS” (intern; fără telefon).

export const STARI_SMS = {
  livrat: { eticheta: 'livrat', icon: '✅', culoare: '#3FB950' },
  trimis: { eticheta: 'trimis', icon: '📤', culoare: '#58A6FF' },
  in_curs: { eticheta: 'în curs', icon: '⏳', culoare: '#D29922' },
  esuat: { eticheta: 'eșuat', icon: '❌', culoare: '#F85149' },
}
const CATEGORII = ['livrat', 'trimis', 'in_curs', 'esuat']

// Filtrul din Registru. „nelivrat” = categorie trimis SAU in_curs (a plecat / pleacă, fără confirmare de livrare); eticheta r4: „neconfirmat”.
export const FILTRE_SMS = [
  { cod: '', eticheta: 'SMS: toate' },
  { cod: 'fara', eticheta: 'SMS: fără SMS' },
  { cod: 'nelivrat', eticheta: 'SMS: neconfirmat (trimis / în curs)' },
  { cod: 'livrat', eticheta: 'SMS: livrat' },
  { cod: 'esuat', eticheta: 'SMS: eșuat' },
]

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const intreg = (v, camp) => {
  if (!Number.isInteger(v) || v < 0) throw new Error(`Stare SMS invalidă: ${camp} nu e un număr întreg ≥ 0.`)
  return v
}
const moment = (v, camp) => {
  if (v == null) return null
  if (typeof v !== 'string' || !Number.isFinite(Date.parse(v))) throw new Error(`Stare SMS invalidă: ${camp} nu e o dată.`)
  return v
}

// Un rând din RPC → obiect validat. Aruncă la orice abatere (stare necunoscută, număr lipsă, id invalid).
export function normalizeazaRand(r) {
  if (!r || typeof r !== 'object') throw new Error('Stare SMS invalidă: rând lipsă.')
  if (typeof r.detinator_id !== 'string' || !UUID.test(r.detinator_id)) throw new Error('Stare SMS invalidă: deținător fără id.')
  if (!CATEGORII.includes(r.ultima_stare)) throw new Error(`Stare SMS necunoscută: ${String(r.ultima_stare)}`)
  if (!CATEGORII.includes(r.categorie)) throw new Error(`Categorie SMS necunoscută: ${String(r.categorie)}`)
  const s = {
    detinator_id: r.detinator_id.toLowerCase(),
    nr_trimise: intreg(r.nr_trimise, 'nr_trimise'), nr_livrate: intreg(r.nr_livrate, 'nr_livrate'),
    nr_esuate: intreg(r.nr_esuate, 'nr_esuate'), nr_in_curs: intreg(r.nr_in_curs, 'nr_in_curs'), loturi: intreg(r.loturi, 'loturi'),
    ultima_stare: r.ultima_stare, categorie: r.categorie,
    ultima_trimitere: moment(r.ultima_trimitere, 'ultima_trimitere'), ultima_livrare: moment(r.ultima_livrare, 'ultima_livrare'),
  }
  if (s.loturi < 1) throw new Error('Stare SMS invalidă: rând fără lot.')
  if (s.nr_livrate > s.nr_trimise) throw new Error('Stare SMS invalidă: mai multe livrate decât trimise.')
  if ((s.categorie === 'livrat') !== (s.nr_livrate > 0)) throw new Error('Stare SMS invalidă: categoria nu se potrivește cu livrările.')
  return s
}

// Răspunsul RPC → Map(detinator_id → stare). data trebuie să fie listă (null / obiect = eroare, nu „niciun SMS”); duplicatele = eroare.
export function hartaSms(data) {
  if (!Array.isArray(data)) throw new Error('Stare SMS: răspuns fără listă.')
  const m = new Map()
  for (const r of data) {
    const s = normalizeazaRand(r)
    if (m.has(s.detinator_id)) throw new Error('Stare SMS: deținător duplicat în răspuns.')
    m.set(s.detinator_id, s)
  }
  return m
}

// Citirea completă din RPC, keyset pe detinator_id (L23): un proiect poate avea peste max-rows (1000) deținători cu SMS, iar PostgREST
// trunchiază tacit și rezultatul unei funcții. Pagină goală = gata; o pagină care nu avansează = eroare; curent() fals = abandon.
export const PAGINA_SMS = 500
export async function citesteSmsStare(client, proiectId, curent = () => true) {
  const tot = []
  let ultim = null
  while (curent()) {
    let q = client.rpc('fn_red_sms_stare', { p_proiect_id: proiectId }).order('detinator_id')
    if (ultim) q = q.gt('detinator_id', ultim)
    const { data, error } = await q.limit(PAGINA_SMS)
    if (error) throw error
    if (!curent()) throw new Error('Citire SMS abandonată: proiectul s-a schimbat.')
    if (!Array.isArray(data)) throw new Error('Stare SMS: răspuns fără listă.')
    if (!data.length) return hartaSms(tot)
    const urm = data.at(-1)?.detinator_id
    if (typeof urm !== 'string' || (ultim && urm <= ultim)) throw new Error('Stare SMS: paginarea nu a avansat.')
    tot.push(...data); ultim = urm
  }
  throw new Error('Citire SMS abandonată.')
}

export const stareSmsPentru =(harta, detinatorId) => (harta && detinatorId ? harta.get(String(detinatorId).toLowerCase()) || null : null)

// Categoria pentru filtru: 'fara' dacă deținătorul nu are niciun SMS numărat.
export function categorieFiltru(stare) {
  if (!stare) return 'fara'
  if (stare.categorie === 'trimis' || stare.categorie === 'in_curs') return 'nelivrat'
  return stare.categorie
}
// filtru '' = toate; altfel exact categoria. Cod de filtru necunoscut = eroare (nu „toate” tacit).
export function potrivesteFiltru(stare, filtru) {
  if (!filtru) return true
  if (!FILTRE_SMS.some(f => f.cod === filtru)) throw new Error(`Filtru SMS necunoscut: ${filtru}`)
  return categorieFiltru(stare) === filtru
}

// Data în ziua din București (instant → zi calendaristică), ZZ.LL.AAAA
export function dataSms(v) {
  if (!v) return ''
  const dt = new Date(v)
  if (!Number.isFinite(dt.getTime())) return ''
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(dt).map(x => [x.type, x.value]))
  return `${p.day}.${p.month}.${p.year}`
}

// Textul badge-ului: „✅ livrat ×2 · 04.11.2026” (×N doar când s-a trimis de mai multe ori; data = ultima trimitere)
export function textBadge(stare) {
  if (!stare) return '—'
  const st = STARI_SMS[stare.ultima_stare]
  const ori = stare.nr_trimise > 1 ? ` ×${stare.nr_trimise}` : ''
  const data = dataSms(stare.ultima_trimitere)
  return `${st.icon} ${st.eticheta}${ori}${data ? ` · ${data}` : ''}`
}

// Rezumatul (tooltip în Registru, rândul din Fișa parcelei)
export function rezumatSms(stare) {
  if (!stare) return 'niciun SMS'
  const parti = [`trimise ${stare.nr_trimise}`, `livrate ${stare.nr_livrate}`, `eșuate ${stare.nr_esuate}`]
  if (stare.nr_in_curs) parti.push(`în curs ${stare.nr_in_curs}`)
  parti.push(`loturi ${stare.loturi}`)
  const d = []
  if (stare.ultima_trimitere) d.push(`ultima trimitere ${dataSms(stare.ultima_trimitere)}`)
  if (stare.ultima_livrare) d.push(`ultima livrare ${dataSms(stare.ultima_livrare)}`)
  return parti.join(' · ') + (d.length ? ` (${d.join(', ')})` : '')
}

// Intrări pentru cronologia din Fișa parcelei — doar ce se poate spune cert din agregate (ultima trimitere / ultima livrare).
// Eșecul / „în curs” nu au o dată în agregate: apar doar ca stare curentă, nu ca intrare datată.
export function intrariCronologie(stare) {
  if (!stare) return []
  const out = []
  if (stare.ultima_trimitere) out.push({ data: stare.ultima_trimitere, eticheta: `📤 SMS trimis${stare.nr_trimise > 1 ? ` (ultimul din ${stare.nr_trimise})` : ''}` })
  if (stare.ultima_livrare) out.push({ data: stare.ultima_livrare, eticheta: '✅ SMS livrat' })
  return out
}

// CSV „Lista SMS” (intern): un rând pe rândul de registru (parcelă × deținător). Fără telefon / text SMS. ; ca separator (Excel RO), BOM UTF-8.
export const ANTET_CSV_SMS = ['ID parcelă', 'UAT', 'Deținător', 'SMS trimise', 'SMS livrate', 'SMS eșuate', 'SMS în curs', 'Ultima stare', 'Ultima trimitere', 'Ultima livrare']
const celula = (v) => {
  const s = String(v ?? '')
  // anti formula-injection în Excel: =, +, -, @ la început → prefix apostrof
  const t = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
  return /[";\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
}
export function csvListaSms(randuri, harta) {
  const linii = [ANTET_CSV_SMS.map(celula).join(';')]
  for (const r of randuri) {
    const s = stareSmsPentru(harta, r.detinator_id)
    linii.push([r.id_parcela, r.uat3, r.nume, s ? s.nr_trimise : 0, s ? s.nr_livrate : 0, s ? s.nr_esuate : 0, s ? s.nr_in_curs : 0,
      s ? STARI_SMS[s.ultima_stare].eticheta : 'fără SMS', s ? dataSms(s.ultima_trimitere) : '', s ? dataSms(s.ultima_livrare) : ''].map(celula).join(';'))
  }
  return '﻿' + linii.join('\r\n') + '\r\n'
}
