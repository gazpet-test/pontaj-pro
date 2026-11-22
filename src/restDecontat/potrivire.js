// ═══════════════════════════════════════════════════════════════════════════
// restDecontat/potrivire.js — potrivirea PROPUSĂ a liniilor unei situații de lucrări cu articolele din bază
// (rândurile vederii v_executie_rest_decontat_baza), în browser, fără AI. Omul confirmă; nimic nesigur nu intră tăcut (L11).
// Ordinea (plan Task 3): cod + obiect (exact) → cod singur, unic în proiect ('cod') → similaritate pe denumire, doar când linia
// NU are cod (tokeni, ≥ PRAG_DESCRIERE = 'descriere'; sub prag sau ambiguu = 'de_verificat'); cod inexistent = 'de_verificat'.
// UM diferit după normalizeUm (M ↔ ML ↔ HM sunt același M; MC ≠ M) sau UM-ul bazei incert = 'de_verificat' INDIFERENT de nivel
// (Review Focus 2: niciodată adunat brut). Același articol propus pentru două linii = ambele 'de_verificat' (RPC-ul l-ar refuza).
// Un câmp decide identitatea DOAR la nivelul lui: obiectul în proiect, devizul în obiect, poziția (nr) în deviz — fără deviz pe linie,
// candidații din devize diferite nu se departajează prin nr (review #1165 r1 P1) → 'de_verificat' cu motivul scris.
// cheieClient = oglinda lui fn_rest_decontat_cheie DOAR pentru afișare / grupare; cheia scrisă o calculează BD-ul.
// ═══════════════════════════════════════════════════════════════════════════
import { normalizeUm } from './um.js'
import { norm } from '../lib/diacritice.js'

export const PRAG_DESCRIERE = 0.85
/** diferența maximă dintre primele două scoruri pe denumire sub care potrivirea e ambiguă (nu alegem noi) */
export const MARJA_AMBIGUITATE = 0.02
export const NIVELURI = ['exact', 'cod', 'descriere', 'de_verificat']

/** o parte a cheii, ca în SQL: upper(btrim(regexp_replace(coalesce(x, ''), '[[:space:]]+', ' ', 'g'))) — spațiile POSIX (fără NBSP) */
export const parteCheie = s => String(s ?? '').replace(/[ \t\n\r\f\v]+/g, ' ').replace(/^ +| +$/g, '').toUpperCase()

/** cheieClient('01', '0101', 'tsa01a1', null) → '01|0101|TSA01A1'; cu nr '2' → '01|0101|TSA01A1|#2' (nr intră doar când NU e null) */
export function cheieClient(obiect, deviz, cod, nr) {
  return `${parteCheie(obiect)}|${parteCheie(deviz)}|${parteCheie(cod)}${nr == null ? '' : `|#${parteCheie(nr)}`}`
}

/** tokenii unei denumiri: fără diacritice, litere mici, doar [a-z0-9], cel puțin 2 caractere */
export const tokeniDenumire = s => [...new Set(norm(s).split(/[^a-z0-9]+/).filter(t => t.length >= 2))]
/** coeficientul Dice pe mulțimi de tokeni (0..1, 3 zecimale) */
export function similaritate(a, b) {
  const A = new Set(tokeniDenumire(a)), B = new Set(tokeniDenumire(b))
  if (A.size === 0 || B.size === 0) return 0
  let comune = 0
  for (const t of A) if (B.has(t)) comune++
  return Math.round((2 * comune) / (A.size + B.size) * 1000) / 1000
}

const umOk = (linie, b) => !b.um_incert && normalizeUm(linie.um).um !== '' && normalizeUm(linie.um).um === normalizeUm(b.um).um
const rez = (linie, b, nivel, scor, motiv = null) => ({ ...linie, cheie_propusa: b ? b.cheie : null, nivel, scor, motiv })

