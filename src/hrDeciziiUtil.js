// ════════════════════════════════════════════════════════════════
// Registrul deciziilor HR — partea PURĂ a generării (spec docs/HR/GENERATOR_DECIZII_SPEC.md §6, PR2).
// Fără importuri: se testează cu vitest (hrDeciziiUtil.test.js) fără DOM și fără clientul Supabase (VA33).
// `continut` vine gata randat de server (_hr_decizie_randeaza), ca text simplu; aici doar îl punem în pagină,
// EXCLUSIV prin escapare (J3-8) — temeiul, proiectul și contractul sunt editabile de utilizatori.
// ════════════════════════════════════════════════════════════════

// A4 la 96 dpi: 794 × 1123 px (raportul 210:297, C18). Subsolul are zona lui, în afara corpului măsurat.
export const PAGINA = { w: 794, h: 1123 }
export const ZONA_SUBSOL = 56
export const INALTIME_CORP = PAGINA.h - ZONA_SUBSOL
export const FONTURI = [12, 11]              // p_font_pt permise de fn_hr_decizie_emite (Vf8, J2-3)
export const A4_MM = { w: 210, h: 297 }
export const MAX_LATURA_SCAN = 2400          // VA28: ~190 DPI pe A4, codul din subsol rămâne lizibil

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
/** Escapare HTML pentru text și atribute. null/undefined → ''. */
export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ESC[c])
const escBr = v => esc(v).replace(/\r?\n/g, '<br/>')

// Numărul-rezervă de la previzualizare („99999-bis”) păstrează lățimea maximă (J20), dar se afișează „____”.
const REZERVA = /^99999-bis\//

function titluHtml(titlu, nr, previzualizare) {
  const s = String(nr ?? ''), t = esc(titlu)
  if (previzualizare && REZERVA.test(s)) {
    const rest = s.replace(REZERVA, '/')
    return `${t} <span style="position:relative;display:inline-block"><span style="visibility:hidden">99999-bis</span>`
      + `<span style="position:absolute;left:0;right:0;text-align:center">____</span></span>${esc(rest)}`
  }
  return `${t} ${esc(s)}`
}

// Blocurile de text rup șirurile lungi fără spații (J8-1/P8-4); măsurarea verifică și lățimea fiecărui bloc (.hrdec-t).
const RUPERE = 'overflow-wrap:anywhere;word-break:break-word;'

/**
 * HTML-ul unei pagini A4 de decizie, din `continut` (jsonb-ul de la server).
 * opts: { logo (data URL al antetului), cod_verificare, previzualizare, fontPt (12|11) }.
 * Toate valorile din `continut`/`opts` trec prin esc(); singurul markup e cel scris static aici.
 */
export function renderDecizieHtml(continut, opts = {}) {
  const c = continut || {}
  const fontPt = FONTURI.includes(opts.fontPt) ? opts.fontPt : 12
  const prev = opts.previzualizare ?? !!c.previzualizare
  const art = Array.isArray(c.articole) ? c.articole : []
  const cod = opts.cod_verificare
    ? `Cod verificare ${esc(opts.cod_verificare)} · generat din PontajPRO`
    : (prev ? 'PREVIZUALIZARE · fără număr · nu se semnează' : '')
  const logo = opts.logo && /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(opts.logo)
    ? `<img src="${opts.logo}" style="display:block;width:100%;height:auto" alt=""/>` : ''
  return `<div class="hrdec-pagina" style="position:relative;width:${PAGINA.w}px;height:${PAGINA.h}px;overflow:hidden;background:#fff;color:#000;font-family:'Times New Roman',Times,serif;font-size:${fontPt}pt;line-height:1.35;box-sizing:border-box">`
    + `<div class="hrdec-corp" style="padding:28px 72px 0 72px;box-sizing:border-box">`
    + `<div style="margin:0 -40px 22px -40px">${logo}</div>`
    + `<div class="hrdec-t" style="${RUPERE}text-align:center;font-weight:bold;font-size:${fontPt + 2}pt;margin:18px 0 22px">${titluHtml(c.titlu, c.nr, prev)}</div>`
    + `<p class="hrdec-t" style="${RUPERE}text-align:justify;text-indent:48px;margin:0 0 18px">${escBr(c.preambul)}</p>`
    + `<div class="hrdec-t" style="${RUPERE}text-align:center;font-weight:bold;margin:0 0 16px">${esc(c.decide)}</div>`
    + art.map(a => `<p class="hrdec-t" style="${RUPERE}text-align:justify;margin:0 0 12px"><b>Art.${esc(a?.nr)}</b> ${escBr(a?.text)}</p>`).join('')
    + `<table style="width:100%;table-layout:fixed;margin-top:36px;border-collapse:collapse;font-size:inherit"><tr>`
    + `<td class="hrdec-t" style="${RUPERE}width:50%;vertical-align:top;font-weight:bold">${escBr(c.bloc_semnatura)}</td>`
    + `<td class="hrdec-t" style="${RUPERE}width:50%;vertical-align:top;text-align:right;font-weight:bold">${escBr(c.luare_la_cunostinta)}</td>`
    + `</tr></table></div>`
    + `<div style="position:absolute;left:72px;right:72px;bottom:18px;text-align:center;font-family:'Courier New',Courier,monospace;font-size:9pt;color:#4a4a4a">${cod}</div>`
    + `</div>`
}

