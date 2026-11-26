// TKT-0329 A, PR-extragere (Task 6): funcții PURE pentru pasul de comparație a cantităților între documente (spec §3.8, planul
// 2026-11-25-ofertare-cantitati-intre-surse, deciziile 17–18). Fără rețea, fără AI, fără BD. Edge-ul NU clasifică, NU alege observații și NU
// verifică dovezi (toate în SQL, 20270112a, L19); aici doar:
//   - plafonul de pagini: ACEEAȘI definiție ca fn_ofertare_masura_pagini_permise (paritate pe supabase/tests/20270112a_cazuri_plafon.json);
//   - rolul unei felii reconstruit determinist din contextul legat de fotografie (fn_ofertare_semnale_context), cu funcțiile existente
//     sectiuniRol / aplicaDecizii (același calcul ca rularea extragerii);
//   - completitudinea feliilor (poarta B1 existentă pe f3 / c6; indicatorul obs_atribuibile ÎNAINTEA rolului — r7 P1);
//   - inventarul paginilor rulării (ofertare_cantitati_evaluari.pagini) și rezumatul semnalelor pentru raport.
// Importurile din folderul extragerii sunt intenționate: rolul și poarta sunt ale extragerii, iar comparația trebuie să le folosească EXACT
// (o copie ar putea diverge).
import { type Rol, aplicaDecizii, sectiuniRol } from '../ofertare-cantitati-extrage/roluri.ts'
import { type ObsPentruPoarta, poartaFelie, ROLURI_POARTA } from '../ofertare-cantitati-extrage/poartaB1.ts'
import { sha256Hex } from './cantNormalizare.ts'

// ─── tipurile serverului (20270112a) ───
// rândul unui document din fn_ofertare_semnale_fotografie
export type FotoDocument = {
  id: number; tip: string; nume_original: string; revizie: string; sha: string; pagini: number; pagini_necitite: number[]; lot_stare: string | null
  extragere_id: number | null; extractor_id: string | null; felii_distincte: number; felii_sha: string | null; obs_sha: string | null; decizii_sha: string | null
}
export type Fotografie = {
  licitatie_id: number; documente: FotoDocument[]; document_loturi_sha: string | null; stare_loturi: string | null; cantitati_sha: string | null
  prag: number; plafon: number; v: string; sha: string
}
// forma minimă pe care edge-ul o cere înainte să se bazeze pe fotografie (un răspuns străin — ex. {ok: true} — nu e fotografie)
export function eFotografie(x: unknown): x is Fotografie {
  if (!x || typeof x !== 'object') return false
  const f = x as Record<string, unknown>
  return typeof f.sha === 'string' && f.sha.length > 0 && Array.isArray(f.documente) && typeof f.plafon === 'number' && Number.isFinite(f.plafon)
}
// rezultatul fn_ofertare_semnale_context pentru UN document
export type Context = {
  document_id: number; text_extras: string | null; nume_original: string; tip: string; sha: string
  decizii: { id: number; rol: string | null; sectiune: string | null; decizie: string }[]; decizii_sha: string
}
// observația servită de fn_ofertare_semnale_felii (doar când obs_atribuibile = true)
export type Obs = { id: number; felie_nr: number; pozitie_dovedita: boolean; cantitate_offset: number | null; hash_rand: string; e_total: boolean; e_subtotal: boolean }
// rândul fn_ofertare_semnale_felii = încercarea autoritativă a unei felii logice (decizia 8)
export type FelieServita = {
  document_id: number; extragere_id: number; felie_nr: number; incercare: number; incercari: number; de_la: number; pana_la: number; stare: string
  obs_numar: number; obs_atribuibile: boolean; obs: Obs[]
}
export type FelieIncompleta = { extragere_id: number; felie_nr: number; motiv: string }

// ─── plafonul de pagini (decizia 18) ───
export type DocPagini = { id: number; pagini: number }
export type FelieInterval = { document_id: number; pagina_de_la: number; pagina_pana_la: number }
export type LimitaDocument = { document_id: number; ultima_pagina_permisa: number }
export type PaginiDocument = { document_id: number; pagini: number[] }
export const cheieFelie = (f: FelieInterval) => `${f.document_id}:${f.pagina_de_la}-${f.pagina_pana_la}`

