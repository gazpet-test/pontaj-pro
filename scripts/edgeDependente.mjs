// Dependențele _shared ale unei edge function + data ultimei modificări care o privește (07.10.2026, cerere Răzvan).
//
// De ce: scripts/verifica-edge-functions.mjs compara data deploy-ului doar cu `git log` pe folderul funcției. O schimbare
// făcută DOAR în supabase/functions/_shared (ex. _shared/tipDocument.mjs — clasificatorul de documente importat de
// ofertare-seap-import, PR #641) ajungea pe Vercel, în UI și pe workerul NAS, dar funcția edge rămânea pe regulile vechi,
// iar raportul spunea „la zi”. Acum data de referință a unei funcții = cea mai nouă dintre folderul ei și fișierele
// _shared pe care le importă (direct sau prin alte fișiere _shared), iar raportul spune care fișier a declanșat semnalul.
//
// Ce NU se numără: fișierele de test (*_test.ts, *.test.ts…) — nu se publică, deci un commit doar pe ele nu cere deploy,
// nici în folderul funcției (ofertare-plansa-citeste/concurenta_test.ts, 07.10); importurile npm:/jsr:/https:.
import { readdir, readFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { posix } from 'node:path'

const execFileP = promisify(execFile)
const SURSA_RE = /\.(ts|mts|js|mjs|tsx|jsx)$/
const TEST_RE = /(_test|\.test|_spec|\.spec)\.(ts|mts|js|mjs|tsx|jsx)$/
// `… from '…'` (import / export … from), `import('…')`, `import '…'` (doar efecte)
const IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])([^'"\n]+)\1/g

/** Specificatorii RELATIVI importați într-un text sursă (în ordinea apariției). */
export function importuriRelative(text) {
  const out = []
  for (const m of String(text ?? '').matchAll(IMPORT_RE)) if (m[2].startsWith('./') || m[2].startsWith('../')) out.push(m[2])
  return out
}

/** Fișierele sursă dintr-un folder (recursiv), fără teste — căi posix, relative la cwd. */
export async function fisiereSursa(dir) {
  const out = []
  let intrari = []
  try { intrari = await readdir(dir, { withFileTypes: true }) } catch { return out }
  for (const e of intrari) {
    const cale = posix.join(dir, e.name)
    if (e.isDirectory()) out.push(...await fisiereSursa(cale))
    else if (SURSA_RE.test(e.name) && !TEST_RE.test(e.name)) out.push(cale)
  }
  return out.sort()
}

/** Fișierele din `<radacina>/_shared` de care depinde funcția `slug` (direct și tranzitiv), sortate. */
export async function dependenteShared(radacina, slug, { citeste = (f) => readFile(f, 'utf8'), listeaza = fisiereSursa } = {}) {
  const prefix = posix.join(radacina, '_shared') + '/'
  const deVizitat = await listeaza(posix.join(radacina, slug))
  const vazute = new Set()
  const rezultat = new Set()
  while (deVizitat.length) {
    const f = deVizitat.pop()
    if (vazute.has(f)) continue
    vazute.add(f)
    let text
    try { text = await citeste(f) } catch { continue }
    for (const spec of importuriRelative(text)) {
      const tinta = posix.normalize(posix.join(posix.dirname(f), spec))
      if (tinta.startsWith(prefix) && !TEST_RE.test(tinta) && !rezultat.has(tinta)) { rezultat.add(tinta); deVizitat.push(tinta) }
    }
  }
  return [...rezultat].sort()
}

// pathspec-uri git care scot testele din `git log` pe un folder (aceleași sufixe ca TEST_RE, orice extensie: și fixture-urile)
const faraTesteIn = (cale) => ['_test', '.test', '_spec', '.spec'].map(s => `:(exclude,glob)${cale}/**/*${s}.*`)

/** Data ultimului commit pe o cale (ms) sau null. NU ora fișierului de pe disc: în CI checkout-ul le pune pe toate la ora clonării.
 *  `faraTeste` (pentru un folder): commit-urile care ating doar fișiere de test nu se numără. */
export async function dataGit(cale, { cwd, faraTeste = false } = {}) {
  const spec = faraTeste ? [cale, ...faraTesteIn(cale)] : [cale]
  const { stdout } = await execFileP('git', ['log', '-1', '--format=%cI', '--', ...spec], { maxBuffer: 1 << 20, cwd })
  const t = Date.parse(stdout.trim())
  return Number.isFinite(t) ? t : null
}

/** Ultima modificare care privește funcția: { commit (ms), din: null | '<radacina>/_shared/…' } — `din` e fișierul _shared,
 *  când el e mai nou decât folderul funcției. null dacă folderul funcției n-are istoric git (clonă superficială). */
export async function ultimaModificare(radacina, slug, { cwd, dependente } = {}) {
  const proprie = await dataGit(posix.join(radacina, slug), { cwd, faraTeste: true })
  if (proprie == null) return null
  let commit = proprie, din = null
  const dep = dependente ?? await dependenteShared(radacina, slug, cwd ? {
    citeste: (f) => readFile(posix.join(cwd, f), 'utf8'),
    listeaza: async (d) => (await fisiereSursa(posix.join(cwd, d))).map(f => posix.relative(cwd, f)),
  } : {})
  for (const f of dep) {
    const t = await dataGit(f, { cwd })
    if (t != null && t > commit) { commit = t; din = f }
  }
  return { commit, din }
}