/**
 * Așezarea unei imagini (w × h px, rotită cu rot ∈ {0,90,180,270}) pe o pagină A4, centrat, fără deformare.
 * Pagina e portret sau peisaj după imaginea rotită. Întoarce mm: { orientare: 'p'|'l', pagW, pagH, x, y, l, h }.
 */
export function asezareA4(w, h, rot = 0) {
  if (!(w > 0) || !(h > 0)) throw new Error('dimensiuni invalide')
  const r = ((Number(rot) % 360) + 360) % 360
  if (![0, 90, 180, 270].includes(r)) throw new Error('rotire invalidă: ' + rot)
  const [iw, ih] = r === 90 || r === 270 ? [h, w] : [w, h]
  const peisaj = iw > ih
  const pagW = peisaj ? A4_MM.h : A4_MM.w, pagH = peisaj ? A4_MM.w : A4_MM.h
  const s = Math.min(pagW / iw, pagH / ih)
  const l = iw * s, hh = ih * s
  return { orientare: peisaj ? 'l' : 'p', pagW, pagH, x: (pagW - l) / 2, y: (pagH - hh) / 2, l, h: hh }
}

/** Dimensiunile canvas-ului pentru o poză: după rotire, max `max` px pe latura lungă, fără mărire. */
export function dimensiuniCanvas(w, h, rot = 0, max = MAX_LATURA_SCAN) {
  const r = ((Number(rot) % 360) + 360) % 360
  const [iw, ih] = r === 90 || r === 270 ? [h, w] : [w, h]
  const s = Math.min(1, max / Math.max(iw, ih))
  return { cw: Math.max(1, Math.round(iw * s)), ch: Math.max(1, Math.round(ih * s)), s }
}

/** Numele scanului compus din poze: `semnat_<Date.now()>.pdf`, doar cifre — regex-ul căii din PR1 (§3.5, P8-1). */
export const numeScan = (ms = Date.now()) => `semnat_${Math.trunc(ms)}.pdf`
export const CALE_FISIER_RE = /^(generat|semnat)_[0-9]{1,15}\.pdf$/

/** Fontul ales pentru emitere: primul din FONTURI la care corpul încape; null = nu încape (B7). */
export function alegeFont(inaltimiPeFont, limita = INALTIME_CORP) {
  for (const f of FONTURI) if (inaltimiPeFont[f] != null && inaltimiPeFont[f] <= limita) return f
  return null
}

/** Primii octeți ai unui PDF („%PDF-”), pentru fișiere cu `type` gol (VA32). */
export const estePdf = bytes => bytes && bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === '%PDF-'

// ─── Registru și Execuție (PR3) ────────────────────────────────

const ddmmyyyy = d => d ? d.slice(8, 10) + '.' + d.slice(5, 7) + '.' + d.slice(0, 4) : ''
/** Aceeași formă ca _hr_nr_afisat pe server: 916/28.09.2026, 385-a/2024, „ (seria carte tehnica)". */
export const nrAfisat = d => d?.numar == null ? null
  : `${d.numar}${d.numar_sufix ? '-' + d.numar_sufix : ''}/${d.data_emitere ? ddmmyyyy(d.data_emitere) : d.an}${d.serie === 'carte_tehnica' ? ' (seria carte tehnica)' : ''}`

/**
 * Ziua de business (Europe/Bucharest), ca _hr_azi() din SQL — nu ziua dispozitivului (J11-2, spec §2.4).
 * ms: instantul (implicit acum); întoarce 'YYYY-MM-DD'.
 */
