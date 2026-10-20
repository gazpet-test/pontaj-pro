// ════════════════════════════════════════════════════════════════════════
// IZOMETRIE E2b — gruparea stocului de țeavă Transgaz (registrul din magazie_bucati) pentru ecrane
// ════════════════════════════════════════════════════════════════════════
// Aceeași sursă pentru Magazie → „Țeavă proiecte” (gestionar) și pentru Execuție → Izometrie (doar citire).
// Funcții pure, testate; ecranele doar le afișează.

// tipul afișat: curbe / 8,8 / 7,1 × 6 m (țevile scurte) / 7,1
export const TIPURI = [
  { cheie: 't71', label: 'Țeavă 7,1', scurt: '7,1' },
  { cheie: 't88', label: 'Țeavă 8,8', scurt: '8,8' },
  { cheie: 't6m', label: 'Țeavă 7,1 × 6 m', scurt: '6 m' },
  { cheie: 'curba', label: 'Curbe', scurt: 'curbe' },
]
export function tipStoc(b) {
  if (b.tip_cod === 'curba') return 'curba'
  if (Number(b.perete_mm) >= 8.5) return 't88'
  if (b.lungime_mm != null && b.lungime_mm < 7000) return 't6m'
  return 't71'
}

// categoriile de stare cerute de Răzvan (20.10): disponibil, în drum spre depozit, pe tronson, montat + restul
export const CATEGORII = [
  { cheie: 'disponibil', label: 'Disponibil (în depozit)', stari: ['sosit', 'receptionat', 'retur'] },
  { cheie: 'in_drum', label: 'În drum spre depozit', stari: ['in_tranzit'] },
  { cheie: 'pe_tronson', label: 'Pe tronson (nemontat)', stari: ['pe_tronson'] },
  { cheie: 'montat', label: 'Montat', stari: ['montata'] },
  { cheie: 'rest', label: 'Rest nereutilizabil', stari: ['rest_nereutilizabil'] },
  { cheie: 'iesit', label: 'Tăiat / deșeu / pierdut', stari: ['taiata', 'deseu', 'pierduta'] },
  { cheie: 'anulat', label: 'Anulat (storno)', stari: ['anulata'] },
]
const CAT_DIN_STARE = Object.fromEntries(CATEGORII.flatMap(c => c.stari.map(s => [s, c.cheie])))
export const categorieStare = stare => CAT_DIN_STARE[stare] || 'alta'

// metri: doar țevile (curbele se numără pe bucăți); frunzele `taiata` nu se adună (s-ar număra de două ori)
export const metri = b => (b.tip_cod === 'teava' && b.lungime_mm != null && b.stare !== 'taiata' && b.stare !== 'anulata' ? b.lungime_mm / 1000 : 0)

/**
 * Totaluri pe categorie și pe loc × tip.
 * loc = depozitul (cod) pentru bucățile din depozit / în drum, tronsonul pentru cele pe tronson / montate.
 */
export function totaluri(bucati, { depozite = {}, tronsoane = {} } = {}) {
  const pe = {}
  const matrice = {}   // loc → tip → { n, m }
  for (const b of bucati) {
    const c = categorieStare(b.stare)
    pe[c] = pe[c] || { n: 0, m: 0 }
    pe[c].n++; pe[c].m += metri(b)
    if (c === 'anulat') continue
    const loc = (c === 'pe_tronson' || c === 'montat')
      ? `${tronsoane[b.tronson_id] || 'tronson ?'}`
      : `${depozite[b.depozit_id] || 'depozit ?'}`
    const k = `${c}|${loc}`
    const t = tipStoc(b)
    matrice[k] = matrice[k] || {}
    matrice[k][t] = matrice[k][t] || { n: 0, m: 0 }
    matrice[k][t].n++; matrice[k][t].m += metri(b)
  }
  for (const v of Object.values(pe)) v.m = Math.round(v.m * 100) / 100
  for (const r of Object.values(matrice)) for (const v of Object.values(r)) v.m = Math.round(v.m * 100) / 100
  return { pe, matrice }
}

/** Filtrul ecranului: depozit (id), tip (cheie), categorie, căutare după serie (ultimele cifre sau oriunde). */
export function filtreaza(bucati, { depozitId = null, tip = '', categorie = '', cauta = '' } = {}) {
  const q = String(cauta || '').toUpperCase().replace(/[\s._/-]/g, '')
  return bucati.filter(b =>
    (!depozitId || b.depozit_id === Number(depozitId))
    && (!tip || tipStoc(b) === tip)
    && (!categorie ? categorieStare(b.stare) !== 'anulat' : categorieStare(b.stare) === categorie)
    && (!q || String(b.serie_canon || b.serie || '').toUpperCase().includes(q) || String(b.sarja || '').toUpperCase().includes(q)))
}

export const fmtM = m => (m == null ? '—' : Number(m).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
