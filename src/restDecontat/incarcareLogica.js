// ═══════════════════════════════════════════════════════════════════════════
// restDecontat/incarcareLogica.js — logica PURĂ a ecranului de încărcare (Task 4, plan 2026-11-21-rest-de-decontat): ce rânduri
// mai cer decizia omului, ce blochează confirmarea și ce primește RPC-ul. Fără React, fără rețea (testată direct în vitest).
// Regulile (spec + plan, Review Focus):
//   • nimic nesigur nu intră tăcut (L11 / L12): 'de_verificat' cere alegerea articolului sau „articol nou, în afara ofertei”; potrivirea pe
//     denumire ('descriere') cere și ea bifa omului (RPC-ul o scrie 'descriere_confirmata'); o linie incompletă în fișier (fără valoare /
//     cantitate) blochează — nu se trimite pe jumătate și nu dispare;
//   • UM diferit (după normalizare, um.js = oglinda fn_rest_decontat_um) nu se leagă niciodată: alegerea manuală oferă doar articolele cu
//     același UM normalizat (RPC-ul refuză oricum, um_diferit);
//   • controlul cumulatului (când documentul îl dă): cumulat ≠ decontatul anterior + perioada (toleranță 0,001, în UM-ul de bază) = de verificat;
//   • aceeași situație de două ori: nr. existent cere „înlocuiește” explicit; aceeași amprentă = deja confirmată (RPC-ul refuză, 23505);
//   • rezultat incomplet (`complet: false` din parsare) = omul bifează că a văzut problemele; diferența față de situația de plată peste
//     prag = bifă „accept diferența” (cheia accept_diferenta din p_linii, contractul RPC-ului din 20270105a).
// Cheia scrisă o calculează BD-ul la bază; la situație cheia e a rândului din v_executie_rest_decontat_baza (aleasă / propusă), iar RPC-ul
// o reverifică (există în bază, UM egal). Clientul doar o transportă.
// ═══════════════════════════════════════════════════════════════════════════
import { liniePentruRpc, liniePentruRpcBaza } from './parsareSituatie.js'
import { normalizeUm, acelasiUm } from './um.js'
import { parteCheie } from './potrivire.js'

/** p_prag_diferenta al RPC-ului (lei): același cu valoarea implicită din fn_rest_decontat_confirma_situatie */
export const PRAG_DIFERENTA_LEI = 1
/** toleranța controlului de cumulat (în UM-ul de bază al cheii) */
export const TOLERANTA_CUMULAT = 0.001
/** nivelul potrivirii (potrivire.js) → valoarea coloanei `potrivire` acceptată de RPC */
export const POTRIVIRE_RPC = { exact: 'exact', cod: 'cod', descriere: 'descriere_confirmata', manual: 'manual' }
export const SURSE_BAZA = [
  { cod: 'contract_initial', eticheta: 'Oferta financiară (contractul inițial)' },
  { cod: 'act_aditional', eticheta: 'Devizul unui act adițional' },
  { cod: 'nota_comanda_suplimentara', eticheta: 'Devizul unei note de comandă suplimentară (NCS)' },
  { cod: 'nota_renuntare', eticheta: 'Devizul unei note de renunțare (NR)' },
]

/** numărul situației normalizat EXACT ca în RPC: upper(btrim(regexp_replace(x, '[[:space:]]+', ' ', 'g'))) */
export const nrSituatieCanonic = parteCheie

const eNumar = v => typeof v === 'number' && Number.isFinite(v)
const rot = (x, z = 2) => Math.round(x * 10 ** z) / 10 ** z

/** randuriInitiale(potriviri) — o intrare pe linia situației, cu decizia omului goală */
export const randuriInitiale = potriviri => (potriviri || []).map((p, i) => ({ i, linie: p, decizie: null }))

