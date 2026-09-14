// ════════════════════════════════════════════════════════════════
// graficCPM.js — motorul de planificare, PUR (fără React, fără Supabase), ca să fie testabil.
//
// Scos din GraficLucrare.jsx pe 14.09.2026 (PR 1 Laza). Motivul: la Laza, 16 din 66 relații
// declarate „FS" aveau ES(succesor) < EF(predecesor) — graficul fusese scris de mână, nu
// calculat. Controlul care prinde asta trebuie să ruleze în poartă, adică fără browser.
//
// Convenții:
//   calcCPM   — zile de la 0, sfârșit EXCLUSIV (ef = es + durata), cum folosea GraficLucrare.
//   verificaRelatii — lucrează pe ce a DECLARAT oferta (es/ef scrise), în convenția ei; nu
//               recalculează și nu corectează nimic. Doar spune unde declarația se contrazice.
// Relații: FS (finish→start), SS, FF, SF, cu lag pozitiv sau negativ (lead).
// ════════════════════════════════════════════════════════════════

// „1FS, 3SS+10" ↔ [{id:1,tip:'FS',lag:0},{id:3,tip:'SS',lag:10}]
export const predToText = (p) => (p || []).map(x => `${x.id}${x.tip || 'FS'}${x.lag ? (x.lag > 0 ? '+' : '') + x.lag : ''}`).join(', ')
export const textToPred = (t) => (t || '').split(/[,;]+/).map(s => s.trim()).filter(Boolean).map(s => {
  const m = s.match(/^(\d+)\s*(FS|SS|FF|SF)?\s*(?:([+-])\s*(\d+))?$/i)
  return m ? { id: Number(m[1]), tip: (m[2] || 'FS').toUpperCase(), lag: (m[3] === '-' ? -1 : 1) * Number(m[4] || 0) } : null
}).filter(Boolean)

// CPM în zile: ES/EF forward, LS/LF backward, float, critic. Ciclurile se
// opresc prin plafonul de iterații (graficul rămâne calculabil, nu îngheață UI-ul).
export function calcCPM(rows) {
  const byId = {}; rows.forEach(r => { byId[r.id] = r })
  const es = {}, ef = {}
  const done = new Set()
  let pass = 0
  while (done.size < rows.length && pass < rows.length + 5) {
    pass++
    for (const r of rows) {
      if (done.has(r.id)) continue
      const preds = (r.predecesori || []).filter(p => byId[p.id])
      if (preds.some(p => !done.has(p.id))) continue
      let start = 0
      for (const p of preds) {
        const cand = p.tip === 'SS' ? es[p.id] + (p.lag || 0) : ef[p.id] + (p.lag || 0)
        if (cand > start) start = cand
      }
      es[r.id] = start
      ef[r.id] = start + (r.durata_zile || 0)
      done.add(r.id)
    }
  }
  // rândurile prinse în ciclu rămân la 0 — le marcăm
  const inCiclu = new Set(rows.filter(r => !done.has(r.id)).map(r => { es[r.id] = 0; ef[r.id] = r.durata_zile || 0; return r.id }))

  const proiectEF = Math.max(0, ...rows.map(r => ef[r.id] || 0))
  const ls = {}, lf = {}
  rows.forEach(r => { lf[r.id] = proiectEF; ls[r.id] = proiectEF - (r.durata_zile || 0) })
  // backward: succesorii impun LF
  for (let i = 0; i < rows.length + 5; i++) {
    let schimbat = false
    for (const r of rows) {
      for (const p of (r.predecesori || [])) {
        if (!byId[p.id]) continue
        const limita = p.tip === 'SS'
          ? ls[r.id] - (p.lag || 0) + (byId[p.id].durata_zile || 0)   // SS constrânge startul predecesorului
          : ls[r.id] - (p.lag || 0)
        if (limita < lf[p.id]) { lf[p.id] = limita; ls[p.id] = limita - (byId[p.id].durata_zile || 0); schimbat = true }
      }
    }
    if (!schimbat) break
  }
  const rez = {}
  rows.forEach(r => {
    const fl = (ls[r.id] ?? 0) - (es[r.id] ?? 0)
    rez[r.id] = { es: es[r.id] ?? 0, ef: ef[r.id] ?? 0, float: fl, critic: fl <= 0, ciclu: inCiclu.has(r.id) }
  })
  return { rez, total: proiectEF }
}


