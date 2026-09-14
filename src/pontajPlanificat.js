// ════════════════════════════════════════════════════════════════
// pontajPlanificat.js — care absențe din pontaj sunt PLANIFICATE, nu constatate.
//
// TKT-2026-0136 (Eugen Nica, 24.08.2026): „Am gasit foarte multi angajati aflati in CO trecuti la
// data de azi. Cred ca cineva i-a pontat ca fiind in CO dar ei au lucrat astazi."
//
// Avea dreptate pe fond, dar nu i-a pontat nimeni: concediul APROBAT se scrie în pontaj în avans,
// uneori cu luni înainte. Pe 24.08 erau 20 de CO-uri, dintre care patru create încă din 10.06.
// Frații Dobrin — exact cei numiți în tichet — aveau CO creat pe 21.08 pentru 24.08, corectat abia
// pe 28.08, după reclamație.
//
// Problema nu e că se pre-completează: e util să vezi cine ar trebui să fie în concediu. Problema e
// că o PLANIFICARE arată identic cu o CONSTATARE, deci omul care face pontajul n-are cum să știe
// care rânduri merită verificate.
//
// Regula: absența e „planificată" dacă a fost scrisă ÎNAINTE de ziua la care se referă și nimeni
// n-a mai atins-o în ziua aia sau după. Dacă cineva a confirmat-o/modificat-o în ziua respectivă,
// e constatare — nu se mai marchează.
//
// Pur și testabil: un marcaj greșit aici nu dă eroare, doar sperie sau liniștește degeaba.
// ════════════════════════════════════════════════════════════════

/** Ziua calendaristică (YYYY-MM-DD) a unui timestamp, fără să depindă de fus. */
const ziua = (ts) => {
  if (!ts) return null
  const s = String(ts)
  return s.length >= 10 ? s.slice(0, 10) : null
}

/**
 * @param rec   rândul din pontaj_records (are norma, created_at, updated_at)
 * @param data  ziua de pontaj, 'YYYY-MM-DD'
 */
export function esteAbsentaPlanificata(rec, data) {
  if (!rec || !rec.norma || !data) return false
  const creat = ziua(rec.created_at)
  if (!creat || creat >= data) return false        // scrisă în ziua ei sau după => constatare
  const modificat = ziua(rec.updated_at)
  if (modificat && modificat >= data) return false // cineva a umblat la ea în ziua aia => confirmată
  return true
}

/** Câte absențe dintr-o zi sunt doar planificate. `recs` = map employee_id → rând. */
export function numaraPlanificate(recs, data) {
  return Object.values(recs || {}).filter(r => esteAbsentaPlanificata(r, data)).length
}
