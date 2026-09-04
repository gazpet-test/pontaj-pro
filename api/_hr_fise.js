// Citirea numelui unei fise de aptitudini / aviz psihologic scanate de Natalia.
//
// Pe server (NAS → Drive) fisele stau intr-un singur folder, „FISE APTITUDINI - ANGAJATI",
// si numele fisierului e tot ce stim despre ele: „11.01.2027 - NICOLAE VASILE.jpeg",
// „VERGA IULIAN - AVIZ PSIHILOGIC - 24.06.2027.jpeg", „MITITELU I..pdf", „(1)/(2)" cand
// scanul are doua pagini. Aici scoatem din nume: data de expirare, tipul (fisa sau aviz),
// pagina si omul. Nimic nu se ghiceste la limita — ce nu se poate lega sigur se raporteaza.
import { normalizeStr } from './_hr_clasificare.js'

export const TIP_FISA = 18   // hr_autorizatii_tipuri: Fișă de aptitudini (medicina muncii)
export const TIP_AVIZ = 19   // hr_autorizatii_tipuri: Aviz Psihologic

// Cuvinte care nu sunt nume de om: tipul actului, functia, firma.
const ZGOMOT = new Set([
  'fisa', 'fise', 'de', 'aptitudini', 'apatitudini', 'aviz', 'psihologic', 'psihilogic', 'si',
  'medicina', 'muncii', 'medicala', 'gazpet', 'instal', 'invest', 'masinist', 'sofer', 'profesionist',
  'compresorist', 'conducator', 'masini', 'utilaje', 'pentru', 'curs', 'rsvti', 'sudor', 'lacatus',
  'muncitor', 'necalificat', 'pag', 'pagina', 'scan', 'copy', 'img', 'jpeg', 'jpg', 'pdf', 'png',
])

/** Data DD.MM.YYYY (accepta virgula, spatii ratacite: „13,10,2026", „11.02 .2027", „28.04 2027"). */
function dataDinNume(base) {
  const m = base.match(/(\d{1,2})\s*[.,]\s*(\d{1,2})\s*[.,\s]\s*(\d{4})/)
  if (!m) return { data: null, rest: base }
  const zi = Number(m[1]), luna = Number(m[2]), an = Number(m[3])
  const ok = zi >= 1 && zi <= 31 && luna >= 1 && luna <= 12 && an >= 2015 && an <= 2040
  return {
    data: ok ? `${an}-${String(luna).padStart(2, '0')}-${String(zi).padStart(2, '0')}` : null,
    rest: base.replace(m[0], ' '),
  }
}

/**
 * @returns {{ ext, tip_id, pagina, data_expirare, data_partiala, nume_curat, tokens, initiale }}
 *   data_partiala = „02.08" fara an — nu stim anul, nu inventam.
 */
export function citesteNumeFisa(numeFisier) {
  const ext = (numeFisier.includes('.') ? numeFisier.split('.').pop() : '').toLowerCase()
  let base = numeFisier.replace(/\.[^.]+$/, '')
  const pag = base.match(/\((\d)\)\s*$/)
  const pagina = pag ? Number(pag[1]) : 1
  if (pag) base = base.replace(pag[0], ' ')

  const { data, rest } = dataDinNume(base)
  base = rest
  // zi.luna fara an — o pastram doar ca informatie in raport
  const partial = base.match(/(?:^|\s)(\d{1,2}\.\d{1,2})(?=\s|$|-)/)
  const data_partiala = data ? null : (partial ? partial[1] : null)
  if (partial) base = base.replace(partial[0], ' ')

  const norm = normalizeStr(base)
  const tip_id = /psih[io]logic/.test(norm) && !/aptitudini/.test(norm) ? TIP_AVIZ : TIP_FISA
  const ambele = /psih[io]logic/.test(norm) && /aptitudini/.test(norm)

  // „C-TIN" → „c tin" dupa normalizare; il refacem in „constantin"
  const cuvinte = norm.replace(/\bc tin\b/g, 'constantin').split(' ').filter(Boolean)
  const tokens = [], initiale = []
  for (const w of cuvinte) {
    if (ZGOMOT.has(w)) continue
    if (/^\d+$/.test(w)) continue
    if (w.length === 1) { initiale.push(w); continue }
    if (w.length === 2) continue
    tokens.push(w)
  }
  return {
    ext, tip_id, ambele, pagina, data_expirare: data, data_partiala,
    nume_curat: [...tokens, ...initiale.map((i) => i.toUpperCase() + '.')].join(' '),
    tokens: [...new Set(tokens)], initiale,
  }
}