/**
 * controlCumulat(randuri, decontatPeCheie, { inlocuire }) — pentru liniile care au `cantitate_cumulat_doc` (F3 nu-l are; alte formate da):
 * cumulatul din document trebuie să fie decontatul anterior al cheii + cantitatea perioadei (în UM-ul de bază, prin factor). Diferență peste
 * TOLERANTA_CUMULAT → rândul devine 'de_verificat' (decizia omului, nu tăcere). La înlocuirea unei situații decontatul anterior conține și
 * versiunea veche, deci controlul nu se poate face → tot 'de_verificat', cu motivul scris.
 * decontatPeCheie: Map cheie → decontat_cantitate (din v_executie_rest_decontat, deja în UM-ul de bază).
 */
export function controlCumulat(randuri, decontatPeCheie, { inlocuire = false } = {}) {
  return randuri.map(r => {
    const l = r.linie
    if (l.cantitate_cumulat_doc == null || !l.cheie_propusa || l.nivel === 'de_verificat') return r
    const f = normalizeUm(l.um).factor
    const doc = Number(l.cantitate_cumulat_doc) * f
    if (inlocuire) return { ...r, linie: { ...l, nivel: 'de_verificat', motiv: 'cumulatul din document nu se poate verifica la înlocuirea situației (decontatul conține versiunea veche) — alegeți articolul' } }
    const anterior = Number(decontatPeCheie?.get(l.cheie_propusa) ?? 0)
    const asteptat = anterior + Number(l.cantitate) * f
    if (!Number.isFinite(doc) || !Number.isFinite(asteptat) || Math.abs(doc - asteptat) > TOLERANTA_CUMULAT) {
      return { ...r, linie: { ...l, nivel: 'de_verificat', motiv: `cumulatul din document (${rot(doc, 3)}) ≠ decontat anterior ${rot(anterior, 3)} + perioada ${rot(Number(l.cantitate) * f, 3)} — de verificat` } }
    }
    return r
  })
}

/** articolele din bază pe care omul le poate alege pentru o linie: același UM normalizat, UM sigur (RPC-ul refuză altfel) */
export const optiuniArticol = (linie, baza) => (baza || [])
  .filter(b => b && b.cheie && !b.um_incert && acelasiUm(linie.um, b.um))
  .sort((a, b) => String(a.obiect_cod || '').localeCompare(String(b.obiect_cod || '')) || String(a.deviz_cod || '').localeCompare(String(b.deviz_cod || ''))
    || String(a.cod || '').localeCompare(String(b.cod || '')) || String(a.nr || '').localeCompare(String(b.nr || '')))

/**
 * efectiv(rand, bazaPeCheie) — ce se trimite pentru rând: { tip_rand, cheie, potrivire } sau { blocat: motiv }.
 * decizie: null | { tip: 'articol', cheie } (alegerea manuală) | { tip: 'articol_nou' } | { tip: 'confirm' } (potrivirea pe denumire)
 */
export function efectiv(rand, bazaPeCheie) {
  const l = rand.linie, d = rand.decizie
  if (!eNumar(l.valoare) || !eNumar(l.cantitate)) return { blocat: 'linia e incompletă în fișier (fără valoare / cantitate citită) — corectați fișierul și încărcați-l din nou' }
  if (d?.tip === 'articol_nou') {
    if (!String(l.denumire || '').trim()) return { blocat: 'articolul nou cere denumire (linia nu are)' }
    return { tip_rand: 'articol_nou', cheie: null, potrivire: null }
  }
  if (d?.tip === 'articol') {
    const b = bazaPeCheie.get(d.cheie)
    if (!b) return { blocat: 'articolul ales nu mai e în bază' }
    if (b.um_incert || !acelasiUm(l.um, b.um)) return { blocat: `UM diferit: linia „${l.um}”, articolul ales „${b.um}”` }
    return { tip_rand: b.tip_rand || 'articol', cheie: b.cheie, potrivire: POTRIVIRE_RPC.manual }
  }
  if (l.nivel === 'exact' || l.nivel === 'cod') {
    const b = bazaPeCheie.get(l.cheie_propusa)
    return { tip_rand: b?.tip_rand || l.tip_rand || 'articol', cheie: l.cheie_propusa, potrivire: POTRIVIRE_RPC[l.nivel] }
  }
  if (l.nivel === 'descriere') {
    if (d?.tip !== 'confirm') return { blocat: 'potrivire pe denumire: confirmați articolul propus sau alegeți altul' }
    const b = bazaPeCheie.get(l.cheie_propusa)
    return { tip_rand: b?.tip_rand || l.tip_rand || 'articol', cheie: l.cheie_propusa, potrivire: POTRIVIRE_RPC.descriere }
  }
  return { blocat: `de verificat: ${l.motiv || 'potrivire nesigură'} — alegeți articolul sau „articol nou”` }
}

