// ════════════════════════════════════════════════════════════════
// raportUtilaje.js — cine e pe șantier azi, în raportul zilnic al managerului (/m).
//
// Pur, fără React și fără Supabase: un carry-forward greșit nu dă eroare, minte tăcut — deci
// trebuie testabil. Restul paginii stă în AppMobilManageri.jsx.
// ════════════════════════════════════════════════════════════════

/**
 * Cine e pe șantier azi = ce era ieri (carry-forward) + ce a alimentat AICI de atunci încoace.
 *
 * TKT-2026-0081 (Eugen Nica, 24.07.2026): „apar masini in plus care nu mai sunt in acest santier...
 * probabil sunt adaugate de la ultima alimentare". Avea dreptate, și era mai rău decât părea:
 * pasul de alimentări readăuga ORICE alimentase aici în ultimele 14 zile, indiferent dacă managerul
 * tocmai îl scosese. Butonul „Scoate de pe șantier" ținea o singură zi.
 *
 * Dovedit pe date de producție: la Bilciurești, KIPOR KDA 35 SS, COMPAL POWER VG R 30,
 * HIMOINSA 30 KVA și AKSA 40 KVA au fost scoase pe 24–25.08.2026 și au reapărut a doua zi FĂRĂ
 * nicio alimentare între timp. La Orșova, MITSUBISHI ASX a fost scos și readus de șase ori.
 *
 * REGULA: scoaterea ține până apare o DOVADĂ NOUĂ — o alimentare de după ultimul raport. Fără raport
 * anterior (primul raport al lucrării) se pre-completează tot, ca la bootstrap.
 *
 * Pură și exportată ca să poată fi testată: un carry-forward greșit nu dă eroare, minte tăcut.
 */
export function combinaUtilaje({ prevSnapshot, dataPrev, alimentari, azi }) {
  const keyOf = (u) => u.active_id ? 'a' + u.active_id : 'c' + String(u.cod || u.nume || '').toLowerCase().trim()
  const map = new Map()
  // 1) carry-forward din ultimul raport anterior.
  // STAREA se moștenește: un utilaj defect ieri e defect și azi până îl trece managerul înapoi pe
  // funcțional (înainte se reseta silențios și defectele dispăreau — sesizat Răzvan 04.08.2026).
  ;(Array.isArray(prevSnapshot) ? prevSnapshot : []).forEach(u => {
    const it = { active_id: u.active_id ?? null, cod: u.cod || '', inmatriculare: u.inmatriculare || '', nume: u.nume || u.cod || '?', tip: u.tip || null, ore: u.ore ?? null, km: u.km ?? null, ultima_alimentare: null, stare: u.stare === 'nefunctional' ? 'nefunctional' : 'functional', motiv: u.stare === 'nefunctional' ? (u.motiv || '') : '', alimentat: false, manual: !u.cod && !u.active_id, dinRaport: true }
    map.set(keyOf(it), it)
  })
  // 2) alimentări din ultimele 14 zile: îmbogățesc ce e deja în listă, dar ADAUGĂ doar ce e nou.
  const dinAlimentariRecente = new Set()
  ;(alimentari || []).forEach(u => {
    dinAlimentariRecente.add(u.active_id)
    const it = { active_id: u.active_id, cod: u.cod_intern || '', inmatriculare: u.nr_inmatriculare || '', nume: [u.marca, u.model].filter(Boolean).join(' ') || u.cod_intern || u.nr_inmatriculare || '?', tip: u.tip_categorie || null, ore: u.ore_functionare_actuale ?? null, km: u.km_actuali ?? null, ultima_alimentare: u.ultima_alimentare, stare: 'functional', motiv: '', alimentat: u.ultima_alimentare === azi, manual: false }
    const k = keyOf(it)
    if (map.has(k)) {
      const e = map.get(k)
      e.active_id = e.active_id || it.active_id; e.tip = e.tip || it.tip
      e.inmatriculare = e.inmatriculare || it.inmatriculare
      e.ore = e.ore ?? it.ore; e.km = e.km ?? it.km
      e.ultima_alimentare = it.ultima_alimentare; if (it.alimentat) e.alimentat = true
    } else if (!dataPrev || !it.ultima_alimentare || it.ultima_alimentare > dataPrev) {
      map.set(k, it)
    }
  })
  return { map, dinAlimentariRecente }
}
