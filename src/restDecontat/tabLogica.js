// ═══════════════════════════════════════════════════════════════════════════
// restDecontat/tabLogica.js — logica PURĂ a tab-ului „💰 Rest de decontat” (Task 5, plan 2026-11-21-rest-de-decontat). Calculul (bază,
// decontat, rest, %, peste ofertă, nedecontat) vine GATA din vederile 20270105a (L19: o singură definiție); aici doar se filtrează, se
// grupează și se semnalează. Cantitățile se arată doar pe articol; pe obiect / proiect doar bani (spec).
// ═══════════════════════════════════════════════════════════════════════════

/** semnalul de risc: proiectul a trecut de PRAG_PROIECT_AVANSAT_PCT din valoarea de bază decontată și articolul e nedecontat deloc sau sub
 *  PRAG_ARTICOL_SUB_PCT (plan Task 5: pragurile ca constante în fișier) */
export const PRAG_PROIECT_AVANSAT_PCT = 70
export const PRAG_ARTICOL_SUB_PCT = 20
/** „doar cu rest”: restul în bani peste un ban (rotunjirile nu contează ca rest) */
export const PRAG_REST_LEI = 0.005

const n = v => (v == null || v === '' ? null : Number(v))
export const nr0 = v => { const x = n(v); return Number.isFinite(x) ? x : 0 }

/** etichetele tipurilor de lipsuri din v_executie_rest_decontat_lipsuri; un tip necunoscut se arată cu numele lui (nu dispare, L12) */
export const ETICHETE_LIPSURI = {
  fara_oferta: 'Proiect fără ofertă financiară încărcată',
  sl_fara_detaliu: 'Situație de plată fără detaliu pe articole',
  aa_fara_deviz: 'Act adițional fără deviz',
  nota_fara_deviz: 'Notă NR / NCS fără deviz',
  nota_neaprobata: 'Notă NR / NCS neaprobată de beneficiar (nu intră în bază)',
  rand_neautorizat: 'Rânduri de bază fără legătură / neconfirmate (nu intră în bază)',
  oferta_veche_neconfirmata: 'Rânduri vechi ale ofertei pe un obiect deja confirmat (nu intră în bază)',
  oferta_neconfirmata: 'Ofertă încărcată pe calea veche, neconfirmată în Rest de decontat',
  decontat_fara_articol: 'Decontat fără articol în bază',
  decontat_um_diferit: 'UM-ul bazei diferă de cel decontat',
}
export const etichetaLipsa = tip => ETICHETE_LIPSURI[tip] || tip

/** lipsurile grupate pe tip, în ordinea etichetelor (tipurile necunoscute la final) */
export function grupeazaLipsuri(lipsuri) {
  const m = new Map()
  for (const l of lipsuri || []) m.set(l.tip, [...(m.get(l.tip) || []), l.referinta])
  const ordine = Object.keys(ETICHETE_LIPSURI)
  return [...m.entries()].sort((a, b) => (ordine.indexOf(a[0]) + 1 || 999) - (ordine.indexOf(b[0]) + 1 || 999) || a[0].localeCompare(b[0]))
    .map(([tip, referinte]) => ({ tip, eticheta: etichetaLipsa(tip), referinte }))
}

/**
 * totaluriProiect(obiecte) — totalurile de sus din rândul de nivel 'proiect' al v_executie_rest_decontat_obiect, plus controlul că el e
 * suma obiectelor (aceeași vedere, GROUPING SETS; o diferență = semnal, nu se ascunde). Fără rând de proiect = totaluri null.
 */
export function totaluriProiect(obiecte) {
  const p = (obiecte || []).find(o => o.nivel === 'proiect') || null
  const ob = (obiecte || []).filter(o => o.nivel === 'obiect')
  const suma = k => Math.round(ob.reduce((s, o) => s + nr0(o[k]), 0) * 100) / 100
  const s = { baza: suma('baza_valoare'), decontat: suma('decontat_valoare'), rest: suma('rest_valoare') }
  if (!p) return { baza: null, decontat: null, rest: null, pct: null, sumaObiecte: s, coerent: ob.length === 0 }
  const t = { baza: nr0(p.baza_valoare), decontat: nr0(p.decontat_valoare), rest: nr0(p.rest_valoare), pct: n(p.pct_decontat) }
  const coerent = Math.abs(t.baza - s.baza) < 0.01 && Math.abs(t.decontat - s.decontat) < 0.01 && Math.abs(t.rest - s.rest) < 0.01
  return { ...t, sumaObiecte: s, coerent, articole: p.articole, nedecontate: p.articole_nedecontate, peste: p.articole_peste, noi: p.articole_noi }
}

/** articolele cu risc (lista scurtă de sus): doar când proiectul a trecut de prag; articole din bază (cheie), cu valoare de bază pozitivă */
export function semnalRisc(articole, pctProiect) {
  const p = n(pctProiect)
  if (p == null || !Number.isFinite(p) || p < PRAG_PROIECT_AVANSAT_PCT) return []
  return (articole || []).filter(a => a.cheie && nr0(a.baza_valoare) > 0 && (a.nedecontat === true || (n(a.pct_decontat) != null && n(a.pct_decontat) < PRAG_ARTICOL_SUB_PCT)))
    .sort((a, b) => nr0(b.rest_valoare) - nr0(a.rest_valoare))
}

/** filtrele tab-ului: obiect ('' = toate), doar cu rest, nedecontat deloc, peste ofertă, text (cod / denumire) */
export function filtreazaArticole(articole, { obiect = '', doarCuRest = false, nedecontat = false, peste = false, text = '' } = {}) {
  const t = String(text || '').trim().toLowerCase()
  return (articole || []).filter(a =>
    (obiect === '' || (a.obiect_cod ?? '') === obiect)
    && (!doarCuRest || nr0(a.rest_valoare) > PRAG_REST_LEI)
    && (!nedecontat || a.nedecontat === true)
    && (!peste || a.peste_oferta === true)
    && (!t || `${a.cod || ''} ${a.denumire || ''}`.toLowerCase().includes(t)))
}

const cmp = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), 'ro', { numeric: true })
/** ordinea articolelor: obiect, deviz, poziție (nr), cod; articolele noi (în afara ofertei) la finalul obiectului */
export const ordoneazaArticole = articole => [...(articole || [])].sort((a, b) =>
  cmp(a.obiect_cod, b.obiect_cod) || (a.cheie ? 0 : 1) - (b.cheie ? 0 : 1) || cmp(a.deviz_cod, b.deviz_cod) || cmp(a.nr, b.nr) || cmp(a.cod, b.cod) || cmp(a.rand_id, b.rand_id))

/** grupele pe obiect (bani din v_executie_rest_decontat_obiect; articolele filtrate dedesubt); obiectele fără articole după filtre nu apar */
export function grupePeObiect(articole, obiecte) {
  const peOb = new Map((obiecte || []).filter(o => o.nivel === 'obiect').map(o => [o.obiect_cod ?? '', o]))
  const m = new Map()
  for (const a of ordoneazaArticole(articole)) {
    const k = a.obiect_cod ?? ''
    if (!m.has(k)) m.set(k, { obiect_cod: k, obiect: peOb.get(k) || null, articole: [] })
    m.get(k).articole.push(a)
  }
  return [...m.values()]
}

/** ajustările de preț din situațiile de plată (doar citite; nu intră în rest și nici în cantități) */
export const totalAjustari = sl => Math.round((sl || []).reduce((s, x) => s + nr0(x.valoare_ajustare_lei), 0) * 100) / 100