/** blocajeRanduri(randuri, baza) → Map i → motiv (rândurile nerezolvate + același articol pe mai multe linii) */
export function blocajeRanduri(randuri, baza) {
  const pe = new Map((baza || []).filter(b => b && b.cheie).map(b => [b.cheie, b]))
  const out = new Map(), folosite = new Map()
  for (const r of randuri) {
    const e = efectiv(r, pe)
    if (e.blocat) out.set(r.i, e.blocat)
    else if (e.cheie) folosite.set(e.cheie, [...(folosite.get(e.cheie) || []), r.i])
  }
  for (const [k, idx] of folosite) if (idx.length > 1) for (const i of idx) out.set(i, `același articol din bază (${k}) e legat de ${idx.length} linii — RPC-ul l-ar refuza; alegeți altul pentru una dintre ele`)
  return out
}

/** liniile pentru fn_rest_decontat_confirma_situatie (presupune zero blocaje) */
export function liniiSituatie(randuri, baza) {
  const pe = new Map((baza || []).filter(b => b && b.cheie).map(b => [b.cheie, b]))
  return randuri.map(r => {
    const e = efectiv(r, pe)
    if (e.blocat) throw new Error(`linia ${r.i + 1}: ${e.blocat}`)
    return { ...liniePentruRpc(r.linie), cantitate_cumulat_doc: r.linie.cantitate_cumulat_doc ?? null, tip_rand: e.tip_rand, cheie: e.cheie, potrivire: e.potrivire }
  })
}

/** suma valorilor trimise — exact ce compară RPC-ul cu valoarea de bază a situației de plată */
export const totalLinii = linii => rot((linii || []).reduce((s, l) => s + (eNumar(l.valoare) ? l.valoare : 0), 0))

const lunaOk = v => Number.isInteger(v) && v >= 1 && v <= 12
const anOk = v => Number.isInteger(v) && v >= 2000 && v <= 2100

/**
 * verificaSituatie(...) → { ok, motive[], diferenta } — tot ce ține butonul „Confirm” dezactivat, cu motivul scris.
 * existente: [{ nr_situatie, versiune, amprenta }] situațiile detaliate ACTIVE ale proiectului (executie_sl_detaliu).
 */
export function verificaSituatie({ rez, randuri, baza, nr, luna, an, existente = [], amprenta, inlocuieste, referinta, acceptDiferenta, acceptProbleme }) {
  const motive = []
  const nrC = nrSituatieCanonic(nr)
  if (!rez) return { ok: false, motive: ['niciun fișier citit'], diferenta: null }
  if (!nrC) motive.push('numărul situației lipsește')
  if (!lunaOk(luna) || !anOk(an)) motive.push('luna / anul situației lipsesc sau sunt invalide (completați-le)')
  const exista = existente.find(x => nrSituatieCanonic(x.nr_situatie) === nrC)
  if (amprenta && existente.some(x => x.amprenta === amprenta)) motive.push('acest fișier a fost deja confirmat pe proiect')
  if (exista && !inlocuieste) motive.push(`situația ${nrC} există deja (versiunea ${exista.versiune}) — bifați „înlocuiește” ca s-o înlocuiți`)
  if (!exista && inlocuieste) motive.push('„înlocuiește” e doar pentru o situație care există deja')
  if (!rez.complet && !acceptProbleme) motive.push(`citirea are ${rez.probleme?.length || 0} probleme — bifați că le-ați verificat`)
  const bl = blocajeRanduri(randuri, baza)
  if (bl.size) motive.push(`${bl.size} linii nerezolvate (de verificat / incomplete)`)
  let diferenta = null
  if (referinta != null && Number.isFinite(Number(referinta))) {
    diferenta = rot(totalLinii(randuri.map(r => r.linie)) - Number(referinta))
    if (Math.abs(diferenta) > PRAG_DIFERENTA_LEI && !acceptDiferenta) motive.push(`totalul articolelor diferă de valoarea situației de plată cu ${diferenta} lei — bifați „accept diferența”`)
  }
  return { ok: motive.length === 0, motive, diferenta, exista: exista || null }
}

