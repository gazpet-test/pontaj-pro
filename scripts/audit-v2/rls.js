// Numai refuzurile explicite 42501 pe aceste SELECT-uri sunt recuperabile.
// Rândurile filtrate silențios de RLS nu pot fi deduse dintr-un rezultat gol.
export const VERIGI_AUXILIARE = {
  ofertare_ingest_coada: [1],
  ofertare_extragere_coada: [2],
  ofertare_verificari: [5],
  grafic_versiuni: [5, 7],
}
export const eroriBlocante = snapshot => Object.keys(snapshot.erori || {})
  .filter(table => !snapshot.eroriAuxiliare?.[table])
