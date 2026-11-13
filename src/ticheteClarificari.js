// Clarificări automate pe tichete (migrarea 20261223a, NEAPLICATĂ până la decizia owner-ului): DOAR afișarea.
// Comentariile automate sunt scrise de bază FĂRĂ autor (autor = NULL) și sunt listate în tichet.metadata.clarificari_erp.comentarii.
// Un comentariu e „Echipa ERP” DOAR dacă îndeplinește AMBELE condiții: id-ul e în listă ȘI autorul lipsește (un om nu poate scrie un
// comentariu fără autor: politica de INSERT cere autor = contul lui; un id al unui comentariu cu autor, pus în listă de mână, nu schimbă
// nimic). Comentariile vechi cu autor șters (tot autor NULL, dar nelistate) rămân ca înainte („?”).
// Nimic de aici nu cheamă funcțiile noi: cu migrarea neaplicată, metadata nu are cheia și totul se afișează exact ca azi.
export const AUTOR_AUTOMAT = 'Echipa ERP'
export const ETICHETA_AUTOMAT = 'mesaj automat'
// stările în care tichetul mai poate primi un răspuns (aceeași listă albă ca în bază: fn_tichet_clarificare_stare_tichet)
const STARI_DESCHISE = ['deschis', 'atribuit', 'in_analiza', 'in_lucru']

// id-urile comentariilor automate ale tichetului (set de numere; orice formă neașteptată = set gol, adică afișarea de azi)
export function idsComentariiAutomate(tichet) {
  const ids = tichet?.metadata?.clarificari_erp?.comentarii
  if (!Array.isArray(ids)) return new Set()
  return new Set(ids.filter(x => Number.isSafeInteger(x) && x > 0))
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

// semnul „așteaptă răspunsul tău”: doar autorului tichetului, cât timp evidența spune că se așteaptă răspunsul lui și tichetul e deschis
export function asteaptaRaspunsulTau(tichet, profileId) {
  if (!profileId || !tichet || tichet.deschis_de !== profileId) return false
  return tichet.metadata?.clarificari_erp?.faza === 'asteapta_autor' && STARI_DESCHISE.includes(tichet.status)
}
