// Redări teren — identificatori: codul de 3 litere al UAT-ului, id-ul parcelei, normalizarea numelor.
// Contract: docs/redari/CONTRACT_SCHEMA.md §2 (red_uat.uat3, red_parcele.id_parcela, red_detinatori.nume_normalizat).

// Scoate diacriticele (inclusiv ș/ț cu virgulă SAU sedilă — ambele se descompun în NFD) și întoarce textul ca string.
export function faraDiacritice(text) {
  return String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/**
 * uat3(numeUat, override?) → 3 litere mari fără diacritice din nume: „Prunișor”→PRU, „Bâlvănești”→BAL, „Șișești”→SIS.
 * `override` (ex. 'HUS') câștigă dacă e dat; trebuie să fie exact 3 litere.
 */
export function uat3(numeUat, override) {
  if (override != null && String(override).trim() !== '') {
    const o = faraDiacritice(override).toUpperCase().replace(/[^A-Z]/g, '')
    if (o.length !== 3) throw new Error(`uat3: override invalid „${override}” (trebuie exact 3 litere)`)
    return o
  }
  const litere = faraDiacritice(numeUat).toUpperCase().replace(/[^A-Z]/g, '')
  if (litere.length < 3) throw new Error(`uat3: numele „${numeUat}” nu are 3 litere`)
  return litere.slice(0, 3)
}

/**
 * idParcela(tronson, uat3, n) → 'T3-HUS-0001'. tronson 1..11, uat3 = 3 litere mari, n ≥ 1 (4 cifre cu zero-uri, mai multe peste 9999).
 */
export function idParcela(tronson, cod3, n) {
  const t = Number(tronson)
  if (!Number.isInteger(t) || t < 1 || t > 11) throw new Error(`idParcela: tronson invalid „${tronson}” (1..11)`)
  if (!/^[A-Z]{3}$/.test(String(cod3))) throw new Error(`idParcela: uat3 invalid „${cod3}”`)
  const nr = Number(n)
  if (!Number.isInteger(nr) || nr < 1) throw new Error(`idParcela: număr invalid „${n}”`)
  if (nr > 9999) throw new Error(`idParcela: numărul ${nr} depășește 9999 (formatul e fix 4 cifre)`)
  return `T${t}-${cod3}-${String(nr).padStart(4, '0')}`
}

/** idParcelaProvizoriu(tronson, uat3) → 'T3-HUS-????' — afișat în preview până la rezervarea numerelor la commit. */
export function idParcelaProvizoriu(tronson, cod3) {
  const t = Number(tronson)
  if (!Number.isInteger(t) || t < 1 || t > 11) throw new Error(`idParcelaProvizoriu: tronson invalid „${tronson}” (1..11)`)
  if (!/^[A-Z]{3}$/.test(String(cod3))) throw new Error(`idParcelaProvizoriu: uat3 invalid „${cod3}”`)
  return `T${t}-${cod3}-????`
}

/**
 * normalizeazaNume(nume) → majuscule, fără diacritice, fără punctuație dublă, spații simple, trim.
 * Ex. „  Popescu   Ion,, jr. ” → 'POPESCU ION, JR.'
 */
export function normalizeazaNume(nume) {
  return faraDiacritice(nume)
    .toUpperCase()
    .replace(/([.,;:!?'"\-\/()])\1+/g, '$1')  // punctuație repetată → una singură
    .replace(/\s+([.,;:!?])/g, '$1')           // fără spațiu înaintea punctuației
    .replace(/\s+/g, ' ')
    .trim()
}
