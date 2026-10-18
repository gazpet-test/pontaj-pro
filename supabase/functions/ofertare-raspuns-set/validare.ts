const obiect = (v: any) => v !== null && typeof v === 'object' && !Array.isArray(v)
const textSauNull = (v: any) => v === null || typeof v === 'string'

// O anexă poate avea lista goală; un fragment neparcurs integral nu poate fi marcat citit.
export function inventarValid(j: any): boolean {
  return obiect(j) && j.acoperit_tot === true && textSauNull(j.coada_deschisa) &&
    Array.isArray(j.dispozitii) && j.dispozitii.every((x: any) => obiect(x) &&
      textSauNull(x.nr) && ['efect_posibil', 'confirmare', 'efect_cantitati', 'neclar', 'anexa'].includes(x.tip) &&
      typeof x.rezumat === 'string' && !!x.rezumat.trim() && typeof x.citat === 'string' && !!x.citat.trim() &&
      Object.hasOwn(x, 'loturi') && (x.loturi === null || (Array.isArray(x.loturi) && x.loturi.every((l: any) => typeof l === 'string' || (typeof l === 'number' && Number.isFinite(l))))) && textSauNull(x.trimite_la))
}
