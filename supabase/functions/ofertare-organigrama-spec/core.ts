// R16: absența unei informații nu dovedește că obligația nu există.
const boolNecunoscut = (v: unknown): boolean | null => typeof v === 'boolean' ? v : null

export function normalizeazaSpecOrganigrama(input: unknown) {
  const j: any = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  // Normalizare pe contractul JSON (UI-ul se bazează pe forma exactă)
  const arr = (v: unknown) => (Array.isArray(v) ? v : [])
  const CAT = ['conducere', 'specialist', 'executie', 'suport'], FAZE = ['proiectare', 'executie'], FAZA_ROL = ['proiectare', 'executie', 'ambele']
  const PERS = ['muncitori_calificati', 'muncitori_necalificati', 'tehnic', 'auxiliar', 'total']
  const lc = (j.linii_cerute && typeof j.linii_cerute === 'object') ? j.linii_cerute : {}
  return {
    obligatorie: boolNecunoscut(j.obligatorie),
    faze: arr(j.faze).map(String).filter((f: string) => FAZE.includes(f)),
    roluri_cerute: arr(j.roluri_cerute).slice(0, 60).map((r: any) => ({
      rol: String(r?.rol || '').slice(0, 200),
      categorie: CAT.includes(r?.categorie) ? r.categorie : 'specialist',
      obligatoriu: boolNecunoscut(r?.obligatoriu),
      domeniu_isc: r?.domeniu_isc ? String(r.domeniu_isc).slice(0, 20) : null,
      faza: FAZA_ROL.includes(r?.faza) ? r.faza : 'executie',
      cerinte_persoana: r?.cerinte_persoana ? String(r.cerinte_persoana).slice(0, 600) : null,
      citat: r?.citat ? String(r.citat).slice(0, 400) : null,
    })).filter((r: any) => r.rol),
    linii_cerute: { asociati: boolNecunoscut(lc.asociati), subcontractanti: boolNecunoscut(lc.subcontractanti), beneficiar: boolNecunoscut(lc.beneficiar), proiectant: boolNecunoscut(lc.proiectant), diriginte: boolNecunoscut(lc.diriginte), biunivoc_cu_seful_de_santier: boolNecunoscut(lc.biunivoc_cu_seful_de_santier) },
    personal_pe_categorii: arr(j.personal_pe_categorii).map(String).filter((p: string) => PERS.includes(p)),
    per_operator: boolNecunoscut(j.per_operator),
    tabel_nominal: { cerut: boolNecunoscut(j.tabel_nominal?.cerut), coloane: arr(j.tabel_nominal?.coloane).map(String).slice(0, 20) },
    corelare_grafic: boolNecunoscut(j.corelare_grafic),
    documente_suport: arr(j.documente_suport).map(String).slice(0, 30),
    format: { observatii: j.format?.observatii ? String(j.format.observatii).slice(0, 1500) : null },
    domenii_isc_din_obiect: arr(j.domenii_isc_din_obiect).map(String).slice(0, 15),
    avertismente: arr(j.avertismente).map(String).slice(0, 30),
  }
}
