// ════════════════════════════════════════════════════════════════
// graficMotor — Etapa 2 din graficul automat (docs/ofertare/GRAFIC_AUTOMAT_SPEC.md §6): motorul de calcul determinist.
// Folosit și de workerul de pe serverul AI, și de UI. PUR: fără React, fără Supabase, fără DOM, fără AI.
// Modul NOU (decizia C4): nu modifică graficCPM.js, Execuție sau motorul PEHD din GraficPoarta.jsx.
//
// calculeazaGrafic(intrare) → { calculat, pozitii, drum_critic, probleme, termen, poate_fi_go, … }
//   intrare = {
//     activitati: [{ cod, parinte, rezumat, jalon, denumire, categorie, articole_deviz[], executant,
//                    durata_zile_lucratoare, sursa_durata, tip_echipa, utilaje[] }],   // ieșirea generatorului (§5.2)
//     legaturi:   [{ de, la, tip: FS|SS|FF|SF, lag_zile, motiv }],
//     data_start: 'AAAA-LL-ZZ' (data OI), mod: 'schita'|'lucru'|'depunere',
//     termen:     { tip, valoare } (vezi verificari.dataLimita), articole_validate: [{ cod }] (ofertare_cantitati validate),
//     parametri:  { calendar, echipe, capacitate_subcontractanti, utilaje, executant_propriu },
//   }
// Datele: activitate cu durată → start = ziua ES, final = ziua EF−1; jalon → sfârșitul zilei ES−1 (sau ziua 0 la ES = 0).
// ════════════════════════════════════════════════════════════════

import { creeazaCalendar, creeazaAxa, dinIso } from './calendar.js'
import { valideazaStructura, calculeazaCPM } from './cpm.js'
import { verificaStructura, MODURI } from './verificari.js'

export { pasteOrtodox, sarbatoriLegaleRO, creeazaCalendar, creeazaAxa, adaugaLuni, adaugaZile } from './calendar.js'
export { valideazaStructura, calculeazaCPM, TIPURI_LEGATURA } from './cpm.js'
export { verificaStructura, dataLimita, MODURI, CATEGORII } from './verificari.js'
export { genereazaMSPDI } from './mspdi.js'

export const VERSIUNE_MOTOR = 'graficMotor/1'

// Datele unei poziții din indexurile ei (convenția de mai sus, aceeași ca în cpm.py din testul Jilava).
export function dateDinIndex(axa, s, f) {
  if (f > s) return { start: axa.zi(s), final: axa.zi(f - 1), jalon: false }
  const d = s > 0 ? axa.zi(s - 1) : axa.zi(0)
  return { start: d, final: d, jalon: true, la_sfarsitul_zilei: s > 0 }
}