function distanta(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i])
  for (let j = 1; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  }
  return dp[a.length][b.length]
}
function acelasi(a, b) {
  if (a === b) return true
  const scurt = Math.min(a.length, b.length)
  if (scurt >= 5 && distanta(a, b) <= 1) return true
  return scurt >= 7 && distanta(a, b) <= 2
}

/**
 * Leaga numele citit de un angajat. `employees` = {id, name, active}; `dateCunoscute` =
 * Map employee_id → Set de date de expirare deja in platforma (departajeaza omonimii:
 * „CIOBANU LILIANA 02.10.2026" e contractul vechi, nu „CIOBANU LENUTA LILIANA").
 * Intoarce { employee, motiv } sau { employee: null, motiv }.
 */
export function leagaAngajat(citit, employees, dateCunoscute = new Map()) {
  const { tokens, initiale, data_expirare } = citit
  if (!tokens.length) return { employee: null, motiv: 'fara nume in fisier' }

  const lista = employees.map((e) => ({
    e, t: [...new Set(normalizeStr(e.name).split(' ').filter((x) => x.length >= 2))],
  })).filter((x) => x.t.length)

  // 1. nume complet: cel putin doua cuvinte potrivite (sau toate, cand fisierul are doar unul)
  let cand = lista.map((x) => {
    const pot = tokens.filter((t) => x.t.some((w) => acelasi(w, t))).length
    return { ...x, pot, scor: pot / Math.min(tokens.length, x.t.length) }
  }).filter((x) => x.pot >= 2 || (tokens.length === 1 && x.pot === 1))

  // 2. nume + initiala („MITITELU I.", „TRUSU D."): numele de familie, prenumele incepe cu litera
  if (tokens.length === 1 && initiale.length) {
    const cuInitiala = lista.filter((x) => acelasi(x.t[0], tokens[0]) && x.t.slice(1).some((w) => w.startsWith(initiale[0])))
    cand = cuInitiala.map((x) => ({ ...x, pot: 2, scor: 1, initiala: true }))
  }

  // 3. un singur cuvant potrivit dintr-un nume de doua („SING SUBHKARAN" → SINGH SUBHKARAN):
  //    merge doar daca acel cuvant e la un singur om din toata firma (fara dublurile „CTR VECHI")
  if (!cand.length && tokens.length >= 2) {
    const unice = tokens.map((t) => {
      const cu = lista.filter((x) => !/ctr vechi/i.test(x.e.name) && x.t.some((w) => acelasi(w, t)))
      return cu.length === 1 ? cu[0] : null
    }).filter(Boolean)
    // ...si celelalte cuvinte din fisier trebuie sa semene cu ale lui (o greseala de tastare,
    // nu alt nume): „IOSU LAURENTIU" nu e BUCSAIN LAURENTIU doar fiindca LAURENTIU e unic
    if (unice.length && unice.every((u) => u.e.id === unice[0].e.id)) {
      const u = unice[0]
      const seamana = tokens.every((t) => u.t.some((w) => acelasi(w, t) || distanta(w, t) <= 2))
      if (seamana) cand = [{ ...u, pot: 1, scor: 0.5, partial: true }]
    }
  }
  if (!cand.length) return { employee: null, motiv: 'niciun angajat cu numele asta' }

  const max = Math.max(...cand.map((c) => c.scor))
  let top = cand.filter((c) => c.scor === max)
  if (top.length > 1) {
    const maxPot = Math.max(...top.map((c) => c.pot))
    if (top.some((c) => c.pot < maxPot)) top = top.filter((c) => c.pot === maxPot)
  }
  if (top.length > 1 && data_expirare) {
    const cuData = top.filter((c) => dateCunoscute.get(c.e.id)?.has(data_expirare))
    if (cuData.length === 1) top = cuData
  }
  // un singur cuvant (prenume lituanian/srilankez) trebuie sa fie unic in toata firma
  if (tokens.length === 1 && !initiale.length && top.length > 1) {
    return { employee: null, motiv: `„${tokens[0]}" e la ${top.length} angajati: ${top.map((c) => c.e.name).join(' / ')}` }
  }
  if (top.length > 1) {
    const faraVechi = top.filter((c) => !/ctr vechi/i.test(c.e.name))
    if (faraVechi.length && faraVechi.length < top.length) top = faraVechi
  }
  // la o initiala („MITITELU M.") nu ghicim dupa „cine e activ” — M poate fi Mihaita sau Marian
  if (top.length > 1 && !top[0].initiala) {
    const activi = top.filter((c) => c.e.active !== false)
    if (activi.length === 1) top = activi
  }
  if (top.length > 1) return { employee: null, motiv: `ambiguu: ${top.map((c) => c.e.name).join(' / ')}` }
  return { employee: top[0].e, motiv: top[0].partial ? 'nume partial (un cuvant unic in firma)' : 'nume complet' }
}