const intreg = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? Math.trunc(x) : 0)

// limita pe document = fn_ofertare_masura_pagini_permise: documentele ORDONATE după id (toate, inclusiv cele din cache), paginile numărate
// cumulat; ultima_pagina_permisa = greatest(0, least(pagini, plafon - (cumul - pagini))); plafon_atins = max(cumul) > plafon;
// pagini negative / lipsă = 0 (greatest(coalesce(pagini, 0), 0)); plafon invalid = 0 (coalesce(p_plafon, 0))
export function limitaPagini(docs: DocPagini[], plafon: number): { limita: LimitaDocument[]; plafon_atins: boolean } {
  const pl = Math.max(0, intreg(plafon))
  const ord = [...docs].map((d) => ({ id: Number(d.id), pagini: Math.max(0, intreg(d.pagini)) })).sort((a, b) => a.id - b.id)
  let cumul = 0, maxCumul = 0
  const limita: LimitaDocument[] = []
  for (const d of ord) {
    cumul += d.pagini
    maxCumul = Math.max(maxCumul, cumul)
    limita.push({ document_id: d.id, ultima_pagina_permisa: Math.max(0, Math.min(d.pagini, pl - (cumul - d.pagini))) })
  }
  return { limita, plafon_atins: maxCumul > pl }
}

const interval = (a: number, b: number): number[] => (b < a ? [] : Array.from({ length: b - a + 1 }, (_, i) => a + i))
const paginiOrdonate = (s: Set<number>) => [...s].filter((p) => Number.isFinite(p) && p >= 1).sort((a, b) => a - b)

// o felie e permisă ⇔ pagina_pana_la ≤ ultima_pagina_permisa a documentului ei (o felie care traversează limita e exclusă ÎNTREAGĂ);
// un document necunoscut listei = 0 pagini permise (conservator). pagini_necitite = paginile de peste limită ∪ paginile feliilor nepermise.
export function plafonFelii(docs: DocPagini[], felii: FelieInterval[], plafon: number): { permise: Set<string>; limita: LimitaDocument[]; pagini_necitite: PaginiDocument[]; plafon_atins: boolean } {
  const { limita, plafon_atins } = limitaPagini(docs, plafon)
  const ultima = new Map(limita.map((x) => [x.document_id, x.ultima_pagina_permisa]))
  const paginiDoc = new Map<number, number>()
  for (const d of docs) paginiDoc.set(Number(d.id), Math.max(0, intreg(d.pagini)))
  const necitite = new Map<number, Set<number>>()
  const adauga = (doc: number, p: number[]) => { if (!necitite.has(doc)) necitite.set(doc, new Set()); const s = necitite.get(doc)!; for (const x of p) s.add(x) }
  for (const [doc, u] of ultima) { const n = paginiDoc.get(doc) ?? 0; if (n > u) adauga(doc, interval(u + 1, n)) }
  const permise = new Set<string>()
  for (const f of felii) {
    const doc = Number(f.document_id)
    const u = ultima.get(doc) ?? 0
    if (Number.isFinite(f.pagina_pana_la) && f.pagina_pana_la <= u && f.pagina_de_la >= 1) permise.add(cheieFelie(f))
    else adauga(doc, interval(Math.max(1, intreg(f.pagina_de_la)), intreg(f.pagina_pana_la)))
  }
  const pagini_necitite = [...necitite].map(([document_id, s]) => ({ document_id, pagini: paginiOrdonate(s) })).filter((x) => x.pagini.length > 0)
    .sort((a, b) => a.document_id - b.document_id)
  return { permise, limita, pagini_necitite, plafon_atins }
}

