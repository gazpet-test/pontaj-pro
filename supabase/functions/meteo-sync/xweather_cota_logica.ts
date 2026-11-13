// r5 — cota Vaisala Xweather citită din ANTETELE răspunsurilor (logica pură, fără rețea și fără BD), folosită de meteo-sync/index.ts
// pentru TOATE cererile Xweather ale funcției (vremea curentă + rezumatul zilnic) și testată cu vitest (src/xweatherCotaAntete.test.js).
//
// Faptele din documentația oficială Xweather (docs/METEO_XWEATHER_COTA.md, cu sursele):
//   - costul unei cereri = produsul multiplicatorilor (endpoint × timp × spațiu), raportat în antetul X-Cost-Tokens (însoțit de
//     X-Cost-Endpoint și X-Cost-Multipliers; o pagină oficială îl scrie X-Cost-Multiplier → le acceptăm pe amândouă);
//   - antetele de cost apar la răspunsurile 2xx; 4xx / 5xx NU consumă;
//   - multiplicatori documentați: conditions 1, forecasts 1, alerts 1, airquality 5, conditions/summary 1 pe zi (și parțială);
//     observations/summary: NESPECIFICAT → estimat 1 aici, până îl spune antetul;
//   - antetele de cotă: X-RateLimit-{Limit,Remaining,Reset}-Minute, X-RateLimit-Limit-Period-Type, X-RateLimit-{Limit,Remaining,Reset}-Period;
//   - depășirea = HTTP 429 cu codul maxhits (perioada abonamentului), maxhits_daily (până la 00:00 UTC) sau maxhits_min (minutul).
// Antetele și corpul sunt conținut EXTERN: doar numere validate și text scurt dintr-un alfabet restrâns; nimic din ele nu ajunge în URL-uri.

// ── multiplicatorii documentați (estimarea când antetul lipsește) ──────────────────────────────────────────────────
export const MULTIPLICATORI: Record<string, number> = {
  conditions: 1, forecasts: 1, alerts: 1, airquality: 5,
  'conditions/summary': 1,
  'observations/summary': 1,   // nespecificat în documentație: estimat 1, confirmat de antet la prima rulare
}
export const ENDPOINTURI_CURENTE = ['conditions', 'forecasts', 'alerts', 'airquality']

// endpoint-ul unei cereri (calea fără credențiale): 'conditions/summary/44,26?…' → 'conditions/summary'; 'conditions/44,26?…' → 'conditions'
export function endpointDin(cerere: string): string {
  const c = String(cerere).replace(/^\/+/, '')
  const m = /^([a-z]+)(?:\/(summary))?(?:[/?]|$)/.exec(c)
  if (!m) return 'necunoscut'
  const e = m[2] ? `${m[1]}/summary` : m[1]
  return e in MULTIPLICATORI ? e : 'necunoscut'
}
export const multiplicatorDocumentat = (endpoint: string) => MULTIPLICATORI[endpoint] ?? 1

// ── citirea antetelor (validare strictă) ───────────────────────────────────────────────────────────────────────
type Antete = { get(k: string): string | null } | null | undefined
const RE_NUMAR = /^\d{1,9}(\.\d{1,4})?$/
// număr nenegativ dintr-un antet; altceva (gol, negativ, text, prea mare) = null
export function numarAntet(v: string | null | undefined): number | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return RE_NUMAR.test(t) ? Number(t) : null
}
// momentul (ms) dintr-un antet de resetare: secunde / milisecunde UNIX sau o dată (GMT / ISO); în afara [acum − 1 zi, acum + 400 de zile] = null
export function momentAntet(v: string | null | undefined, acum: number): number | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  if (!t || t.length > 64) return null
  let ms: number
  if (/^\d{9,13}$/.test(t)) ms = t.length <= 11 ? Number(t) * 1000 : Number(t)
  else if (/^[A-Za-z0-9 ,:.+\-TZ]+$/.test(t)) ms = Date.parse(t)
  else return null
  if (!Number.isFinite(ms) || ms < acum - 864e5 || ms > acum + 400 * 864e5) return null
  return ms
}
// text scurt dintr-un antet (multiplicatori, tipul perioadei): doar litere, cifre și = ; , . _ - spațiu, cel mult 80 de caractere
export function textAntet(v: string | null | undefined): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t && t.length <= 80 && /^[A-Za-z0-9=;,._\- ]+$/.test(t) ? t : null
}
// produsul multiplicatorilor din „endpoint=10; spatial=3; temporal=1” (orice ordine); formă neașteptată = null
export function produsMultiplicatori(t: string | null): number | null {
  if (!t) return null
  const parti = t.split(/[;,]/).map(x => x.trim()).filter(Boolean)
  if (!parti.length || parti.length > 6) return null
  let p = 1
  for (const x of parti) {
    const m = /^[a-z]{1,20}\s*=\s*(\d{1,6}(\.\d{1,4})?)$/i.exec(x)
    if (!m) return null
    p *= Number(m[1])
  }
  return Number.isFinite(p) ? p : null
}

