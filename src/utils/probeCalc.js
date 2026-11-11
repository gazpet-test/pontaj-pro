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

// ════════════════════════════════════════════════════════════════
// PREȚ PROPUS SPRE OFERTARE — referință LMF (calibrare la etalon)
// ────────────────────────────────────────────────────────────────
// Filozofie: prețul probei = prețul "ferm" dat de motocompresorul LMF 100
// pentru volumul + presiunea respectivă, INDEPENDENT de ansamblul fizic ales.
//   proba = V_conductă × P × (tarif_ref / debit_ref) / 60
// La paritate, orice ansamblu dă același preț ca LMF; fiecare ansamblu poate
// avea un spor % propriu peste referință (ex: 2comp+B15 = +10%, „mai mult fier").
// Valabil DOAR ≤ presiunea max a LMF (peste, LMF nu poate lucra → referința nu se aplică).
// ════════════════════════════════════════════════════════════════
export const PRAG_MINIM_PROBA_LEI = 7000   // sub această valoare (brut, înainte de discount) ridicăm proba la prag

// ref      = configul LMF (referință): { debit_mc_min, tarif_lei_h, presiune_max_bar }
// spor_pct = sporul % al ansamblului ales, peste prețul de referință (0 = exact LMF)
// prag_min = podea pe valoarea brută a probei (default PRAG_MINIM_PROBA_LEI)
export function pretPropusProba({ v_conducta_mc, presiune_bar, ref, spor_pct = 0, prag_min = PRAG_MINIM_PROBA_LEI }) {
  const V = Number(v_conducta_mc) || 0
  const P = Number(presiune_bar) || 0
  const debitRef = Number(ref?.debit_mc_min) || 0
  const tarifRef = Number(ref?.tarif_lei_h) || 0
  const pmaxRef  = Number(ref?.presiune_max_bar) || 0
  const aplicabil = debitRef > 0 && tarifRef > 0 && V > 0 && P > 0 && P <= pmaxRef
  if (!aplicabil) {
    return { aplicabil: false, raport_ref: 0, pret_referinta: 0, pret_cu_spor: 0, pret_final: 0, sub_prag: false }
  }
  const R = tarifRef / debitRef                        // raport referință lei·min/mc (LMF: 750/7 = 107,1)
  const pret_referinta = V * P * R / 60
  const pret_cu_spor = pret_referinta * (1 + (Number(spor_pct) || 0) / 100)
  const prag = Number(prag_min) || 0
  const sub_prag = pret_cu_spor < prag
  const pret_final = sub_prag ? prag : pret_cu_spor
  return { aplicabil: true, raport_ref: R, pret_referinta, pret_cu_spor, pret_final, sub_prag }
}

export const fmtH = h => {
  const n = Number(h) || 0
  if (n === 0) return '0 h'
  if (n < 1) return `${Math.round(n * 60)} min`
  return `${n.toFixed(2)} h`
}

export const fmtNr = (n, d = 2) => (Number(n) || 0).toLocaleString('ro-RO', { minimumFractionDigits: d, maximumFractionDigits: d })

// ════════════════════════════════════════════════════════════════
// ȚOLI (NPS) — TKT-2026-0348: probele pe țevi de 10″ / 12″ nu se regăseau în lista de DN.
// Echivalentul se deduce din DIAMETRUL EXTERIOR al rândului (cel folosit și la calcul), nu din eticheta DN:
// la PE eticheta DN e chiar exteriorul (DN 250 = Ø250), deci un „DN250” de polietilenă NU e 10″ (oțel Ø273,1).
// Diametre exterioare standard pentru țeava de oțel (EN 10220 / ASME B36.10; 2½″ are două valori uzuale).
// ════════════════════════════════════════════════════════════════
const OD_TOLI = [
  [21.3, '1/2'], [26.9, '3/4'], [33.7, '1'], [42.4, '1 1/4'], [48.3, '1 1/2'], [60.3, '2'], [73.0, '2 1/2'], [76.1, '2 1/2'],
  [88.9, '3'], [114.3, '4'], [139.7, '5'], [168.3, '6'], [219.1, '8'], [273.1, '10'], [323.9, '12'], [355.6, '14'],
  [406.4, '16'], [457.0, '18'], [508.0, '20'], [559.0, '22'], [610.0, '24'], [660.0, '26'], [711.0, '28'], [762.0, '30'],
  [813.0, '32'], [864.0, '34'], [914.0, '36'], [1016.0, '40'], [1067.0, '42'], [1118.0, '44'], [1219.0, '48'],
]
const TOLERANTA_OD_MM = 0.5   // 273,0 / 273,1 și 323,8 / 323,9 apar ambele în fișe; Ø250 (PE) rămâne departe de 273,1

// Întoarce țolii („10″”) pentru un diametru exterior în mm, sau null dacă nu e o țeavă de oțel standard.
export function toliDinDiametruExterior(mm) {
  const d = typeof mm === 'number' ? mm : Number(String(mm ?? '').trim().replace(',', '.'))
  if (!Number.isFinite(d) || d <= 0) return null
  const gasit = OD_TOLI.find(([od]) => Math.abs(od - d) <= TOLERANTA_OD_MM)
  return gasit ? `${gasit[1]}″` : null
}

// Eticheta din lista de diametre: „DN250 · 10″ (273,1 mm)”; fără țoli dacă exteriorul nu e unul standard.
export function etichetaDiametru(d, fmtMm = v => fmtNr(v, 1)) {
  const toli = toliDinDiametruExterior(d?.diametru_extern_mm)
  return `${d?.dn_label ?? '?'}${toli ? ` · ${toli}` : ''} (${fmtMm(d?.diametru_extern_mm)} mm)`
}