// ─── paginile unui text / ale unei felii: ACEEAȘI citire a marcajelor ca SQL (review r3 P2; paritate pe supabase/tests/20270112a_cazuri_pagini.json) ───
// marcajul = chr(10214) 'PAGINA' [ ]* cifre{1,5} chr(10215) (doar spații, ca în fn_ofertare_masura_pagini — un tab nu face marcaj); numerele se iau
// așa cum sunt (și 0; „0” nu e o pagină permisă nicăieri). (Rolurile — sectiuniRol — au citirea lor, nu intră în plafon.)
const RE_PAGINA = /⟦PAGINA[ ]*(\d{1,5})⟧/g
const PREFIX_PAGINA = '⟦PAGINA'
export type SegmentPagina = { nr: number | null; de: number; pana: number }
// segmentele textului: preambulul (fără marcaj, nr null) + câte unul pe marcaj, de la marcaj (inclusiv) până la următorul; fără marcaje = un segment nr null
export function segmentePagini(text: string | null | undefined): SegmentPagina[] {
  const t = text ?? ''
  const out: SegmentPagina[] = []
  let prev: { nr: number; de: number } | null = null
  for (const m of t.matchAll(RE_PAGINA)) {
    const i = m.index ?? 0
    if (prev) out.push({ ...prev, pana: i })
    else if (i > 0) out.push({ nr: null, de: 0, pana: i })
    prev = { nr: Number(m[1]), de: i }
  }
  if (prev) out.push({ ...prev, pana: t.length })
  if (!out.length) out.push({ nr: null, de: 0, pana: t.length })
  return out
}
// numărul de pagini = fn_ofertare_masura_pagini: maximul numerelor din marcaje (chiar 0); fără marcaje = 1 dacă textul nu e gol, 0 dacă e gol
export function numarPagini(text: string | null | undefined): number {
  const t = text ?? ''
  const nrs = [...t.matchAll(RE_PAGINA)].map((m) => Number(m[1]))
  if (nrs.length) return Math.max(...nrs)
  return t === '' ? 0 : 1
}
// textul paginii n = fn_ofertare_masura_pagina: fără prefixul de marcaj în text → pagina 1 = tot textul, altfel null; cu prefix → de DUPĂ primul marcaj
// cu numărul n până la următorul marcaj (orice număr), null dacă n nu apare. Preambulul nu e pagină. (Folosită în proba de paritate.)
export function paginaText(text: string | null | undefined, n: number): string | null {
  const t = text ?? ''
  if (!t.includes(PREFIX_PAGINA)) return n === 1 ? t : null
  const re = new RegExp('⟦PAGINA[ ]*' + String(n) + '⟧')
  const m = re.exec(t)
  if (!m) return null
  const s = m.index + m[0].length
  const e = t.indexOf(PREFIX_PAGINA, s)
  return e < 0 ? t.slice(s) : t.slice(s, e)
}
// paginile atinse de o felie [de_la, pana_la) în text; preambulul (fără marcaj) e socotit la prima pagină marcată care urmează — convenție a
// plafonului, niciodată mai permisivă decât SQL (preambulul nu e pagină în SQL); fără marcaje = pagina 1; pagina „0” rămâne 0 (nepermisă)
export function paginiInterval(text: string, de_la: number, pana_la: number): { pagina_de_la: number; pagina_pana_la: number } {
  const seg = segmentePagini(text)
  const nrs: number[] = []
  let urm = 1
  for (let i = seg.length - 1; i >= 0; i--) { if (seg[i].nr !== null) urm = seg[i].nr as number; nrs[i] = urm }
  const atinse: number[] = []
  for (let i = 0; i < seg.length; i++) {
    const s = seg[i]
    const intersecteaza = pana_la > de_la ? s.de < pana_la && s.pana > de_la : s.de <= de_la && de_la < s.pana
    if (intersecteaza) atinse.push(nrs[i])
  }
  if (!atinse.length) { const ultim = nrs.length ? nrs[nrs.length - 1] : 1; return { pagina_de_la: ultim, pagina_pana_la: ultim } }
  return { pagina_de_la: Math.min(...atinse), pagina_pana_la: Math.max(...atinse) }
}

// ─── rolul unei felii din contextul legat de fotografie (decizia 17) ───
// EXACT calculul rulării: aplicaDecizii(sectiuniRol(text, nume, tip), deciziile active) → secțiunea care conține începutul feliei
export function rolFelie(ctx: Context, felie: { de_la: number; pana_la: number }): Rol | null {
  const sectiuni = aplicaDecizii(sectiuniRol(ctx.text_extras ?? '', ctx.nume_original, ctx.tip), (ctx.decizii ?? []).map((d) => ({ rol: d.rol ?? '', sectiune: d.sectiune ?? '', decizie: d.decizie })))
  const s = sectiuni.find((x) => x.de <= felie.de_la && felie.de_la < x.pana)
  return s ? s.rol : null
}