/** p_linii pentru RPC-ul situației: obiectul {linii, accept_diferenta, luna, an} (contractul din 20270105a) */
export const pLiniiSituatie = ({ randuri, baza, luna, an, acceptDiferenta }) => ({
  linii: liniiSituatie(randuri, baza), accept_diferenta: acceptDiferenta === true, luna, an,
})

/** liniile devizului (ofertă / AA / NR / NCS) pentru fn_rest_decontat_confirma_baza + verificările de dinainte de trimitere */
export function verificaBaza({ rez, sursa, mod, actId, notaId, note = [], acceptProbleme }) {
  const motive = []
  if (!rez) return { ok: false, motive: ['niciun fișier citit'] }
  if (!SURSE_BAZA.some(s => s.cod === sursa)) motive.push('alegeți ce document este (ofertă / act adițional / notă)')
  if (sursa === 'act_aditional') {
    if (!actId) motive.push('alegeți actul adițional')
    if (!['diferente', 'lista_completa'].includes(mod)) motive.push('alegeți modul: doar diferențe / listă completă')
  }
  if (sursa === 'nota_renuntare' || sursa === 'nota_comanda_suplimentara') {
    const n = note.find(x => x.id === notaId)
    if (!notaId || !n) motive.push('alegeți nota')
    else if (!n.data_aprobare) motive.push('nota nu are data aprobării — devizul ei intră în bază doar după aprobarea beneficiarului')
  }
  const incomplete = rez.linii.filter(l => !eNumar(l.valoare) || !eNumar(l.cantitate)).length
  if (incomplete) motive.push(`${incomplete} linii incomplete în fișier (fără valoare / cantitate) — corectați fișierul`)
  const fataUm = rez.linii.filter(l => (l.tip_rand || 'articol') === 'articol' && !String(l.um || '').trim()).length
  if (fataUm) motive.push(`${fataUm} articole fără UM`)
  const modEfectiv = sursa === 'contract_initial' ? 'lista_completa' : (sursa === 'act_aditional' ? mod : 'diferente')
  if (modEfectiv === 'lista_completa' && rez.linii.some(l => eNumar(l.cantitate) && l.cantitate < 0)) motive.push('o listă completă nu are cantități negative (alegeți „doar diferențe” sau verificați fișierul)')
  if (rez.linii.length > 5000) motive.push('peste 5000 de linii într-un document')
  if (!rez.complet && !acceptProbleme) motive.push(`citirea are ${rez.probleme?.length || 0} probleme — bifați că le-ați verificat`)
  return { ok: motive.length === 0, motive, mod: modEfectiv }
}

export const liniiBaza = rez => rez.linii.map(liniePentruRpcBaza)

/**
 * clasificaEroare(rezultatRpc | excepție) → { tip: 'refuz' | 'necunoscut', mesaj, indiciu }
 * L05: doar un refuz DETERMINIST (4xx / SQLSTATE din BD) e eșec cert; rețea / 5xx / excepție după trimitere = NECUNOSCUT (s-ar putea să fi
 * fost scris) → se verifică în BD după amprentă sau se retrimite IDENTIC (amprenta face apelul idempotent: a doua oară = „deja confirmat”).
 */
