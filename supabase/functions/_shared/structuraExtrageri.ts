// Validări înainte de înlocuirea datelor existente. Null rămâne permis pentru câmpurile nevăzute.
export const obiect = (v: unknown): v is Record<string, any> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)
export const textUtil = (v: unknown): boolean =>
  (typeof v === 'string' && !!v.trim() && v.trim() !== 'null') || (typeof v === 'number' && Number.isFinite(v))
const areCamp = (v: unknown, chei: string[]): boolean => obiect(v) && chei.some(k => textUtil(v[k]))

export function recomandariValide(lista: unknown): boolean {
  // Nu filtrăm și nu trunchiem pachetul: o scrisoare invalidă oprește întreaga înlocuire.
  return Array.isArray(lista) && lista.length > 0 && lista.every(x => obiect(x) &&
    typeof x.nume_persoana === 'string' && !!x.nume_persoana.trim() &&
    // doar numele nu e o recomandare: mai trebuie macar rolul, beneficiarul sau lucrarea (review Copilot/Gemini)
    areCamp(x, ['rol', 'beneficiar', 'obiect_lucrare']))
}

export function contractUtil(v: unknown): boolean {
  return areCamp(v, ['denumire', 'numar_contract', 'beneficiar_nume', 'valoare_lei', 'valoare_eur',
    'data_semnare', 'termen_executie_zile', 'data_termen']) ||
    (obiect(v) && areCamp(v.clauze, ['penalitati', 'garantii', 'plata', 'reziliere', 'observatii']))
}

export function talonUtil(v: unknown): boolean {
  return areCamp(v, ['nr_inmatriculare', 'serie_sasiu', 'serie_motor', 'serie_civ', 'marca', 'model',
    'an_fabricatie', 'data_prima_inmatriculare', 'categorie_vehicul', 'nr_omologare', 'capacitate_motor',
    'putere_kw', 'tip_carburant', 'culoare', 'masa_maxima_kg', 'greutate_kg', 'nr_locuri'])
}

export function clasificareUtila(v: unknown): boolean {
  if (!obiect(v) || typeof v.tip_document !== 'string' || !v.tip_document.trim()) return false
  // campuri={} e explicit permis; titlul, entitatea și datele sunt și ele informații extrase.
  return areCamp(v, ['titlu_scurt', 'entitate_hint']) ||
    areCamp(v.date_proiect, ['data_start', 'data_termen', 'durata_luni', 'nr_ordin']) ||
    areCamp(v.date_document, ['numar', 'data_emitere', 'data_expirare', 'emitent', 'valoare_totala']) ||
    areCamp(v.campuri, ['cnp', 'nume_complet', 'adresa', 'data_nasterii', 'serie_numar', 'iban', 'banca', 'cui'])
}

export function propunereValida(v: unknown): boolean {
  return obiect(v) && typeof v.este_autorizatie === 'boolean' &&
    (v.tip_cod == null || textUtil(v.tip_cod)) &&
    // cheile omise de model = null (review Gemini)
    (v.autorizatie_existenta_id == null ||
      (Number.isInteger(v.autorizatie_existenta_id) && v.autorizatie_existenta_id > 0)) &&
    typeof v.incredere === 'number' && Number.isFinite(v.incredere) &&
    areCamp(v, ['citat', 'ce_este'])
}

export function fazeValide(v: unknown): boolean {
  return obiect(v) && Array.isArray(v.faze) &&
    (v.faze.length === 0 ? v.are_faze_determinante === false :
      v.faze.every((f: unknown) => obiect(f) && textUtil(f.denumire)))
}

export function lotPaginiValid(v: unknown, start: number, count: number): boolean {
  return Array.isArray(v) && v.length === count &&
    v.every(e => obiect(e) && Number.isInteger(e.pagina) && e.pagina >= start &&
      e.pagina < start + count && typeof e.text === 'string') &&
    new Set(v.map(e => e.pagina)).size === count
}
