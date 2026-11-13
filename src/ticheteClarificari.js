// Clarificări automate pe tichete (migrarea 20261223a, NEAPLICATĂ până la decizia owner-ului): DOAR afișarea.
// Evidența stă în tabelul public.tichete_clarificari (scris DOAR de funcțiile din bază; conturile logate îl pot doar citi). Metadata
// tichetului NU contează (nu e scrisă doar de bază, deci nu e dovadă).
// Un comentariu e „Echipa ERP” DOAR dacă îndeplinește AMBELE condiții: id-ul lui apare în evidență (comentariu_id) ȘI autorul lipsește
// (un om nu poate scrie un comentariu fără autor: politica de INSERT cere autor = contul lui). Comentariile vechi cu autor șters (tot autor
// NULL, dar fără rând în evidență) rămân ca înainte („?”).
// Cu migrarea neaplicată tabelul lipsește: cererea întoarce eroarea „tabel inexistent” => nimic afișat în plus, fără mesaj (afișarea de azi).
// Nimic de aici nu cheamă funcțiile din migrare.
export const AUTOR_AUTOMAT = 'Echipa ERP'
export const ETICHETA_AUTOMAT = 'mesaj automat'
export const TABEL_EVIDENTA = 'tichete_clarificari'
// cel mult 3 rânduri pe tichet (runda 1, runda 2, încheierea) => o bucată de 200 de tichete aduce cel mult 600 de rânduri (sub plafonul
// de 1000 al serverului, L23); mai multe = răspuns neașteptat => eroare, nu trunchiere tăcută
export const MARIME_BUCATA = 200
const RANDURI_PE_TICHET = 3
// stările în care tichetul mai poate primi un răspuns (aceeași listă albă ca în bază: fn_tichet_clarificare_stare_tichet)
const STARI_DESCHISE = ['deschis', 'atribuit', 'in_analiza', 'in_lucru']

// tabelul nu există (migrarea neaplicată): Postgres 42P01 sau PostgREST PGRST205 („nu e în schema cache”)
export function esteTabelLipsa(error) {
  const cod = String(error?.code || '')
  return cod === '42P01' || cod === 'PGRST205'
}

// tichetele pentru care are sens evidența: cele din butonul de raportare (departament it, eroare_erp / cerere_functie)
export function idsTichetePentruEvidenta(tichete) {
  return (tichete || [])
    .filter(t => t && t.departament === 'it' && ['eroare_erp', 'cerere_functie'].includes(t.subcategorie) && Number.isSafeInteger(Number(t.id)))
    .map(t => Number(t.id))
}

// citește evidența pentru tichetele date, pe bucăți. Rezultat: { randuri, lipsa (tabelul nu există), eroare (orice altă eroare) }
export async function incarcaEvidenta(client, tichetIds) {
  const unice = [...new Set((tichetIds || []).map(Number).filter(x => Number.isSafeInteger(x) && x > 0))]
  const randuri = []
  for (let i = 0; i < unice.length; i += MARIME_BUCATA) {
    const bucata = unice.slice(i, i + MARIME_BUCATA)
    const { data, error } = await client.from(TABEL_EVIDENTA).select('tichet_id, fel, runda, comentariu_id').in('tichet_id', bucata)
    if (error) return esteTabelLipsa(error) ? { randuri: [], lipsa: true, eroare: null } : { randuri: [], lipsa: false, eroare: error }
    if (!Array.isArray(data) || data.length > bucata.length * RANDURI_PE_TICHET) {
      return { randuri: [], lipsa: false, eroare: new Error('evidența clarificărilor are o formă neașteptată') }
    }
    for (const r of data) randuri.push(r)
  }
  return { randuri, lipsa: false, eroare: null }
}

const aleTichetului = (randuri, tichetId) => (Array.isArray(randuri) ? randuri : []).filter(r => r && Number(r.tichet_id) === Number(tichetId))

// id-urile comentariilor automate ale tichetului (set de numere; orice formă neașteptată = set gol, adică afișarea de azi)
export function idsComentariiAutomate(randuri, tichetId) {
  const ids = new Set()
  for (const r of aleTichetului(randuri, tichetId)) {
    const id = Number(r.comentariu_id)
    if (r.comentariu_id != null && Number.isSafeInteger(id)) ids.add(id)
  }
  return ids
}

export function esteComentariuAutomat(comentariu, ids) {
  if (!comentariu || comentariu.autor != null) return false
  const id = Number(comentariu.id)
  return Number.isSafeInteger(id) && ids instanceof Set && ids.has(id)
}

// numele afișat al autorului unui comentariu: „Echipa ERP” (automat), numele profilului, sau „?” (autor șters / necunoscut — ca azi)
export function autorComentariu(comentariu, ids, profiles) {
  if (esteComentariuAutomat(comentariu, ids)) return { nume: AUTOR_AUTOMAT, automat: true, idAvatar: null }
  const p = (profiles || []).find(x => x.id === comentariu?.autor)
  return { nume: p?.name || '?', automat: false, idAvatar: comentariu?.autor || null }
}

// faza din evidență: 'incheiat' / 'clarificat' (s-a încheiat), 'asteapta_autor' (cel puțin o rundă, fără încheiere), null (nimic)
export function fazaClarificari(randuri, tichetId) {
  const r = aleTichetului(randuri, tichetId)
  if (r.some(x => x.fel === 'incheiere')) return 'incheiat'
  if (r.some(x => x.fel === 'clarificat')) return 'clarificat'
  if (r.some(x => x.fel === 'runda')) return 'asteapta_autor'
  return null
}

// semnul „așteaptă răspunsul tău”: doar autorului tichetului, cât timp evidența spune că se așteaptă răspunsul lui și tichetul e deschis
export function asteaptaRaspunsulTau(tichet, profileId, randuri) {
  if (!profileId || !tichet || tichet.deschis_de !== profileId) return false
  return fazaClarificari(randuri, tichet.id) === 'asteapta_autor' && STARI_DESCHISE.includes(tichet.status)
}
