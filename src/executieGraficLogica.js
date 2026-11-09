// ═══════════════════════════════════════════════════════════════════════════
// executieGraficLogica.js — logica pură a tab-ului Execuție → „📅 Grafic” (graficul de execuție importat din MS Project)
// Date: executie_grafic_revizii + executie_grafic_activitati (migrarea 20261202a), scrise DOAR de importul
// scripts/grafic/import_mpp.py -> fn_executie_grafic_importa. Aici: maparea JSON-ului importului în forma rândurilor din BD
// (pentru teste și previzualizare), arborele pliabil, „depășit”, scara pe săptămâni, formatarea.
// Datele sunt șiruri 'AAAA-LL-ZZ' (zile calendaristice, fără oră): se compară ca text și se transformă în zile prin
// Date.UTC pe componente (L17: niciodată new Date('AAAA-LL-ZZ') local).
// ═══════════════════════════════════════════════════════════════════════════

// ── forma rândurilor din BD (aceeași ordine ca în CREATE TABLE din 20261202a; testul de paritate citește migrarea) ──
export const COLOANE_REVIZIE = ['id', 'proiect_id', 'eticheta', 'sursa_fisier', 'sursa_sha256', 'continut_sha256', 'tip_fisier', 'data_stare', 'camp_pct_plan',
  'camp_pct_raportat', 'nr_activitati', 'metadate', 'importat_la', 'importat_de', 'activ']
export const COLOANE_ACTIVITATE = ['id', 'revizie_id', 'ordine', 'uid_sursa', 'wbs', 'nivel', 'nume', 'start_plan', 'finish_plan', 'start_real',
  'finish_real', 'start_baseline', 'finish_baseline', 'durata_zile', 'pct_realizat', 'pct_plan', 'pct_raportat', 'milestone', 'rezumat', 'activ',
  'predecesori', 'resurse', 'deviz_cod']
// cheile unei activități din JSON-ul importului pe care le citește RPC-ul (e->'…'); uid -> uid_sursa; parinte_uid se validează
// (arborele), nu se scrie
export const CHEI_JSON_ACTIVITATE = ['ordine', 'uid', 'parinte_uid', 'wbs', 'nivel', 'nume', 'start_plan', 'finish_plan', 'start_real', 'finish_real',
  'start_baseline', 'finish_baseline', 'durata_zile', 'pct_realizat', 'pct_plan', 'pct_raportat', 'milestone', 'rezumat', 'activ',
  'predecesori', 'resurse']
const META_REVIZIE = ['aplicatie', 'mpxj_versiune', 'minute_pe_zi', 'proiect_start', 'proiect_finish', 'randuri_goale', 'sursa_octeti', 'extras_la']

const sauNull = v => (v === undefined ? null : v)

/** Rândul executie_grafic_revizii pe care l-ar scrie fn_executie_grafic_importa pentru acest JSON (importat_de = NULL: script). */
export function revizieDinJson(doc, { id = 1, importat_la = '2026-01-01T00:00:00+00:00', activ = false } = {}) {
  const r = doc.revizie || {}
  const extra = {}
  for (const k of META_REVIZIE) if (r[k] != null) extra[k] = r[k]   // jsonb_strip_nulls din RPC
  return {
    id, proiect_id: sauNull(r.proiect_id), eticheta: r.eticheta, sursa_fisier: r.sursa_fisier, sursa_sha256: r.sursa_sha256,
    continut_sha256: null,   // amprenta conținutului normalizat o calculează RPC-ul (aici nu e folosită)
    tip_fisier: sauNull(r.tip_fisier), data_stare: sauNull(r.data_stare), camp_pct_plan: sauNull(r.camp_pct_plan),
    camp_pct_raportat: sauNull(r.camp_pct_raportat), nr_activitati: (doc.activitati || []).length,
    // ca în RPC: din statistici se păstrează doar numărul de activități (= inventarul cititorului verificat de RPC)
    metadate: { statistici: { activitati: (doc.activitati || []).length, inventar_cititor: (doc.activitati || []).length },
      campuri_lipsa: doc.campuri_lipsa || [], incerte: doc.incerte, ...extra },
    importat_la, importat_de: null, activ,
  }
}

