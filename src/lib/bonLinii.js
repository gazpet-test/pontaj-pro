// Salvarea unui bon de consum = UN apel: public.fn_bon_salveaza (migrarea 20261102b, decizia Razvan 21.10.2026).
// În aceeași tranzacție: CAS pe updated_at, antetul, liniile vechi șterse și cele noi inserate; retry-ul după un răspuns
// pierdut întoarce același rezultat (fără dubluri). Aici doar construcția argumentelor și traducerea erorilor.

const nn = s => (s == null ? null : (String(s).trim() || null))

/** Liniile pentru RPC (fără bon_id / valoare — le pune serverul). Costul doar pe bonurile gazpet. */
export function liniiPentruRpc(linii, provenienta, tipuriMap, toNum) {
  return linii.map(l => {
    const tip = l.tip_material_id ? tipuriMap[l.tip_material_id] : null
    return {
      magazie_bucata_id: l.magazie_bucata_id || null, tip_material_id: l.tip_material_id || null,
      denumire: nn(l.denumire) || tip?.nume || null, serie: nn(l.serie), sarja: nn(l.sarja), dimensiune: nn(l.dimensiune),
      cantitate: toNum(l.cantitate) ?? 1, um: l.um || tip?.um_implicit || 'buc', lungime_m: toNum(l.lungime_m),
      cost_unitar: provenienta === 'gazpet' ? toNum(l.cost_unitar) : null,
    }
  })
}

/** Antetul pentru RPC. Bon nou: cheia operației (generată o dată la deschiderea formularului); numărul îl alocă serverul. */
export function antetPentruRpc(m) {
  return {
    proiect_id: Number(m.proiect_id), cheie_operatie: m.cheie_operatie || null,
    situatie_plata_id: m.situatie_plata_id ? Number(m.situatie_plata_id) : null,
    provenienta: m.provenienta, data_bon: m.data_bon, observatii: nn(m.observatii),
  }
}

/** Mesajul pentru utilizator, din eroarea RPC-ului. */
export function mesajEroareBon(error) {
  const m = `${error?.code || ''} ${error?.message || error || ''}`
  if (/PGRST202|could not find the function/i.test(m)) return 'salvarea bonurilor nu e încă instalată în baza de date (migrarea 20261102b) — anunță-l pe Răzvan'
  if (/40001|modificat între timp/i.test(m)) return 'bonul a fost modificat de altcineva între timp — reîncarcă și reia editarea'
  if (/nu intră pe bon/i.test(m)) return 'pe bon e o bucată de țeavă Transgaz din registru — nu intră pe bon (montajul se declară din modulul de țeavă)'
  return error?.message || String(error)
}
