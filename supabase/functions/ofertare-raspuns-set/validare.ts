const obiect = (v: any) => v !== null && typeof v === 'object' && !Array.isArray(v)
const textSauNull = (v: any) => v === null || typeof v === 'string'
const scalar = (v: any) => textSauNull(v) || (typeof v === 'number' && Number.isFinite(v))

// O anexă poate avea lista goală; un fragment neparcurs integral nu poate fi marcat citit.
export function inventarValid(j: any): boolean {
  return obiect(j) && j.acoperit_tot === true && textSauNull(j.coada_deschisa) &&
    Array.isArray(j.dispozitii) && j.dispozitii.every((x: any) => obiect(x) &&
      scalar(x.nr) && ['efect_posibil', 'confirmare', 'efect_cantitati', 'neclar', 'anexa'].includes(x.tip) &&
      typeof x.rezumat === 'string' && !!x.rezumat.trim() && typeof x.citat === 'string' && !!x.citat.trim() &&
      Object.hasOwn(x, 'loturi') && (x.loturi === null || (Array.isArray(x.loturi) && x.loturi.every((l: any) => typeof l === 'string' || (typeof l === 'number' && Number.isFinite(l))))) && textSauNull(x.trimite_la))
}

// Listele goale sunt un rezultat permis; cheile și fiecare element trebuie să fie complete.
export function comparatieValida(j: any): boolean {
  const textPlin = (v: any) => typeof v === 'string' && !!v.trim()
  const referinta = (v: any) => textPlin(v) || (typeof v === 'number' && Number.isFinite(v))
  const campuri = (v: any, chei: string[], valid: (x: any) => boolean) =>
    obiect(v) && chei.every(k => Object.hasOwn(v, k) && valid(v[k]))
  return obiect(j) && Array.isArray(j.operatii) && Array.isArray(j.neclare) &&
    j.operatii.every((o: any) => obiect(o) && referinta(o.disp_nr) &&
      ['modifica', 'anuleaza', 'noua'].includes(o.fel) &&
      (o.fel === 'noua' ? o.cerinta_id === null : Number.isInteger(o.cerinta_id) && o.cerinta_id > 0) &&
      // la 'anuleaza' text_nou nu e folosit: poate lipsi (review Copilot #780)
      (o.fel === 'anuleaza' ? (o.text_nou === undefined || scalar(o.text_nou)) :
        (campuri(o, ['text_nou'], scalar) && o.text_nou !== null && String(o.text_nou).trim().length > 0)) &&
      ['eliminatorie', 'propunere', 'forma', 'contractuala'].includes(o.tip) &&
      campuri(o, ['document_probant', 'motiv'], scalar) &&
      (o.cand_se_prezinta === null || ['duae', 'depunere', 'primul_loc'].includes(o.cand_se_prezinta)) &&
      textPlin(o.citat) && ['ridicata', 'medie', 'scazuta'].includes(o.incredere) &&
      typeof o.necesita_revizuire === 'boolean' && (o.loturi == null || (Array.isArray(o.loturi) &&
      o.loturi.every((l: any) => typeof l === 'string' || (typeof l === 'number' && Number.isFinite(l)))))) &&
    j.neclare.every((n: any) => obiect(n) && referinta(n.disp_nr) && textPlin(n.de_ce))
}