// ────────────────────────────────────────────────────────────────
// verificaRelatii — ce a DECLARAT oferta se contrazice singură?
//
// Intrare: activități cu es/ef scrise (cum apar în tabelul PERT depus) și predecesori
// {cod, relatie, lag}. Nu recalculează CPM, nu corectează, nu presupune că o suprapunere „e
// de fapt SS". Doar verifică fiecare relație declarată față de datele declarate.
//
// Convenția zilelor: la Laza EF = ES + D − 1 (sfârșit INCLUSIV) pe toate cele 66 de rânduri.
// GraficLucrare folosește sfârșit EXCLUSIV (ef = es + durata). Se detectează din date când nu
// e dată explicit: dacă majoritatea rândurilor au ef === es + durata − 1 ⇒ inclusiv.
//   FS: es(succ) ≥ ef(pred) + lag + (inclusiv ? 1 : 0)
//   SS: es(succ) ≥ es(pred) + lag
//   FF: ef(succ) ≥ ef(pred) + lag
//   SF: ef(succ) ≥ es(pred) + lag
// Coduri: RELATION_DATE_CONFLICT (relația și datele nu pot fi amândouă adevărate),
//         MISSING_PREDECESSOR (predecesorul citat nu există în listă),
//         UNKNOWN_RELATION_TYPE (altceva decât FS/SS/FF/SF),
//         MISSING_DATES (activitate fără es/ef — nu se poate verifica, se spune).
// ────────────────────────────────────────────────────────────────
export function detecteazaConventie(activitati) {
  let incl = 0, excl = 0
  for (const a of activitati || []) {
    if (a?.es == null || a?.ef == null || a?.durata == null) continue
    if (a.ef === a.es + a.durata - 1) incl++
    else if (a.ef === a.es + a.durata) excl++
  }
  if (!incl && !excl) return null
  return incl >= excl ? 'inclusiv' : 'exclusiv'
}

export function verificaRelatii(activitati, { conventie } = {}) {
  const lista = activitati || []
  const conv = conventie || detecteazaConventie(lista) || 'inclusiv'
  const plus = conv === 'inclusiv' ? 1 : 0
  const byCod = new Map(lista.map(a => [String(a.cod), a]))
  const probleme = []
  let relatii = 0
  for (const s of lista) {
    for (const p of (s.predecesori || [])) {
      relatii++
      const tip = String(p.relatie || p.tip || 'FS').toUpperCase()
      const lag = Number(p.lag || 0)
      const pred = byCod.get(String(p.cod))
      if (!pred) { probleme.push({ cod: 'MISSING_PREDECESSOR', succesor: s.cod, predecesor: String(p.cod), relatie: tip }); continue }
      if (!['FS', 'SS', 'FF', 'SF'].includes(tip)) { probleme.push({ cod: 'UNKNOWN_RELATION_TYPE', succesor: s.cod, predecesor: pred.cod, relatie: tip }); continue }
      if (s.es == null || s.ef == null || pred.es == null || pred.ef == null) {
        probleme.push({ cod: 'MISSING_DATES', succesor: s.cod, predecesor: pred.cod, relatie: tip }); continue
      }
      let minim, real
      if (tip === 'FS') { minim = pred.ef + lag + plus; real = s.es }
      else if (tip === 'SS') { minim = pred.es + lag; real = s.es }
      else if (tip === 'FF') { minim = pred.ef + lag; real = s.ef }
      else { minim = pred.es + lag; real = s.ef }
      if (real < minim) probleme.push({
        cod: 'RELATION_DATE_CONFLICT', succesor: s.cod, predecesor: pred.cod, relatie: tip, lag,
        asteptat_minim: minim, declarat: real, suprapunere_zile: minim - real,
      })
    }
  }
  return { conventie: conv, relatii, probleme,
    conflicte: probleme.filter(p => p.cod === 'RELATION_DATE_CONFLICT').length }
}
