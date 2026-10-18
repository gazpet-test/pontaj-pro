// Validăm răspunsul integral înainte de normalizări: lipsă ≠ listă goală / null explicit.
const obiect = (v: any) => v !== null && typeof v === 'object' && !Array.isArray(v)
const text = (v: any) => typeof v === 'string'
const textSauNull = (v: any) => v === null || text(v)
const numar = (v: any) => typeof v === 'number' && Number.isFinite(v)
// campuri de detaliu: modelul poate da numar in loc de text (ex. zile_clarificari: 10) - nu e raspuns partial
const scalar = (v: any) => textSauNull(v) || numar(v)
const intreg = (v: any) => Number.isInteger(v) && v >= 0
const lista = (v: any, valid: (x: any) => boolean) => Array.isArray(v) && v.every(valid)
const campuri = (v: any, chei: string[], valid: (x: any) => boolean) =>
  obiect(v) && chei.every(k => Object.hasOwn(v, k) && valid(v[k]))

function baremValid(b: any): boolean {
  return b === null || (obiect(b) && (b.minim === null || intreg(b.minim)) && text(b.unitate) &&
    lista(b.trepte, t => obiect(t) && intreg(t.de_la) && numar(t.puncte)) &&
    (b.bonus === null || (obiect(b.bonus) && numar(b.bonus.puncte) && text(b.bonus.conditie))))
}

export function triereValida(j: any): boolean {
  return obiect(j) && ['mergem', 'cu_clarificari', 'nu_se_poate', 'neclar'].includes(j.verdict) &&
    text(j.motiv_verdict) && !!j.motiv_verdict.trim() && numar(j.confidence) && j.confidence >= 0 && j.confidence <= 100 &&
    campuri(j, ['obiect', 'autoritate', 'nr_anunt', 'termen_depunere', 'zile_clarificari', 'termen_raspuns_ac',
      'amplasament', 'descriere', 'valoare_estimata', 'termen_executie', 'criteriu', 'atestari', 'sursa_finantare',
      'garantie_participare', 'garantie_buna_executie', 'organizare_santier', 'liste_cantitati', 'grafic', 'laborator'], scalar) &&
    (j.tip_lucrare_gaze === null || (campuri(j.tip_lucrare_gaze, ['presiune', 'diametru', 'motiv'], textSauNull) &&
      ['transport', 'distributie', 'mixt', 'neclar', 'nu_e_gaze'].includes(j.tip_lucrare_gaze.tip))) &&
    (j.experienta_similara === null || campuri(j.experienta_similara, ['cerinta', 'lucrari_acceptate'], textSauNull)) &&
    typeof j.cumul_functii_interzis === 'boolean' &&
    lista(j.roluri, r => campuri(r, ['rol', 'rol_canonic'], text) && !!r.rol.trim() &&
      campuri(r, ['natura_ceruta', 'cerinte', 'documente', 'motiv'], scalar) &&
      campuri(r, ['autorizatie_ceruta', 'propunere'], textSauNull) && typeof r.exclude_transport === 'boolean' && baremValid(r.barem)) &&
    lista(j.matrice_experti, m => campuri(m, ['persoana', 'rol', 'surse'], text) &&
      campuri(m, ['proiecte', 'verificate', 'proiecte_conditionate', 'verificate_conditionate'], intreg)) &&
    lista(j.atestari_firma, a => obiect(a) && text(a.cerinta) &&
      (a.document_firma_id === null || (intreg(a.document_firma_id) && a.document_firma_id > 0))) &&
    lista(j.alte_cerinte, text) && lista(j.clarificari_propuse, text)
}
