// Codurile de normă din pontaj — o singură definiție pentru selectorul de introducere, importul din Excel,
// afișare, Pontaj BRUT / NET și ordinul de deplasare (înainte erau 5 liste copiate în App.jsx).
// TKT-2026-0368 partea B (decizie Răzvan, de la noiembrie 2026): concediul medical se notează BO (nu CM),
// iar liberele speciale (căsătorie, deces) se notează IP „Învoiri Plătite”, ca în Mentor (nu O).
// CM și O rămân coduri valide la afișare, import, validare și în totaluri, ca lunile vechi (septembrie,
// octombrie) să iasă identic; la introducere se oferă doar pe zilele dinainte de 01.11.2026 (corecturi).

export const NORME = ['BO', 'BP', 'AM', 'CO', 'CFP', 'CM', 'M', 'O', 'IP', 'N', 'PRM', 'PRB', 'LL']

export const NORME_LABELS = {
  BO: 'Boală Obișnuită', BP: 'Boală Profesională', AM: 'Accident de Muncă', CO: 'Concediu Odihnă',
  CFP: 'Concediu Fără Plată', CM: 'Concediu Medical', M: 'Maternitate', O: 'Obligații Cetățenești',
  IP: 'Învoiri Plătite', N: 'Absențe Nemotivate', PRM: 'Prog.Redus Maternitate', PRB: 'Prog.Redus Boală', LL: 'Liber Legal',
}

// Coduri vechi: valide, dar nu se mai oferă la introducere (CM → BO, O → IP)
export const NORME_RETRASE = ['CM', 'O']

export const NORME_SELECTOR = NORME.filter(n => !NORME_RETRASE.includes(n))

// Normele plătite cu ore de normă (h normă/zi) în Pontaj BRUT (TKT-2026-0314); CFP, N, PRM, PRB, LL = 0 ore.
// IP se plătește ca O.
export const NORME_ORE = ['CO', 'CM', 'BO', 'BP', 'AM', 'M', 'O', 'IP']

// Codul exact (majuscule, fără spații) dacă e o normă validă, altfel null — pentru importul din Excel
export function codNorma(val) {
  const c = String(val ?? '').trim().toUpperCase()
  return NORME.includes(c) ? c : null
}

// Prima zi pontată cu codurile noi (BO / IP). Zilele de dinainte se corectează cu codurile de atunci (CM / O),
// ca exporturile BRUT / NET ale lunilor vechi să rămână pe aceleași coloane (ZILE CM, ZILE O).
export const DATA_CODURI_NOI = '2026-11-01'

// Codurile oferite la introducere pentru zilele dinainte de DATA_CODURI_NOI (lista de dinainte de tichet, fără IP)
export const NORME_SELECTOR_ISTORIC = NORME.filter(n => n !== 'IP')

// Ziua pontată e dinainte de trecerea la BO / IP? Doar pe data exactă „AAAA-LL-ZZ” (comparație de text, fără
// new Date / fus orar); o dată lipsă sau în alt format = zi nouă (lista curentă).
export function ziCuCoduriIstorice(zi) {
  return typeof zi === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(zi) && zi < DATA_CODURI_NOI
}

// Opțiunile selectorului de normă pentru ziua pontată `zi` („AAAA-LL-ZZ”):
// - zi dinainte de 01.11.2026: codurile istorice (cu CM și O, fără IP);
// - de la 01.11.2026: codurile noi (BO / IP, fără CM și O);
// - codul deja salvat pe zi rămâne mereu în listă, chiar dacă nu e al perioadei (editarea nu-l pierde
//   și nu-l afișează gol).
export function optiuniSelectorNorma(curent, zi) {
  const lista = ziCuCoduriIstorice(zi) ? NORME_SELECTOR_ISTORIC : NORME_SELECTOR
  return curent && !lista.includes(curent) ? [...lista, curent] : lista
}
