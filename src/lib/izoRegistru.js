// Izometrie — ajutoare pentru picker-ul de serie din registrul de țeavă (doar citire; fără scriere în registru).

// Seria canonică, aceeași regulă ca magazie_bucati.serie_canon (20261102a):
// upper(regexp_replace(serie, '[[:space:]._/-]', '', 'g'))
export const serieCanon = (s) => String(s ?? '').toUpperCase().replace(/[\s._/-]/g, '')

// Dimensiunea scrisă din registru, în formatul rândurilor existente din executie_tevi („610X7.1”); la curbe se adaugă
// unghiul („610X8 30°”), ca extractUnghi din Izometrie.jsx să-l poată citi
export const dimensiuneDinRegistru = (b) => {
  if (!b.diametru_mm && b.perete_mm == null) return null
  const baza = `${b.diametru_mm || ''}X${b.perete_mm != null ? Number(b.perete_mm) : ''}`
  return b.tip_cod === 'curba' && b.unghi_curba != null ? `${baza} ${Number(b.unghi_curba)}°` : baza
}

// Patch-ul pentru rândul de pachet la alegerea unei bucăți: seria, șarja, lungimea (doar țeava), dimensiunea și, la
// curbe, unghiul — luat DIRECT din registru (nu re-parsat din dimensiune: extractUnghi citește doar cifre întregi)
export const patchDinRegistru = (b) => {
  const patch = { serie_unica: b.serie }
  if (b.sarja) patch.sarja = b.sarja
  if (b.tip_cod === 'teava' && b.lungime_mm != null) patch.lungime_m = Number(b.lungime_mm) / 1000
  const dim = dimensiuneDinRegistru(b)
  if (dim) patch.dimensiune = dim
  if (b.tip_cod === 'curba' && b.unghi_curba != null) patch.unghi_curba = `${Number(b.unghi_curba)}°`
  return patch
}

// Citește TOATE rândurile unei interogări, pe pagini, avansând cu numărul de rânduri PRIMITE (PostgREST poate întoarce mai
// puțin decât pagina cerută, după max-rows). Cere numărul exact (`count: 'exact'` în select): fără el, sau dacă o pagină
// vine goală înainte de total, întoarce eroare de incompletitudine — niciodată o listă trunchiată tăcut.
export async function citesteTot(construieste, pas = 1000) {
  const rez = []
  for (;;) {
    const { data, error, count } = await construieste().range(rez.length, rez.length + pas - 1)
    if (error) return { data: null, error }
    if (count == null) return { data: null, error: { message: 'serverul nu a raportat numărul de rânduri (count)' } }
    const n = data?.length || 0
    rez.push(...(data || []))
    if (rez.length >= count) return { data: rez, error: null }
    if (n === 0) return { data: null, error: { message: `listă incompletă: ${rez.length} din ${count} rânduri` } }
  }
}

// Paznicul cererilor asincrone: fiecare încărcare nouă primește o generație; un răspuns sosit după ce a pornit alta (alt
// pachet) e ignorat. Reîmprospătările iau generația curentă fără s-o schimbe, deci sunt anulate de o încărcare nouă.
export const paznicCereri = () => {
  let g = 0
  return { porneste: () => ++g, actuala: () => g, curenta: (t) => t === g }
}

// Reîmprospătarea pachetului CURENT, nu a celui din closure-ul operației care o cheamă (Jak #824 r3): o continuare de
// salvare pornită pe T12 și terminată după trecerea pe T13 reîncarcă T13; un răspuns sosit după altă navigare e ignorat.
export async function reimprospateaza(idRef, paznic, citeste, aplica) {
  const id = idRef.current
  const gen = paznic.actuala()
  const data = await citeste(id)
  if (!paznic.curenta(gen) || id !== idRef.current) return false
  aplica(data)
  return true
}

// UPDATE cu CAS pe pachet (Copilot #824 r3): scrie doar dacă rândul e ÎNCĂ în pachetul afișat; exact un rând, altfel
// „mutat între timp” (alt utilizator l-a mutat în alt pachet) și nimic scris
export async function actualizeazaRandInPachet(client, rowId, pachetId, patch) {
  const { data, error } = await client.from('executie_tevi').update(patch).eq('id', rowId).eq('pachet_id', pachetId).select('id')
  if (error) return { ok: false, error }
  if (!data || data.length !== 1) return { ok: false, mutat: true }
  return { ok: true }
}

// Unghiul ca număr, din registru (numeric) sau din rândul de pachet (text „22.5°” / „30˚” / „22,5”)
const unghiNum = (u) => {
  if (u == null || u === '') return null
  const n = parseFloat(String(u).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

// Cheia de identitate pe TIP (Copilot #824 P2): țeava = seria canonică; curba = serie + șarjă + unghi (aceeași serie
// de curbă se repetă legitim pe șarje / unghiuri diferite — ca ux_magbuc_izo_curba din registru)
export const cheieTeava = (serie) => `T:${serieCanon(serie)}`
export const cheieCurba = (serie, sarja, unghi) => `C:${serieCanon(serie)}|${serieCanon(sarja)}|${unghiNum(unghi) ?? ''}`
export const cheieBucata = (b) => b.tip_cod === 'curba' ? cheieCurba(b.serie, b.sarja, b.unghi_curba) : cheieTeava(b.serie)

// Rândurile de pachet ale proiectului deja completate: cheie pe tip → [{ id, cod }]
export const indexFolosite = (randuri) => {
  const m = {}
  for (const t of randuri || []) {
    if (!serieCanon(t.serie_unica)) continue
    let k
    if (t.tip_rand === 'teava') k = cheieTeava(t.serie_unica)
    else if (t.tip_rand === 'curba') k = cheieCurba(t.serie_unica, t.sarja, t.unghi_curba)
    else continue
    if (!m[k]) m[k] = []
    m[k].push({ id: t.id, cod: t.pachet?.cod_document_full })
  }
  return m
}

// Lista de sugestii pentru un rând: filtrată după ce s-a tastat (canonic, „conține”); bucățile folosite deja în ALT rând
// (aceeași cheie pe tip) sunt marcate și puse la final; în rest ordonate după serie.
// folosite = null → seriile folosite nu s-au putut verifica: nicio marcare (avertismentul îl pune UI-ul)
export const sugestiiRegistru = (registru, folosite, draft, rowId) => {
  const q = serieCanon(draft)
  return (registru || [])
    .filter(b => !q || serieCanon(b.serie).includes(q))
    .map(b => ({ b, alte: ((folosite || {})[cheieBucata(b)] || []).filter(f => f.id !== rowId) }))
    .sort((x, y) => (x.alte.length > 0) - (y.alte.length > 0) || String(x.b.serie).localeCompare(String(y.b.serie)))
}