export function aziBucuresti(ms = Date.now()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(ms)).map(x => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}`
}

/**
 * Toate rândurile, pe chei (keyset pe id crescător, J11-1/P11-2): se continuă până la o pagină GOALĂ, deci un plafon
 * REST mai mic decât `pas` nu mai trunchiază, iar un rând inserat între pagini nu deplasează ferestrele (fără dubluri/goluri).
 * cerePagina(ultimId|null, pas) → Promise<{ data, error }>, rânduri ordonate după id crescător, toate cu id > ultimId.
 */
export async function paginareKeyset(cerePagina, pas = 1000) {
  const tot = []
  for (let ultim = null; ;) {
    const { data, error } = await cerePagina(ultim, pas)
    if (error) throw error
    if (!data || !data.length) return tot
    tot.push(...data)
    const u = data[data.length - 1].id
    if (u == null || (ultim != null && !(u > ultim))) throw new Error('paginare: id lipsă sau neordonat')
    ultim = u
  }
}

/** Ordinea registrului: an desc, număr desc (null-urile — draft/rezervă fără număr — primele), apoi id desc. */
export function ordineRegistru(a, b) {
  const desc = (x, y) => x == null ? (y == null ? 0 : -1) : y == null ? 1 : y - x
  return desc(a.an, b.an) || desc(a.numar, b.numar) || (b.id - a.id)
}

/** În vigoare azi: data efectului ≤ azi ≤ data_efect_pana (același predicat ca v_hr_decizii_curente; P10-1). */
export const inVigoare = (d, azi) => (!d.data_efect || d.data_efect <= azi) && (!d.data_efect_pana || d.data_efect_pana >= azi)

/**
 * Eticheta cardului unui rol din Execuție → Echipă (spec §7, C10, VA9), legată pe tip_cod.
 * Între deciziile semnate în vigoare se caută ÎNTÂI cea a persoanei din echipă (pot exista mai mulți RTE pe domenii, J10-3);
 * „echipa ≠ decizia” apare doar dacă nicio decizie în vigoare nu e a persoanei din echipă.
 * decizii: rândurile proiectului (emisa / semnata / revocata), cu data_efect și data_efect_pana; azi: 'YYYY-MM-DD'.
 */
export function stareRol(tipCod, idEchipa, decizii, nume = {}, azi) {
  const ale = (decizii || []).filter(d => d.tip_cod === tipCod)
  const pers = d => d.snapshot?.persoana?.nume || nume[d.employee_id] || d.persoana_nume || '?'
  const id = idEchipa ? Number(idEchipa) : null
  const valide = ale.filter(d => d.stare === 'semnata' && inVigoare(d, azi))
  const aPersoanei = id && valide.find(d => d.employee_id === id)
  if (aPersoanei) return { cod: 'ok', t: `Decizia nr ${nrAfisat(aPersoanei)}` }
  if (valide.length) {
    if (id) return { cod: 'diferit', t: `⚠ echipa ≠ decizia activă (nr ${nrAfisat(valide[0])}: ${pers(valide[0])})` }
    return { cod: 'ok', t: `Decizia nr ${nrAfisat(valide[0])}: ${pers(valide[0])}` }
  }
  const viitoare = ale.find(d => d.stare === 'semnata' && d.data_efect && d.data_efect > azi && (!id || d.employee_id === id))
  if (viitoare) return { cod: 'viitor', t: `nr ${nrAfisat(viitoare)} · efect de la ${viitoare.data_efect.split('-').reverse().join('.')}` }
  const emisa = ale.find(d => d.stare === 'emisa')
  if (emisa) return { cod: 'nesemnata', t: `nr ${nrAfisat(emisa)} · nesemnată` }
  const rev = id && ale.find(d => d.stare === 'revocata' && d.employee_id === id)
  if (rev) return { cod: 'revocata', t: `⚠ decizie revocată, echipa îl are încă pe ${pers(rev)}` }
  if (id) return { cod: 'lipsa', t: '⚠ fără decizie' }
  return null
}

/**
 * G7 în client, ca indicație (serverul decide G7): pe proiect există un RTE semnat ÎN VIGOARE, al altei persoane,
 * pe domenii disjuncte de cele alese. Nu schimbă singur propune_efect (P10-2).
 */
export function alteRteInVigoare(decizii, proiectId, employeeId, domenii, azi) {
  const ale = new Set((domenii || []).map(String))
  return (decizii || []).some(d => d.tip_cod === 'RTE' && d.stare === 'semnata' && String(d.proiect_id) === String(proiectId)
    && String(d.employee_id) !== String(employeeId) && inVigoare(d, azi) && !(d.domenii_isc || []).some(c => ale.has(String(c))))
}