export function clasificaEroare(r) {
  if (r instanceof Error || r?.aruncat) return { tip: 'necunoscut', mesaj: r?.message || String(r), indiciu: INDICIU_NECUNOSCUT }
  const e = r?.error || {}
  const status = r?.status
  const sqlstate = typeof e.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code)
  const determinist = (Number.isInteger(status) && status >= 400 && status < 500) || (status == null && sqlstate)
  if (!determinist) return { tip: 'necunoscut', mesaj: e.message || `răspuns ${status ?? 'fără stare'}`, indiciu: INDICIU_NECUNOSCUT }
  const m = String(e.message || '')
  return { tip: 'refuz', mesaj: m || `refuz (${e.code || status})`, cod: e.code || null, indiciu: indiciuRefuz(m, e.code) }
}
export const INDICIU_NECUNOSCUT = 'Rezultatul nu se știe (rețea / server). Nu s-a pierdut nimic: verificați starea sau apăsați din nou „Confirm” — același fișier nu se poate scrie de două ori.'
export function indiciuRefuz(m, cod) {
  if (/situatie_existenta/.test(m)) return 'Situația există deja: bifați „înlocuiește” dacă vreți s-o înlocuiți.'
  if (/amprenta_existenta|deja confirmat/.test(m)) return 'Același fișier a fost deja confirmat pe acest proiect.'
  if (/fara_baza/.test(m)) return 'Proiectul nu are oferta financiară confirmată: încărcați întâi oferta (contractul inițial).'
  if (/um_diferit/.test(m)) return 'O linie are alt UM decât articolul din bază: alegeți alt articol sau „articol nou”.'
  if (/accept_diferenta/.test(m)) return 'Totalul diferă de situația de plată: bifați „accept diferența” dacă e corect.'
  if (/inlocuieste/.test(m)) return 'Obiectele au deja oferta confirmată: bifați „înlocuiește oferta” dacă e o ofertă revizuită.'
  if (/um_schimbat/.test(m)) return 'UM-ul unor articole se schimbă față de baza anterioară: bifați „accept schimbarea UM” dacă e corect.'
  if (cod === '42501') return 'Nu aveți drept să confirmați acest document pe proiect.'
  return null
}

