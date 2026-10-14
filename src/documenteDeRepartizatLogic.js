// Logică pură: coada „de repartizat” (Execuție) + alerta „proiect activ fără etichetă Gmail” (Administrator).

const norm = (s) => String(s || '').trim().toLowerCase()

// Candidații (etichete Gmail) → proiectele active cu acea etichetă; păstrează ordinea candidaților, fără dubluri.
export function potrivesteCandidati(candidati, proiecte) {
  const out = [], vazut = new Set()
  for (const c of candidati || []) {
    const p = (proiecte || []).find(x => norm(x.eticheta_gmail) && norm(x.eticheta_gmail) === norm(c))
    if (p && !vazut.has(p.id)) { vazut.add(p.id); out.push(p) }
  }
  return out
}

// Candidații care nu corespund niciunui proiect activ (etichetă inexistentă sau proiect inactiv).
export function candidatiFaraProiect(candidati, proiecte) {
  const etichete = new Set((proiecte || []).map(p => norm(p.eticheta_gmail)).filter(Boolean))
  return (candidati || []).filter(c => !etichete.has(norm(c)))
}

// Filtru de afișare (doar UI, nu atinge BD): ce NU ține de execuție se ascunde implicit din coadă.
// Ordinea contează: prima regulă care se potrivește dă categoria. Textul = subiect + nume fișier.
export const REGULI_NON_EXECUTIE = [
  { cat: 'HR', re: /\bcv\b|curriculum|angajare|candidat/i },
  { cat: 'Financiar', re: /winmentor|analiza descriptiv|\bexpert\b|stocuri|inventar|carduri|cheltuieli|centralizator contracte|contracte in derulare|\bfacturi\b/i },
  { cat: 'Logistică', re: /dispense|\boscar\b|carburant|alimentari/i },
  { cat: 'Ofertare', re: /licitati|documentatie de atribuire|caiet de sarcini|\bseap\b/i },
]
export const PRAG_TRANSVERSAL = 4   // mail cu 4+ proiecte candidate = raport pe toată firma, nu al unui șantier

// null = ține de execuție (se arată); altfel { cat, motiv } = ascuns implicit.
export function clasificaNonExecutie(r) {
  const text = `${r?.subiect || ''} ${r?.nume_fisier || ''}`
  for (const { cat, re } of REGULI_NON_EXECUTIE) {
    const m = text.match(re)
    if (m) return { cat, motiv: m[0] }
  }
  const n = (r?.candidati || []).length
  if (n >= PRAG_TRANSVERSAL) return { cat: 'Transversal', motiv: `${n} proiecte candidate` }
  return null
}

// Eticheta propusă din cod_intern: FINTA_GHEBOAIA → Finta-Gheboaia (stilul etichetelor existente).
export function etichetaPropusa(codIntern, nume) {
  const sursa = String(codIntern || nume || '').trim()
  if (!sursa) return ''
  return sursa
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .split(/[^A-Za-z0-9]+/).filter(Boolean)
    // acronimele scurte (ADI, PIS, CFI) rămân majuscule; restul „Capitalizat”
    .map(w => w.length <= 3 && w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('-')
    .slice(0, 60)
}

// Proiecte active fără etichetă Gmail → rânduri de alertă (sursa „gmail” din Administrator → Alerte).
export function proiecteFaraEticheta(proiecte) {
  return (proiecte || [])
    .filter(p => p.activ !== false && !String(p.eticheta_gmail || '').trim())
    .map(p => ({ id: p.id, nume: p.nume, cod_intern: p.cod_intern, propusa: etichetaPropusa(p.cod_intern, p.nume) }))
}