// costul unei cereri: 2xx → X-Cost-Tokens ('antet'); fără el → produsul din X-Cost-Multipliers / X-Cost-Multiplier ('multiplicatori');
// fără niciunul → multiplicatorul documentat ('estimat'). 4xx / 5xx cu răspuns: 0 după documentație, DAR pentru plafonul local se socotesc
// prudent cu multiplicatorul documentat ('estimat'), ca și cererile fără răspuns (rețea / timp depășit: nu știm dacă au consumat).
export type Cost = { unitati: number; sursa: 'antet' | 'multiplicatori' | 'estimat'; multiplicatori: string | null }
export function costCerere(endpoint: string, status: number, h: Antete): Cost {
  const mult = textAntet(h?.get('X-Cost-Multipliers') ?? null) ?? textAntet(h?.get('X-Cost-Multiplier') ?? null)
  if (status >= 200 && status < 300) {
    const tok = numarAntet(h?.get('X-Cost-Tokens') ?? null)
    if (tok != null) return { unitati: tok, sursa: 'antet', multiplicatori: mult }
    const p = produsMultiplicatori(mult)
    if (p != null) return { unitati: p, sursa: 'multiplicatori', multiplicatori: mult }
  }
  return { unitati: multiplicatorDocumentat(endpoint), sursa: 'estimat', multiplicatori: mult }
}

// ── oprirea la depășire ────────────────────────────────────────────────────────────────────────────────────────
// 'perioada' (maxhits) / 'zi' (maxhits_daily) / 'necunoscut' (429 fără cod cunoscut, tratat prudent ca perioada) = oprește TOT ce e Xweather
// în rulare; 'minut' (maxhits_min) = se așteaptă resetarea minutului o singură dată (index.ts). Codul contează și la HTTP 200 (eroare în corp).
export type Depasire = 'perioada' | 'zi' | 'minut' | 'necunoscut' | null
export function depasire(status: number, j: any): Depasire {
  const cod = typeof j?.error?.code === 'string' ? j.error.code : ''
  if (cod === 'maxhits_min') return 'minut'
  if (cod === 'maxhits_daily') return 'zi'
  if (cod === 'maxhits') return 'perioada'
  if (status === 429) return 'necunoscut'
  return null
}
export function motivDepasire(d: Depasire, status: number): string {
  const ce = d === 'perioada' ? 'cota perioadei (maxhits)' : d === 'zi' ? 'cota zilei (maxhits_daily, până la 00:00 UTC)'
    : d === 'minut' ? 'limita pe minut (maxhits_min)' : 'limita furnizorului (429 fără cod)'
  return `${ce}, HTTP ${status}`
}

