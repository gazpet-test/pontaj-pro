// ════════════════════════════════════════════════════════════════
// graficMotor/cpm.js — CPM/PERT determinist pe zile lucrătoare (spec §6.2). Fără AI, fără date calendaristice:
// aici totul e în indexuri de zi lucrătoare; datele le pune index.js prin axa din calendar.js.
//
// Convenții (aceleași ca scriptul cpm.py din testul Jilava, ca să-l reproducem exact):
//   ES/LS = indexul primei zile lucrate; EF/LF = ES + durată (sfârșit EXCLUSIV); jalon: durată 0, EF = ES.
//   FS: ES_s ≥ EF_p + lag     SS: ES_s ≥ ES_p + lag     FF: EF_s ≥ EF_p + lag     SF: EF_s ≥ ES_p + lag
//   ES ≥ 0 (nimic înaintea datei de start, chiar și cu lag negativ).
//   Trecerea înapoi pornește de la finalul proiectului (max EF) pentru toate activitățile; marja = LS − ES.
//   Rezumat: ES = min ES copii, EF = max EF copii, LS = min LS, LF = max LF, marja = min marja copiilor
//   (un rezumat e critic dacă are cel puțin un copil critic).
// Legăturile se pun doar între activități (frunze); o legătură pe un rezumat e eroare (v1 — generatorul nu le produce).
// Ordinea de prelucrare e deterministă: Kahn, în ordinea din intrare.
// ════════════════════════════════════════════════════════════════

export const TIPURI_LEGATURA = ['FS', 'SS', 'FF', 'SF']
const str = (x) => (x == null ? '' : String(x).trim())

// Validează structura (coduri, părinți, durate, legături). Întoarce { probleme, noduri, legaturi }; dacă există
// probleme de gravitate 'fatal', calculul nu se poate face.
export function valideazaStructura(activitati, legaturi) {
  const probleme = []
  const fatal = (cod, mesaj, extra = {}) => probleme.push({ cod, gravitate: 'eroare', fatal: true, mesaj, ...extra })
  if (!Array.isArray(activitati) || !activitati.length) {
    fatal('FARA_ACTIVITATI', 'graficul nu are activități')
    return { probleme, noduri: [], legaturi: [] }
  }
  const noduri = []
  const dupaCod = new Map()
  activitati.forEach((a, i) => {
    const cod = str(a?.cod)
    if (!cod) { fatal('COD_LIPSA', `activitatea de pe poziția ${i + 1} nu are cod`, { pozitie: i + 1 }); return }
    if (dupaCod.has(cod)) { fatal('COD_DUBLU', `codul ${cod} apare de două ori`, { activitate: cod }); return }
    const rezumat = a.rezumat === true, jalon = a.jalon === true
    const d = a.durata_zile_lucratoare
    if (rezumat && jalon) fatal('REZUMAT_SI_JALON', `${cod}: nu poate fi și rezumat, și jalon`, { activitate: cod })
    if (!rezumat && !(Number.isInteger(d) && d >= 0)) fatal('DURATA_INVALIDA', `${cod}: durata trebuie să fie un număr întreg de zile lucrătoare ≥ 0 (are ${JSON.stringify(d)})`, { activitate: cod })
    const n = { ...a, cod, parinte: str(a.parinte) || null, rezumat, jalon, d: rezumat ? 0 : (Number.isInteger(d) ? d : 0), ordine: i }
    noduri.push(n); dupaCod.set(cod, n)
  })
  // părinți: există, sunt rezumate, fără cicluri în arbore
  for (const n of noduri) {
    if (!n.parinte) continue
    const p = dupaCod.get(n.parinte)
    if (!p) fatal('PARINTE_INEXISTENT', `${n.cod}: părintele ${n.parinte} nu există`, { activitate: n.cod })
    else if (!p.rezumat) fatal('PARINTE_NU_E_REZUMAT', `${n.cod}: părintele ${n.parinte} nu e marcat rezumat`, { activitate: n.cod })
  }
  for (const n of noduri) {
    const vazut = new Set([n.cod]); let p = n.parinte
    while (p && dupaCod.has(p)) {
      if (vazut.has(p)) { fatal('ARBORE_CICLIC', `${n.cod}: lanțul de părinți se închide în cerc (${[...vazut].join(' → ')} → ${p})`, { activitate: n.cod }); break }
      vazut.add(p); p = dupaCod.get(p).parinte
    }
  }
  const copii = new Map(noduri.map(n => [n.cod, []]))
  for (const n of noduri) if (n.parinte && copii.has(n.parinte)) copii.get(n.parinte).push(n.cod)
  for (const n of noduri) if (n.rezumat && !copii.get(n.cod).length) fatal('REZUMAT_GOL', `${n.cod}: rezumat fără activități în el`, { activitate: n.cod })

  const leg = []
  ;(Array.isArray(legaturi) ? legaturi : []).forEach((l, i) => {
    const de = str(l?.de), la = str(l?.la), tip = str(l?.tip || 'FS').toUpperCase()
    const lag = l?.lag_zile ?? 0
    const loc = { legatura: i + 1, de, la }
    if (!dupaCod.has(de) || !dupaCod.has(la)) { fatal('LEGATURA_CAPAT_INEXISTENT', `legătura ${i + 1} (${de} → ${la}): un capăt nu există`, loc); return }
    if (de === la) { fatal('LEGATURA_PE_SINE', `legătura ${i + 1}: ${de} legat de el însuși`, loc); return }
    if (!TIPURI_LEGATURA.includes(tip)) { fatal('TIP_LEGATURA_INVALID', `legătura ${i + 1} (${de} → ${la}): tip „${tip}” (aștept FS/SS/FF/SF)`, loc); return }
    if (!Number.isInteger(lag)) { fatal('LAG_INVALID', `legătura ${i + 1} (${de} → ${la}): decalajul trebuie să fie întreg (zile lucrătoare), are ${JSON.stringify(lag)}`, loc); return }
    if (dupaCod.get(de).rezumat || dupaCod.get(la).rezumat) { fatal('LEGATURA_PE_REZUMAT', `legătura ${i + 1} (${de} → ${la}): legăturile se pun între activități, nu pe rezumate`, loc); return }
    leg.push({ de, la, tip, lag, motiv: str(l?.motiv) || null, index: i })
  })
  return { probleme, noduri, legaturi: leg, dupaCod, copii }
}

