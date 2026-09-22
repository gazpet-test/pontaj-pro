// Ordinea candidaților unei cerințe de ofertare — deterministă, cu egalitățile la vedere.
//
// DE CE EXISTĂ. Motorul propune până la 3 candidați per cerință. Măsurat pe 21.09.2026,
// două rulări IDENTICE schimbau candidatul de pe locul 1 la 5 din 10 cerințe, deși păstrau
// același set de candidați la 6 din 10 — iar cele două rulări erau perfect inverse. Adică
// ordinea între candidați cu scor egal era hazard, dar omul din fața ecranului o citea ca
// pe o recomandare a motorului. Aici hazardul dispare; egalitatea se arată, nu se ascunde.
//
// Ordinea, în trepte:
//   1. alegerea omului (`ales_de`) — nimic nu trece peste ea;
//   2. dovada verificată pe scan;
//   3. scorul AI, descrescător (lipsa scorului = ultimul);
//   4. `id` crescător — departajare stabilă, deci aceeași ordine la fiecare încărcare.

// ATENȚIE la `Number(null) === 0` (anti-bug consemnat 11.09.2026): fără verificarea
// explicită de null/'' de mai jos, un candidat FĂRĂ scor era citit ca „scor 0" și urca
// înaintea unuia cu scor 0 real, după id. Prins de test, nu de citirea codului.
// Acceptă DOAR un număr, sau un șir care conține un număr. Orice altceva (null, undefined,
// '', '   ', false, [], {}) înseamnă „fără scor", nu zero.
// Jakarinos a măsurat, pe 22.09.2026, că varianta precedentă (`v === ''`) lăsa să treacă
// `'   '`, `false` și `[]` drept scor 0 — `Number()` le transformă pe toate în 0. Un candidat
// fără scor urca astfel înaintea unuia cu scor 0 real.
export const scorNumeric = v => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

export const cheieOrdine = a => {
  const s = scorNumeric(a?.scor)
  return [
    a?.ales_de ? 0 : 1,
    a?.verificat_pe_scan ? 0 : 1,
    s === null ? Infinity : -s,   // fără scor = ultimul, oricât de mic ar fi scorul celorlalți
    Number(a?.id) || 0,
  ]
}

export const inainte = (x, y) => {
  const p = cheieOrdine(x), q = cheieOrdine(y)
  for (let i = 0; i < p.length; i++) if (p[i] !== q[i]) return p[i] - q[i]
  return 0
}

// O decizie (aleasă de om sau verificată pe scan) nu e „la egalitate" cu nimic:
// acolo nu mai are ce să aleagă omul, s-a ales deja.
const eDecizie = r => Boolean(r?.ales_de || r?.verificat_pe_scan)

/**
 * Grupează rândurile de acoperire pe cerință și întoarce, pentru fiecare, candidatul de pe
 * primul loc, îmbogățit cu:
 *   · `alternative`  — ceilalți candidați, în aceeași ordine deterministă;
 *   · `la_egalitate` — câți dintre ei au exact scorul primului (0 dacă primul e o decizie).
 */
export function grupeazaAcoperiri(randuri) {
  const peCerinta = {}
  for (const a of (randuri || [])) {
    if (!a || a.cerinta_id == null) continue
    ;(peCerinta[a.cerinta_id] ||= []).push(a)
  }
  const out = {}
  for (const [cid, lista] of Object.entries(peCerinta)) {
    const [primul, ...restul] = [...lista].sort(inainte)
    const laEgalitate = eDecizie(primul) ? 0
      : restul.filter(r => !eDecizie(r)
          && scorNumeric(r.scor) !== null
          && scorNumeric(r.scor) === scorNumeric(primul.scor)).length
    out[cid] = { ...primul, alternative: restul, la_egalitate: laEgalitate }
  }
  return out
}