function potrivesteUna(linie, bazaN) {
  const tip = linie.tip_rand || 'articol'
  const codL = parteCheie(linie.cod), obL = parteCheie(linie.obiect_cod), dzL = parteCheie(linie.deviz_cod), nrL = parteCheie(linie.nr)
  if (tip === 'os' || tip === 'diverse') {
    const c = bazaN.filter(b => b.tip_rand === tip)
    if (c.length === 1) return rez(linie, c[0], 'exact', 1)
    if (c.length > 1) {
      const co = c.filter(b => obL && b._ob === obL)
      if (co.length === 1) return rez(linie, co[0], 'exact', 1)
      return rez(linie, null, 'de_verificat', 0, `baza are ${c.length} rânduri „${tip}”, obiectul nu decide`)
    }
    return rez(linie, null, 'de_verificat', 0, `baza nu are rând „${tip}” (articol nou, în afara ofertei?)`)
  }
  const art = bazaN.filter(b => b.tip_rand === 'articol')
  if (codL) {
    const c1 = art.filter(b => b._cod === codL && b._ob === obL && (!dzL || !b._dz || b._dz === dzL))
    if (c1.length === 1) return rez(linie, c1[0], 'exact', 1)
    if (c1.length > 1) {
      // poziția (nr) e LOCALĂ devizului: departajează doar candidați din ACELAȘI deviz. Candidați din devize diferite (linia fără
      // deviz, sau baza cu deviz gol lângă unul numit) = identitatea nu e dovedită (L11) → de_verificat, nu „exact” spre primul deviz
      const devize = [...new Set(c1.map(b => b._dz))]
      if (devize.length > 1) return rez(linie, null, 'de_verificat', 0, `codul ${linie.cod} există în ${devize.length} devize ale obiectului (${devize.map(d => d || '—').join(', ')}); linia nu spune devizul, iar poziția (nr) e locală devizului și nu decide între ele`)
      const cn = nrL ? c1.filter(b => b._nr === nrL) : []
      if (cn.length === 1) return rez(linie, cn[0], 'exact', 1)
      return rez(linie, null, 'de_verificat', 0, `codul ${linie.cod} se repetă în același deviz (${c1.length} poziții); poziția (nr) nu decide`)
    }
    const c2 = art.filter(b => b._cod === codL)
    if (c2.length === 1) return rez(linie, c2[0], 'cod', 1)
    if (c2.length > 1) return rez(linie, null, 'de_verificat', 0, `codul ${linie.cod} există în ${c2.length} obiecte din bază, nu în obiectul liniei`)
    return rez(linie, null, 'de_verificat', 0, `codul ${linie.cod} nu există în bază`)
  }
  // fără cod: denumirea, de preferat în același obiect (dacă obiectul liniei există în bază)
  const inObiect = obL ? art.filter(b => b._ob === obL) : []
  const cand = (inObiect.length ? inObiect : art).map(b => ({ b, s: similaritate(linie.denumire, b.denumire) })).sort((x, y) => y.s - x.s)
  if (cand.length === 0) return rez(linie, null, 'de_verificat', 0, 'linie fără cod; baza nu are articole')
  const [p1, p2] = cand
  if (p1.s < PRAG_DESCRIERE) return rez(linie, p1.s > 0 ? p1.b : null, 'de_verificat', p1.s, `linie fără cod; cea mai apropiată denumire are scor ${p1.s} (< ${PRAG_DESCRIERE})`)
  if (p2 && p1.s - p2.s < MARJA_AMBIGUITATE) return rez(linie, p1.b, 'de_verificat', p1.s, `linie fără cod; două denumiri la fel de apropiate (${p1.s} / ${p2.s})`)
  return rez(linie, p1.b, 'descriere', p1.s)
}

/**
 * potrivesteLinii(linii, baza) -> [{...linie, cheie_propusa, nivel: 'exact'|'cod'|'descriere'|'de_verificat', scor, motiv}]
 * linii = din parseSituatie / parseSituatieF3 (sau parseDevizModificare); baza = rânduri din v_executie_rest_decontat_baza (cheie, tip_rand, obiect_cod, deviz_cod, nr, cod,
 * denumire, um, um_incert). Un rând al bazei este propus cel mult unei linii.
 */
export function potrivesteLinii(linii, baza) {
  const bazaN = (baza || []).filter(b => b && b.cheie).map(b => ({
    ...b, _cod: parteCheie(b.cod), _ob: parteCheie(b.obiect_cod), _dz: parteCheie(b.deviz_cod), _nr: parteCheie(b.nr),
  }))
  const pe = new Map(bazaN.map(b => [b.cheie, b]))
  const out = (linii || []).map(l => {
    const r = potrivesteUna(l, bazaN)
    if (r.cheie_propusa && r.nivel !== 'de_verificat' && !umOk(l, pe.get(r.cheie_propusa))) {
      const b = pe.get(r.cheie_propusa)
      return { ...r, nivel: 'de_verificat', motiv: b.um_incert ? `UM-ul articolului din bază e incert (${b.um})` : `UM diferit: situația „${l.um}” (${normalizeUm(l.um).um || '—'}) vs baza „${b.um}” (${normalizeUm(b.um).um}) — um_diferit` }
    }
    return r
  })
  const dubluri = new Map()
  for (const r of out) if (r.cheie_propusa && r.nivel !== 'de_verificat') dubluri.set(r.cheie_propusa, (dubluri.get(r.cheie_propusa) || 0) + 1)
  return out.map(r => (r.cheie_propusa && r.nivel !== 'de_verificat' && dubluri.get(r.cheie_propusa) > 1
    ? { ...r, nivel: 'de_verificat', motiv: `același articol din bază propus pentru ${dubluri.get(r.cheie_propusa)} linii ale situației` }
    : r))
}

/** câte linii pe fiecare nivel (pentru ecran / raport) */
export const rezumatPotrivire = rezultate => NIVELURI.reduce((o, n) => ({ ...o, [n]: rezultate.filter(r => r.nivel === n).length }), {})
