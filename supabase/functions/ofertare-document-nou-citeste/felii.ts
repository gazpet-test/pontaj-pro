// deno-lint-ignore-file no-explicit-any
// ofertare-document-nou-citeste/felii.ts — rezumatul PE FELII (Răcari, 06.10.2026, varianta A aleasă de Răzvan).
// „Răspuns consolidat nr. 2” (30 de pagini, 68.516 caractere, 38 de perechi întrebare–răspuns): citirea pe felii a mers, dar
// rezumatul într-un singur apel cădea la 130 s — cu citat literal pentru fiecare pereche, AI-ul avea prea mult de SCRIS (ieșirea, nu
// intrarea, era limita). Acum textul se împarte în felii de ≤ MAX_FELIE caractere, tăiate la granița unei întrebări („Solicitarea
// nr. N”, „Întrebarea nr. N”…) ca perechea să nu se rupă, altfel la o pagină / un rând gol (citire marcată „granita_nesigura”). Fiecare felie se
// citește într-un apel separat (~40–60 s), rezultatele parțiale se păstrează pe server, iar la final se combină + o sinteză scurtă.
export const MAX_FELIE = 15_000                   // ~8 perechi întrebare–răspuns cu citat literal ≈ 3–4k tokeni de ieșire

// Începutul unei întrebări: la început de rând, cuvântul-cheie + (opțional) „de clarificare” + (opțional) „nr.” + NUMĂRUL imediat după.
// „Răspuns solicitarea nr. N” NU se potrivește (nu tăiem între întrebare și răspuns), nici un rând de text care doar începe cu
// „Întrebare despre … MM108” (numărul trebuie să fie identificatorul întrebării, nu un număr oarecare din frază).
const RE_INTREBARE = /^[ \t]*(?:solicitarea|solicitare|întrebarea|întrebare|intrebarea|intrebare|clarificarea|clarificare|cererea|cerere)(?:[ \t]+de[ \t]+clarificar[ei]\w*)?[ \t]*(?:nr\.?|num[aă]rul|no\.?)?[ \t]*\d+/gim
const RE_PAGINA = /⟦PAGINA \d+(?:-\d+)?⟧/g

function pozitii(re: RegExp, t: string): number[] {
  const p: number[] = []
  for (const m of t.matchAll(re)) p.push(m.index ?? 0)
  return p
}

// Copilot conv. 3 (06.10, NO-GO P1 pe d459447): o tăietură care NU cade la începutul unei întrebări (pagină / rând gol / rând / fix)
// poate rupe o pereche întrebare–răspuns sau o modificare, iar combinarea n-o poate reuni sigur. De aceea: (1) granița la întrebare se
// caută în toată fereastra, de la MIN_INTREBARE încolo (nu doar în a doua jumătate) — o pereche se rupe doar dacă e mai lungă de
// ~4/5 din felie; (2) fiecare tăietură își spune tipul, iar orice tăietură în afara unei întrebări face citirea „granita_nesigura”
// (citire_completa = false, avertisment în UI). Nimic nu se mai prezintă drept complet fără o graniță demonstrabilă.
export type Granita = 'intrebare' | 'pagina' | 'paragraf' | 'rand' | 'fix'
export const graniteSigure = (g: Granita[]) => g.every((x) => x === 'intrebare')

