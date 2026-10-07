// Dependențele unei edge function + data ultimei modificări care o privește (07.10.2026, cerere Răzvan).
//
// De ce: scripts/verifica-edge-functions.mjs compara data deploy-ului doar cu `git log` pe folderul funcției. O schimbare
// făcută DOAR în supabase/functions/_shared (ex. _shared/tipDocument.mjs — clasificatorul de documente importat de
// ofertare-seap-import, PR #641) ajungea pe Vercel, în UI și pe workerul NAS, dar funcția edge rămânea pe regulile vechi,
// iar raportul spunea „la zi”. Acum data de referință a unei funcții = cea mai nouă dintre folderul ei și fișierele din
// afara folderului care intră efectiv în bundle (_shared sau alt folder), iar raportul spune care fișier a declanșat semnalul.
//
// Cum (r2, după NO-GO Copilot conv. 3 pe #642): graful REAL al modulelor, construit de esbuild (deja în repo, dependență a
// lui vite) pornind din index.ts, ca la deploy. E un parser adevărat:
//   - comentariile și textele nu sunt importuri;
//   - un fișier mort din folder nu trage _shared după el;
//   - un fișier *_test importat din cod intră în graf.
// Ce nu se poate demonstra NU se ghicește, se raportează (fail-closed) și verificarea pică:
//   - specificator „gol” (alias) fără hartă de importuri (deno.json / import_map.json);
//   - import() / require() cu argument calculat;
//   - fișier lipsă, eroare de parsare, index.ts lipsă.
// npm:/jsr:/node:/http(s):/data: rămân externe: nu țin de repo.
//
// Ce NU se numără în data folderului: fișierele de test (*_test.ts, *.test.js…). Nu se publică, deci un commit doar pe ele
// nu cere deploy (ofertare-plansa-citeste/concurenta_test.ts, 07.10). Excepție: un fișier de test pe care codul îl
// importă e în graf și se numără.
import * as esbuild from 'esbuild'
import { readFile, access } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { posix, resolve as resolveAbs, sep } from 'node:path'

