// Tăiere la plafonul de text FĂRĂ să pierdem pagini în tăcere (Faza 0, 12.10.2026).
// Înainte: `(...).trim().slice(0, MAX_TEXT)` tăia coada DUPĂ ce se adăugase avertismentul „TRUNCHIAT”: avertismentul dispărea,
// iar paginile tăiate din ultima felie nu ajungeau în `pagini_necitite`. Aici tăiem la începutul ultimei pagini care nu mai încape
// întreagă și întoarcem exact paginile scoase, ca apelantul să le treacă la necitite. Fără dependențe Deno (testabil cu node).

const RE_MARCAJ = /⟦PAGINA (\d+)(?:-(\d+))?⟧/g

export type Taiere = {
  text: string                 // textul păstrat (doar pagini întregi); fără avertisment
  taiat: boolean               // true dacă s-a scos ceva
  paginiScoase: number[]       // paginile (numerotare document original) care nu mai încap
  primaScoasa: number | null   // prima pagină scoasă (null dacă nu s-a scos nimic)
}

/** Taie `text` la cel mult `limita` caractere, la începutul paginii care nu mai încape întreagă. */
export function taieLaPagina(text: string, limita: number, ultimaPagina?: number): Taiere {
  if (text.length <= limita) return { text, taiat: false, paginiScoase: [], primaScoasa: null }
  const marcaje = [...text.matchAll(RE_MARCAJ)].map((m) => ({ idx: m.index as number, de: Number(m[1]), pana: m[2] ? Number(m[2]) : Number(m[1]) }))
  // pagina care „călărește” limita = ultimul marcaj început înainte de limită; o scoatem întreagă (e incompletă)
  let k = -1
  for (let i = 0; i < marcaje.length; i++) if (marcaje[i].idx <= limita) k = i; else break
  if (k <= 0) {
    // niciun marcaj (sau prima pagină singură depășește plafonul): rămâne tăierea simplă; pagina tăiată e marcată necitită
    const prima = marcaje.length && k === 0 ? marcaje[0].de : null
    return { text: text.slice(0, limita), taiat: true, paginiScoase: prima != null ? [prima] : [], primaScoasa: prima }
  }
  const scoase: number[] = []
  const ultima = Math.max(ultimaPagina ?? 0, ...marcaje.slice(k).map((m) => m.pana))
  for (let p = marcaje[k].de; p <= ultima; p++) scoase.push(p)
  return { text: text.slice(0, marcaje[k].idx).trimEnd(), taiat: true, paginiScoase: scoase, primaScoasa: marcaje[k].de }
}