// Împărțire FĂRĂ pierderi: concatenarea feliilor = textul primit (testat). `la` = pozițiile tăieturilor, `granite` = tipul fiecăreia.
export function imparteCuGranite(text: string, max = MAX_FELIE): { felii: string[]; granite: Granita[]; la: number[] } {
  const t = String(text || '')
  if (t.length <= max) return { felii: [t], granite: [], la: [] }
  const intrebari = pozitii(RE_INTREBARE, t), pagini = pozitii(RE_PAGINA, t)
  const minQ = Math.max(1, Math.floor(max / 5))   // granița la întrebare: oriunde după primele 20% din fereastră
  const min = Math.max(1, Math.floor(max / 2))    // celelalte căderi: în a doua jumătate (felii nu prea mici)
  const felii: string[] = [], granite: Granita[] = [], la: number[] = []
  let start = 0
  while (t.length - start > max) {
    const hi = start + max
    const ultima = (arr: number[], lo: number) => { let r = -1; for (const x of arr) if (x > lo && x <= hi) r = x; return r }
    let cut = ultima(intrebari, start + minQ), tip: Granita = 'intrebare'
    if (cut < 0) { cut = ultima(pagini, start + min); tip = 'pagina' }
    if (cut < 0) { const k = t.lastIndexOf('\n\n', hi); if (k > start + min) { cut = k + 2; tip = 'paragraf' } }
    if (cut < 0) { const k = t.lastIndexOf('\n', hi); if (k > start + min) { cut = k + 1; tip = 'rand' } }
    if (cut < 0) { cut = hi; tip = 'fix' }
    felii.push(t.slice(start, cut)); granite.push(tip); la.push(cut)
    start = cut
  }
  felii.push(t.slice(start))
  return { felii, granite, la }
}
export const imparteInFelii = (text: string, max = MAX_FELIE): string[] => imparteCuGranite(text, max).felii

const DATA = /^\d{4}-\d{2}-\d{2}$/
export type Termen = { data: string; citat: string }
export type Parte = {
  tip: string; rezumat: string; modificari: any[]; intrebari_raspunse: any[]
  termene: Termen[]; data_document: string | null; motive: string[]; tokens_in: number; tokens_out: number
}
const TIPURI = ['raspuns_clarificare', 'erata', 'document_nou', 'altul']

// Termenele unei felii (Copilot conv. 3, NO-GO P1 runda 2): AI-ul întoarce LISTA mențiunilor unui termen de depunere stabilit / modificat
// în fragment, în ordinea textului, cu citatul — nu un singur scalar, ca „30.10 apoi 25.10” în ACEEAȘI felie (sau la n = 1) să se vadă
// drept conflict. Răspunsurile vechi (doar termen_nou) rămân citite ca listă de un element. Datele invalide se ignoră.
export function termeneDinAi(j: any): Termen[] {
  const lista = Array.isArray(j?.termene) ? j.termene : []
  const t = lista.map((x: any) => ({ data: String(x && typeof x === 'object' ? x.data ?? '' : x ?? ''), citat: String(x?.citat ?? '').slice(0, 400) }))
    .filter((x: Termen) => DATA.test(x.data))
  if (!t.length && DATA.test(String(j?.termen_nou || ''))) t.push({ data: String(j.termen_nou), citat: '' })
  return t
}

// Răspunsul AI pentru o felie → parte normalizată (liste, date valide, motivul „răspuns tăiat” dacă a atins max_tokens).
export function parteDinAi(j: any, stopReason: string | null | undefined, tokIn: number, tokOut: number): Parte {
  return {
    tip: TIPURI.includes(j?.tip) ? j.tip : 'altul',
    rezumat: String(j?.rezumat_fragment ?? j?.rezumat ?? ''),   // plafonul (MAX_REZUMAT) și motivul „rezumat_taiat” le pune plafoneazaRezultat
    modificari: Array.isArray(j?.modificari) ? j.modificari : [],
    intrebari_raspunse: Array.isArray(j?.intrebari_raspunse) ? j.intrebari_raspunse : [],
    termene: termeneDinAi(j),
    data_document: DATA.test(String(j?.data_document || '')) ? j.data_document : null,
    motive: stopReason === 'max_tokens' ? ['raspuns_ai_taiat'] : [],
    tokens_in: tokIn, tokens_out: tokOut,
  }
}

