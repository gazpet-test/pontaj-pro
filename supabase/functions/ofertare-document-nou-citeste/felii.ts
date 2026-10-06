// deno-lint-ignore-file no-explicit-any
// ofertare-document-nou-citeste/felii.ts — rezumatul PE FELII (Răcari, 06.10.2026, varianta A aleasă de Răzvan).
// „Răspuns consolidat nr. 2” (30 de pagini, 68.516 caractere, 38 de perechi întrebare–răspuns): citirea pe felii a mers, dar
// rezumatul într-un singur apel cădea la 130 s — cu citat literal pentru fiecare pereche, AI-ul avea prea mult de SCRIS (ieșirea, nu
// intrarea, era limita). Acum textul se împarte în felii de ≤ MAX_FELIE caractere, tăiate la granița unei întrebări („Solicitarea
// nr. N”, „Întrebarea nr. N”…) ca perechea să nu se rupă, altfel la o pagină (⟦PAGINA N⟧), altfel la un rând gol. Fiecare felie se
// citește într-un apel separat (~40–60 s), rezultatele parțiale se păstrează pe server, iar la final se combină + o sinteză scurtă.
export const MAX_FELIE = 15_000                   // ~8 perechi întrebare–răspuns cu citat literal ≈ 3–4k tokeni de ieșire

// Începutul unei întrebări: la început de rând. „Răspuns solicitarea nr. N” NU se potrivește (nu tăiem între întrebare și răspuns).
const RE_INTREBARE = /^[ \t]*(?:solicitarea|întrebarea|intrebarea|clarificarea|cererea de clarificare|solicitare de clarificare)\b[^\n]{0,25}?\d+/gim
const RE_PAGINA = /⟦PAGINA \d+(?:-\d+)?⟧/g

function pozitii(re: RegExp, t: string): number[] {
  const p: number[] = []
  for (const m of t.matchAll(re)) p.push(m.index ?? 0)
  return p
}

// Împărțire FĂRĂ pierderi: concatenarea feliilor = textul primit (testat).
export function imparteInFelii(text: string, max = MAX_FELIE): string[] {
  const t = String(text || '')
  if (t.length <= max) return [t]
  const intrebari = pozitii(RE_INTREBARE, t), pagini = pozitii(RE_PAGINA, t)
  const min = Math.max(1, Math.floor(max / 2))     // tăietura se caută în a doua jumătate a ferestrei (felii nu prea mici)
  const felii: string[] = []
  let start = 0
  while (t.length - start > max) {
    const lo = start + min, hi = start + max
    const ultima = (arr: number[]) => { let r = -1; for (const x of arr) if (x > lo && x <= hi) r = x; return r }
    let cut = ultima(intrebari)
    if (cut < 0) cut = ultima(pagini)
    if (cut < 0) { const k = t.lastIndexOf('\n\n', hi); if (k > lo) cut = k + 2 }
    if (cut < 0) { const k = t.lastIndexOf('\n', hi); if (k > lo) cut = k + 1 }
    if (cut < 0) cut = hi
    felii.push(t.slice(start, cut))
    start = cut
  }
  felii.push(t.slice(start))
  return felii
}

const DATA = /^\d{4}-\d{2}-\d{2}$/
export type Parte = {
  tip: string; rezumat: string; modificari: any[]; intrebari_raspunse: any[]
  termen_nou: string | null; data_document: string | null; motive: string[]; tokens_in: number; tokens_out: number
}
const TIPURI = ['raspuns_clarificare', 'erata', 'document_nou', 'altul']

// Răspunsul AI pentru o felie → parte normalizată (liste, date valide, motivul „răspuns tăiat” dacă a atins max_tokens).
export function parteDinAi(j: any, stopReason: string | null | undefined, tokIn: number, tokOut: number): Parte {
  return {
    tip: TIPURI.includes(j?.tip) ? j.tip : 'altul',
    rezumat: String(j?.rezumat_fragment ?? j?.rezumat ?? ''),   // plafonul (MAX_REZUMAT) și motivul „rezumat_taiat” le pune plafoneazaRezultat
    modificari: Array.isArray(j?.modificari) ? j.modificari : [],
    intrebari_raspunse: Array.isArray(j?.intrebari_raspunse) ? j.intrebari_raspunse : [],
    termen_nou: DATA.test(String(j?.termen_nou || '')) ? j.termen_nou : null,
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
// întrebarea din cealaltă), tipul majoritar (fără „altul”), termenul cel mai târziu (toate termenele găsite rămân vizibile),
// data primului fragment care o are, motivele de incompletitudine reunite.
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
  const termene = [...new Set(parti.map((p) => p.termen_nou).filter((x): x is string => !!x))].sort()
  return {
    tip, modificari, intrebari_raspunse: intrebari,
    termen_nou: termene.length ? termene[termene.length - 1] : null, termene,
    data_document: parti.find((p) => p.data_document)?.data_document ?? null,
    motive: [...new Set(parti.flatMap((p) => p.motive))],
    tokens_in: parti.reduce((s, p) => s + (p.tokens_in || 0), 0), tokens_out: parti.reduce((s, p) => s + (p.tokens_out || 0), 0),
    rezumate: parti.map((p) => p.rezumat),
  }
}