/** SHA-256 hex al conținutului (Web Crypto; amprenta = identitatea documentului, L16) */
export async function sha256Hex(buf) {
  const h = await globalThis.crypto.subtle.digest('SHA-256', buf instanceof ArrayBuffer ? buf : new Uint8Array(buf))
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Fișierul NU se păstrează în ERP (r2, verdict #1178): documentul detaliat are prețuri. Până la un loc de păstrare legat de
 *  fn_rest_decontat_drept (livrare separată), ecranul nu urcă nimic și trimite p_fisier = NULL (acceptat de ambele RPC-uri, 20270105a). */
export const MESAJ_FARA_FISIER = 'Documentul în sine NU se păstrează în ERP deocamdată (doar liniile citite din el): păstrați fișierul în dosarul proiectului.'

/**
 * stareDupaAmprenta({ client, pid, eSit, amprenta }) — ce știe BD-ul despre documentul cu această amprentă (L05: reconcilierea cu serverul):
 *   { scris, dovada }      — rândul ACTIV e în BD (situația detaliată activă / rândurile bazei în proiect_articole);
 *   { retras, dovada }     — fișierul e în BD doar ca versiune înlocuită (situație inactivă / rânduri mutate în istoric): nu se mai poate scrie;
 *   { absent: true }       — nimic cu amprenta asta, ȘI contul poate citi (fn_rest_decontat_drept 'citire' adevărat înainte ȘI după citiri) —
 *                            altfel RLS-ul ar ascunde rândurile și „gol” n-ar dovedi nimic (L18);
 *   { neverificabil: motiv } — eroare de citire / fără drept de citire: starea rămâne necunoscută.
 */
export async function stareDupaAmprenta({ client, pid, eSit, amprenta }) {
  const motiv = e => e?.message || String(e)
  try {
    const drept = async () => { const r = await client.rpc('fn_rest_decontat_drept', { p_proiect: pid, p_nivel: 'citire' }); if (r?.error) throw r.error; return r?.data === true }
    const inainte = await drept()
    if (eSit) {
      const { data, error } = await client.from('executie_sl_detaliu').select('id, nr_situatie, versiune, activ').eq('proiect_id', pid).eq('amprenta', amprenta).order('id').limit(50)
      if (error) return { neverificabil: motiv(error) }
      const activ = (data || []).find(x => x.activ === true)
      if (activ) return { scris: true, dovada: `Situația ${activ.nr_situatie} (versiunea ${activ.versiune}) e scrisă în ERP cu acest fișier.` }
      if ((data || []).length) return { retras: true, dovada: `Fișierul e în ERP doar ca versiune înlocuită (situația ${data[0].nr_situatie}, versiunea ${data[0].versiune}, inactivă); serverul nu-l mai primește a doua oară.` }
    } else {
      const a = await client.from('proiect_articole').select('id').eq('proiect_id', pid).eq('fisier_amprenta', amprenta).order('id').limit(1)
      if (a.error) return { neverificabil: motiv(a.error) }
      if ((a.data || []).length) return { scris: true, dovada: 'Devizul e scris în bază cu acest fișier.' }
      const h = await client.from('proiect_articole_istoric').select('id').eq('proiect_id', pid).eq('rand->>fisier_amprenta', amprenta).order('id').limit(1)
      if (h.error) return { neverificabil: motiv(h.error) }
      if ((h.data || []).length) return { retras: true, dovada: 'Devizul cu acest fișier e în ERP doar în istoric (rânduri înlocuite); serverul nu-l mai primește a doua oară.' }
    }
    const dupa = await drept()
    if (!inainte || !dupa) return { neverificabil: 'contul nu are (sau n-a avut tot timpul) drept de citire pe Rest de decontat, deci lipsa rândurilor nu dovedește nimic' }
    return { absent: true }
  } catch (e) { return { neverificabil: motiv(e) } }
}

/**
 * reconciliereDupaRefuz(v, refuz) → starea trimiterii după citirea BD-ului (v = stareDupaAmprenta), când o încercare anterioară avea rezultat
 * NECUNOSCUT (refuz = clasificaEroare al reîncercării sau null la „Verifică starea”):
 *   scris → 'ok' (cu dovada); retras → 'refuz' (stare cunoscută: nu se mai poate scrie); absent → 'refuz' DOAR dacă există refuzul reîncercării
 *   (altfel nu e nimic de declarat; apelantul arată „nimic scris”); neverificabil → rămâne 'necunoscut' (câmpurile blocate, fără „nimic scris”).
 */
export function reconciliereDupaRefuz(v, refuz) {
  if (v?.scris) return { stare: 'ok', rez: null, dovada: `Încercarea anterioară a fost scrisă. ${v.dovada}` }
  if (v?.retras) return { stare: 'refuz', mesaj: refuz?.mesaj || 'fișierul nu se mai poate confirma', indiciu: refuz?.indiciu || null, reconciliat: v.dovada }
  if (v?.absent && refuz) return { stare: 'refuz', mesaj: refuz.mesaj, indiciu: refuz.indiciu, reconciliat: 'Verificat în ERP: încercarea anterioară NU s-a scris (nimic cu acest fișier), deci refuzul e final.' }
  return {
    stare: 'necunoscut',
    mesaj: refuz ? `reîncercarea a fost refuzată (${refuz.mesaj}), iar starea încercării anterioare nu s-a putut verifica: ${v?.neverificabil || 'fără răspuns'}` : `starea nu s-a putut verifica: ${v?.neverificabil || 'fără răspuns'}`,
    indiciu: 'Nu se știe dacă încercarea anterioară s-a scris. Câmpurile rămân blocate: apăsați „Verifică starea în ERP” sau retrimiteți identic.',
  }
}

/**
 * citesteToate(cerePagina, camp) — keyset pe o coloană TEXT unică (cheie / rand_id) până la pagina goală (L23; plafonul PostgREST de 1000).
 * cerePagina(ultim, pas) → { data, error }. Ordinea o dă serverul (ORDER BY camp + gt); clientul verifică doar progresul (fără comparații de
 * colaționare în JS).
 */
export async function citesteToate(cerePagina, camp, pas = 1000) {
  const tot = []
  for (let ultim = null; ;) {
    const { data, error } = await cerePagina(ultim, pas)
    if (error) throw error
    if (!data || !data.length) return tot
    tot.push(...data)
    const u = data[data.length - 1][camp]
    if (u == null || u === ultim) throw new Error(`citire pe pagini: ${camp} lipsă sau fără progres`)
    ultim = u
  }
}