// Cheia unei întrebări pentru deduplicare între felii (o pereche la granița a două felii poate apărea de două ori).
export function cheieIntrebare(q: any): string {
  const s = String(q?.intrebare_originala || q?.intrebare_scurt || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
  return s.slice(0, 160)
}
const plin = (x: unknown) => String(x ?? '').trim().length > 0

// Combinarea feliilor (în ordine): liste concatenate, perechile duplicate unite (se păstrează cea cu răspuns, completată cu
// întrebarea din cealaltă), tipul majoritar (fără „altul”), data primului fragment care o are, motivele de incompletitudine reunite.
// Termenul (Copilot conv. 3, NO-GO P1 pe d459447 + runda 2): NU se mai alege maximul calendaristic — o prelungire la 30.10 urmată de o
// devansare la 25.10 ar fi dat 30.10. TOATE aparițiile (din toate feliile, inclusiv mai multe în aceeași felie / la n = 1) rămân în ordinea
// documentului, cu felia și citatul (`termene`); un singur termen distinct → termen_nou; mai multe → termen_nou = null + „conflict_termen”
// (omul alege din document, AI-ul nu ghicește).
export function combinaFelii(parti: Parte[]) {
  const modificari: any[] = [], vazuteMod = new Set<string>()
  for (const p of parti) for (const m of p.modificari) {
    const k = JSON.stringify([m?.ce_se_schimba, m?.unde]).toLowerCase()
    if (vazuteMod.has(k)) continue
    vazuteMod.add(k); modificari.push(m)
  }
  const intrebari: any[] = [], index = new Map<string, number>()
  for (const p of parti) for (const q of p.intrebari_raspunse) {
    const k = cheieIntrebare(q)
    if (!k || !index.has(k)) { if (k) index.set(k, intrebari.length); intrebari.push({ ...q }); continue }
    const i = index.get(k)!, vechi = intrebari[i]
    if (!plin(vechi.raspuns_original) && plin(q.raspuns_original)) intrebari[i] = { ...q, intrebare_originala: plin(q.intrebare_originala) ? q.intrebare_originala : vechi.intrebare_originala }
  }
  const voturi = new Map<string, number>()
  for (const p of parti) if (p.tip !== 'altul') voturi.set(p.tip, (voturi.get(p.tip) || 0) + 1)
  let tip = 'altul', max = 0
  for (const [k, v] of voturi) if (v > max) { tip = k; max = v }
  const termene = parti.flatMap((p, k) => (p.termene || []).map((t) => ({ data: t.data, felie: k + 1, citat: t.citat })))
  const distincte = [...new Set(termene.map((x) => x.data))]
  const motive = [...new Set(parti.flatMap((p) => p.motive))]
  if (distincte.length > 1) motive.push('conflict_termen')
  return {
    tip, modificari, intrebari_raspunse: intrebari,
    termen_nou: distincte.length === 1 ? distincte[0] : null, termene,
    data_document: parti.find((p) => p.data_document)?.data_document ?? null,
    motive,
    tokens_in: parti.reduce((s, p) => s + (p.tokens_in || 0), 0), tokens_out: parti.reduce((s, p) => s + (p.tokens_out || 0), 0),
    rezumate: parti.map((p) => p.rezumat),
  }
}

// Rezultatul final pe calea text (o felie sau mai multe + sinteză) și pe calea PDF (o parte, fără sinteză) — testat separat de handler.
// Copilot conv. 3 (runda 2, P2): stop_reason-ul SINTEZEI nu se mai pierde — o sinteză tăiată la max_tokens (chiar dacă JSON-ul a rămas
// parsabil) face citirea „raspuns_ai_taiat”, deci necompletă. Tăieturile nesigure între felii → „granita_nesigura”.
export type Sinteza = { j: any; stop: string | null; tokIn: number; tokOut: number }
export function rezultatFelii(parti: Parte[], granite: Granita[], sinteza: Sinteza | null) {
  const c = combinaFelii(parti)
  let tip = c.tip, rezumat = parti[0]?.rezumat || '', tokIn = c.tokens_in, tokOut = c.tokens_out
  if (sinteza) {
    if (TIPURI.includes(sinteza.j?.tip)) tip = sinteza.j.tip
    rezumat = String(sinteza.j?.rezumat || '').trim() || c.rezumate.filter(Boolean).join(' ')
    tokIn += sinteza.tokIn; tokOut += sinteza.tokOut
  } else if (TIPURI.includes(parti[0]?.tip)) tip = parti[0].tip
  const motive = [...c.motive]
  if (!graniteSigure(granite)) motive.push('granita_nesigura')
  if (sinteza?.stop === 'max_tokens') motive.push('raspuns_ai_taiat')
  return {
    tip, rezumat, modificari: c.modificari, intrebari_raspunse: c.intrebari_raspunse, termen_nou: c.termen_nou, termene: c.termene,
    data_document: c.data_document, motive: [...new Set(motive)], tokIn, tokOut, stop: sinteza?.stop ?? null, felii: parti.length, granite,
  }
}