// Caută un ciclu în rețeaua de legături (DFS determinist); întoarce lista de coduri a ciclului sau null.
function gasesteCiclu(frunze, succ) {
  const stare = new Map() // 1 = pe stivă, 2 = terminat
  const stiva = []
  const dfs = (c) => {
    stare.set(c, 1); stiva.push(c)
    for (const l of succ.get(c) || []) {
      const s = stare.get(l.la)
      if (s === 1) return [...stiva.slice(stiva.indexOf(l.la)), l.la]
      if (!s) { const r = dfs(l.la); if (r) return r }
    }
    stiva.pop(); stare.set(c, 2); return null
  }
  for (const c of frunze) if (!stare.get(c)) { const r = dfs(c); if (r) return r }
  return null
}

// CPM pe frunze + agregarea pe rezumate. Intrare = rezultatul valideazaStructura fără probleme fatale.
export function calculeazaCPM({ noduri, legaturi, dupaCod, copii }) {
  const frunze = noduri.filter(n => !n.rezumat).map(n => n.cod)
  const pred = new Map(frunze.map(c => [c, []])), succ = new Map(frunze.map(c => [c, []]))
  for (const l of legaturi) { pred.get(l.la).push(l); succ.get(l.de).push(l) }

  // Kahn determinist
  const grad = new Map(frunze.map(c => [c, pred.get(c).length]))
  const coada = frunze.filter(c => grad.get(c) === 0)
  const topo = []
  while (coada.length) {
    const c = coada.shift(); topo.push(c)
    for (const l of succ.get(c)) { grad.set(l.la, grad.get(l.la) - 1); if (grad.get(l.la) === 0) coada.push(l.la) }
  }
  if (topo.length !== frunze.length) {
    const ciclu = gasesteCiclu(frunze.filter(c => grad.get(c) > 0), succ)
    return { ok: false, ciclu, probleme: [{ cod: 'CICLU', gravitate: 'eroare', fatal: true, ciclu, mesaj: `buclă în rețea: ${(ciclu || []).join(' → ')}` }] }
  }

  const r = new Map()
  for (const c of topo) {
    const d = dupaCod.get(c).d
    let es = 0, brut = -Infinity
    for (const l of pred.get(c)) {
      const P = r.get(l.de)
      const v = l.tip === 'FS' ? P.ef + l.lag : l.tip === 'SS' ? P.es + l.lag : l.tip === 'FF' ? P.ef + l.lag - d : P.es + l.lag - d
      if (v > brut) brut = v
      if (v > es) es = v
    }
    // limitat_la_start: legăturile ar fi permis un început ÎNAINTEA datei de start (decalaj negativ / SF / FF) și l-a oprit ES ≥ 0;
    // exportul MSPDI pune pe ea „începe nu mai devreme de” data de start, ca orice planificator să dea același rezultat
    r.set(c, { es, ef: es + d, d, limitat_la_start: brut < 0 })
  }
  const T = Math.max(0, ...frunze.map(c => r.get(c).ef))
  for (const c of [...topo].reverse()) {
    const x = r.get(c)
    let lf = T
    for (const l of succ.get(c)) {
      const S = r.get(l.la)
      const v = l.tip === 'FS' ? S.ls - l.lag : l.tip === 'SS' ? S.ls - l.lag + x.d : l.tip === 'FF' ? S.lf - l.lag : S.lf - l.lag + x.d
      if (v < lf) lf = v
    }
    x.lf = lf; x.ls = lf - x.d; x.marja = x.ls - x.es; x.critic = x.marja <= 0
  }
  // rezumate: de jos în sus (un rezumat după toți copiii lui)
  const adancime = (n) => { let k = 0, p = n.parinte; while (p) { k++; p = dupaCod.get(p).parinte } return k }
  const rezumate = noduri.filter(n => n.rezumat).sort((a, b) => adancime(b) - adancime(a) || a.ordine - b.ordine)
  for (const n of rezumate) {
    const cs = copii.get(n.cod).map(c => r.get(c))
    const es = Math.min(...cs.map(x => x.es)), ef = Math.max(...cs.map(x => x.ef))
    const marja = Math.min(...cs.map(x => x.marja))
    r.set(n.cod, { es, ef, d: ef - es, ls: Math.min(...cs.map(x => x.ls)), lf: Math.max(...cs.map(x => x.lf)), marja, critic: marja <= 0 })
  }

  // legături „conducătoare” (fără rezervă pe legătură) — pentru drumul critic și ramificațiile lui
  const rezervaLegatura = (l) => {
    const P = r.get(l.de), S = r.get(l.la)
    return l.tip === 'FS' ? S.es - (P.ef + l.lag) : l.tip === 'SS' ? S.es - (P.es + l.lag) : l.tip === 'FF' ? S.ef - (P.ef + l.lag) : S.ef - (P.es + l.lag)
  }
  const legCritice = legaturi.filter(l => r.get(l.de).critic && r.get(l.la).critic && rezervaLegatura(l) === 0)
  const ordine = new Map(noduri.map(n => [n.cod, n.ordine]))
  const lista = frunze.filter(c => r.get(c).critic).sort((a, b) => r.get(a).es - r.get(b).es || r.get(a).ef - r.get(b).ef || ordine.get(a) - ordine.get(b))
  const nrSucc = new Map()
  for (const l of legCritice) nrSucc.set(l.de, new Set([...(nrSucc.get(l.de) || []), l.la]))
  const ramificatii = lista.filter(c => (nrSucc.get(c)?.size || 0) > 1).map(c => ({ de: c, spre: [...nrSucc.get(c)] }))

  return { ok: true, rezultate: r, durata: T, topo, pred, succ, drumCritic: { lista, legaturi: legCritice.map(l => ({ de: l.de, la: l.la, tip: l.tip, lag: l.lag })), ramificatii } }
}
