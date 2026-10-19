// Logica pură a butonului „Probă extractor” (Ofertare, 20.10.2026 — varianta (c) propusă lui Răzvan): consumul bugetului AI pe
// licitație + scop și bucla de rulare a extragerii structurate (edge ofertare-cantitati-extrage, mod 'structurat') până la capăt.

// consumul = decontat (cost real) + rezervările încă deschise / necunoscute / abandonate (la suma rezervată) — aceeași definiție ca
// fn_ofertare_cb_consum (20261031a), calculată din ofertare_ai_rezervari (care e citibilă pentru authenticated)
export function consumBuget(rezervari) {
  let s = 0
  for (const r of rezervari || []) {
    // exact ca fn_ofertare_cb_consum: decontata → cost_real, orice altă stare (deschisa / necunoscuta / abandonata) → suma rezervată
    s += r.stare === 'decontata' ? Number(r.cost_real || 0) : Number(r.suma_rezervata || 0)
  }
  return Math.round(s * 1e4) / 1e4
}

// cererea de cheltuială activă (scop, licitație, nevalidă după valabil_pana) — DOAR pe toată licitația (lot_domeniu 'toate'): o cerere
// pe un lot anume ar rula doar acel lot, iar butonul prezintă o probă pe toată licitația (review Copilot #797 r1, P2)
export function cerereActiva(cereri, scop, acum = Date.now()) {
  return (cereri || []).filter(c => c.scop === scop && c.stare === 'activa' && Date.parse(c.valabil_pana) > acum && (c.lot_domeniu ?? 'toate') === 'toate')
    .sort((a, b) => Date.parse(b.valabil_pana) - Date.parse(a.valabil_pana))[0] || null
}
// cererile active pe un lot anume (doar afișate, nu folosite de buton)
export const cereriPeLot = (cereri, scop, acum = Date.now()) =>
  (cereri || []).filter(c => c.scop === scop && c.stare === 'activa' && Date.parse(c.valabil_pana) > acum && (c.lot_domeniu ?? 'toate') !== 'toate')

// rulează cât timp edge-ul se oprește pe bugetul de timp (~60 s / apel); se oprește la orice altceva (gata, plafon, eroare, oprire)
// invoke(body) → { data, error }; laPas(i, raspuns) pentru progres; trebuieOprit() → oprire cerută de om între apeluri
export async function ruleazaPanaLaCapat(invoke, body, { maxPasi = 20, laPas = () => {}, trebuieOprit = () => false } = {}) {
  const pasi = []
  for (let i = 0; i < maxPasi; i++) {
    if (trebuieOprit()) return { pasi, motiv: 'oprit_de_om' }
    // review Gemini #797 r1 (P2): o excepție (rețea) se întoarce ca eroare, nu se aruncă
    let data = null, error = null
    try { ({ data, error } = await invoke(body)) } catch (e) { error = { message: e?.message || String(e) } }
    if (error || data?.error) { const e = { pas: i, eroare: data?.error || error?.message || String(error) }; pasi.push(e); laPas(i, e); return { pasi, motiv: 'eroare' } }
    const p = { pas: i, oprit: data?.oprit ?? null, felii_apelate: data?.felii_apelate ?? 0, cost_usd: Number(data?.cost_usd || 0),
      felii_cu_deficit_b1: data?.felii_cu_deficit_b1 ?? null, felii_escaladate: data?.felii_escaladate ?? null, extractor: data?.extractor ?? null,
      erori: (data?.raport || []).filter(x => x.eroare || x.refuz || x.refuz_rezervare).length }
    pasi.push(p); laPas(i, p)
    if (p.oprit !== 'buget_timp') return { pasi, motiv: p.oprit ? String(p.oprit) : 'gata' }
    // review Gemini #797 r1 (P2): un pas oprit pe timp FĂRĂ nicio felie apelată nu avansează — nu se repetă în gol
    if (!(p.felii_apelate > 0)) return { pasi, motiv: 'fara_progres' }
  }
  return { pasi, motiv: 'max_pasi' }
}

export const totalPasi = (pasi) => pasi.reduce((a, p) => ({
  felii: a.felii + (p.felii_apelate || 0), cost: Math.round((a.cost + (p.cost_usd || 0)) * 1e4) / 1e4,
  deficit: a.deficit + (p.felii_cu_deficit_b1 || 0), escaladate: a.escaladate + (p.felii_escaladate || 0), erori: a.erori + (p.erori || 0),
}), { felii: 0, cost: 0, deficit: 0, escaladate: 0, erori: 0 })