// ── contorul rulării: tot ce trece prin cererile Xweather ale funcției ─────────────────────────────────────────────
export type Contor = {
  cereri: number; unitati: number; unitati_estimate: number; estimate: number
  pe_endpoint: Record<string, { cereri: number; unitati: number; estimate: number; cost_max: number }>
  multiplicatori: Record<string, string>
  perioada: { limita: number | null; rest: number | null; resetare: number | null; tip: string | null }
  minut: { limita: number | null; rest: number | null; resetare: number | null }
  oprit: string | null; asteptari_minut: number
}
export function contorNou(): Contor {
  return { cereri: 0, unitati: 0, unitati_estimate: 0, estimate: 0, pe_endpoint: {}, multiplicatori: {},
    perioada: { limita: null, rest: null, resetare: null, tip: null }, minut: { limita: null, rest: null, resetare: null },
    oprit: null, asteptari_minut: 0 }
}
// unitățile socotite pentru plafon = cele din antete + estimările prudente
export const totalPrudent = (c: Contor) => c.unitati + c.unitati_estimate
// o cerere TRIMISĂ (status 0 = rețea / timp depășit): costul ei + ultimele antete de cotă (doar valorile valide le înlocuiesc pe cele vechi)
export function inregistreaza(c: Contor, endpoint: string, status: number, h: Antete, acum: number): Cost {
  const cost = costCerere(endpoint, status, h)
  c.cereri++
  const e = (c.pe_endpoint[endpoint] ||= { cereri: 0, unitati: 0, estimate: 0, cost_max: 0 })
  e.cereri++
  if (cost.sursa === 'estimat') { c.unitati_estimate += cost.unitati; c.estimate++; e.estimate++ } else c.unitati += cost.unitati
  e.unitati += cost.unitati
  // costul maxim văzut în rulare (rezervarea unei zile-șantier, costul vremii curente): doar din antete; estimarea rămâne cea documentată
  if (cost.sursa !== 'estimat') e.cost_max = Math.max(e.cost_max, cost.unitati)
  if (cost.multiplicatori) c.multiplicatori[endpoint] = cost.multiplicatori
  if (h) {
    const v = (k: string) => numarAntet(h.get(k))
    const lp = v('X-RateLimit-Limit-Period'), rp = v('X-RateLimit-Remaining-Period')
    const tp = momentAntet(h.get('X-RateLimit-Reset-Period'), acum), tip = textAntet(h.get('X-RateLimit-Limit-Period-Type'))
    if (lp != null) c.perioada.limita = lp
    if (rp != null) c.perioada.rest = rp
    if (tp != null) c.perioada.resetare = tp
    if (tip != null) c.perioada.tip = tip
    const lm = v('X-RateLimit-Limit-Minute'), rm = v('X-RateLimit-Remaining-Minute'), tm = momentAntet(h.get('X-RateLimit-Reset-Minute'), acum)
    if (lm != null) c.minut.limita = lm
    if (rm != null) c.minut.rest = rm
    if (tm != null) c.minut.resetare = tm
  }
  return cost
}
// cât costă o cerere pe endpoint în calculele de rezervă: maximul dintre multiplicatorul documentat și cel mai mare cost din antete în rulare
export const costEndpoint = (c: Contor, endpoint: string) => Math.max(multiplicatorDocumentat(endpoint), c.pe_endpoint[endpoint]?.cost_max ?? 0)
// cât poate costa o zi-șantier (conditions/summary + observations/summary): r4 rezerva 2; crește dacă antetele arată mai mult
export const costZiSantier = (c: Contor) => costEndpoint(c, 'conditions/summary') + costEndpoint(c, 'observations/summary')

// blocul `cota` din răspunsul funcției (fără chei, fără URL-uri: doar numele endpoint-urilor și cifre)
export function blocCota(c: Contor) {
  const iso = (ms: number | null) => (ms == null ? null : new Date(ms).toISOString())
  return {
    cereri: c.cereri, unitati: c.unitati, unitati_estimate: c.unitati_estimate, estimate: c.estimate, total_prudent: totalPrudent(c),
    pe_endpoint: c.pe_endpoint, multiplicatori: c.multiplicatori,
    perioada: { limita: c.perioada.limita, rest: c.perioada.rest, resetare: iso(c.perioada.resetare), tip: c.perioada.tip },
    minut: { limita: c.minut.limita, rest: c.minut.rest, resetare: iso(c.minut.resetare) },
    cota_necunoscuta: c.perioada.rest == null || c.perioada.resetare == null,
    oprit: c.oprit, asteptari_minut: c.asteptari_minut,
  }
}

