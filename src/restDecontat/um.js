// ═══════════════════════════════════════════════════════════════════════════
// restDecontat/um.js — normalizarea UM pentru „Rest de decontat”: OGLINDA lui fn_rest_decontat_um din migrarea
// 20270105a (lista UM-START / UM-END). O singură definiție în JS (L19); testul de paritate din parsareSituatie.test.js
// citește lista din migrare și o compară cu UM_LISTA de aici — orice schimbare se face în amândouă.
// Cantitățile se compară DOAR pe UM normalizat egal; nimic nu se adună brut între UM-uri diferite (Review Focus 2).
// NU e același lucru cu `umInfo` din devizParser.js (regula veche a catalogului F3, cu alte unități de bază, în litere mici).
// ═══════════════════════════════════════════════════════════════════════════

// [UM scris fără spații / puncte, factor spre unitatea de bază, unitatea de bază] — exact rândurile din migrare
export const UM_LISTA = [
  ['M', 1, 'M'], ['ML', 1, 'M'], ['HM', 100, 'M'], ['KM', 1000, 'M'], ['100M', 100, 'M'],
  ['MC', 1, 'MC'], ['M3', 1, 'MC'], ['100MC', 100, 'MC'], ['1000MC', 1000, 'MC'],
  ['MP', 1, 'MP'], ['M2', 1, 'MP'], ['100MP', 100, 'MP'], ['HA', 10000, 'MP'],
  ['BUC', 1, 'BUC'], ['100BUC', 100, 'BUC'], ['KG', 1, 'KG'], ['T', 1000, 'KG'], ['TO', 1000, 'KG'], ['100KG', 100, 'KG'],
]
const UM_MAP = new Map(UM_LISTA.map(([u, f, b]) => [u, { um: b, factor: f }]))

/** Ca în SQL: upper(regexp_replace(coalesce(p_um, ''), '[[:space:].]', '', 'g')) — spațiile POSIX (fără NBSP) și punctele dispar. */
export const umCanonic = um => String(um ?? '').replace(/[ \t\n\r\f\v.]/g, '').toUpperCase()

/**
 * normalizeUm('100 MC') → { um: 'MC', factor: 100 }; UM necunoscut = el însuși (majuscule, fără spații / puncte), factor 1 —
 * identic cu fn_rest_decontat_um. Gol → { um: '', factor: 1 } (ca în SQL; apelantul decide că e lipsă).
 */
export function normalizeUm(um) {
  const u = umCanonic(um)
  const gasit = UM_MAP.get(u)
  return gasit ? { um: gasit.um, factor: gasit.factor } : { um: u, factor: 1 }
}

/** Două UM-uri brute înseamnă același lucru? (după normalizare; '' nu e egal cu nimic, nici cu '') */
export const acelasiUm = (a, b) => {
  const x = normalizeUm(a).um, y = normalizeUm(b).um
  return x !== '' && x === y
}