// documentul scos de om din sursele cantitative: decizia activă `nu_e_sursa_cantitativa` pe TOT documentul („*”), din contextul legat de fotografie
// (decizii_sha intră în fotografie → o schimbare a deciziei schimbă fotografia; review r3 P1: singura excludere a unui document fără extragere
// din „necitit” e o decizie a omului înregistrată în fotografie, nu o stare citită separat — lot / versiune)
export function exclusDeOm(ctx: Context): boolean {
  return Array.isArray(ctx?.decizii) && ctx.decizii.some((d) => d?.decizie === 'nu_e_sursa_cantitativa' && d?.sectiune === '*')
}

// contextul primit e EXACT versiunea din fotografie: textul (sha256), deciziile (decizii_sha), numele, tipul, documentul
export async function verificaContext(ctx: Context, fotoDoc: FotoDocument): Promise<boolean> {
  if (!ctx || Number(ctx.document_id) !== Number(fotoDoc.id)) return false
  const sha = await sha256Hex(ctx.text_extras ?? '')
  return sha === fotoDoc.sha && ctx.decizii_sha === fotoDoc.decizii_sha && ctx.nume_original === fotoDoc.nume_original && ctx.tip === fotoDoc.tip
}

// ─── completitudinea feliilor (decizia 17; r7 P1) ───
// Pentru fiecare felie, prima regulă adevărată decide: (1) stare ≠ gata; (2) obs_atribuibile ≠ true → observatii_neatribuibile (ÎNAINTEA rolului,
// pentru orice rol, și la rol nereconstructibil; lipsă / non-boolean = la fel, L18); (3) rol nereconstructibil (fără context, în afara
// secțiunilor, decizie nu_e_sursa_cantitativa); (4) rol tabelar → poarta B1 existentă, complet = false → câte o intrare pe motiv
// (deficit / incerte / tabele_nedeterminate); (5) alt rol cu observații atribuibile → nimic (text liber: risc rezidual declarat în plan).
export function completitudineFelii(felii: FelieServita[], contexte: Map<number, Context>): FelieIncompleta[] {
  const out: FelieIncompleta[] = []
  const vazute = new Set<string>()
  const pune = (f: FelieServita, motiv: string) => {
    const k = `${f.extragere_id}|${f.felie_nr}|${motiv}`
    if (vazute.has(k)) return
    vazute.add(k); out.push({ extragere_id: Number(f.extragere_id), felie_nr: Number(f.felie_nr), motiv })
  }
  for (const f of felii) {
    if (f.stare !== 'gata') { pune(f, 'stare:' + String(f.stare)); continue }
    if (f.obs_atribuibile !== true) { pune(f, 'observatii_neatribuibile'); continue }
    const ctx = contexte.get(Number(f.document_id))
    if (!ctx || !Number.isFinite(f.de_la) || !Number.isFinite(f.pana_la) || f.pana_la < f.de_la) { pune(f, 'rol_nereconstructibil'); continue }
    const rol = rolFelie(ctx, f)
    if (rol === null) { pune(f, 'rol_nereconstructibil'); continue }
    if (!ROLURI_POARTA.includes(rol)) continue
    const text = ctx.text_extras ?? ''
    const obs: ObsPentruPoarta[] = Array.isArray(f.obs) ? f.obs.map((o) => ({ cantitate_offset: typeof o?.cantitate_offset === 'number' ? o.cantitate_offset : null, pozitie_dovedita: o?.pozitie_dovedita === true })) : []
    const pb = poartaFelie(text.slice(f.de_la, f.pana_la), f.de_la, rol, obs)
    if (pb.complet) continue
    if (pb.deficit) pune(f, 'deficit')
    if (pb.incerte > 0) pune(f, 'incerte')
    if (pb.tabele_nedeterminate > 0) pune(f, 'tabele_nedeterminate')
  }
  return out
}