// ── calitatea aerului: câte dintre cele 4 rulări complete (UTC 04 / 10 / 16 / 22) cer și airquality ─────────────────────
export const AER_PE_ZI_IMPLICIT = 4
export const ORE_COMPLETE_UTC = [4, 10, 16, 22]
const ORE_AER: Record<number, number[]> = { 0: [], 1: [4], 2: [4, 16], 3: [4, 10, 16], 4: [4, 10, 16, 22] }
// XW_AER_PE_ZI: exact '0'..'4'; lipsă = 4 (ca până acum); altă valoare = 4 + semnalată în rezultat
// r6: rezultatul spune și de unde vine valoarea: 'setata' (0..4), 'implicita' (variabila lipsește), 'invalida' (orice altceva, INCLUSIV
// șirul gol: o variabilă pusă greșit nu mai trece neobservată) → implicita 4, cu valoarea primită în `invalid`
export type SursaAer = 'setata' | 'implicita' | 'invalida'
export function aerPeZi(v: string | null | undefined): { n: number; invalid: string | null; sursa: SursaAer } {
  if (v == null) return { n: AER_PE_ZI_IMPLICIT, invalid: null, sursa: 'implicita' }
  return /^[0-4]$/.test(v) ? { n: Number(v), invalid: null, sursa: 'setata' } : { n: AER_PE_ZI_IMPLICIT, invalid: String(v).slice(0, 20), sursa: 'invalida' }
}
// rularea completă de la ora UTC dată cere aerul? La reîmprospătarea manuală (complet / forta, în afara orelor): da, dacă n ≥ 1.
export const cereAer = (n: number, oraUtc: number, manual: boolean) => (manual ? n >= 1 : (ORE_AER[n] || []).includes(oraUtc))
// XW_ZILNIC_ACTIV: pasul zilnic Xweather și comanda owner-ului rulează DOAR cu valoarea exactă '1'
export const zilnicActiv = (v: string | null | undefined) => v === '1'

// ── garda de cotă a pasului zilnic ─────────────────────────────────────────────────────────────────────────────
export const RULARI_PE_ZI = 12              // cron 5 */2 * * *
export const MARJA_COTA = 300               // ≈ două reîmprospătări manuale complete (19 × 8 = 152 fiecare) + rezervă
export const MAX_UNITATI_XW_RULARE = 60     // pasul zilnic: plafonul pe rulare, în unități de cost (≈ 30 de zile-șantier cu costurile documentate)
export const PLAFON_COTA_NECUNOSCUTA = 10   // fără antete de cotă la pornire: plafonul mic, declarat (5 zile-șantier)
// consumul pe zi al vremii curente (programul cron-ului): 12 rulări × conditions + 4 complete × (forecasts + alerts) + aerul de n ori
export function costZiVremeCurenta(tinte: number, aer: number, cost: (e: string) => number = multiplicatorDocumentat): number {
  return tinte * (RULARI_PE_ZI * cost('conditions') + ORE_COMPLETE_UTC.length * (cost('forecasts') + cost('alerts')) + aer * cost('airquality'))
}
export type Garda = { cunoscuta: boolean; rest: number | null; resetare: string | null; zile: number | null; cost_zi_vreme_curenta: number;
  rezerva: number | null; marja: number; disponibil: number | null; plafon: number }
// disponibil pentru pasul zilnic = restul perioadei − (consumul vremii curente pe zi × zilele până la resetare, rotunjite în sus) − marja.
// Cotă necunoscută (fără rest sau fără momentul resetării) → plafonul mic PLAFON_COTA_NECUNOSCUTA.
export function gardaCota(c: Contor, { acum, tinte, aer, plafon = MAX_UNITATI_XW_RULARE }: { acum: number; tinte: number; aer: number; plafon?: number }): Garda {
  const czi = costZiVremeCurenta(tinte, aer, e => costEndpoint(c, e))
  const { rest, resetare } = c.perioada
  if (rest == null || resetare == null) {
    return { cunoscuta: false, rest, resetare: resetare == null ? null : new Date(resetare).toISOString(), zile: null, cost_zi_vreme_curenta: czi,
      rezerva: null, marja: MARJA_COTA, disponibil: null, plafon: Math.min(plafon, PLAFON_COTA_NECUNOSCUTA) }
  }
  const zile = Math.max(1, Math.ceil((resetare - acum) / 864e5))
  const rezerva = czi * zile + MARJA_COTA
  const disponibil = rest - rezerva
  return { cunoscuta: true, rest, resetare: new Date(resetare).toISOString(), zile, cost_zi_vreme_curenta: czi, rezerva, marja: MARJA_COTA,
    disponibil, plafon: Math.max(0, Math.min(plafon, disponibil)) }
}
// o zi-șantier nouă încape sub garda de cotă (cu ultimele antete)? null = da; altfel motivul
export const NEAJUNSA_COTA = 'neajunsă (rezerva de cotă pentru vremea curentă)'
export function incapeInCota(c: Contor, costZi: number, o: { acum: number; tinte: number; aer: number }): string | null {
  const g = gardaCota(c, o)
  if (!g.cunoscuta) return null      // cota necunoscută: decide plafonul mic, nu garda
  return g.disponibil != null && g.disponibil >= costZi ? null : NEAJUNSA_COTA
}
