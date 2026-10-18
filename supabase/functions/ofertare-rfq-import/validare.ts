const obiect = (v: any) => v !== null && typeof v === 'object' && !Array.isArray(v)
const scalar = (v: any) => v === null || typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v))

export function pretNormalizat(v: unknown): number | null {
  if (v === null) return null
  if (typeof v !== 'number' && (typeof v !== 'string' || !v.trim())) return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : null
}

// Null explicit înseamnă neofertat; un material omis nu poate fi înlocuit cu un null inventat.
export function ofertaValida(j: any, idsValide: Set<number>): boolean {
  const vazute = new Set<number>()
  return obiect(j) && ['furnizor', 'data_oferta', 'valabilitate', 'conditii'].every(k => Object.hasOwn(j, k) && scalar(j[k])) &&
    Array.isArray(j.preturi) && j.preturi.length > 0 && j.preturi.every((p: any) => {
      if (!obiect(p) || !idsValide.has(p.material_id) || vazute.has(p.material_id) ||
        !Object.hasOwn(p, 'pret') || (p.pret !== null && pretNormalizat(p.pret) === null) ||
        !['denumire_furnizor', 'um', 'note'].every(k => Object.hasOwn(p, k) && scalar(p[k]))) return false
      vazute.add(p.material_id)
      return true
    }) && vazute.size === idsValide.size
}