// ─── inventarul paginilor rulării = ofertare_cantitati_evaluari.pagini ───
export type PaginiRulare = {
  plafon: number; plafon_atins: boolean
  documente_necitite: number[]                                   // documentele fără extragere `gata` autoritativă în fotografie (ids)
  documente_necitite_stare: { document_id: number; stare: string }[]   // de ce (din rulare), informativ
  pagini_necitite: PaginiDocument[]                              // ale documentului ∪ peste limita plafonului ∪ feliile excluse în rulare
  felii_incomplete: FelieIncompleta[]
}
// `eligibile` = documentele care pot fi „necitite” (decizia 15: extragere lipsă / neterminată), stabilite de apelant DOAR din date legate de fotografie
// (tipul din fotografie ∈ tipurile extractibile și fără decizia omului `nu_e_sursa_cantitativa`); `null` = toate documentele fotografiei (conservator).
export function paginiRulare(foto: Fotografie, stareExtrageri: Map<number, string>, feliiIncomplete: FelieIncompleta[], paginiPestePlafon: PaginiDocument[],
  eligibile: Set<number> | null = null): PaginiRulare {
  const docs = [...(foto.documente ?? [])].sort((a, b) => Number(a.id) - Number(b.id))
  const { limita, plafon_atins } = limitaPagini(docs.map((d) => ({ id: d.id, pagini: d.pagini })), foto.plafon)
  const ultima = new Map(limita.map((x) => [x.document_id, x.ultima_pagina_permisa]))
  const necitite = docs.filter((d) => (d.extragere_id === null || d.extragere_id === undefined) && (eligibile === null || eligibile.has(Number(d.id)))).map((d) => Number(d.id))
  const pagini_necitite: PaginiDocument[] = []
  for (const d of docs) {
    const s = new Set<number>()
    for (const p of Array.isArray(d.pagini_necitite) ? d.pagini_necitite : []) { const n = Number(p); if (Number.isFinite(n)) s.add(Math.trunc(n)) }
    const n = Math.max(0, intreg(d.pagini)), u = ultima.get(Number(d.id)) ?? 0
    for (const p of interval(u + 1, n)) s.add(p)
    for (const pp of paginiPestePlafon) if (Number(pp.document_id) === Number(d.id)) for (const p of pp.pagini ?? []) { const x = Number(p); if (Number.isFinite(x)) s.add(Math.trunc(x)) }
    const lista = paginiOrdonate(s)
    if (lista.length) pagini_necitite.push({ document_id: Number(d.id), pagini: lista })
  }
  const vazute = new Set<string>()
  const felii_incomplete = feliiIncomplete.filter((f) => { const k = `${f.extragere_id}|${f.felie_nr}|${f.motiv}`; if (vazute.has(k)) return false; vazute.add(k); return true })
    .map((f) => ({ extragere_id: Number(f.extragere_id), felie_nr: Number(f.felie_nr), motiv: String(f.motiv) }))
    .sort((a, b) => a.extragere_id - b.extragere_id || a.felie_nr - b.felie_nr || a.motiv.localeCompare(b.motiv))
  return { plafon: foto.plafon, plafon_atins, documente_necitite: necitite,
    documente_necitite_stare: necitite.map((id) => ({ document_id: id, stare: stareExtrageri.get(id) ?? 'fara_extragere_gata' })), pagini_necitite, felii_incomplete }
}

// ─── rezumatul publicării, pentru raportul rulării ───
export type RezumatSemnale = { diferente: number; de_verificat: number; neverificate: number; in_regula: number; altele: number; total: number }
export function rezumatSemnale(raspunsPublica: unknown): RezumatSemnale {
  const r: RezumatSemnale = { diferente: 0, de_verificat: 0, neverificate: 0, in_regula: 0, altele: 0, total: 0 }
  const semnale = (raspunsPublica as { semnale?: unknown } | null)?.semnale
  if (!Array.isArray(semnale)) return r
  for (const s of semnale) {
    const v = (s as { verdict?: unknown } | null)?.verdict
    r.total++
    if (v === 'diferenta') r.diferente++
    else if (v === 'de_verificat') r.de_verificat++
    else if (v === 'neverificat') r.neverificate++
    else if (v === 'in_regula') r.in_regula++
    else r.altele++
  }
  return r
}