/** Rândurile executie_grafic_activitati ale reviziei (id-uri sintetice, crescătoare în ordinea fișierului; deviz_cod gol la import). */
export function activitatiDinJson(doc, revizieId, idStart = 1) {
  return (doc.activitati || []).map((a, i) => ({
    id: idStart + i, revizie_id: revizieId, ordine: a.ordine, uid_sursa: a.uid, wbs: a.wbs, nivel: a.nivel, nume: a.nume,
    start_plan: sauNull(a.start_plan), finish_plan: sauNull(a.finish_plan), start_real: sauNull(a.start_real), finish_real: sauNull(a.finish_real),
    start_baseline: sauNull(a.start_baseline), finish_baseline: sauNull(a.finish_baseline), durata_zile: sauNull(a.durata_zile),
    pct_realizat: a.pct_realizat, pct_plan: sauNull(a.pct_plan), pct_raportat: sauNull(a.pct_raportat),
    milestone: a.milestone, rezumat: a.rezumat, activ: a.activ, predecesori: a.predecesori, resurse: a.resurse, deviz_cod: null,
  }))
}

// ── revizia implicită: cea activă; altfel cea mai recentă după importat_la (apoi id) ──
export function revizieImplicita(revizii) {
  if (!revizii?.length) return null
  const activa = revizii.find(r => r.activ === true)
  if (activa) return activa
  return [...revizii].sort((a, b) => (String(b.importat_la || '') > String(a.importat_la || '') ? 1
    : String(b.importat_la || '') < String(a.importat_la || '') ? -1 : b.id - a.id))[0]
}

/** null = activitățile citite sunt exact cele ale reviziei; altfel textul erorii (L12: nimic nu lipsește tacit). */
export function verificaActivitati(acts, revizie) {
  const n = Number(revizie?.nr_activitati)
  if (!Number.isInteger(n) || n < 1) return 'Revizia nu are numărul de activități declarat.'
  if (acts.length !== n) return `Graficul e incomplet: am citit ${acts.length} din ${n} activități.`
  for (let i = 0; i < acts.length; i++) {
    if (acts[i].ordine !== i) return `Graficul e incomplet: lipsește activitatea nr. ${i + 1} din ordinea fișierului.`
  }
  return null
}

// ── arborele: ordinea din fișier + nivel. Copiii unui rând sunt rândurile următoare cu nivel mai mare. ──
/** Doar rezumatele de nivel 1–2 se pliază (nivelul 0 = rândul de proiect din MS Project, mereu afișat, fără comutator). */
export const arePliere = a => a.rezumat === true && a.nivel >= 1 && a.nivel <= 2

/** Rândurile vizibile: se sar descendenții rândurilor pliate (pliate = Set de uid_sursa). acts în ordinea fișierului. */
export function randuriVizibile(acts, pliate) {
  const rez = []
  let sub = null   // nivelul rândului pliat sub care se ascunde
  for (const a of acts) {
    if (sub != null && a.nivel > sub) continue
    sub = null
    rez.push(a)
    if (pliate.has(a.uid_sursa) && arePliere(a)) sub = a.nivel
  }
  return rez
}

/** uid-urile tuturor rândurilor pliabile („Restrânge tot”). */
export const toatePliabile = acts => new Set(acts.filter(arePliere).map(a => a.uid_sursa))

/** Activitatea are finish-ul plan trecut (strict înainte de azi) și nu e terminată; inactivele și cele fără finish nu se marchează. */
export function eDepasita(a, azi) {
  if (a.activ === false || !a.finish_plan || !azi) return false
  const p = Number(a.pct_realizat)
  if (!Number.isFinite(p)) return false
  return a.finish_plan < azi && p < 100
}

/** „Doar depășite”: depășitele + strămoșii lor (ca să se vadă unde stau), în ordinea fișierului. */
export function doarDepasiteCuStramosi(acts, azi) {
  const pastrez = new Set()
  const stiva = []
  for (const a of acts) {
    while (stiva.length && stiva[stiva.length - 1].nivel >= a.nivel) stiva.pop()
    if (eDepasita(a, azi)) { pastrez.add(a.ordine); for (const s of stiva) pastrez.add(s.ordine) }
    stiva.push(a)
  }
  return acts.filter(a => pastrez.has(a.ordine))
}

// ── zile și săptămâni (zile calendaristice, UTC pe componente) ──
const pad2 = n => String(n).padStart(2, '0')
/** 'AAAA-LL-ZZ' -> numărul zilei (zile de la 1970-01-01); orice altceva -> null. */
export function zi(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '')
  if (!m) return null
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3])
  const d = new Date(t)
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return null
  return t / 864e5
}
export function dinZi(n) {
  const d = new Date(n * 864e5)
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
}
/** Lunea săptămânii zilei n (luni = începutul săptămânii). */
export const luniaSaptamanii = n => n - ((new Date(n * 864e5).getUTCDay() + 6) % 7)

const LUNI = ['ian', 'feb', 'mar', 'apr', 'mai', 'iun', 'iul', 'aug', 'sep', 'oct', 'nov', 'dec']

