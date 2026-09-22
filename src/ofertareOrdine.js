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

// Doar ALEGEREA omului închide discuția despre egalitate. `verificat_pe_scan` NU e o
// alegere între variante — e o dovadă confirmată pe scan; pot exista în continuare alte
// variante la fel de bine punctate, iar omul are dreptul să le vadă.
// (Corectat 22.09.2026 după observația lui Jakarinos: prima variantă le confunda.)
const eAlesDeOm = r => Boolean(r?.ales_de)

// Cheia de grupare: PERECHEA cerință + poziție, nu doar cerința.
// O cerință CUMULATIVĂ are mai multe poziții, fiecare cu dovada ei (diplomă pe o poziție,
// adeverință de vechime pe alta). Alea NU sunt alternative — sunt un dosar care se adună.
// Gruparea doar pe `cerinta_id` le-ar fi pus pe toate sub „alți candidați propuși", adică
// exact distincția din AGENTS.md pe care nu avem voie s-o pierdem. Azi `pozitie_id` e NULL
// pe toate cele 2253 de rânduri din producție, deci greșeala e latentă, nu vizibilă — dar
// devine vizibilă în ziua în care motorul începe să completeze poziții.
const cheiePozitie = a => `${a.cerinta_id}|${a.pozitie_id ?? ''}`

/**
 * Grupează rândurile de acoperire și întoarce, per CERINȚĂ, candidatul de pe primul loc,
 * îmbogățit cu:
 *   · `alternative`   — ceilalți candidați DE PE ACEEAȘI POZIȚIE, în ordine deterministă;
 *   · `la_egalitate`  — câți dintre ei au exact scorul primului (0 dacă primul e ales de om);
 *   · `alte_pozitii`  — câte alte poziții ale aceleiași cerințe mai au acoperire. Alea sunt
 *                       obligații care se adună, nu variante — de aceea sunt numărate
 *                       separat și nu intră niciodată în `alternative`.
 */
export function grupeazaAcoperiri(randuri) {
  const pePozitie = {}
  for (const a of (randuri || [])) {
    if (!a || a.cerinta_id == null) continue
    ;(pePozitie[cheiePozitie(a)] ||= []).push(a)
  }

  // Pozițiile regrupate pe cerință, ca să știm câte obligații distincte are fiecare.
  const peCerinta = {}
  for (const lista of Object.values(pePozitie)) {
    const ordonate = [...lista].sort(inainte)
    ;(peCerinta[ordonate[0].cerinta_id] ||= []).push(ordonate)
  }

  const out = {}
  for (const [cid, pozitii] of Object.entries(peCerinta)) {
    // Poziția afișată prima: cea cu cel mai bun candidat, după aceeași regulă de ordine.
    pozitii.sort((p, q) => inainte(p[0], q[0]))
    const [primul, ...restul] = pozitii[0]
    const laEgalitate = eAlesDeOm(primul) ? 0
      : restul.filter(r => !eAlesDeOm(r)
          && scorNumeric(r.scor) !== null
          && scorNumeric(r.scor) === scorNumeric(primul.scor)).length
    out[cid] = {
      ...primul,
      alternative: restul,
      la_egalitate: laEgalitate,
      alte_pozitii: pozitii.length - 1,
    }
  }
  return out
}
