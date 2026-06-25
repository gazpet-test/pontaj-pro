// ════════════════════════════════════════════════════════════════
// probeCalc.js — MOTOR COMUN DE CALCUL pentru Probe de Presiune
// Folosit de: Execuție (TabSantiere · Calculator + Log) și Comercial (Ofertare).
// Funcție pură, fără dependențe — primește dn + cfg + parametri, întoarce rezultate.
// ════════════════════════════════════════════════════════════════

// dn  = { diametru_extern_mm }
// cfg = { tip_fluid, debit_mc_min, debit_l_min, consum_motorina_l_h, tarif_lei_mc }
export function calcProbe({ dn, lungime_m, presiune_bar, cfg }) {
  const L = Number(lungime_m) || 0
  const P = Number(presiune_bar) || 0
  const dExtM = (Number(dn?.diametru_extern_mm) || 0) / 1000
  const v1m = Math.PI * Math.pow(dExtM / 2, 2)   // mc per 1m la 1 bar
  const v_conducta = v1m * L                      // mc

  if (cfg?.tip_fluid === 'apa') {
    // ─── HIDRAULIC ───
    const dP = Math.max(0, P - 10)                 // ΔP (presiune utilă peste 10 bar)
    const beta = 0.00005                           // compresibilitate apă 1/bar
    const v_compr = v_conducta * dP * beta         // mc
    const debitL = Number(cfg?.debit_l_min) || 0   // L/min pompă principală
    const timp_umplere_h = v_conducta / (1000 * 60 / 1000)      // pompă umplere 1000 L/min → mc/h = 60
    const timp_presurizare_h = debitL > 0 ? (v_compr * 1000) / (debitL * 60) : 0
    const durata_total_h = timp_umplere_h + timp_presurizare_h
    const consum = (Number(cfg?.consum_motorina_l_h) || 0) * durata_total_h
    const valoare = v_conducta * (Number(cfg?.tarif_lei_mc) || 0)
    return {
      v_conducta_mc: v_conducta, v_la_presiune_mc: v_compr,
      timp_umplere_h, timp_presurizare_h,
      durata_proba_h: timp_presurizare_h, durata_pistonare_h: 0,
      durata_total_h, consum_motorina_l: consum, valoare_lei: valoare,
    }
  }

  // ─── PNEUMATIC ───
  const debit = Number(cfg?.debit_mc_min) || 0     // mc/min
  const v_la_presiune = v_conducta * P             // mc aer echivalent la 1 bar
  const durata_proba_h = debit > 0 ? v_la_presiune / (debit * 60) : 0
  // Pistonare la P=3 bar fix. Uscare + Calibrare = identice ca durată.
  const durata_pistonare_h = debit > 0 ? (v_conducta * 3) / (debit * 60) : 0
  const uscare_h = durata_pistonare_h
  const calibrare_h = durata_pistonare_h
  const durata_total_h = durata_proba_h + durata_pistonare_h + uscare_h + calibrare_h
  const consum = (Number(cfg?.consum_motorina_l_h) || 0) * durata_total_h
  return {
    v_conducta_mc: v_conducta, v_la_presiune_mc: v_la_presiune,
    durata_proba_h, durata_pistonare_h, uscare_h, calibrare_h,
    timp_umplere_h: 0, timp_presurizare_h: 0,
    durata_total_h, consum_motorina_l: consum, valoare_lei: 0,
  }
}

export const fmtH = h => {
  const n = Number(h) || 0
  if (n === 0) return '0 h'
  if (n < 1) return `${Math.round(n * 60)} min`
  return `${n.toFixed(2)} h`
}

export const fmtNr = (n, d = 2) => (Number(n) || 0).toLocaleString('ro-RO', { minimumFractionDigits: d, maximumFractionDigits: d })
