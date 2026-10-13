// Echivalențe ANRE între legitimațiile de PERSOANĂ (nomenclatura veche, pre-Ord. 132/2021) și codurile cerute în fișe.
// Decizia Răzvan: echivalența e ACCEPTATĂ (#1727 pct. 2, 12.10.2026), lista din docs/ofertare/PLAN_TRIERE_102.md D4 APROBATĂ
// (13.10.2026): același FEL (execuție / proiectare) și același DOMENIU (transport / distribuție / utilizare) — niciodată
// distribuție → transport sau proiectare → execuție. Condiția aprobării: codurile NOI (Ord. ANRE 132/2021) se adaugă în
// CODURI_NOI_CONFIRMATE DOAR din textul Ordinului confirmat de Răzvan — nu din memorie. Cât tabelul e gol, se acceptă doar codul
// literal; orice altă potrivire iese „echivalență nevalidată” (fail-closed, nu verde).

export type Clasa = { fel: 'executie' | 'proiectare'; domeniu: 'transport' | 'distributie' | 'utilizare' }

// Codurile vechi de persoană (catalogul hr_autorizatii_tipuri 24–29, 13.10.2026) — aprobate D4.
export const CODURI_VECHI: Record<string, Clasa> = {
  EGT: { fel: 'executie', domeniu: 'transport' },
  EGD: { fel: 'executie', domeniu: 'distributie' },
  EGIU: { fel: 'executie', domeniu: 'utilizare' },
  PGT: { fel: 'proiectare', domeniu: 'transport' },
  PGD: { fel: 'proiectare', domeniu: 'distributie' },
  PGIU: { fel: 'proiectare', domeniu: 'utilizare' },
}

// Codurile NOI, cu clasa lor — se completează DOAR din textul Ordinului confirmat de Răzvan (ex. { '<COD>': { fel, domeniu } }).
export const CODURI_NOI_CONFIRMATE: Record<string, Clasa> = {}

// Codul de la începutul denumirii tipului de autorizație („EGT - Executant Gaze Transport [...]” → „EGT”).
export function codTip(denumire: string): string | null {
  const m = /^\s*([A-Z]{2,6})\b\s*[-–—(:]/.exec(String(denumire || ''))
  return m ? m[1] : null
}

// O persoană (cu codurile ei valabile) acoperă codul cerut? literal, sau un cod vechi cu ACEEAȘI clasă ca un cod nou CONFIRMAT.
export function acoperaCod(coduriPersoana: Iterable<string>, codCerut: string,
  noi: Record<string, Clasa> = CODURI_NOI_CONFIRMATE, vechi: Record<string, Clasa> = CODURI_VECHI):
  { acoperit: boolean; prin: 'literal' | 'echivalenta' | null; cod: string | null } {
  const cerut = String(codCerut || '').trim().toUpperCase()
  if (!cerut) return { acoperit: false, prin: null, cod: null }
  const are = [...new Set([...coduriPersoana].map((c) => String(c).toUpperCase()))]
  if (are.includes(cerut)) return { acoperit: true, prin: 'literal', cod: cerut }
  const tinta = noi[cerut]
  if (!tinta) return { acoperit: false, prin: null, cod: null }   // cod necunoscut / neconfirmat = fără echivalență
  for (const c of are) {
    const k = vechi[c]
    if (k && k.fel === tinta.fel && k.domeniu === tinta.domeniu) return { acoperit: true, prin: 'echivalenta', cod: c }
  }
  return { acoperit: false, prin: null, cod: null }
}