const execFileP = promisify(execFile)
const TEST_RE = /(_test|\.test|_spec|\.spec)\.[a-z]+$/
const EXTERN_RE = /^(npm|jsr|node|https?|data):/
// în bundle-ul produs de esbuild (fără comentarii): import(…) / require(…) al căror argument nu e un text literal
const CALCULAT_RE = /(?<![.\w$])(?:__)?(import|require)\s*\(\s*(?!["'])/g // __require = shim-ul esbuild
const exista = (f) => access(f).then(() => true, () => false)
const posixDin = (p) => posix.normalize(String(p).split(sep).join('/'))

/** Hărțile de importuri pe care le-ar folosi deploy-ul: deno.json / import_map.json din folderul funcției, apoi
 *  import_map.json din rădăcina funcțiilor. deno.jsonc nu se citește (comentarii) → problemă raportată. */
async function harti(radacina, slug, cwd) {
  const lista = [], probleme = []
  for (const cale of [posix.join(radacina, slug, 'deno.json'), posix.join(radacina, slug, 'import_map.json'), posix.join(radacina, 'import_map.json')]) {
    const abs = resolveAbs(cwd, cale)
    if (!await exista(abs)) continue
    try { lista.push({ cale, dir: resolveAbs(abs, '..'), imports: JSON.parse(await readFile(abs, 'utf8')).imports ?? {} }) }
    catch (e) { probleme.push(`hartă de importuri necitibilă: ${cale} (${e.message})`) }
  }
  if (await exista(resolveAbs(cwd, radacina, slug, 'deno.jsonc'))) probleme.push(`deno.jsonc nu e citit de verificator: ${posix.join(radacina, slug, 'deno.jsonc')}`)
  return { lista, probleme }
}

/** Ținta unui specificator dintr-o hartă: potrivire exactă, apoi cel mai lung prefix terminat în „/”. */
function dinHarta(spec, lista) {
  for (const h of lista) {
    if (typeof h.imports[spec] === 'string') return { h, tinta: h.imports[spec] }
    const pref = Object.keys(h.imports).filter(k => k.endsWith('/') && spec.startsWith(k)).sort((a, b) => b.length - a.length)[0]
    if (pref && typeof h.imports[pref] === 'string') return { h, tinta: h.imports[pref] + spec.slice(pref.length) }
  }
  return null
}

/** Graful funcției `slug`: { intrari: fișierele locale din bundle + hărțile folosite (căi posix relative la cwd, sortate),
 *  probleme: ce nu se poate demonstra — dacă lista nu e goală, data de referință NU e de încredere }. */
export async function grafFunctie(radacina, slug, { cwd = process.cwd() } = {}) {
  const { lista, probleme } = await harti(radacina, slug, cwd)
  const folosite = new Set()
  const plugin = { name: 'rezolvare-ca-la-deploy', setup(b) {
    b.onResolve({ filter: /.*/ }, (a) => {
      if (a.kind === 'entry-point' || /^\.{0,2}\//.test(a.path)) return undefined // relativ / absolut: rezolvarea esbuild
      if (EXTERN_RE.test(a.path)) return { path: a.path, external: true }
      const m = dinHarta(a.path, lista)
      if (m) {
        folosite.add(m.h.cale)
        if (EXTERN_RE.test(m.tinta)) return { path: m.tinta, external: true }
        if (/^\.{0,2}\//.test(m.tinta)) return { path: resolveAbs(m.h.dir, m.tinta) }
      }
      return { errors: [{ text: `specificator nerezolvat (alias fără hartă de importuri?): ${a.path}` }] }
    })
  } }
  let r
  try {
    r = await esbuild.build({ entryPoints: [posix.join(radacina, slug, 'index.ts')], absWorkingDir: resolveAbs(cwd), bundle: true,
      write: false, metafile: true, format: 'esm', platform: 'neutral', outdir: 'nefolosit', logLevel: 'silent', plugins: [plugin] })
  } catch (e) {
    const err = e.errors?.length ? e.errors : [{ text: String(e.message ?? e) }]
    return { intrari: [], probleme: [...probleme, ...err.map(x => x.text + (x.location ? ` (${posixDin(x.location.file)}:${x.location.line})` : ''))] }
  }
  for (const w of r.warnings) if (/require|import|resolv|glob/i.test(`${w.id} ${w.text}`)) probleme.push(`esbuild: ${w.text}`)
  const out = r.outputFiles.map(f => f.text).join('\n')
  for (const m of out.matchAll(CALCULAT_RE)) probleme.push(`${m[1]}() cu argument calculat, dependența nu se poate demonstra: ${out.slice(m.index, m.index + 70).split('\n')[0]}`)
  const intrari = new Set([...Object.keys(r.metafile.inputs), ...folosite].map(posixDin))
  return { intrari: [...intrari].sort(), probleme }
}

/** Data ultimului commit pe o cale (ms) sau null. NU ora fișierului de pe disc: în CI checkout-ul le pune pe toate la ora clonării.
 *  `faraTeste` (pentru un folder): commit-urile care ating doar fișiere de test nu se numără. `cache` (Map) — opțional, pentru
 *  o singură trecere peste toate funcțiile (fișierele _shared se repetă). */
export async function dataGit(cale, { cwd, faraTeste = false, cache } = {}) {
  const cheie = `${cwd ?? ''}|${faraTeste}|${cale}`
  if (cache?.has(cheie)) return cache.get(cheie)
  // pathspec-uri git care scot testele (aceleași sufixe ca TEST_RE, orice extensie: și fixture-urile)
  const spec = faraTeste ? [cale, ...['_test', '.test', '_spec', '.spec'].map(s => `:(exclude,glob)${cale}/**/*${s}.*`)] : [cale]
  const { stdout } = await execFileP('git', ['log', '-1', '--format=%cI', '--', ...spec], { maxBuffer: 1 << 20, cwd })
  const t = Date.parse(stdout.trim())
  const v = Number.isFinite(t) ? t : null
  cache?.set(cheie, v)
  return v
}

/** Ultima modificare care privește funcția: { commit (ms), din, probleme } sau null dacă folderul n-are istoric git.
 *  `din` = fișierul din afara folderului (sau testul importat din cod) mai nou decât folderul, altfel null.
 *  `probleme` nevid = graful nu s-a putut demonstra → apelantul NU are voie să spună „la zi”. */
export async function ultimaModificare(radacina, slug, { cwd, graf, cache } = {}) {
  const folder = posix.join(radacina, slug)
  const proprie = await dataGit(folder, { cwd, faraTeste: true, cache })
  if (proprie == null) return null
  const g = graf ?? await grafFunctie(radacina, slug, { cwd })
  let commit = proprie, din = null
  for (const f of g.intrari) {
    if (f.startsWith(folder + '/') && !TEST_RE.test(f)) continue // acoperit de data folderului
    const t = await dataGit(f, { cwd, cache })
    if (t != null && t > commit) { commit = t; din = f }
  }
  return { commit, din, probleme: g.probleme }
}