/**
 * Scara pe săptămâni: de la lunea săptămânii celei mai mici date (start plan / baseline) până la duminica săptămânii celei mai mari
 * (finish plan / baseline). { z0 (ziua de luni de început), nrSapt, luni: [{ eticheta, an, deLa, nr }], ani: [{ an, deLa, nr }] }
 * (deLa / nr în săptămâni; o săptămână aparține lunii și anului în care cade lunea ei). null dacă nu există nicio dată.
 */
export function scaraSaptamani(acts) {
  let min = null, max = null
  for (const a of acts) {
    for (const c of ['start_plan', 'start_baseline', 'finish_plan', 'finish_baseline']) {
      const z = zi(a[c])
      if (z == null) continue
      if (min == null || z < min) min = z
      if (max == null || z > max) max = z
    }
  }
  if (min == null) return null
  const z0 = luniaSaptamanii(min)
  const nrSapt = (luniaSaptamanii(max) - z0) / 7 + 1
  const luni = [], ani = []
  for (let s = 0; s < nrSapt; s++) {
    const d = new Date((z0 + s * 7) * 864e5)
    const an = d.getUTCFullYear(), l = d.getUTCMonth()
    const ul = luni[luni.length - 1]
    if (ul && ul.an === an && ul.luna === l) ul.nr += 1
    else luni.push({ an, luna: l, eticheta: LUNI[l], deLa: s, nr: 1 })
    const ua = ani[ani.length - 1]
    if (ua && ua.an === an) ua.nr += 1
    else ani.push({ an, deLa: s, nr: 1 })
  }
  return { z0, nrSapt, luni, ani }
}

/** Poziția unei bare pe scară, în săptămâni (fracționar, pe zile): finish inclusiv (o zi = 1/7 săptămâni). null dacă lipsesc datele. */
export function pozitieBara(scara, start, finish) {
  const a = zi(start), b = zi(finish)
  if (!scara || a == null || b == null || b < a) return null
  return { stanga: (a - scara.z0) / 7, latime: (b - a + 1) / 7 }
}
/** Poziția unei zile (jalon, „azi”) pe scară, în săptămâni, la mijlocul zilei; null dacă e în afara scării sau invalidă. */
export function pozitieZi(scara, s) {
  const a = zi(s)
  if (!scara || a == null) return null
  const x = (a - scara.z0 + 0.5) / 7
  return x < 0 || x > scara.nrSapt ? null : x
}

// ── formatare ──
/** 'AAAA-LL-ZZ' -> 'ZZ.LL.AAAA'; lipsă / invalid -> '—'. */
export function fmtData(s) {
  if (zi(s) == null) return '—'
  const [a, l, z] = s.split('-')
  return `${z}.${l}.${a}`
}
/** 40 -> '40'; 93.82 -> '93,82'; null -> '—'. */
export function fmtNumar(v) {
  if (v == null || v === '') return '—'
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString('ro-RO', { maximumFractionDigits: 2, useGrouping: false })
}
export const fmtPct = v => (v == null || v === '' || !Number.isFinite(Number(v)) ? '—' : `${fmtNumar(v)}%`)

/** Numele fișierului sursă, fără cale (și, pentru un fișier din arhivă „arhiva.zip!interior.mpp”, doar numele interior). */
export const numeFisier = cale => String(cale || '').split(/[\\/!]/).filter(Boolean).pop() || '—'

/** Nota despre valorile incerte din coloanele de raport (metadate.incerte = [{ wbs, camp, valoare }]). null dacă nu există. */
export function notaIncerte(metadate) {
  const inc = Array.isArray(metadate?.incerte) ? metadate.incerte : []
  if (!inc.length) return null
  const wbs = inc.slice(0, 8).map(x => x.wbs).join(', ') + (inc.length > 8 ? ', …' : '')
  return inc.length === 1
    ? `1 valoare necitibilă în coloanele de raport (% plan / % raport): WBS ${wbs}`
    : `${inc.length} valori necitibile în coloanele de raport (% plan / % raport): WBS ${wbs}`
}

/** Eroare de citire -> { tip: 'lipsa' (tabelul nu există încă) | 'eroare', text }. L18: eroarea nu devine „niciun grafic”. */
export function descrieEroare(e) {
  const cod = e?.code, msg = String(e?.message || e || '')
  if (cod === '42P01' || cod === 'PGRST205' || /Could not find the table|relation .* does not exist/i.test(msg)) {
    return { tip: 'lipsa', text: 'Graficul de execuție nu e încă activat în baza de date.' }
  }
  return { tip: 'eroare', text: 'Nu am putut încărca graficul: ' + (msg || 'eroare necunoscută') }
}