export function calculeazaGrafic(intrare = {}) {
  const mod = intrare.mod || 'lucru'
  if (!MODURI.includes(mod)) throw new Error(`mod necunoscut: ${JSON.stringify(mod)} (${MODURI.join(' / ')})`)
  const parametri = intrare.parametri || {}
  dinIso(intrare.data_start)
  const calendar = creeazaCalendar(parametri.calendar || {})
  const axa = creeazaAxa(calendar, intrare.data_start)
  const baza = { versiune_motor: VERSIUNE_MOTOR, mod, data_start: intrare.data_start, prima_zi_lucratoare: axa.start, calendar: { abateri: calendar.abateri, fara_sarbatori_legale: calendar.faraSarbatori, parametri: parametri.calendar || {} } }
  const probleme = []
  if (axa.start !== intrare.data_start) probleme.push({ cod: 'START_ZI_NELUCRATOARE', gravitate: 'avertisment', mesaj: `data de start ${intrare.data_start} nu e zi lucrătoare (${calendar.motivLiber(intrare.data_start)}); calculul pornește la ${axa.start}` })

  const st = valideazaStructura(intrare.activitati, intrare.legaturi)
  probleme.push(...st.probleme)
  if (st.probleme.some(x => x.fatal)) return { ...baza, calculat: false, probleme, pozitii: [], drum_critic: null, termen: null, poate_fi_go: false, trece_verificarile: false }
  const cpm = calculeazaCPM(st)
  if (!cpm.ok) return { ...baza, calculat: false, probleme: [...probleme, ...cpm.probleme], pozitii: [], drum_critic: null, termen: null, poate_fi_go: false, trece_verificarile: false }

  const dataFinal = dateDinIndex(axa, 0, cpm.durata).final
  const ver = verificaStructura({ noduri: st.noduri, legaturi: st.legaturi, cpm, mod, articoleValidate: intrare.articole_validate, parametri, calendar, axa, termen: intrare.termen, dataOI: intrare.data_start, dataFinal })
  probleme.push(...ver.probleme)

  const nivel = (n) => { let k = 0, p = n.parinte; while (p) { k++; p = st.dupaCod.get(p).parinte } return k }
  const pozitii = st.noduri.map(n => {
    const x = cpm.rezultate.get(n.cod)
    const e = dateDinIndex(axa, x.es, x.ef), l = dateDinIndex(axa, x.ls, x.lf)
    return {
      cod: n.cod, parinte: n.parinte, nivel: nivel(n), rezumat: n.rezumat, jalon: n.jalon,
      denumire: n.denumire ?? '', categorie: n._cat ?? n.categorie ?? null, executant: n.executant ?? null,
      articole_deviz: Array.isArray(n.articole_deviz) ? n.articole_deviz : [], tip_echipa: n.tip_echipa ?? null,
      utilaje: Array.isArray(n.utilaje) ? n.utilaje : [], sursa_durata: n.rezumat ? 'calculat (rezumat)' : (n.sursa_durata ?? null),
      durata: x.d, es: x.es, ef: x.ef, ls: x.ls, lf: x.lf, marja: x.marja, critic: x.critic, limitat_la_start: x.limitat_la_start === true,
      start: e.start, final: e.final, ls_data: l.start, lf_data: l.final,
      predecesori: n.rezumat ? [] : cpm.pred.get(n.cod).map(q => ({ de: q.de, tip: q.tip, lag: q.lag, motiv: q.motiv })),
    }
  })
  // Momentele (dată + oră), ca în MS Project: activitatea 08:00 → 17:00; jalonul la 17:00 în ziua ES−1 (08:00 la ES = 0).
  // Rezumatul ia cel mai devreme început și cel mai târziu sfârșit al copiilor, deci un rezumat care începe cu un jalon
  // începe în ziua jalonului (verificat cu planificatorul MPXJ pe graficul Y: 6.2, 7.2) — nu în ziua ES.
  const dupaCod = new Map(pozitii.map(p => [p.cod, p]))
  // Aceeași regulă și pentru datele târzii (LS/LF), ca ES și LS ale aceluiași rezumat să rămână coerente (r1 Jak P2).
  const moment = (data, idx, sf) => `${data}T${sf && idx > 0 ? '17:00:00' : '08:00:00'}`
  for (const p of pozitii) {
    if (p.rezumat) continue
    const sf = p.jalon || p.durata === 0
    p.start_moment = moment(p.start, p.es, sf)
    p.final_moment = sf ? p.start_moment : `${p.final}T17:00:00`
    p.ls_moment = moment(p.ls_data, p.ls, sf)
    p.lf_moment = sf ? p.ls_moment : `${p.lf_data}T17:00:00`
  }
  for (const n of [...st.noduri].filter(n => n.rezumat).sort((a, b) => dupaCod.get(b.cod).nivel - dupaCod.get(a.cod).nivel || a.ordine - b.ordine)) {
    const p = dupaCod.get(n.cod), cs = st.copii.get(n.cod).map(c => dupaCod.get(c))
    p.start_moment = cs.map(c => c.start_moment).sort()[0]
    p.final_moment = cs.map(c => c.final_moment).sort().at(-1)
    p.ls_moment = cs.map(c => c.ls_moment).sort()[0]
    p.lf_moment = cs.map(c => c.lf_moment).sort().at(-1)
    p.start = p.start_moment.slice(0, 10); p.final = p.final_moment.slice(0, 10)
    p.ls_data = p.ls_moment.slice(0, 10); p.lf_data = p.lf_moment.slice(0, 10)
  }
  const erori = probleme.filter(x => x.gravitate === 'eroare').length
  return {
    ...baza, calculat: true, pozitii, probleme,
    durata_zile_lucratoare: cpm.durata, data_final: dataFinal, jalon_final: ver.jalonFinal,
    drum_critic: cpm.drumCritic, termen: ver.termen, capacitate: ver.capacitate,
    trece_verificarile: erori === 0,
    // ce folosește exportul MSPDI, luat din aceeași intrare (r1 Jak: exportul nu mai depinde de apelant să retrimită lista)
    export: { executant_propriu: String(parametri.executant_propriu || 'Gazpet').trim(), subcontractanti: Array.isArray(parametri.subcontractanti) ? parametri.subcontractanti.map(s => String(s).trim()) : [] },
    // GO se poate da doar pe un grafic în modul „depunere” fără nicio eroare (spec §5.3, §7 regula GO). Schița nu e niciodată GO.
    poate_fi_go: mod === 'depunere' && erori === 0,
  }
}

// Tabelul PERT (spec §6.4.3) — câte un rând pentru FIECARE poziție (activități, jaloane, rezumate), în ordinea graficului.
export function tabelPERT(rez) {
  if (!rez?.calculat) return []
  return rez.pozitii.map(p => ({
    cod: p.cod, denumire: p.denumire, rezumat: p.rezumat, jalon: p.jalon, executant: p.executant, durata: p.durata,
    ES: p.start, EF: p.final, LS: p.ls_data, LF: p.lf_data, marja: p.marja, critic: p.critic,
  }))
}

// Drumul critic ca listă (spec §6.2): activitățile cu marjă 0, în ordinea ES, cu predecesorii lor critici conducători.
export function tabelDrumCritic(rez) {
  if (!rez?.calculat) return []
  const dupaCod = new Map(rez.pozitii.map(p => [p.cod, p]))
  const leg = rez.drum_critic.legaturi
  return rez.drum_critic.lista.map((c, i) => {
    const p = dupaCod.get(c)
    return { nr: i + 1, cod: c, denumire: p.denumire, durata: p.durata, start: p.start, final: p.final,
      predecesori_critici: leg.filter(l => l.la === c).map(l => ({ de: l.de, tip: l.tip, lag: l.lag })) }
  })
}
