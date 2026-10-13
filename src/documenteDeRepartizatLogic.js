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
