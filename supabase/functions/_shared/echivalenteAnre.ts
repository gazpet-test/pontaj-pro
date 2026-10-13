// Echivalențe ANRE între legitimațiile de PERSOANĂ (nomenclatura veche, pre-Ord. 132/2021) și codurile cerute în fișe.
// Decizia Răzvan 12.10.2026 (claude_context #1727 pct. 2): echivalența e ACCEPTATĂ, dar ca MAPARE EXPLICITĂ APROBATĂ, nu lăsată
// la judecata AI. Lista se completează DOAR cu perechile aprobate de Răzvan (propunerea: docs/ofertare/PLAN_TRIERE_102.md, D4).
// Cât e goală, se acceptă doar codul literal — orice altă potrivire iese „echivalență nevalidată” (fail-closed, nu verde).
// Regula de fond a propunerii: același domeniu (transport / distribuție / utilizare) și același fel (execuție / proiectare).

export type Echivalenta = { vechi: string; nou: string }

export const ECHIVALENTE_APROBATE: Echivalenta[] = [
  // ex. { vechi: 'EGT', nou: '<cod nou din Ord. ANRE, confirmat de Răzvan>' } — NU se completează din memorie
]

// Codul de la începutul denumirii tipului de autorizație („EGT - Executant Gaze Transport [...]” → „EGT”).
export function codTip(denumire: string): string | null {
  const m = /^\s*([A-Z]{2,6})\b\s*[-–—(:]/.exec(String(denumire || ''))
  return m ? m[1] : null
}

// O persoană (cu codurile ei valabile) acoperă codul cerut? literal, sau printr-o echivalență APROBATĂ.
export function acoperaCod(coduriPersoana: Iterable<string>, codCerut: string, aprobate: Echivalenta[] = ECHIVALENTE_APROBATE):
  { acoperit: boolean; prin: 'literal' | 'echivalenta' | null; cod: string | null } {
  const cerut = String(codCerut || '').trim().toUpperCase()
  if (!cerut) return { acoperit: false, prin: null, cod: null }
  const are = new Set([...coduriPersoana].map((c) => String(c).toUpperCase()))
  if (are.has(cerut)) return { acoperit: true, prin: 'literal', cod: cerut }
  for (const e of aprobate) {
    if (e.nou.toUpperCase() === cerut && are.has(e.vechi.toUpperCase())) return { acoperit: true, prin: 'echivalenta', cod: e.vechi.toUpperCase() }
  }
  return { acoperit: false, prin: null, cod: null }
}
