// Gruparea registrului de cerințe pe SUBIECT (Z1, tichetele Silviu 0231/0240/0275/0276).
// Subiectul vine din ofertare_cerinte_subiect (regulă deterministă versionată + mutările omului).
// Aici doar se ordonează ce se vede: nu se schimbă nimic la cerință (text, E2, stare, acoperire).

export const NECLASIFICAT = { cheie: 'neclasificat', eticheta: '❔ Neclasificate', ordine: 1e9 }

// cerinte: rândurile deja filtrate (registru/tip/stare) — contoarele se fac pe TOT setul filtrat.
// subiecte: { [cerinta_id]: { subiect, sursa, alternative } }
// reguli:   [{ cheie, eticheta, ordine }]
// → [{ cheie, eticheta, total, confirmate, deVerificat, siAici, randuri: [{ c, numar, info }] }]
export function grupeazaPeSubiect(cerinte, subiecte, reguli) {
  const dupaCheie = new Map((reguli || []).map(r => [r.cheie, r]))
  const grupuri = new Map()
  for (const c of cerinte || []) {
    const info = subiecte?.[c.id] || null
    const cheie = info && dupaCheie.has(info.subiect) ? info.subiect : 'neclasificat'
    if (!grupuri.has(cheie)) {
      const r = cheie === 'neclasificat' ? NECLASIFICAT : dupaCheie.get(cheie)
      grupuri.set(cheie, { cheie, eticheta: r.eticheta, ordine: r.ordine, total: 0, confirmate: 0, deVerificat: 0, siAici: 0, randuri: [] })
    }
    const g = grupuri.get(cheie)
    g.total++
    if (c.confirmata_de) g.confirmate++
    if (esteDeVerificat(info)) g.deVerificat++
    g.randuri.push({ c, info })
  }
  // Rândurile transversale („managerul întocmește graficul") stau o singură dată, în grupul principal;
  // în grupurile alternative doar se numără, ca să nu se dubleze contoarele.
  for (const c of cerinte || []) {
    const alt = subiecte?.[c.id]?.alternative
    if (Array.isArray(alt)) alt.forEach(k => { if (grupuri.has(k)) grupuri.get(k).siAici++ })
  }
  const lista = [...grupuri.values()].sort((a, b) => a.ordine - b.ordine)
  lista.forEach((g, gi) => {
    g.randuri.sort((a, b) => (a.c.nr_ordine ?? 0) - (b.c.nr_ordine ?? 0))
    g.randuri.forEach((r, ri) => { r.numar = `${gi + 1}.${ri + 1}` })   // Silviu: „101.1, 101.2…"
  })
  return lista
}

// Merită o privire: regula a găsit și alte subiecte și omul n-a decis încă, SAU subiectul a fost
// moștenit de pe versiunea veche a cerinței (decizia omului nu s-a luat pe textul nou — Copilot, 24.09).
export function esteDeVerificat(info) {
  if (!info) return false
  if (info.mostenit_de_la) return true
  return info.sursa === 'auto' && Array.isArray(info.alternative) && info.alternative.length > 0
}
